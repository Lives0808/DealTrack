import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Empty,
  Input,
  List,
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
  ClockCircleOutlined,
  EditOutlined,
  ReloadOutlined,
  SendOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, type Followup, type Quote } from '../api';
import { useApi } from '../hooks';
import {
  FollowupStatus,
  LanguageTag,
  MarginBadge,
  Text,
  Truncated,
  dateTime,
  money,
  relative,
} from '../ui';
import { PageHeader } from '../components/AppLayout';

export function FollowupsPage() {
  const [status, setStatus] = useState('scheduled');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Followup | null>(null);

  const { data: followups, loading, refresh } = useApi<Followup[]>(
    `/api/followups?status=${status}&limit=200`,
    { pollMs: 20_000 },
  );
  const { data: stats } = useApi<Record<string, number>>('/api/followups/stats', { pollMs: 20_000 });

  const filtered = useMemo(() => {
    const list = followups ?? [];
    if (!search.trim()) return list;
    const needle = search.trim().toLowerCase();
    return list.filter((item) =>
      [item.customer?.company, item.quote?.quoteNo, item.subject, item.reason]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle)),
    );
  }, [followups, search]);

  const overdue = (followups ?? []).filter((item) => new Date(item.dueAt) < new Date());

  const act = async (key: string, fn: () => Promise<unknown>, text: string) => {
    try {
      await fn();
      toast.success(text);
      setTimeout(refresh, 800);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作失败');
      void key;
    }
  };

  return (
    <>
      <PageHeader
        title="跟进看板"
        subtitle="报价一发出，跟进节奏就已排定（默认 D+3 / D+7 / D+14 / D+30）。客户回复自动停止催问，沉默超阈值自动拉业务对齐群。"
        extra={[<Button key="r" icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button>]}
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="已排程" value={stats?.scheduled ?? 0} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="今日到期" value={stats?.dueToday ?? 0} valueStyle={{ fontSize: 22, color: '#0b5cad' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="已逾期" value={stats?.overdue ?? 0} valueStyle={{ fontSize: 22, color: (stats?.overdue ?? 0) > 0 ? '#d02f2f' : '#1c7a3d' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="客户已回复" value={stats?.replied ?? 0} valueStyle={{ fontSize: 22, color: '#1c7a3d' }} /></Card></Col>
      </Row>

      {overdue.length > 0 && status === 'scheduled' && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 14 }}
          message={`${overdue.length} 条跟进已逾期`}
          description="逾期意味着这批报价正在失去温度。点「起草」让跟单智能体立刻生成催问内容，或直接「发送」。"
        />
      )}

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Segmented
            value={status}
            onChange={(value) => setStatus(String(value))}
            options={[
              { label: '待跟进', value: 'scheduled' },
              { label: '待确认', value: 'pending_approval' },
              { label: '已发出', value: 'sent' },
              { label: '客户已回', value: 'replied' },
              { label: '全部', value: 'all' },
            ]}
          />
          <Input.Search allowClear placeholder="搜索客户 / 报价单号" style={{ width: 240 }} onSearch={setSearch} />
        </Space>

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={filtered}
          scroll={{ x: 1120 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          columns={[
            {
              title: '到期时间',
              width: 150,
              render: (_, record) => {
                const isOverdue = new Date(record.dueAt) < new Date();
                return (
                  <div>
                    <Space size={4}>
                      {isOverdue && <ClockCircleOutlined style={{ color: '#d02f2f' }} />}
                      <Text style={{ fontSize: 12.5, color: isOverdue ? '#d02f2f' : undefined }}>
                        {dateTime(record.dueAt)}
                      </Text>
                    </Space>
                    <div>
                      <Text type="secondary" style={{ fontSize: 11 }}>{relative(record.dueAt)}</Text>
                    </div>
                  </div>
                );
              },
            },
            {
              title: '客户 / 报价',
              width: 220,
              render: (_, record) => (
                <div>
                  <div style={{ fontSize: 12.5 }}>
                    {record.customer?.company ?? '—'}{' '}
                    <LanguageTag value={record.language} />
                  </div>
                  {record.quote && (
                    <Link to={`/quotes/${record.quote.id}`}>
                      <Text type="secondary" className="dt-mono">{record.quote.quoteNo}</Text>{' '}
                      <Text type="secondary" style={{ fontSize: 11 }}>
                        {money(record.quote.total, record.quote.currency)} <MarginBadge value={record.quote.marginPct} />
                      </Text>
                    </Link>
                  )}
                </div>
              ),
            },
            {
              title: '跟进内容',
              render: (_, record) => (
                <div>
                  <Space size={6}>
                    <Tag color="blue">第 {record.sequenceNo} 次</Tag>
                    {record.subject ? <Text style={{ fontSize: 12.5 }}>{record.subject}</Text> : <Text type="secondary" style={{ fontSize: 12 }}>{record.reason ?? '—'}</Text>}
                  </Space>
                  {record.body && (
                    <div style={{ marginTop: 2 }}>
                      <Text type="secondary" style={{ fontSize: 11.5 }}>
                        <Truncated text={record.body} width={420} />
                      </Text>
                    </div>
                  )}
                </div>
              ),
            },
            { title: '状态', width: 96, render: (_, record) => <FollowupStatus value={record.status} /> },
            {
              title: '操作',
              width: 232,
              render: (_, record) => (
                <Space size={4} wrap onClick={(event) => event.stopPropagation()}>
                  {['scheduled', 'pending_approval'].includes(record.status) && (
                    <>
                      <Button
                        size="small"
                        icon={<ThunderboltOutlined />}
                        onClick={() => act('draft', () => api.post(`/api/followups/${record.id}/draft`), '跟单智能体正在起草跟进内容')}
                      >
                        起草
                      </Button>
                      <Tooltip title="按照当前草稿立即发送（未配置 SMTP 时为模拟发送）">
                        <Button
                          size="small"
                          type="primary"
                          icon={<SendOutlined />}
                          onClick={() => act('send', () => api.post(`/api/followups/${record.id}/send`), '已排入发送队列')}
                        >
                          发送
                        </Button>
                      </Tooltip>
                      <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(record)}>
                        延后
                      </Button>
                      <Tooltip title="跳过本次跟进">
                        <Button size="small" onClick={() => act('skip', () => api.post(`/api/followups/${record.id}/skip`, { reason: '人工跳过' }), '已跳过')}>
                          跳过
                        </Button>
                      </Tooltip>
                    </>
                  )}
                  {record.inquiryId && (
                    <Link to={`/inbox/${record.inquiryId}`}>
                      <Button size="small" type="link">询盘</Button>
                    </Link>
                  )}
                </Space>
              ),
            },
          ]}
        />

        {(followups ?? []).length === 0 && status === 'scheduled' && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无待跟进。给一张报价单点「批准并发送」后，系统会自动排好整条跟进节奏。"
          />
        )}
      </Card>

      <Modal
        open={Boolean(editing)}
        title={`延后跟进 · ${editing?.customer?.company ?? ''}`}
        onCancel={() => setEditing(null)}
        footer={[
          <Button key="cancel" onClick={() => setEditing(null)}>取消</Button>,
          ...[3, 7, 14].map((days) => (
            <Button
              key={days}
              type="primary"
              onClick={async () => {
                await api.post(`/api/followups/${editing!.id}/snooze`, { days });
                toast.success(`已延后 ${days} 天`);
                setEditing(null);
                refresh();
              }}
            >
              延后 {days} 天
            </Button>
          )),
        ]}
      >
        <Text type="secondary">
          延后会同时调整到期时间，并保留跟进序号，避免同一条报价出现重复催问。
        </Text>
      </Modal>
    </>
  );
}

export { Badge, List, Quote };
