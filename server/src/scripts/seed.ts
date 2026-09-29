import { getDb, type Database, type Row } from '../core/db.js';
import { config } from '../core/config.js';
import { seedFxRates, createRule } from '../core/pricing.js';
import { SETTING_KEYS, setSetting, DEFAULT_COMPANY, DEFAULT_AUTOMATION, DEFAULT_SALES } from '../core/settings.js';
import { upsertProduct, upsertTier, upsertUser, listProducts } from '../core/repos/catalog.js';
import { upsertPlaybook, listPlaybooks } from '../core/repos/engagement.js';
import { nowIso, uid } from '../core/util.js';

/**
 * Seed data.
 *
 * The point of this file is that a fresh clone is *immediately* a working demo:
 * a real product library with cost tiers, real pricing rules, a bilingual
 * playbook library, and a queue of realistic inbound inquiries in six languages.
 * Nothing here is lorem ipsum — every number flows through the real pricing
 * engine and every inquiry flows through the real agent pipeline.
 */

interface SeedProduct {
  sku: string;
  nameEn: string;
  nameZh: string;
  category: string;
  unit: string;
  moq: number;
  hsCode: string;
  hsDescription: string;
  netWeightKg: number;
  grossWeightKg: number;
  cbm: number;
  certifications: string[];
  targetMarkets: string[];
  descriptionEn: string;
  /**
   * Localized names, synonyms and trade terms.
   *
   * The product library is written in English and Chinese, but inquiries arrive
   * in Japanese, Spanish, German, Russian… Without aliases the offline matcher
   * can only agree by accident (a "500" in a SKU agreeing with "500ml"), which
   * is how the wrong product gets onto a quotation. These also make the real-LLM
   * path cheaper: fewer tokens spent explaining what a "ステンレスボトル" is.
   */
  aliases: string[];
  /** [minQty, unitCostCNY, margin, listPriceUSD?] */
  tiers: Array<[number, number, number]>;
}

const PRODUCTS: SeedProduct[] = [
  {
    sku: 'LED-WORK-50W',
    nameEn: '50W Portable LED Work Light',
    nameZh: '50W 便携式 LED 工作灯',
    category: 'Lighting',
    unit: 'pcs',
    moq: 200,
    hsCode: '9405.42',
    hsDescription: 'LED luminaires and lighting fittings',
    netWeightKg: 0.85,
    grossWeightKg: 1.05,
    cbm: 0.0042,
    certifications: ['CE', 'RoHS', 'FCC'],
    targetMarkets: ['DE', 'US', 'AE', 'AU'],
    descriptionEn: 'IP65 die-cast aluminium housing, 5000lm, 5m rubber cable, foldable stand, 100-265V.',
    aliases: ['work light','floodlight','LED flood light','作業灯','LED投光器','ワークライト','工作灯','投光灯','luz de trabajo','reflector LED','Arbeitsstrahler','Arbeitsleuchte','прожектор','светильник','holofote LED'],
    tiers: [
      [200, 46, 0.22],
      [1000, 41, 0.2],
      [3000, 37.5, 0.18],
      [10000, 34, 0.15],
    ],
  },
  {
    sku: 'SOLAR-PNL-450',
    nameEn: '450W Monocrystalline Solar Panel',
    nameZh: '450W 单晶硅太阳能板',
    category: 'Solar',
    unit: 'pcs',
    moq: 50,
    hsCode: '8541.43',
    hsDescription: 'Photovoltaic cells assembled in modules',
    netWeightKg: 23.5,
    grossWeightKg: 25,
    cbm: 0.13,
    certifications: ['CE', 'TUV', 'INMETRO'],
    targetMarkets: ['BR', 'DE', 'CL', 'ZA'],
    descriptionEn: 'Half-cell PERC, 21.3% efficiency, anodised frame, 25-year output warranty.',
    aliases: ['solar module','PV module','太陽光パネル','ソーラーパネル','太阳能板','太阳能组件','panel solar','Solarmodul','солнечная панель','painel solar'],
    tiers: [
      [50, 620, 0.16],
      [200, 578, 0.14],
      [600, 545, 0.12],
      [2000, 512, 0.1],
    ],
  },
  {
    sku: 'PWRBANK-20K',
    nameEn: '20000mAh Power Bank with PD 65W',
    nameZh: '20000mAh PD 65W 移动电源',
    category: 'Power',
    unit: 'pcs',
    moq: 500,
    hsCode: '8507.60',
    hsDescription: 'Lithium-ion accumulators',
    netWeightKg: 0.42,
    grossWeightKg: 0.5,
    cbm: 0.0012,
    certifications: ['CE', 'RoHS', 'FCC', 'UN38.3'],
    targetMarkets: ['US', 'DE', 'JP', 'KR'],
    descriptionEn: 'Grade-A cells, 65W PD in/out, digital display, airline-safe UN38.3 report on file.',
    aliases: ['power bank','battery pack','portable charger','モバイルバッテリー','充電器','移动电源','充电宝','batería externa','Powerbank','повербанк','внешний аккумулятор','carregador portátil'],
    tiers: [
      [500, 118, 0.24],
      [2000, 106, 0.21],
      [5000, 96, 0.18],
      [20000, 87, 0.15],
    ],
  },
  {
    sku: 'USBC-HUB-7IN1',
    nameEn: '7-in-1 USB-C Docking Hub',
    nameZh: '7 合 1 USB-C 扩展坞',
    category: 'Accessories',
    unit: 'pcs',
    moq: 500,
    hsCode: '8517.62',
    hsDescription: 'Machines for the reception, conversion and transmission of data',
    netWeightKg: 0.11,
    grossWeightKg: 0.15,
    cbm: 0.0006,
    certifications: ['CE', 'RoHS', 'FCC'],
    targetMarkets: ['US', 'GB', 'DE', 'NL'],
    descriptionEn: 'HDMI 4K60, 2×USB3.0, SD/TF, 100W PD passthrough, Gigabit Ethernet, aluminium shell.',
    aliases: ['USB hub','dock','docking station','USBハブ','ドッキングステーション','扩展坞','集线器','hub USB','Dockingstation','USB-Hub','док-станция','хаб'],
    tiers: [
      [500, 74, 0.26],
      [2000, 66, 0.23],
      [5000, 58, 0.2],
      [20000, 52, 0.17],
    ],
  },
  {
    sku: 'BTSpk-MINI',
    nameEn: 'Mini Portable Bluetooth Speaker',
    nameZh: '迷你便携蓝牙音箱',
    category: 'Audio',
    unit: 'pcs',
    moq: 1000,
    hsCode: '8518.22',
    hsDescription: 'Multiple loudspeakers mounted in the same enclosure',
    netWeightKg: 0.28,
    grossWeightKg: 0.35,
    cbm: 0.0009,
    certifications: ['CE', 'RoHS', 'FCC'],
    targetMarkets: ['US', 'BR', 'MX', 'ES'],
    descriptionEn: 'BT5.3, IPX7, 12h playtime, TWS pairing, custom logo and packaging from 3k units.',
    aliases: ['speaker','bluetooth speaker','portable speaker','スピーカー','ブルートゥーススピーカー','音箱','蓝牙音箱','altavoz','parlante','Lautsprecher','колонка','динамик','caixa de som'],
    tiers: [
      [1000, 42, 0.25],
      [5000, 36.5, 0.22],
      [20000, 31, 0.19],
    ],
  },
  {
    sku: 'EBIKE-MTR-500',
    nameEn: '500W E-bike Brushless Hub Motor',
    nameZh: '500W 电动车无刷轮毂电机',
    category: 'E-mobility',
    unit: 'pcs',
    moq: 100,
    hsCode: '8501.31',
    hsDescription: 'DC motors of an output not exceeding 750 W',
    netWeightKg: 3.9,
    grossWeightKg: 4.4,
    cbm: 0.0095,
    certifications: ['CE', 'EN15194'],
    targetMarkets: ['DE', 'NL', 'FR', 'PL'],
    descriptionEn: '48V 500W geared hub, 45Nm torque, cassette or freewheel, EN15194 test report available.',
    aliases: ['hub motor','e-bike motor','electric motor','モーター','電動自転車','电机','轮毂电机','motor','Nabenmotor','мотор','двигатель'],
    tiers: [
      [100, 385, 0.2],
      [500, 352, 0.17],
      [2000, 328, 0.14],
    ],
  },
  {
    sku: 'CAMP-CHAIR-XL',
    nameEn: 'XL Folding Camping Chair 150kg',
    nameZh: 'XL 折叠露营椅（承重150kg）',
    category: 'Outdoor',
    unit: 'pcs',
    moq: 500,
    hsCode: '9401.79',
    hsDescription: 'Seats of other materials',
    netWeightKg: 3.2,
    grossWeightKg: 3.7,
    cbm: 0.032,
    certifications: ['BSCI', 'EN581'],
    targetMarkets: ['US', 'GB', 'AU', 'CA'],
    descriptionEn: 'Oxford 600D, steel 22mm frame, 150kg load, cup holder, carry bag, OEM colours.',
    aliases: ['camping chair','folding chair','camp chair','キャンプチェア','折りたたみ椅子','露营椅','折叠椅','silla de camping','Campingstuhl','кресло','стул','cadeira de camping'],
    tiers: [
      [500, 78, 0.28],
      [2000, 68, 0.24],
      [8000, 59, 0.2],
    ],
  },
  {
    sku: 'MUG-INSUL-500',
    nameEn: '500ml Vacuum Insulated Travel Mug',
    nameZh: '500ml 真空保温杯',
    category: 'Drinkware',
    unit: 'pcs',
    moq: 1000,
    hsCode: '9617.00',
    hsDescription: 'Vacuum flasks and other vacuum vessels',
    netWeightKg: 0.32,
    grossWeightKg: 0.4,
    cbm: 0.0011,
    certifications: ['FDA', 'LFGB'],
    targetMarkets: ['US', 'DE', 'JP'],
    descriptionEn: '304 内胆 + 316 外壳, 12h hot / 24h cold, powder coating, laser logo, FDA/LFGB compliant.',
    aliases: ['vacuum flask','thermos','travel mug','insulated bottle','vacuum bottle','ステンレスボトル','真空断熱ボトル','水筒','タンブラー','保温杯','真空杯','水杯','termo','botella térmica','Thermosflasche','Isolierflasche','термос','бутылка','garrafa térmica','copo térmico'],
    tiers: [
      [1000, 34, 0.3],
      [5000, 29, 0.26],
      [20000, 24.5, 0.22],
    ],
  },
];

interface SeedPlaybook {
  name: string;
  stage: string;
  language: string;
  subjectTpl: string;
  bodyTpl: string;
  tags: string[];
}

const PLAYBOOKS_EN: SeedPlaybook[] = [
  {
    name: '首封回复·英文·标准',
    stage: 'first_reply',
    language: 'en',
    subjectTpl: 'Re: Your inquiry — {product_list}',
    bodyTpl: [
      'Dear {contact_name},',
      '',
      'Thank you for reaching out about {product_list}. We manufacture this line ourselves and export to 40+ markets, so we can hold both the price and the lead time we quote.',
      '',
      'Before I send firm numbers, could you confirm:',
      '1. Target quantity per item',
      '2. Destination port',
      '3. Any certification you must have on file (CE, FCC, FDA…)',
      '',
      'Reply with those three and I will have a formal quotation to you the same working day.',
      '',
      'Best regards,',
      '{sender_name}',
      '{sender_role}',
    ].join('\n'),
    tags: ['first_reply', 'discovery'],
  },
  {
    name: '报价封面·英文·标准',
    stage: 'quote_cover',
    language: 'en',
    subjectTpl: 'Quotation {code} — {product_list}',
    bodyTpl: [
      'Dear {contact_name},',
      '',
      'Please find our quotation {code} attached.',
      '',
      '• {product_list}',
      '• Total: {currency} {total}',
      '• Terms: {incoterm} {port}',
      '• Payment: {payment_terms}',
      '• Lead time: {lead_time} days after deposit',
      '• Valid until: {valid_until}',
      '',
      'A note on why we can hold this price: we buy the raw materials on an annual frame contract, so our cost is locked even when the spot market moves. That is also why we can commit to {lead_time} days rather than quoting “subject to availability”.',
      '',
      'If the specification or packaging needs adjusting, tell me and I will revise the offer rather than starting over.',
      '',
      'Best regards,',
      '{sender_name}',
      '{sender_role}',
    ].join('\n'),
    tags: ['quote', 'value_frame'],
  },
  {
    name: '跟进·英文·第1次（D+3）',
    stage: 'quote_followup',
    language: 'en',
    subjectTpl: 'Following up on quotation {code}',
    bodyTpl: [
      'Hi {contact_name},',
      '',
      'Just making sure quotation {code} reached you — I know inboxes get brutal.',
      '',
      'Two things worth knowing:',
      '• The price in it is held until {valid_until}, and our supplier raised the raw material cost twice since we last quoted.',
      '• I can reserve stock for 10 days without a deposit if that helps you get internal sign-off.',
      '',
      'If the numbers are not workable, tell me which line and what target you need. I would rather rework it than lose the chance to work with you.',
      '',
      'Best regards,',
      '{sender_name}',
    ].join('\n'),
    tags: ['followup', 'urgency', 'stock'],
  },
  {
    name: '价格异议·英文·拆解成本',
    stage: 'objection_price',
    language: 'en',
    subjectTpl: 'Re: pricing on {code} — where the money goes',
    bodyTpl: [
      'Hi {contact_name},',
      '',
      'I hear you on price, and I would rather explain the number than defend it.',
      '',
      'Our {currency} {total} breaks down roughly as:',
      '• Cell / raw material — the biggest line, and it is certified grade, not grey market',
      '• Housing and finishing — die-cast, not stamped',
      '• Testing — the reports your customs and your customer will ask for',
      '• Freight and insurance allocation',
      '• Our margin — {incoterm} terms',
      '',
      'Two ways to bring it down without touching quality:',
      '1. Increase to the next quantity break — the unit price drops at the higher tier.',
      '2. Relax one requirement (packaging, cable length, finish) and I will show you the delta per unit.',
      '',
      'Tell me which lever you want to pull and I will reprice {code} today.',
      '',
      'Best regards,',
      '{sender_name}',
    ].join('\n'),
    tags: ['objection', 'price', 'concession'],
  },
  {
    name: '沉默唤醒·英文·D+30',
    stage: 'reengagement',
    language: 'en',
    subjectTpl: 'Still sourcing {product_list}?',
    bodyTpl: [
      'Hi {contact_name},',
      '',
      'No pressure at all — I am tidying our quotation list today and did not want to close yours without checking.',
      '',
      'If the project is paused, just reply “later” and I will park it for six months.',
      'If you went with another supplier, a one-line reason would genuinely help us — I would rather know than guess.',
      'If it is still live, we hold stock on this line and can ship inside {lead_time} days.',
      '',
      'Either way, thank you for the time you spent with us.',
      '',
      'Best regards,',
      '{sender_name}',
    ].join('\n'),
    tags: ['reengagement', 'loss_learning'],
  },
];

const PLAYBOOKS_ZH: SeedPlaybook[] = [
  {
    name: '首封回复·中文·标准',
    stage: 'first_reply',
    language: 'zh',
    subjectTpl: '关于 {product_list} 的询盘回复',
    bodyTpl: [
      '{contact_name} 您好，',
      '',
      '{product_list} 这款我们自有产线，出口 40+ 市场，价格和交期都能给到承诺值。',
      '',
      '在给您正式报价前，麻烦确认三点：',
      '1. 每款的意向数量',
      '2. 目的港',
      '3. 是否有必须随货的认证（CE / FCC / FDA 等）',
      '',
      '回复这三点，我当天就能把正式报价发给您。',
      '',
      '顺祝商祺',
      '{sender_name}',
      '{sender_role}',
    ].join('\n'),
    tags: ['first_reply', 'discovery'],
  },
  {
    name: '报价封面·中文·标准',
    stage: 'quote_cover',
    language: 'zh',
    subjectTpl: '报价单 {code}',
    bodyTpl: [
      '{contact_name} 您好，',
      '',
      '随函附上报价单 {code}。',
      '',
      '• {product_list}',
      '• 总价：{currency} {total}',
      '• 条款：{incoterm} {port}',
      '• 付款：{payment_terms}',
      '• 交期：定金到账后 {lead_time} 天',
      '• 有效期至：{valid_until}',
      '',
      '关于价格稳定性说明一句：我们的原材料走年度框架协议锁价，所以现货市场波动时我们的报价不会临时变。这也是我们能承诺 {lead_time} 天交期、而不是写“看库存”的原因。',
      '',
      '规格或包装需要调整，直接告诉我，我改报价，不用重新走一遍流程。',
      '',
      '顺祝商祺',
      '{sender_name}',
      '{sender_role}',
    ].join('\n'),
    tags: ['quote', 'value_frame'],
  },
  {
    name: '跟进·中文·第1次（D+3）',
    stage: 'quote_followup',
    language: 'zh',
    subjectTpl: '关于报价单 {code} 的跟进',
    bodyTpl: [
      '{contact_name} 您好，',
      '',
      '确认一下报价单 {code} 是否收到，怕被埋在邮件里了。',
      '',
      '两点说明：',
      '• 报价有效期到 {valid_until}，上次报价后原材料成本已经涨过两轮。',
      '• 如果是为了内部审批走流程，我可以无定金给您留 10 天货。',
      '',
      '如果价格不合适，告诉我哪一项、目标价多少。我更愿意改报价，而不是丢掉合作机会。',
      '',
      '顺祝商祺',
      '{sender_name}',
    ].join('\n'),
    tags: ['followup', 'urgency'],
  },
];

const PLAYBOOKS_ES: SeedPlaybook[] = [
  {
    name: 'First reply · Spanish',
    stage: 'first_reply',
    language: 'es',
    subjectTpl: 'Re: Su consulta — {product_list}',
    bodyTpl: [
      'Estimado/a {contact_name}:',
      '',
      'Gracias por contactarnos por {product_list}. Fabricamos esta línea nosotros mismos y exportamos a más de 40 mercados, así que podemos sostener tanto el precio como el plazo.',
      '',
      'Antes de enviarle cifras firmes, ¿podría confirmar:',
      '1. Cantidad objetivo por artículo',
      '2. Puerto de destino',
      '3. Certificación obligatoria (CE, FCC, FDA…)',
      '',
      'Con esos tres datos le envío la cotización formal el mismo día.',
      '',
      'Saludos cordiales,',
      '{sender_name}',
      '{sender_role}',
    ].join('\n'),
    tags: ['first_reply'],
  },
  {
    name: 'Quote cover · Spanish',
    stage: 'quote_cover',
    language: 'es',
    subjectTpl: 'Cotización {code} — {product_list}',
    bodyTpl: [
      'Estimado/a {contact_name}:',
      '',
      'Adjunto nuestra cotización {code}.',
      '',
      '• {product_list}',
      '• Total: {currency} {total}',
      '• Condiciones: {incoterm} {port}',
      '• Pago: {payment_terms}',
      '• Plazo de entrega: {lead_time} días tras el depósito',
      '• Validez: {valid_until}',
      '',
      'Nuestros costes están fijados por contrato anual de materias primas, por eso el precio no cambia con el mercado spot y podemos comprometer {lead_time} días.',
      '',
      'Si hay que ajustar la especificación o el embalaje, dígamelo y reviso la oferta.',
      '',
      'Saludos cordiales,',
      '{sender_name}',
    ].join('\n'),
    tags: ['quote'],
  },
];

const PLAYBOOKS_DE: SeedPlaybook[] = [
  {
    name: 'Erstantwort · Deutsch',
    stage: 'first_reply',
    language: 'de',
    subjectTpl: 'Re: Ihre Anfrage — {product_list}',
    bodyTpl: [
      'Sehr geehrte/r {contact_name},',
      '',
      'vielen Dank für Ihre Anfrage zu {product_list}. Wir fertigen diese Linie selbst und liefern in über 40 Märkte — Preis und Lieferzeit können wir daher verbindlich zusagen.',
      '',
      'Bevor ich Ihnen konkrete Zahlen sende, benötige ich:',
      '1. Zielmenge je Artikel',
      '2. Zielhafen',
      '3. Erforderliche Zertifizierung (CE, FCC, FDA …)',
      '',
      'Mit diesen drei Angaben erhalten Sie das Angebot am selben Werktag.',
      '',
      'Mit freundlichen Grüßen',
      '{sender_name}',
      '{sender_role}',
    ].join('\n'),
    tags: ['first_reply'],
  },
];

export async function seedDatabase(options: { reset?: boolean; verbose?: boolean } = {}): Promise<{
  products: number;
  playbooks: number;
  rules: number;
  users: number;
}> {
  const db = getDb();
  const log = (message: string) => {
    if (options.verbose !== false) console.log(`  ${message}`);
  };

  if (options.verbose !== false) console.log('\n▶ 初始化 DealTrack 演示数据…\n');

  // ---- Settings -----------------------------------------------------------
  setSetting(SETTING_KEYS.COMPANY, DEFAULT_COMPANY);
  setSetting(SETTING_KEYS.SALES, DEFAULT_SALES);
  setSetting(SETTING_KEYS.AUTOMATION, DEFAULT_AUTOMATION);
  seedFxRates();
  log('公司资料、销售身份、自动化策略、汇率已写入');

  // ---- Users --------------------------------------------------------------
  const users = [
    { name: '张磊', email: 'boss@nova-trading.example', role: 'owner' as const, language: 'zh', avatarColor: '#0b5cad' },
    { name: '王倩', email: 'ops@nova-trading.example', role: 'ops' as const, language: 'zh', avatarColor: '#1c7a3d' },
    { name: 'Lily Chen', email: 'lily@nova-trading.example', role: 'sales' as const, language: 'en', avatarColor: '#a75b00' },
  ];
  for (const user of users) upsertUser(user);
  log(`已创建 ${users.length} 个成员（老板 / 运营 / 销售）`);

  // ---- Products + tiers ---------------------------------------------------
  for (const product of PRODUCTS) {
    const saved = upsertProduct({
      sku: product.sku,
      nameEn: product.nameEn,
      nameZh: product.nameZh,
      category: product.category,
      descriptionEn: product.descriptionEn,
      descriptionZh: product.descriptionEn,
      unit: product.unit,
      moq: product.moq,
      hsCode: product.hsCode,
      hsDescription: product.hsDescription,
      netWeightKg: product.netWeightKg,
      grossWeightKg: product.grossWeightKg,
      cbm: product.cbm,
      certifications: product.certifications,
      targetMarkets: product.targetMarkets,
      spec: { aliases: product.aliases },
      status: 'active',
    });

    const existingTiers = db.count('SELECT COUNT(*) FROM price_tiers WHERE product_id = ?', saved.id);
    if (existingTiers === 0) {
      product.tiers.forEach(([minQty, unitCost, margin]) => {
        upsertTier({
          productId: saved.id,
          minQty,
          unitCost,
          costCurrency: 'CNY',
          marginPct: margin,
          currency: 'USD',
          incoterm: 'FOB',
          packagingCost: 1.4,
          inlandCost: 0.6,
          leadTimeDays: minQty >= 5000 ? 25 : 15,
        });
      });
    }
  }
  log(`已写入 ${PRODUCTS.length} 个产品及价格阶梯（${PRODUCTS.reduce((sum, p) => sum + p.tiers.length, 0)} 档）`);

  // ---- Pricing rules ------------------------------------------------------
  if (db.count('SELECT COUNT(*) FROM price_rules') === 0) {
    createRule({
      name: '大单毛利下调 2%',
      priority: 10,
      scope: 'line',
      condition: { field: 'qty', op: '>=', value: 1000 },
      action: { type: 'margin_delta', value: -0.02 },
    });
    createRule({
      name: '样品小单加价 4%',
      priority: 20,
      scope: 'line',
      condition: { field: 'qty', op: '<', value: 100 },
      action: { type: 'margin_delta', value: 0.04 },
    });
    createRule({
      name: '整柜免运费',
      priority: 30,
      scope: 'quote',
      condition: { field: 'totalQty', op: '>=', value: 5000 },
      action: { type: 'free_freight' },
    });
    createRule({
      name: '重点客户 2% 折扣',
      priority: 40,
      scope: 'customer',
      condition: { field: 'customerTier', op: '==', value: 'key' },
      action: { type: 'discount_pct', value: 0.02 },
    });
    createRule({
      name: '中东市场报价上浮 1.5%（认证与包装成本）',
      priority: 50,
      scope: 'quote',
      condition: { field: 'destination', op: 'in', value: ['SA', 'AE', 'EG'] },
      action: { type: 'surcharge_pct', value: 0.015 },
    });
  }
  const ruleCount = db.count('SELECT COUNT(*) FROM price_rules');
  log(`已写入 ${ruleCount} 条定价规则（阶梯毛利 / 免运费 / 客户折扣 / 市场加价）`);

  // ---- Playbooks ----------------------------------------------------------
  const allPlaybooks = [...PLAYBOOKS_EN, ...PLAYBOOKS_ZH, ...PLAYBOOKS_ES, ...PLAYBOOKS_DE];
  for (const book of allPlaybooks) {
    upsertPlaybook({
      name: book.name,
      stage: book.stage,
      language: book.language,
      channel: 'email',
      subjectTpl: book.subjectTpl,
      bodyTpl: book.bodyTpl,
      tags: book.tags,
      variables: extractVariables(`${book.subjectTpl}\n${book.bodyTpl}`),
      builtin: true,
    });
  }
  log(`已写入 ${allPlaybooks.length} 条话术模板（英/中/西/德，含价格异议拆解与沉默唤醒）`);

  setSetting(SETTING_KEYS.SEEDED, { at: nowIso(), version: 1, products: PRODUCTS.length });

  return {
    products: PRODUCTS.length,
    playbooks: allPlaybooks.length,
    rules: ruleCount,
    users: users.length,
  };
}

function extractVariables(template: string): string[] {
  const found = new Set<string>();
  for (const match of template.matchAll(/\{\{?\s*([a-z_][a-z0-9_]*)\s*\}?\}/gi)) {
    found.add(match[1]!.toLowerCase());
  }
  return [...found];
}

// ---------------------------------------------------------------------------
// Sample inquiries — six real-world inbound emails in six languages.
// ---------------------------------------------------------------------------

export const SAMPLE_INQUIRIES: Array<{
  label: string;
  fromEmail: string;
  fromName: string;
  subject: string;
  body: string;
  channel?: 'email' | 'whatsapp';
}> = [
  {
    label: '德国 · 工程照明经销商 · 询价 3000 件',
    fromEmail: 'einkauf@hellweg-lichttechnik.example',
    fromName: 'Hellweg Lichttechnik GmbH',
    subject: 'Anfrage: 3000 Stück LED Arbeitsstrahler 50W — FOB Shenzhen',
    body: `Sehr geehrte Damen und Herren,

wir sind ein Großhändler für Arbeitsbeleuchtung in Nordrhein-Westfalen und suchen einen zuverlässigen Hersteller für LED-Arbeitsstrahler.

Bitte senden Sie uns ein Angebot für:
- 3000 Stück LED Arbeitsstrahler 50W, IP65, 5000lm
- Lieferung FOB Shenzhen
- Zielhafen: Hamburg
- Wir benötigen CE und RoHS Zertifikate, bitte als PDF beilegen

Wir haben eine Zielpreisvorstellung von ca. USD 6,20 pro Stück. Bitte teilen Sie uns auch Ihre Lieferzeit mit — wir brauchen die Ware innerhalb von 20 Tagen.

Mit freundlichen Grüßen
Markus Hellweg
Hellweg Lichttechnik GmbH`,
  },
  {
    label: '西班牙 · 太阳能分销商 · 200 块组件',
    fromEmail: 'compras@solarlatina.example',
    fromName: 'SolarLatina Distribuciones',
    subject: 'Consulta: 200 paneles solares 450W — CIF Valencia',
    body: `Buenos días,

Somos distribuidores de equipos solares en la Comunidad Valenciana. Nos interesan sus paneles de 450W monocristalinos.

Necesitamos:
- 200 unidades
- 450W, half-cell PERC
- CIF Valencia
- Certificación TUV o equivalente

¿Cuál es su mejor precio y plazo de entrega? Nuestro objetivo es USD 82 por unidad.

Gracias y saludos,
Carmen Ruiz
SolarLatina`,
  },
  {
    label: '阿联酋 · 消费电子进口商 · 移动电源 + 扩展坞',
    fromEmail: 'info@gulfelectronics.example',
    fromName: 'Gulf Electronics Trading LLC',
    subject: 'RFQ — Power Banks & USB-C Hubs for Dubai market',
    body: `Dear Sales Team,

We are a consumer electronics importer based in Dubai, supplying retail chains across the GCC.

Please quote for:
1. 5,000 pcs 20000mAh Power Bank, PD 65W
2. 3,000 pcs 7-in-1 USB-C Hub

Terms: CIF Jebel Ali
We need CE and RoHS. For the power bank, we also need UN38.3 for air freight.
Target price: USD 14.50 for the power bank, USD 8.20 for the hub.

Please advise lead time. We are planning to place the order within 2 weeks — urgent.

Best regards,
Ahmed Al-Farsi
Gulf Electronics Trading LLC`,
  },
  {
    label: '巴西 · 户外用品连锁 · 露营椅',
    fromEmail: 'suprimentos@aventurabrasil.example',
    fromName: 'Aventura Brasil Comércio',
    subject: 'Cotação — 2.000 cadeiras de camping XL',
    body: `Prezados,

Somos uma rede de lojas de artigos outdoor com 45 lojas no Brasil.

Gostaríamos de cotar:
- 2.000 unidades de cadeira de camping dobrável XL, capacidade 150kg
- Condição: CIF Santos
- Precisamos de certificação INMETRO

Nosso preço-alvo é USD 26,00 por unidade. Qual o prazo de entrega?

Atenciosamente,
Rafael Mendes
Aventura Brasil`,
  },
  {
    label: '俄罗斯 · 电工器材批发 · 电机',
    fromEmail: 'zakaz@elektromash-ru.example',
    fromName: 'Elektromash Group',
    subject: 'Запрос: 500 моторов для электровелосипедов 500W',
    body: `Здравствуйте,

Мы поставляем комплектующие для электровелосипедов в России.

Интересует:
- 500 шт. мотор-втулка 48В 500Вт, 45Нм
- Условия: FOB Shenzhen
- Нужен сертификат EAC, есть ли у вас протоколы испытаний?

Целевая цена — примерно USD 46 за штуку. Срок поставки?

С уважением,
Дмитрий Волков
ООО «Электромаш Групп»`,
  },
  {
    label: '日本 · 生活杂货商社 · 保温杯（WhatsApp）',
    fromEmail: 'k.tanaka@livingworks-jp.example',
    fromName: '田中 健一',
    subject: 'WhatsApp 询价：ステンレスボトル 500ml',
    body: `お世話になっております。リビングワークス株式会社の田中です。

ステンレス製の真空断熱ボトル 500ml を探しています。

・数量：10,000個（初回）
・条件：FOB Shenzhen → 横浜港
・FDA と LFGB の証明が必要です
・ロゴのレーザー刻印をお願いしたい

目標単価は USD 4.20 です。納期とあわせてご回答いただけますか。

よろしくお願いいたします。`,
  },
];

/**
 * Close part of the demo pipeline so a fresh install shows the whole story.
 *
 * Without this the console opens on an empty 回款看板 and a funnel that stops at
 * "quoted" — which makes the newest half of the product invisible to anyone
 * evaluating it. Everything here goes through the real code paths, so the
 * resulting PI, milestones and outcomes are exactly what production produces.
 */
export async function seedDealClosure(): Promise<{
  won: string | null;
  lost: string | null;
  expired: string | null;
}> {
  const { recordOutcome, updateQuote } = await import('../core/repos/quoting.js');
  const { getPiByQuote, markMilestonePaid, dueMilestones } = await import('../core/repos/billing.js');
  const { getQueue } = await import('../core/queue.js');

  const quotes = getDb()
    .all<Row>('SELECT * FROM quotes ORDER BY created_at ASC')
    .map((row) => ({ id: String(row.id), quoteNo: String(row.quote_no) }));
  if (quotes.length === 0) return { won: null, lost: null, expired: null };

  // ---- One win, with the deposit already received --------------------------
  const winner = quotes[quotes.length - 1]!;
  recordOutcome({
    quoteId: winner.id,
    result: 'won',
    reasonNote: '客户邮件确认下单，合同条款无异议',
    decidedBy: 'user:ops',
  });

  // Let the orchestrator issue the PI and lay down the payment schedule.
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const queued = getDb().count("SELECT COUNT(*) FROM agent_tasks WHERE status IN ('queued','running')");
    if (queued === 0 && getPiByQuote(winner.id)) break;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  const pi = getPiByQuote(winner.id);
  if (pi) {
    const deposit = dueMilestones().find((entry) => entry.piId === pi.id && entry.label === 'deposit');
    if (deposit) {
      markMilestonePaid({
        id: deposit.id,
        method: 'T/T',
        note: '演示数据：定金已到账（水单号 DEMO-0001）',
      });
    }
    // Push the balance payment past due so the collection board has something to
    // chase — an empty overdue column teaches the user nothing.
    const balance = (pi.milestones ?? []).find((entry) => entry.label === 'balance');
    if (balance) {
      getDb().run(
        'UPDATE payment_milestones SET due_at = ? WHERE id = ?',
        new Date(Date.now() - 9 * 86_400_000).toISOString(),
        balance.id,
      );
    }
  }

  // ---- One loss, for the attribution board --------------------------------
  const loser = quotes.length > 1 ? quotes[quotes.length - 2]! : null;
  if (loser) {
    recordOutcome({
      quoteId: loser.id,
      result: 'lost',
      reasonCode: 'price',
      reasonNote: '客户反馈比越南供应商高 8%，砍价未达成',
      competitor: 'Vietnam supplier',
      decidedBy: 'user:sales',
    });
  }

  // ---- One lapsed quote, so the expiry sweep has material -----------------
  const lapsed = quotes.length > 2 ? quotes[2]! : null;
  if (lapsed) {
    updateQuote(lapsed.id, {
      valid_until: new Date(Date.now() - 12 * 86_400_000).toISOString(),
      status: 'sent',
    });
  }

  return { won: winner.quoteNo, lost: loser?.quoteNo ?? null, expired: lapsed?.quoteNo ?? null };
}

/** Inject the sample inquiries and run them through the real pipeline. */
export async function seedSampleInquiries(): Promise<Array<{ label: string; inquiryId: string; code: string }>> {
  const { ingestInbound } = await import('../core/ingest.js');
  const out: Array<{ label: string; inquiryId: string; code: string }> = [];
  for (const sample of SAMPLE_INQUIRIES) {
    const result = ingestInbound({
      channel: sample.channel ?? 'email',
      fromEmail: sample.channel === 'whatsapp' ? null : sample.fromEmail,
      fromPhone: sample.channel === 'whatsapp' ? '+81 90 1234 5678' : null,
      fromName: sample.fromName,
      subject: sample.subject,
      body: sample.body,
      messageId: `<seed-${uid().slice(0, 12)}@dealtrack.local>`,
      receivedAt: new Date(Date.now() - Math.floor(Math.random() * 6 + 1) * 3_600_000).toISOString(),
    });
    out.push({ label: sample.label, inquiryId: result.inquiry.id, code: result.inquiry.code });
  }
  return out;
}

export function summarize(db: Database): Record<string, number> {
  return {
    products: db.count('SELECT COUNT(*) FROM products'),
    tiers: db.count('SELECT COUNT(*) FROM price_tiers'),
    playbooks: listPlaybooks({ activeOnly: false }).length,
    rules: db.count('SELECT COUNT(*) FROM price_rules'),
    users: db.count('SELECT COUNT(*) FROM users'),
    inquiries: db.count('SELECT COUNT(*) FROM inquiries'),
    quotes: db.count('SELECT COUNT(*) FROM quotes'),
  };
}

export { config, listProducts };
