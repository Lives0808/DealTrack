/**
 * The phrasebook.
 *
 * Every outbound artefact DealTrack produces — first replies, quote covers,
 * follow-up nudges, the quote PDF itself — is assembled from here, not from
 * hard-coded English. Agents pick the customer's language and this module makes
 * the result read like a native seller wrote it.
 *
 * Languages with a full phrasebook: en zh es fr de ru ar pt ja ko
 * Additional languages fall back to English blocks but keep their own
 * greeting/closing/subject lines, which is where most of the "that's not my
 * language" feeling comes from.
 */

export type Direction = 'ltr' | 'rtl';

export interface LanguageMeta {
  code: string;
  nativeName: string;
  englishName: string;
  direction: Direction;
  /** Intl locale used for numbers, dates and currency. */
  locale: string;
}

export interface Phrasebook {
  greeting: string;          // {name}
  greetingGeneric: string;
  closing: string;           // {sender}
  closingNoName: string;
  subject: {
    firstReply: string;      // {code}
    quote: string;           // {code}
    followup1: string;
    followup2: string;
    followup3: string;
    reengage: string;
    thankYou: string;
    payment: string;
    shipping: string;
  };
  thanksForInquiry: string;  // {company}
  introActive: string;       // {company}
  quoteReady: string;        // {code}
  priceValid: string;        // {date}
  ctaReply: string;
  ctaSample: string;
  ctaCall: string;
  questionQty: string;
  questionTarget: string;
  questionPort: string;
  questionCert: string;
  missingInfoIntro: string;
  followupNudge1: string;
  followupNudge2: string;
  followupFinal: string;
  objectionPrice: string;
  objectionLeadTime: string;
  leadTimeNote: string;      // {days}
  attachmentsNote: string;
  /** 催款：说明款项仍未到账 */
  paymentDueIntro: string;
  /** 催款：要一个具体的付款时间，而不是催逼 */
  paymentReminderCta: string;
  /** 催款：逾期天数，含 {days} */
  paymentLateNote: string;
  signatureRole: string;
  signatureCompany: string;
  signatureContact: string;
  disclaimerValidity: string;
}

export const LANGUAGES: LanguageMeta[] = [
  { code: 'en', nativeName: 'English', englishName: 'English', direction: 'ltr', locale: 'en-US' },
  { code: 'zh', nativeName: '简体中文', englishName: 'Chinese (Simplified)', direction: 'ltr', locale: 'zh-CN' },
  { code: 'es', nativeName: 'Español', englishName: 'Spanish', direction: 'ltr', locale: 'es-ES' },
  { code: 'fr', nativeName: 'Français', englishName: 'French', direction: 'ltr', locale: 'fr-FR' },
  { code: 'de', nativeName: 'Deutsch', englishName: 'German', direction: 'ltr', locale: 'de-DE' },
  { code: 'ru', nativeName: 'Русский', englishName: 'Russian', direction: 'ltr', locale: 'ru-RU' },
  { code: 'ar', nativeName: 'العربية', englishName: 'Arabic', direction: 'rtl', locale: 'ar' },
  { code: 'pt', nativeName: 'Português', englishName: 'Portuguese', direction: 'ltr', locale: 'pt-BR' },
  { code: 'ja', nativeName: '日本語', englishName: 'Japanese', direction: 'ltr', locale: 'ja-JP' },
  { code: 'ko', nativeName: '한국어', englishName: 'Korean', direction: 'ltr', locale: 'ko-KR' },
  { code: 'it', nativeName: 'Italiano', englishName: 'Italian', direction: 'ltr', locale: 'it-IT' },
  { code: 'tr', nativeName: 'Türkçe', englishName: 'Turkish', direction: 'ltr', locale: 'tr-TR' },
  { code: 'vi', nativeName: 'Tiếng Việt', englishName: 'Vietnamese', direction: 'ltr', locale: 'vi-VN' },
  { code: 'th', nativeName: 'ไทย', englishName: 'Thai', direction: 'ltr', locale: 'th-TH' },
  { code: 'id', nativeName: 'Bahasa Indonesia', englishName: 'Indonesian', direction: 'ltr', locale: 'id-ID' },
  { code: 'pl', nativeName: 'Polski', englishName: 'Polish', direction: 'ltr', locale: 'pl-PL' },
  { code: 'nl', nativeName: 'Nederlands', englishName: 'Dutch', direction: 'ltr', locale: 'nl-NL' },
];

const ENGLISH: Phrasebook = {
  greeting: 'Dear {name},',
  greetingGeneric: 'Dear Sir or Madam,',
  closing: 'Best regards,',
  closingNoName: 'Best regards,',
  subject: {
    firstReply: 'Re: Your inquiry {code} — pricing and lead time enclosed',
    quote: 'Quotation {code} — {company}',
    followup1: 'Following up on quotation {code}',
    followup2: 'Any questions on quotation {code}?',
    followup3: 'Closing the loop on quotation {code}',
    reengage: 'Still sourcing this item?',
    thankYou: 'Thank you for your order — {company}',
    payment: 'Payment reminder — invoice {code}',
    shipping: 'Shipping update — {code}',
  },
  thanksForInquiry:
    'Thank you very much for your inquiry about {company}. We appreciate the opportunity to quote.',
  introActive:
    'We are a manufacturer and exporter of {company} products, shipping to {count} markets worldwide.',
  quoteReady: 'Please find our quotation {code} attached for your review.',
  priceValid: 'The prices above are valid until {date}.',
  ctaReply: 'Could you confirm the quantity and destination port so we can lock in this price?',
  ctaSample: 'We are happy to send samples before you commit to a full order.',
  ctaCall: 'Would you be open to a short call this week to go through the details?',
  questionQty: 'Could you confirm the target quantity?',
  questionTarget: 'Do you have a target price in mind? We will do our best to meet it.',
  questionPort: 'Which destination port should we quote?',
  questionCert: 'Do you require any specific certification (CE, RoHS, FDA…)?',
  missingInfoIntro: 'To prepare an accurate quotation, we would need the following:',
  followupNudge1:
    'I wanted to make sure my previous message reached you. Our quotation is still open and we would be glad to help.',
  followupNudge2:
    'Just checking in — if anything about the specification, packing or payment terms needs adjusting, tell me and I will revise the offer.',
  followupFinal:
    'I will close this quotation for now, but we keep your specifications on file. Whenever you are ready, simply reply and we will pick it up from there.',
  objectionPrice:
    'I understand price is the deciding factor. Here is what goes into ours, and two ways we can bring the number down without cutting quality.',
  objectionLeadTime:
    'Lead time is something we can move on for you — we hold buffer stock on our best-selling lines.',
  leadTimeNote: 'Lead time is {days} days after deposit.',
  paymentDueIntro: 'According to our records, the following amount is still outstanding:',
  paymentReminderCta: 'Could you let us know when it is scheduled? If a copy of the proforma invoice or a revised payment schedule would help, tell me and I will send it right away.',
  paymentLateNote: '{days} days have passed since the original due date.',
  attachmentsNote: 'Attached: quotation and specification sheet.',
  signatureRole: 'Sales Manager',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: 'This quotation is subject to our final confirmation. Prices exclude bank charges.',
};

const CHINESE: Phrasebook = {
  greeting: '{name} 您好，',
  greetingGeneric: '您好，',
  closing: '顺祝商祺，',
  closingNoName: '顺祝商祺，',
  subject: {
    firstReply: '回复：您的询盘 {code} —— 报价与交期已附上',
    quote: '报价单 {code} —— {company}',
    followup1: '关于报价单 {code} 的跟进',
    followup2: '关于报价单 {code}，有任何疑问吗？',
    followup3: '关于报价单 {code} 的最后确认',
    reengage: '这款产品还在采购吗？',
    thankYou: '感谢您的订单 —— {company}',
    payment: '付款提醒 —— 单号 {code}',
    shipping: '出货进度更新 —— {code}',
  },
  thanksForInquiry: '非常感谢您就 {company} 发来的询盘，我们很荣幸能为您报价。',
  introActive: '我们是 {company} 类产品的生产商与出口商，产品销往全球 {count} 个市场。',
  quoteReady: '随函附上我们的报价单 {code}，请您查阅。',
  priceValid: '以上价格有效期至 {date}。',
  ctaReply: '能否确认数量与目的港，以便我们为您锁定该价格？',
  ctaSample: '在您下正式订单之前，我们可以先寄样品供您确认。',
  ctaCall: '这周方便安排一个简短的通话，把细节过一遍吗？',
  questionQty: '能否确认您需要的目标数量？',
  questionTarget: '您心里是否有目标价？我们会尽力配合。',
  questionPort: '请问报价按哪个目的港计算？',
  questionCert: '您是否需要特定的认证（CE、RoHS、FDA 等）？',
  missingInfoIntro: '为了给您准确的报价，我们还需要以下信息：',
  followupNudge1: '想确认一下之前的消息您是否收到。我们的报价仍然有效，随时可以为您服务。',
  followupNudge2: '简单跟进一下——如果规格、包装或付款方式需要调整，告诉我，我来改报价。',
  followupFinal: '这份报价我先暂时关闭，但您的规格我们会留存。等您准备好，回复一声我们就接着推进。',
  objectionPrice: '理解价格是关键因素。我先说明我们的成本构成，并给出两个在不降质量前提下把价格做下来的方法。',
  objectionLeadTime: '交期是可以想办法的——我们的热销款备有缓冲库存。',
  leadTimeNote: '定金到账后 {days} 天交货。',
  paymentDueIntro: '根据我们的记录，以下款项仍未到账：',
  paymentReminderCta: '方便告诉我预计的付款时间吗？如果需要形式发票副本或调整后的付款计划，告诉我，我马上发过去。',
  paymentLateNote: '距离原定付款日已过去 {days} 天。',
  attachmentsNote: '附件：报价单与规格表。',
  signatureRole: '销售经理',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: '本报价以我方最终确认为准，价格不含银行手续费。',
};

const SPANISH: Phrasebook = {
  greeting: 'Estimado/a {name}:',
  greetingGeneric: 'Estimados señores:',
  closing: 'Reciba un cordial saludo,',
  closingNoName: 'Reciba un cordial saludo,',
  subject: {
    firstReply: 'Re: Su consulta {code} — precios y plazo de entrega',
    quote: 'Cotización {code} — {company}',
    followup1: 'Seguimiento de la cotización {code}',
    followup2: '¿Alguna duda sobre la cotización {code}?',
    followup3: 'Cierre de la cotización {code}',
    reengage: '¿Sigue buscando este producto?',
    thankYou: 'Gracias por su pedido — {company}',
    payment: 'Recordatorio de pago — factura {code}',
    shipping: 'Actualización de envío — {code}',
  },
  thanksForInquiry:
    'Muchas gracias por su consulta sobre {company}. Agradecemos la oportunidad de enviarle nuestra oferta.',
  introActive:
    'Somos fabricantes y exportadores de productos {company}, con envíos a {count} mercados en todo el mundo.',
  quoteReady: 'Adjunto encontrará nuestra cotización {code} para su revisión.',
  priceValid: 'Los precios indicados son válidos hasta el {date}.',
  ctaReply: '¿Podría confirmar la cantidad y el puerto de destino para fijar este precio?',
  ctaSample: 'Con gusto le enviamos muestras antes de que confirme el pedido completo.',
  ctaCall: '¿Le vendría bien una breve llamada esta semana para revisar los detalles?',
  questionQty: '¿Podría confirmar la cantidad objetivo?',
  questionTarget: '¿Tiene un precio objetivo en mente? Haremos lo posible por alcanzarlo.',
  questionPort: '¿A qué puerto de destino debemos cotizar?',
  questionCert: '¿Necesita alguna certificación específica (CE, RoHS, FDA…)?',
  missingInfoIntro: 'Para preparar una cotización precisa necesitaríamos lo siguiente:',
  followupNudge1:
    'Quería asegurarme de que recibió mi mensaje anterior. Nuestra cotización sigue vigente y estaremos encantados de ayudarle.',
  followupNudge2:
    'Le escribo de nuevo: si hay que ajustar la especificación, el embalaje o las condiciones de pago, dígamelo y reviso la oferta.',
  followupFinal:
    'Por ahora cierro esta cotización, pero conservamos sus especificaciones. Cuando esté listo, responda y retomamos el tema.',
  objectionPrice:
    'Entiendo que el precio es decisivo. Le explico en qué se basa el nuestro y dos formas de bajarlo sin sacrificar calidad.',
  objectionLeadTime:
    'El plazo de entrega sí podemos ajustarlo: mantenemos stock de reserva en nuestras líneas más vendidas.',
  leadTimeNote: 'El plazo de entrega es de {days} días tras el depósito.',
  paymentDueIntro: 'Según nuestros registros, el siguiente importe sigue pendiente:',
  paymentReminderCta: '¿Podría indicarnos cuándo está previsto el pago? Si le viene bien una copia de la factura proforma o un calendario de pagos revisado, dígamelo y se lo envío ahora mismo.',
  paymentLateNote: 'Han transcurrido {days} días desde la fecha de vencimiento original.',
  attachmentsNote: 'Adjuntos: cotización y ficha técnica.',
  signatureRole: 'Gerente de Ventas',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: 'Esta cotización está sujeta a nuestra confirmación final. Los precios no incluyen comisiones bancarias.',
};

const FRENCH: Phrasebook = {
  greeting: 'Bonjour {name},',
  greetingGeneric: 'Madame, Monsieur,',
  closing: 'Cordialement,',
  closingNoName: 'Cordialement,',
  subject: {
    firstReply: 'Re: Votre demande {code} — tarifs et délai de livraison',
    quote: 'Devis {code} — {company}',
    followup1: 'Relance concernant le devis {code}',
    followup2: 'Des questions sur le devis {code} ?',
    followup3: 'Clôture du devis {code}',
    reengage: 'Vous cherchez toujours ce produit ?',
    thankYou: 'Merci pour votre commande — {company}',
    payment: 'Rappel de paiement — facture {code}',
    shipping: 'Suivi d’expédition — {code}',
  },
  thanksForInquiry:
    'Merci beaucoup pour votre demande concernant {company}. Nous vous remercions de nous donner l’occasion de vous faire une offre.',
  introActive:
    'Nous sommes fabricant et exportateur de produits {company}, présents sur {count} marchés dans le monde.',
  quoteReady: 'Veuillez trouver ci-joint notre devis {code} pour votre examen.',
  priceValid: 'Les prix ci-dessus sont valables jusqu’au {date}.',
  ctaReply: 'Pourriez-vous confirmer la quantité et le port de destination afin que nous bloquions ce prix ?',
  ctaSample: 'Nous pouvons volontiers vous envoyer des échantillons avant toute commande ferme.',
  ctaCall: 'Seriez-vous disponible pour un court appel cette semaine afin de revoir les détails ?',
  questionQty: 'Pourriez-vous confirmer la quantité souhaitée ?',
  questionTarget: 'Avez-vous un prix cible en tête ? Nous ferons de notre mieux pour l’atteindre.',
  questionPort: 'Quel port de destination devons-nous prendre en compte ?',
  questionCert: 'Avez-vous besoin d’une certification particulière (CE, RoHS, FDA…) ?',
  missingInfoIntro: 'Pour établir un devis précis, il nous faudrait les éléments suivants :',
  followupNudge1:
    'Je voulais m’assurer que mon précédent message vous est bien parvenu. Notre devis reste valable et nous restons à votre disposition.',
  followupNudge2:
    'Petit rappel : si la spécification, l’emballage ou les conditions de paiement doivent être ajustés, dites-le moi et je révise l’offre.',
  followupFinal:
    'Je clos ce devis pour l’instant, mais nous conservons vos spécifications. Dès que vous êtes prêt, répondez et nous reprenons.',
  objectionPrice:
    'Je comprends que le prix soit déterminant. Voici comment il se compose, et deux façons de le réduire sans sacrifier la qualité.',
  objectionLeadTime:
    'Le délai de livraison est ajustable : nous gardons du stock tampon sur nos références les plus vendues.',
  leadTimeNote: 'Le délai de livraison est de {days} jours après l’acompte.',
  paymentDueIntro: 'Selon nos relevés, le montant suivant reste impayé :',
  paymentReminderCta: 'Pourriez-vous nous indiquer la date de paiement prévue ? Si une copie de la facture proforma ou un échéancier révisé vous aide, dites-le moi et je vous l’envoie immédiatement.',
  paymentLateNote: '{days} jours se sont écoulés depuis la date d’échéance initiale.',
  attachmentsNote: 'Pièces jointes : devis et fiche technique.',
  signatureRole: 'Responsable des ventes',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: 'Ce devis est soumis à notre confirmation finale. Les prix excluent les frais bancaires.',
};

const GERMAN: Phrasebook = {
  greeting: 'Sehr geehrte/r {name},',
  greetingGeneric: 'Sehr geehrte Damen und Herren,',
  closing: 'Mit freundlichen Grüßen',
  closingNoName: 'Mit freundlichen Grüßen',
  subject: {
    firstReply: 'Re: Ihre Anfrage {code} — Preise und Lieferzeit',
    quote: 'Angebot {code} — {company}',
    followup1: 'Nachfrage zum Angebot {code}',
    followup2: 'Fragen zum Angebot {code}?',
    followup3: 'Abschluss zum Angebot {code}',
    reengage: 'Suchen Sie diesen Artikel noch?',
    thankYou: 'Vielen Dank für Ihre Bestellung — {company}',
    payment: 'Zahlungserinnerung — Rechnung {code}',
    shipping: 'Versandupdate — {code}',
  },
  thanksForInquiry:
    'Vielen Dank für Ihre Anfrage zu {company}. Wir freuen uns über die Gelegenheit, Ihnen ein Angebot zu unterbreiten.',
  introActive:
    'Wir sind Hersteller und Exporteur von {company}-Produkten und beliefern {count} Märkte weltweit.',
  quoteReady: 'Anbei erhalten Sie unser Angebot {code} zur Prüfung.',
  priceValid: 'Die genannten Preise sind gültig bis zum {date}.',
  ctaReply: 'Könnten Sie Menge und Zielhafen bestätigen, damit wir diesen Preis festhalten können?',
  ctaSample: 'Gerne senden wir Ihnen Muster, bevor Sie eine vollständige Bestellung aufgeben.',
  ctaCall: 'Wären Sie diese Woche für ein kurzes Telefonat offen, um die Details durchzugehen?',
  questionQty: 'Könnten Sie die Zielmenge bestätigen?',
  questionTarget: 'Haben Sie einen Zielpreis im Kopf? Wir werden unser Bestes geben, ihn zu erreichen.',
  questionPort: 'Für welchen Zielhafen sollen wir kalkulieren?',
  questionCert: 'Benötigen Sie eine bestimmte Zertifizierung (CE, RoHS, FDA …)?',
  missingInfoIntro: 'Für ein präzises Angebot benötigen wir noch folgende Angaben:',
  followupNudge1:
    'Ich wollte sicherstellen, dass meine vorherige Nachricht Sie erreicht hat. Unser Angebot ist weiterhin gültig und wir helfen gerne.',
  followupNudge2:
    'Kurze Nachfrage: Wenn Spezifikation, Verpackung oder Zahlungsbedingungen angepasst werden müssen, sagen Sie Bescheid und ich überarbeite das Angebot.',
  followupFinal:
    'Ich schließe dieses Angebot vorerst, Ihre Spezifikationen bleiben jedoch hinterlegt. Sobald Sie bereit sind, antworten Sie einfach und wir machen weiter.',
  objectionPrice:
    'Ich verstehe, dass der Preis entscheidend ist. Hier ist, wie er sich zusammensetzt — und zwei Wege, ihn ohne Qualitätsverlust zu senken.',
  objectionLeadTime:
    'Bei der Lieferzeit ist etwas möglich: Für unsere Bestseller halten wir Pufferbestand vor.',
  leadTimeNote: 'Die Lieferzeit beträgt {days} Tage nach Anzahlung.',
  paymentDueIntro: 'Nach unseren Unterlagen ist der folgende Betrag noch offen:',
  paymentReminderCta: 'Könnten Sie uns mitteilen, wann die Zahlung geplant ist? Wenn Ihnen eine Kopie der Proformarechnung oder ein angepasster Zahlungsplan hilft, sagen Sie Bescheid — ich sende ihn sofort.',
  paymentLateNote: 'Seit dem ursprünglichen Fälligkeitsdatum sind {days} Tage vergangen.',
  attachmentsNote: 'Anlagen: Angebot und Datenblatt.',
  signatureRole: 'Vertriebsleiter',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: 'Dieses Angebot gilt vorbehaltlich unserer endgültigen Bestätigung. Preise ohne Bankgebühren.',
};

const RUSSIAN: Phrasebook = {
  greeting: 'Здравствуйте, {name}!',
  greetingGeneric: 'Здравствуйте!',
  closing: 'С уважением,',
  closingNoName: 'С уважением,',
  subject: {
    firstReply: 'Re: Ваш запрос {code} — цены и срок поставки',
    quote: 'Коммерческое предложение {code} — {company}',
    followup1: 'Напоминание по предложению {code}',
    followup2: 'Есть вопросы по предложению {code}?',
    followup3: 'Закрываем предложение {code}',
    reengage: 'Всё ещё интересуетесь этим товаром?',
    thankYou: 'Спасибо за заказ — {company}',
    payment: 'Напоминание об оплате — счёт {code}',
    shipping: 'Обновление по отгрузке — {code}',
  },
  thanksForInquiry:
    'Большое спасибо за ваш запрос по {company}. Благодарим за возможность подготовить предложение.',
  introActive:
    'Мы производитель и экспортёр продукции {company}, поставляем на {count} рынков мира.',
  quoteReady: 'Во вложении наше коммерческое предложение {code} для ознакомления.',
  priceValid: 'Указанные цены действительны до {date}.',
  ctaReply: 'Подтвердите, пожалуйста, количество и порт назначения, чтобы мы зафиксировали цену.',
  ctaSample: 'Мы готовы отправить образцы до размещения полного заказа.',
  ctaCall: 'Удобно ли вам будет коротко созвониться на этой неделе и обсудить детали?',
  questionQty: 'Подскажите, пожалуйста, нужное количество.',
  questionTarget: 'Есть ли у вас целевая цена? Мы постараемся её достичь.',
  questionPort: 'На какой порт назначения рассчитывать цену?',
  questionCert: 'Нужна ли конкретная сертификация (CE, RoHS, FDA…)?',
  missingInfoIntro: 'Для точного расчёта нам потребуется следующая информация:',
  followupNudge1:
    'Хочу убедиться, что предыдущее письмо дошло. Наше предложение по-прежнему в силе, будем рады помочь.',
  followupNudge2:
    'Небольшое напоминание: если нужно скорректировать спецификацию, упаковку или условия оплаты — напишите, и я пересчитаю предложение.',
  followupFinal:
    'Пока закрываю это предложение, но ваши спецификации у нас сохранены. Как только будете готовы — ответьте, и мы продолжим.',
  objectionPrice:
    'Понимаю, что цена — решающий фактор. Вот из чего она складывается, и два способа снизить её без потери качества.',
  objectionLeadTime:
    'Со сроками поставки мы можем поработать: по самым продаваемым позициям у нас есть запас.',
  leadTimeNote: 'Срок поставки — {days} дней после предоплаты.',
  paymentDueIntro: 'По нашим данным, следующая сумма ещё не поступила:',
  paymentReminderCta: 'Подскажите, пожалуйста, когда планируется оплата? Если поможет копия проформы-счёта или скорректированный график платежей — напишите, отправлю сразу.',
  paymentLateNote: 'С первоначальной даты оплаты прошло {days} дней.',
  attachmentsNote: 'Во вложении: предложение и спецификация.',
  signatureRole: 'Руководитель отдела продаж',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: 'Предложение подлежит нашему окончательному подтверждению. Цены без учёта банковских комиссий.',
};

const ARABIC: Phrasebook = {
  greeting: 'عزيزي {name}،',
  greetingGeneric: 'السادة المحترمين،',
  closing: 'مع أطيب التحيات،',
  closingNoName: 'مع أطيب التحيات،',
  subject: {
    firstReply: 'ردًا على استفساركم {code} — الأسعار ومدة التسليم',
    quote: 'عرض سعر {code} — {company}',
    followup1: 'متابعة بخصوص عرض السعر {code}',
    followup2: 'هل لديكم أي استفسار حول عرض السعر {code}؟',
    followup3: 'إغلاق عرض السعر {code}',
    reengage: 'هل ما زلتم تبحثون عن هذا المنتج؟',
    thankYou: 'شكرًا لطلبكم — {company}',
    payment: 'تذكير بالدفع — فاتورة {code}',
    shipping: 'تحديث الشحن — {code}',
  },
  thanksForInquiry:
    'شكرًا جزيلًا على استفساركم بخصوص {company}. نقدّر هذه الفرصة لتقديم عرض السعر.',
  introActive:
    'نحن مُصنّع ومُصدّر لمنتجات {company}، ونشحن إلى {count} سوقًا حول العالم.',
  quoteReady: 'تجدون مرفقًا عرض السعر {code} للاطلاع.',
  priceValid: 'الأسعار المذكورة أعلاه سارية حتى {date}.',
  ctaReply: 'هل يمكنكم تأكيد الكمية وميناء الوصول لنثبّت هذا السعر؟',
  ctaSample: 'يسعدنا إرسال عينات قبل تأكيد الطلب الكامل.',
  ctaCall: 'هل يناسبكم اتصال قصير هذا الأسبوع لمناقشة التفاصيل؟',
  questionQty: 'هل يمكنكم تأكيد الكمية المطلوبة؟',
  questionTarget: 'هل لديكم سعر مستهدف؟ سنبذل جهدنا للوصول إليه.',
  questionPort: 'ما ميناء الوصول الذي نُسعّر على أساسه؟',
  questionCert: 'هل تحتاجون إلى شهادة محددة (CE، RoHS، FDA…)؟',
  missingInfoIntro: 'لإعداد عرض سعر دقيق، نحتاج إلى المعلومات التالية:',
  followupNudge1:
    'أردت التأكد من وصول رسالتي السابقة. عرض السعر لا يزال ساريًا ويسعدنا خدمتكم.',
  followupNudge2:
    'متابعة سريعة: إن كان هناك ما يحتاج تعديلًا في المواصفات أو التغليف أو شروط الدفع، أخبرونا وسأعدّل العرض.',
  followupFinal:
    'سأغلق هذا العرض مؤقتًا، لكننا نحتفظ بمواصفاتكم. عندما تكونون جاهزين، ردّوا وسنكمل من حيث توقفنا.',
  objectionPrice:
    'أتفهم أن السعر هو العامل الحاسم. إليكم كيف يتكوّن سعرنا، وطريقتين لتخفيضه دون المساس بالجودة.',
  objectionLeadTime:
    'مدة التسليم قابلة للتحسين: نحتفظ بمخزون احتياطي من أكثر منتجاتنا مبيعًا.',
  leadTimeNote: 'مدة التسليم {days} يومًا بعد الدفعة المقدمة.',
  paymentDueIntro: 'وفقًا لسجلاتنا، لا يزال المبلغ التالي مستحقًا:',
  paymentReminderCta: 'هل يمكنكم إخبارنا بالموعد المتوقع للدفع؟ إذا كان إرسال نسخة من الفاتورة المبدئية أو جدول دفع معدّل مفيدًا، أخبروني وسأرسله فورًا.',
  paymentLateNote: 'مضى {days} يومًا على تاريخ الاستحقاق الأصلي.',
  attachmentsNote: 'المرفقات: عرض السعر وورقة المواصفات.',
  signatureRole: 'مدير المبيعات',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: 'هذا العرض خاضع لتأكيدنا النهائي. الأسعار لا تشمل مصاريف البنك.',
};

const PORTUGUESE: Phrasebook = {
  greeting: 'Prezado(a) {name},',
  greetingGeneric: 'Prezados senhores,',
  closing: 'Atenciosamente,',
  closingNoName: 'Atenciosamente,',
  subject: {
    firstReply: 'Re: Sua consulta {code} — preços e prazo de entrega',
    quote: 'Cotação {code} — {company}',
    followup1: 'Acompanhamento da cotação {code}',
    followup2: 'Alguma dúvida sobre a cotação {code}?',
    followup3: 'Encerramento da cotação {code}',
    reengage: 'Ainda está buscando este produto?',
    thankYou: 'Obrigado pelo seu pedido — {company}',
    payment: 'Lembrete de pagamento — fatura {code}',
    shipping: 'Atualização de envio — {code}',
  },
  thanksForInquiry:
    'Muito obrigado pela sua consulta sobre {company}. Agradecemos a oportunidade de enviar nossa proposta.',
  introActive:
    'Somos fabricante e exportador de produtos {company}, atendendo {count} mercados no mundo.',
  quoteReady: 'Segue em anexo a nossa cotação {code} para sua análise.',
  priceValid: 'Os preços acima são válidos até {date}.',
  ctaReply: 'Poderia confirmar a quantidade e o porto de destino para fixarmos este preço?',
  ctaSample: 'Teremos prazer em enviar amostras antes de um pedido completo.',
  ctaCall: 'Podemos agendar uma breve chamada esta semana para revisar os detalhes?',
  questionQty: 'Poderia confirmar a quantidade desejada?',
  questionTarget: 'Você tem um preço-alvo em mente? Faremos o possível para alcançá-lo.',
  questionPort: 'Para qual porto de destino devemos cotar?',
  questionCert: 'Precisa de alguma certificação específica (CE, RoHS, FDA…)?',
  missingInfoIntro: 'Para preparar uma cotação precisa, precisaríamos do seguinte:',
  followupNudge1:
    'Queria confirmar se minha mensagem anterior chegou. Nossa cotação continua válida e teremos prazer em ajudar.',
  followupNudge2:
    'Só passando para lembrar: se algo na especificação, embalagem ou condições de pagamento precisar de ajuste, me avise que eu reviso a proposta.',
  followupFinal:
    'Vou encerrar esta cotação por ora, mas mantemos suas especificações em arquivo. Quando estiver pronto, basta responder que retomamos.',
  objectionPrice:
    'Entendo que o preço é decisivo. Veja como ele é composto e duas formas de reduzi-lo sem abrir mão da qualidade.',
  objectionLeadTime:
    'O prazo de entrega é negociável: mantemos estoque de segurança nas linhas mais vendidas.',
  leadTimeNote: 'O prazo de entrega é de {days} dias após o depósito.',
  paymentDueIntro: 'Segundo os nossos registos, o seguinte valor continua em aberto:',
  paymentReminderCta: 'Pode indicar-nos quando está previsto o pagamento? Se uma cópia da fatura proforma ou um plano de pagamento revisto ajudar, diga-me e envio de imediato.',
  paymentLateNote: 'Passaram {days} dias desde a data de vencimento original.',
  attachmentsNote: 'Anexos: cotação e ficha técnica.',
  signatureRole: 'Gerente de Vendas',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: 'Esta cotação está sujeita à nossa confirmação final. Preços sem taxas bancárias.',
};

const JAPANESE: Phrasebook = {
  greeting: '{name} 様',
  greetingGeneric: 'ご担当者様',
  closing: 'よろしくお願いいたします。',
  closingNoName: 'よろしくお願いいたします。',
  subject: {
    firstReply: 'Re: お問い合わせ {code} — 価格と納期について',
    quote: 'お見積書 {code} — {company}',
    followup1: 'お見積書 {code} のご確認',
    followup2: 'お見積書 {code} についてご質問はありますか',
    followup3: 'お見積書 {code} の最終確認',
    reengage: 'こちらの商品はまだお探しですか',
    thankYou: 'ご発注ありがとうございます — {company}',
    payment: 'お支払いのご案内 — {code}',
    shipping: '出荷状況のご連絡 — {code}',
  },
  thanksForInquiry:
    '{company} についてお問い合わせいただき、誠にありがとうございます。お見積りをご提案できる機会をいただき感謝申し上げます。',
  introActive:
    '弊社は {company} 製品のメーカー兼輸出商社で、世界 {count} の市場へ出荷しております。',
  quoteReady: 'お見積書 {code} を添付いたしますので、ご確認ください。',
  priceValid: '上記の価格は {date} まで有効です。',
  ctaReply: '数量と仕向港をご確認いただけますか。この価格を確保いたします。',
  ctaSample: '本発注の前に、サンプルをお送りすることも可能です。',
  ctaCall: '今週、簡単にお電話で詳細をご確認いただくことは可能でしょうか。',
  questionQty: 'ご希望の数量をご確認いただけますか。',
  questionTarget: 'ご希望の目標価格はございますか。できる限り対応いたします。',
  questionPort: 'どちらの仕向港でのお見積りをご希望ですか。',
  questionCert: '特定の認証（CE、RoHS、FDA など）は必要ですか。',
  missingInfoIntro: '正確なお見積りのため、以下をお知らせください。',
  followupNudge1:
    '先日のご連絡が届いているか確認させてください。お見積りは引き続き有効です。',
  followupNudge2:
    'ご確認ください。仕様・梱包・お支払い条件で調整が必要でしたらお知らせください。すぐに再計算いたします。',
  followupFinal:
    'いったんこのお見積りは保留とさせていただきますが、仕様は保管しております。ご準備が整いましたらご返信ください。',
  objectionPrice:
    '価格が重要であることは承知しております。弊社価格の内訳と、品質を落とさずに下げる2つの方法をご説明します。',
  objectionLeadTime:
    '納期は調整可能です。売れ筋商品は緩衝在庫を確保しております。',
  leadTimeNote: '納期はご入金後 {days} 日です。',
  paymentDueIntro: '弊社の記録では、以下の金額がまだお支払いいただいておりません：',
  paymentReminderCta: 'お支払いのご予定をお知らせいただけますか。プロフォーマインボイスの写しや支払スケジュールの再調整が必要でしたら、お申し付けください。すぐにお送りいたします。',
  paymentLateNote: '当初の支払期日から {days} 日が経過しております。',
  attachmentsNote: '添付：お見積書、仕様書。',
  signatureRole: '営業部長',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: '本見積は最終確認をもって確定となります。価格に銀行手数料は含まれません。',
};

const KOREAN: Phrasebook = {
  greeting: '{name} 님께,',
  greetingGeneric: '담당자님께,',
  closing: '감사합니다.',
  closingNoName: '감사합니다.',
  subject: {
    firstReply: 'Re: 문의 {code} — 가격 및 납기 안내',
    quote: '견적서 {code} — {company}',
    followup1: '견적서 {code} 관련 후속 안내',
    followup2: '견적서 {code}에 대해 궁금한 점이 있으신가요?',
    followup3: '견적서 {code} 최종 확인',
    reengage: '이 제품을 아직 찾고 계신가요?',
    thankYou: '주문해 주셔서 감사합니다 — {company}',
    payment: '결제 안내 — {code}',
    shipping: '선적 진행 상황 — {code}',
  },
  thanksForInquiry:
    '{company}에 대해 문의해 주셔서 진심으로 감사합니다. 견적을 제안할 기회를 주셔서 감사드립니다.',
  introActive:
    '저희는 {company} 제품의 제조사이자 수출업체로, 전 세계 {count}개 시장에 납품하고 있습니다.',
  quoteReady: '견적서 {code}를 첨부드리니 검토 부탁드립니다.',
  priceValid: '위 가격은 {date}까지 유효합니다.',
  ctaReply: '수량과 도착 항구를 확인해 주시면 이 가격으로 확정해 드리겠습니다.',
  ctaSample: '정식 주문 전에 샘플을 보내드릴 수 있습니다.',
  ctaCall: '이번 주에 짧게 통화로 세부 사항을 확인하실 수 있을까요?',
  questionQty: '희망 수량을 확인해 주시겠어요?',
  questionTarget: '목표 가격이 있으신가요? 최대한 맞춰 드리겠습니다.',
  questionPort: '어느 도착 항구 기준으로 견적을 드리면 될까요?',
  questionCert: '특정 인증(CE, RoHS, FDA 등)이 필요하신가요?',
  missingInfoIntro: '정확한 견적을 위해 아래 정보가 필요합니다.',
  followupNudge1:
    '앞서 보낸 메일이 잘 도착했는지 확인드립니다. 견적은 여전히 유효하며 기꺼이 도와드리겠습니다.',
  followupNudge2:
    '간단히 다시 연락드립니다. 사양, 포장, 결제 조건 중 조정이 필요하시면 알려주세요. 바로 수정해 드리겠습니다.',
  followupFinal:
    '우선 이 견적은 보류하겠습니다. 사양은 보관해 두었으니 준비되시면 회신 주세요. 바로 이어서 진행하겠습니다.',
  objectionPrice:
    '가격이 결정적이라는 점 잘 알고 있습니다. 저희 가격 구성과, 품질을 낮추지 않고 가격을 낮추는 두 가지 방법을 설명드리겠습니다.',
  objectionLeadTime:
    '납기는 조정 가능합니다. 가장 잘 팔리는 제품은 완충 재고를 보유하고 있습니다.',
  leadTimeNote: '납기는 입금 후 {days}일입니다.',
  paymentDueIntro: '저희 기록상 아래 금액이 아직 미결제 상태입니다:',
  paymentReminderCta: '결제 예정일을 알려 주실 수 있을까요? 견적송장 사본이나 조정된 결제 일정이 필요하시면 말씀해 주세요. 바로 보내드리겠습니다.',
  paymentLateNote: '원래 납부 기한으로부터 {days}일이 지났습니다.',
  attachmentsNote: '첨부: 견적서 및 사양서.',
  signatureRole: '영업 이사',
  signatureCompany: '',
  signatureContact: '',
  disclaimerValidity: '본 견적은 당사 최종 확인을 조건으로 합니다. 가격에 은행 수수료는 포함되지 않습니다.',
};

/** Partial books: own greeting/closing/subject, English body blocks. */
const PARTIAL: Record<string, Partial<Phrasebook>> = {
  it: {
    greeting: 'Gentile {name},',
    greetingGeneric: 'Gentili Signori,',
    closing: 'Cordiali saluti,',
    closingNoName: 'Cordiali saluti,',
    subject: {
      firstReply: 'Re: La vostra richiesta {code} — prezzi e tempi di consegna',
      quote: 'Offerta {code} — {company}',
      followup1: 'Sollecito sull’offerta {code}',
      followup2: 'Domande sull’offerta {code}?',
      followup3: 'Chiusura dell’offerta {code}',
      reengage: 'State ancora cercando questo prodotto?',
      thankYou: 'Grazie per il vostro ordine — {company}',
      payment: 'Promemoria di pagamento — fattura {code}',
      shipping: 'Aggiornamento spedizione — {code}',
    },
    thanksForInquiry:
      'Grazie mille per la vostra richiesta su {company}. Apprezziamo l’opportunità di inviarvi un’offerta.',
    quoteReady: 'In allegato trovate la nostra offerta {code} per la vostra valutazione.',
    priceValid: 'I prezzi sopra indicati sono validi fino al {date}.',
    ctaReply: 'Potreste confermare quantità e porto di destinazione così blocchiamo questo prezzo?',
  },
  tr: {
    greeting: 'Sayın {name},',
    greetingGeneric: 'Sayın Yetkili,',
    closing: 'Saygılarımla,',
    closingNoName: 'Saygılarımla,',
    subject: {
      firstReply: 'Re: {code} numaralı talebiniz — fiyat ve teslim süresi',
      quote: 'Teklif {code} — {company}',
      followup1: '{code} numaralı teklif hakkında',
      followup2: '{code} numaralı teklifle ilgili sorunuz var mı?',
      followup3: '{code} numaralı teklifin kapanışı',
      reengage: 'Bu ürünü hâlâ arıyor musunuz?',
      thankYou: 'Siparişiniz için teşekkürler — {company}',
      payment: 'Ödeme hatırlatması — {code}',
      shipping: 'Sevkiyat güncellemesi — {code}',
    },
    thanksForInquiry:
      '{company} ile ilgili talebiniz için çok teşekkür ederiz. Teklif verme fırsatı verdiğiniz için minnettarız.',
    quoteReady: 'İncelemeniz için {code} numaralı teklifimizi ekte bulabilirsiniz.',
    priceValid: 'Yukarıdaki fiyatlar {date} tarihine kadar geçerlidir.',
    ctaReply: 'Bu fiyatı sabitleyebilmemiz için miktarı ve varış limanını teyit edebilir misiniz?',
  } as Partial<Phrasebook>,
  vi: {
    greeting: 'Kính gửi ông/bà {name},',
    greetingGeneric: 'Kính gửi Quý khách,',
    closing: 'Trân trọng,',
    closingNoName: 'Trân trọng,',
    subject: {
      firstReply: 'Re: Yêu cầu {code} của Quý khách — giá và thời gian giao hàng',
      quote: 'Báo giá {code} — {company}',
      followup1: 'Theo dõi báo giá {code}',
      followup2: 'Quý khách có thắc mắc về báo giá {code} không?',
      followup3: 'Kết thúc báo giá {code}',
      reengage: 'Quý khách vẫn đang tìm sản phẩm này chứ?',
      thankYou: 'Cảm ơn Quý khách đã đặt hàng — {company}',
      payment: 'Nhắc nhở thanh toán — {code}',
      shipping: 'Cập nhật vận chuyển — {code}',
    },
    thanksForInquiry:
      'Cảm ơn Quý khách đã gửi yêu cầu về {company}. Chúng tôi trân trọng cơ hội được báo giá.',
    quoteReady: 'Chúng tôi gửi kèm báo giá {code} để Quý khách xem xét.',
    priceValid: 'Giá trên có hiệu lực đến {date}.',
    ctaReply: 'Quý khách có thể xác nhận số lượng và cảng đến để chúng tôi chốt giá này không?',
  } as Partial<Phrasebook>,
  th: {
    greeting: 'เรียน คุณ{name}',
    greetingGeneric: 'เรียน ท่านผู้เกี่ยวข้อง',
    closing: 'ขอแสดงความนับถือ',
    closingNoName: 'ขอแสดงความนับถือ',
    subject: {
      firstReply: 'Re: คำถามของคุณ {code} — ราคาและระยะเวลาจัดส่ง',
      quote: 'ใบเสนอราคา {code} — {company}',
      followup1: 'ติดตามใบเสนอราคา {code}',
      followup2: 'มีคำถามเกี่ยวกับใบเสนอราคา {code} หรือไม่?',
      followup3: 'ปิดใบเสนอราคา {code}',
      reengage: 'คุณยังหาสินค้านี้อยู่หรือไม่?',
      thankYou: 'ขอบคุณสำหรับคำสั่งซื้อ — {company}',
      payment: 'แจ้งเตือนการชำระเงิน — {code}',
      shipping: 'อัปเดตการจัดส่ง — {code}',
    },
    thanksForInquiry:
      'ขอบคุณมากสำหรับคำถามเกี่ยวกับ {company} เราขอขอบคุณสำหรับโอกาสในการเสนอราคา',
    quoteReady: 'แนบใบเสนอราคา {code} มาเพื่อพิจารณา',
    priceValid: 'ราคาข้างต้นใช้ได้ถึง {date}',
    ctaReply: 'กรุณายืนยันจำนวนและท่าเรือปลายทางเพื่อล็อกราคานี้',
  } as Partial<Phrasebook>,
  id: {
    greeting: 'Kepada Bapak/Ibu {name},',
    greetingGeneric: 'Kepada Yth. Bapak/Ibu,',
    closing: 'Hormat kami,',
    closingNoName: 'Hormat kami,',
    subject: {
      firstReply: 'Re: Permintaan Anda {code} — harga dan waktu pengiriman',
      quote: 'Penawaran {code} — {company}',
      followup1: 'Tindak lanjut penawaran {code}',
      followup2: 'Ada pertanyaan tentang penawaran {code}?',
      followup3: 'Penutupan penawaran {code}',
      reengage: 'Apakah Anda masih mencari produk ini?',
      thankYou: 'Terima kasih atas pesanan Anda — {company}',
      payment: 'Pengingat pembayaran — {code}',
      shipping: 'Pembaruan pengiriman — {code}',
    },
    thanksForInquiry:
      'Terima kasih banyak atas permintaan Anda mengenai {company}. Kami menghargai kesempatan untuk memberikan penawaran.',
    quoteReady: 'Terlampir penawaran kami {code} untuk Anda tinjau.',
    priceValid: 'Harga di atas berlaku hingga {date}.',
    ctaReply: 'Bisakah Anda mengonfirmasi jumlah dan pelabuhan tujuan agar kami dapat mengunci harga ini?',
  } as Partial<Phrasebook>,
  pl: {
    greeting: 'Szanowny Panie/Szanowna Pani {name},',
    greetingGeneric: 'Szanowni Państwo,',
    closing: 'Z poważaniem,',
    closingNoName: 'Z poważaniem,',
    subject: {
      firstReply: 'Re: Państwa zapytanie {code} — ceny i termin dostawy',
      quote: 'Oferta {code} — {company}',
      followup1: 'Przypomnienie o ofercie {code}',
      followup2: 'Pytania dotyczące oferty {code}?',
      followup3: 'Zamknięcie oferty {code}',
      reengage: 'Czy nadal szukają Państwo tego produktu?',
      thankYou: 'Dziękujemy za zamówienie — {company}',
      payment: 'Przypomnienie o płatności — {code}',
      shipping: 'Aktualizacja wysyłki — {code}',
    },
  } as Partial<Phrasebook>,
  nl: {
    greeting: 'Geachte {name},',
    greetingGeneric: 'Geachte heer/mevrouw,',
    closing: 'Met vriendelijke groet,',
    closingNoName: 'Met vriendelijke groet,',
    subject: {
      firstReply: 'Re: Uw aanvraag {code} — prijzen en levertijd',
      quote: 'Offerte {code} — {company}',
      followup1: 'Opvolging offerte {code}',
      followup2: 'Vragen over offerte {code}?',
      followup3: 'Afsluiting offerte {code}',
      reengage: 'Zoekt u dit product nog?',
      thankYou: 'Bedankt voor uw bestelling — {company}',
      payment: 'Betalingsherinnering — {code}',
      shipping: 'Verzendupdate — {code}',
    },
  } as Partial<Phrasebook>,
};

const FULL_BOOKS: Record<string, Phrasebook> = {
  en: ENGLISH,
  zh: CHINESE,
  es: SPANISH,
  fr: FRENCH,
  de: GERMAN,
  ru: RUSSIAN,
  ar: ARABIC,
  pt: PORTUGUESE,
  ja: JAPANESE,
  ko: KOREAN,
};

/** Deposit / balance / instalment, in the customer's language. */
const MILESTONE_LABELS: Record<string, Record<string, string>> = {
  deposit: { en: 'Deposit', zh: '定金', es: 'Anticipo', fr: 'Acompte', de: 'Anzahlung', ru: 'Аванс', ar: 'الدفعة المقدمة', pt: 'Entrada', ja: '前払金', ko: '계약금' },
  balance: { en: 'Balance payment', zh: '尾款', es: 'Saldo', fr: 'Solde', de: 'Restbetrag', ru: 'Остаток', ar: 'الرصيد', pt: 'Saldo', ja: '残金', ko: '잔금' },
  installment: { en: 'Instalment', zh: '分期款', es: 'Cuota', fr: 'Échéance', de: 'Teilzahlung', ru: 'Платёж', ar: 'دفعة', pt: 'Parcela', ja: '分割払い', ko: '분할금' },
};

export function milestoneLabel(label: string | null | undefined, language: string): string {
  const key = (label ?? '').toLowerCase();
  const entry = MILESTONE_LABELS[key];
  if (!entry) return label ?? '';
  return entry[language.toLowerCase().split('-')[0]!] ?? entry.en ?? label ?? '';
}

export function getPhrasebook(lang: string | null | undefined): Phrasebook {
  const code = (lang ?? 'en').toLowerCase().split('-')[0]!;
  const full = FULL_BOOKS[code];
  if (full) return full;
  const partial = PARTIAL[code];
  if (!partial) return ENGLISH;
  return { ...ENGLISH, ...partial, subject: { ...ENGLISH.subject, ...(partial.subject ?? {}) } };
}

export function getLanguage(code: string | null | undefined): LanguageMeta {
  const key = (code ?? 'en').toLowerCase().split('-')[0]!;
  return (
    LANGUAGES.find((l) => l.code === key) ??
    { code: key, nativeName: key, englishName: key, direction: 'ltr', locale: 'en-US' }
  );
}

export const isRtl = (lang: string | null | undefined): boolean =>
  getLanguage(lang).direction === 'rtl';

export function formatDate(value: string | Date, lang: string): string {
  const locale = getLanguage(lang).locale;
  try {
    return new Intl.DateTimeFormat(locale, { dateStyle: 'long', numberingSystem: 'latn' }).format(new Date(value));
  } catch {
    return new Date(value).toISOString().slice(0, 10);
  }
}

export function formatNumber(value: number, lang: string, digits = 2): string {
  const locale = getLanguage(lang).locale;
  try {
    return new Intl.NumberFormat(locale, {
      numberingSystem: 'latn',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(value);
  } catch {
    return value.toFixed(digits);
  }
}

export function formatMoney(value: number, currency: string, lang: string): string {
  const locale = getLanguage(lang).locale;
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      numberingSystem: 'latn',
      minimumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

/** Fill `{placeholders}`; unknown keys collapse to an empty string. */
export function fill(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const value = vars[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

// ---------------------------------------------------------------------------
// Language detection — good enough to route a reply without an LLM call.
// ---------------------------------------------------------------------------

// Order matters. Japanese and Korean text both contain Han characters, so the
// Kana/Hangul tests must run before the Han test — otherwise a Japanese inquiry
// is silently answered in Chinese.
const SCRIPTS: Array<{ lang: string; re: RegExp }> = [
  { lang: 'ja', re: /[\u3040-\u309f\u30a0-\u30ff]/ },
  { lang: 'ko', re: /[\uac00-\ud7af\u1100-\u11ff]/ },
  { lang: 'zh', re: /[\u4e00-\u9fff]/ },
  { lang: 'ru', re: /[\u0400-\u04ff]/ },
  { lang: 'ar', re: /[\u0600-\u06ff]/ },
  { lang: 'th', re: /[\u0e00-\u0e7f]/ },
  { lang: 'vi', re: /[ăâđêôơư]/i },
];

const STOPWORDS: Array<{ lang: string; words: string[] }> = [
  { lang: 'es', words: ['hola', 'gracias', 'precio', 'necesito', 'cotización', 'por favor', 'unidades', 'saludos'] },
  { lang: 'fr', words: ['bonjour', 'merci', 'prix', 'besoin', 'devis', 'cordialement', 'quantité', 'veuillez'] },
  { lang: 'de', words: ['hallo', 'danke', 'preis', 'brauche', 'angebot', 'bitte', 'menge', 'grüße'] },
  { lang: 'pt', words: ['olá', 'obrigado', 'preço', 'preciso', 'cotação', 'por favor', 'atenciosamente'] },
  { lang: 'it', words: ['ciao', 'grazie', 'prezzo', 'bisogno', 'offerta', 'cordiali', 'quantità'] },
  { lang: 'tr', words: ['merhaba', 'teşekkür', 'fiyat', 'ihtiyacım', 'teklif', 'saygılar'] },
  { lang: 'id', words: ['terima kasih', 'harga', 'butuh', 'penawaran', 'hormat'] },
  { lang: 'pl', words: ['cześć', 'dziękuję', 'cena', 'potrzebuję', 'oferta', 'poważaniem'] },
  { lang: 'nl', words: ['hallo', 'bedankt', 'prijs', 'nodig', 'offerte', 'groet'] },
  { lang: 'vi', words: ['xin chào', 'cảm ơn', 'giá', 'cần', 'báo giá'] },
  { lang: 'th', words: ['สวัสดี', 'ขอบคุณ', 'ราคา', 'ต้องการ'] },
  { lang: 'en', words: ['hello', 'thanks', 'price', 'need', 'quote', 'please', 'regards', 'quantity'] },
];

export function detectLanguage(text: string | null | undefined): string {
  if (!text) return 'en';
  const sample = text.slice(0, 4000);

  for (const { lang, re } of SCRIPTS) {
    if (re.test(sample)) return lang;
  }

  const lowered = sample.toLowerCase();
  let best = { lang: 'en', score: 0 };
  for (const { lang, words } of STOPWORDS) {
    let score = 0;
    for (const word of words) {
      if (lowered.includes(word)) score += 1;
    }
    if (score > best.score) best = { lang, score };
  }
  return best.score > 0 ? best.lang : 'en';
}
