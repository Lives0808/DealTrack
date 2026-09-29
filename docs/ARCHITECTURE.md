# 架构

## 一句话

DealTrack 是一个**事件驱动**的外贸工作台：任何一件事发生，都先写成一条**事件**；
一张**声明式路由表**决定哪个**智能体**接手；智能体的产出又是一条事件。

## 为什么是事件驱动，而不是「函数互相调用」

最自然的写法是让销售智能体直接调用跟单智能体：

```ts
await salesAgent.parse(inquiry);
await followupAgent.schedule(quote);   // ← 错误示范
```

这样写会在三个地方付出代价：

| 问题 | 后果 |
|---|---|
| 进程崩溃时，调用链断在中间 | 报价生成了但没排跟进 —— 客户就丢了。也就是「漏跟」 |
| 无法回答「为什么这封邮件发出去了」 | 没有审计轨迹，出事只能靠猜 |
| 加一个新能力要改多个智能体 | 每个智能体都要知道别人存在，耦合成一团 |

DealTrack 改成：

```ts
emit({ type: 'inquiry.received', entityType: 'inquiry', entityId: id });
```

```ts
// orchestrator.ts —— 声明式路由，加能力 = 加一行
{
  on: EVENTS.INQUIRY_RECEIVED,
  agent: 'sales',
  taskType: 'parse_inquiry',
  priority: 10,
  dedupe: (event) => `parse:${event.entityId}`,
}
```

事件先落库，再派任务。崩了重启，队列里的任务接着跑 —— **这是「不漏跟」的工程基础，而不是靠人记性好**。

---

## 分层

```
┌──────────────────────────────────────────────────────────────┐
│  接口层  api/                                                 │
│  REST + SSE（/api/stream）+ Webhook（邮件 / WhatsApp）         │
├──────────────────────────────────────────────────────────────┤
│  智能体层  agents/                                            │
│  sales · followup · customs  +  orchestrator（路由 / 工作池 / 扫描）│
├──────────────────────────────────────────────────────────────┤
│  领域层  core/                                                │
│  pricing · i18n · ingest · llm · repos · events · queue       │
├──────────────────────────────────────────────────────────────┤
│  集成层  integrations/   docgen/                              │
│  IMAP/SMTP · WhatsApp · OCR     报价单 / 报关要素表（HTML→PDF） │
├──────────────────────────────────────────────────────────────┤
│  数据层  core/db.ts  +  core/schema.ts                        │
│  SQLite（node:sqlite，无原生编译）；SQL 为 ANSI 风格          │
└──────────────────────────────────────────────────────────────┘
```

---

## 数据模型（28 张表）

### 业务实体
| 表 | 说明 |
|---|---|
| `products` / `price_tiers` | 产品库与**数量分档成本 + 目标毛利** |
| `price_rules` | 声明式定价规则（阶梯毛利、免运费、客户折扣、市场加价） |
| `customers` | 客户库，含国家 ISO 码、偏好、成交统计 |
| `inquiries` / `inquiry_items` | 询盘与行项目，含 AI 解析结果、SLA 计时 |
| `quotes` / `quote_items` | 报价历史，含成本、毛利、命中的规则、价格构成 |
| `quote_outcomes` | **成交 / 丢单**及原因 —— 数据闭环的关键表 |
| `followups` | 跟进排程，D+n 序列与状态机 |
| `outbound_messages` | 双向消息（inbound/outbound 同表，便于线程视图） |
| `playbooks` | **话术库**，含使用/回复/成交计数 |
| `threads` / `thread_messages` | 「业务对齐群」内部讨论串 |
| `alerts` / `attachments` | 预警与附件（含 OCR 结果） |

### 事件驱动骨架
| 表 | 说明 |
|---|---|
| `events` | 只追加的事件日志，`correlation_id` 串起一件事的全链路 |
| `agent_tasks` | 持久化工作队列；唯一索引 `dedupe_key` 保证同任务不重复排队 |
| `agent_runs` | 每次智能体运行：触发事件、输入输出、模型、耗时、成本 |
| `agent_state` | 智能体忙闲与累计指标（看板用） |
| `llm_usage` | 逐次 LLM 调用记账（BYOK 成本可见） |
| `sync_state` | IMAP / WhatsApp 同步游标 |

### 设计约定
- 主键统一是应用层生成的 **TEXT id**（不是 AUTOINCREMENT）→ 换 PostgreSQL 不用改代码
- 时间统一 **ISO-8601 UTC 字符串** → 可排序、可比较、无时区坑
- 结构化 JSON 存 TEXT，读时 `parseJson()`
- 迁移是**只能向前**的数组（`MIGRATIONS`），带版本表

---

## 定价引擎

```
单位成本 (CNY, 按数量命中档位)
   + 包装成本 + 内陆运费
   ÷ 汇率                     ← fx_rates 表 / 内置默认
= 到岸成本 (报价币种)
   ÷ (1 − 目标毛利率)
= 出厂价 / FOB 单价
   + 运费分摊 + 保险分摊      ← 按行金额占比（CIF/CFR/CIP/CPT/DAP）
   + 关税估算                 ← DDP
= 客户看到的单价
   ↓
  规则引擎（可叠加，按 priority）
   ↓
  底价保护：任何折扣都不能把毛利率压穿下限（默认 5%）
```

**为什么要把过程存下来**：报价单里存了档位、毛利、汇率、命中的每一条规则。
六周后客户砍价时，老板能立刻回答「上一版的钱是怎么算出来的」，而不是重新推一遍。

### 命名地点（容易搞错的地方）
- `FOB / FCA / EXW` → 后面跟**起运港**（例：`FOB Shenzhen`）
- `CIF / CFR / CIP / CPT / DAP / DDP` → 后面跟**目的港**（例：`CIF Santos`）

写错这个不影响报价算术，但会直接影响客户对你专业度的判断，所以引擎强制区分。

---

## 多智能体细节

### 销售智能体
`parse_inquiry` → 结构化抽取（LLM，JSON Schema 校验 + 一次修复 + 确定性兜底）
→ 产品库匹配（SKU/品名/品类/目标市场加权）
→ 客户建档/回填（国家 ISO 码、语言）
→ 写 `inquiry.parsed`

`draft_quote_and_reply` → 定价 → 建报价单 → 生成 PDF
→ 话术库选骨架 → LLM 个性化 → 建待审消息 → 写 `quote.created` / `message.drafted`

`classify_inbound` → 判断客户回复意图（嫌贵 / 问交期 / 要下单 / 拒绝 / 投诉…）
→ **取消全部待发跟进** → 按意图分流（记录成交、记录丢单、起草应对）

### 跟单智能体
`sweep_due`（每 60 秒）→ 找到期跟进 → 交给 `draft_followup`
`detect_silence` → 报价将过期 / 客户沉默超阈值 → 建「业务对齐群」
`detect_risks` → 交期承诺超出客户要求 / 询盘超时未响 / 草稿滞留

### 报关智能体
`draft_declaration` → 报关要素表 + 7 项合规校验 → 有阻塞项就拉群
`classify_hs_codes` → 为无 HS 编码的产品归类，低置信度不猜、转人工

---

## 人工兜底（Human-in-the-loop）

默认 `automation.autoSend = false`：

```
AI 做完 27 分钟的工作
        ↓
消息落为 pending_approval
        ↓
人在 Web 控制台或安卓 App 上花 3 分钟审阅
        ↓
点「确认发送」→ 真正投递 → 首次响应计时停止 → 跟进节奏自动排定
```

打开 `autoSend` 后全自动，但**依然全程留痕**，每一条都可追溯、可回滚。

---

## LLM 层（BYOK）

```
LlmService.json({ schema, fallback, operation, context })
   ├─ 解析供应商配置（界面设置优先于环境变量）
   ├─ 未配置 Key → 自动降级到内置离线引擎（不中断流程）
   ├─ 调用 → 抽取 JSON（处理 ``` 围栏 / 前后缀噪声 / 括号平衡）
   ├─ zod 校验 → 失败则带上错误重试一次
   ├─ 仍失败 → 走确定性 fallback，任务照常完成
   └─ 记入 llm_usage（tokens / 成本 / 耗时 / 成败）
```

**设计原则：模型不可用不能导致业务流程中断。** 一个智能体永远能完成任务，
只是质量可能从「母语级拟稿」降到「模板填充」。

内置离线引擎（`llm/providers.ts` 的 `MockProvider`）不是占位符：
它实现了与真实模型相同的契约（结构化抽取、多语言拟稿、意图分类），
用多语言正则 + 话术库完成真实工作。这就是全新克隆无需任何 Key 就能演示的原因。

---

## 文档生成

```
报价数据 → HTML（内嵌打印样式、CJK 字体栈、dir="rtl"）
        → Chrome headless --print-to-pdf
        → data/exports/quotes/QT-202609-0001.pdf
```

**为什么用 Chrome 而不是 PDF 库**：报价单是**文档**，需要真排版、真 CJK、真 RTL 和打印 CSS。
Chrome 今天就能正确处理这些；而 PDF 库要在字体嵌入、双向文本整形上重新发明一遍。

Chrome 不存在时，仍然输出 HTML —— 浏览器自带「打印为 PDF」效果完全一致，流程不被阻塞。

### 多语言排版的两个坑（已修）
1. **数字体系**：`ar-SA` 默认输出阿拉伯-印度数码（٢٩），海湾客户的财务系统认不出。强制 `numberingSystem: latn`。
2. **双向文本**：`30% T/T deposit, 70% before shipment` 在 RTL 语境下会被 bidi 算法重排成 `T/T deposit, 70% before shipment 30%`。所有混合内容用 `<bdi>` 隔离。

---

## 性能与扩展性

当前定位是**单机、单租户、本地优先**，因此：
- SQLite + `node:sqlite`，WAL 模式，无原生编译
- 工作池默认 4 并发，队列轮询 750ms
- 扫描任务每 60 秒一次（跟单 + 风险合并到同一轮，避免定时器爆炸）

扩展到多租户 / 服务端部署时的路径：
1. `core/db.ts` 换 PostgreSQL 驱动（SQL 已是 ANSI 风格，TEXT 主键、ISO 时间）
2. `agent_tasks` 的认领改为 `SELECT ... FOR UPDATE SKIP LOCKED`
3. `events` 换 Kafka / NATS（接口已抽象在 `core/events.ts`）
4. 每张业务表加 `workspace_id` 并进索引首列
