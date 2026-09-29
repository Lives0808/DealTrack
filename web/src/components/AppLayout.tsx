import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Badge, Button, Dropdown, Empty, Layout, Menu, Space, Tag, Tooltip, Typography, message as toast } from 'antd';
import {
  AppstoreOutlined,
  BookOutlined,
  BulbOutlined,
  DashboardOutlined,
  DollarOutlined,
  InboxOutlined,
  LogoutOutlined,
  RobotOutlined,
  ScheduleOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltFilled,
  UserOutlined,
} from '@ant-design/icons';
import { api, getActor, setActor, type AgentBoardEntry, type Overview } from '../api';
import { useEventStream } from '../hooks';
import { AgentStatus, Text, dateTime } from '../ui';

const { Sider, Header, Content } = Layout;

const NAV = [
  { key: '/', icon: <DashboardOutlined />, label: '老板看板' },
  { key: '/inbox', icon: <InboxOutlined />, label: '询盘箱' },
  { key: '/quotes', icon: <DollarOutlined />, label: '报价单' },
  { key: '/followups', icon: <ScheduleOutlined />, label: '跟进看板' },
  { key: '/customers', icon: <UserOutlined />, label: '客户库' },
  { key: '/products', icon: <AppstoreOutlined />, label: '产品库' },
  { key: '/playbooks', icon: <BookOutlined />, label: '话术库' },
  { key: '/agents', icon: <RobotOutlined />, label: '智能体' },
  { key: '/settings', icon: <SettingOutlined />, label: '设置' },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(false);
  const [agents, setAgents] = useState<AgentBoardEntry[]>([]);
  const [lastEvent, setLastEvent] = useState<string | null>(null);
  const stream = useEventStream(60);

  const activeKey = useMemo(() => {
    const match = NAV.map((item) => item.key)
      .filter((key) => key !== '/' && location.pathname.startsWith(key))
      .sort((a, b) => b.length - a.length)[0];
    return match ?? '/';
  }, [location.pathname]);

  // The sidebar's agent lights and risk badge refresh on a slow interval; the
  // SSE feed below is what makes the page itself feel alive.
  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .get<Overview>('/api/overview?days=30')
        .then((data) => {
          if (!cancelled) setAgents(data.agents);
        })
        .catch(() => undefined);
    void load();
    const timer = setInterval(load, 12_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [stream.version]);

  useEffect(() => {
    const latest = stream.events[0];
    if (latest) setLastEvent(`${latest.subject ?? latest.type} · ${dateTime(latest.createdAt)}`);
  }, [stream.events]);

  const busy = agents.filter((agent) => agent.status === 'busy');

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        theme="light"
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={216}
        style={{ borderRight: '1px solid #e9edf2', position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
      >
        <div
          style={{
            padding: collapsed ? '18px 0' : '18px 20px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: collapsed ? 'center' : 'flex-start',
          }}
        >
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 9,
              background: 'linear-gradient(135deg,#0b5cad,#2e9bd6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
              flex: '0 0 auto',
            }}
          >
            <ThunderboltFilled />
          </div>
          {!collapsed && (
            <div style={{ lineHeight: 1.15 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>DealTrack</div>
              <div style={{ fontSize: 10.5, color: '#8b949f' }}>数字外贸团队</div>
            </div>
          )}
        </div>

        <Menu
          mode="inline"
          selectedKeys={[activeKey]}
          style={{ borderInlineEnd: 'none', paddingBottom: 8 }}
          items={NAV.map((item) => ({
            ...item,
            label: <Link to={item.key}>{item.label}</Link>,
          }))}
        />

        {!collapsed && (
          <div style={{ padding: '8px 16px 20px' }}>
            <div style={{ fontSize: 10.5, color: '#a0a8b3', letterSpacing: '.08em', marginBottom: 8 }}>
              智能体状态
            </div>
            {agents.length === 0 && <Text type="secondary" style={{ fontSize: 12 }}>加载中…</Text>}
            {agents.map((agent) => (
              <div
                key={agent.agent}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}
              >
                <span style={{ fontSize: 12.5 }}>
                  {agent.status === 'busy' ? '⚡' : '·'} {agent.label}
                </span>
                <Tooltip title={`已处理 ${agent.processed} · 队列 ${agent.queueDepth}`}>
                  <span>
                    <AgentStatus value={agent.status} />
                  </span>
                </Tooltip>
              </div>
            ))}
          </div>
        )}
      </Sider>

      <Layout>
        <Header
          style={{
            background: '#fff',
            borderBottom: '1px solid #e9edf2',
            padding: '0 20px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            height: 54,
            position: 'sticky',
            top: 0,
            zIndex: 20,
          }}
        >
          <Space size={10}>
            <Tooltip title={stream.connected ? '实时事件流已连接' : '实时事件流断开，正在重连'}>
              <Badge status={stream.connected ? 'processing' : 'error'} text={<span style={{ fontSize: 12 }}>{stream.connected ? '实时' : '离线'}</span>} />
            </Tooltip>
            {busy.length > 0 && (
              <Tag color="blue" style={{ marginInlineEnd: 0 }}>
                {busy.map((agent) => agent.label).join('、')} 正在工作
              </Tag>
            )}
            <Text type="secondary" style={{ fontSize: 12, maxWidth: 520 }} ellipsis={{ tooltip: lastEvent }}>
              {lastEvent ?? '等待事件…'}
            </Text>
          </Space>

          <Space size={8}>
            <Dropdown
              menu={{
                items: ['user:boss', 'user:ops', 'user:sales'].map((actor) => ({
                  key: actor,
                  label: actor.split(':')[1],
                })),
                onClick: ({ key }) => {
                  setActor(key);
                  toast.success(`已切换操作身份：${key.split(':')[1]}`);
                  navigate(0);
                },
              }}
            >
              <Button size="small" icon={<TeamOutlined />}>
                {getActor().split(':')[1] ?? 'ops'}
              </Button>
            </Dropdown>
            <Tooltip title="退出（清除本地 Token）">
              <Button
                size="small"
                icon={<LogoutOutlined />}
                onClick={() => {
                  localStorage.removeItem('dealtrack.token');
                  navigate(0);
                }}
              />
            </Tooltip>
          </Space>
        </Header>

        <Content style={{ padding: 20, maxWidth: 1680, width: '100%', margin: '0 auto' }}>{children}</Content>
      </Layout>
    </Layout>
  );
}

export function PageHeader({
  title,
  subtitle,
  extra,
}: {
  title: string;
  subtitle?: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 16 }}>
      <div>
        <Typography.Title level={4} style={{ margin: 0 }}>
          {title}
        </Typography.Title>
        {subtitle && (
          <Typography.Text type="secondary" style={{ fontSize: 12.5 }}>
            {subtitle}
          </Typography.Text>
        )}
      </div>
      {extra && <Space wrap>{extra}</Space>}
    </div>
  );
}

export function EmptyHint({ description }: { description: string }) {
  return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description} style={{ padding: '32px 0' }} />;
}

export { BulbOutlined };
