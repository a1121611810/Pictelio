#!/usr/bin/env bash
# GeckoView 原型 bench（throwaway）。用法：bench-proto.sh <phase>
set -uo pipefail
export PATH="$PATH:/Users/lilianda/Library/Android/sdk/platform-tools"
PKG=io.pictelio.geckoproto
ACT=$PKG/.MainActivity
TOKEN='LXa0TEPbcckouDoW5BJymPY01Q7guBjBW7_FB4apwGs'
OUT=/tmp/gvbench
mkdir -p "$OUT"

coldstart() {
  adb shell pm clear "$PKG" >/dev/null 2>&1   # 清登录态 + 缓存，纯冷启动口径（不注入 token，落在登录页）
  for i in 1 2 3 4 5; do
    adb shell am force-stop "$PKG"; adb logcat -c; sleep 2
    T=$(adb shell am start -W -n "$ACT" | grep -E 'TotalTime' | head -1)
    sleep 6
    F=$(adb logcat -d -s GVPROTO | grep 'FIRST_CONTENTFUL_PAINT' | head -1 | sed 's/.*(t+\([0-9]*\)ms).*/\1/')
    echo "run$i total=$T fcpActivityDelta=${F}ms" | tee -a "$OUT/coldstart-proto.txt"
  done
}

feedscroll() {
  # 登录态进 /home，等 feed 稳定后 15s 滚动窗口内的 rAF FPS
  adb shell am force-stop "$PKG"; adb logcat -c; sleep 1
  adb shell am start -n "$ACT" --es refresh_token "$TOKEN" --es url 'http://127.0.0.1:18080/?__fps=1' >/dev/null
  sleep 5   # 加载 + fps 窗口启动（窗口 15s）
  for i in $(seq 1 14); do
    adb shell input swipe 540 1700 540 500 300
    sleep 0.9
  done
  sleep 3
  adb logcat -d -s GVPROTO | grep -E 'fps_bench' | tail -2 | tee -a "$OUT/fps-proto.txt"
  # 滚动后内存
  adb shell dumpsys meminfo "$PKG" | grep -E 'TOTAL PSS|TOTAL:|Native Heap|Graphics|Java Heap|Code| loops' | head -8 | tee -a "$OUT/mem-proto-after-scroll.txt"
}

pingrtt() {
  adb shell am force-stop "$PKG"; adb logcat -c; sleep 1
  adb shell am start -n "$ACT" --es refresh_token "$TOKEN" --es url 'http://127.0.0.1:18080/?__ping=1' >/dev/null
  sleep 14
  adb logcat -d -s GVPROTO | grep 'ping_bench n=' | tail -1 | tee -a "$OUT/ping-proto.txt"
}

memidle() {
  adb shell am force-stop "$PKG"; sleep 1
  adb shell am start -n "$ACT" --es refresh_token "$TOKEN" >/dev/null
  sleep 12
  adb shell dumpsys meminfo "$PKG" | sed -n '/Total PSS by process/,/^$/p; /App Summary/,/^$/p' | head -24 | tee -a "$OUT/mem-proto-idle.txt"
}

case "${1:-all}" in
  coldstart) coldstart ;;
  feedscroll) feedscroll ;;
  pingrtt) pingrtt ;;
  memidle) memidle ;;
  all) pingrtt; feedscroll; memidle; coldstart ;;  # coldstart 最后（pm clear 破坏登录态）
esac
echo "=== done phase=$1 ==="
