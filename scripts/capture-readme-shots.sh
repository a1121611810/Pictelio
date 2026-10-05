#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 重新截取 README 用截图（5 张，540×960，9:16）
#
# 实测踩过的坑，都固化在这里了：
#
# 1) 必须用 debug APK，不能用 release。
#    benchNav 深链通道两侧都有门禁：原生侧 `if (BuildConfig.DEBUG)`
#    （LynxActivity.java:503），JS 侧 `if (!__BENCH_NAV__) return`（router.ts:449）。
#    实测 release APK 的 bundle 里 pictelioBenchNav 命中 0 次，debug 命中 5 次。
#    __DEV__ 在 debug 下同样为 false（NODE_ENV=production），所以 UI 与 release 一致。
#
# 2) benchNav 的 extra 值是**短名**，不是事件全名。
#    ✅ --es benchNav carousel / me / novel / illust / novel-detail …
#    ❌ --es benchNav pictelioBenchNavCarousel（静默不生效，页面停在 /discover）
#    详情页走载荷通道：--es benchNav illust-detail --es benchNavIllustId <id>
#                     --es benchNav novel-detail --es benchNavNovelId <id>
#
# 3) 必须 force-stop 后冷启才生效。
#    热启动走 onNewIntent，��建 onCreate 里读 extra 的分支不执行（原生在
#    onLoadSuccess 后 1.5/3/4.5/6s 各发一次事件）。
#    ⚠️ 但 force-stop 冷启会触发 refresh token 轮换竞态，可能把会话打掉登出。
#    所以：**登录后不要再用冷启深链**，全程用 App 内点击导航。
#
# 4) AVD 用 pictelio_low（720×1280，正好 9:16，等比缩到 540×960 不变形）。
#    pictelio_ui 是 1080×2160（1:2），压到 540×960 会纵向拉扁。
#
# 5) 登录时软键盘会挡住「登录」按钮：input text 之后先 KEYCODE_BACK 收键盘再点。
#
# 6) 图片 CDN 在模拟器上偶发不加载（网络自检会报「DNS 解析 失败」）。
#    抓 feed/detail 前多等一轮，或切走再切回强制重拉。
#
# 7) 截图前确认画面里没有键盘、弹窗，也没有账号身份信息
#    （「我的」页顶部有账号名与 handle —— 像旧图那样先滚到设置区再拍）。
#
# 用法：
#   bash scripts/capture-readme-shots.sh            # 装包 + 登录 + 抓能抓的
#   SKIP_INSTALL=1 bash scripts/capture-readme-shots.sh
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

SER="${SER:-emulator-5554}"
AVD="${AVD:-pictelio_low}"
PKG="io.pictelio.app"
ACT="$PKG/$PKG.LynxActivity"
OUT="${OUT:-packages/website/public/screenshots}"
W=540; H=960
APK="${APK:-packages/android-host/android/app/build/outputs/apk/debug/app-debug.apk}"
ENV_FILE="${ENV_FILE:-packages/app-lynx/.env}"

a()  { adb -s "$SER" "$@"; }
say(){ printf '\n== %s ==\n' "$1"; }

shot() { # $1=输出名（不含扩展名）
  a exec-out screencap -p > "/tmp/pictelio_$1.png" 2>/dev/null
  [ -s "/tmp/pictelio_$1.png" ] || { echo "  ✗ $1: screencap 为空"; return 1; }
  sips -z "$H" "$W" "/tmp/pictelio_$1.png" --out "$OUT/$1.png" >/dev/null 2>&1
  echo "  ✓ $1.png  $(sips -g pixelWidth -g pixelHeight "$OUT/$1.png" 2>/dev/null | awk '/pixel/{printf "%s ",$2}')"
}

# 深链 = force-stop + 冷启。**登录态敏感，见文件头第 3 条。**
nav() { # $1=短名  [$2=载荷extra名] [$3=载荷值]
  a shell am force-stop "$PKG" >/dev/null 2>&1; sleep 2
  if [ -n "${2:-}" ]; then
    a shell am start -n "$ACT" --es benchNav "$1" --es "$2" "$3" >/dev/null 2>&1
  else
    a shell am start -n "$ACT" --es benchNav "$1" >/dev/null 2>&1
  fi
  sleep 15
}

tap() { a shell input tap "$1" "$2" >/dev/null 2>&1; sleep "${3:-3}"; }

read_token() { # 按首个 = 切分（贪婪 sed 会在 value 内部的 = 处截断），不回显
  [ -f "$ENV_FILE" ] || { echo "  ✗ 找不到 $ENV_FILE"; return 1; }
  while IFS= read -r line; do
    case "$line" in
      PIXIV_REFRESH_TOKEN=*) v="${line#PIXIV_REFRESH_TOKEN=}"
                            v="${v%\"}"; v="${v#\"}"
                            printf '%s' "$v"; return 0;;
    esac
  done < "$ENV_FILE"
  return 1
}

# ── 0. 设备就绪 ───────────────────────────────────────────────────────────
say "设备自检"
a wait-for-device
echo "  serial : $SER"
echo "  boot   : $(a shell getprop sys.boot_completed 2>/dev/null | tr -d '\r\n')"
echo "  screen : $(a shell wm size 2>/dev/null | tr -d '\r')"
a shell input keyevent KEYCODE_WAKEUP >/dev/null 2>&1
a shell wm dismiss-keyguard  >/dev/null 2>&1

# ── 1. 装包 ───────────────────────────────────────────────────────────────
if [ "${SKIP_INSTALL:-0}" != "1" ]; then
  say "安装 debug APK"
  a install -r -t "$APK" 2>&1 | tail -2
fi

# ── 2. 登录（未登录时）────────────────────────────────────────────────────
say "登录"
TOKEN="$(read_token)" || exit 1
echo "  token 长度 ${#TOKEN}（不回显内容）"
tap 360 588 2                       # 输入框
a shell input text "$TOKEN" >/dev/null 2>&1; sleep 2
a shell input keyevent KEYCODE_BACK >/dev/null 2>&1; sleep 2   # 收键盘，否则挡住按钮
tap 360 700 14                      # 登录
echo "  登录后当前页：$(a shell dumpsys activity activities 2>/dev/null | grep -m1 -o 'pictelioapp/[^ }]*' || echo '?')"

# ── 3. 抓图 ───────────────────────────────────────────────────────────────
say "抓图"

# 07_login：必须在**未登录**态拍。要放最前面就在登录前调用；此处给出手动步骤：
echo "  [!] 07_login 需登出态：登出后冷启再跑，或先 pm clear 再冷启"
echo "      adb -s $SER shell pm clear $PKG && adb -s $SER shell am start -n $ACT"
echo "      然后： shot 07_login"

# 01_feed：发现页。冷启深链 → 等图片加载（见文件头第 6 条）
nav carousel
sleep 18
shot 01_feed

# 02_detail：深链需要真实 illust_id（载荷通道），没有就点 feed 首卡
: "${ILLUST_ID:=}"
if [ -n "$ILLUST_ID" ]; then
  nav illust-detail benchNavIllustId "$ILLUST_ID"; sleep 8; shot 02_detail
else
  echo "  → 02_detail：未提供 ILLUST_ID，改为点 feed 首卡（tap 360 380）"
  tap 360 380 15; shot 02_detail
  a shell input keyevent KEYCODE_BACK >/dev/null 2>&1; sleep 4
fi

# 03_novel：同理，需要 NOVEL_ID；Discover 的「小说」页签在模拟器上常为空
: "${NOVEL_ID:=}"
if [ -n "$NOVEL_ID" ]; then
  nav novel-detail benchNavNovelId "$NOVEL_ID"; sleep 10; shot 03_novel
else
  echo "  → 03_novel：未提供 NOVEL_ID。发现页「小说」页签在模拟器上拉不到内容；"
  echo "     搜索面板的 IME 提交键在合成输入下不触发。需在真机或已知 novel_id 下补拍。"
fi

# 06_settings：App 内导航（登录态下不用冷启）。FAB 打开导航环 → 点「我的」→ 滚到设置区
a shell input keyevent KEYCODE_BACK >/dev/null 2>&1; sleep 3
tap 637 1052 4                       # FAB
tap 384 1040 12                      # 导航环里的「我的」（坐标随页面内容浮动，失败就截图重判）
echo "  [!] 首次进入会有「导航已调整」提示，点「知道了」(596 277) 后再滚"
for _ in 1 2 3 4; do a shell input swipe 360 900 360 350 250 >/dev/null 2>&1; sleep 2; done
sleep 4
shot 06_settings

say "完成"
ls -la "$OUT"
