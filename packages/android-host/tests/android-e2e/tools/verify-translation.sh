#!/usr/bin/env bash
# 可自验证的模拟器 E2E：导航 → 定位按钮 → 点击 → **确认请求真的发出**（否则重试）
set -eo pipefail
# 教训（2026-09-20）：曾经用 `gradle ... | grep -E 'error:'` 判构建结果 —— grep 无匹配即返回 0，
# 于是「编译失败」连续几轮被当成成功，测的一直是旧 APK。构建步骤一律带 pipefail，
# 并在安装前**校验 APK 时间戳**（比本次构建开始时刻新）。
# debug 变体的 applicationId（ADR-0227 D2：只给 debug 加 ".debug" 后缀，
# release 变体仍是 io.pictelio.app）。ACT 是**组件串** = applicationId + 类 FQN；
# 类 FQN 的根是 namespace（不随变体变）⇒ 这里写全限定类名。
PKG=io.pictelio.app.debug
ACT=$PKG/io.pictelio.app.LynxActivity
# 缺省走本地 mock 端点（红线：验证不得依赖活着的付费 provider）。要打真实 provider
# 必须显式传参 —— 上一版缺省 deepseek，等于每次复跑都真实计费。
MODE="${1:-mock}"     # mock | deepseek
# 仓库根从本脚本位置推导（tools → android-e2e → tests → android-host → packages → root），
# 不写死任何机器上的绝对路径——否则换机/换用户即失效。
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../../.." && pwd)"
cd "$REPO_ROOT"

TOKEN=$(grep '^PIXIV_REFRESH_TOKEN=' packages/app-lynx/.env | head -1 | sed 's/PIXIV_REFRESH_TOKEN=//' | sed "s/^['\"]//;s/['\"]$//")
if [ "$MODE" = "mock" ]; then
  BASE="http://127.0.0.1:8811/v1"; MODEL="mock-model"; KEY="sk-mock-key-0123456789012345678901234"
  adb reverse tcp:8811 tcp:8811 >/dev/null 2>&1 || true
else
  BASE="https://api.deepseek.com"; MODEL="deepseek-flash"
  KEY=$(grep '^DEEPSEEK_API_KEY=' packages/app-lynx/.env | head -1 | sed 's/DEEPSEEK_API_KEY=//' | sed "s/^['\"]//;s/['\"]$//")
  echo "[e2e] 警告：MODE=$MODE 会向真实付费 provider 发起请求"
fi

# 构建（带 pipefail）+ 新鲜度校验
# 构建（带 pipefail）。先删掉 APK：gradle 在「只有 asset（JS bundle）变化」时会把打包任务
# 判为 up-to-date 而不重写 APK，导致 APK 落后于 bundle —— 删掉即可让打包必然发生。
APK_PATH="$REPO_ROOT/packages/android-host/android/app/build/outputs/apk/debug/app-debug.apk"
rm -f "$APK_PATH"
(cd "$REPO_ROOT" && BENCH_NAV=1 NODE_ENV=production \
  pnpm --dir packages/app-lynx run build >/dev/null && \
  node packages/app-lynx/scripts/sync-android-assets.mjs >/dev/null && \
  cd packages/android-host/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew assembleDebug --no-daemon -q)
# 判据：打包进 APK 的**源集**（main/java + lynx/java，以及 JS 产出的 bundle）不得比 APK 新。
# 不比「构建开始时刻」—— gradle 判定 up-to-date 时不重写 APK（合法）；而编译失败被吞时
# 这些源集一定领先于 APK（本检查要抓的正是后者）；test/ 源集不进 APK，故排除。
APK="$APK_PATH"
STALE=$(find "$REPO_ROOT/packages/android-host/android/app/src/main/java" "$REPO_ROOT/packages/android-host/android/app/src/lynx/java" -type f -newer "$APK" 2>/dev/null | head -1)
BUNDLE="$REPO_ROOT/packages/android-host/android/app/src/main/assets/main.lynx.bundle"
if [ -f "$BUNDLE" ] && [ "$BUNDLE" -nt "$APK" ]; then STALE="$BUNDLE"; fi
if [ -n "$STALE" ]; then
  echo "[e2e] APK is older than packaged sources: $STALE"
  echo "[e2e] refusing to test a stale build (a swallowed compile failure looks like this)"
  exit 1
fi
adb install -r "$APK" >/dev/null 2>&1

# 截图输出目录：脚本此前假定 /tmp/pictelio-e2e 已存在，换机或清过 /tmp 就会在首次
# screencap 处失败（No such file or directory），且报错点远离真正原因。
mkdir -p /tmp/pictelio-e2e

adb shell am force-stop "$PKG"; sleep 2
adb logcat -c
adb shell am start -n "$ACT" \
  --es pictelio_dev_refresh_token "$TOKEN" --es pictelio_dev_force_r18 true \
  --es pictelio_dev_force_translate_r18 true \
  --es pictelio_dev_llm_base_url "$BASE" --es pictelio_dev_llm_model "$MODEL" \
  --es pictelio_dev_llm_api_key "$KEY" --es benchNav novel >/dev/null
# 直达正文页（benchNav novel-detail）：三段式点击链（列表→介绍页→正文）在合成点击下
# 会落到「插画详情」等错误页面，曾造成多次假失败。深链由 LynxActivity 转发全局事件
# pictelioBenchNavNovelDetail + router 监听实现（与 illust-detail 同载荷约定）。
NOVEL_ID="${NOVEL_ID:-25434593}"
adb shell am force-stop "$PKG"; sleep 2
adb logcat -c
# R18G 章需要**两个**独立授权：显示（dev_force_r18）与外发（dev_force_translate_r18）。
# 缺后者则 isTranslationRestricted(2) 在请求发出前就拦下，脚本只会看到「未观察到请求」。
adb shell am start -n "$ACT" --es pictelio_dev_refresh_token "$TOKEN" --es pictelio_dev_force_r18 true --es pictelio_dev_force_translate_r18 true --es pictelio_dev_llm_base_url "$BASE" --es pictelio_dev_llm_model "$MODEL" --es pictelio_dev_llm_api_key "$KEY" --es benchNav novel-detail --es benchNavNovelId "$NOVEL_ID" >/dev/null
sleep 18

# 定位翻译按钮（蓝色带）并点击；点完必须看到「请求入口」日志，否则重点一次
REQUEST_SEEN=0
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
W,H = im.size
x = int(W * 0.75)   # 原写死 540 = 720×0.75；换机型（1080 宽）会越界报 IndexError
ys = [y for y in range(0,H) if blue(px[x,y])]
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
    REQUEST_SEEN=1
    break
  fi
  echo "[e2e] 未观察到请求，重试"
done

# 失败必须**显式**报出。上一版重试耗尽后直接继续往下跑并以 0 退出，调用方
# （CI / 人工）会把「跑完了」读成「验证通过」—— 阴性结果被当成绿灯是本仓反复在消灭的假绿。
if [ "$REQUEST_SEEN" -ne 1 ]; then
  echo "[e2e] 失败：重试耗尽仍未观察到 translateStream 入口日志，请求**未发出**。"
  echo "[e2e] 常见原因：R18G 闸门拦截（缺 dev_force_translate_r18 授权播种）/"
  echo "           翻译按钮未渲染/未点到（见下方 logcat 与截图）。"
  echo "=== JAVA ==="
  adb logcat -d | grep -E 'R18 gate blocked|translateStream 入口|dev hook' | tail -10 | cut -c1-170
  echo "=== JS ==="
  adb logcat -d | grep -E 'novelTranslateStore' | tail -5 | cut -c1-170
  exit 1
fi

sleep 30
echo "=== JAVA ==="
adb logcat -d | grep -E 'translateStream 入口|SSE 帧下发|SSE 流结束 terminal|未返回任何译文|HTTP ' | tail -6 | cut -c1-150
echo "=== JS ==="
adb logcat -d | grep -E 'novelTranslateStore' | tail -5 | cut -c1-170
echo "=== UI ==="
adb exec-out screencap -p > /tmp/pictelio-e2e/e2e-final.png
echo "screenshot: /tmp/pictelio-e2e/e2e-final.png"
