#!/usr/bin/env bash
# app-lynx web-core 启动回归（白屏）——ADR-0120
#
# 锁定「web bundle 加载即崩（ES module TDZ / lynx loadCard failed）→ 白屏」的回归。
# 原先 stores/globalFab 顶层读 routeState 触发 TDZ，web/dev 白屏。本回归在 web-core 层：
# pnpm build → pnpm preview（自动端口）→ playwright-cli 凵载 __web_preview → 抓 console →
# 断言无 TDZ 致命错误 + 截图非白屏。
#
# 依赖：全局 playwright-cli（仓库无 @playwright/test 库，用同源 CLI 驱动）。CI 如需更便携可换 @playwright/test。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PKG="$ROOT/packages/app-lynx"
WORK="$PKG/.tmp-lynx-web-e2e"
CONSOLE_LOG="$WORK/console.log"
SHOT="$WORK/shot.png"
PREVIEW_LOG="$WORK/preview.log"
PREVIEW_PID_FILE="$WORK/preview.pid"

mkdir -p "$WORK"
rm -f "$CONSOLE_LOG" "$SHOT" "$PREVIEW_LOG" "$PREVIEW_PID_FILE"

echo "① 构建 app-lynx web bundle（dist/）"
(cd "$ROOT" && pnpm --filter pictelio-app-lynx build >/dev/null 2>&1)

echo "② 启动 rspeedy dev（web-core 查看器 __web_preview 仅 dev 提供；preview 产物不渲染 web-core）"
(cd "$ROOT" && pnpm dev:app-lynx >"$PREVIEW_LOG" 2>&1 &
 echo $! > "$PREVIEW_PID_FILE")
trap '[ -f "$PREVIEW_PID_FILE" ] && kill "$(cat "$PREVIEW_PID_FILE")" 2>/dev/null || true' EXIT

# 等待 preview 就绪并从日志解析实际端口（取 "127.0.0.1:PORT" 中最后的数字串）
PORT=""
for i in $(seq 1 40); do
  PORT=$(grep -oE '127\.0\.0\.1:[0-9]+' "$PREVIEW_LOG" 2>/dev/null | grep -oE '[0-9]+' | tail -1 || true)
  [ -n "$PORT" ] && break
  sleep 1
done
[ -n "$PORT" ] || { echo "❌ preview 启动超时/未解析到端口"; tail -12 "$PREVIEW_LOG" || true; exit 1; }
URL="http://127.0.0.1:${PORT}/__web_preview?casename=main.web.bundle"
echo "   preview 就绪: $URL"
for i in $(seq 1 30); do curl -sf -o /dev/null "http://127.0.0.1:${PORT}/main.web.bundle" && break; sleep 1; done

echo "③ playwright-cli 凵载 web-core 预览 + 抓 console"
playwright-cli resize 420 860 >/dev/null 2>&1 || true
playwright-cli open "$URL" >/dev/null 2>&1 || true
sleep 8
playwright-cli console > "$CONSOLE_LOG" 2>&1 || true
for f in "$ROOT/.playwright-cli/console-"*.log; do [ -f "$f" ] && cat "$f" >> "$CONSOLE_LOG"; done 2>/dev/null || true
rm -rf "$ROOT/.playwright-cli"
playwright-cli screenshot --filename="$SHOT" >/dev/null 2>&1 || true

echo "④ 断言：无 TDZ / loadCard failed 致命错误"
if grep -qiE "Cannot access 'routeState'|loadCard failed|ReferenceError: Cannot access" "$CONSOLE_LOG"; then
  echo "❌ 检测到白屏致命错误："
  grep -iE "Cannot access 'routeState'|loadCard failed|ReferenceError: Cannot access" "$CONSOLE_LOG" | head
  exit 1
fi
echo "   ✓ console 无 TDZ / loadCard failed"

echo "⑤ 断言：渲染非白屏（截图有内容）"
if [ ! -s "$SHOT" ]; then echo "❌ 无截图（页面可能白屏/未渲染）"; exit 1; fi
SIZE=$(wc -c < "$SHOT" | tr -d ' ')
if [ "$SIZE" -lt 4096 ]; then echo "❌ 截图疑似纯白（${SIZE}B < 4KB）"; exit 1; fi
echo "   ✓ 截图非白屏（${SIZE}B）"

echo "✅ lynx web-core 启动回归通过, URL: ${URL}"
