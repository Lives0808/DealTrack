## DealTrack · 数字外贸团队

> 把「**30 分钟/封**」变成「**3 分钟/封**」，并且**不漏跟**。

跨境小卖家的 **询盘 → 报价 → 跟进** 一体化工作台。
不是一个简单的 CRM，而是一个能自动干活的 AI 外贸团队：**多智能体协作 + 事件驱动自动化**。

---

## 这个版本能做什么

### 三个智能体自动接力

**销售智能体** — 解析任意语言的询盘，匹配产品库，按成本阶梯算 FOB/CIF/DDP，用客户的语言起草报价邮件。

**跟单智能体** — 报价一发出就排好 D+3/7/14/30 的跟进节奏；客户一回复自动停止催问；沉默超阈值自动拉「业务对齐群」。

**报关智能体** — 生成报关要素表，HS 自动归类，7 项合规校验（单货一致、目的国认证、制裁初筛）。

> 关键设计：智能体之间**不互相调用**，各自只写事件，由编排器按声明式路由表派活。
> 所以进程崩了也不丢待办 —— **这是「不漏跟」的工程基础，不是靠人记性好**。

### 老板数据看板
首响时长对比 30 分钟基线、累计节省工时、询盘→解析→报价→发出→成交漏斗、智能体忙闲、丢单归因排行。

### 算得清的价格
```
(单位成本 + 包装 + 内陆) ÷ 汇率 ÷ (1 − 目标毛利)  →  FOB 价
  + 运费/保险分摊（CIF/CFR/CIP/CPT/DAP）
  + 关税估算（DDP）
  → 规则引擎（阶梯毛利/免佣金/客户折扣/市场加价）→ 底价保护
```
每张报价都存了档位、毛利、汇率和命中的每条规则 —— 六周后客户砍价，能立刻回答「这价怎么算的」。

### 多语言（17 种）
英/中/西/法/德/俄/阿/葡/日/韩为完整正文，阿语支持 RTL 排版，报价单与报关单按客户语言渲染。

---

## 下载与安装

| 文件 | 说明 |
|---|---|
| `dealtrack-server-0.1.0.tgz` | 服务端 + Web 控制台完整源码 |
| `dealtrack-android-0.1.0.apk` | 安卓原生 App（Kotlin + Compose，1.4 MB） |
| `SHA256SUMS*.txt` | 校验和 |

### 三步跑起来

```bash
tar xzf dealtrack-server-0.1.0.tgz && cd DealTrack

npm install
npm run seed --workspace=server -- --with-samples   # 演示数据 + 6 条多语言询盘
npm start                                            # → http://localhost:8787
```

**不需要任何 API Key。** 默认走内置离线引擎，完整跑通
询盘解析 → 产品匹配 → FOB/CIF 定价 → 多语言起草 → 跟进排程。

想接真实模型：「设置 → AI 模型」选供应商填 Key（BYOK，支持 OpenAI / DeepSeek / Ollama / 任意 OpenAI 兼容端点）。单封询盘成本约 $0.001。

### 验证它真的能跑

```bash
npm run smoke --workspace=server
```

**51 项端到端断言**，覆盖从「一封德文询盘进来」到「成交生成报关要素表」全链路：

```
✔ 语言自动识别 — de/es/en/pt/ru/ja
✔ 产品库匹配命中 — 6/6 条匹配到 SKU
✔ 报价有行项目 — 行项目数 1/2/1/1/1/1
✔ CIF 报价含运费分摊 — QT-202609-0004 USD2400
✔ 草稿语言跟随客户 — zh/ru/pt/en/es/de
✔ 跟进按 D+3/7/14/30 分布 — D3 D7 D14 D30
✔ 客户回复后停止跟进 — 4 → 0
✔ 合规校验执行 — 7 项检查
✔ 同一产品数量未被重复报价 — 没有重复行
✔ 报价总量未超过询盘数量 — 数量守恒
```

### 安卓端

手机与电脑连同一 Wi-Fi，App 设置里填 `http://<电脑局域网IP>:8787` 与 API Token。
模拟器用默认的 `http://10.0.2.2:8787` 即可直达宿主机。

> APK 使用 Android 调试签名以便直接安装体验。
> 正式分发请生成自己的密钥并配置 `android/keystore.properties`。

---

## 界面

![老板看板](https://raw.githubusercontent.com/Lives0808/DealTrack/main/docs/screenshots/01-dashboard.png)

---

## 安全与合规

- **本地优先** — 客户数据、报价历史、邮件正文默认全部留在本机；除你自己配置的 LLM 供应商外不向任何第三方传输
- **密钥加密** — BYOK Key / SMTP 密码 / WhatsApp Token 用 AES-256-GCM 加密后入库，主密钥在本机 `data/.master.key`（权限 600）。拷走数据库拿不到密钥
- **人工兜底** — 默认 `autoSend=false`，AI 生成的一切都要过人工确认才外发
- **可审计** — 每个事件、每次智能体运行、每条外发消息全部留痕

---

## 技术栈

| 层 | 选型 |
|---|---|
| 多智能体 | 自研事件驱动编排器（TypeScript 严格模式） |
| 数据层 | SQLite（`node:sqlite`，无原生编译）；SQL 为 ANSI 风格便于换 PostgreSQL |
| LLM | BYOK + 内置离线引擎，结构化输出带 Schema 校验与修复 |
| 前端 | React 18 + Vite + Ant Design 5 + Recharts |
| 安卓 | Kotlin + Jetpack Compose + OkHttp（真原生） |
| 文档 | Chrome headless 渲染 HTML → PDF（真 CJK + 真 RTL） |
| 邮件/IM | IMAP + SMTP（按 Message-ID 幂等去重） |
| WhatsApp | Business Cloud API + Webhook |

---

## 开发过程中发现并修复的真实缺陷

这个版本不只是「跑通」，下面是开发中查出来并修掉的：

| 缺陷 | 后果 |
|---|---|
| 日文询盘被识别为中文 | 客户收到中文邮件 |
| `1. 5,000 pcs` 解析成数量 15 | 报价数量错 300 倍 |
| 「500ml」被截成「ml」 | 报价单产品名损坏 |
| CIF 报价写成起运港 | `CIF Santos` 变成 `CIF Shenzhen` |
| 已知客户语言时不回填国家 | 客户画像残缺，市场分析失效 |
| 阿语单据用阿拉伯-印度数码 | 海湾客户财务系统认不出数字 |
| RTL 下付款条款被 bidi 重排 | 「30% T/T deposit」变成「T/T deposit 30%」 |
| 前端静态资源 `wildcard:false` | 重建后整页白屏（MIME type 报错） |
| 冒烟测试误写真实数据库 | 测试污染生产数据 |
| 询盘主题与正文都写了数量 | 3000 件被报成 6000 件、总额翻倍 |
| API 与事件路由各排一次任务 | 同一询盘解析两次，LLM 花费翻倍 |

---

## 文档

- [README](https://github.com/Lives0808/DealTrack#readme) — 快速开始与功能地图
- [架构](https://github.com/Lives0808/DealTrack/blob/main/docs/ARCHITECTURE.md) — 为什么事件驱动、数据模型、定价引擎
- [API](https://github.com/Lives0808/DealTrack/blob/main/docs/API.md) — 完整接口参考
- [部署](https://github.com/Lives0808/DealTrack/blob/main/docs/DEPLOYMENT.md) — 单机 / 后台常驻 / Docker / 集成配置 / 排障
- [路线图](https://github.com/Lives0808/DealTrack/blob/main/docs/ROADMAP.md) — 下一步做什么，以及明确不做什么

## 许可

MIT
