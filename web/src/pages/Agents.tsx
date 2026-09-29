import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Alert,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  List,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  message as toast,
} from 'antd';
import { PauseCircleOutlined, PlayCircleOutlined, ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { api, type AgentBoardEntry, type AgentRun, type AgentTask, type Alert as AlertRow, type Thread } from '../api';
import { useApi, useEventStream } from '../hooks';
import { AgentStatus, RiskTag, TaskStatus, Text, dateTime, ms, percent, relative } from '../ui';
import { PageHeader } from '../components/AppLayout';

export function AgentsPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'team';
  const stream = useEventStream(200);
  const [thread, setThread] = useState<Thread | null>(null);

  const { data: agents, refresh: refreshAgents } = useApi<AgentBoardEntry[]>('/api/agents', { pollMs: 8_000 });
  const { data: tasks, refresh: refreshTasks } = useApi<AgentTask[]>('/api/agents/tasks?limit=120', { pollMs: 6_000 });
  const { data: runs, refresh: refreshRuns } = useApi<AgentRun[]>('/api/agents/runs?limit=120', { pollMs: 10_000 });
  const { data: threads, refresh: refreshThreads } = useApi<Thread[]>('/api/threads?status=open&limit=50', { pollMs: 15_000 });
  const { data: alerts, refresh: refreshAlerts } = useApi<AlertRow[]>('/api/alerts?limit=80', { pollMs: 15_000 });
  const { data: analytics } = useApi<{ byAgent: Array<Record<string, unknown>>; llm: Record<string, unknown> }>(
    '/api/analytics/agents?days=30',
    { pollMs: 60_000 },
  );

  const refreshAll = () => {
    refreshAgents();
    refreshTasks();
    refreshRuns();
    refreshThreads();
    refreshAlerts();
  };

  const lastVersion = useRef(stream.version);
  useEffect(() => {
    if (stream.version === lastVersion.current) return;
    const timer = setTimeout(() => {
      lastVersion.current = stream.version;
      refreshAll();
    }, 1_500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stream.version]);

  const taskStats = useMemo(() => {
    const list = tasks ?? [];
    return {
      queued: list.filter((task) => task.status === 'queued').length,
      running: list.filter((task) => task.status === 'running').length,
      waiting: list.filter((task) => task.status === 'waiting_approval').length,
      dead: list.filter((task) => task.status === 'dead').length,
      failed: list.filter((task) => task.status === 'failed').length,
    };
  }, [tasks]);

  return (
    <>
      <PageHeader
        title="智能体"
        subtitle="三个智能体各司其职，通过事件总线自动接力。每次运行都可审计：触发事件、输入输出、模型、耗时、成本。"
        extra={[
          <Tooltip key="sweep" title="立刻触发一次跟单扫描：到期跟进、即将过期报价、沉默客户">
            <Button
              icon={<ThunderboltOutlined />}
              onClick={async () => {
                await api.post('/api/agents/run', { agent: 'followup', taskType: 'sweep_due', payload: {} });
                toast.success('已触发跟单扫描');
                setTimeout(refreshAll, 1500);
              }}
            >
              手动扫描
            </Button>
          </Tooltip>,
          <Button key="r" icon={<ReloadOutlined />} onClick={refreshAll}>刷新</Button>,
        ]}
      />

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message={
          <Space>
            <Badge status={stream.connected ? 'processing' : 'error'} />
            事件流 {stream.connected ? '已连接' : '已断开'} · 共收到 {stream.events.length} 条事件
          </Space>
        }
        description="智能体之间不直接调用：各自写事件，编排器决定谁接手。所以进程重启后待办不会丢，任务会从队列里自动续跑。"
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="排队中" value={taskStats.queued} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="执行中" value={taskStats.running} valueStyle={{ fontSize: 22, color: '#0b5cad' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="待人工" value={taskStats.waiting} valueStyle={{ fontSize: 22, color: '#d97706' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="死信" value={taskStats.dead} valueStyle={{ fontSize: 22, color: taskStats.dead > 0 ? '#d02f2f' : '#1c7a3d' }} /></Card></Col>
      </Row>

      <Tabs
        activeKey={tab}
        onChange={(key) => setParams({ tab: key })}
        items={[
          {
            key: 'team',
            label: '团队状态',
            children: (
              <>
                <Row gutter={[14, 14]}>
                  {(agents ?? []).map((agent) => (
                    <Col xs={24} lg={8} key={agent.agent}>
                      <Card
                        size="small"
                        styles={{ body: { paddingTop: 14 } }}
                        title={
                          <Space>
                            <span>{agent.agent === 'sales' ? '💼' : agent.agent === 'followup' ? '⏰' : '📦'} {agent.label}</span>
                            <AgentStatus value={agent.status} />
                          </Space>
                        }
                        extra={
                          <Button
                            size="small"
                            type="text"
                            icon={agent.enabled ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
                            onClick={async () => {
                              await api.post(`/api/agents/${agent.agent}/toggle`, { enabled: !agent.enabled });
                              toast.success(`${agent.label} 已${agent.enabled ? '暂停' : '启用'}`);
                              refreshAgents();
                            }}
                          />
                        }
                      >
                        <Text type="secondary" style={{ fontSize: 12 }}>{agent.description}</Text>
                        <Row gutter={[8, 8]} style={{ marginTop: 12 }}>
                          <Col span={12}><Statistic title="已处理" value={agent.processed} valueStyle={{ fontSize: 18 }} /></Col>
                          <Col span={12}><Statistic title="队列" value={agent.queueDepth} valueStyle={{ fontSize: 18 }} /></Col>
                          <Col span={12}><Statistic title="均耗时" value={agent.averageLatencyMs} suffix="ms" valueStyle={{ fontSize: 18 }} /></Col>
                          <Col span={12}><Statistic title="成功率" value={(agent.successRate * 100).toFixed(0)} suffix="%" valueStyle={{ fontSize: 18 }} /></Col>
                        </Row>
                        <div style={{ marginTop: 10 }}>
                          <Text type="secondary" style={{ fontSize: 11.5 }}>可执行任务</Text>
                          <div style={{ marginTop: 4 }}>
                            <Space size={4} wrap>
                              {agent.taskTypes.map((type) => <Tag key={type} className="dt-mono">{type}</Tag>)}
                            </Space>
                          </div>
                        </div>
                        {agent.lastRunAt && (
                          <Text type="secondary" style={{ fontSize: 11.5, display: 'block', marginTop: 8 }}>
                            最近运行 {relative(agent.lastRunAt)}
                          </Text>
                        )}
                      </Card>
                    </Col>
                  ))}
                </Row>

                <Row gutter={[14, 14]} style={{ marginTop: 14 }}>
                  <Col xs={24} lg={14}>
                    <Card size="small" title="成本与用量（30 天）">
                      <Table
                        size="small"
                        rowKey="agent"
                        pagination={false}
                        dataSource={(analytics?.byAgent ?? []) as Array<Record<string, unknown>>}
                        columns={[
                          { title: '智能体', dataIndex: 'label' },
                          { title: '运行次数', dataIndex: 'runs', align: 'right', width: 100 },
                          { title: '失败', dataIndex: 'failed', align: 'right', width: 80 },
                          { title: '均耗时', dataIndex: 'avgLatencyMs', align: 'right', width: 100, render: (v: number) => ms(v) },
                          { title: 'Tokens', dataIndex: 'tokens', align: 'right', width: 100, render: (v: number) => Number(v).toLocaleString() },
                          { title: '成本', dataIndex: 'costUsd', align: 'right', width: 110, render: (v: number) => `$${Number(v).toFixed(4)}` },
                        ]}
                      />
                    </Card>
                  </Col>
                  <Col xs={24} lg={10}>
                    <Card size="small" title="业务对齐群（自动升级）">
                      {(threads ?? []).length === 0 ? (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无需要人工对齐的事项" />
                      ) : (
                        <List
                          size="small"
                          dataSource={threads ?? []}
                          renderItem={(item) => (
                            <List.Item
                              style={{ cursor: 'pointer' }}
                              onClick={async () => setThread(await api.get<Thread>(`/api/threads/${item.id}`))}
                            >
                              <div style={{ width: '100%' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                  <Text style={{ fontSize: 12.5 }} ellipsis>{item.subject}</Text>
                                  <RiskTag value={item.severity} />
                                </div>
                                <Text type="secondary" style={{ fontSize: 11 }}>
                                  {item.topic ?? ''} · {relative(item.updatedAt)}
                                </Text>
                              </div>
                            </List.Item>
                          )}
                        />
                      )}
                    </Card>
                  </Col>
                </Row>
              </>
            ),
          },
          {
            key: 'tasks',
            label: `任务队列 (${(tasks ?? []).length})`,
            children: (
              <Card size="small">
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={tasks ?? []}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 1080 }}
                  columns={[
                    { title: '智能体', dataIndex: 'agent', width: 96, render: (v: string) => <Tag color="blue">{v}</Tag> },
                    { title: '任务类型', dataIndex: 'taskType', width: 180, className: 'dt-mono' },
                    { title: '状态', dataIndex: 'status', width: 100, render: (v: string) => <TaskStatus value={v} /> },
                    {
                      title: '尝试',
                      width: 80,
                      align: 'right',
                      render: (_, record) => `${record.attempts}/${record.maxAttempts}`,
                    },
                    {
                      title: '等待时间',
                      width: 110,
                      render: (_, record) =>
                        record.status === 'queued' ? (
                          <Text type="secondary">{relative(record.runAfter)}</Text>
                        ) : (
                          <Text type="secondary">{ms(record.durationMs)}</Text>
                        ),
                    },
                    {
                      title: '载荷 / 结果',
                      render: (_, record) => (
                        <Text type="secondary" className="dt-mono" style={{ fontSize: 11.5 }}>
                          {record.lastError ?? JSON.stringify(record.result ?? record.payload).slice(0, 130)}
                        </Text>
                      ),
                    },
                    { title: '创建', width: 90, render: (_, record) => <Text type="secondary" style={{ fontSize: 11.5 }}>{relative(record.createdAt)}</Text> },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'runs',
            label: `运行记录 (${(runs ?? []).length})`,
            children: (
              <Card size="small">
                <Table
                  size="small"
                  rowKey="id"
                  dataSource={runs ?? []}
                  pagination={{ pageSize: 20, showSizeChanger: false }}
                  scroll={{ x: 980 }}
                  expandable={{
                    expandedRowRender: (record) => (
                      <pre className="dt-mono" style={{ margin: 0, whiteSpace: 'pre-wrap', maxHeight: 260, overflow: 'auto' }}>
                        {JSON.stringify({ input: record.input, output: record.output }, null, 2)}
                      </pre>
                    ),
                  }}
                  columns={[
                    { title: '智能体', dataIndex: 'agent', width: 96, render: (v: string) => <Tag color="blue">{v}</Tag> },
                    {
                      title: '状态',
                      dataIndex: 'status',
                      width: 110,
                      render: (v: string) => (
                        <Tag color={v === 'succeeded' ? 'green' : v === 'waiting_approval' ? 'orange' : v === 'failed' ? 'red' : 'blue'}>
                          {v === 'succeeded' ? '成功' : v === 'waiting_approval' ? '待人工' : v === 'failed' ? '失败' : '执行中'}
                        </Tag>
                      ),
                    },
                    {
                      title: '结果摘要',
                      render: (_, record) => (
                        <Text style={{ fontSize: 12.5 }}>
                          {String((record.output as { summary?: string })?.summary ?? record.error ?? '—')}
                        </Text>
                      ),
                    },
                    { title: '模型', width: 150, render: (_, record) => <Text className="dt-mono" style={{ fontSize: 11 }}>{record.provider}/{record.model ?? '—'}</Text> },
                    { title: 'Tokens', width: 96, align: 'right', render: (_, record) => (record.tokensIn + record.tokensOut).toLocaleString() },
                    { title: '耗时', width: 90, align: 'right', render: (_, record) => ms(record.latencyMs) },
                    { title: '时间', width: 96, render: (_, record) => <Text type="secondary" style={{ fontSize: 11.5 }}>{relative(record.startedAt)}</Text> },
                  ]}
                />
              </Card>
            ),
          },
          {
            key: 'events',
            label: `事件流 (${stream.events.length})`,
            children: (
              <Card size="small">
                <Timeline
                  items={stream.events.slice(0, 80).map((event) => ({
                    color: event.type.includes('failed') || event.type.includes('dead') ? 'red' : event.actor.startsWith('agent') ? 'blue' : 'gray',
                    children: (
                      <div>
                        <Space size={6} wrap>
                          <Text style={{ fontSize: 12.5 }}>{event.subject ?? event.type}</Text>
                          <Tag style={{ marginInlineEnd: 0 }} color={event.actor.startsWith('agent') ? 'blue' : 'default'}>{event.actor}</Tag>
                          <Text type="secondary" className="dt-mono" style={{ fontSize: 10.5 }}>{event.type}</Text>
                        </Space>
                        <div>
                          <Text type="secondary" style={{ fontSize: 11 }}>{dateTime(event.createdAt)}</Text>
                        </div>
                      </div>
                    ),
                  }))}
                />
                {stream.events.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="等待事件…" />}
              </Card>
            ),
          },
          {
            key: 'alerts',
            label: `预警 (${(alerts ?? []).length})`,
            children: (
              <Card size="small">
                {(alerts ?? []).length === 0 ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无未处理预警" />
                ) : (
                  <List
                    dataSource={alerts ?? []}
                    renderItem={(alert) => (
                      <List.Item
                        actions={[
                          <Button
                            key="ack"
                            size="small"
                            onClick={async () => {
                              await api.post(`/api/alerts/${alert.id}/ack`);
                              toast.success('已确认');
                              refreshAlerts();
                            }}
                          >
                            确认
                          </Button>,
                        ]}
                      >
                        <List.Item.Meta
                          title={
                            <Space>
                              <RiskTag value={alert.severity} />
                              <span>{alert.title}</span>
                            </Space>
                          }
                          description={
                            <div>
                              <div style={{ fontSize: 12.5 }}>{alert.body}</div>
                              <Text type="secondary" style={{ fontSize: 11 }}>{dateTime(alert.createdAt)} · {alert.type}</Text>
                            </div>
                          }
                        />
                      </List.Item>
                    )}
                  />
                )}
              </Card>
            ),
          },
        ]}
      />

      <Drawer width={680} open={Boolean(thread)} onClose={() => setThread(null)} title={thread?.subject}>
        {thread && (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="主题">{thread.topic ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="等级"><RiskTag value={thread.severity} /></Descriptions.Item>
              <Descriptions.Item label="创建者">{thread.createdBy}</Descriptions.Item>
              <Descriptions.Item label="更新时间">{relative(thread.updatedAt)}</Descriptions.Item>
            </Descriptions>
            <div style={{ maxHeight: 420, overflow: 'auto', marginBottom: 12 }}>
              {(thread.messages ?? []).map((message) => (
                <div key={message.id} className="dt-chat-bubble">
                  <div style={{ marginBottom: 4 }}>
                    <Tag color={message.author.startsWith('agent') ? 'blue' : 'default'}>{message.author}</Tag>
                    <Text type="secondary" style={{ fontSize: 11 }}>{dateTime(message.createdAt)}</Text>
                  </div>
                  {message.body}
                </div>
              ))}
            </div>
            <Space.Compact style={{ width: '100%' }}>
              <input
                id="dt-thread-input"
                placeholder="回复对齐群…"
                style={{ flex: 1, padding: '5px 11px', border: '1px solid #d9d9d9', borderRadius: '8px 0 0 8px', fontSize: 13 }}
                onKeyDown={async (event) => {
                  if (event.key !== 'Enter') return;
                  const value = (event.target as HTMLInputElement).value;
                  if (!value.trim()) return;
                  const updated = await api.post<Thread>(`/api/threads/${thread.id}/messages`, { body: value });
                  setThread(updated);
                  (event.target as HTMLInputElement).value = '';
                }}
              />
              <Button
                type="primary"
                onClick={async () => {
                  const input = document.getElementById('dt-thread-input') as HTMLInputElement | null;
                  if (!input?.value.trim()) return;
                  const updated = await api.post<Thread>(`/api/threads/${thread.id}/messages`, { body: input.value });
                  setThread(updated);
                  input.value = '';
                }}
              >
                发送
              </Button>
            </Space.Compact>
            <Button
              style={{ marginTop: 10 }}
              block
              onClick={async () => {
                await api.post(`/api/threads/${thread.id}/resolve`);
                toast.success('已标记解决');
                setThread(null);
                refreshThreads();
              }}
            >
              标记为已解决
            </Button>
          </>
        )}
      </Drawer>
    </>
  );
}

export { dayjs, Progress, percent };
