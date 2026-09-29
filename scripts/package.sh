#!/usr/bin/env bash
#
# 本地发行打包：类型检查 → 冒烟测试 → 构建 → 打 APK → 汇总产物与校验和。
#
#   ./scripts/package.sh            # 完整打包
#   ./scripts/package.sh --skip-android
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./package.json').version")"
DIST="$ROOT/dist/release"
SKIP_ANDROID=0

for arg in "$@"; do
  case "$arg" in
    --skip-android) SKIP_ANDROID=1 ;;
    --help|-h)
      sed -n '2,10p' "$0"
      exit 0
      ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
step() { printf '\n\033[1;34m▶ %s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✔\033[0m %s\n' "$1"; }
warn() { printf '  \033[33m▲\033[0m %s\n' "$1"; }

rm -rf "$DIST"
mkdir -p "$DIST"

bold "DealTrack $VERSION 发行打包"
echo "  产物目录：$DIST"

# ---------------------------------------------------------------------------
step "1/5 依赖"
if [ ! -d node_modules ]; then
  npm install
fi
ok "依赖就绪"

# ---------------------------------------------------------------------------
step "2/5 类型检查"
npm run typecheck
ok "TypeScript 严格模式通过"

# ---------------------------------------------------------------------------
step "3/5 端到端冒烟测试"
npm run smoke --workspace=server 2>&1 | tail -20
ok "冒烟测试通过"

# ---------------------------------------------------------------------------
step "4/5 构建"
npm run build
ok "后端 dist 与前端 dist 已生成"

tar czf "$DIST/dealtrack-server-$VERSION.tgz" \
  --exclude='./data' \
  --exclude='./node_modules' \
  --exclude='./android/.gradle' \
  --exclude='./android/app/build' \
  --exclude='./android/local.properties' \
  --exclude='./dist' \
  --exclude='./.git' \
  .
ok "服务端包：dealtrack-server-$VERSION.tgz"

# ---------------------------------------------------------------------------
if [ "$SKIP_ANDROID" -eq 0 ]; then
  step "5/5 安卓 APK"
  if [ -n "${ANDROID_HOME:-}" ] || [ -d "$HOME/Library/Android/sdk" ]; then
    if [ ! -f android/local.properties ]; then
      SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
      echo "sdk.dir=$SDK" > android/local.properties
      ok "已写入 android/local.properties → $SDK"
    fi
    (cd android && ./gradlew :app:assembleRelease --no-daemon -q)
    cp android/app/build/outputs/apk/release/app-release.apk \
       "$DIST/dealtrack-android-$VERSION.apk"
    ok "安卓包：dealtrack-android-$VERSION.apk"
    if [ ! -f android/keystore.properties ]; then
      warn "APK 使用调试签名。正式分发请在 android/keystore.properties 配置自己的密钥"
    fi
  else
    warn "未检测到 Android SDK，跳过 APK。安装 Android Studio 或设置 ANDROID_HOME 后重试"
  fi
else
  step "5/5 安卓 APK（已跳过）"
fi

# ---------------------------------------------------------------------------
step "校验和"
( cd "$DIST" && shasum -a 256 * > SHA256SUMS.txt )
cat "$DIST/SHA256SUMS.txt" | sed 's/^/  /'

printf '\n\033[1;32m打包完成\033[0m\n'
ls -lh "$DIST" | tail -n +2 | awk '{printf "  %-44s %s\n", $9, $5}'
echo
echo "  发布："
echo "    gh release create v$VERSION $DIST/* \\"
echo "      --title \"DealTrack v$VERSION\" --generate-notes"
echo
