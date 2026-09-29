import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tag,
  Tooltip,
  message as toast,
} from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined, TrophyOutlined } from '@ant-design/icons';
import { api, type Playbook } from '../api';
import { useApi } from '../hooks';
import { Text, percent } from '../ui';
import { PageHeader } from '../components/AppLayout';

const STAGES = [
  { value: 'first_reply', label: '首封回复', hint: '收到询盘后的第一封，目标是拿到数量、目的港和认证要求' },
  { value: 'quote_cover', label: '报价封面', hint: '随报价单一起发出的说明邮件' },
  { value: 'quote_followup', label: '跟进·第 1 次 (D+3)', hint: '温和确认，不提价' },
  { value: 'followup_2', label: '跟进·第 2 次 (D+7)', hint: '主动提出可调整规格/包装/付款方式' },
  { value: 'followup_3', label: '跟进·第 3 次 (D+14)', hint: '礼貌收尾，留门' },
  { value: 'reengagement', label: '沉默唤醒 (D+30)', hint: '放下压力，顺便收集丢单原因' },
  { value: 'objection_price', label: '价格异议', hint: '拆解成本 + 给出两条降本路径' },
  { value: 'objection_leadtime', label: '交期异议', hint: '缓冲库存与排产调整' },
  { value: 'thank_you', label: '成交致谢', hint: '成交后的第一封，建立复购' },
];

export function PlaybooksPage() {
  const [editing, setEditing] = useState<Playbook | null>(null);
  const [creating, setCreating] = useState(false);
  const [stage, setStage] = useState<string | undefined>();

  const { data: playbooks, loading, refresh } = useApi<Playbook[]>(
    `/api/playbooks?activeOnly=false${stage ? `&stage=${stage}` : ''}`,
  );

  const stats = useMemo(() => {
    const list = playbooks ?? [];
    return {
      count: list.length,
      usage: list.reduce((sum, book) => sum + book.usageCount, 0),
      replies: list.reduce((sum, book) => sum + book.replyCount, 0),
      wins: list.reduce((sum, book) => sum + book.winCount, 0),
    };
  }, [playbooks]);

  const grouped = useMemo(() => {
    const map = new Map<string, Playbook[]>();
    for (const book of playbooks ?? []) {
      if (!map.has(book.stage)) map.set(book.stage, []);
      map.get(book.stage)!.push(book);
    }
    return STAGES.filter((entry) => map.has(entry.value)).map((entry) => ({
      ...entry,
      books: map.get(entry.value)!,
    }));
  }, [playbooks]);

  return (
    <>
      <PageHeader
        title="话术库"
        subtitle="智能体起草时会自动挑选命中率最高的话术作为骨架，再按客户语言个性化。成交与回复会回流到这里的命中率。"
        extra={[
          <Select
            key="stage"
            allowClear
            placeholder="按阶段筛选"
            style={{ width: 190 }}
            value={stage}
            onChange={setStage}
            options={STAGES.map((entry) => ({ label: entry.label, value: entry.value }))}
          />,
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建话术</Button>,
          <Button key="r" icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button>,
        ]}
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="话术条数" value={stats.count} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="累计使用" value={stats.usage} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="带来回复" value={stats.replies} valueStyle={{ fontSize: 22, color: '#0b5cad' }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="带来成交" value={stats.wins} valueStyle={{ fontSize: 22, color: '#1c7a3d' }} /></Card></Col>
      </Row>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 14 }}
        message="模板变量"
        description={
          <span>
            可用变量：<Text code>{'{code}'}</Text> <Text code>{'{company}'}</Text> <Text code>{'{contact_name}'}</Text>{' '}
            <Text code>{'{sender_name}'}</Text> <Text code>{'{currency}'}</Text> <Text code>{'{total}'}</Text>{' '}
            <Text code>{'{incoterm}'}</Text> <Text code>{'{port}'}</Text> <Text code>{'{lead_time}'}</Text>{' '}
            <Text code>{'{payment_terms}'}</Text> <Text code>{'{valid_until}'}</Text> <Text code>{'{product_list}'}</Text>
          </span>
        }
      />

      {grouped.length === 0 ? (
        <Card size="small"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有话术" /></Card>
      ) : (
        <Collapse
          defaultActiveKey={grouped.map((entry) => entry.value)}
          items={grouped.map((entry) => ({
            key: entry.value,
            label: (
              <Space>
                <Text strong>{entry.label}</Text>
                <Tag>{entry.books.length} 条</Tag>
                <Text type="secondary" style={{ fontSize: 12 }}>{entry.hint}</Text>
              </Space>
            ),
            children: (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={entry.books}
                columns={[
                  { title: '名称', dataIndex: 'name', width: 220 },
                  { title: '语言', dataIndex: 'language', width: 76, render: (v: string) => <Tag color="cyan">{v.toUpperCase()}</Tag> },
                  {
                    title: '主题模板',
                    dataIndex: 'subjectTpl',
                    render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v ?? '—'}</Text>,
                  },
                  {
                    title: '使用/回复/成交',
                    width: 150,
                    render: (_, record) => (
                      <Space size={6}>
                        <Tag>{record.usageCount}</Tag>
                        <Tag color="blue">{record.replyCount}</Tag>
                        <Tag color="green" icon={<TrophyOutlined />}>{record.winCount}</Tag>
                        {record.usageCount > 0 && (
                          <Text type="secondary" style={{ fontSize: 11 }}>
                            回复率 {percent(record.replyCount / record.usageCount, 0)}
                          </Text>
                        )}
                      </Space>
                    ),
                  },
                  {
                    title: '操作',
                    width: 76,
                    render: (_, record) => (
                      <Tooltip title="编辑">
                        <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(record)} />
                      </Tooltip>
                    ),
                  },
                ]}
                expandable={{
                  expandedRowRender: (record) => <div className="dt-quote-body">{record.bodyTpl}</div>,
                }}
              />
            ),
          }))}
        />
      )}

      <PlaybookModal
        open={creating || Boolean(editing)}
        playbook={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { refresh(); setCreating(false); setEditing(null); }}
      />
    </>
  );
}

function PlaybookModal({
  open,
  playbook,
  onClose,
  onSaved,
}: {
  open: boolean;
  playbook: Playbook | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  return (
    <Modal
      open={open}
      width={780}
      title={playbook ? `编辑话术 · ${playbook.name}` : '新建话术'}
      onCancel={onClose}
      confirmLoading={saving}
      okText="保存"
      onOk={async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
          if (playbook) await api.patch(`/api/playbooks/${playbook.id}`, values);
          else await api.post('/api/playbooks', values);
          toast.success('已保存，后续起草会优先使用命中率更高的话术');
          onSaved();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '保存失败');
        } finally {
          setSaving(false);
        }
      }}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={
          playbook ?? {
            name: '',
            stage: 'first_reply',
            language: 'en',
            channel: 'email',
            subjectTpl: '',
            bodyTpl: '',
          }
        }
      >
        <Row gutter={12}>
          <Col span={12}><Form.Item name="name" label="话术名称" rules={[{ required: true }]}><Input placeholder="首封回复·英文·标准" /></Form.Item></Col>
          <Col span={6}>
            <Form.Item name="stage" label="阶段" rules={[{ required: true }]}>
              <Select options={STAGES.map((entry) => ({ label: entry.label, value: entry.value }))} />
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item name="language" label="语言">
              <Select
                options={['en', 'zh', 'es', 'fr', 'de', 'ru', 'ar', 'pt', 'ja', 'ko', 'it', 'tr', 'vi'].map((code) => ({ label: code.toUpperCase(), value: code }))}
              />
            </Form.Item>
          </Col>
          <Col span={3}>
            <Form.Item name="channel" label="渠道">
              <Select options={[{ label: '邮件', value: 'email' }, { label: 'WhatsApp', value: 'whatsapp' }]} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="subjectTpl" label="主题模板">
          <Input placeholder="Quotation {code} — {product_list}" />
        </Form.Item>
        <Form.Item
          name="bodyTpl"
          label="正文模板"
          rules={[{ required: true, message: '请输入正文模板' }]}
          extra="智能体会把这段骨架交给模型，按客户语言与语境个性化，但不会违背这里的事实与口吻。"
        >
          <Input.TextArea rows={14} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
