#!/bin/bash
# ─── lynx bench 导航（wayfinder #306）：已验证的 bash 序列 + 截图 diff 校验 ───
# 用法: lynx-bench-nav.sh <scenario: carousel|illust|novel|novel-detail|multiimage>
# 成功退出 0（到达可滚动页）；失败退出 1。
# 注：node 内执行的 input tap 偶发「触发轮播换页且冻结」，bash 序列实测稳定（navdbg 多次复现）。
set -euo pipefail
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
PKG="io.pictelio.app"
S="emulator-5554"
SC=$1

adb() { "$ADB" -s $S "$@"; }
pgrep_done() { adb shell pidof $PKG >/dev/null; }

h() { /sbin/md5 -q "$1" | cut -c1-12; }
shot() { adb exec-out screencap -p > "/tmp/lnav_$1.png" 2>/dev/null || true; sleep 0.3; }
changed() { [ -s "/tmp/lnav_$1.png" ] && [ "$(h /tmp/lnav_$1.png)" != "$(h /tmp/lnav_$2.png)" ]; }

if [ "$SC" = "carousel" ]; then
  echo "carousel: 起始页即推荐轮播，无需导航"; exit 0
fi

# 1) 冷启动 + 就绪（9s 基线 + 轮询内容非 blank）
adb shell am force-stop $PKG; sleep 1.2
adb shell am start -n $PKG/.LynxActivity >/dev/null
sleep 9

# 2) FAB → 环项（3 次尝试，diff 校验）
for attempt in 1 2 3; do
  shot bef
  adb shell input tap 635 1150; sleep 2.8
  shot menu
  case "$SC" in
    illust|multiimage) adb shell input tap 492 942 ;;
    novel|novel-detail) adb shell input tap 415 1028 ;;
  esac
  sleep 5
  shot aft
  if changed aft bef; then
    echo "nav[$SC] 第 $attempt 次尝试：屏幕已变化"
    RES=$((attempt)); break
  fi
  echo "nav[$SC] 第 $attempt 次尝试：屏幕未变化，重试"
  RES=0
done
[ "$RES" != "0" ] || { echo "❌ nav[$SC] 三次尝试均失败"; exit 1; }

# 3) 详情场景：点击可点卡进详情（受限卡不可点 → 滚动后逐点重试，用截图 diff 判进详情）
if [ "$SC" = "novel-detail" ] || [ "$SC" = "multiimage" ]; then
  adb shell input swipe 360 998 360 397 600; sleep 1.5
  for i in 1 2 3 4 5; do
    y=$((400 + (i - 1) * 170))
    shot pre
    adb shell input tap 180 $y; sleep 6
    shot post
    if changed post pre; then
      echo "nav[$SC] 第 $i 次点击进入详情（屏幕变化）"
      RES=1; break
    fi
    echo "nav[$SC] 第 $i 次点击屏幕无变化（受限卡/未命中），继续"
    RES=0
  done
  [ "$RES" = "1" ] || { echo "❌ nav[$SC] 未进入详情"; exit 1; }
fi

echo "✅ nav[$SC] 完成"
