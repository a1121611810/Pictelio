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
BUILD_START=$(date +%s)
(cd /Users/lilianda/develop/pixivizer && BENCH_NAV=1 NODE_ENV=production \
  pnpm --dir packages/app-lynx run build >/dev/null && \
  node packages/app-lynx/scripts/sync-android-assets.mjs >/dev/null && \
  cd packages/app/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew assembleLynxDebug --no-daemon -q)
APK=/Users/lilianda/develop/pixivizer/packages/app/android/app/build/outputs/apk/lynx/debug/app-lynx-debug.apk
APK_TS=$(stat -f %m "$APK")
if [ "$APK_TS" -lt "$BUILD_START" ]; then
  echo "[e2e] ❌ APK 未在本次构建中更新（可能是编译失败被吞）—— 拒绝在旧包上测"
  exit 1
fi
adb install -r "$APK" >/dev/null 2>&1

adb shell am force-stop "$PKG"; sleep 2
adb logcat -c
adb shell am start -n "$ACT" \
  --es pictelio_dev_refresh_token "$TOKEN" --es pictelio_dev_force_r18 true \
  --es pictelio_dev_llm_base_url "$BASE" --es pictelio_dev_llm_model "$MODEL" \
  --es pictelio_dev_llm_api_key "$KEY" --es benchNav novel >/dev/null
# benchNav 广播有竞态（1.5/3/4.5/6s 四次），页面可能还没到位 —— 先确认在小说列表再点
nav_ok=0
for i in 1 2 3 4 5; do
  sleep 6
  adb exec-out screencap -p > /tmp/pictelio-e2e/nav-$i.png
  # 小说列表页特征：顶部标题「小说」+ 列表卡（用像素密度粗判：标题区有深色文本像素）
  if python3 - "$i" <<'PY'
import sys
from PIL import Image
a = sys.argv[1]
im = Image.open(f'/tmp/pictelio-e2e/nav-{a}.png').convert('L')
# 标题带（y 380-460）应有足够深色像素；且不是插画详情（无「关注」按钮的蓝色大块）
# 小说列表：tab 行（推荐/关注）y≈420-480 有两条深色文本块；详情页顶部左侧有大返回箭头
tabrow = im.crop((0, 415, 1080, 485))
dark_tab = sum(1 for p in tabrow.getdata() if p < 110)
backrow = im.crop((0, 330, 300, 390))
dark_back = sum(1 for p in backrow.getdata() if p < 110)
sys.exit(0 if (dark_tab > 1500 and dark_back < 600) else 1)
PY
  then nav_ok=1; echo "[e2e] 小说列表已就绪（第 $i 次探测）"; break; fi
done
[ "$nav_ok" = "1" ] || { echo "[e2e] 未能确认到达小说列表"; exit 1; }
adb shell input touchscreen tap 540 640; sleep 8     # 第一本小说 → 介绍页
adb exec-out screencap -p > /tmp/pictelio-e2e/intro.png
# 介绍页：底部「开始阅读」大按钮（蓝色带位于 y>1600）
YINTRO=$(python3 - <<'PY'
from PIL import Image
im = Image.open('/tmp/pictelio-e2e/intro.png').convert('RGB'); px = im.load()
def blue(c):
    r,g,b = c
    return b > 110 and b - r > 40 and g > r and g < b
ys = [y for y in range(1400, 2100) if blue(px[540,y])]
print((ys[0]+ys[-1])//2 if ys else "NONE")
PY
)
[ "$YINTRO" = "NONE" ] && { echo "[e2e] 介绍页未出现（可能没进介绍页）"; exit 1; }
echo "[e2e] 介绍页开始阅读按钮 y=$YINTRO"
adb shell input touchscreen tap 540 "$YINTRO"; sleep 10   # 开始阅读 → 正文页

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
