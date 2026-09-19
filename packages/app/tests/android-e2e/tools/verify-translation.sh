#!/usr/bin/env bash
# 可自验证的模拟器 E2E：导航 → 定位按钮 → 点击 → **确认请求真的发出**（否则重试）
set -e
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

adb shell am force-stop "$PKG"; sleep 2
adb logcat -c
adb shell am start -n "$ACT" \
  --es pictelio_dev_refresh_token "$TOKEN" --es pictelio_dev_force_r18 true \
  --es pictelio_dev_llm_base_url "$BASE" --es pictelio_dev_llm_model "$MODEL" \
  --es pictelio_dev_llm_api_key "$KEY" --es benchNav novel >/dev/null
sleep 16
adb shell input touchscreen tap 540 640; sleep 8     # 第一本小说 → 介绍页
adb shell input touchscreen tap 626 1809; sleep 10   # 开始阅读 → 正文页

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
