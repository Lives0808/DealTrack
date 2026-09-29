import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  List,
  Progress,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClockCircleOutlined,
  FireOutlined,
  ReloadOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip as ReTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { api, type Overview, type Thread } from '../api';
import { useApi, useEventStream } from '../hooks';
import {
  AgentStatus,
  RiskTag,
  Text,
  compactMoney,
  dateTime,
  money,
  ms,
  percent,
  relative,
} from '../ui';
import { PageHeader } from '../components/AppLayout';
import { ErrorBoundary } from '../components/ErrorBoundary';

interface Timeseries {
  inquiries: Array<{ day: string; n: number }>;
  quotes: Array<{ day: string; n: number; value: number }>;
  wins: Array<{ day: string; n: number; value: number }>;
  responses: Array<{ day: string; avg_seconds: number; n: number }>;
}

export function DashboardPage() {
  const [days, setDays] = useState(30);
  const stream = useEventStream(40);
  const { data: overview, loading, refresh } = useApi<Overview>(`/api/overview?days=${days}`, { pollMs: 20_000 });
  const { data: series } = useApi<Timeseries>(`/api/overview/timeseries?days=${days}`, { pollMs: 60_000 });
  const { data: threads } = useApi<Thread[]>('/api/threads?status=open&limit=8');

  // Refetch quietly whenever an agent actually changes something.
  const lastVersion = useRef(stream.version);
  useEffect(() => {
    if (stream.version === lastVersion.current) return;
    const timer = setTimeout(() => {
      lastVersion.current = stream.version;
      refresh();
    }, 1_200);
    return () => clearTimeout(timer);
  }, [stream.version, refresh]);

  const chartData = useMemo(() => {
    if (!series) return [];
    const byDay = new Map<string, { day: string; 询盘: number; 报价: number; 成交: number; 均值: number }>();
    const ensure = (day: string) => {
      if (!byDay.has(day)) byDay.set(day, { day, 询盘: 0, 报价: 0, 成交: 0, 均值: 0 });
      return byDay.get(day)!;
    };
    for (const row of series.inquiries) ensure(row.day).询盘 = Number(row.n);
    for (const row of series.quotes) ensure(row.day).报价 = Number(row.n);
    for (const row of series.wins) {
      ensure(row.day).成交 = Number(row.n);
    }
    for (const row of series.responses) {
      ensure(row.day).均值 = Number((Number(row.avg_seconds) / 60).toFixed(1));
    }
    return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [series]);

  const kpi = overview?.kpi;
  const speedProgress = kpi
    ? Math.min(100, Math.max(0, ((kpi.baselineMinutes - kpi.avgFirstResponseMinutes) / kpi.baselineMinutes) * 100))
    : 0;

  return (
    <>
      <PageHeader
        title="老板看板"
        subtitle={
          kpi
            ? `统计区间 ${dayjs(overview!.range.since).format('MM-DD')} → ${dayjs(overview!.range.until).format('MM-DD')} · 目标 ${kpi.targetMinutes} 分钟/封`
            : '加载中…'
        }
        extra={[
          <Space key="range">
            {[7, 30, 90].map((value) => (
              <Button key={value} size="small" type={days === value ? 'primary' : 'default'} onClick={() => setDays(value)}>
                {value} 天
              </Button>
            ))}
          </Space>,
          <Button key="refresh" size="small" icon={<ReloadOutlined />} loading={loading} onClick={refresh}>
            刷新
          </Button>,
        ]}
      />

      {overview?.llm && !overview.llm.readiness.ready && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message="AI 模型未就绪，当前使用内置离线引擎"
          description={
            <span>
              {overview.llm.readiness.reason} 前往 <Link to="/settings">设置 → AI 模型</Link> 填入 API Key 后即可切换到真实模型。
            </span>
          }
        />
      )}

      <Row gutter={[14, 14]}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small" loading={!overview}>
            <Statistic
              title={
                <Space size={4}>
                  <ClockCircleOutlined /> 平均首次响应
                  <Tooltip title={`人工基线 ${kpi?.baselineMinutes ?? 30} 分钟/封，目标 ${kpi?.targetMinutes ?? 3} 分钟/封`}>
                    <Text type="secondary" style={{ fontSize: 11 }}>ⓘ</Text>
                  </Tooltip>
                </Space>
              }
              value={kpi?.avgFirstResponseMinutes ?? 0}
              precision={1}
              suffix="分钟"
              valueStyle={{
                color: (kpi?.avgFirstResponseMinutes ?? 99) <= (kpi?.targetMinutes ?? 3) ? '#1c7a3d' : '#d97706',
              }}
            />
            <div style={{ marginTop: 6 }}>
              <Progress percent={Number(speedProgress.toFixed(0))} size="small" strokeColor="#1c7a3d" showInfo={false} />
              <Text type="secondary" style={{ fontSize: 11.5 }}>
                对比 {kpi?.baselineMinutes ?? 30} 分钟基线，已优化 {speedProgress.toFixed(0)}%
              </Text>
            </div>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" loading={!overview}>
            <Statistic
              title={
                <Space size={4}>
                  <ThunderboltOutlined /> 累计节省工时
                </Space>
              }
              value={kpi?.hoursSaved ?? 0}
              precision={1}
              suffix="小时"
              valueStyle={{ color: '#0b5cad' }}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              按 {kpi?.responded ?? 0} 封已回复 × {(kpi?.baselineMinutes ?? 30) - (kpi?.targetMinutes ?? 3)} 分钟计
            </Text>
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" loading={!overview}>
            {(kpi?.responded ?? 0) > 0 ? (
              <>
                <Statistic
                  title={
                    <Space size={4}>
                      <RocketOutlined /> 提速倍数
                    </Space>
                  }
                  value={kpi?.speedupFactor ?? 0}
                  precision={1}
                  suffix="×"
                  valueStyle={{ color: '#1c7a3d' }}
                />
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  最快 {kpi?.bestFirstResponseMinutes ?? 0} 分钟 · 已回复 {kpi?.responded ?? 0} 封
                </Text>
              </>
            ) : (
              // With zero replies a "10×" badge is a lie dressed as a metric.
              <>
                <Statistic
                  title={
                    <Space size={4}>
                      <RocketOutlined /> 提速倍数
                    </Space>
                  }
                  value="待测量"
                  valueStyle={{ color: '#a0a8b3', fontSize: 20 }}
                />
                <Text type="secondary" style={{ fontSize: 11.5 }}>
                  发出第一封报价后开始统计（目标 {kpi?.baselineMinutes ?? 30}→{kpi?.targetMinutes ?? 3} 分钟）
                </Text>
              </>
            )}
          </Card>
        </Col>

        <Col xs={24} sm={12} lg={6}>
          <Card size="small" loading={!overview}>
            <Statistic
              title={
                <Space size={4}>
                  <FireOutlined /> 待人工处理
                </Space>
              }
              value={(overview?.risks.pendingApprovals ?? 0) + (overview?.risks.alerts ?? 0)}
              valueStyle={{ color: (overview?.risks.pendingApprovals ?? 0) > 0 ? '#d97706' : undefined }}
            />
            <Space size={4} wrap style={{ marginTop: 6 }}>
              <Tag color="orange">待审草稿 {overview?.risks.pendingApprovals ?? 0}</Tag>
              <Tag color="red">预警 {overview?.risks.alerts ?? 0}</Tag>
              <Tag color="blue">对齐群 {overview?.risks.openThreads ?? 0}</Tag>
            </Space>
          </Card>
        </Col>
      </Row>

      <ErrorBoundary label="趋势与漏斗">
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={16}>
          <Card
            size="small"
            title="询盘 → 报价 → 成交 趋势"
            extra={<Text type="secondary" style={{ fontSize: 12 }}>曲线为平均首响（分钟）</Text>}
            loading={!series}
          >
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#eef2f6" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={(v: string) => v.slice(5)} />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <ReTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  labelFormatter={(v: string) => dayjs(v).format('YYYY-MM-DD')}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar yAxisId="left" dataKey="询盘" fill="#91caff" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar yAxisId="left" dataKey="报价" fill="#0b5cad" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Bar yAxisId="left" dataKey="成交" fill="#1c7a3d" radius={[3, 3, 0, 0]} maxBarSize={18} />
                <Line yAxisId="right" type="monotone" dataKey="均值" stroke="#d97706" strokeWidth={2} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="销售漏斗" loading={!overview}>
            <FunnelBar
              steps={[
                { label: '收到询盘', value: overview?.funnel.received ?? 0, color: '#91caff' },
                { label: 'AI 已解析', value: overview?.funnel.parsed ?? 0, color: '#69b1ff' },
                { label: '已生成报价', value: overview?.funnel.quoted ?? 0, color: '#0b5cad' },
                { label: '报价已发出', value: overview?.funnel.sent ?? 0, color: '#0958a0' },
                { label: '成交', value: overview?.funnel.won ?? 0, color: '#1c7a3d' },
              ]}
            />
            <div style={{ marginTop: 14, display: 'flex', justifyContent: 'space-between' }}>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5 }}>报价转化率</Text>
                <div style={{ fontSize: 17, fontWeight: 650 }}>{percent(overview?.funnel.quoteRate)}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5 }}>成交率</Text>
                <div style={{ fontSize: 17, fontWeight: 650, color: '#1c7a3d' }}>{percent(overview?.funnel.winRate)}</div>
              </div>
              <div>
                <Text type="secondary" style={{ fontSize: 11.5 }}>在途报价额</Text>
                <div style={{ fontSize: 17, fontWeight: 650 }}>{compactMoney(overview?.pipeline.openValue ?? 0)}</div>
              </div>
            </div>
          </Card>
        </Col>
      </Row>
      </ErrorBoundary>

      <ErrorBoundary label="团队与风险">
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={8}>
          <Card size="small" title="AI 数字外贸团队" loading={!overview}>
            {overview?.agents.map((agent) => (
              <div
                key={agent.agent}
                style={{
                  display: 'flex',
                  gap: 12,
                  padding: '11px 0',
                  borderBottom: '1px solid #f0f3f7',
                }}
              >
                <div
                  className="dt-agent-orb"
                  style={{
                    background:
                      agent.agent === 'sales'
                        ? 'linear-gradient(135deg,#0b5cad,#2e9bd6)'
                        : agent.agent === 'followup'
                          ? 'linear-gradient(135deg,#1c7a3d,#4bbd77)'
                          : 'linear-gradient(135deg,#a75b00,#e0a341)',
                  }}
                >
                  {agent.agent === 'sales' ? '💼' : agent.agent === 'followup' ? '⏰' : '📦'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 600 }}>{agent.label}</span>
                    <AgentStatus value={agent.status} />
                  </div>
                  <Text type="secondary" style={{ fontSize: 11.5, display: 'block' }}>
                    {agent.description}
                  </Text>
                  <Space size={10} style={{ marginTop: 4, fontSize: 11.5 }}>
                    <Text type="secondary">已处理 {agent.processed}</Text>
                    <Text type="secondary">队列 {agent.queueDepth}</Text>
                    <Text type="secondary">均耗时 {ms(agent.averageLatencyMs)}</Text>
                    <Text type="secondary">成功率 {percent(agent.successRate, 0)}</Text>
                  </Space>
                </div>
              </div>
            ))}
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="风险与待办" loading={!overview} extra={<Link to="/followups">跟进看板</Link>}>
            <Row gutter={[8, 8]}>
              <RiskCell label="SLA 超时未响" value={overview?.risks.slaAtRisk ?? 0} tone="red" to="/inbox?status=new,parsed" />
              <RiskCell label="报价即将过期" value={overview?.risks.expiringQuotes ?? 0} tone="orange" to="/quotes" />
              <RiskCell label="待审批草稿" value={overview?.risks.pendingApprovals ?? 0} tone="orange" to="/followups" />
              <RiskCell label="未解决对齐群" value={overview?.risks.openThreads ?? 0} tone="blue" to="/agents" />
              <RiskCell label="死信任务" value={overview?.risks.deadTasks ?? 0} tone="red" to="/agents?tab=tasks" />
              <RiskCell label="逾期跟进" value={overview?.followups.overdue ?? 0} tone="orange" to="/followups" />
            </Row>

            <div style={{ marginTop: 14 }}>
              <Text type="secondary" style={{ fontSize: 11.5 }}>业务对齐群</Text>
              {threads && threads.length > 0 ? (
                <List
                  size="small"
                  style={{ marginTop: 6 }}
                  dataSource={threads.slice(0, 4)}
                  renderItem={(thread) => (
                    <List.Item style={{ padding: '7px 0' }}>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <Text style={{ fontSize: 12.5 }} ellipsis>
                            {thread.subject}
                          </Text>
                          <RiskTag value={thread.severity} />
                        </div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {relative(thread.updatedAt)}
                        </Text>
                      </div>
                    </List.Item>
                  )}
                />
              ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无需要人工对齐的事项" style={{ margin: '12px 0' }} />
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={8}>
          <Card size="small" title="丢单原因分析" loading={!overview} extra={<Link to="/quotes">报价单</Link>}>
            {overview && overview.loss.reasons.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height={168}>
                  <BarChart
                    data={overview.loss.reasons.slice(0, 6)}
                    layout="vertical"
                    margin={{ top: 0, right: 16, bottom: 0, left: 8 }}
                  >
                    <XAxis type="number" hide />
                    <YAxis type="category" dataKey="label" width={78} tick={{ fontSize: 11 }} />
                    <ReTooltip contentStyle={{ fontSize: 12 }} formatter={(v: number) => [`${v} 单`, '数量']} />
                    <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={16}>
                      {overview.loss.reasons.slice(0, 6).map((_, index) => (
                        <Cell key={index} fill={['#d02f2f', '#e8663c', '#d97706', '#c9a227', '#7a838f', '#a0a8b3'][index] ?? '#a0a8b3'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
                <div style={{ marginTop: 8 }}>
                  <Space size={12}>
                    <span>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>丢单金额 </Text>
                      <Text strong style={{ fontSize: 13 }}>{compactMoney(overview.loss.lostValue)}</Text>
                    </span>
                    <span>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>成交金额 </Text>
                      <Text strong style={{ fontSize: 13, color: '#1c7a3d' }}>{compactMoney(overview.loss.wonValue)}</Text>
                    </span>
                  </Space>
                </div>
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有结单记录，成交或丢单后这里会自动给出归因" />
            )}
          </Card>
        </Col>
      </Row>

      </ErrorBoundary>

      <ErrorBoundary label="事件流与分析">
      <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title={
              <Space>
                <Badge status={stream.connected ? 'processing' : 'default'} />
                实时事件流
              </Space>
            }
            extra={<Text type="secondary" style={{ fontSize: 12 }}>{stream.events.length} 条</Text>}
          >
            <div style={{ maxHeight: 300, overflow: 'auto' }}>
              {stream.events.length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待智能体活动…" />
              ) : (
                stream.events.slice(0, 30).map((event) => (
                  <div key={event.id} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: '1px solid #f5f7fa' }}>
                    <Text type="secondary" className="dt-mono" style={{ flex: '0 0 58px' }}>
                      {dayjs(event.createdAt).format('HH:mm:ss')}
                    </Text>
                    <Tag style={{ marginInlineEnd: 0 }} color={event.actor.startsWith('agent') ? 'blue' : 'default'}>
                      {event.actor.replace('agent:', '')}
                    </Tag>
                    <Text style={{ fontSize: 12.5 }} ellipsis={{ tooltip: event.subject ?? event.type }}>
                      {event.subject ?? event.type}
                    </Text>
                  </div>
                ))
              )}
            </div>
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title="国家/地区成交率" loading={!overview}>
            {overview && overview.loss.byCountry.length > 0 ? (
              <Table
                size="small"
                pagination={false}
                rowKey="country"
                dataSource={overview.loss.byCountry}
                columns={[
                  { title: '市场', dataIndex: 'country', width: 150 },
                  { title: '成交', dataIndex: 'won', width: 70, align: 'right' },
                  { title: '丢单', dataIndex: 'lost', width: 70, align: 'right' },
                  {
                    title: '成交率',
                    dataIndex: 'winRate',
                    render: (value: number) => (
                      <Space size={6}>
                        <Progress
                          percent={Number((value * 100).toFixed(0))}
                          size="small"
                          style={{ width: 110, marginBottom: 0 }}
                          strokeColor={value >= 0.5 ? '#1c7a3d' : value >= 0.25 ? '#d97706' : '#d02f2f'}
                        />
                      </Space>
                    ),
                  },
                ]}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有结单数据" />
            )}
          </Card>
        </Col>
      </Row>

      </ErrorBoundary>

      <Card size="small" title="成本与合规" style={{ marginTop: 14 }} loading={!overview}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Statistic
              title="AI 调用成本（区间内）"
              value={overview?.llm.costUsd ?? 0}
              precision={4}
              prefix="$"
              valueStyle={{ fontSize: 20 }}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              {overview?.llm.calls ?? 0} 次调用 · {((overview?.llm.tokensIn ?? 0) + (overview?.llm.tokensOut ?? 0)).toLocaleString()} tokens
            </Text>
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="在途报价毛利额"
              value={overview?.pipeline.openMargin ?? 0}
              precision={0}
              prefix="$"
              valueStyle={{ fontSize: 20, color: '#1c7a3d' }}
            />
            <Text type="secondary" style={{ fontSize: 11.5 }}>
              共 {overview?.pipeline.totalQuotes ?? 0} 张报价
            </Text>
          </Col>
          <Col xs={24} sm={8}>
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <SafetyCertificateOutlined /> 数据本地优先
              </Text>
              <div style={{ fontSize: 12.5, marginTop: 4 }}>
                数据库与密钥均保存在本机 <Text code>{overview ? 'data/dealtrack.sqlite' : ''}</Text>，BYOK 密钥使用 AES-256-GCM 加密存储。
              </div>
            </div>
          </Col>
        </Row>
      </Card>
    </>
  );
}

function RiskCell({ label, value, tone, to }: { label: string; value: number; tone: string; to: string }) {
  const color = value === 0 ? '#c3cad3' : tone === 'red' ? '#d02f2f' : tone === 'orange' ? '#d97706' : '#0b5cad';
  return (
    <Col span={12}>
      <Link to={to}>
        <div
          style={{
            border: '1px solid #eef2f6',
            borderRadius: 8,
            padding: '9px 12px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            background: value === 0 ? '#fbfcfd' : '#fff',
          }}
        >
          <Text style={{ fontSize: 12.5, color: value === 0 ? '#a0a8b3' : undefined }}>{label}</Text>
          <span style={{ fontWeight: 700, fontSize: 16, color }}>{value}</span>
        </div>
      </Link>
    </Col>
  );
}

function FunnelBar({ steps }: { steps: Array<{ label: string; value: number; color: string }> }) {
  const max = Math.max(1, ...steps.map((step) => step.value));
  return (
    <div>
      {steps.map((step, index) => {
        const width = Math.max(6, (step.value / max) * 100);
        const previous = index > 0 ? steps[index - 1]!.value : step.value;
        const drop = previous > 0 && index > 0 ? 1 - step.value / previous : null;
        return (
          <div key={step.label} style={{ marginBottom: 9 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
              <span>{step.label}</span>
              <span>
                <strong>{step.value}</strong>
                {drop !== null && (
                  <Text type="secondary" style={{ fontSize: 11, marginInlineStart: 6 }}>
                    <ArrowDownOutlined style={{ fontSize: 9 }} /> {percent(drop, 0)} 流失
                  </Text>
                )}
              </span>
            </div>
            <div style={{ background: '#f0f3f7', borderRadius: 5, height: 9, overflow: 'hidden' }}>
              <div style={{ width: `${width}%`, height: '100%', background: step.color, borderRadius: 5, transition: 'width .4s ease' }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export { Collapse, ArrowUpOutlined, WarningOutlined, money, dateTime };
