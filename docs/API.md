# API 参考

所有接口以 `/api` 为前缀。除公开接口外都需要：

```
Authorization: Bearer <API_TOKEN>
X-DealTrack-Actor: user:boss        # 可选，用于审计「谁批的」
```

响应统一信封：

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": "bad_request", "message": "询盘正文不能为空" }
```

默认 Token 是 `dealtrack-dev-token`，可在「设置 → 系统与安全」轮换。

---

### 请求关联

每个响应都带 `x-request-id`（请求头里带了就沿用）。排查问题时用它把日志、事件和消息串起来。

```bash
curl -i -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/health
# x-request-id: req_a1b2c3d4e5f6
```

### 输入校验

所有写接口都过 zod 校验，非法输入在边界就拒绝，不会写库：

```json
{
  "ok": false,
  "error": "validation_error",
  "message": "请求参数校验失败：email 邮箱格式不正确",
  "issues": [{ "field": "email", "message": "邮箱格式不正确" }]
}
```

---

## 公开接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 健康检查：数据库计数、LLM 就绪状态、队列、集成开关 |
| GET | `/api/version` | 版本与 schema 版本 |
| GET | `/api/whatsapp/webhook` | Meta 回调校验（hub.challenge 握手） |
| POST | `/api/whatsapp/webhook` | Meta 消息回调（官方报文格式） |
| GET | `/api/stream` | SSE 实时事件流（`?token=` 传 Token，EventSource 无法自定义请求头） |

---

## 询盘

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/inquiries` | 列表。参数：`status` `channel` `customerId` `ownerId` `search` `limit` `offset` `orderBy` |
| GET | `/api/inquiries/:id` | 详情（含行项目、报价、消息、事件时间线、SLA 状态） |
| POST | `/api/inquiries` | **手工录入询盘**，立即触发智能体流水线 |
| PATCH | `/api/inquiries/:id` | 更新字段 |
| POST | `/api/inquiries/:id/parse` | 重新解析（人工修正原文后用） |
| POST | `/api/inquiries/:id/quote` | 让销售智能体立即定价并起草回复 |
| POST | `/api/inquiries/:id/messages` | 记录一条客户消息（电话/展会跟进），自动分类意图 |

### 手工录入询盘

```bash
curl -X POST http://localhost:8787/api/inquiries \
  -H "Authorization: Bearer dealtrack-dev-token" \
  -H "content-type: application/json" \
  -d '{
    "channel": "email",
    "email": "einkauf@hellweg-lichttechnik.example",
    "contactName": "Markus Hellweg",
    "subject": "Anfrage: 3000 Stück LED Arbeitsstrahler 50W",
    "body": "Sehr geehrte Damen und Herren, wir brauchen 3000 Stück LED Arbeitsstrahler 50W, FOB Shenzhen, Zielhafen Hamburg, CE und RoHS. Zielpreis USD 6,20.",
    "autoRun": true
  }'
```

返回询盘、客户与是否识别为「回复」。`autoRun=true` 时会直接交给销售智能体。

---

## 客户

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/customers` | 列表（`?withStats=false` 可关掉统计） |
| GET | `/api/customers/:id` | 详情 + 统计 + 全量业务时间线 |
| POST | `/api/customers` | 建客户（按邮箱/电话/公司自动去重） |
| PATCH | `/api/customers/:id` | 更新 |

---

## 报价

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/quotes` | 列表。参数：`status` `customerId` `inquiryId` `search` |
| GET | `/api/quotes/:id` | 详情（行项目、价格构成、结果、报关） |
| PATCH | `/api/quotes/:id` | 更新 |
| POST | `/api/quotes/:id/approve` | 批准，并**立即排定跟进节奏** |
| POST | `/api/quotes/:id/send` | 生成/取用封面邮件并发送 |
| POST | `/api/quotes/:id/outcome` | **登记成交 / 丢单**（丢单需带 `reasonCode`） |
| GET | `/api/quotes/:id/document` | 报价单（`?format=html` 可取 HTML 源） |
| POST | `/api/quotes/:id/declaration` | 生成报关要素表 + 合规校验 |
| GET | `/api/quotes/:id/declaration` | 下载报关要素表 |
| GET | `/api/quotes/expiring` | 72 小时内将过期的报价 |
| GET | `/api/loss-reasons` | 丢单原因字典 |

### 登记成交 / 丢单（数据闭环）

```bash
curl -X POST http://localhost:8787/api/quotes/$QUOTE_ID/outcome \
  -H "Authorization: Bearer dealtrack-dev-token" \
  -H "content-type: application/json" \
  -d '{"result":"lost","reasonCode":"price","reasonNote":"客户说比越南供应商高 8%","competitor":"Vietnam supplier"}'
```

`result=won` 会自动触发报关智能体生成报关要素表。

---

## 形式发票与回款

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/proformas` | PI 列表。参数：`status` `customerId` |
| GET | `/api/proformas/:id` | PI 详情（含回款节点） |
| GET | `/api/quotes/:id/proforma` | 取该报价的 PI |
| POST | `/api/quotes/:id/proforma` | 签发 PI（已存在则复用），可传 `depositPct`、`bankInfo`、`paymentTerms` |
| GET | `/api/quotes/:id/proforma/document` | PI 文档（`?format=html` 取 HTML 源） |
| PATCH | `/api/proformas/:id` | 更新状态/银行信息/出运日期 |
| POST | `/api/proformas/:id/milestones` | 追加分期（如协商出的第三期） |
| GET | `/api/payments` | 回款节点列表。参数：`status`（可逗号分隔）`customerId` `dueBefore` |
| GET | `/api/payments/summary` | 回款汇总：未收 / 逾期 / 已收 / 回款率 / 逾期明细 |
| POST | `/api/payments/:id/paid` | **登记收款**（可传 `amount` 支持部分收款） |
| PATCH | `/api/payments/:id` | 调整金额/到期日/状态 |
| POST | `/api/payments/:id/remind` | 立即让跟单智能体起草催款 |

### 成交 → 形式发票 → 收款

```bash
# 1. 登记成交（会自动生成 PI + 报关要素表 + 回款节点）
curl -X POST http://localhost:8787/api/quotes/$QUOTE_ID/outcome \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"result":"won","reasonNote":"客户邮件确认"}'

# 2. 查看 PI 与回款节点
curl -H "Authorization: Bearer $TOKEN" http://localhost:8787/api/quotes/$QUOTE_ID/proforma

# 3. 收到定金
curl -X POST http://localhost:8787/api/payments/$MILESTONE_ID/paid \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"amount":20876.30,"method":"T/T","note":"水单号 123456"}'
```

`quote.accepted` 事件会同时触发 `sales.create_proforma` 与 `customs.draft_declaration`，
所以无论从 API、智能体还是脚本登记成交，行为完全一致。

---

## 报价改版

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/quotes/:id/revise` | 生成新版本，**必须传 `reason`** |
| GET | `/api/quotes/:id/revisions` | 完整改版链（含每版价差） |
| GET | `/api/quotes/open` | 未结单报价（含距过期天数） |
| POST | `/api/quotes/:id/close` | 快捷结单（won / lost / no_response） |
| GET | `/api/analytics/rewrites` | 改稿率分析：AI 的措辞有多少被原样采用 |
| GET | `/api/messages/:id/rewrite` | 某条消息的「AI 原稿 vs 实际发出」对照 |

```bash
curl -X POST http://localhost:8787/api/quotes/$QUOTE_ID/revise \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"reason":"客户砍价，让 2 个点","discountPct":0.02,"marginDeltaPct":-0.01}'
```

返回新版本、原版本摘要与价差。原报价状态变为 `superseded`，历史通过
`parent_quote_id` / `superseded_by` 双向关联。

---

## 消息

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/messages` | 列表。参数：`status` `inquiryId` `customerId` `channel` |
| PATCH | `/api/messages/:id` | 编辑草稿的主题/正文（**首次改动会留存原稿**，用于改稿率分析） |
| POST | `/api/messages/:id/approve` | **确认并发送** —— 那 3 分钟的人工步骤 |
| POST | `/api/messages/:id/reject` | 退回为草稿 |
| POST | `/api/messages/:id/revert` | 还原为 AI 原稿 |
| POST | `/api/messages/:id/mark-sent` | 标记为已发送（线下发送后用） |

---

## 跟进

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/followups` | 列表。参数：`status` `customerId` `inquiryId` `dueBefore` |
| GET | `/api/followups/stats` | 排程/逾期/已回统计 |
| POST | `/api/followups/:id/draft` | 让跟单智能体起草这一条 |
| POST | `/api/followups/:id/send` | 起草（如需要）并发送 |
| POST | `/api/followups/:id/snooze` | 延后：`{"days":3}` 或 `{"until":"..."}` |
| POST | `/api/followups/:id/skip` | 跳过本次 |
| POST | `/api/followups/resequence` | 按当前策略重排某张报价的整条节奏 |

---

## 话术库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/playbooks` | 列表。参数：`stage` `language` `channel` `activeOnly` |
| POST | `/api/playbooks` | 新建 |
| PATCH | `/api/playbooks/:id` | 更新 |
| POST | `/api/playbooks/:id/win` | 记一次「这句话术带来了成交」 |
| POST | `/api/playbooks/:id/reply` | 记一次「带来了回复」 |

可用变量：`{code}` `{company}` `{contact_name}` `{sender_name}` `{sender_role}`
`{currency}` `{total}` `{incoterm}` `{port}` `{lead_time}` `{payment_terms}`
`{valid_until}` `{product_list}`

---

## 智能体与可观测性

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/agents` | 三个智能体的忙闲、队列、成功率、成本 |
| GET | `/api/agents/health` | LLM 就绪状态 + 智能体健康 + 队列 |
| GET | `/api/agents/tasks` | 任务队列。参数：`status` `agent` `limit` |
| GET | `/api/agents/runs` | 运行记录（含输入输出与成本） |
| POST | `/api/agents/run` | **手动派活**：`{"agent":"followup","taskType":"sweep_due"}` |
| POST | `/api/agents/:agent/toggle` | 启用/暂停某个智能体 |
| GET | `/api/events` | 事件日志。参数：`limit` `type` `entityId` |
| GET | `/api/analytics/loss` | 丢单归因 |
| GET | `/api/analytics/speed` | 响应速度（按渠道 / 语言拆分） |
| GET | `/api/analytics/agents` | 智能体效率与成本 |

### 手动触发一次跟单扫描

```bash
curl -X POST http://localhost:8787/api/agents/run \
  -H "Authorization: Bearer dealtrack-dev-token" \
  -H "content-type: application/json" \
  -d '{"agent":"followup","taskType":"sweep_due","payload":{}}'
```

---

## 对齐群与预警

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/threads` | 讨论串列表 |
| GET | `/api/threads/:id` | 串 + 消息 |
| POST | `/api/threads/:id/messages` | 发言 |
| POST | `/api/threads/:id/resolve` | 标记解决 |
| GET | `/api/alerts` | 预警列表（`?openOnly=false` 含已确认） |
| POST | `/api/alerts/:id/ack` | 确认预警 |

---

## 看板数据

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/overview` | 看板主聚合：KPI、漏斗、在途、风险、丢单、LLM 成本 |
| GET | `/api/overview/timeseries` | 时间序列（询盘/报价/成交/平均首响） |

```json
{
  "kpi": {
    "avgFirstResponseMinutes": 0.1,
    "targetMinutes": 3,
    "baselineMinutes": 30,
    "minutesSaved": 179,
    "speedupFactor": 10,
    "responded": 6
  },
  "funnel": { "received": 6, "quoted": 6, "sent": 0, "won": 0, "quoteRate": 1 },
  "pipeline": { "openValue": 784991.76, "openMargin": 160647.83 },
  "risks": { "pendingApprovals": 6, "slaAtRisk": 0, "deadTasks": 0 }
}
```

---

## 产品库

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/products` | 列表（含价格阶梯） |
| GET | `/api/products/:id` | 详情 + 该产品的历史报价 |
| POST | `/api/products` | 新建（可同时带 `tiers`，以及 `spec.aliases` 多语言别名） |
| PATCH | `/api/products/:id` | 更新（可同时带 `tiers`） |
| POST | `/api/products/match` | 品名模糊匹配产品库（命中 `spec.aliases`，支持跨语言） |

---

## 设置

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/settings` | 公司、销售身份、自动化、LLM、集成、可选供应商与单价 |
| PUT | `/api/settings` | 更新（`company` / `sales` / `automation` / `llm`） |
| PUT | `/api/settings/integrations` | 更新邮件 / WhatsApp / OCR（密钥单独加密） |
| POST | `/api/settings/test/llm` | LLM 连通性测试 |
| POST | `/api/settings/test/email` | SMTP 连通性测试 |
| POST | `/api/settings/rotate-token` | 轮换 API Token |
| POST | `/api/settings/reset` | 恢复默认设置 |
| GET | `/api/fx` | 汇率表与折算结果 |
| PUT | `/api/fx` | 更新某组汇率 |
| POST | `/api/integrations/email/sync` | 立即拉取收件箱（幂等） |
| GET | `/api/users` | 成员列表 |

---

## 入站 Webhook

### 邮件

```bash
curl -X POST http://localhost:8787/api/inbound/email \
  -H "Authorization: Bearer dealtrack-dev-token" \
  -H "content-type: application/json" \
  -d '{
    "from": "buyer@example.com",
    "fromName": "Example Buyer",
    "subject": "RFQ 5000 pcs power bank",
    "text": "Please quote 5,000 pcs 20000mAh power bank, CIF Felixstowe, target USD 13.80",
    "messageId": "<unique-id@example.com>"
  }'
```

`messageId` 用于**幂等去重** —— 重复推送不会产生重复询盘。
若发件人已有进行中的会话，会被识别为**回复**而不是新询盘。

### WhatsApp（简化格式）

```bash
curl -X POST http://localhost:8787/api/inbound/whatsapp \
  -H "Authorization: Bearer dealtrack-dev-token" \
  -H "content-type: application/json" \
  -d '{"from":"+8613800000000","name":"Buyer","text":"需要 2000 个保温杯，FOB 深圳"}'
```

---

## SSE 实时事件流

```js
const source = new EventSource(`/api/stream?token=${TOKEN}`);
for (const type of ['inquiry.received', 'quote.created', 'message.sent', 'followup.due']) {
  source.addEventListener(type, (event) => console.log(type, JSON.parse(event.data)));
}
source.addEventListener('heartbeat', (event) => {
  console.log('智能体状态', JSON.parse(event.data).agents);
});
```

心跳每 15 秒一次，携带各智能体忙闲状态；断开后浏览器会自动重连（`retry: 3000`）。

---

## 事件目录

| 事件 | 触发时机 |
|---|---|
| `inquiry.received` | 任意渠道新询盘入库 |
| `inquiry.parsed` | 解析完成 |
| `inquiry.needs_info` | 解析置信度低或未能匹配产品 |
| `customer.created` | 自动建档 |
| `quote.created` / `quote.pending_approval` | 报价生成 / 待审批 |
| `quote.sent` / `quote.accepted` / `quote.rejected` | 报价生命周期 |
| `message.drafted` / `message.approved` / `message.sent` / `message.received` | 消息生命周期 |
| `followup.scheduled` / `followup.drafted` / `followup.sent` / `followup.replied` | 跟进生命周期 |
| `followup.escalated` / `customer.silent` | 沉默升级 |
| `risk.lead_time` / `sla.at_risk` / `sla.breached` | 风险 |
| `thread.opened` / `thread.message` | 业务对齐群 |
| `customs.declaration_drafted` / `customs.compliance_issue` | 报关 |
| `quote.partial_match` | 询盘有行未匹配产品库，未计入报价 |
| `proforma.issued` | 形式发票已签发（含回款节点） |
| `payment.due` / `payment.overdue` / `payment.received` | 回款生命周期 |
| `payment.reminder_drafted` | 催款草稿已就绪 |
| `agent.run.succeeded` / `agent.run.failed` / `task.enqueued` / `task.dead` | 平台自身 |
