#!/bin/bash
# ─── lynx bench 导航（wayfinder #306）：已验证的 bash 序列 + 截图 diff 校验 ───
# 用法: lynx-bench-nav.sh <scenario: carousel|illust|novel|novel-detail|multiimage> [serial]
# 成功退出 0（到达可滚动页/详情）；失败退出 1。
# 注：node 内执行的 input tap 偶发「触发轮播换页且冻结」，bash 序列实测稳定（navdbg 多次复现）。
# 坐标 profile：emu=720x1280 模拟器实测；oppo=1080x2160 实测（FAB/环项贴底语义不同，y 必须实测）。
set -euo pipefail
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
PKG="io.pictelio.app"
S="${2:-emulator-5554}"
SC=$1
PROFILE="${BENCH_PROFILE:-emu}"

case "$PROFILE" in
  emu)
    FAB_X=635; FAB_Y=1150
    RING_ILLUST_X=492; RING_ILLUST_Y=942
    RING_NOVEL_X=415; RING_NOVEL_Y=1028
    CARD_X=180; TAP_Y0=400; TAP_STEP=170
    SWIPE="360 998 360 397" ;;
  oppo)
    FAB_X=953; FAB_Y=2027
    RING_ILLUST_X=732; RING_ILLUST_Y=1408
    RING_NOVEL_X=615; RING_NOVEL_Y=1530
    CARD_X=270; TAP_Y0=680; TAP_STEP=240
    SWIPE="540 1650 540 650" ;;
  *) echo "未知 profile $PROFILE"; exit 1 ;;
esac

adb() { "$ADB" -s $S "$@"; }

h() { /sbin/md5 -q "$1" | cut -c1-12; }
shot() { adb exec-out screencap -p > "/tmp/lnav_$1.png" 2>/dev/null || true; sleep 0.3; }
changed() { [ -s "/tmp/lnav_$1.png" ] && [ "$(h /tmp/lnav_$1.png)" != "$(h /tmp/lnav_$2.png)" ]; }

if [ "$SC" = "carousel" ]; then
  echo "carousel: 起始页即推荐轮播，无需导航"; exit 0
fi

CARD_ONLY="${BENCH_CARD_ONLY:-0}"
if [ "$CARD_ONLY" != "1" ]; then
  # 1) 冷启动 + 就绪（9s 基线 + 轮询内容非 blank）
  adb shell am force-stop $PKG; sleep 1.2
  adb shell am start -n $PKG/.LynxActivity >/dev/null
  sleep 9

  # 2) FAB → 环项（3 次尝试，diff 校验）
  for attempt in 1 2 3; do
    shot bef
    adb shell input tap $FAB_X $FAB_Y; sleep 3.5
    shot menu
    case "$SC" in
      illust|multiimage) adb shell input tap $RING_ILLUST_X $RING_ILLUST_Y ;;
      novel|novel-detail) adb shell input tap $RING_NOVEL_X $RING_NOVEL_Y ;;
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
fi

# 3) 详情场景：点击可点卡进详情（受限卡不可点 → 滚动后逐点重试，用截图 diff 判进详情）
if [ "$SC" = "novel-detail" ] || [ "$SC" = "multiimage" ]; then
  adb shell input swipe $SWIPE 600; sleep 1.5
  for i in 1 2 3 4 5; do
    y=$((TAP_Y0 + (i - 1) * TAP_STEP))
    shot pre
    adb shell input tap $CARD_X $y; sleep 6
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
