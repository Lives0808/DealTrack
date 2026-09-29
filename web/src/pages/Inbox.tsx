import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Select,
  Space,
  Statistic,
  Steps,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
  message as toast,
} from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileTextOutlined,
  MailOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, type Inquiry, type Message, type Quote } from '../api';
import { useApi } from '../hooks';
import {
  ChannelTag,
  Field,
  InquiryStatus,
  IntentTag,
  LanguageTag,
  MarginBadge,
  MessageStatus,
  QuoteStatus,
  SlaTag,
  Text,
  Truncated,
  dateTime,
  humanDuration,
  money,
  percent,
  relative,
} from '../ui';
import { PageHeader } from '../components/AppLayout';

const STATUS_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '新询盘', value: 'new' },
  { label: '已解析', value: 'parsed' },
  { label: '已报价', value: 'quoted' },
  { label: '成交', value: 'won' },
  { label: '丢单', value: 'lost' },
];

export function InboxPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState(params.get('status') ?? 'all');
  const [channel, setChannel] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(id ?? null);
  const [composeOpen, setComposeOpen] = useState(false);

  const query = useMemo(() => {
    const search$ = new URLSearchParams();
    search$.set('status', status);
    if (channel !== 'all') search$.set('channel', channel);
    if (search.trim()) search$.set('search', search.trim());
    search$.set('limit', '100');
    return search$.toString();
  }, [status, channel, search]);

  const { data: inquiries, loading, refresh } = useApi<Inquiry[]>(`/api/inquiries?${query}`, { pollMs: 25_000 });
  const { data: detail, refresh: refreshDetail } = useApi<Inquiry>(selected ? `/api/inquiries/${selected}` : null);

  useEffect(() => {
    setSelected(id ?? null);
  }, [id]);

  const openDetail = (inquiryId: string) => {
    setSelected(inquiryId);
    navigate(`/inbox/${inquiryId}`, { replace: false });
  };

  const counts = useMemo(() => {
    const list = inquiries ?? [];
    return {
      total: list.length,
      pendingReply: list.filter((item) => !item.firstResponseAt && ['new', 'parsed'].includes(item.status)).length,
      pendingQuote: list.filter((item) => item.status === 'parsed').length,
      slaRisk: list.filter((item) => item.sla?.state === 'at_risk' || item.sla?.state === 'breached').length,
    };
  }, [inquiries]);

  return (
    <>
      <PageHeader
        title="询盘箱"
        subtitle="所有渠道的询盘汇聚于此，Sales Agent 自动解析、匹配产品库、生成报价与多语言回复草稿"
        extra={[
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setComposeOpen(true)}>
            粘贴新询盘
          </Button>,
          <Button key="refresh" icon={<ReloadOutlined />} loading={loading} onClick={() => { refresh(); refreshDetail(); }}>
            刷新
          </Button>,
        ]}
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="当前筛选结果" value={counts.total} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="等 AI 报价" value={counts.pendingQuote} valueStyle={{ fontSize: 22, color: '#d97706' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="尚未回复" value={counts.pendingReply} valueStyle={{ fontSize: 22, color: counts.pendingReply > 0 ? '#d02f2f' : undefined }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="SLA 风险" value={counts.slaRisk} valueStyle={{ fontSize: 22, color: counts.slaRisk > 0 ? '#d02f2f' : '#1c7a3d' }} /></Card></Col>
      </Row>

      <Card size="small" styles={{ body: { paddingTop: 12 } }}>
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            options={STATUS_OPTIONS}
            value={status}
            onChange={(value) => {
              setStatus(String(value));
              setParams({ status: String(value) });
            }}
          />
          <Select
            value={channel}
            onChange={setChannel}
            style={{ width: 130 }}
            options={[
              { label: '全部渠道', value: 'all' },
              { label: '邮件', value: 'email' },
              { label: 'WhatsApp', value: 'whatsapp' },
              { label: '手工录入', value: 'manual' },
            ]}
          />
          <Input.Search
            allowClear
            placeholder="搜索主题 / 正文 / 单号 / 邮箱"
            style={{ width: 280 }}
            onSearch={setSearch}
          />
        </Space>

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={inquiries ?? []}
          scroll={{ x: 1180 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          onRow={(record) => ({ onClick: () => openDetail(record.id), style: { cursor: 'pointer' } })}
          rowClassName={(record) => (record.id === selected ? 'ant-table-row-selected' : '')}
          columns={[
            {
              title: '单号 / 客户',
              width: 240,
              render: (_, record) => (
                <div>
                  <Space size={6}>
                    <Text strong style={{ fontSize: 12.5 }}>{record.code}</Text>
                    <LanguageTag value={record.language} />
                  </Space>
                  <div style={{ fontSize: 12.5, marginTop: 2 }}>
                    {record.customer?.company ?? record.fromName ?? '未建档'}
                  </div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {record.customer?.country ?? record.fromEmail ?? record.fromPhone ?? ''}
                  </Text>
                </div>
              ),
            },
            {
              title: '询盘内容',
              render: (_, record) => (
                <div>
                  <div style={{ fontSize: 12.5 }}>{record.subject ?? '(无主题)'}</div>
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    <Truncated text={record.summaryZh} width={380} />
                  </Text>
                </div>
              ),
            },
            { title: '渠道', width: 96, render: (_, record) => <ChannelTag value={record.channel} /> },
            { title: '意图', width: 100, render: (_, record) => <IntentTag value={record.detectedIntent} /> },
            {
              title: '数量',
              width: 116,
              render: (_, record) => {
                const items = record.items ?? [];
                if (items.length === 0) return <Text type="secondary">—</Text>;
                const first = items[0]!;
                return (
                  <span style={{ fontSize: 12.5 }}>
                    {Number(first.qty ?? 0).toLocaleString()} {first.unit}
                    {items.length > 1 && <Text type="secondary"> +{items.length - 1}</Text>}
                  </span>
                );
              },
            },
            { title: '状态', width: 92, render: (_, record) => <InquiryStatus value={record.status} /> },
            {
              title: '首响 SLA',
              width: 132,
              render: (_, record) =>
                record.firstResponseSeconds !== null ? (
                  <Tooltip title={`首次响应 ${dateTime(record.firstResponseAt)}`}>
                    <Tag color={record.firstResponseSeconds <= 180 ? 'green' : 'orange'}>
                      {humanDuration(record.firstResponseSeconds)}
                    </Tag>
                  </Tooltip>
                ) : (
                  <SlaTag value={record.sla?.state} />
                ),
            },
            {
              title: '收到',
              width: 96,
              render: (_, record) => (
                <Tooltip title={dateTime(record.receivedAt)}>
                  <Text type="secondary" style={{ fontSize: 12 }}>{relative(record.receivedAt)}</Text>
                </Tooltip>
              ),
            },
          ]}
        />
      </Card>

      <InquiryDrawer
        inquiry={detail}
        open={Boolean(selected)}
        onClose={() => {
          setSelected(null);
          navigate('/inbox');
        }}
        onChanged={() => {
          refresh();
          refreshDetail();
        }}
      />

      <NewInquiryModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        onCreated={(inquiryId) => {
          refresh();
          openDetail(inquiryId);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------

function InquiryDrawer({
  inquiry,
  open,
  onClose,
  onChanged,
}: {
  inquiry: Inquiry | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [replyOpen, setReplyOpen] = useState(false);

  const run = async (label: string, action: () => Promise<unknown>, successText: string) => {
    setBusy(label);
    try {
      await action();
      toast.success(successText);
      setTimeout(onChanged, 900);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  if (!inquiry) return null;

  const parsed = inquiry.parsed ?? {};
  const quotes = inquiry.quotes ?? [];
  const messages = inquiry.messages ?? [];

  return (
    <Drawer
      width={920}
      open={open}
      onClose={onClose}
      title={
        <Space size={10} wrap>
          <span>{inquiry.code}</span>
          <InquiryStatus value={inquiry.status} />
          <LanguageTag value={inquiry.language} />
          <ChannelTag value={inquiry.channel} />
          {inquiry.sla && <SlaTag value={inquiry.sla.state} />}
        </Space>
      }
      extra={
        <Space wrap>
          <Button
            icon={<RobotOutlined />}
            loading={busy === 'parse'}
            onClick={() =>
              run('parse', () => api.post(`/api/inquiries/${inquiry.id}/parse`), '已重新解析，稍后刷新查看结果')
            }
          >
            重新解析
          </Button>
          <Button
            type="primary"
            icon={<FileTextOutlined />}
            loading={busy === 'quote'}
            onClick={() => run('quote', () => api.post(`/api/inquiries/${inquiry.id}/quote`), '已排入报价流程，AI 正在生成报价单与回复草稿')}
          >
            生成报价 + 回复
          </Button>
          <Button icon={<MailOutlined />} onClick={() => setReplyOpen(true)}>
            记录客户回复
          </Button>
        </Space>
      }
    >
      <Row gutter={[14, 14]}>
        <Col span={24}>
          <Card size="small" title="AI 解析结果" styles={{ body: { paddingTop: 12 } }}>
            {inquiry.parsed ? (
              <>
                <Alert
                  type="success"
                  showIcon
                  icon={<CheckCircleOutlined />}
                  message={String(inquiry.summaryZh ?? '已解析')}
                  description={
                    <Space wrap size={6} style={{ marginTop: 4 }}>
                      <Tag color="blue">置信度 {percent(inquiry.parseConfidence, 0)}</Tag>
                      <IntentTag value={inquiry.detectedIntent} />
                      {Boolean(parsed.incoterm) && <Tag>{String(parsed.incoterm)}</Tag>}
                      {Boolean(parsed.destination) && <Tag color="geekblue">{String(parsed.destination)}</Tag>}
                      {Boolean(parsed.destination_port) && <Tag>{String(parsed.destination_port)}</Tag>}
                      {Array.isArray(parsed.certifications) &&
                        (parsed.certifications as string[]).map((cert) => (
                          <Tag key={cert} color="purple">
                            {cert}
                          </Tag>
                        ))}
                    </Space>
                  }
                />
                {inquiry.missingInfo.length > 0 && (
                  <Alert
                    style={{ marginTop: 10 }}
                    type="warning"
                    showIcon
                    message="缺少信息（AI 会在回复中主动询问）"
                    description={inquiry.missingInfo.join('、')}
                  />
                )}
                {inquiry.productMatches.length === 0 && inquiry.status !== 'new' && (
                  <Alert
                    style={{ marginTop: 10 }}
                    type="error"
                    showIcon
                    message="未能匹配产品库"
                    description="请检查产品库是否有对应 SKU，或人工指定产品后再生成报价。"
                  />
                )}
              </>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未解析，点击右上角「重新解析」或等待智能体自动处理" />
            )}

            {inquiry.items && inquiry.items.length > 0 && (
              <Table
                size="small"
                style={{ marginTop: 12 }}
                rowKey="id"
                pagination={false}
                dataSource={inquiry.items}
                columns={[
                  { title: '#', dataIndex: 'lineNo', width: 40 },
                  {
                    title: '客户原文行',
                    dataIndex: 'rawText',
                    render: (value: string) => <Text style={{ fontSize: 12.5 }}>{value}</Text>,
                  },
                  {
                    title: '匹配产品',
                    render: (_, record) => (
                      <div>
                        <div style={{ fontSize: 12.5 }}>{record.description}</div>
                        {record.sku && <Text type="secondary" className="dt-mono">{record.sku}</Text>}
                      </div>
                    ),
                  },
                  {
                    title: '数量',
                    width: 92,
                    align: 'right',
                    render: (_, record) => `${Number(record.qty ?? 0).toLocaleString()} ${record.unit ?? ''}`,
                  },
                  {
                    title: '匹配度',
                    width: 84,
                    render: (_, record) =>
                      record.matchConfidence === null ? (
                        '—'
                      ) : (
                        <Tag color={record.matchConfidence >= 0.6 ? 'green' : 'orange'}>
                          {percent(record.matchConfidence, 0)}
                        </Tag>
                      ),
                  },
                ]}
              />
            )}
          </Card>
        </Col>

        <Col span={24}>
          <Card size="small" title="客户原文" styles={{ body: { paddingTop: 12 } }}>
            <Descriptions size="small" column={2} style={{ marginBottom: 10 }}>
              <Descriptions.Item label="主题">{String(inquiry.subject ?? '—')}</Descriptions.Item>
              <Descriptions.Item label="发件人">
                {String(inquiry.fromName ?? '—')}{' '}
                {inquiry.fromEmail ? `<${inquiry.fromEmail}>` : (inquiry.fromPhone ?? '')}
              </Descriptions.Item>
              <Descriptions.Item label="客户">{String(inquiry.customer?.company ?? '未建档')}</Descriptions.Item>
              <Descriptions.Item label="收到时间">{String(dateTime(inquiry.receivedAt))}</Descriptions.Item>
            </Descriptions>
            <div className="dt-quote-body">{String(inquiry.body ?? '(空)')}</div>
          </Card>
        </Col>

        <Col span={24}>
          <Tabs
            size="small"
            items={[
              {
                key: 'quotes',
                label: `报价单 (${quotes.length})`,
                children:
                  quotes.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有报价单" />
                  ) : (
                    <Table
                      size="small"
                      rowKey="id"
                      pagination={false}
                      dataSource={quotes}
                      columns={[
                        { title: '单号', dataIndex: 'quoteNo', width: 130 },
                        { title: '状态', dataIndex: 'status', width: 90, render: (v: string) => <QuoteStatus value={v} /> },
                        {
                          title: '总额',
                          dataIndex: 'total',
                          align: 'right',
                          render: (value: number, record: Quote) => money(value, record.currency),
                        },
                        { title: '毛利', dataIndex: 'marginPct', width: 84, render: (v: number) => <MarginBadge value={v} /> },
                        { title: '条款', width: 130, render: (_, r: Quote) => `${r.incoterm} ${r.incotermPlace}` },
                        {
                          title: '操作',
                          width: 130,
                          render: (_, record: Quote) => (
                            <Space>
                              <Button size="small" onClick={() => window.open(`/api/quotes/${record.id}/document`, '_blank')}>
                                PDF
                              </Button>
                              <Button size="small" type="link" href={`/quotes/${record.id}`}>
                                详情
                              </Button>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  ),
              },
              {
                key: 'messages',
                label: `往来消息 (${messages.length})`,
                children:
                  messages.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有消息" />
                  ) : (
                    <div>
                      {messages.map((msg: Message) => (
                        <div key={msg.id} style={{ marginBottom: 12 }}>
                          <Space size={8} style={{ marginBottom: 4 }} wrap>
                            <Tag color={msg.direction === 'inbound' ? 'cyan' : 'blue'}>
                              {msg.direction === 'inbound' ? '客户发来' : '我方发出'}
                            </Tag>
                            <ChannelTag value={msg.channel} />
                            <MessageStatus value={msg.status} />
                            <Text type="secondary" style={{ fontSize: 11.5 }}>{dateTime(msg.createdAt)}</Text>
                            {msg.subject && <Text style={{ fontSize: 12.5 }}>{msg.subject}</Text>}
                          </Space>
                          <div className="dt-quote-body" style={{ maxHeight: 220 }}>{msg.body}</div>
                        </div>
                      ))}
                    </div>
                  ),
              },
              {
                key: 'timeline',
                label: '事件时间线',
                children:
                  (inquiry.timeline ?? []).length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无事件" />
                  ) : (
                    <Timeline
                      items={(inquiry.timeline ?? []).map((entry) => ({
                        color: entry.actor.startsWith('agent') ? 'blue' : 'gray',
                        children: (
                          <div>
                            <Space size={6} wrap>
                              <Text style={{ fontSize: 12.5 }}>{entry.subject ?? entry.type}</Text>
                              <Tag style={{ marginInlineEnd: 0 }} color={entry.actor.startsWith('agent') ? 'blue' : 'default'}>
                                {entry.actor}
                              </Tag>
                            </Space>
                            <div>
                              <Text type="secondary" style={{ fontSize: 11 }}>{dateTime(entry.at)}</Text>
                            </div>
                          </div>
                        ),
                      }))}
                    />
                  ),
              },
            ]}
          />
        </Col>
      </Row>

      <ReplyModal
        open={replyOpen}
        inquiryId={inquiry.id}
        onClose={() => setReplyOpen(false)}
        onDone={onChanged}
      />
    </Drawer>
  );
}

function ReplyModal({
  open,
  inquiryId,
  onClose,
  onDone,
}: {
  open: boolean;
  inquiryId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  return (
    <Modal
      open={open}
      title="记录客户回复"
      onCancel={onClose}
      confirmLoading={loading}
      okText="提交并让 AI 分类"
      onOk={async () => {
        const values = await form.validateFields();
        setLoading(true);
        try {
          await api.post(`/api/inquiries/${inquiryId}/messages`, { body: values.body, channel: values.channel });
          toast.success('已记录，Sales Agent 正在判断意图并起草应答');
          form.resetFields();
          onClose();
          setTimeout(onDone, 1200);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '提交失败');
        } finally {
          setLoading(false);
        }
      }}
    >
      <Form form={form} layout="vertical" initialValues={{ channel: 'email' }}>
        <Form.Item name="channel" label="渠道">
          <Select options={[{ label: '邮件', value: 'email' }, { label: 'WhatsApp', value: 'whatsapp' }, { label: '电话/其他', value: 'manual' }]} />
        </Form.Item>
        <Form.Item name="body" label="客户回复内容" rules={[{ required: true, message: '请输入客户回复内容' }]}>
          <Input.TextArea rows={7} placeholder="把客户的回复原文粘贴到这里，AI 会判断意图（嫌贵 / 问交期 / 要下单 / 拒绝），并自动起草对应应答。" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function NewInquiryModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (inquiryId: string) => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const samples: Array<{ label: string; value: string }> = [
    {
      label: '英文 · 询价 5000 件移动电源',
      value: `Dear Sales Team,\n\nWe are a distributor in the UK and would like to source power banks.\n\nPlease quote:\n- 5,000 pcs 20000mAh Power Bank, PD 65W\n- CIF Felixstowe\n- We need CE and RoHS certificates\n\nTarget price is USD 13.80. What is your lead time?\n\nBest regards,\nJames Whitfield`,
    },
    {
      label: '德文 · 3000 件工作灯',
      value: `Sehr geehrte Damen und Herren,\n\nwir suchen einen Hersteller für LED-Arbeitsstrahler.\n\nBitte um Angebot für:\n- 3.000 Stück LED Arbeitsstrahler 50W, IP65\n- FOB Shenzhen, Zielhafen Hamburg\n- CE und RoHS Zertifikate erforderlich\n\nZielpreis ca. USD 6,20. Lieferzeit?\n\nMit freundlichen Grüßen\nMarkus Hellweg`,
    },
    {
      label: '西语 · 200 块太阳能板',
      value: `Buenos días,\n\nNos interesan sus paneles solares de 450W monocristalinos.\n\nNecesitamos:\n- 200 unidades\n- CIF Valencia\n- Certificación TUV\n\nNuestro objetivo es USD 82 por unidad. ¿Plazo de entrega?\n\nSaludos,\nCarmen Ruiz`,
    },
    {
      label: '阿语 · 4000 件 LED 灯',
      value: `السادة المحترمين،\n\nنحن شركة تجارية في الرياض.\n\nنحتاج إلى:\n- 4,000 قطعة مصباح LED 50 واط، IP65\n- الشروط: CIF جدة\n- شهادات CE و SASO\n\nسعر مستهدف: 6.50 دولار للقطعة\n\nمع أطيب التحيات`,
    },
  ];

  return (
    <Modal
      open={open}
      width={720}
      title="粘贴一封新询盘，让 AI 团队接手"
      onCancel={onClose}
      confirmLoading={loading}
      okText="交给销售智能体"
      onOk={async () => {
        const values = await form.validateFields();
        setLoading(true);
        try {
          const result = await api.post<{ inquiry: Inquiry }>('/api/inquiries', { ...values, autoRun: true });
          toast.success(`已建档 ${result.inquiry.code}，AI 正在解析并生成报价`);
          form.resetFields();
          onClose();
          onCreated(result.inquiry.id);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '创建失败');
        } finally {
          setLoading(false);
        }
      }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="任意语言都可以"
        description="粘贴客户原文即可，系统会自动识别语言（支持 17 种）、抽取产品与数量、匹配产品库、计算 FOB/CIF 价格，并按客户语言起草回复。"
      />

      <Space wrap style={{ marginBottom: 12 }}>
        {samples.map((sample) => (
          <Button
            key={sample.label}
            size="small"
            onClick={() =>
              form.setFieldsValue({
                body: sample.value,
                subject: sample.label.split(' · ')[1],
                contactName: sample.label.split(' · ')[1],
              })
            }
          >
            示例：{sample.label}
          </Button>
        ))}
      </Space>

      <Form form={form} layout="vertical">
        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="contactName" label="联系人">
              <Input placeholder="Markus Hellweg" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="email" label="邮箱">
              <Input placeholder="purchase@example.com" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="subject" label="主题">
              <Input placeholder="Anfrage: 3000 Stück LED Arbeitsstrahler" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="channel" label="渠道" initialValue="email">
              <Select options={[{ label: '邮件', value: 'email' }, { label: 'WhatsApp', value: 'whatsapp' }, { label: '其他', value: 'manual' }]} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="body" label="询盘正文" rules={[{ required: true, message: '请粘贴询盘正文' }]}>
          <Input.TextArea rows={10} placeholder="粘贴客户原文…" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export { Steps, Divider, Typography, InputNumber, SendOutlined, ThunderboltOutlined, ClockCircleOutlined, Row, Col };
