import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Timeline,
  message as toast,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { api, type Customer } from '../api';
import { useApi } from '../hooks';
import { Field, LanguageTag, MarginBadge, QuoteStatus, Text, compactMoney, dateTime, money, percent, relative } from '../ui';
import { PageHeader } from '../components/AppLayout';

export function CustomersPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string | null>(id ?? null);

  const { data: customers, loading, refresh } = useApi<Customer[]>(
    `/api/customers?status=${status}&limit=300${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { pollMs: 40_000 },
  );
  const { data: detail, refresh: refreshDetail } = useApi<Customer & {
    history: Array<Record<string, unknown>>;
    inquiries: Array<Record<string, unknown>>;
    quotes: Array<Record<string, unknown>>;
  }>(selected ? `/api/customers/${selected}` : null);

  const totals = useMemo(() => {
    const list = customers ?? [];
    return {
      count: list.length,
      quoted: list.reduce((sum, customer) => sum + (customer.stats?.quotedValue ?? 0), 0),
      won: list.reduce((sum, customer) => sum + (customer.stats?.wonValue ?? 0), 0),
      wonCount: list.reduce((sum, customer) => sum + (customer.stats?.won ?? 0), 0),
    };
  }, [customers]);

  return (
    <>
      <PageHeader
        title="客户库"
        subtitle="Sales Agent 自动建档，成交与丢单结果回流到客户画像，用于判断哪些市场值得追加投入"
        extra={[
          <Button key="new" icon={<PlusOutlined />} onClick={() => toast.info('可在询盘箱「粘贴新询盘」中顺手建档，或调用 POST /api/customers')}>
            新建客户
          </Button>,
          <Button key="r" icon={<ReloadOutlined />} loading={loading} onClick={() => { refresh(); refreshDetail(); }}>刷新</Button>,
        ]}
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="客户数" value={totals.count} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="累计报价额" value={totals.quoted} precision={0} prefix="$" valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="累计成交额" value={totals.won} precision={0} prefix="$" valueStyle={{ fontSize: 22, color: '#1c7a3d' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="成交单数" value={totals.wonCount} valueStyle={{ fontSize: 22, color: '#1c7a3d' }} /></Card></Col>
      </Row>

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={status}
            onChange={(value) => setStatus(String(value))}
            options={[
              { label: '全部', value: 'all' },
              { label: '线索', value: 'lead' },
              { label: '跟进中', value: 'prospect' },
              { label: '活跃', value: 'active' },
              { label: '沉睡', value: 'dormant' },
            ]}
          />
          <Input.Search allowClear placeholder="搜索公司 / 联系人 / 邮箱" style={{ width: 260 }} onSearch={setSearch} />
        </Space>

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={customers ?? []}
          scroll={{ x: 1100 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          onRow={(record) => ({
            onClick: () => { setSelected(record.id); navigate(`/customers/${record.id}`); },
            style: { cursor: 'pointer' },
          })}
          columns={[
            {
              title: '公司',
              width: 240,
              render: (_, record) => (
                <div>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>{record.company}</div>
                  <Text type="secondary" style={{ fontSize: 11.5 }}>
                    {record.contactName ?? ''} {record.email ?? ''}
                  </Text>
                </div>
              ),
            },
            { title: '市场', width: 130, render: (_, record) => <span>{record.country ?? '—'} {record.countryCode && <Tag>{record.countryCode}</Tag>}</span> },
            { title: '语言', width: 92, render: (_, record) => <LanguageTag value={record.language} /> },
            { title: '状态', width: 84, render: (_, record) => <Tag color={record.status === 'active' ? 'green' : record.status === 'lead' ? 'blue' : 'default'}>{record.status}</Tag> },
            { title: '询盘', width: 66, align: 'right', render: (_, record) => record.stats?.inquiries ?? 0 },
            { title: '报价', width: 66, align: 'right', render: (_, record) => record.stats?.quotes ?? 0 },
            {
              title: '报价额',
              width: 130,
              align: 'right',
              render: (_, record) => compactMoney(record.stats?.quotedValue ?? 0),
            },
            {
              title: '成交率',
              width: 130,
              render: (_, record) => (
                <Progress
                  percent={Number(((record.stats?.winRate ?? 0) * 100).toFixed(0))}
                  size="small"
                  strokeColor={(record.stats?.winRate ?? 0) >= 0.5 ? '#1c7a3d' : '#0b5cad'}
                />
              ),
            },
            { title: '最近联系', width: 104, render: (_, record) => <Text type="secondary" style={{ fontSize: 12 }}>{relative(record.stats?.lastContactAt)}</Text> },
          ]}
        />
      </Card>

      <Drawer
        width={880}
        open={Boolean(selected)}
        onClose={() => { setSelected(null); navigate('/customers'); }}
        title={detail ? `${detail.company} · ${detail.country ?? ''}` : '客户详情'}
      >
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 14 }}>
              <Descriptions.Item label="联系人">{detail.contactName ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="语言"><LanguageTag value={detail.language} /></Descriptions.Item>
              <Descriptions.Item label="邮箱">{detail.email ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="电话">{detail.phone ?? detail.whatsapp ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="来源">{detail.source}</Descriptions.Item>
              <Descriptions.Item label="建档时间">{dateTime(detail.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="累计报价">{money(detail.stats?.quotedValue ?? 0)}</Descriptions.Item>
              <Descriptions.Item label="累计成交">{money(detail.stats?.wonValue ?? 0)}</Descriptions.Item>
            </Descriptions>

            <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
              <Col span={8}><Card size="small"><Statistic title="询盘数" value={detail.stats?.inquiries ?? 0} valueStyle={{ fontSize: 20 }} /></Card></Col>
              <Col span={8}><Card size="small"><Statistic title="报价数" value={detail.stats?.quotes ?? 0} valueStyle={{ fontSize: 20 }} /></Card></Col>
              <Col span={8}>
                <Card size="small">
                  <Statistic
                    title="成交率"
                    value={percent(detail.stats?.winRate ?? 0)}
                    valueStyle={{ fontSize: 20, color: '#1c7a3d' }}
                  />
                </Card>
              </Col>
            </Row>

            <Card size="small" title="报价记录" style={{ marginBottom: 14 }}>
              {(detail.quotes ?? []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有报价" />
              ) : (
                <Table
                  size="small"
                  rowKey="id"
                  pagination={false}
                  dataSource={detail.quotes as Array<Record<string, unknown>>}
                  columns={[
                    {
                      title: '单号',
                      dataIndex: 'quoteNo',
                      render: (value: string, record: Record<string, unknown>) => <a href={`/quotes/${record.id}`}>{value}</a>,
                    },
                    { title: '状态', dataIndex: 'status', render: (value: string) => <QuoteStatus value={value} /> },
                    { title: '总额', dataIndex: 'total', align: 'right', render: (value: number, record: Record<string, unknown>) => money(value, String(record.currency)) },
                    { title: '毛利', dataIndex: 'marginPct', width: 78, render: (value: number) => <MarginBadge value={value} /> },
                    { title: '日期', dataIndex: 'createdAt', width: 100, render: (value: string) => dateTime(value).slice(0, 10) },
                  ]}
                />
              )}
            </Card>

            <Card size="small" title="业务时间线">
              <Timeline
                items={(detail.history ?? []).slice(0, 20).map((entry) => ({
                  color: entry.kind === 'quote' ? 'blue' : entry.kind === 'inquiry' ? 'gray' : 'green',
                  children: (
                    <div>
                      <Space size={6}>
                        <Tag style={{ marginInlineEnd: 0 }}>{String(entry.kind)}</Tag>
                        <Text style={{ fontSize: 12.5 }}>{String(entry.ref)}</Text>
                        {entry.amount !== null && entry.amount !== undefined && (
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {money(Number(entry.amount), String(entry.currency ?? 'USD'))}
                          </Text>
                        )}
                      </Space>
                      <div>
                        <Text type="secondary" style={{ fontSize: 11 }}>{dateTime(String(entry.at))}</Text>
                      </div>
                    </div>
                  ),
                }))}
              />
            </Card>

            <div style={{ marginTop: 12 }}>
              <Field label="企业偏好" block>
                <pre className="dt-mono" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(detail.preferences ?? {}, null, 2)}
                </pre>
              </Field>
            </div>
          </>
        )}
      </Drawer>
    </>
  );
}
