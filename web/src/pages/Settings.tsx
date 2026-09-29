import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Switch,
  Table,
  Tabs,
  Tag,
  Typography,
  message as toast,
} from 'antd';
import {
  ApiOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  ExperimentOutlined,
  KeyOutlined,
  MailOutlined,
  PictureOutlined,
  ReloadOutlined,
  SafetyOutlined,
  WechatOutlined,
} from '@ant-design/icons';
import { api, getToken, setToken, type Settings } from '../api';
import { useApi } from '../hooks';
import { Text } from '../ui';
import { PageHeader } from '../components/AppLayout';

export function SettingsPage() {
  const { data: settings, refresh } = useApi<Settings>('/api/settings');
  const { data: health } = useApi<Record<string, unknown>>('/api/health', { pollMs: 30_000 });
  const [testing, setTesting] = useState<string | null>(null);
  const [companyForm] = Form.useForm();
  const [salesForm] = Form.useForm();
  const [automationForm] = Form.useForm();
  const [llmForm] = Form.useForm();
  const [emailForm] = Form.useForm();
  const [waForm] = Form.useForm();
  const [ocrForm] = Form.useForm();
  const [tokenValue, setTokenValue] = useState(getToken());

  useEffect(() => {
    if (!settings) return;
    companyForm.setFieldsValue(settings.company);
    salesForm.setFieldsValue(settings.sales);
    automationForm.setFieldsValue(settings.automation);
    llmForm.setFieldsValue({
      provider: settings.llm.provider,
      model: settings.llm.model,
      baseUrl: settings.llm.baseUrl,
      temperature: settings.llm.temperature,
      apiKey: '',
    });
    emailForm.setFieldsValue(settings.integrations.email as Record<string, unknown>);
    waForm.setFieldsValue(settings.integrations.whatsapp as Record<string, unknown>);
    ocrForm.setFieldsValue(settings.integrations.ocr as Record<string, unknown>);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const save = async (section: string, payload: Record<string, unknown>, text: string) => {
    try {
      await api.put('/api/settings', payload);
      toast.success(text);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存失败');
    }
  };

  const provider = Form.useWatch('provider', llmForm);

  return (
    <>
      <PageHeader
        title="设置"
        subtitle="数据本地优先：数据库、导出文件与加密密钥都保存在本机。BYOK 模式，AI 供应商可随时切换。"
        extra={[
          <Button key="r" icon={<ReloadOutlined />} onClick={refresh}>刷新</Button>,
        ]}
      />

      <Tabs
        items={[
          {
            key: 'llm',
            label: <span><ExperimentOutlined /> AI 模型</span>,
            children: (
              <Row gutter={[14, 14]}>
                <Col xs={24} lg={14}>
                  <Card
                    size="small"
                    title="BYOK · 自带密钥"
                    extra={
                      settings?.llm.hasApiKey ? (
                        <Tag color="green" icon={<CheckCircleOutlined />}>已配置 {settings.llm.apiKeyMasked}</Tag>
                      ) : (
                        <Tag color="orange">未配置密钥</Tag>
                      )
                    }
                  >
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 14 }}
                      message="未配置密钥也能跑通全流程"
                      description="默认使用内置离线引擎（无需联网、零成本），它会完成同样的结构化抽取、产品匹配、定价与多语言起草。填入密钥后系统会自动切换到真实模型，其余代码路径完全不变。"
                    />
                    <Form form={llmForm} layout="vertical">
                      <Row gutter={12}>
                        <Col span={12}>
                          <Form.Item name="provider" label="供应商" rules={[{ required: true }]}>
                            <Select
                              options={(settings?.providers ?? []).map((entry) => ({
                                label: `${entry.label}${entry.requiresApiKey ? '（需要 Key）' : ''}`,
                                value: entry.id,
                              }))}
                            />
                          </Form.Item>
                        </Col>
                        <Col span={12}>
                          <Form.Item name="model" label="模型" rules={[{ required: true }]}>
                            <Input placeholder={settings?.providers.find((p) => p.id === provider)?.defaultModel} />
                          </Form.Item>
                        </Col>
                        <Col span={24}>
                          <Form.Item
                            name="baseUrl"
                            label="Base URL"
                            extra={
                              provider === 'deepseek'
                                ? 'DeepSeek 默认 https://api.deepseek.com/v1'
                                : provider === 'ollama'
                                  ? '本地 Ollama 默认 http://localhost:11434（无需 Key，数据不出本机）'
                                  : '留空使用官方默认地址；自建 vLLM / LM Studio 填自己的地址'
                            }
                          >
                            <Input placeholder={settings?.providers.find((p) => p.id === provider)?.defaultBaseUrl} />
                          </Form.Item>
                        </Col>
                        <Col span={16}>
                          <Form.Item
                            name="apiKey"
                            label="API Key"
                            extra="保存后使用 AES-256-GCM 加密写入本地数据库，接口永远不会回显明文。"
                          >
                            <Input.Password
                              placeholder={
                                settings?.providers.find((p) => p.id === provider)?.requiresApiKey
                                  ? 'sk-…（留空表示不修改）'
                                  : '该供应商无需密钥'
                              }
                              autoComplete="new-password"
                            />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item name="temperature" label="温度">
                            <InputNumber min={0} max={1.5} step={0.05} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                      </Row>

                      <Space wrap>
                        <Button
                          type="primary"
                          onClick={async () => {
                            const values = await llmForm.validateFields();
                            await save('llm', { llm: values }, '模型配置已保存');
                          }}
                        >
                          保存配置
                        </Button>
                        <Button
                          loading={testing === 'llm'}
                          onClick={async () => {
                            setTesting('llm');
                            try {
                              const result = await api.post<{ ok: boolean; detail?: string; provider?: string; model?: string; latencyMs?: number; sample?: string; synthetic?: boolean }>(
                                '/api/settings/test/llm',
                              );
                              if (result.ok) {
                                toast.success(
                                  `${result.provider}/${result.model} 连通（${result.latencyMs}ms）${result.synthetic ? ' · 离线引擎' : ''}`,
                                );
                              } else {
                                toast.warning(result.detail ?? '连接失败');
                              }
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : '测试失败');
                            } finally {
                              setTesting(null);
                            }
                          }}
                        >
                          测试连通性
                        </Button>
                      </Space>
                    </Form>
                  </Card>
                </Col>

                <Col xs={24} lg={10}>
                  <Card size="small" title="模型单价参考（USD / 百万 tokens）">
                    <Table
                      size="small"
                      rowKey="model"
                      pagination={false}
                      dataSource={Object.entries(settings?.models ?? {}).map(([model, cost]) => ({ model, ...cost }))}
                      columns={[
                        { title: '模型', dataIndex: 'model', className: 'dt-mono' },
                        { title: '输入', dataIndex: 'input', align: 'right', width: 84, render: (v: number) => (v === 0 ? '免费' : `$${v}`) },
                        { title: '输出', dataIndex: 'output', align: 'right', width: 84, render: (v: number) => (v === 0 ? '免费' : `$${v}`) },
                      ]}
                    />
                    <Divider style={{ margin: '12px 0' }} />
                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        <ApiOutlined /> 每次调用都会记入 <Text code>llm_usage</Text>，看板会显示区间内的调用次数与花费。
                      </Text>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        <SafetyOutlined /> 密钥仅本机可解；把 <Text code>data/dealtrack.sqlite</Text> 拷走也拿不到 Key。
                      </Text>
                    </Space>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'automation',
            label: '自动化策略',
            children: (
              <Row gutter={[14, 14]}>
                <Col xs={24} lg={14}>
                  <Card size="small" title="跟单与人工兜底">
                    <Form form={automationForm} layout="vertical">
                      <Form.Item
                        name="autoSend"
                        label="全自动发送"
                        valuePropName="checked"
                        extra="关闭时（默认）：智能体生成的所有邮件/WhatsApp 都进入「待确认」，人工点一下才发出。开启后：草稿自动发出，但仍全程留痕，可随时回滚。"
                      >
                        <Switch checkedChildren="自动发送" unCheckedChildren="人工确认" />
                      </Form.Item>
                      <Form.Item
                        name="draftQuotesAutomatically"
                        label="收到询盘后自动报价"
                        valuePropName="checked"
                        extra="关闭后，询盘只做解析和产品匹配，报价需要人工点「生成报价」。"
                      >
                        <Switch />
                      </Form.Item>
                      <Form.Item name="followupCadenceDays" label="跟进节奏（第 N 天）">
                        <Select mode="tags" placeholder="3,7,14,30" />
                      </Form.Item>
                      <Row gutter={12}>
                        <Col span={8}>
                          <Form.Item name="slaFirstReplyMinutes" label="首响 SLA（分钟）" extra="也是看板基线的对照值">
                            <InputNumber min={1} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item name="silenceDays" label="沉默阈值（天）" extra="超过则自动拉业务对齐群">
                            <InputNumber min={1} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                        <Col span={8}>
                          <Form.Item name="escalateAfterHours" label="询盘超时升级（小时）">
                            <InputNumber min={1} style={{ width: '100%' }} />
                          </Form.Item>
                        </Col>
                      </Row>
                      <Button
                        type="primary"
                        onClick={async () => {
                          const values = await automationForm.validateFields();
                          await save('automation', { automation: values }, '自动化策略已保存，新的报价会按新节奏排程');
                        }}
                      >
                        保存策略
                      </Button>
                    </Form>
                  </Card>
                </Col>
                <Col xs={24} lg={10}>
                  <Card size="small" title="当前策略的实际效果">
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="跟进节奏">
                        {(settings?.automation.followupCadenceDays ?? []).map((day) => (
                          <Tag key={day} color="blue">D+{day}</Tag>
                        ))}
                      </Descriptions.Item>
                      <Descriptions.Item label="发送模式">
                        {settings?.automation.autoSend ? <Tag color="orange">全自动</Tag> : <Tag color="green">人工确认</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="首响目标">{settings?.automation.slaFirstReplyMinutes} 分钟/封</Descriptions.Item>
                      <Descriptions.Item label="沉默升级">超 {settings?.automation.silenceDays} 天拉群</Descriptions.Item>
                      <Descriptions.Item label="询盘超时">超 {settings?.automation.escalateAfterHours} 小时升级</Descriptions.Item>
                    </Descriptions>
                    <Alert
                      style={{ marginTop: 12 }}
                      type="warning"
                      showIcon
                      message="更改节奏后，已有报价不会自动重排"
                      description="如需对某张已发出的报价重排，请到报价详情或调用 POST /api/followups/resequence。"
                    />
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'company',
            label: '公司资料',
            children: (
              <Row gutter={[14, 14]}>
                <Col xs={24} lg={14}>
                  <Card size="small" title="出现在报价单与邮件签名里的信息">
                    <Form form={companyForm} layout="vertical">
                      <Row gutter={12}>
                        <Col span={12}><Form.Item name="name" label="公司名称（英）" rules={[{ required: true }]}><Input /></Form.Item></Col>
                        <Col span={12}><Form.Item name="nameZh" label="公司名称（中）"><Input /></Form.Item></Col>
                        <Col span={24}><Form.Item name="address" label="地址"><Input /></Form.Item></Col>
                        <Col span={8}><Form.Item name="city" label="城市"><Input /></Form.Item></Col>
                        <Col span={8}><Form.Item name="country" label="国家"><Input /></Form.Item></Col>
                        <Col span={8}><Form.Item name="website" label="官网"><Input /></Form.Item></Col>
                        <Col span={8}><Form.Item name="email" label="销售邮箱"><Input /></Form.Item></Col>
                        <Col span={8}><Form.Item name="phone" label="电话"><Input /></Form.Item></Col>
                        <Col span={8}><Form.Item name="marketCount" label="已出口市场数"><InputNumber style={{ width: '100%' }} min={0} /></Form.Item></Col>
                        <Col span={6}><Form.Item name="defaultCurrency" label="默认币种"><Input /></Form.Item></Col>
                        <Col span={6}><Form.Item name="defaultIncoterm" label="默认贸易条款"><Input /></Form.Item></Col>
                        <Col span={6}><Form.Item name="defaultPort" label="默认起运港"><Input /></Form.Item></Col>
                        <Col span={6}><Form.Item name="defaultLeadTimeDays" label="默认交期（天）"><InputNumber style={{ width: '100%' }} min={1} /></Form.Item></Col>
                        <Col span={24}><Form.Item name="paymentTerms" label="默认付款方式"><Input /></Form.Item></Col>
                        <Col span={24}><Form.Item name="bankInfo" label="银行信息（报关与合同用）"><Input.TextArea rows={3} /></Form.Item></Col>
                      </Row>
                      <Button
                        type="primary"
                        onClick={async () => {
                          const values = await companyForm.validateFields();
                          await save('company', { company: values }, '公司资料已保存，新报价单会立即生效');
                        }}
                      >
                        保存资料
                      </Button>
                    </Form>
                  </Card>
                </Col>
                <Col xs={24} lg={10}>
                  <Card size="small" title="销售身份（邮件签名）">
                    <Form form={salesForm} layout="vertical">
                      <Form.Item name="senderName" label="发件人姓名"><Input /></Form.Item>
                      <Form.Item name="senderRole" label="职位"><Input /></Form.Item>
                      <Form.Item name="senderEmail" label="发件邮箱"><Input /></Form.Item>
                      <Form.Item name="senderWhatsapp" label="WhatsApp 号码"><Input /></Form.Item>
                      <Button
                        type="primary"
                        onClick={async () => {
                          const values = await salesForm.validateFields();
                          await save('sales', { sales: values }, '销售身份已保存');
                        }}
                      >
                        保存身份
                      </Button>
                    </Form>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'integrations',
            label: '集成',
            children: (
              <Row gutter={[14, 14]}>
                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    title={<span><MailOutlined /> 邮件（IMAP 收件 / SMTP 发件）</span>}
                    extra={
                      (settings?.integrations.email as Record<string, unknown>)?.enabled ? (
                        <Tag color="green">已启用</Tag>
                      ) : (
                        <Tag color="orange">未启用</Tag>
                      )
                    }
                  >
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="未配置时邮件为「模拟发送」"
                      description="消息照常记录、流程照常推进，只是不会真的投递。这样在拿到邮箱授权前也能完整演示与压测。"
                    />
                    <Form form={emailForm} layout="vertical">
                      <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                      <Row gutter={12}>
                        <Col span={16}><Form.Item name="imapHost" label="IMAP 主机"><Input placeholder="imap.example.com" /></Form.Item></Col>
                        <Col span={8}><Form.Item name="imapPort" label="端口"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                        <Col span={16}><Form.Item name="smtpHost" label="SMTP 主机"><Input placeholder="smtp.example.com" /></Form.Item></Col>
                        <Col span={8}><Form.Item name="smtpPort" label="端口"><InputNumber style={{ width: '100%' }} /></Form.Item></Col>
                        <Col span={12}><Form.Item name="user" label="账号"><Input placeholder="sales@example.com" /></Form.Item></Col>
                        <Col span={12}>
                          <Form.Item name="password" label="密码 / 授权码" extra="加密存储，不回显">
                            <Input.Password placeholder="留空表示不修改" autoComplete="new-password" />
                          </Form.Item>
                        </Col>
                        <Col span={24}><Form.Item name="fromName" label="发件人显示名"><Input /></Form.Item></Col>
                      </Row>
                      <Space wrap>
                        <Button
                          type="primary"
                          onClick={async () => {
                            const values = await emailForm.validateFields();
                            await api.put('/api/settings/integrations', { email: values });
                            toast.success('邮件集成已保存');
                            refresh();
                          }}
                        >
                          保存
                        </Button>
                        <Button
                          loading={testing === 'email'}
                          onClick={async () => {
                            setTesting('email');
                            try {
                              const result = await api.post<{ ok: boolean; detail: string }>('/api/settings/test/email');
                              result.ok ? toast.success(result.detail) : toast.warning(result.detail);
                            } finally {
                              setTesting(null);
                            }
                          }}
                        >
                          测试 SMTP
                        </Button>
                        <Button
                          loading={testing === 'sync'}
                          onClick={async () => {
                            setTesting('sync');
                            try {
                              const result = await api.post<{ detail: string; ingested: number }>('/api/integrations/email/sync');
                              toast.success(result.detail);
                            } catch (error) {
                              toast.error(error instanceof Error ? error.message : '同步失败');
                            } finally {
                              setTesting(null);
                            }
                          }}
                        >
                          立即拉取收件箱
                        </Button>
                      </Space>
                    </Form>
                  </Card>
                </Col>

                <Col xs={24} lg={12}>
                  <Card
                    size="small"
                    title={<span><WechatOutlined /> WhatsApp Business API</span>}
                    extra={
                      (settings?.integrations.whatsapp as Record<string, unknown>)?.enabled ? (
                        <Tag color="green">已启用</Tag>
                      ) : (
                        <Tag color="orange">未启用</Tag>
                      )
                    }
                  >
                    <Alert
                      type="info"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="Webhook 地址"
                      description={
                        <div>
                          <Text code>GET/POST /api/whatsapp/webhook</Text>
                          <div style={{ fontSize: 12, marginTop: 4 }}>
                            在 Meta 后台把回调填成 <Text code>{`${window.location.origin.replace(/:\d+$/, ':8787')}/api/whatsapp/webhook`}</Text>，
                            验证令牌与下方一致即可。
                          </div>
                        </div>
                      }
                    />
                    <Form form={waForm} layout="vertical">
                      <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                      <Form.Item name="phoneNumberId" label="Phone Number ID"><Input /></Form.Item>
                      <Form.Item name="verifyToken" label="Verify Token"><Input /></Form.Item>
                      <Form.Item name="accessToken" label="Access Token" extra="加密存储，不回显">
                        <Input.Password placeholder="留空表示不修改" autoComplete="new-password" />
                      </Form.Item>
                      <Form.Item name="apiVersion" label="API 版本"><Input placeholder="v21.0" /></Form.Item>
                      <Button
                        type="primary"
                        onClick={async () => {
                          const values = await waForm.validateFields();
                          await api.put('/api/settings/integrations', { whatsapp: values });
                          toast.success('WhatsApp 集成已保存');
                          refresh();
                        }}
                      >
                        保存
                      </Button>
                    </Form>
                  </Card>

                  <Card size="small" title={<span><PictureOutlined /> 附件识别（OCR）</span>} style={{ marginTop: 14 }}>
                    <Form form={ocrForm} layout="vertical">
                      <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
                      <Row gutter={12}>
                        <Col span={8}><Form.Item name="provider" label="供应商"><Input placeholder="textin" /></Form.Item></Col>
                        <Col span={16}><Form.Item name="endpoint" label="接口地址"><Input /></Form.Item></Col>
                      </Row>
                      <Form.Item name="apiKey" label="API Key" extra="加密存储。未配置时附件会保留并提示人工阅读。">
                        <Input.Password placeholder="留空表示不修改" autoComplete="new-password" />
                      </Form.Item>
                      <Button
                        type="primary"
                        onClick={async () => {
                          const values = await ocrForm.validateFields();
                          await api.put('/api/settings/integrations', { ocr: values });
                          toast.success('OCR 配置已保存');
                          refresh();
                        }}
                      >
                        保存
                      </Button>
                    </Form>
                  </Card>
                </Col>
              </Row>
            ),
          },
          {
            key: 'system',
            label: '系统与安全',
            children: (
              <Row gutter={[14, 14]}>
                <Col xs={24} lg={12}>
                  <Card size="small" title={<span><KeyOutlined /> API Token</span>}>
                    <Alert
                      type="warning"
                      showIcon
                      style={{ marginBottom: 12 }}
                      message="安卓 App 与外部脚本用这个 Token 访问"
                      description="轮换后所有客户端都需要更新。默认值 dealtrack-dev-token 仅用于本机体验，对外部署请务必更换。"
                    />
                    <Space.Compact style={{ width: '100%', marginBottom: 12 }}>
                      <Input value={tokenValue} onChange={(event) => setTokenValue(event.target.value)} />
                      <Button
                        onClick={() => {
                          setToken(tokenValue);
                          toast.success('已在本机保存');
                        }}
                      >
                        本机保存
                      </Button>
                    </Space.Compact>
                    <Button
                      onClick={async () => {
                        const result = await api.post<{ token: string }>('/api/settings/rotate-token');
                        setToken(result.token);
                        setTokenValue(result.token);
                        toast.success('服务端 Token 已轮换并同步到本机');
                      }}
                    >
                      生成并轮换新 Token
                    </Button>
                  </Card>
                </Col>

                <Col xs={24} lg={12}>
                  <Card size="small" title={<span><CloudServerOutlined /> 运行状态</span>}>
                    <Descriptions size="small" column={1}>
                      <Descriptions.Item label="服务状态">
                        {health ? <Tag color="green">正常</Tag> : <Tag color="red">不可用</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="AI 供应商">
                        {settings?.llm.provider}
                        {settings?.llm.hasApiKey ? <Tag color="green" style={{ marginLeft: 6 }}>已配密钥</Tag> : <Tag color="orange" style={{ marginLeft: 6 }}>离线引擎</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="Chrome 渲染">
                        {settings?.paths.chromePath ? <Text className="dt-mono" style={{ fontSize: 11.5 }}>{settings.paths.chromePath}</Text> : <Tag color="orange">未检测到</Tag>}
                      </Descriptions.Item>
                      <Descriptions.Item label="数据目录">
                        <Text className="dt-mono" style={{ fontSize: 11.5 }}>{settings?.paths.dataDir}</Text>
                      </Descriptions.Item>
                      <Descriptions.Item label="导出目录">
                        <Text className="dt-mono" style={{ fontSize: 11.5 }}>{settings?.paths.exportDir}</Text>
                      </Descriptions.Item>
                    </Descriptions>
                  </Card>

                  <Card size="small" title="数据与合规" style={{ marginTop: 14 }}>
                    <Typography.Paragraph style={{ fontSize: 12.5, marginBottom: 8 }}>
                      <SafetyOutlined /> <strong>本地优先</strong>：客户数据、报价历史、邮件正文默认全部留在本机 SQLite 文件中，
                      除你自己配置的 LLM 供应商外不向任何第三方传输。
                    </Typography.Paragraph>
                    <Typography.Paragraph style={{ fontSize: 12.5, marginBottom: 8 }}>
                      <strong>密钥加密</strong>：BYOK Key、SMTP 密码、WhatsApp Token 使用 AES-256-GCM 加密后入库，
                      主密钥保存在 <Text code>data/.master.key</Text>（权限 600，已被 .gitignore 排除）。
                    </Typography.Paragraph>
                    <Typography.Paragraph style={{ fontSize: 12.5, marginBottom: 0 }}>
                      <strong>可审计</strong>：每个事件、每次智能体运行、每条外发消息都留痕，可导出用于 GDPR 数据主体请求响应。
                      对外经营前请补齐：隐私政策、数据处理协议（DPA）、访问日志留存策略。
                    </Typography.Paragraph>
                  </Card>
                </Col>

                <Col span={24}>
                  <Card size="small" title="最近一次健康检查">
                    <Row gutter={[12, 12]}>
                      <Col xs={12} md={6}>
                        <Statistic
                          title="事件总数"
                          value={Number(((health?.database as Record<string, unknown>)?.events as number) ?? 0)}
                          valueStyle={{ fontSize: 20 }}
                        />
                      </Col>
                      <Col xs={12} md={6}>
                        <Statistic
                          title="任务总数"
                          value={Number(((health?.database as Record<string, unknown>)?.tasks as number) ?? 0)}
                          valueStyle={{ fontSize: 20 }}
                        />
                      </Col>
                      <Col xs={12} md={6}>
                        <Statistic
                          title="待处理任务"
                          value={Number(((health?.workers as Record<string, unknown>)?.queued as number) ?? 0)}
                          valueStyle={{ fontSize: 20 }}
                        />
                      </Col>
                      <Col xs={12} md={6}>
                        <Statistic
                          title="SSE 连接"
                          value={Number(health?.sseClients ?? 0)}
                          valueStyle={{ fontSize: 20 }}
                        />
                      </Col>
                    </Row>
                  </Card>
                </Col>
              </Row>
            ),
          },
        ]}
      />
    </>
  );
}
