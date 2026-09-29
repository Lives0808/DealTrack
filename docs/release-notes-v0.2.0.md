## DealTrack v0.2.0 · 成交链路补齐

> 把「**30 分钟/封**」变成「**3 分钟/封**」，并且**不漏跟**。
>
> 这个版本补的是 v0.1.0 停下来的那一步：**客户说 yes 之后**。

---

## 这个版本新增什么

### 形式发票（PI）与回款 —— 成交之后的第二幕

v0.1.0 里，登记成交只是把状态翻成 `accepted`，剩下的 PI、定金、尾款全靠人工。
这个版本把后半段接上了：

| 动作 | 谁做 |
|---|---|
| 生成多语言形式发票（含银行信息、付款计划） | 成交事件自动触发 |
| 按付款条款拆出定金 / 尾款节点 | 自动 |
| 逾期标记 + 预警 | 每 60 秒扫描 |
| 起草催款（客户语言，带金额与原始到期日） | 跟单智能体，72 小时内不重复 |
| 登记收款、推进 PI 状态、刷新逾期统计 | 你在「回款看板」点一下 |

> 行项目**复用报价行**而不是另存一份 —— 复制行项目是对账差异的来源。

### 报价改版

客户砍价后重新报价，历史不再断掉：新版本关联父报价、记录改版原因、
原报价标记 `superseded`，完整改版链可查（含每版价差）。

一个月后客户问「怎么比上次贵」，这段历史就是答案。

### 改稿留痕 —— 话术库终于能学习

首次人工改动草稿时保存 AI 原稿、记录改动人。话术排序对**总被改**的模板降权，
并新增改稿率分析接口。

之前「话术库越用越准」是句空话：只有「被用了多少次」，没有「有多少被原样发出」。

---

## 修复了什么（10 项，都是会造成真实损失的）

| 缺陷 | 后果 |
|---|---|
| **未匹配产品库的行被静默丢弃** | 客户问 3 个产品只报 2 个，直到下单才发现 |
| **SKU 里的数字段匹配到数量** | `MUG-INSUL-500` 的 "500" 匹配到任意行的「500 pcs」，无关行被安上错误产品 |
| **产品推断用整封邮件做匹配** | 每行都指向同一产品，多行 RFQ 变成同一 SKU 的重复行 |
| **报价过期后状态永不推进** | 丢单分析看不到「客户失联」，归因失真 |
| **跟进渠道永远发邮件** | WhatsApp 来的客户收不到跟进，等于没跟 |
| **45 天内有过往来即判定为同一询盘** | 老客户谈新项目被并进旧询盘，报价对象错乱 |
| **人工改稿不留痕** | 话术库无从优化 |
| **报价改版链表断裂** | 前后向遍历共用一个 visited 集合，谈判历史只剩一版 |
| **成交下游只走一条路径** | 只有 API 的 outcome 接口会触发 PI 与报关 |
| **部分匹配的报价可能被自动发出** | 开启 autoSend 后缺行报价直接出门 |

现在：**未匹配的行会写进内部备注、触发预警、并在给客户的回复里明确列出；
无论是否开启自动发送，缺行的报价一律停下等人工。** 丢掉一个行项目，
比多花一分钟严重得多。

---

## 工程

- **Dockerfile + docker-compose**：多阶段构建、非 root、含 Chromium 与 Noto 全套字体、
  健康检查、`shm_size`、日志轮转、卷持久化
  > ⚠️ 本机构建环境没有 Docker，只做了 YAML 解析校验。首次使用请留意构建日志。
- **前端三层 ErrorBoundary**：一个面板渲染出错不再整页白屏
- **请求 ID + 结构化日志**：每个响应带 `x-request-id`（尊重上游传入），
  失败与慢请求按结构化字段记录
- **所有写接口 zod 校验**，全仓库消除 11 处 `as never` 强转
- **冒烟测试 51 → 83 项**，新增 6 个章节

---

## 下载

| 文件 | 说明 |
|---|---|
| `dealtrack-server-0.2.0.tgz` | 服务端 + Web 控制台完整源码 |
| `dealtrack-android-0.2.0.apk` | 安卓原生 App |
| `SHA256SUMS.txt` | 校验和 |

### 跑起来

```bash
tar xzf dealtrack-server-0.2.0.tgz && cd DealTrack
npm install
npm run seed --workspace=server -- --with-samples
npm start                          # → http://localhost:8787
```

**不需要任何 API Key。** 默认走内置离线引擎。

### 验证它真的能跑

```bash
npm run smoke --workspace=server
```

83 项端到端断言，含本版新增的成交链路：

```
【13】成交链路：形式发票 + 回款节点
  ✔ 成交后自动生成形式发票 — PI-202609-0001 总额 USD 69587.66
  ✔ 定金/尾款按付款条款拆分 — 定金 20876.30 (30%) + 尾款 48711.36
  ✔ 登记收款后节点完结 — paid
  ✔ PI 状态推进 — deposit_paid
【14】报价改版（保留谈判历史）
  ✔ 改版链完整 — QT-202609-0001 → QT-202609-0001-R1
【16】回复识别收紧（不把新项目并进旧对话）
  ✔ 老客户的新项目另建询盘 — 新建 INQ-20260929-0007
【17】部分匹配必须显式暴露（不能静默丢行）
  ✔ 开启自动发送时，缺行的报价仍被拦下 — 状态 pending_approval
【18】报价过期与失联自动结单
  ✔ 超期后自动登记 no_response
```

### Docker

```bash
cp .env.example .env    # 至少改掉 DEALTRACK_API_TOKEN
docker compose up -d
```

---

## 界面

![回款看板](https://raw.githubusercontent.com/Lives0808/DealTrack/main/docs/screenshots/05-payments.png)

---

## 仍然没做

见 [docs/KNOWN-GAPS.md](https://github.com/Lives0808/DealTrack/blob/main/docs/KNOWN-GAPS.md)，
区分「未做（附原因）」与「可接受的取舍」。

主要三项：**多租户 + PostgreSQL**（只有托管才需要，SQL 已按可迁移写）、
**iOS 原生**（与安卓共享 API，但 UI 要重写）、
**RAG 话术库 / A/B**（需要足够历史成交邮件，前置信号已在积累）。

## 文档

[README](https://github.com/Lives0808/DealTrack#readme) ·
[架构](https://github.com/Lives0808/DealTrack/blob/main/docs/ARCHITECTURE.md) ·
[API](https://github.com/Lives0808/DealTrack/blob/main/docs/API.md) ·
[部署](https://github.com/Lives0808/DealTrack/blob/main/docs/DEPLOYMENT.md) ·
[路线图](https://github.com/Lives0808/DealTrack/blob/main/docs/ROADMAP.md) ·
[已补/未补清单](https://github.com/Lives0808/DealTrack/blob/main/docs/KNOWN-GAPS.md)

## 许可

MIT
