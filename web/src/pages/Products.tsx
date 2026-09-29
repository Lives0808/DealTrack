import { useMemo, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Drawer,
  Descriptions,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Space,
  Statistic,
  Switch,
  Table,
  Tag,
  Tooltip,
  message as toast,
} from 'antd';
import { EditOutlined, PlusOutlined, ReloadOutlined, RobotOutlined } from '@ant-design/icons';
import { api, type Product } from '../api';
import { useApi } from '../hooks';
import { Text, dateTime, percent } from '../ui';
import { PageHeader } from '../components/AppLayout';

export function ProductsPage() {
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [onlyMissingHs, setOnlyMissingHs] = useState(false);

  const { data: products, loading, refresh } = useApi<Product[]>(
    `/api/products?limit=500${search ? `&search=${encodeURIComponent(search)}` : ''}`,
    { pollMs: 60_000 },
  );
  const { data: detail } = useApi<Product & { quotes: Array<Record<string, unknown>> }>(
    selected ? `/api/products/${selected.id}` : null,
  );

  const rows = useMemo(() => {
    const list = products ?? [];
    return onlyMissingHs ? list.filter((product) => !product.hsCode) : list;
  }, [products, onlyMissingHs]);

  const stats = useMemo(() => {
    const list = products ?? [];
    const tiers = list.reduce((sum, product) => sum + (product.tiers?.length ?? 0), 0);
    const margins = list.flatMap((product) => (product.tiers ?? []).map((tier) => tier.marginPct));
    return {
      count: list.length,
      tiers,
      avgMargin: margins.length ? margins.reduce((a, b) => a + b, 0) / margins.length : 0,
      missingHs: list.filter((product) => !product.hsCode).length,
    };
  }, [products]);

  return (
    <>
      <PageHeader
        title="产品库"
        subtitle="报价的每一个数字都从这里的成本阶梯算出来。产品库越准，AI 报价越不需要人工兜底。"
        extra={[
          <Tooltip key="hs" title="报关智能体会按品名、材质、用途离线/联网归类，低于 0.55 置信度会自动拉群请人工确认">
            <Button
              icon={<RobotOutlined />}
              onClick={async () => {
                await api.post('/api/agents/run', { agent: 'customs', taskType: 'classify_hs_codes', payload: { limit: 10 } });
                toast.success('报关智能体正在补全 HS 编码');
                setTimeout(refresh, 2500);
              }}
            >
              AI 补全 HS 编码
            </Button>
          </Tooltip>,
          <Button key="new" type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新增产品</Button>,
          <Button key="r" icon={<ReloadOutlined />} loading={loading} onClick={refresh}>刷新</Button>,
        ]}
      />

      <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
        <Col xs={12} md={6}><Card size="small"><Statistic title="产品数" value={stats.count} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="价格阶梯" value={stats.tiers} valueStyle={{ fontSize: 22 }} /></Card></Col>
        <Col xs={12} md={6}><Card size="small"><Statistic title="平均目标毛利" value={(stats.avgMargin * 100).toFixed(1)} suffix="%" valueStyle={{ fontSize: 22, color: '#1c7a3d' }} /></Card></Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="缺少 HS 编码" value={stats.missingHs} valueStyle={{ fontSize: 22, color: stats.missingHs > 0 ? '#d97706' : '#1c7a3d' }} />
          </Card>
        </Col>
      </Row>

      <Card size="small">
        <Space wrap style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder="搜索 SKU / 品名 / 描述" style={{ width: 300 }} onSearch={setSearch} />
          <Space size={6}>
            <Switch size="small" checked={onlyMissingHs} onChange={setOnlyMissingHs} />
            <Text style={{ fontSize: 12.5 }}>只看缺 HS 编码</Text>
          </Space>
        </Space>

        <Table
          size="small"
          rowKey="id"
          loading={loading}
          dataSource={rows}
          scroll={{ x: 1200 }}
          pagination={{ pageSize: 20, showSizeChanger: false }}
          onRow={(record) => ({ onClick: () => setSelected(record), style: { cursor: 'pointer' } })}
          expandable={{
            expandedRowRender: (record) => (
              <Table
                size="small"
                rowKey="id"
                pagination={false}
                dataSource={record.tiers ?? []}
                columns={[
                  { title: '起订量', dataIndex: 'minQty', width: 100, render: (v: number) => v.toLocaleString() },
                  { title: '单位成本', dataIndex: 'unitCost', width: 110, align: 'right', render: (v: number, r) => `${r.costCurrency} ${v.toFixed(2)}` },
                  { title: '包装', dataIndex: 'packagingCost', width: 84, align: 'right', render: (v: number) => v.toFixed(2) },
                  { title: '内陆', dataIndex: 'inlandCost', width: 84, align: 'right', render: (v: number) => v.toFixed(2) },
                  { title: '目标毛利', dataIndex: 'marginPct', width: 96, align: 'right', render: (v: number) => <Tag color={v >= 0.2 ? 'green' : 'orange'}>{percent(v)}</Tag> },
                  { title: '报价币种', dataIndex: 'currency', width: 86 },
                  { title: '条款', dataIndex: 'incoterm', width: 72 },
                  { title: '交期', dataIndex: 'leadTimeDays', width: 76, align: 'right', render: (v: number) => `${v} 天` },
                ]}
              />
            ),
          }}
          columns={[
            {
              title: 'SKU / 品名',
              width: 300,
              render: (_, record) => (
                <div>
                  <Text className="dt-mono" strong>{record.sku}</Text>
                  <div style={{ fontSize: 12.5 }}>{record.nameEn}</div>
                  {record.nameZh && <Text type="secondary" style={{ fontSize: 11.5 }}>{record.nameZh}</Text>}
                </div>
              ),
            },
            { title: '品类', dataIndex: 'category', width: 110 },
            { title: 'MOQ', dataIndex: 'moq', width: 80, align: 'right', render: (v: number, r) => `${v.toLocaleString()} ${r.unit}` },
            {
              title: 'HS 编码',
              width: 140,
              render: (_, record) =>
                record.hsCode ? (
                  <Tooltip title={record.hsDescription}>
                    <Text className="dt-mono">{record.hsCode}</Text>
                  </Tooltip>
                ) : (
                  <Tag color="orange">待归类</Tag>
                ),
            },
            {
              title: '阶梯',
              width: 90,
              render: (_, record) => (
                <Tooltip title={(record.tiers ?? []).map((tier) => `${tier.minQty}+：${tier.costCurrency} ${tier.unitCost} @ ${percent(tier.marginPct)}`).join('\n')}>
                  <Tag color="blue">{record.tiers?.length ?? 0} 档</Tag>
                </Tooltip>
              ),
            },
            {
              title: '认证',
              width: 170,
              render: (_, record) => (
                <Space size={3} wrap>
                  {record.certifications.length === 0 ? <Text type="secondary">—</Text> : record.certifications.map((cert) => <Tag key={cert} color="purple">{cert}</Tag>)}
                </Space>
              ),
            },
            {
              title: '目标市场',
              width: 140,
              render: (_, record) => (
                <Space size={3} wrap>
                  {record.targetMarkets.map((market) => <Tag key={market}>{market}</Tag>)}
                </Space>
              ),
            },
            {
              title: '操作',
              width: 80,
              render: (_, record) => (
                <Button
                  size="small"
                  icon={<EditOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    setEditing(record);
                  }}
                />
              ),
            },
          ]}
        />
      </Card>

      <Drawer
        width={760}
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.sku} · ${selected.nameEn}` : ''}
      >
        {detail && (
          <>
            <Descriptions size="small" column={2} bordered style={{ marginBottom: 14 }}>
              <Descriptions.Item label="中文名">{detail.nameZh ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="品类">{detail.category ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="单位">{detail.unit}</Descriptions.Item>
              <Descriptions.Item label="MOQ">{detail.moq.toLocaleString()}</Descriptions.Item>
              <Descriptions.Item label="HS 编码">{detail.hsCode ?? '待归类'}</Descriptions.Item>
              <Descriptions.Item label="申报要素">{detail.hsDescription ?? '—'}</Descriptions.Item>
              <Descriptions.Item label="净重/毛重">
                {detail.netWeightKg ?? '—'} / {detail.grossWeightKg ?? '—'} kg
              </Descriptions.Item>
              <Descriptions.Item label="体积">{detail.cbm ?? '—'} CBM</Descriptions.Item>
              <Descriptions.Item label="认证" span={2}>
                {detail.certifications.join('、') || '未登记'}
              </Descriptions.Item>
              <Descriptions.Item label="目标市场" span={2}>
                {detail.targetMarkets.join('、') || '—'}
              </Descriptions.Item>
              <Descriptions.Item label="规格描述" span={2}>
                {detail.descriptionEn ?? '—'}
              </Descriptions.Item>
            </Descriptions>

            <Card size="small" title="历史报价（该产品）" style={{ marginBottom: 14 }}>
              {(detail.quotes ?? []).length === 0 ? (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有报价记录" />
              ) : (
                <Table
                  size="small"
                  rowKey={(row: Record<string, unknown>) => String(row.quoteId)}
                  pagination={{ pageSize: 8, size: 'small' }}
                  dataSource={detail.quotes}
                  columns={[
                    { title: '单号', dataIndex: 'quoteNo', width: 130 },
                    { title: '客户', dataIndex: 'customer', render: (v: string) => v ?? '—' },
                    { title: '数量', dataIndex: 'qty', width: 96, align: 'right', render: (v: number) => Number(v).toLocaleString() },
                    { title: '单价', dataIndex: 'unitPrice', width: 100, align: 'right', render: (v: number) => v.toFixed(4) },
                    { title: '状态', dataIndex: 'status', width: 96 },
                    { title: '日期', dataIndex: 'createdAt', width: 100, render: (v: string) => dateTime(v).slice(0, 10) },
                  ]}
                />
              )}
            </Card>
          </>
        )}
      </Drawer>

      <ProductModal
        open={creating || Boolean(editing)}
        product={editing}
        onClose={() => { setCreating(false); setEditing(null); }}
        onSaved={() => { refresh(); setCreating(false); setEditing(null); }}
      />
    </>
  );
}

function ProductModal({
  open,
  product,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm();
  const [tiers, setTiers] = useState<Array<Record<string, number>>>([]);
  const [saving, setSaving] = useState(false);

  const initial = useMemo(() => {
    if (!product) {
      return {
        sku: '', nameEn: '', nameZh: '', category: '', unit: 'pcs', moq: 500,
        hsCode: '', hsDescription: '', netWeightKg: 0.5, grossWeightKg: 0.6, cbm: 0.002,
        certifications: '', targetMarkets: '', descriptionEn: '',
      };
    }
    return {
      sku: product.sku,
      nameEn: product.nameEn,
      nameZh: product.nameZh ?? '',
      category: product.category ?? '',
      unit: product.unit,
      moq: product.moq,
      hsCode: product.hsCode ?? '',
      hsDescription: product.hsDescription ?? '',
      netWeightKg: product.netWeightKg ?? 0,
      grossWeightKg: product.grossWeightKg ?? 0,
      cbm: product.cbm ?? 0,
      certifications: product.certifications.join(','),
      targetMarkets: product.targetMarkets.join(','),
      descriptionEn: product.descriptionEn ?? '',
    };
  }, [product]);

  useMemo(() => {
    setTiers(
      (product?.tiers ?? [{ minQty: 500, unitCost: 50, marginPct: 0.2, currency: 'USD', costCurrency: 'CNY', leadTimeDays: 15, packagingCost: 1.5, inlandCost: 0.6 }]).map((tier) => ({
        minQty: tier.minQty,
        unitCost: tier.unitCost,
        marginPct: tier.marginPct,
        packagingCost: tier.packagingCost,
        inlandCost: tier.inlandCost,
        leadTimeDays: tier.leadTimeDays,
      })),
    );
    form.setFieldsValue(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, open]);

  return (
    <Modal
      open={open}
      width={780}
      title={product ? `编辑产品 · ${product.sku}` : '新增产品'}
      onCancel={onClose}
      confirmLoading={saving}
      okText="保存"
      onOk={async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
          const payload = {
            ...values,
            certifications: String(values.certifications ?? '').split(/[,，]/).map((s: string) => s.trim()).filter(Boolean),
            targetMarkets: String(values.targetMarkets ?? '').split(/[,，]/).map((s: string) => s.trim()).filter(Boolean),
            tiers,
          };
          if (product) await api.patch(`/api/products/${product.id}`, payload);
          else await api.post('/api/products', payload);
          toast.success('已保存');
          onSaved();
        } catch (error) {
          toast.error(error instanceof Error ? error.message : '保存失败');
        } finally {
          setSaving(false);
        }
      }}
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 12 }}
        message="成本阶梯决定 AI 报价"
        description="报价引擎按「单位成本 + 包装 + 内陆运费 ÷ 汇率 ÷ (1 − 目标毛利)」计算 FOB 价，再按贸易条款分摊运费、保险与关税。填得越准，AI 越不需要人工兜底。"
      />
      <Form form={form} layout="vertical" initialValues={initial}>
        <Row gutter={12}>
          <Col span={8}><Form.Item name="sku" label="SKU" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={16}><Form.Item name="nameEn" label="英文品名" rules={[{ required: true }]}><Input /></Form.Item></Col>
          <Col span={12}><Form.Item name="nameZh" label="中文品名"><Input /></Form.Item></Col>
          <Col span={6}><Form.Item name="category" label="品类"><Input /></Form.Item></Col>
          <Col span={6}><Form.Item name="unit" label="单位"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="moq" label="MOQ"><InputNumber style={{ width: '100%' }} min={1} /></Form.Item></Col>
          <Col span={8}><Form.Item name="hsCode" label="HS 编码"><Input placeholder="9405.42" /></Form.Item></Col>
          <Col span={8}><Form.Item name="hsDescription" label="申报要素"><Input /></Form.Item></Col>
          <Col span={8}><Form.Item name="netWeightKg" label="净重 kg"><InputNumber style={{ width: '100%' }} min={0} step={0.1} /></Form.Item></Col>
          <Col span={8}><Form.Item name="grossWeightKg" label="毛重 kg"><InputNumber style={{ width: '100%' }} min={0} step={0.1} /></Form.Item></Col>
          <Col span={8}><Form.Item name="cbm" label="体积 CBM"><InputNumber style={{ width: '100%' }} min={0} step={0.0001} /></Form.Item></Col>
          <Col span={12}><Form.Item name="certifications" label="认证（逗号分隔）"><Input placeholder="CE,RoHS,FCC" /></Form.Item></Col>
          <Col span={12}><Form.Item name="targetMarkets" label="目标市场（逗号分隔）"><Input placeholder="DE,US,AE" /></Form.Item></Col>
          <Col span={24}><Form.Item name="descriptionEn" label="英文规格描述"><Input.TextArea rows={2} /></Form.Item></Col>
        </Row>
      </Form>

      <Card
        size="small"
        title="价格阶梯"
        extra={
          <Button
            size="small"
            icon={<PlusOutlined />}
            onClick={() => setTiers([...tiers, { minQty: 1000, unitCost: 45, marginPct: 0.18, packagingCost: 1.5, inlandCost: 0.6, leadTimeDays: 15 }])}
          >
            加一档
          </Button>
        }
      >
        <Table
          size="small"
          rowKey={(_, index) => String(index)}
          pagination={false}
          dataSource={tiers}
          columns={[
            {
              title: '起订量', dataIndex: 'minQty', width: 110,
              render: (value: number, _row, index) => (
                <InputNumber size="small" min={1} value={value} onChange={(v) => setTiers(tiers.map((t, i) => (i === index ? { ...t, minQty: Number(v) } : t)))} />
              ),
            },
            {
              title: '单位成本(CNY)', dataIndex: 'unitCost', width: 130,
              render: (value: number, _row, index) => (
                <InputNumber size="small" min={0} step={0.5} value={value} onChange={(v) => setTiers(tiers.map((t, i) => (i === index ? { ...t, unitCost: Number(v) } : t)))} />
              ),
            },
            {
              title: '目标毛利', dataIndex: 'marginPct', width: 110,
              render: (value: number, _row, index) => (
                <InputNumber size="small" min={0} max={0.9} step={0.01} value={value} onChange={(v) => setTiers(tiers.map((t, i) => (i === index ? { ...t, marginPct: Number(v) } : t)))} />
              ),
            },
            {
              title: '交期(天)', dataIndex: 'leadTimeDays', width: 100,
              render: (value: number, _row, index) => (
                <InputNumber size="small" min={1} value={value} onChange={(v) => setTiers(tiers.map((t, i) => (i === index ? { ...t, leadTimeDays: Number(v) } : t)))} />
              ),
            },
            {
              title: '', width: 60,
              render: (_value, _row, index) => (
                <Button size="small" danger type="link" onClick={() => setTiers(tiers.filter((_, i) => i !== index))}>删除</Button>
              ),
            },
          ]}
        />
      </Card>
    </Modal>
  );
}
