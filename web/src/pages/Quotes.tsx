import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
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
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  message as toast,
} from 'antd';
import {
  CheckOutlined,
  CloseOutlined,
  FilePdfOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SendOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import {
  api,
  type Inquiry,
  type ProformaInvoice,
  type Quote,
  type QuoteRevision,
} from '../api';
import { useApi } from '../hooks';
import {
  Field,
  LanguageTag,
  MarginBadge,
  QuoteStatus,
  Text,
  dateOnly,
  dateTime,
  money,
  percent,
  relative,
} from '../ui';
import { PageHeader } from '../components/AppLayout';
import { ErrorBoundary } from '../components/ErrorBoundary';

const LOSS_REASONS = [
  { value: 'price', label: '价格偏高' },
  { value: 'lead_time', label: '交期太长' },
  { value: 'quality', label: '质量/规格不符' },
  { value: 'payment_terms', label: '付款条件不接受' },
  { value: 'moq', label: '起订量过高' },
  { value: 'certification', label: '认证不满足' },
  { value: 'shipping', label: '运费过高' },
  { value: 'competitor', label: '被竞品拿下' },
  { value: 'no_budget', label: '客户预算取消' },
  { value: 'no_response', label: '客户失联' },
  { value: 'spec_mismatch', label: '规格不匹配' },
  { value: 'other', label: '其他' },
];

export function QuotesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(id ?? null);

  const query = useMemo(() => {
    const params = new URLSearchParams({ status, limit: '100' });
    if (search.trim()) params.set('search', search.trim());
    return params.toString();
  }, [status, search]);

  const { data: quotes, loading, refresh } = useApi<Quote[]>(`/api/quotes?${query}`, { pollMs: 25_000 });
  const { data: detail, refresh: refreshDetail } = useApi<Quote>(selected ? `/api/quotes/${selected}` : null);

  useEffect(() => setSelected(id ?? null), [id]);

  const totals = useMemo(() => {
    const list = quotes ?? [];
    return {
      count: list.length,
      value: list.reduce((sum, quote) => sum + quote.total, 0),
      margin: list.reduce((sum, quote) => sum + (quote.marginAmount ?? 0), 0),
      pending: list.filter((quote) => quote.status === 'pending_approval').length,
    };
  }, [quotes]);

  return (
    <>
      <PageHeader
        title="报价单"
        subtitle="每张报价都记录了阶梯价、成本、毛利和命中的定价规则，可随时回溯为什么是这个价"
        extra={[<Button key="r" icon={<ReloadOutlined />} loading={loading} onClick={() => { refresh(); refreshDetail(); }}>刷新</Button>]}
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="报价单数" value={totals.count} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="报价总额" value={totals.value} precision={0} prefix="$" valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="预期毛利额" value={totals.margin} precision={0} prefix="$" valueStyle={{ fontSize: 22, color: '#1c7a3d' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="待审批" value={totals.pending} valueStyle={{ fontSize: 22, color: totals.pending > 0 ? '#d97706' : undefined }} /></Card></Col>
      </Row>

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={status}
            onChange={(value) => setStatus(String(value))}
            options={[
              { label: '全部', value: 'all' },
              { label: '待审批', value: 'pending_approval' },
              { label: '已发出', value: 'sent' },
              { label: '成交', value: 'accepted' },
              { label: '丢单', value: 'rejected' },
            ]}
          />
          <Input.Search allowClear placeholder="搜索单号 / 客户" style={{ width: 240 }} onSearch={setSearch} />
        </Space>

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={quotes ?? []}
          scroll={{ x: 1080 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          onRow={(record) => ({
            onClick: () => {
              setSelected(record.id);
              navigate(`/quotes/${record.id}`);
            },
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: '单号 / 客户',
              width: 220,
              render: (_, record) => (
                <div>
                  <Space size={6}>
                    <Text strong style={{ fontSize: 12.5 }}>{record.quoteNo}</Text>
                    <LanguageTag value={record.language} />
                  </Space>
                  <div style={{ fontSize: 12.5 }}>{record.customer?.company ?? '—'}</div>
                  <Text type="secondary" style={{ fontSize: 11 }}>
                    {record.customer?.country ?? ''} {record.incoterm} {record.incotermPlace}
                  </Text>
                </div>
              ),
            },
            {
              title: '行项目',
              render: (_, record) => (
                <div style={{ fontSize: 12.5 }}>
                  {(record.items ?? []).slice(0, 2).map((item) => (
                    <div key={item.id}>
                      {Number(item.qty).toLocaleString()} {item.unit} × {item.description.slice(0, 40)}
                    </div>
                  ))}
                  {(record.items ?? []).length > 2 && (
                    <Text type="secondary" style={{ fontSize: 11 }}>+{(record.items ?? []).length - 2} 行</Text>
                  )}
                </div>
              ),
            },
            {
              title: '总额',
              width: 140,
              align: 'right',
              render: (_, record) => <Text strong>{money(record.total, record.currency)}</Text>,
            },
            { title: '毛利', width: 80, render: (_, record) => <MarginBadge value={record.marginPct} /> },
            { title: '状态', width: 92, render: (_, record) => <QuoteStatus value={record.status} /> },
            {
              title: '有效期',
              width: 108,
              render: (_, record) => {
                const expired = record.validUntil && new Date(record.validUntil) < new Date();
                return (
                  <Tooltip title={dateOnly(record.validUntil)}>
                    <span style={{ fontSize: 12, color: expired ? '#d02f2f' : undefined }}>
                      {expired ? '已过期' : relative(record.validUntil)}
                    </span>
                  </Tooltip>
                );
              },
            },
          ]}
        />
      </Card>

      <ErrorBoundary label="报价详情">
        <QuoteDrawer
          quote={detail}
          open={Boolean(selected)}
          onClose={() => {
            setSelected(null);
            navigate('/quotes');
          }}
          onChanged={() => {
            refresh();
            refreshDetail();
          }}
        />
      </ErrorBoundary>
    </>
  );
}

// ---------------------------------------------------------------------------

function QuoteDrawer({
  quote,
  open,
  onClose,
  onChanged,
}: {
  quote: Quote | null;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [declaration, setDeclaration] = useState<Record<string, unknown> | null>(null);

  const { data: proforma, refresh: refreshProforma } = useApi<ProformaInvoice | null>(
    quote ? `/api/quotes/${quote.id}/proforma` : null,
  );
  const { data: revisions, refresh: refreshRevisions } = useApi<QuoteRevision[]>(
    quote ? `/api/quotes/${quote.id}/revisions` : null,
  );

  const act = async (key: string, fn: () => Promise<unknown>, successText: string) => {
    setBusy(key);
    try {
      await fn();
      toast.success(successText);
      setTimeout(onChanged, 900);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    } finally {
      setBusy(null);
    }
  };

  if (!quote) return null;

  const outcome = Array.isArray(quote.outcome) ? quote.outcome[0] : quote.outcome;

  return (
    <>
      <Drawer
        width={980}
        open={open}
        onClose={onClose}
        title={
          <Space size={10} wrap>
            <span>{quote.quoteNo}</span>
            <QuoteStatus value={quote.status} />
            <MarginBadge value={quote.marginPct} />
            <LanguageTag value={quote.language} />
          </Space>
        }
        extra={
          <Space wrap>
            <Button icon={<FilePdfOutlined />} onClick={() => window.open(`/api/quotes/${quote.id}/document`, '_blank')}>
              报价单 PDF
            </Button>
            <Button
              icon={<SafetyCertificateOutlined />}
              loading={busy === 'decl'}
              onClick={() =>
                act(
                  'decl',
                  async () => setDeclaration((await api.post<Record<string, unknown>>(`/api/quotes/${quote.id}/declaration`)) as Record<string, unknown>),
                  '报关要素表已生成',
                )
              }
            >
              报关要素
            </Button>
            {quote.status === 'pending_approval' && (
              <Button
                type="primary"
                icon={<SendOutlined />}
                loading={busy === 'send'}
                onClick={() => act('send', () => api.post(`/api/quotes/${quote.id}/send`), '已批准并发送（未配置 SMTP 时为模拟发送）')}
              >
                批准并发送
              </Button>
            )}
            {!['accepted', 'rejected'].includes(quote.status) && (
              <>
                <Button icon={<CheckOutlined />} onClick={() => setOutcomeOpen(true)}>
                  登记结果
                </Button>
                <Button
                  icon={<SwapOutlined />}
                  onClick={() => {
                    form.setFieldsValue({ reason: '', discountPct: 0, marginDeltaPct: -0.02 });
                    setReviseOpen(true);
                  }}
                >
                  改版报价
                </Button>
              </>
            )}
            {proforma && (
              <Button
                type="primary"
                icon={<FileProtectOutlined />}
                onClick={() => window.open(`/api/quotes/${quote.id}/proforma/document`, '_blank')}
              >
                形式发票
              </Button>
            )}
          </Space>
        }
      >
        <Row gutter={[14, 14]}>
          <Col span={24}>
            <Descriptions size="small" column={3} bordered>
              <Descriptions.Item label="客户">{quote.customer?.company ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="国家">{quote.customer?.country ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="联系人">{quote.customer?.contactName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="贸易条款">{quote.incoterm} {quote.incotermPlace}</Descriptions.Item>
              <Descriptions.Item label="付款方式">{quote.paymentTerms ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="交货期">{quote.leadTimeDays ?? '—'} 天</Descriptions.Item>
              <Descriptions.Item label="有效期至">{dateOnly(quote.validUntil)}</Descriptions.Item>
              <Descriptions.Item label="币种">{quote.currency}</Descriptions.Item>
              <Descriptions.Item label="生成方">{quote.createdBy}</Descriptions.Item>
            </Descriptions>
          </Col>

          <Col span={24}>
            <Card size="small" title="报价明细" styles={{ body: { paddingTop: 8 } }}>
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={quote.items ?? []}
                columns={[
                  { title: '#', dataIndex: 'lineNo', width: 40 },
                  {
                    title: '产品',
                    render: (_, item) => (
                      <div>
                        <div style={{ fontSize: 12.5 }}>{item.description}</div>
                        <Text type="secondary" className="dt-mono">
                          {item.sku ?? ''} {item.hsCode ? `· HS ${item.hsCode}` : ''}
                        </Text>
                      </div>
                    ),
                  },
                  { title: '数量', width: 100, align: 'right', render: (_, item) => `${Number(item.qty).toLocaleString()} ${item.unit}` },
                  { title: '单价', width: 110, align: 'right', render: (_, item) => item.unitPrice.toFixed(4) },
                  {
                    title: '金额',
                    width: 130,
                    align: 'right',
                    render: (_, item) => <Text strong>{money(item.amount, quote.currency)}</Text>,
                  },
                  {
                    title: '单位成本',
                    width: 100,
                    align: 'right',
                    render: (_, item) => (
                      <Tooltip title="含包装、内陆运费、汇率折算后的到岸成本">
                        <Text type="secondary">{item.unitCost?.toFixed(4) ?? '—'}</Text>
                      </Tooltip>
                    ),
                  },
                ]}
                summary={() => (
                  <Table.Summary.Row>
                    <Table.Summary.Cell index={0} colSpan={4}>
                      <div style={{ textAlign: 'right' }}>
                        <div>小计 {money(quote.subtotal, quote.currency)}</div>
                        {quote.discountAmount > 0 && <div>折扣 −{money(quote.discountAmount, quote.currency)}</div>}
                        {quote.freight > 0 && <div>运费 {money(quote.freight, quote.currency)}</div>}
                        {quote.insurance > 0 && <div>保险 {money(quote.insurance, quote.currency)}</div>}
                        <div style={{ fontSize: 15, fontWeight: 700, marginTop: 4 }}>
                          总计 {money(quote.total, quote.currency)}
                        </div>
                      </div>
                    </Table.Summary.Cell>
                    <Table.Summary.Cell index={4}>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>成本</Text>
                        <div>{money(quote.costTotal, quote.currency)}</div>
                      </div>
                    </Table.Summary.Cell>
                  </Table.Summary.Row>
                )}
              />
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card size="small" title="价格构成与审计" styles={{ body: { paddingTop: 8 } }}>
              {(quote.appliedRules ?? []).length > 0 ? (
                <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 10 }}>
                  {(quote.appliedRules ?? []).map((rule, index) => (
                    <Tag key={index} color="blue" style={{ marginInlineEnd: 0 }}>
                      规则命中：{rule.name}
                      {rule.deltaPct !== undefined && ` (${(rule.deltaPct * 100).toFixed(1)}%)`}
                      {rule.deltaAmount !== undefined && ` (${rule.deltaAmount.toFixed(2)})`}
                    </Tag>
                  ))}
                </Space>
              ) : (
                <Text type="secondary" style={{ fontSize: 12 }}>未命中额外定价规则</Text>
              )}

              <Table
                size="small"
                rowKey={(row: Record<string, number>) => String(row.sku)}
                pagination={false}
                dataSource={quote.priceBreakdown as Array<Record<string, number>>}
                columns={[
                  { title: 'SKU', dataIndex: 'sku', width: 110, className: 'dt-mono' },
                  { title: '出厂价', dataIndex: 'exWorks', align: 'right', render: (v: number) => v?.toFixed(3) },
                  { title: '包装', dataIndex: 'packaging', align: 'right', render: (v: number) => v?.toFixed(3) },
                  { title: '内陆', dataIndex: 'inland', align: 'right', render: (v: number) => v?.toFixed(3) },
                  { title: '汇率', dataIndex: 'fxRate', align: 'right', render: (v: number) => v?.toFixed(4) },
                  { title: '毛利', dataIndex: 'marginPct', align: 'right', render: (v: number) => percent(v) },
                ]}
              />

              {quote.internalNotes && (
                <Alert style={{ marginTop: 10 }} type="warning" showIcon message="内部提示" description={quote.internalNotes} />
              )}
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card size="small" title="流程记录" styles={{ body: { paddingTop: 12 } }}>
              <Timeline
                items={[
                  { color: 'blue', children: <>生成报价 {dateTime(quote.createdAt)} · {quote.createdBy}</> },
                  ...(quote.approvedBy ? [{ color: 'green', children: <>审批通过 {dateTime(quote.outcome && !Array.isArray(quote.outcome) ? quote.outcome.decidedAt : null)} · {quote.approvedBy}</> }] : []),
                  ...(quote.sentAt ? [{ color: 'green', children: <>报价发出 {dateTime(quote.sentAt)}</> }] : []),
                  ...(outcome
                    ? [
                        {
                          color: outcome.result === 'won' ? 'green' : 'red',
                          children: (
                            <>
                              结果：{outcome.result === 'won' ? '成交' : outcome.result === 'lost' ? '丢单' : '未回复'}
                              {outcome.reasonCode ? ` · ${LOSS_REASONS.find((r) => r.value === outcome.reasonCode)?.label ?? outcome.reasonCode}` : ''}
                              <div>
                                <Text type="secondary" style={{ fontSize: 11 }}>{dateTime(outcome.decidedAt)}</Text>
                              </div>
                              {outcome.reasonNote && <div style={{ fontSize: 12 }}>{outcome.reasonNote}</div>}
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
              />
              {quote.inquiry && (
                <div style={{ marginTop: 8 }}>
                  <Field label="来源询盘">
                    <a href={`/inbox/${quote.inquiry.id}`}>{quote.inquiry.code}</a>
                  </Field>
                  <Field label="客户语言"><LanguageTag value={quote.language} /></Field>
                </div>
              )}
            </Card>
          </Col>

          <Col xs={24} lg={12}>
            <Card
              size="small"
              title="形式发票与回款"
              extra={
                proforma ? (
                  <Tag color={proforma.status === 'paid' ? 'green' : proforma.status === 'deposit_paid' ? 'blue' : 'orange'}>
                    {proforma.status === 'paid' ? '已全款' : proforma.status === 'deposit_paid' ? '定金已收' : '待收款'}
                  </Tag>
                ) : null
              }
              styles={{ body: { paddingTop: 12 } }}
            >
              {!proforma ? (
                <>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {quote.status === 'accepted'
                      ? '正在由销售智能体生成形式发票…'
                      : '登记成交后会自动生成形式发票，并按付款条款拆出定金与尾款节点。'}
                  </Text>
                  <div style={{ marginTop: 10 }}>
                    <Button
                      icon={<FileProtectOutlined />}
                      loading={busy === 'pi'}
                      onClick={() =>
                        act(
                          'pi',
                          async () => {
                            await api.post(`/api/quotes/${quote.id}/proforma`, {});
                            refreshProforma();
                          },
                          '形式发票已生成',
                        )
                      }
                    >
                      立即生成
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <Space direction="vertical" size={2} style={{ width: '100%', marginBottom: 10 }}>
                    <Space size={6}>
                      <Text strong className="dt-mono">{proforma.piNo}</Text>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        签发 {dateOnly(proforma.issuedAt)}
                      </Text>
                    </Space>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      定金 {money(proforma.depositAmount, proforma.currency)}（{(proforma.depositPct * 100).toFixed(0)}%）
                      · 尾款 {money(proforma.balanceAmount, proforma.currency)}
                    </Text>
                  </Space>
                  {(proforma.milestones ?? []).map((milestone) => (
                    <div
                      key={milestone.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderTop: '1px solid #f5f7fa',
                      }}
                    >
                      <div>
                        <Text style={{ fontSize: 12.5 }}>
                          {milestone.label === 'deposit' ? '定金' : milestone.label === 'balance' ? '尾款' : milestone.label}
                        </Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            应付 {dateOnly(milestone.dueAt)}
                          </Text>
                        </div>
                      </div>
                      <Space size={6}>
                        <Text strong style={{ fontSize: 12.5 }}>{money(milestone.amount, milestone.currency)}</Text>
                        <Tag color={milestone.status === 'paid' ? 'green' : milestone.status === 'overdue' ? 'red' : 'blue'}>
                          {milestone.status === 'paid' ? '已收' : milestone.status === 'overdue' ? '逾期' : '待收'}
                        </Tag>
                      </Space>
                    </div>
                  ))}
                  <Space style={{ marginTop: 10 }} wrap>
                    <Button size="small" icon={<FilePdfOutlined />} onClick={() => window.open(`/api/quotes/${quote.id}/proforma/document`, '_blank')}>
                      下载 PI
                    </Button>
                    <Button
                      size="small"
                      icon={<ReloadOutlined />}
                      onClick={() => {
                        refreshProforma();
                        onChanged();
                      }}
                    >
                      刷新
                    </Button>
                  </Space>
                </>
              )}
            </Card>

            {(revisions ?? []).length > 1 && (
              <Card size="small" title="改版历史" style={{ marginTop: 14 }} styles={{ body: { paddingTop: 8 } }}>
                {(revisions ?? []).map((entry, index) => {
                  const previous = index > 0 ? revisions![index - 1] : null;
                  const delta = previous ? entry.total - previous.total : 0;
                  return (
                    <div
                      key={entry.id}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '6px 0',
                        borderTop: index > 0 ? '1px solid #f5f7fa' : undefined,
                      }}
                    >
                      <div>
                        <Space size={6}>
                          <Text strong className="dt-mono" style={{ fontSize: 12 }}>{entry.quoteNo}</Text>
                          <Tag>v{entry.version}</Tag>
                        </Space>
                        <div>
                          <Text type="secondary" style={{ fontSize: 11.5 }}>
                            {entry.revisionReason ?? '初版'} · {dateOnly(entry.createdAt)}
                          </Text>
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <Text style={{ fontSize: 12.5 }}>{money(entry.total, entry.currency)}</Text>
                        {previous && (
                          <div>
                            <Text style={{ fontSize: 11, color: delta <= 0 ? '#1c7a3d' : '#d02f2f' }}>
                              {delta <= 0 ? '↓' : '↑'} {Math.abs(delta).toFixed(0)}
                            </Text>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </Card>
            )}
          </Col>

          {declaration && (
            <Col span={24}>
              <Card size="small" title={`报关要素表 · ${String(declaration.declarationNo ?? '')}`} styles={{ body: { paddingTop: 12 } }}>
                <Alert
                  type={declaration.passed ? 'success' : 'warning'}
                  showIcon
                  style={{ marginBottom: 12 }}
                  message={declaration.passed ? '合规校验全部通过' : '存在待处理项，请复核后再安排订舱'}
                />
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={(declaration.compliance as Array<Record<string, string>>) ?? []}
                  columns={[
                    { title: '检查项', dataIndex: 'label' },
                    {
                      title: '结果',
                      dataIndex: 'status',
                      width: 100,
                      render: (value: string) => (
                        <Tag color={value === 'pass' ? 'green' : value === 'fail' ? 'red' : 'orange'}>
                          {value === 'pass' ? '通过' : value === 'fail' ? '需处理' : '提示'}
                        </Tag>
                      ),
                    },
                    { title: '说明', dataIndex: 'detail' },
                  ]}
                />
                <Space style={{ marginTop: 12 }}>
                  <Button icon={<FilePdfOutlined />} onClick={() => window.open(`/api/quotes/${quote.id}/declaration`, '_blank')}>
                    下载报关要素表
                  </Button>
                </Space>
              </Card>
            </Col>
          )}
        </Row>
      </Drawer>

      <OutcomeModal
        open={outcomeOpen}
        quote={quote}
        onClose={() => setOutcomeOpen(false)}
        onDone={onChanged}
      />

      <Modal
        open={reviseOpen}
        title={`改版报价 · ${quote.quoteNo}`}
        onCancel={() => setReviseOpen(false)}
        okText="生成新版本"
        onOk={async () => {
          const values = await form.validateFields();
          try {
            const result = await api.post<{ quote: Quote; delta: { total: number } }>(
              `/api/quotes/${quote.id}/revise`,
              values,
            );
            toast.success(
              `已生成 ${result.quote.quoteNo}，总价变动 ${result.delta.total >= 0 ? '+' : ''}${result.delta.total.toFixed(0)}`,
            );
            setReviseOpen(false);
            refreshRevisions();
            onChanged();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : '改版失败');
          }
        }}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="改版会保留完整谈判历史"
          description="新版本关联到原报价，原报价标记为 superseded。一个月后客户问「怎么比上次贵」，这段历史就是答案。"
        />
        <Form form={form} layout="vertical">
          <Form.Item name="reason" label="改版原因" rules={[{ required: true, message: '必须写清原因，用于复盘' }]}>
            <Input.TextArea rows={2} placeholder="例如：客户砍价，下调毛利 3 个点换取 3 个柜的订单" />
          </Form.Item>
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="marginDeltaPct" label="毛利调整" extra="-0.03 表示毛利下调 3 个百分点">
                <InputNumber style={{ width: '100%' }} min={-0.5} max={0.5} step={0.01} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="discountPct" label="折扣（0–0.9）">
                <InputNumber style={{ width: '100%' }} min={0} max={0.9} step={0.01} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="freight" label="运费覆盖（留空沿用）">
                <InputNumber style={{ width: '100%' }} min={0} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="leadTimeDays" label="交期（天，留空沿用）">
                <InputNumber style={{ width: '100%' }} min={1} max={365} />
              </Form.Item>
            </Col>
          </Row>
        </Form>
      </Modal>
    </>
  );
}

function OutcomeModal({
  open,
  quote,
  onClose,
  onDone,
}: {
  open: boolean;
  quote: Quote;
  onClose: () => void;
  onDone: () => void;
}) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  return (
    <Modal
      open={open}
      title={`登记报价结果 · ${quote.quoteNo}`}
      onCancel={onClose}
      confirmLoading={loading}
      okText="提交"
      onOk={async () => {
        const values = await form.validateFields();
        setLoading(true);
        try {
          await api.post(`/api/quotes/${quote.id}/outcome`, values);
          toast.success(values.result === 'won' ? '已登记成交，报关智能体开始生成报关要素' : '已登记，数据进入丢单分析');
          form.resetFields();
          onClose();
          setTimeout(onDone, 1000);
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '提交失败');
        } finally {
          setLoading(false);
        }
      }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="这份记录会回流到丢单分析"
        description="登记丢单原因后，老板看板会自动给出丢单归因排行，用来优化报价话术与定价策略。"
      />
      <Form form={form} layout="vertical" initialValues={{ result: 'won', finalPrice: quote.total }}>
        <Form.Item name="result" label="结果" rules={[{ required: true }]}>
          <Select
            options={[
              { label: '✅ 成交', value: 'won' },
              { label: '❌ 丢单', value: 'lost' },
              { label: '😶 客户失联', value: 'no_response' },
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.result !== next.result}>
          {({ getFieldValue }) =>
            getFieldValue('result') !== 'won' && (
              <>
                <Form.Item name="reasonCode" label="丢单原因" rules={[{ required: true, message: '请选择原因' }]}>
                  <Select options={LOSS_REASONS} placeholder="选择最主要的原因" />
                </Form.Item>
                <Form.Item name="competitor" label="竞争对手（如有）">
                  <Input placeholder="例如：越南供应商 / 本地品牌" />
                </Form.Item>
              </>
            )
          }
        </Form.Item>
        <Form.Item name="finalPrice" label="最终成交价">
          <InputNumber style={{ width: '100%' }} min={0} addonBefore={quote.currency} />
        </Form.Item>
        <Form.Item name="reasonNote" label="备注">
          <Input.TextArea rows={3} placeholder="客户原话或内部复盘" />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export { Empty, Inquiry };
