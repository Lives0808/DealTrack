# 部署

DealTrack 是**本地优先**的：默认所有数据留在你自己机器上。下面是从「一人公司自己用」到「给团队用」的几种部署方式。

---

## 方式一：单机运行（推荐起步）

适合一个人或两三个人自己用。

### 前置

- **Node.js ≥ 22.5**（需要内置的 `node:sqlite`）
- **Google Chrome / Chromium**（用于把报价单渲染成 PDF；没有也能用，只是只输出 HTML）
- macOS / Linux / Windows 均可

### 步骤

```bash
git clone https://github.com/Lives0808/DealTrack.git
cd DealTrack
npm install
npm run build

# 首次：写入演示数据并跑通流水线（可选）
npm run seed --workspace=server -- --with-samples

npm start
```

打开 <http://localhost:8787>。

### 让手机上的安卓 App 连上

1. 查本机局域网 IP：

   ```bash
   # macOS
   ipconfig getifaddr en0
   # Linux
   hostname -I | awk '{print $1}'
   ```

2. 确认服务监听在 `0.0.0.0`（默认就是），且防火墙放行 8787 端口。

3. 手机与电脑连同一个 Wi-Fi，在 App 设置里填 `http://192.168.x.x:8787` + API Token。

4. 安全起见，改掉默认 Token：

   ```bash
   DEALTRACK_API_TOKEN=$(openssl rand -base64 24) npm start
   ```

   然后在「设置 → 系统与安全」里同步到 App。

---

## 方式二：后台常驻（开机自启）

### macOS（launchd）

```bash
mkdir -p ~/Library/LaunchAgents
cat > ~/Library/LaunchAgents/com.dealtrack.server.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.dealtrack.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YOUR_NAME/DealTrack/server/dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/Users/YOUR_NAME/DealTrack</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>NODE_ENV</key><string>production</string>
    <key>DEALTRACK_API_TOKEN</key><string>replace-with-a-long-random-token</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/Users/YOUR_NAME/DealTrack/data/dealtrack.log</string>
  <key>StandardErrorPath</key><string>/Users/YOUR_NAME/DealTrack/data/dealtrack.err.log</string>
</dict>
</plist>
PLIST

launchctl load ~/Library/LaunchAgents/com.dealtrack.server.plist
```

### Linux（systemd）

```ini
# /etc/systemd/system/dealtrack.service
[Unit]
Description=DealTrack
After=network.target

[Service]
Type=simple
User=dealtrack
WorkingDirectory=/opt/DealTrack
Environment=NODE_ENV=production
Environment=DEALTRACK_API_TOKEN=replace-with-a-long-random-token
Environment=DEALTRACK_DATA_DIR=/var/lib/dealtrack
ExecStart=/usr/bin/node /opt/DealTrack/server/dist/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now dealtrack
journalctl -u dealtrack -f
```

### 用 pm2（跨平台，最省事）

```bash
npm i -g pm2
pm2 start server/dist/index.js --name dealtrack --env production
pm2 save && pm2 startup
```

---

## 方式三：Docker

```dockerfile
# Dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm install
COPY . .
RUN npm run build

FROM node:22-slim
# Chrome 用于渲染报价单 PDF（约 300MB；不需要 PDF 可删掉这三行）
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium ca-certificates fonts-noto-cjk fonts-noto-core \
    && rm -rf /var/lib/apt/lists/*
ENV DEALTRACK_CHROME_PATH=/usr/bin/chromium

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY package.json ./

ENV NODE_ENV=production
ENV DEALTRACK_DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8787

CMD ["node", "server/dist/index.js"]
```

```bash
docker build -t dealtrack .
docker run -d --name dealtrack \
  -p 8787:8787 \
  -v dealtrack-data:/data \
  -e DEALTRACK_API_TOKEN="$(openssl rand -base64 24)" \
  --restart unless-stopped \
  dealtrack
```

> ⚠️ **`/data` 必须持久化。** 里面是数据库、导出文档，以及加密密钥 `data/.master.key`。
> 丢了密钥，之前加密存储的 BYOK Key / SMTP 密码就解不开了（业务数据不受影响，但需要重新填一次密钥）。

---

## 集成配置

### 邮件（IMAP 收 / SMTP 发）

在「设置 → 集成 → 邮件」里填，或走环境变量：

```bash
DEALTRACK_EMAIL_ENABLED=1
DEALTRACK_IMAP_HOST=imap.qiye.aliyun.com
DEALTRACK_IMAP_PORT=993
DEALTRACK_SMTP_HOST=smtp.qiye.aliyun.com
DEALTRACK_SMTP_PORT=465
DEALTRACK_EMAIL_USER=sales@yourdomain.com
DEALTRACK_EMAIL_PASSWORD=your-app-password     # 建议用应用专用密码，不是登录密码
DEALTRACK_EMAIL_FROM_NAME="Your Company Sales"
```

**行为说明**
- 轮询频率默认 60 秒（`DEALTRACK_IMAP_POLL_SECONDS`）
- 按 **Message-ID 幂等**：重复拉取、重启、双实例都不会产生重复询盘
- 自动跳过自己发出的邮件
- 附件落盘到 `data/storage/attachments/`，供 OCR 使用
- **不配置时是「模拟发送」**：消息照常记录、流程照常推进，只是不真正投递。适合先跑通流程再接邮箱。

### WhatsApp Business API

1. 在 [Meta for Developers](https://developers.facebook.com/) 创建 App，添加 WhatsApp 产品
2. 拿到 **Phone Number ID** 与 **Access Token**
3. 在「设置 → 集成 → WhatsApp」填入，并设置一个随机 **Verify Token**
4. 在 Meta 后台把回调地址填成：

   ```
   https://你的公网域名/api/whatsapp/webhook
   ```

   本地没有公网地址时用 ngrok / cloudflared 临时映射：

   ```bash
   cloudflared tunnel --url http://localhost:8787
   ```

5. 订阅 `messages` 字段

### OCR（附件识别）

```bash
DEALTRACK_OCR_ENABLED=1
DEALTRACK_OCR_PROVIDER=textin
DEALTRACK_OCR_API_KEY=your-key
```

未配置时附件会保留并标记为 `skipped`，提示人工阅读后补录 —— 不会静默丢弃。

---

## 接到真实 LLM

默认走内置离线引擎（无需 Key，零成本）。切换方式：

**界面（推荐）**：「设置 → AI 模型」选供应商、填 Key、点「测试连通性」。

**环境变量**：

```bash
# DeepSeek
DEALTRACK_LLM_PROVIDER=deepseek
DEALTRACK_LLM_MODEL=deepseek-chat
DEEPSEEK_API_KEY=sk-...

# OpenAI
DEALTRACK_LLM_PROVIDER=openai
DEALTRACK_LLM_MODEL=gpt-4o-mini
OPENAI_API_KEY=sk-...

# 本地 Ollama（数据完全不出本机）
DEALTRACK_LLM_PROVIDER=ollama
DEALTRACK_LLM_MODEL=qwen2.5:7b
DEALTRACK_LLM_BASE_URL=http://localhost:11434

# 自建 vLLM / LM Studio / 其他兼容端点
DEALTRACK_LLM_PROVIDER=openai-compatible
DEALTRACK_LLM_BASE_URL=http://your-host:8000/v1
DEALTRACK_LLM_MODEL=Qwen/Qwen2.5-72B-Instruct
```

**成本参考**（每百万 tokens）：`deepseek-chat` 约 $0.27 / $1.10，`gpt-4o-mini` 约 $0.15 / $0.60。
一封询盘的完整处理（解析 + 定价说明 + 邮件起草）大约 3～6k tokens，**单封成本在 $0.001 量级**。

看板上有 `AI 调用成本` 卡片，按区间统计调用次数、tokens 与花费。

---

## 备份与恢复

```bash
# 备份（热备份，WAL 模式下安全）
sqlite3 data/dealtrack.sqlite ".backup 'backup-$(date +%F).sqlite'"

# 连同导出文档与密钥一起备份
tar czf dealtrack-backup-$(date +%F).tgz data/

# 恢复
tar xzf dealtrack-backup-2026-09-29.tgz     # 覆盖 data/
npm start
```

> 备份里包含 `data/.master.key`，请按敏感文件保管（等同密码库）。

---

## 升级

```bash
git pull
npm install
npm run build
# 重启服务即可 —— 启动时会自动跑 schema 迁移（只能向前，不会丢数据）
```

迁移是**只能向前**的数组形式（`server/src/core/schema.ts` 的 `MIGRATIONS`），
每步都在事务里执行并记录版本。降级请用备份恢复。

---

## 排障

| 现象 | 原因 / 处理 |
|---|---|
| 报价单只有 HTML 没有 PDF | 未检测到 Chrome。设 `DEALTRACK_CHROME_PATH` 指向 Chrome/Chromium 可执行文件 |
| 前端白屏、控制台报 MIME type 错误 | `web/dist` 是后来才构建的（或重建过），而服务是旧进程。重启服务即可 —— 静态资源路由在启动时注册 |
| 邮件一直是「模拟发送」 | 邮件集成未启用或未配 SMTP。看 `/api/health` 的 `integrations.email` |
| 智能体不动 | 在「智能体」页检查是否被暂停（`enabled`）；或看 `agent_tasks` 是否有死信 |
| Token 401 | App / 脚本里的 Token 与服务端不一致。在「设置 → 系统与安全」轮换并同步 |
| 手机连不上 | 确认同一 Wi-Fi、防火墙放行 8787、地址用局域网 IP 而非 `localhost` |
| 报价毛利为负 | 检查产品价格阶梯单位成本，或定价规则叠加过深（看报价详情的「价格审计」） |
| 解析置信度低 | 补齐产品库的品名/品类/目标市场，或优化询盘原文后点「重新解析」 |

日志在标准输出；后台运行时的日志位置见各自的 service 配置。
