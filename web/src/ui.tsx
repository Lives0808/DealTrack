import { Tag, Tooltip, Typography } from 'antd';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import duration from 'dayjs/plugin/duration';
import 'dayjs/locale/zh-cn';
import type { ReactNode } from 'react';

dayjs.extend(relativeTime);
dayjs.extend(duration);
dayjs.locale('zh-cn');

export const { Text, Title, Paragraph } = Typography;

// ---------------------------------------------------------------------------
// Money & numbers
// ---------------------------------------------------------------------------

export function money(value: number | null | undefined, currency = 'USD', digits = 2): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—';
  return `${currency} ${value.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

export function compactMoney(value: number, currency = 'USD'): string {
  const abs = Math.abs(value);
  const symbol = currency === 'USD' ? '$' : currency === 'CNY' ? '¥' : currency === 'EUR' ? '€' : `${currency} `;
  if (abs >= 1_000_000) return `${symbol}${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${symbol}${(value / 1_000).toFixed(1)}K`;
  return `${symbol}${value.toFixed(0)}`;
}

export function percent(value: number | null | undefined, digits = 1): string {
  if (value === null || value === undefined) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

export function relative(iso: string | null | undefined): string {
  if (!iso) return '—';
  return dayjs(iso).fromNow();
}

export function dateTime(iso: string | null | undefined): string {
  return iso ? dayjs(iso).format('YYYY-MM-DD HH:mm') : '—';
}

export function dateOnly(iso: string | null | undefined): string {
  return iso ? dayjs(iso).format('YYYY-MM-DD') : '—';
}

export function humanDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—';
  if (seconds < 60) return `${seconds.toFixed(0)} 秒`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)} 分钟`;
  if (seconds < 86400) return `${(seconds / 3600).toFixed(1)} 小时`;
  return `${(seconds / 86400).toFixed(1)} 天`;
}

export function ms(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  if (value < 1000) return `${value}ms`;
  return `${(value / 1000).toFixed(2)}s`;
}

// ---------------------------------------------------------------------------
// Status vocabulary — the UI's shared language
// ---------------------------------------------------------------------------

type Tone = 'default' | 'processing' | 'success' | 'warning' | 'error';

const INQUIRY_STATUS: Record<string, { label: string; tone: Tone }> = {
  new: { label: '新询盘', tone: 'warning' },
  parsed: { label: '已解析', tone: 'processing' },
  quoted: { label: '已报价', tone: 'processing' },
  nurturing: { label: '培育中', tone: 'default' },
  won: { label: '已成交', tone: 'success' },
  lost: { label: '已丢单', tone: 'error' },
  archived: { label: '已归档', tone: 'default' },
};

const QUOTE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: '草稿', tone: 'default' },
  pending_approval: { label: '待审批', tone: 'warning' },
  sent: { label: '已发出', tone: 'processing' },
  accepted: { label: '已成交', tone: 'success' },
  rejected: { label: '已丢单', tone: 'error' },
  expired: { label: '已过期', tone: 'error' },
  superseded: { label: '已替换', tone: 'default' },
};

const MESSAGE_STATUS: Record<string, { label: string; tone: Tone }> = {
  draft: { label: '草稿', tone: 'default' },
  pending_approval: { label: '待确认', tone: 'warning' },
  queued: { label: '排队中', tone: 'processing' },
  sent: { label: '已发送', tone: 'success' },
  received: { label: '已收到', tone: 'processing' },
  failed: { label: '发送失败', tone: 'error' },
};

const FOLLOWUP_STATUS: Record<string, { label: string; tone: Tone }> = {
  scheduled: { label: '已排程', tone: 'processing' },
  pending_approval: { label: '待确认', tone: 'warning' },
  sent: { label: '已发出', tone: 'success' },
  replied: { label: '客户已回', tone: 'success' },
  snoozed: { label: '已延后', tone: 'default' },
  skipped: { label: '已跳过', tone: 'default' },
  done: { label: '已完成', tone: 'success' },
  failed: { label: '失败', tone: 'error' },
};

const AGENT_STATUS: Record<string, { label: string; tone: Tone }> = {
  idle: { label: '空闲', tone: 'success' },
  busy: { label: '工作中', tone: 'processing' },
  paused: { label: '已暂停', tone: 'default' },
  error: { label: '异常', tone: 'error' },
};

const TASK_STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: '排队', tone: 'warning' },
  running: { label: '执行中', tone: 'processing' },
  succeeded: { label: '成功', tone: 'success' },
  failed: { label: '失败', tone: 'error' },
  dead: { label: '死信', tone: 'error' },
  cancelled: { label: '已取消', tone: 'default' },
  waiting_approval: { label: '待人工', tone: 'warning' },
};

const SLA_STATE: Record<string, { label: string; tone: Tone }> = {
  met: { label: '已达标', tone: 'success' },
  within: { label: '计时中', tone: 'processing' },
  at_risk: { label: '即将超时', tone: 'warning' },
  breached: { label: '已超时', tone: 'error' },
  'n/a': { label: '不适用', tone: 'default' },
};

const INTENT_LABELS: Record<string, string> = {
  rfq: '询价',
  price_objection: '嫌贵',
  lead_time_question: '问交期',
  certification_question: '问认证',
  payment_question: '问付款',
  sample_request: '要样品',
  order_placement: '要下单',
  rejection: '明确拒绝',
  complaint: '投诉',
  shipping_question: '问物流',
  general_inquiry: '一般咨询',
};

const TONE_TO_TAG: Record<Tone, string> = {
  default: 'default',
  processing: 'blue',
  success: 'green',
  warning: 'orange',
  error: 'red',
};

function vocabTag(dictionary: Record<string, { label: string; tone: Tone }>, key: string | null | undefined, fallback: string) {
  const entry = dictionary[key ?? ''] ?? { label: key ? `${fallback}${key}` : fallback, tone: 'default' as Tone };
  return <Tag color={TONE_TO_TAG[entry.tone]}>{entry.label}</Tag>;
}

export const InquiryStatus = ({ value }: { value: string | null | undefined }) => vocabTag(INQUIRY_STATUS, value, '');
export const QuoteStatus = ({ value }: { value: string | null | undefined }) => vocabTag(QUOTE_STATUS, value, '');
export const MessageStatus = ({ value }: { value: string | null | undefined }) => vocabTag(MESSAGE_STATUS, value, '');
export const FollowupStatus = ({ value }: { value: string | null | undefined }) => vocabTag(FOLLOWUP_STATUS, value, '');
export const TaskStatus = ({ value }: { value: string | null | undefined }) => vocabTag(TASK_STATUS, value, '');
export const SlaTag = ({ value }: { value: string | null | undefined }) => vocabTag(SLA_STATE, value, '');

export function AgentStatus({ value }: { value: string | null | undefined }) {
  const entry = AGENT_STATUS[value ?? ''] ?? AGENT_STATUS.idle!;
  const pulsing = value === 'busy';
  return (
    <Tag color={TONE_TO_TAG[entry.tone]} style={pulsing ? { animation: 'dt-pulse 1.6s ease-in-out infinite' } : undefined}>
      {entry.label}
    </Tag>
  );
}

export function IntentTag({ value }: { value: string | null | undefined }) {
  if (!value) return <Tag>未分类</Tag>;
  return <Tag color="geekblue">{INTENT_LABELS[value] ?? value}</Tag>;
}

export function LanguageTag({ value }: { value: string | null | undefined }) {
  const names: Record<string, string> = {
    en: 'EN 英语', zh: 'ZH 中文', es: 'ES 西语', fr: 'FR 法语', de: 'DE 德语',
    ru: 'RU 俄语', ar: 'AR 阿语', pt: 'PT 葡语', ja: 'JA 日语', ko: 'KO 韩语',
    it: 'IT 意语', tr: 'TR 土语', vi: 'VI 越南语', th: 'TH 泰语', id: 'ID 印尼语',
    pl: 'PL 波兰语', nl: 'NL 荷兰语',
  };
  if (!value) return <Tag>未知</Tag>;
  const rtl = value === 'ar';
  return <Tag color={rtl ? 'purple' : 'cyan'}>{names[value] ?? value.toUpperCase()}</Tag>;
}

export function ChannelTag({ value }: { value: string | null | undefined }) {
  const map: Record<string, { label: string; color: string }> = {
    email: { label: '邮件', color: 'blue' },
    whatsapp: { label: 'WhatsApp', color: 'green' },
    web: { label: '网页表单', color: 'cyan' },
    manual: { label: '手工录入', color: 'default' },
  };
  const entry = map[value ?? ''] ?? { label: value ?? '—', color: 'default' };
  return <Tag color={entry.color}>{entry.label}</Tag>;
}

export function RiskTag({ value }: { value: string | null | undefined }) {
  const map: Record<string, { label: string; color: string }> = {
    info: { label: '提示', color: 'blue' },
    normal: { label: '正常', color: 'default' },
    warning: { label: '预警', color: 'orange' },
    critical: { label: '紧急', color: 'red' },
  };
  const entry = map[value ?? ''] ?? map.normal!;
  return <Tag color={entry.color}>{entry.label}</Tag>;
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

export function Field({ label, children, block }: { label: string; children: ReactNode; block?: boolean }) {
  return (
    <div style={{ display: block ? 'block' : 'flex', gap: 8, marginBottom: 6, alignItems: 'baseline' }}>
      <span style={{ color: '#8b949f', fontSize: 12, minWidth: block ? undefined : 76, display: 'inline-block' }}>{label}</span>
      <span style={{ fontSize: 13 }}>{children}</span>
    </div>
  );
}

export function Truncated({ text, width = 320 }: { text: string | null | undefined; width?: number }) {
  if (!text) return <span style={{ color: '#c3cad3' }}>—</span>;
  return (
    <Tooltip title={<div style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>{text}</div>}>
      <span
        style={{
          display: 'inline-block',
          maxWidth: width,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          verticalAlign: 'bottom',
        }}
      >
        {text}
      </span>
    </Tooltip>
  );
}

export function MarginBadge({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <Tag>—</Tag>;
  const pct = value * 100;
  const color = pct >= 25 ? 'green' : pct >= 15 ? 'blue' : pct >= 8 ? 'orange' : 'red';
  return <Tag color={color}>{pct.toFixed(1)}%</Tag>;
}

/** Injects the one keyframe we need without pulling in a CSS framework. */
export function GlobalStyles() {
  return (
    <style>{`
      @keyframes dt-pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.45; }
      }
      ::-webkit-scrollbar { width: 8px; height: 8px; }
      ::-webkit-scrollbar-thumb { background: #d6dce3; border-radius: 4px; }
      ::-webkit-scrollbar-thumb:hover { background: #bcc5d0; }
      .dt-mono { font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace; font-size: 12px; }
      .dt-quote-body {
        white-space: pre-wrap;
        font-size: 13px;
        line-height: 1.7;
        background: #fafbfc;
        border: 1px solid #e6eaef;
        border-radius: 8px;
        padding: 14px 16px;
        max-height: 420px;
        overflow: auto;
      }
      .dt-chat-bubble {
        background: #f4f7fa;
        border-radius: 10px;
        padding: 10px 14px;
        margin-bottom: 10px;
        white-space: pre-wrap;
        font-size: 13px;
        line-height: 1.65;
      }
      .dt-agent-orb {
        width: 38px; height: 38px; border-radius: 12px;
        display: flex; align-items: center; justify-content: center;
        font-size: 18px; color: #fff;
      }
    `}</style>
  );
}
