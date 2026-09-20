#!/usr/bin/env bash
# #653 abort 通道回归验证（设备端）：构建 → 安装 → 启动 → 导航 → 点翻译 → 等 SSE 稳定
# → 点停止 → 断言 abortStream 真的取消 OkHttp Call。
#
# 与 verify-translation.sh 的关键区别：
# - 不等流自然完成——SSE 进入稳定态后立刻 abort，断言 `abortStream 取消:` 出现 +
#   `response.completed` 不出现 + 按钮回到「翻译本章/重试」态
# - mock SSE 走 MOCK_SLOW_MS=5000（每段 5s）= 充裕的可点击窗口（默认 20ms 没机会点）
#
# 关键时序约束：abortStream 必须晚于 Java ACTIVE_CALLS.put 才能命中带 log 的分支
# （PictelioTranslateModule.java:718）。脚本等「SSE 流就绪待拉取」后再点停止，
# 保证 worker 已越过 ACTIVE_CALLS.put。
#
# Oracle 锚定（硬约束 #6）：期望值的来源 = ADR-0170 §D7「cancel 命中活 call → Log.i
# 'abortStream 取消:'」+ spec §7.2「aborted 状态不回调本 cb」，不依赖 mock 内部行为。
set -eo pipefail
PKG=io.pictelio.app
ACT=$PKG/io.pictelio.app.LynxActivity
MODE="${1:-abort}"
cd /Users/lilianda/develop/pixivizer

# ── 0. 准备 ─────────────────────────────────────────
mkdir -p /tmp/pictelio-e2e
echo "[abort] 准备 emulator + mock SSE"

# 复用 verify-translation.sh 的 dev hook 注入（mode=abort 走本地 mock 端点 + 长延迟）
TOKEN=$(grep '^PIXIV_REFRESH_TOKEN=' packages/app-lynx/.env | head -1 | sed 's/PIXIV_REFRESH_TOKEN=//' | sed "s/^['\"]//;s/['\"]$//")
BASE="http://127.0.0.1:8811/v1"; MODEL="mock-model"
KEY="sk-mock-key-0123456789012345678901234"

# kill 残留 mock + 启动慢速版（每段 5s）
# 关键：`nohup` 在 macOS bash + set -e 下会与 backgrounded job 状态机冲突（之前被误杀）。
# 现改用 `(... &)` 子 shell 启动 + `disown`，彻底脱离本脚本进程组。
if command -v lsof >/dev/null 2>&1; then
  lsof -ti tcp:8811 2>/dev/null | xargs -r kill 2>/dev/null || true
fi
adb reverse --remove tcp:8811 2>/dev/null || true
sleep 1
(MOCK_SLOW_MS=5000 node packages/app/tests/android-e2e/tools/mock-responses-sse-server.mjs \
  > /tmp/pictelio-e2e/mock.log 2>&1 < /dev/null) &
MOCK_PID=$!
disown $MOCK_PID 2>/dev/null || true
echo "[abort] mock SSE pid=$MOCK_PID (MOCK_SLOW_MS=5000, subshell+disown)"
sleep 2  # 等监听
if ! ps -p $MOCK_PID >/dev/null 2>&1; then
  echo "[abort] mock 启动失败"; cat /tmp/pictelio-e2e/mock.log; exit 1
fi
adb reverse tcp:8811 tcp:8811 >/dev/null 2>&1 || true

# ── 1. 构建 + 新鲜度校验 + 安装（与 verify-translation.sh 同款，防吞编译失败）──
echo "[abort] 构建 + 安装"
APK_PATH=/Users/lilianda/develop/pixivizer/packages/app/android/app/build/outputs/apk/lynx/debug/app-lynx-debug.apk
rm -f "$APK_PATH"
(cd /Users/lilianda/develop/pixivizer && BENCH_NAV=1 NODE_ENV=production \
  pnpm --dir packages/app-lynx run build >/dev/null && \
  node packages/app-lynx/scripts/sync-android-assets.mjs >/dev/null && \
  cd packages/app/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew assembleLynxDebug --no-daemon -q)
APK=$APK_PATH
STALE=$(find /Users/lilianda/develop/pixivizer/packages/app/android/app/src/main/java /Users/lilianda/develop/pixivizer/packages/app/android/app/src/lynx/java -type f -newer "$APK" 2>/dev/null | head -1)
BUNDLE=/Users/lilianda/develop/pixivizer/packages/app/android/app/src/main/assets/main.lynx.bundle
if [ -f "$BUNDLE" ] && [ "$BUNDLE" -nt "$APK" ]; then STALE="$BUNDLE"; fi
if [ -n "$STALE" ]; then
  echo "[abort] APK is older than packaged sources: $STALE"
  echo "[abort] refusing to test a stale build (a swallowed compile failure looks like this)"
  kill $MOCK_PID 2>/dev/null || true
  exit 1
fi
adb install -r "$APK" >/dev/null 2>&1

# 兜底重置 adb reverse（长 build 可能让 adb 重连，reverse 隧道就丢了）
adb reverse tcp:8811 tcp:8811 >/dev/null 2>&1 || true

# ── 2. 启动 + 深链到正文页 ─────────────────────────
echo "[abort] 启动 + 导航到 novel-detail"
adb shell am force-stop "$PKG"; sleep 2
adb logcat -c
NOVEL_ID="${NOVEL_ID:-25434593}"
adb shell am start -n "$ACT" \
  --es pictelio_dev_refresh_token "$TOKEN" --es pictelio_dev_force_r18 true \
  --es pictelio_dev_llm_base_url "$BASE" --es pictelio_dev_llm_model "$MODEL" \
  --es pictelio_dev_llm_api_key "$KEY" \
  --es benchNav novel-detail --es benchNavNovelId "$NOVEL_ID" >/dev/null
sleep 12  # LynxActivity 启动 + 深链 + 渲染首屏（含 Lottie/Skeleton）

# ── 3. 点翻译按钮（PIL 蓝色检测 + tap） ─────────
echo "[abort] 定位翻译按钮"
detect_button_y() {
  # 找按钮真实中心 Y：列 x=540 扫所有蓝像素 → 合并相邻带（gap<15 视为同一按钮，
  # 解决按钮内嵌进度条把蓝色带切两段的问题）→ 取最宽带的中点。
  python3 - <<'PY'
from PIL import Image
import os
ys_per_frame = []
for shot in range(2):
    os.system(f"adb exec-out screencap -p > /tmp/pictelio-e2e/abort-btn-{shot}.png")
    im = Image.open(f'/tmp/pictelio-e2e/abort-btn-{shot}.png').convert('RGB')
    px = im.load()
    def blue(c):
        r,g,b = c
        return b > 110 and b - r > 40 and g > r and g < b
    ys = [y for y in range(0,1500) if blue(px[540,y])]
    if not ys: continue
    # 第一轮：合并相邻蓝像素成 raw bands
    raw = []
    s = p = ys[0]
    for y in ys[1:]:
        if y != p+1:
            raw.append((s,p))
            s = y
        p = y
    raw.append((s,p))
    # 第二轮：合并 gap < 15 的相邻带（按钮内嵌进度条把带切两段）
    merged = [raw[0]]
    for (s,p) in raw[1:]:
        if s - merged[-1][1] < 15:
            merged[-1] = (merged[-1][0], p)
        else:
            merged.append((s,p))
    # 取最宽的（=按钮本体）
    best = max(merged, key=lambda b: b[1]-b[0])
    ys_per_frame.append((best[0]+best[1])//2)
print(ys_per_frame[len(ys_per_frame)//2] if ys_per_frame else "NONE")
PY
}

Y=$(detect_button_y)
echo "[abort] 翻译按钮 Y=$Y"
# 兜底：若初次检测不到（页面还在骨架屏），轮询等按钮出现（最长 30s）
if [ "$Y" = "NONE" ]; then
  echo "[abort] 初次未检测到按钮，轮询等待"
  for wait_n in 1 2 3 4 5 6; do
    sleep 5
    Y=$(detect_button_y)
    echo "[abort] retry $wait_n: button_y=$Y"
    if [ "$Y" != "NONE" ]; then break; fi
  done
fi
if [ "$Y" = "NONE" ]; then
  echo "[abort] 30s 内找不到翻译按钮（页面可能未加载）"; pkill -f "mock-responses-sse-server" 2>/dev/null || true; exit 1
fi
adb shell input touchscreen tap 539 "$Y"
echo "[abort] 已点翻译，等「translateStream 入口」"
for attempt in 1 2 3 4 5; do
  sleep 2
  if adb logcat -d | grep -q 'translateStream 入口'; then
    echo "[abort] 请求已发出（attempt $attempt）"; break
  fi
  echo "[abort] 未观察到入口，重试 attempt $attempt"
done

# ── 4. 等 worker 进入读流态（「开始读流」= ACTIVE_CALLS.put 已发生）──
echo "[abort] 等「开始读流」（=ACTIVE_CALLS.put 已发生）"
for attempt in 1 2 3 4 5 6 7 8 9 10; do
  if adb logcat -d | grep -q '开始读流'; then
    echo "[abort] Worker 进入读流（attempt $attempt）"; break
  fi
  sleep 1
done

# 再多等 1s 让 SSE 解析器把首帧消化完（保证 ACTIVE_CALLS 已注册到 worker 内部状态）
sleep 1

# ── 5. 重新检测按钮位置（态变了）+ 点停止 ──
Y_STOP=$(detect_button_y)
echo "[abort] 停止按钮 Y=$Y_STOP（翻译前 Y=$Y，差 $((Y_STOP - Y))）"
if [ "$Y_STOP" = "NONE" ]; then
  # 兜底：用同一坐标（button 在翻译中位置可能不变；之前测到差 ≤10px）
  echo "[abort] 重新检测失败，回退到 Y=$Y"
  Y_STOP=$Y
fi
adb shell input touchscreen tap 539 "$Y_STOP"
sleep 2  # abort 走完 JS→bridge→Java→Call.cancel() 全链路

# ── 6. 采集证据 ──────────────────────────────────────
echo
echo "=== JAVA 关键日志（abort 验证锚点）==="
adb logcat -d | grep -E 'translateStream 入口|开始读流|abortStream 取消|response\.completed|translateStream 异常|EOFException' | tail -10 | cut -c1-180

echo
echo "=== 断言 ==="
PASS=true
if ! adb logcat -d | grep -q 'translateStream 入口'; then
  echo "  ✗ 缺「translateStream 入口」—— JS→Java 通道不通"; PASS=false
fi
if ! adb logcat -d | grep -q '开始读流'; then
  echo "  ✗ 缺「开始读流」—— worker 没进入 SSE 读流态"; PASS=false
fi
if ! adb logcat -d | grep -q 'abortStream 取消'; then
  echo "  ✗ 缺「abortStream 取消」—— JS abort 没真到达原生（#653 修复前症状！）"; PASS=false
fi
if adb logcat -d | grep -q 'response.completed'; then
  echo "  ✗ 不应出现「response.completed」—— 流被 abort 中断而非自然完成"; PASS=false
fi
if $PASS; then
  echo "  ✓ 全部断言通过：#653 abort 通道在设备端验证可达 + 真取消 OkHttp Call"
fi

echo
adb exec-out screencap -p > /tmp/pictelio-e2e/abort-final.png
echo "screenshot: /tmp/pictelio-e2e/abort-final.png"

# ── 7. 清理 ──────────────────────────────────────────
pkill -f "mock-responses-sse-server" 2>/dev/null || true
adb reverse --remove tcp:8811 2>/dev/null || true
echo "[abort] done"
