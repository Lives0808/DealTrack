# DealTrack — 生产镜像
#
# 两阶段构建：先编译后端与前端，再只把运行需要的产物复制进最终镜像。
# 单个容器同时提供 API、Web 控制台与文档渲染，对自部署最省心。
#
#   docker build -t dealtrack .
#   docker run -d -p 8787:8787 -v dealtrack-data:/data \
#     -e DEALTRACK_API_TOKEN="$(openssl rand -base64 24)" dealtrack

# ---------------------------------------------------------------------------
FROM node:22-slim AS build
WORKDIR /app

# 依赖分层缓存：只有锁文件变化时才重装
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY tsconfig.json* ./
COPY server ./server
COPY web ./web
COPY scripts ./scripts
RUN npm run build

# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

# Chromium 用于把报价单/形式发票渲染成 PDF；Noto 字体保证中文、日文、韩文、
# 阿拉伯语都能正确排版。不需要 PDF 的话可以删掉这一段（约省 300MB）。
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates \
      fonts-noto-core \
      fonts-noto-cjk \
      fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* \
    && ln -sf /usr/bin/chromium /usr/local/bin/chromium

ENV DEALTRACK_CHROME_PATH=/usr/bin/chromium
ENV NODE_ENV=production
ENV DEALTRACK_DATA_DIR=/data
ENV PORT=8787
ENV HOST=0.0.0.0

WORKDIR /app

# 生产依赖 + 编译产物。源码不进入镜像，缩小体积也减少泄露面。
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
COPY --from=build /app/server/src/core/schema.ts ./server/dist/core/schema.ts

# 数据目录（SQLite、导出文档、加密主密钥）——必须挂载卷，否则重启即失
VOLUME ["/data"]
EXPOSE 8787

# 健康检查用真实接口，容器编排能感知「进程活着但数据库打不开」这种情况
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# 非 root 运行
RUN useradd --system --uid 10001 --create-home dealtrack \
    && mkdir -p /data \
    && chown -R dealtrack:dealtrack /data /app
USER dealtrack

CMD ["node", "server/dist/index.js"]
