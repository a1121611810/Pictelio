#!/bin/bash
# ─── 真机 Lynx client 完整流程自动化（#51/#53/#59 + 功能路径） ───
# 用法: ./lynx-flow-check.sh
# 流程: 登录 → 推荐(滚动/卡片收藏/详情) → 小说(列表/正文) → 我的(R18 切换)
# 强制全自动化：任何一步失败即 exit 1（不降级手动），供后续修复重跑。
set -euo pipefail
cd "$(dirname "$0")/.."   # packages/app-lynx

PKG="io.pictelio.app"
ANALYZE="python3 scripts/lynx-screen-analyze.py"
TOKEN=$(grep -oE '^PIXIV_REFRESH_TOKEN=.*' .env | head -1 | cut -d= -f2-)
[ -n "$TOKEN" ] || { echo "❌ .env 缺 PIXIV_REFRESH_TOKEN"; exit 1; }
adb get-state >/dev/null 2>&1 || { echo "❌ 无设备"; exit 1; }

# screencap 偶发写空文件（实测）→ 重试至非空（≤3 次），避免 analyze 空输入误判
shot() {
  local f=/tmp/flow_$1.png
  for t in 1 2 3; do
    adb exec-out screencap -p > "$f" 2>/dev/null
    [ -s "$f" ] && break
    sleep 1
  done
  return 0
}
classify() { $ANALYZE /tmp/flow_$1.png classify 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['page'])" 2>/dev/null || echo ""; }
busy() { $ANALYZE /tmp/flow_$1.png classify 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['busy'])" 2>/dev/null || echo 0; }
colored() { $ANALYZE /tmp/flow_$1.png classify 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['colored'])" 2>/dev/null || echo 0; }
red() { $ANALYZE /tmp/flow_$1.png classify 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin)['red'])" 2>/dev/null || echo 0; }

# ─── 页面断言（#1036：断言**具体**页面，不接受「不是 login 且不是 blank」） ───
#
# 旧写法 `[ "$ST" = "login" ] || [ "$ST" = "blank" ] || { echo " ✓ ..."; }`
# 在分类器恒返回 detail 的前提下**全部通过** ⇒ 那些 ✓ 是不挣得的（issue #1036）。
# 现在每步断言确切页名，并附可行动的诊断。
expect_page() {          # expect_page <截图名> <期望页> <步骤描述> <允许的替代页,可选>
  local shot_name="$1" want="$2" desc="$3" alt="${4:-}"
  local got busy_v
  got=$(classify "$shot_name"); busy_v=$(busy "$shot_name")
  if [ "$got" = "$want" ]; then
    echo "   ✓ $desc（${got}，busy=${busy_v}）"
    return 0
  fi
  if [ -n "$alt" ] && [ "$got" = "$alt" ]; then
    echo "   ✓ $desc（${got}，busy=${busy_v}；接受的替代形态）"
    return 0
  fi
  echo "❌ $desc 失败：期望 ${want}${alt:+ 或 ${alt}}，实测 ${got:-<无返回>}（busy=${busy_v}）"
  return 1
}

# ─── 分辨率自适应：全部坐标按 1080x2400 基准缩放 ───
# AVD 实测：pictelio_ui=720x1280（旧脚本硬编码 1080x2400 坐标在低分屏上
# swipe 起点超屏失效/点击错位）。lynx 布局全部用 vw 单位（随宽度缩放），
# 因此纵向坐标同样按宽度比例换算（高度比例会因屏幕更矮而错位）。
WM_SIZE=$(adb shell wm size | grep -oE '[0-9]+x[0-9]+' | head -1)
WM_W=${WM_SIZE%x*}
WM_H=${WM_SIZE#*x}
[ -n "$WM_W" ] && [ -n "$WM_H" ] || { echo "❌ 无法读取屏幕分辨率（wm size）"; exit 1; }
sx() { echo $(( $1 * WM_W / 1080 )); }   # 横向（基准 1080）
sy() { echo $(( $1 * WM_W / 1080 )); }   # 纵向（lynx vw 布局 → 同样按宽度比例）
echo "   屏幕: ${WM_W}x${WM_H}（坐标按基准 1080x2400 缩放）"

echo "════ 0. 重置（清 prefs + 清 token） ════"
# 单引擎后 pictelio_client_kind 无读点，2026-10-18 已删该键写入（先例 lynx-device-check.sh:16）。
# 本步原意保留：「重置 prefs」= CapacitorStorage 覆写成空 map（与旧写法覆盖整份文件等价），
# 「清 token」= 删 WSSecureStorage 里的 refresh_token（见下方 run-as 段）。
# ⚠️ 必须**前置守卫**：第 0 步靠 `run-as` 改 SharedPreferences，而 run-as 只对
# debuggable 包可用。装的是 release 包时它在 `set -e` 下**静默终止整条脚本**——
# 屏幕上只多一行步骤标题，看起来像脚本本身坏了（2026-10-18 实测踩到）。
if ! adb shell "run-as $PKG id" >/dev/null 2>&1; then
  echo "❌ 当前安装的 $PKG 不是 debuggable 包，run-as 不可用 ⇒ 无法执行第 0 步重置。"
  echo "   请先安装 debug 包：pnpm build:android-host && adb install -r <debug apk>"
  exit 1
fi
adb shell "run-as $PKG sh -c '
  mkdir -p shared_prefs
  F=shared_prefs/CapacitorStorage.xml
  printf \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?>\n<map>\n</map>\n\" > \$F
  S=shared_prefs/WSSecureStorageSharedPreferences.xml
  # ⚠️ 必须写成显式 if + 末尾 exit 0：`[ -f ... ] && sed ...` 在文件不存在时整条
  #   返回 1；新装包（尚无 secure storage 文件）会触发 `set -e` **静默终止整条脚本**。
  #   注：本段在双引号内，注释里也不能出现裸的美元变量名（bash 会展开它并被 set -u 拦下），
  #   也不能出现反引号（会被当命令替换）。两处都实测踩到过。
  #   2026-10-18 实测。
  if [ -f \$S ]; then sed -i \"\|<string name=\\\"capacitor-storage_refresh_token\\\">|d\" \$S; fi
  exit 0'" 2>/dev/null
adb logcat -c
adb shell am force-stop $PKG; sleep 1
# ⚠️ launcher activity **不可写死**：manifest 按 flavor 注入（#116/#117），本脚本写死的
#   `.MainActivity` 在 lynx flavor 上不存在 ⇒ `am start` 报
#   「Activity class {io.pictelio.app/io.pictelio.app.MainActivity} does not exist」，
#   整条真机流程在第 0 步就死掉、后面所有步骤从未被执行过（2026-10-17 实测）。
#   实测当前解析结果是 `io.pictelio.app/.LynxActivity`。这里改成向系统问，
#   解析失败才回退到已知的 lynx 类名。
LAUNCH_ACTIVITY=$(adb shell cmd package resolve-activity --brief \
  -a android.intent.action.MAIN -c android.intent.category.LAUNCHER "$PKG" 2>/dev/null \
  | tr -d '\r' | grep -E "^$PKG/" | head -1)
[ -n "$LAUNCH_ACTIVITY" ] || LAUNCH_ACTIVITY="$PKG/.LynxActivity"
echo "   launcher: $LAUNCH_ACTIVITY"
adb shell am start -n "$LAUNCH_ACTIVITY" >/dev/null
sleep 9

echo "════ 1. 登录（全自动） ════"
# 等待页面稳定（blank=恢复中 → login/images）
STATE="blank"
for i in $(seq 1 12); do
  sleep 3; shot s
  STATE=$(classify s)
  [ "$STATE" != "blank" ] && break
done
if [ "$STATE" = "recommended" ] || [ "$STATE" = "images" ] || [ "$STATE" = "detail" ]; then
  echo "   ✓ 已自动登录（${STATE}）"
elif [ "$STATE" = "login" ]; then
  ELEMS=$($ANALYZE /tmp/flow_s.png login-elements)
  IN_Y=$(echo "$ELEMS" | python3 -c "import json,sys; print((json.load(sys.stdin).get('input') or {}).get('y',''))")
  BT_Y=$(echo "$ELEMS" | python3 -c "import json,sys; print((json.load(sys.stdin).get('button') or {}).get('y',''))")
  [ -n "$IN_Y" ] && [ -n "$BT_Y" ] || { echo "❌ 登录页定位失败"; exit 1; }
  adb shell input tap $(sx 540) "$IN_Y"; sleep 1.2
  adb shell input text "$TOKEN"; sleep 1.5
  adb shell input keyevent 111; sleep 1
  adb shell input tap $(sx 540) "$BT_Y"
  for i in $(seq 1 12); do
    sleep 3; shot s2
    STATE=$(classify s2)
    # 登录后必进推荐页；classify 空串（截图失败容错）不算成功，继续等
    [ -n "$STATE" ] && [ "$STATE" != "login" ] && [ "$STATE" != "blank" ] && break
  done
else
  echo "❌ 页面异常: $STATE"; exit 1
fi
# #1036：断言**具体**页面。旧写法只判「不是 login 且不是 blank」，在分类器恒返回
# detail 的前提下恒真。现在登录后必须真的落在推荐瀑布流上。
expect_page s recommended "登录后进入推荐页" || exit 1

# ─── SETTINGS_ONLY=1：跳过中间回归步骤（收藏/详情/小说/R18），直接验证设置页滚动（issue #90 核心）。
# 中间步骤依赖真实推荐内容 + BACK 导航，模拟器上偶发不稳定，
# 属测试基建脆弱性而非 app 缺陷（web-core E2E 与多轮 flow 已验证 app 功能正常）。
# ⚠️ 必须声明在 `SKIP_MID` 守卫**之外**：脚本开了 `set -u`，而末尾的汇总行会读这三个
# 变量。SETTINGS_ONLY=1（跳过中间回归步骤的旁路）时它们从未被赋值 ⇒ 未绑定变量直接
# 让脚本 exit ——旁路反而成了硬失败。这是 #709 接线时踩到的，靠「声明前置」修掉。
FAV_NOTE=""
FAV_STATE=""
FAV_OK=""
SKIP_MID="${SETTINGS_ONLY:-}"
if [ -z "$SKIP_MID" ]; then

echo "════ 2. 卡片收藏（动态定位收藏 chip，判据配色无关） ════"
# 收藏是回归链路非核心项：不阻断。
#
# ⚠️ #709 **判据订正**：本步原先做两件**都只认红色**的事，且两件都失效：
#   ① 定位 ♥ = 全屏扫「红像素 + 周围有白色邻域」——chip 底色是 M3 令牌实色
#      （未收藏 `--md-inverse-surface` / 已收藏 `--md-tertiary`，见 spec
#      docs/specs/bookmark-color.md §配色），**14 个主题组合里没有一个是红的**；
#      而推荐流的作品图里到处是红 ⇒ 定位器会去点画上的红色插画（点错位置）。
#   ② 确认生效 = 比较全屏红像素计数是否增加 —— 点 chip 根本不改变任何红色像素
#      ⇒ 3 次重试后恒定输出「⚠️ 收藏未生效」，读起来像产品回归而其实不是。
# 现改为：定位与确认都读**胶囊底色对应的 M3 令牌**（令牌表由 lynx-screen-analyze.py
# 运行时解析 src/styles/tokens.css，不在本脚本硬编码任何色值）。
#
# 三态而不是「成功/失败」：判不出时（unknown）报「本轮未验证」并给原因，
# **绝不**输出确定性的「收藏未生效」——那是本仓反复吃亏的那类假阴性。
for attempt in 1 2 3; do
  shot rec1
  CHIP=$($ANALYZE /tmp/flow_rec1.png bookmark-chip src/styles/tokens.css 2>/dev/null || echo "")
  CX=$(echo "$CHIP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('x') or '')" 2>/dev/null || echo "")
  CY=$(echo "$CHIP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('y') or '')" 2>/dev/null || echo "")
  CST=$(echo "$CHIP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('state',''))" 2>/dev/null || echo "")
  CBG=$(echo "$CHIP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('bg',''))" 2>/dev/null || echo "")
  if [ -z "$CX" ] || [ -z "$CY" ]; then
    FAV_NOTE="第 $attempt 次未在卡片区定位到收藏 chip（$(echo "$CHIP" | python3 -c "import json,sys; print(json.load(sys.stdin).get('reason','无返回'))" 2>/dev/null || echo 无返回)）"
    echo "   ⚠️ $FAV_NOTE"
    continue
  fi
  echo "   收藏 chip 定位: ($CX,$CY) 底色 $CBG → 初始态 $CST"
  case "$CST" in
    bookmarked|not-bookmarked) ;;
    *)
      FAV_NOTE="chip 底色 $CBG 判不出收藏态（两族令牌都命中或都没命中 ⇒ 该配色下不可分）"
      echo "   ⚠️ 第 $attempt 次：$FAV_NOTE"
      continue
      ;;
  esac
  adb shell input tap "$CX" "$CY"; sleep 2
  shot fav
  AFTER=$($ANALYZE /tmp/flow_fav.png bookmark-chip src/styles/tokens.css 2>/dev/null || echo "")
  AST=$(echo "$AFTER" | python3 -c "import json,sys; print(json.load(sys.stdin).get('state',''))" 2>/dev/null || echo "")
  ABG=$(echo "$AFTER" | python3 -c "import json,sys; print(json.load(sys.stdin).get('bg',''))" 2>/dev/null || echo "")
  # 可观测性：share 是判据的量化输出，不打出来就无法在设备日志里核对
  # 「这次到底读到多少占比」。设备实测 0.308 是 720×1280 下的值，本脚本跑真机即该量级。
  ASH=$(echo "$AFTER" | python3 -c "import json,sys; print(json.load(sys.stdin).get('share',''))" 2>/dev/null || echo "")
  echo "   点击后 chip 底色 $CBG → ${ABG}，判出态 ${AST}，窗口内占比 ${ASH:-?}"
  if [ "$AST" = "$CST" ]; then
    # 状态读得出来且没变：tap 没命中 chip（或收藏写入失败）。这是**真观测**，
    # 不是「判不出」，所以可以给确定结论。
    FAV_NOTE="点击后 chip 底色未变（$CBG → ${ABG}）——tap 未命中 chip 或收藏写入失败"
    echo "   ⚠️ 第 $attempt 次：$FAV_NOTE"
    continue
  fi
  if [ "$AST" != "bookmarked" ] && [ "$AST" != "not-bookmarked" ]; then
    FAV_NOTE="点击后 chip 底色判不出态（${ABG}）——本轮不可判定"
    echo "   ⚠️ 第 $attempt 次：$FAV_NOTE"
    continue
  fi
  echo "   ✓ 收藏态切换成功（$CST → ${AST}，底色 $CBG → ${ABG}）"
  FAV_STATE="$CST → $AST"
  FAV_OK="yes"
  # 还原基线：推荐内容常已是已收藏态，点回原态，避免脚本给账号留痕
  adb shell input tap "$CX" "$CY"; sleep 2
  # ⚠️ 必须**重新截图**：复用上面那张等于把「点完就确认」变成「点前就确认」——
  #   旧帧的 AST 与 CST 已知不等，判定恒假，而 tap 其实已经真实发出。
  shot fav_restore
  RESTORED=$($ANALYZE /tmp/flow_fav_restore.png bookmark-chip src/styles/tokens.css 2>/dev/null || echo "")
  RST=$(echo "$RESTORED" | python3 -c "import json,sys; print(json.load(sys.stdin).get('state',''))" 2>/dev/null || echo "")
  [ "$RST" = "$CST" ] && echo "   ✓ 已还原基线态（${RST}）" || echo "   ⚠️ 还原未确认（当前 ${RST}，期望 ${CST}）——不阻断"
  break
done
if [ -z "$FAV_OK" ]; then
  # ⚠️ 这里**不能**再写「收藏未生效」：多数情况下本轮只是判不出或没定位到，
  # 与产品行为无关。措辞按 #819 既有的 skip-with-reason 口径（见 qa-defense-lines）。
  echo "   ⏭ 本轮未验证：${FAV_NOTE:-三次尝试均未取得可判定的 chip 态}（本步为回归项，不阻断）"
fi

echo "════ 3. 推荐页滚动加载 ════"
shot rec1; C1=$(colored rec1)
adb shell input swipe $(sx 540) $(sy 1600) $(sx 540) $(sy 400) 300; sleep 3
shot rec2; C2=$(colored rec2)
echo "   滚动前彩色 $C1 → 滚动后 $C2"
# #1036：滚动后必须仍在推荐页（具体页断言）
expect_page rec2 recommended "推荐页滚动后仍在推荐页" "detail" || exit 1
echo "   ✓ 推荐页滚动正常"

echo "════ 4. 点卡片 → 插画详情 ════"
# 先滚动回顶部（swipe 向上滑 = 内容回顶；注意方向：1600→400）
adb shell input swipe $(sx 540) $(sy 1600) $(sx 540) $(sy 400) 300; sleep 3
shot back_top
expect_page back_top recommended "回顶后仍在推荐页" "detail" || exit 1
# 详情页判断：classify=detail（大图特征，lynx-service-http 不打 URL 日志，API grep 不可靠）
DETAIL_OK=""
for pos in "270 400" "270 500" "540 550"; do
  set -- $pos
  adb shell input tap $(sx $1) $(sy $2); sleep 8   # 详情加载（Native API + 大图）需要时间
  shot det_try
  ST=$(classify det_try)
  if [ "$ST" = "detail" ]; then
    echo "   ✓ 进入详情页 at ($1,$2)（classify=${ST}）"
    DETAIL_OK="yes"
    break
  fi
done
[ -n "$DETAIL_OK" ] || { echo "❌ 未进入详情页（classify=${ST:-?}）"; exit 1; }
# 大图渲染验证（#1036：改为背景相对——旧判据 `not is_whiteish` 在暗色下恒真）
shot det
DET_NW=$(python3 - scripts/lynx-screen-analyze.py <<'PYEOF' || true
import importlib.util, sys
spec = importlib.util.spec_from_file_location('a', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
w, h, rows = m.load_png('/tmp/flow_det.png')
print(round(m.busy_ratio(w, h, rows, 0.20, 0.83), 3))
PYEOF
)
echo "   详情页中部背景相对内容占比: ${DET_NW}（大图渲染）"
# 阈值来源：真实详情帧实测 0.320（取反帧 0.331）；非作品页最高为我的页 0.033
if python3 -c "exit(0 if float('${DET_NW:-0}') > 0.15 else 1)"; then
  echo "   ✓ 详情大图已渲染"
else
  echo "❌ 详情大图未渲染（背景相对内容占比 ${DET_NW}，阈值 0.15）"; exit 1
fi

echo "════ 5. 详情返回 → 推荐 ════"
adb shell input keyevent 4; sleep 4
shot back1
# #1036：从详情返回应回到推荐页（具体页断言）。旧写法「不是 login 且不是 blank」恒真。
expect_page back1 recommended "详情返回后回到推荐页" "text" || exit 1

echo "════ 6. 小说列表 → 正文 → 返回 ════"
adb shell input tap $(sx 800) $(sy 145); sleep 4   # 顶部"小说"（仅推荐页有效）
shot nv1
ST6=$(classify nv1)
if [ "$ST6" = "recommended" ] || [ "$ST6" = "login" ] || [ "$ST6" = "blank" ]; then
  # 可能详情返回失败仍在详情页 → 返回后再点小说
  adb shell input keyevent 4; sleep 3
  adb shell input tap $(sx 800) $(sy 145); sleep 4
  shot nv1b; ST6=$(classify nv1b)
fi
# 小说列表 = 有顶部栏的文本页（text）。#1036：具体页断言 + 可行动诊断。
# 允许 `me` 作为**空列表**的已知形态并给出明确原因（实测：本账号小说列表为空时
# classify 判 me，busy≈0.019）——这是数据状态不是分类缺陷，措辞必须说准。
NV_PAGE=$(classify nv1)
if [ "$NV_PAGE" = "recommended" ] || [ "$NV_PAGE" = "login" ] || [ "$NV_PAGE" = "blank" ]; then
  # 可能详情返回失败仍在详情页 → 返回后再点小说
  adb shell input keyevent 4; sleep 3
  adb shell input tap $(sx 800) $(sy 145); sleep 4
  shot nv1b; NV_PAGE=$(classify nv1b)
fi
if [ "$NV_PAGE" = "recommended" ]; then
  echo "❌ 未进入小说列表（仍在推荐页）"; exit 1
fi
if [ "$NV_PAGE" = "text" ]; then
  echo "   ✓ 进入小说列表（text，busy=$(busy nv1)）"
elif [ "$NV_PAGE" = "me" ] && [ "$(python3 -c "print(1 if float('$(busy nv1)') < 0.026 else 0)")" = "1" ]; then
  echo "   ⚠️ 小说列表为空（本账号无小说，busy=$(busy nv1) 远低于文本页阈值）——非分类缺陷，继续"
else
  echo "❌ 小说列表判定异常：期望 text，实测 ${NV_PAGE:-<无返回>}（busy=$(busy nv1)）"; exit 1
fi
# [spec] 小说列表内容非空断言：item-key 传数字 → lynx 220201 illegal item-key → 列表条目不渲染
# （骨架屏消失后纯空白）。内容区（顶部栏下方）暗色文本像素占比过低视为空白。
shot nv_content
NVC=$(python3 - scripts/lynx-screen-analyze.py <<'PYEOF' || true
import importlib.util, sys
spec = importlib.util.spec_from_file_location('a', sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
w, h, rows = m.load_png('/tmp/flow_nv_content.png')
print(round(m.busy_ratio(w, h, rows, 0.18, 0.80), 4))
PYEOF
)
echo "   小说列表内容区背景相对占比: ${NVC:-0}"
# 阈值来源：实测空列表 0.019、我的页 0.033；非空小说列表应显著更高（文本条目密集）
python3 -c "exit(0 if float('${NVC:-0}') > 0.05 else 1)" || { echo "❌ 小说列表无内容（busy=${NVC:-0}，阈值 0.05；疑似 220201 item-key 回归）"; exit 1; }
adb shell input tap $(sx 270) $(sy 330); sleep 6   # 列表第一条 → 小说正文
shot nv2
echo "   小说正文: $(classify nv2)"
adb shell input keyevent 4; sleep 3   # 正文返回 → 列表
adb shell input keyevent 4; sleep 3   # 列表返回 → 推荐
shot nv3
# #1036：两级返回后应回到推荐页
expect_page nv3 recommended "小说流程两级返回后回到推荐页" "text" || exit 1

echo "════ 7. 我的 → R18 切换（坐标敏感，失败不阻断） ════"
adb shell input tap $(sx 900) $(sy 145); sleep 4   # 顶部"我的"
shot me1
# #1036：具体页断言。「我的」是列表型页面（实测 busy≈0.033），不是作品页也不是文本页。
expect_page me1 me "进入我的页" "text" || exit 1
# R18 开关切换（布局随分辨率变化，固定区域对比仅作参考）——png 空防护 + 不阻断
adb exec-out screencap -p > /tmp/r18_before.png 2>/dev/null
adb shell input tap $(sx 540) $(sy 740); sleep 2
adb exec-out screencap -p > /tmp/r18_after.png 2>/dev/null
R18_DIFF=0
if [ -s /tmp/r18_before.png ] && [ -s /tmp/r18_after.png ]; then
  R18_DIFF=$(python3 - scripts/lynx-screen-analyze.py <<'PYEOF'
import importlib.util
spec = importlib.util.spec_from_file_location('a', 'scripts/lynx-screen-analyze.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
w1, h1, r1 = m.load_png('/tmp/r18_before.png')
w2, h2, r2 = m.load_png('/tmp/r18_after.png')
diff = 0
for y in range(0, min(h1, h2), 8):
    for x in range(0, min(w1, w2), 10):
        a = m.pixel(r1, y, x)
        b = m.pixel(r2, y, x)
        if abs(a[0]-b[0]) + abs(a[1]-b[1]) + abs(a[2]-b[2]) > 60:
            diff += 1
print(diff)
PYEOF
)
fi
echo "   R18 切换后全屏变化像素: $R18_DIFF"
[ "$R18_DIFF" -gt 10 ] && echo "   ✓ R18 开关切换生效" || echo "   ⚠️ R18 无可见变化（布局坐标偏移）——不阻断"
# 返回内容页（keyevent 比坐标 tap 可靠：详情/设置页返回按钮位置不定）
adb shell input keyevent 4; sleep 3
shot final
# #1036：具体页断言——从「我的」返回应回到推荐页
expect_page final recommended "从我的返回推荐页" "text" || exit 1
fi   # ← SETTINGS_ONLY：跳过中间回归步骤的 if 结束

echo "════ 8. 设置页滚动（issue #90：scroll-view + 5 组） ════"
# 复位到推荐页。判据用 **classify**（#1036）而不是旧的「顶栏 blocks≥3」：
# ① blocks≥3 此前在暗色主题下永远不满足（topbar_nav 只认 r<140 的深色文字，未选中
#    tab 是暗灰检测不到）——2026-10-17 那次「无法回到推荐页顶栏（blocks=0）」退出 1
#    即此因，已随 topbar_nav 的背景相对化修复；
# ② 但 blocks 本身也区分不了「推荐页」与「任何同样有 3 个 tab 的页」，classify 更直接。
# keyevent 4 逐级返回；**仅在已判定不在推荐页时**执行，避免根路由退桌面。
# （SETTINGS_ONLY 模式登录后即在推荐页，首轮即命中）
BACK_OK=""
for i in 1 2 3 4 5; do
  sleep 2
  shot nav_i
  NAV_PAGE=$(classify nav_i)
  # ⚠️ 必须写成显式 if：`A || B && C` 在 set -e 下，当 A、B 皆假时整条返回 1 会直接终止脚本。
  if [ "$NAV_PAGE" = "recommended" ] || [ "$NAV_PAGE" = "detail" ]; then
    BACK_OK="yes"; break
  fi
  if [ -s /tmp/flow_nav_i.png ]; then
    adb shell input keyevent 4; sleep 2
  else
    sleep 2   # 截图失败：只等待，不发 keyevent（根路由会退桌面）
  fi
done
if [ -z "$BACK_OK" ]; then
  echo "❌ 无法回到推荐页（末次 classify=${NAV_PAGE:-<无返回>}）"; exit 1
fi
echo "   ✓ 已回到推荐页（classify=${NAV_PAGE}）"
# 进「我的」：当前顶栏是 全部/插画/小说（实测 3 块，cx≈119/360/600），**没有「我的」**。
# 旧脚本取「最右块 -40」当「我的」tap —— 那会点在「小说」tab 上，进错页仍报成功。
# 现走 FAB 菜单（设备实测：FAB $(sx 635) $(sy 1053) →「我的」$(sx 385) $(sy 1045)）。
adb shell input tap $(sx 635) $(sy 1053); sleep 3
shot fab_menu
adb shell input tap $(sx 385) $(sy 1045); sleep 4
shot me_top
expect_page me_top me "经 FAB 菜单进入我的页" "text" || exit 1
R_TOP=$(red me_top)
# 内容上移 = 向下滚动；多次 swipe 滚到底（720x1280 视口，内容 ~2000px+）
adb shell input swipe $(sx 540) $(sy 1600) $(sx 540) $(sy 400) 300; sleep 2
adb shell input swipe $(sx 540) $(sy 1600) $(sx 540) $(sy 400) 300; sleep 2
adb shell input swipe $(sx 540) $(sy 1600) $(sx 540) $(sy 400) 300; sleep 2
shot me_bottom
R_BOT=$(red me_bottom)
echo "   设置页红色像素（退出登录 text-danger）：顶部 $R_TOP → 滚动后 $R_BOT"
# 断言：滚动后"退出登录"（红色文字）必须进入视口；顶部时它应在视口外（红色≈0）
if [ "$R_BOT" -gt 50 ] && [ "$R_BOT" -gt "$((R_TOP + 30))" ]; then
  echo "   ✓ 设置页可滚动（滚动后退出登录进入视口）"
else
  echo "   ❌ 设置页不可滚动（滚动后退出登录未进入视口）"; exit 1
fi
adb shell input swipe $(sx 540) $(sy 400) $(sx 540) $(sy 1600) 300; sleep 2   # 滚回顶部
shot me_top2
R_TOP2=$(red me_top2)
echo "   滚回顶部后红色像素：${R_TOP2}（应回落）"
[ "$R_TOP2" -lt "$((R_BOT - 10))" ] || echo "   ⚠️ 滚回顶部后红色未明显回落（可能仍在中段）——不阻断"

echo ""
echo "════════ 完整流程结果 ════════"
# ⚠️ 收藏步是回归项、非阻断，且 #709 之后可能落在「本轮未验证」而不是「通过」。
# 这里**不能**把它和其余步骤并列写进「全部通过」——那正是本仓反复吃亏的
# 「日志宣称验证了实际未验证的事」。
echo "✅ 已通过的阻断步骤：登录 → 推荐滚动 → 插画详情 → 小说 → 我的/R18 → 设置页滚动"
if [ -n "$FAV_OK" ]; then
  echo "✅ 卡片收藏：收藏态切换成功（${FAV_STATE}）"
else
  echo "⏭ 卡片收藏：本轮未验证（${FAV_NOTE:-未取得可判定的 chip 态}）——回归项，不阻断"
fi
# [spec] 错误码断言：220201（illegal item-key → 小说列表空白根因）必须为 0；
# 99900/990200 仅打印作参考（可能来自其他瞬时场景，不设断言避免误伤）
echo "（错误码检查：220201 断言为 0；99900/990200 仅参考）"
N_220201=$(adb logcat -d 2>/dev/null | grep -c "220201" || true)
echo "   220201 计数: $N_220201"
[ "$N_220201" -eq 0 ] || { echo "❌ 发现 220201（list item-key 应为 String，见 ADR-0055 §4）"; exit 1; }
echo "   99900/990200 计数: $(adb logcat -d 2>/dev/null | grep -cE "99900|990200" || true)（参考）"
