import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  message as toast,
} from 'antd';
import {
  BellOutlined,
  CheckCircleOutlined,
  FileProtectOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, type PaymentMilestone, type ProformaInvoice } from '../api';
import { useApi } from '../hooks';
import { Text, compactMoney, dateOnly, money, relative } from '../ui';
import { PageHeader } from '../components/AppLayout';
import { ErrorBoundary } from '../components/ErrorBoundary';

interface PaymentRow extends PaymentMilestone {
  customer?: { company: string; country: string | null; language: string };
  pi?: ProformaInvoice | null;
}

interface Cashflow {
  outstanding: number;
  overdue: number;
  collected: number;
  overdueCount: number;
  pendingCount: number;
  byStatus: Record<string, number>;
  topOverdue: Array<{ customer: string; amount: number; currency: string; label: string; dueAt: string | null; daysLate: number }>;
}

/**
 * 回款看板 — the half of the deal that happens after "yes".
 *
 * The pipeline used to stop at `quote.accepted`: no proforma invoice, no deposit
 * to chase, no way to see who owes what. This page is the missing second act.
 */
export function PaymentsPage() {
  const [status, setStatus] = useState('outstanding');
  const [marking, setMarking] = useState<PaymentRow | null>(null);
  const [form] = Form.useForm();

  const query = status === 'outstanding' ? 'pending,invoiced,overdue' : status === 'all' ? 'all' : status;
  const { data: payments, loading, refresh } = useApi<PaymentRow[]>(
    `/api/payments?status=${query}&limit=300`,
    { pollMs: 30_000 },
  );
  const { data: cashflow, refresh: refreshCashflow } = useApi<Cashflow>('/api/payments/summary', {
    pollMs: 30_000,
  });

  const reload = () => {
    refresh();
    refreshCashflow();
  };

  const rows = useMemo(() => {
    const list = payments ?? [];
    // Late money first — that is the only ordering that matters here.
    return [...list].sort((a, b) => {
      const rank = (row: PaymentRow) => (row.status === 'overdue' ? 0 : row.status === 'pending' ? 1 : 2);
      if (rank(a) !== rank(b)) return rank(a) - rank(b);
      return String(a.dueAt ?? '').localeCompare(String(b.dueAt ?? ''));
    });
  }, [payments]);

  const remind = async (id: string) => {
    try {
      await api.post(`/api/payments/${id}/remind`);
      toast.success('催款草稿已排入生成队列，稍后到「跟进看板」确认发送');
      setTimeout(reload, 1500);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
    }
  };

  return (
    <>
      <PageHeader
        title="回款看板"
        subtitle="成交之后的第二幕：形式发票、定金、尾款。逾期会自动推进跟单智能体起草催款。"
        extra={[<Button key="r" icon={<ReloadOutlined />} loading={loading} onClick={reload}>刷新</Button>]}
      />

      <ErrorBoundary label="回款概览">
        <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="未收金额"
                value={cashflow?.outstanding ?? 0}
                precision={0}
                prefix="$"
                valueStyle={{ fontSize: 22 }}
              />
              <Text type="secondary" style={{ fontSize: 11.5 }}>{cashflow?.pendingCount ?? 0} 笔在途</Text>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="已逾期"
                value={cashflow?.overdue ?? 0}
                precision={0}
                prefix="$"
                valueStyle={{ fontSize: 22, color: (cashflow?.overdueCount ?? 0) > 0 ? '#d02f2f' : undefined }}
              />
              <Text type="secondary" style={{ fontSize: 11.5 }}>{cashflow?.overdueCount ?? 0} 笔需催</Text>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="已收金额"
                value={cashflow?.collected ?? 0}
                precision={0}
                prefix="$"
                valueStyle={{ fontSize: 22, color: '#1c7a3d' }}
              />
              <Text type="secondary" style={{ fontSize: 11.5 }}>累计到账</Text>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Statistic
                title="回款率"
                value={
                  (cashflow?.collected ?? 0) + (cashflow?.outstanding ?? 0) > 0
                    ? ((cashflow!.collected / (cashflow!.collected + cashflow!.outstanding)) * 100).toFixed(0)
                    : '—'
                }
                suffix={cashflow ? '%' : undefined}
                valueStyle={{ fontSize: 22 }}
              />
              <Text type="secondary" style={{ fontSize: 11.5 }}>已收 /（已收 + 未收）</Text>
            </Card>
          </Col>
        </Row>

        {(cashflow?.overdueCount ?? 0) > 0 && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 14 }}
            message={`${cashflow!.overdueCount} 笔回款已逾期，合计 ${money(cashflow!.overdue)}`}
            description={
              <div>
                {cashflow!.topOverdue.slice(0, 5).map((entry) => (
                  <div key={`${entry.customer}-${entry.label}-${entry.dueAt}`} style={{ fontSize: 12.5 }}>
                    · {entry.customer} — {entry.label} {entry.currency} {entry.amount.toFixed(0)}
                    {entry.daysLate > 0 ? `（逾期 ${entry.daysLate} 天）` : ''}
                  </div>
                ))}
              </div>
            }
          />
        )}
      </ErrorBoundary>

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={status}
            onChange={(value) => setStatus(String(value))}
            options={[
              { label: '未结清', value: 'outstanding' },
              { label: '已逾期', value: 'overdue' },
              { label: '已收款', value: 'paid' },
              { label: '全部', value: 'all' },
            ]}
          />
        </Space>

        <ErrorBoundary label="回款列表">
          <Table
            size="small"
            rowKey="id"
            loading={loading}
            dataSource={rows}
            scroll={{ x: 1080 }}
            pagination={{ pageSize: 20, showSizeChanger: false }}
            columns={[
              {
                title: '到期',
                width: 132,
                render: (_, record) => {
                  const overdue = record.dueAt && new Date(record.dueAt) < new Date() && record.status !== 'paid';
                  return (
                    <div>
                      <Text style={{ fontSize: 12.5, color: overdue ? '#d02f2f' : undefined }}>
                        {dateOnly(record.dueAt)}
                      </Text>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>
                          {record.status === 'paid' ? '已结清' : relative(record.dueAt)}
                        </Text>
                      </div>
                    </div>
                  );
                },
              },
              {
                title: '客户 / 款项',
                width: 220,
                render: (_, record) => (
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>{record.customer?.company ?? '—'}</div>
                    <Text type="secondary" style={{ fontSize: 11.5 }}>
                      {record.customer?.country ?? ''} · {record.label === 'deposit' ? '定金' : record.label === 'balance' ? '尾款' : record.label}
                    </Text>
                  </div>
                ),
              },
              {
                title: '形式发票',
                width: 150,
                render: (_, record) =>
                  record.pi ? (
                    <Tooltip title={`总额 ${money(record.pi.total, record.pi.currency)}`}>
                      <Space size={4}>
                        <Text className="dt-mono" style={{ fontSize: 11.5 }}>{record.pi.piNo}</Text>
                      </Space>
                    </Tooltip>
                  ) : (
                    <Text type="secondary">—</Text>
                  ),
              },
              {
                title: '金额',
                width: 140,
                align: 'right',
                render: (_, record) => (
                  <Text strong>{money(record.amount, record.currency)}</Text>
                ),
              },
              {
                title: '状态',
                width: 92,
                render: (_, record) => {
                  const map: Record<string, { label: string; color: string }> = {
                    paid: { label: '已收款', color: 'green' },
                    pending: { label: '待收', color: 'blue' },
                    invoiced: { label: '已开票', color: 'cyan' },
                    overdue: { label: '已逾期', color: 'red' },
                    waived: { label: '已减免', color: 'default' },
                  };
                  const entry = map[record.status] ?? { label: record.status, color: 'default' };
                  return <Tag color={entry.color}>{entry.label}</Tag>;
                },
              },
              {
                title: '催款',
                width: 96,
                render: (_, record) =>
                  record.remindCount > 0 ? (
                    <Tooltip title={`最近 ${relative(record.remindedAt)}`}>
                      <Tag>{record.remindCount} 次</Tag>
                    </Tooltip>
                  ) : (
                    <Text type="secondary">—</Text>
                  ),
              },
              {
                title: '操作',
                width: 190,
                render: (_, record) => (
                  <Space size={4} wrap>
                    {record.status !== 'paid' && (
                      <>
                        <Button
                          size="small"
                          type="primary"
                          icon={<CheckCircleOutlined />}
                          onClick={() => {
                            form.setFieldsValue({ amount: record.amount, method: '', note: '' });
                            setMarking(record);
                          }}
                        >
                          登记收款
                        </Button>
                        <Button size="small" icon={<BellOutlined />} onClick={() => remind(record.id)}>
                          催款
                        </Button>
                      </>
                    )}
                    {record.status === 'paid' && (
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        {dateOnly(record.paidAt)}
                      </Text>
                    )}
                  </Space>
                ),
              },
            ]}
          />
          {rows.length === 0 && (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description="还没有回款记录。把一张报价登记为「成交」后，系统会自动生成形式发票与定金/尾款节点。"
            />
          )}
        </ErrorBoundary>
      </Card>

      <Modal
        open={Boolean(marking)}
        title={`登记收款 · ${marking?.customer?.company ?? ''}`}
        onCancel={() => setMarking(null)}
        okText="确认收款"
        onOk={async () => {
          const values = await form.validateFields();
          try {
            await api.post(`/api/payments/${marking!.id}/paid`, values);
            toast.success('已登记收款');
            setMarking(null);
            reload();
          } catch (error) {
            toast.error(error instanceof Error ? error.message : '登记失败');
          }
        }}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="amount" label="实收金额" rules={[{ required: true }]}>
            <InputNumber style={{ width: '100%' }} min={0} addonBefore={marking?.currency ?? 'USD'} />
          </Form.Item>
          <Form.Item name="method" label="收款方式">
            <Input placeholder="T/T / L/C / PayPal …" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} placeholder="水单号、到账银行等" />
          </Form.Item>
        </Form>
        <Text type="secondary" style={{ fontSize: 12 }}>
          登记后系统会自动推进形式发票状态，并刷新逾期统计。
        </Text>
      </Modal>
    </>
  );
}

export { compactMoney, dayjs, FileProtectOutlined };
