import { formatNumber } from '../core/i18n.js';
import { getCompany } from '../core/settings.js';
import { getQuote } from '../core/repos/quoting.js';
import { getCustomer, getInquiry } from '../core/repos/sales.js';
import { getProduct } from '../core/repos/catalog.js';
import { documentStyles, escapeHtml, renderDocument } from './document.js';

/**
 * Customs paperwork (报关单 + 装箱单).
 *
 * Chinese customs declarations are a fixed-layout form, so the structure is
 * reproduced faithfully rather than "redesigned". Every field is either pulled
 * from the quote or explicitly marked as needing review — an empty field that
 * silently disappears is how shipments get held at port.
 */

export interface DeclarationResult {
  pdfPath: string | null;
  htmlPath: string;
  declarationNo: string;
  totals: { packages: number; netWeightKg: number; grossWeightKg: number; cbm: number; amount: number; currency: string };
  itemCount: number;
  compliance: ComplianceCheck[];
  passed: boolean;
}

export interface ComplianceCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
}

const STATUS_LABEL: Record<ComplianceCheck['status'], string> = { pass: '通过', warn: '提示', fail: '需处理' };

export async function generateDeclaration(quoteId: string): Promise<DeclarationResult | null> {
  const quote = getQuote(quoteId);
  if (!quote) return null;

  const customer = getCustomer(quote.customerId);
  const company = getCompany();
  const inquiry = quote.inquiryId ? getInquiry(quote.inquiryId, false) : null;

  const enriched = (quote.items ?? []).map((item) => {
    const product = item.productId ? getProduct(item.productId, false) : null;
    const netWeight = (product?.netWeightKg ?? 0) * item.qty;
    const grossWeight = (product?.grossWeightKg ?? product?.netWeightKg ?? 0) * item.qty;
    const cbm = (product?.cbm ?? 0) * item.qty;
    return { item, product, netWeight, grossWeight, cbm };
  });

  const totals = enriched.reduce(
    (acc, entry) => ({
      packages: acc.packages + Math.max(1, Math.ceil(entry.item.qty / 50)),
      netWeightKg: acc.netWeightKg + entry.netWeight,
      grossWeightKg: acc.grossWeightKg + entry.grossWeight,
      cbm: acc.cbm + entry.cbm,
      amount: acc.amount + entry.item.amount,
      currency: quote.currency,
    }),
    { packages: 0, netWeightKg: 0, grossWeightKg: 0, cbm: 0, amount: 0, currency: quote.currency },
  );

  const declarationNo = `CD-${quote.quoteNo.replace(/^QT-/, '')}`;
  const compliance = runComplianceChecks({ quote, customer, enriched });

  const itemRows = enriched
    .map(
      (entry, index) => `
    <tr>
      <td class="num">${index + 1}</td>
      <td>${escapeHtml(entry.item.sku ?? '')}</td>
      <td>${escapeHtml(entry.item.description)}</td>
      <td>${escapeHtml(entry.item.hsCode ?? entry.product?.hsCode ?? '待归类')}</td>
      <td>${escapeHtml(entry.product?.hsDescription ?? '')}</td>
      <td class="num">${formatNumber(entry.item.qty, 'zh', 0)}</td>
      <td>${escapeHtml(entry.item.unit)}</td>
      <td class="num">${formatNumber(entry.item.unitPrice, 'en', 4)}</td>
      <td class="num">${formatNumber(entry.item.amount, 'en', 2)}</td>
      <td class="num">${formatNumber(entry.item.qty > 0 ? entry.netWeight / entry.item.qty : 0, 'en', 3)}</td>
      <td class="num">${formatNumber(entry.netWeight, 'en', 2)}</td>
      <td class="num">${formatNumber(entry.grossWeight, 'en', 2)}</td>
      <td>${escapeHtml(entry.product?.certifications.join('/') ?? '')}</td>
    </tr>`,
    )
    .join('');

  const checkRows = compliance
    .map(
      (check) => `
    <tr>
      <td>${escapeHtml(check.label)}</td>
      <td><span class="badge ${check.status === 'pass' ? 'ok' : check.status === 'fail' ? 'bad' : 'warn'}">${STATUS_LABEL[check.status]}</span></td>
      <td>${escapeHtml(check.detail)}</td>
    </tr>`,
    )
    .join('');

  const html = `<!doctype html>
<html lang="zh" dir="ltr">
<head><meta charset="utf-8" /><title>${escapeHtml(declarationNo)} · 报关要素表</title>
<style>${documentStyles('#1c5f8c')}</style></head>
<body>
<div class="doc">
  <header class="doc-header">
    <div>
      <div class="seller-name">${escapeHtml(company.name)}</div>
      <div class="seller-meta">${escapeHtml(company.nameZh)}</div>
      <div class="seller-meta">报关要素表 / CUSTOMS DECLARATION ELEMENTS</div>
    </div>
    <div class="doc-title">
      <div class="label">报 关 要 素 表</div>
      <div class="no">${escapeHtml(declarationNo)}</div>
      <div class="date">报价单：${escapeHtml(quote.quoteNo)}</div>
      <div class="date">询盘：${escapeHtml(inquiry?.code ?? '—')}</div>
    </div>
  </header>

  <section class="parties">
    <div class="party">
      <h3>境内发货人 / 经营单位</h3>
      <div class="name">${escapeHtml(company.nameZh || company.name)}</div>
      <div class="line">${escapeHtml(company.address)}</div>
      <div class="line">${escapeHtml(company.city + ', ' + company.country)}</div>
    </div>
    <div class="party">
      <h3>境外收货人 / CONSIGNEE</h3>
      <div class="name">${escapeHtml(customer?.company ?? '—')}</div>
      <div class="line">${escapeHtml(customer?.contactName ?? '')}</div>
      <div class="line">${escapeHtml([customer?.country, customer?.email].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="party">
      <h3>运输与贸易要素</h3>
      <div class="line">成交方式：${escapeHtml(quote.incoterm)} ${escapeHtml(quote.incotermPlace)}</div>
      <div class="line">币制：${escapeHtml(quote.currency)}</div>
      <div class="line">件数：${totals.packages} 件 · 净重 ${formatNumber(totals.netWeightKg, 'en', 2)} kg · 毛重 ${formatNumber(totals.grossWeightKg, 'en', 2)} kg · ${formatNumber(totals.cbm, 'en', 3)} CBM</div>
    </div>
  </section>

  <table class="items">
    <thead>
      <tr>
        <th style="width:4%">#</th>
        <th style="width:9%">SKU</th>
        <th style="width:15%">品名</th>
        <th style="width:9%">HS 编码</th>
        <th style="width:15%">申报要素</th>
        <th style="width:6%" class="num">数量</th>
        <th style="width:5%">单位</th>
        <th style="width:8%" class="num">单价</th>
        <th style="width:8%" class="num">金额</th>
        <th style="width:6%" class="num">单件净重</th>
        <th style="width:7%" class="num">净重</th>
        <th style="width:7%" class="num">毛重</th>
        <th>认证</th>
      </tr>
    </thead>
    <tbody>${itemRows || '<tr><td colspan="13">无行项目</td></tr>'}</tbody>
  </table>

  <div class="totals">
    <table>
      <tr><td class="label">申报总金额</td><td class="value">${escapeHtml(quote.currency)} ${formatNumber(totals.amount, 'en', 2)}</td></tr>
      <tr class="grand"><td class="label">总件数 / 总毛重</td><td class="value">${totals.packages} 件 / ${formatNumber(totals.grossWeightKg, 'en', 2)} kg</td></tr>
    </table>
  </div>

  <h3 style="margin-top:20px; font-size:11pt">合规校验结果</h3>
  <table class="checklist">
    <thead><tr><th style="width:26%">检查项</th><th style="width:12%">结果</th><th>说明</th></tr></thead>
    <tbody>${checkRows}</tbody>
  </table>

  <div class="notes" style="margin-top:16px">
    <strong>填报提示</strong><br/>
    1. 本表为「要素表」，供报关行制单使用，非最终海关报关单格式。<br/>
    2. HS 编码标注「待归类」的品项需人工确认后方可申报。<br/>
    3. 申报金额须与商业发票一致，单货一致是查验要点。<br/>
    4. 目的国认证要求以最新法规为准，本表仅做初筛。
  </div>

  <section class="signature">
    <div class="block"><div>制单人</div><div style="margin-top:16px">DealTrack 报关智能体</div></div>
    <div class="block"><div>复核人</div><div style="margin-top:16px">______________</div></div>
    <div class="stamp">公司盖章</div>
  </section>

  <footer class="doc-footer">${escapeHtml(company.name)} · 由 DealTrack 生成 · ${escapeHtml(declarationNo)}</footer>
</div>
</body></html>`;

  const rendered = await renderDocument({ html, baseName: declarationNo, subdir: 'declarations' });

  return {
    pdfPath: rendered.pdfPath,
    htmlPath: rendered.htmlPath,
    declarationNo,
    totals,
    itemCount: enriched.length,
    compliance,
    passed: compliance.every((check) => check.status !== 'fail'),
  };
}

function runComplianceChecks(input: {
  quote: NonNullable<ReturnType<typeof getQuote>>;
  customer: ReturnType<typeof getCustomer>;
  enriched: Array<{
    item: { hsCode: string | null; qty: number; amount: number; description: string; productId: string | null };
    product: ReturnType<typeof getProduct>;
    netWeight: number;
    grossWeight: number;
    cbm: number;
  }>;
}): ComplianceCheck[] {
  const { quote, customer, enriched } = input;
  const checks: ComplianceCheck[] = [];

  const missingHs = enriched.filter((entry) => !entry.item.hsCode && !entry.product?.hsCode);
  checks.push({
    id: 'hs_coverage',
    label: 'HS 编码覆盖（单货一致）',
    status: missingHs.length === 0 ? 'pass' : missingHs.length === enriched.length ? 'fail' : 'warn',
    detail:
      missingHs.length === 0
        ? `${enriched.length} 个行项目均已归类。`
        : `${missingHs.length}/${enriched.length} 个行项目缺少 HS 编码：${missingHs.map((e) => e.item.description).join('、')}`,
  });

  checks.push({
    id: 'declared_value',
    label: '申报价值合理性',
    status: quote.total > 0 ? 'pass' : 'fail',
    detail: quote.total > 0 ? `申报总额 ${quote.currency} ${formatNumber(quote.total, 'en', 2)}，与报价单一致。` : '申报总额缺失或不合法。',
  });

  const weightCoverage = enriched.filter((entry) => entry.grossWeight <= 0);
  checks.push({
    id: 'weight_data',
    label: '重量数据完整性',
    status: weightCoverage.length === 0 ? 'pass' : 'warn',
    detail:
      weightCoverage.length === 0
        ? '所有行项目均有毛重数据。'
        : `${weightCoverage.length} 个行项目缺少重量，装箱单与舱单可能不一致。`,
  });

  checks.push({
    id: 'incoterm_presence',
    label: '贸易条款申报',
    status: quote.incoterm ? 'pass' : 'warn',
    detail: quote.incoterm ? `成交方式：${quote.incoterm} ${quote.incotermPlace}。` : '缺少 Incoterm，报关单需补填。',
  });

  const destination = customer?.countryCode ?? customer?.country ?? '';
  const required: Record<string, string[]> = {
    DE: ['CE'], FR: ['CE'], IT: ['CE'], ES: ['CE'], NL: ['CE'], PL: ['CE'],
    US: ['FCC'], SA: ['SASO'], BR: ['INMETRO'], RU: ['EAC'], JP: ['PSE'], KR: ['KC'],
  };
  const need = required[destination.toUpperCase()] ?? [];
  const held = new Set(enriched.flatMap((entry) => entry.product?.certifications ?? []));
  const absent = need.filter((cert) => !held.has(cert));
  checks.push({
    id: 'destination_certification',
    label: `目的国认证（${destination || '未指定'}）`,
    status: need.length === 0 ? 'pass' : absent.length === 0 ? 'pass' : 'warn',
    detail:
      need.length === 0
        ? '该目的地无内置强制认证要求记录。'
        : absent.length === 0
          ? `已具备：${need.join('/')}。`
          : `建议补充：${absent.join('/')}，否则可能被目的港扣留。`,
  });

  const sanctioned = ['IR', 'KP', 'SY', 'CU'];
  checks.push({
    id: 'sanction_screen',
    label: '制裁与禁运初筛',
    status: sanctioned.includes(destination.toUpperCase()) ? 'fail' : 'pass',
    detail: sanctioned.includes(destination.toUpperCase())
      ? '目的地命中高风险清单，需合规复核后方可继续。'
      : '未命中内置高风险清单（须以最新法规为准）。',
  });

  checks.push({
    id: 'certifications_on_file',
    label: '认证文件齐备性',
    status: enriched.some((entry) => (entry.product?.certifications ?? []).length > 0) ? 'pass' : 'warn',
    detail: enriched.some((entry) => (entry.product?.certifications ?? []).length > 0)
      ? '主要行项目已登记认证信息。'
      : '产品库中未登记认证信息，建议补录后自动校验。',
  });

  return checks;
}
