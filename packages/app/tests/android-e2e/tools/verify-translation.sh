#!/usr/bin/env bash
# 可自验证的模拟器 E2E：导航 → 定位按钮 → 点击 → **确认请求真的发出**（否则重试）
set -eo pipefail
# 教训（2026-09-20）：曾经用 `gradle ... | grep -E 'error:'` 判构建结果 —— grep 无匹配即返回 0，
# 于是「编译失败」连续几轮被当成成功，测的一直是旧 APK。构建步骤一律带 pipefail，
# 并在安装前**校验 APK 时间戳**（比本次构建开始时刻新）。
PKG=io.pictelio.app
ACT=$PKG/io.pictelio.app.LynxActivity
MODE="${1:-deepseek}"   # deepseek | mock
cd /Users/lilianda/develop/pixivizer

TOKEN=$(grep '^PIXIV_REFRESH_TOKEN=' packages/app-lynx/.env | head -1 | sed 's/PIXIV_REFRESH_TOKEN=//' | sed "s/^['\"]//;s/['\"]$//")
if [ "$MODE" = "mock" ]; then
  BASE="http://127.0.0.1:8811/v1"; MODEL="mock-model"; KEY="sk-mock-key-0123456789012345678901234"
  adb reverse tcp:8811 tcp:8811 >/dev/null 2>&1 || true
else
  BASE="https://api.deepseek.com"; MODEL="deepseek-flash"
  KEY=$(grep '^DEEPSEEK_API_KEY=' packages/app-lynx/.env | head -1 | sed 's/DEEPSEEK_API_KEY=//' | sed "s/^['\"]//;s/['\"]$//")
fi

# 构建（带 pipefail）+ 新鲜度校验
# 构建（带 pipefail）。先删掉 APK：gradle 在「只有 asset（JS bundle）变化」时会把打包任务
# 判为 up-to-date 而不重写 APK，导致 APK 落后于 bundle —— 删掉即可让打包必然发生。
APK_PATH=/Users/lilianda/develop/pixivizer/packages/app/android/app/build/outputs/apk/lynx/debug/app-lynx-debug.apk
rm -f "$APK_PATH"
(cd /Users/lilianda/develop/pixivizer && BENCH_NAV=1 NODE_ENV=production \
  pnpm --dir packages/app-lynx run build >/dev/null && \
  node packages/app-lynx/scripts/sync-android-assets.mjs >/dev/null && \
  cd packages/app/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew assembleLynxDebug --no-daemon -q)
# 判据：打包进 APK 的**源集**（main/java + lynx/java，以及 JS 产出的 bundle）不得比 APK 新。
# 不比「构建开始时刻」—— gradle 判定 up-to-date 时不重写 APK（合法）；而编译失败被吞时
# 这些源集一定领先于 APK（本检查要抓的正是后者）；test/ 源集不进 APK，故排除。
APK=/Users/lilianda/develop/pixivizer/packages/app/android/app/build/outputs/apk/lynx/debug/app-lynx-debug.apk
STALE=$(find /Users/lilianda/develop/pixivizer/packages/app/android/app/src/main/java /Users/lilianda/develop/pixivizer/packages/app/android/app/src/lynx/java -type f -newer "$APK" 2>/dev/null | head -1)
BUNDLE=/Users/lilianda/develop/pixivizer/packages/app/android/app/src/main/assets/main.lynx.bundle
if [ -f "$BUNDLE" ] && [ "$BUNDLE" -nt "$APK" ]; then STALE="$BUNDLE"; fi
if [ -n "$STALE" ]; then
  echo "[e2e] APK is older than packaged sources: $STALE"
  echo "[e2e] refusing to test a stale build (a swallowed compile failure looks like this)"
  exit 1
fi
adb install -r "$APK" >/dev/null 2>&1

adb shell am force-stop "$PKG"; sleep 2
adb logcat -c
adb shell am start -n "$ACT" \
  --es pictelio_dev_refresh_token "$TOKEN" --es pictelio_dev_force_r18 true \
  --es pictelio_dev_llm_base_url "$BASE" --es pictelio_dev_llm_model "$MODEL" \
  --es pictelio_dev_llm_api_key "$KEY" --es benchNav novel >/dev/null
# 直达正文页（benchNav novel-detail）：三段式点击链（列表→介绍页→正文）在合成点击下
# 会落到「插画详情」等错误页面，曾造成多次假失败。深链由 LynxActivity 转发全局事件
# pictelioBenchNavNovelDetail + router 监听实现（与 illust-detail 同载荷约定）。
NOVEL_ID="${NOVEL_ID:-25434593}"
adb shell am force-stop "$PKG"; sleep 2
adb logcat -c
adb shell am start -n "$ACT" --es pictelio_dev_refresh_token "$TOKEN" --es pictelio_dev_force_r18 true --es pictelio_dev_llm_base_url "$BASE" --es pictelio_dev_llm_model "$MODEL" --es pictelio_dev_llm_api_key "$KEY" --es benchNav novel-detail --es benchNavNovelId "$NOVEL_ID" >/dev/null
sleep 18

# 定位翻译按钮（蓝色带）并点击；点完必须看到「请求入口」日志，否则重点一次
for attempt in 1 2 3; do
  adb exec-out screencap -p > /tmp/pictelio-e2e/btn-$attempt.png
  Y=$(python3 - <<'PY'
from PIL import Image
im = Image.open('/tmp/pictelio-e2e/btn-1.png' if False else '/tmp/pictelio-e2e/btn-%d.png' % 0, 'rb') if False else None
PY
  true)
  Y=$(python3 - "$attempt" <<'PY'
import sys
from PIL import Image
a = sys.argv[1]
im = Image.open(f'/tmp/pictelio-e2e/btn-{a}.png').convert('RGB'); px = im.load()
def blue(c):
    r,g,b = c
    return b > 110 and b - r > 40 and g > r and g < b
ys = [y for y in range(0,1300) if blue(px[540,y])]
if not ys:
    print("NONE"); raise SystemExit
s = p = ys[0]; bands = []
for y in ys[1:]:
    if y != p+1:
        if p-s > 15: bands.append((s,p))
        s = y
    p = y
if p-s > 15: bands.append((s,p))
print((bands[0][0]+bands[0][1])//2)
PY
)
  echo "[e2e] attempt=$attempt button_y=$Y"
  [ "$Y" = "NONE" ] && { echo "[e2e] 找不到翻译按钮"; exit 1; }
  adb shell input touchscreen tap 539 "$Y"
  sleep 6
  if adb logcat -d | grep -q 'translateStream 入口'; then
    echo "[e2e] 请求已发出（attempt $attempt）"
    break
  fi
  echo "[e2e] 未观察到请求，重试"
done

sleep 30
echo "=== JAVA ==="
adb logcat -d | grep -E 'translateStream 入口|SSE 帧下发|SSE 流结束 terminal|未返回任何译文|HTTP ' | tail -6 | cut -c1-150
echo "=== JS ==="
adb logcat -d | grep -E 'novelTranslateStore' | tail -5 | cut -c1-170
echo "=== UI ==="
adb exec-out screencap -p > /tmp/pictelio-e2e/e2e-final.png
echo "screenshot: /tmp/pictelio-e2e/e2e-final.png"
