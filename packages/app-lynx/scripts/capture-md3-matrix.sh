#!/bin/bash
# T16 整站截图矩阵采集（issue #864）
#
# WARNING 本文件的注释是「反例载体」：下文多处故意在注释里写下错误写法（当反例）。
#    因此对本文件做源级守卫时不能整体剥注释（会连反例一起剥掉、判不出残留缺陷），
#    必须逐行排除行首 # 与 //。此例外的规范出处：
#    packages/app-lynx/CONTEXT.md「源级守卫（source-level guard）」条目。
#    由 tests/captureScriptInvariants.test.ts 强制（删掉本段该守卫会转红）。
#
# 矩阵三轴：**屏宽** × **明暗** × **色板**，外加**页面**扫描。
# 全部在**既有 AVD**（ADR-0061）上完成，只用 `adb shell wm size` 改运行时分辨率，
# **不新建、不删除 AVD**。
#
# ══ 为什么不用写死坐标（这一段是本脚本存在的主要理由）══
# 首版把「我的 → 外观」的点击坐标按 1080×2160 写死，实测连续翻车三次：
#   ① 换 wm size 后坐标全错 → `set_mode light` 静默不生效，
#      **文件名写着 light、图是 dark**（亮度实测 36.5）；
#   ② 修成比例坐标后，「外观」卡仍会因滚动落点漂移而点空 ——
#      实测同参数连跑两次截图仍差 6.94% 像素（已排除状态栏时钟，那只占 0.x%）；
#   ③ 换 900ms 慢速拖拽（位移即滚动量）**也没解决**，漂移依旧。
# `uiautomator dump` 也不行：实测本应用 Lynx 文本节点数为 0，按文本定位不通。
#
# 所以：**不假设控件在哪，检测它在哪**。
# `scripts/find-ui-band.py` 按像素特征找出「外观模式」分段控件的**已选中实心段**
# （宽而扁 + 内部颜色均匀），拿到它的 y 作为锚点，其余坐标用相对几何推算。
# 两张滚动位置不同的截图上实测锚点相差仅 3px（y=704 vs y=1784 各自都认对了控件）。
#
# 判据统一走**两个 oracle**，两者都会在失败时中止，绝不产出「名字对、内容错」的证据：
#   · 外观模式 → **顶栏中段**亮度（见下方 MODE_BAND）。
#     ⚠️ 这里早先写「整屏平均亮度（真亮 202.5 / 真暗 27.3）」—— 那是**被证伪的口径**：
#     整幅被作品图主导，31 张实测整幅 dark 上沿 115.22 ⇒ 8 张暗色 Feed 会被判成「不是暗色」。
#     ⚠️⚠️ 再早先写「**底部 7%** 主题带」—— 那是**量错了对象**：那一段整片是
#     **Android 系统导航栏**，颜色跟**系统主题**走而不跟 app 主题。详见 MODE_BAND 处的
#     逐像素证据与 2×2 实测。app 默认跟随系统时两者恒等，所以这个错一直隐形。
#     ⚠️ `probe_mode()` 用**整幅**、判的也不是「外观设置页」—— `set_mode` 里那记 `back`
#     **不离开页面**（只弹「再按一次退出应用」toast），它量的是**「我的」页**停在外观卡处。
#     整幅在该页 2×2 四格实测 34.86 / 49.48（暗）、229.19 / 237.47（亮）⇒ 现阈值够用，
#     **D-5 不波及它**，故不改。两个消费点为何口径不同，见
#     tests/captureScriptInvariants.test.ts 文件头「两个明暗消费点」。
#   · 主题色   → FAB 底色（FAB 随主题色变，见 preflight 的 FAB 区饱和度）
#
# ⚠️ 采集前必须过 **preflight**：确认 app 真的停在 Feed 上。
# 起因是一次「FAB 展开失败」的真实误诊：app 当时**掉回了登录页**，
# 而登录页的平均亮度与亮色 Feed 几乎一样（实测 240.53 vs 240.53），
# 于是「点 FAB → 亮度应下降」这个判据永远不触发 —— 两种失效**症状完全同形**，
# 脚本据此把「没登录」报成「FAB 点不开」，把人引向错误的方向查了 3 轮。
# 破法：亮度只看得见明暗，看不见**当前是哪个页面**；用 FAB 区的饱和度切开。
# 实测（真实文件对照，非合成 fixture）——区域取 (0.80,0.84,0.96,0.94)，
# 数字是 png-luma.py **默认路径（Pillow）**的输出：
#   登录页      luma 250.00  sd  0.00  sat  7.00   ← 纯色
#   Feed 亮     luma 219.72  sd 47.79  sat 33.01
#   Feed 暗     luma  51.63  sd 35.34  sat 67.96
# 阈值 20 落在 7.00 与 33.01 之间，两侧余量都很大。
# ⚠️ png-luma.py 有 Pillow 快路径与标准库两条实现，**数字对不齐**（实测整幅 Δ 0.60、窄带 Δ 5.07，
# 因为标准库按 7×11 步长抽样）。所以阈值按**判定一致**校验，不是按数字相等 ——
# 改探针实现时必须重跑 `png-luma.py --selfcheck --preset`。
#
# ⚠️ 不要再写 `--selfcheck --thresholds=...`：那条 CLI 形式已**主动废弃**，现在会
# 报错退出 2（`--selfcheck` 不带门禁清单时拒绝运行 —— 旧版会打印「不一致 0 处」
# 然后 exit 0，即"什么都没查却报通过"）。门禁清单走 `--preset`（内置本文件这 4 条
# 常量的同源副本）或 `--gates 维:阈值:区域,...` 自带。改本文件阈值时**两处都要改**：
# 这里的常量，和 png-luma.py `--preset` 里的副本（漂移会在自检输出里显形）。
set -u
set -o pipefail
# 调试开关：MD3_DEBUG=1 时把检测器每一步的**拒因**打出来。
# 为什么需要它：「找不到控件」是一个**症状**，根因可能是「没找到」「滚过头」
# 「认错卡片」「阈值卡住」四件同形的事，不打拒因就只能靠猜。
dbg() { [ -n "${MD3_DEBUG:-}" ] && echo "    · $*" >&2; return 0; }
# 惰性版。⚠️ **这里栽过一次**：先写成 `dbg_lazy() { [ -n "$MD3_DEBUG" ] || return 0; dbg "$1"; }`
# 然后调用点写 `dbg_lazy "…$(慢命令)"` —— **完全无效**。bash 在调用 `dbg_lazy`
# **之前**就已经把参数里的 $(…) 展开了，跟 `dbg` 一模一样。实测（开关关闭时）：
# 副作用照跑、`dbg` 3317ms vs `dbg_lazy` 3322ms，**零节省**。
# 正确形状是把**命令名**传进去、在函数体内展开；常量字符串没有 $(…) 时用 `dbg` 即可
# （它本来就是惰性的，因为没有东西要展开）。
# 这是本轮**第三处**「注释声称已修、代码未修」（前两处：0.959 复现不出、段中心 1px）。
dbg_lazy() { [ -n "${MD3_DEBUG:-}" ] || return 0; dbg "$("$@")"; }

# 两个调试消息的**命令体**（参数留在函数内，`$(…)` 只在真要打印时才展开）。
# 每次都是一次全屏解码，实测 1.05~1.13s ⇒ 调试开关关着时一次导航最坏多花 ~40s。
_dbg_no_swatch() {
  echo "无色板行（--explain: $(python3 "$HERE/find-palette-swatches.py" "$1" --explain 2>&1 >/dev/null | tail -1)）"
}
_dbg_ctrl_miss() {
  echo "色板行就位(y=${1}) 但控件未检出：$(python3 "$HERE/find-ui-band.py" "$2" --explain 2>&1 >/dev/null | sed -n 2p)"
}

# ⚠️ 判据必须**后置**：采集前查只能挡住「进循环前就掉线」，挡不住「采集中途掉线」。
# 真实事故（capture.log:104-106）：`p-pal2-light-feed` 存的是**登录页**
# （Pictelio logo + refresh_token 输入框），却被当成 Feed 计了数 ——
#   ✓ p-pal2-light-feed（内容区 stddev 40.96）        ← 已存盘、已计数
#   ! 会话失效（FAB 区 sat=7.00 < 20），自动重新登录      ← 判据在这里才跑，而且判对了
#   ✓ 已重新登录（FAB 区 sat=27.22，等待 3s）
# 根因不是判据不准，是**位置错了**：它只是下一次导航的前置检查，等它发现时
# 上一张已经落盘。而内容区 stddev 门禁**抓不到**（登录页 40.96，稳稳越过 20）。
# 所以每次 `shot` 在存盘**之后**立刻验同一条 FAB 判据（见 `on_app_page`）。
# 该判据对**全矩阵**成立而不只是 Feed：实测 32 张里，登录页 sat=7.00，
# 其余 31 张（Feed·我的·插画·小说·搜索·FAB 展开）25.02~66.93。
# ⚠️ 这里早先写的是「20 落在正中间」—— **是错的**（B-2）：20 并不在 25.02~66.93 的
# 几何中点（那是 45.98），它比正样本下沿还**低 5.02**。20 的正当性不在「居中」，
# 而在它卡在**负样本与正样本之间的空档**里：比登录页高 13.00、比正样本下沿低 5.02。
# 两侧余量不对称是刻意的：登录页那 7.00 是**已实测**的负样本，25.02 才是 n=31
# 单设备单轮的**观测下沿**、不是分布上界 —— 往下留 5.02 是防「换个色板/分辨率就掉下去」，
# 往上只留 13.00 够挡住登录页即可。真正的触发条件是**改 FAB 的主色**（色板变淡 ⇒ sat 下降）。
#
# ⚠️ 残留风险（如实记录，不要以为本脚本是安全的）：`adb shell input text "$token"`
#    会把 refresh_token 作为**命令行参数**交给设备侧 shell，因此它会出现在那一瞬间的
#    **设备端进程列表**里（同机 root/adb 可见）。**没有可靠的低侵入替代**：
#    改成 `input keyboard text` 需要改设备侧注入，base 镜像不带；
#    逐字符 keyevent 注入既慢又会被 IME 吞键。已知不可消除，采集后建议 `adb shell am force-stop`。
#    本脚本能管住的是**落盘**那一半：登录窗口的截图一律走独占且用完即删的
#    `$OUT/.login.png`（见 `scrub_login_probe`），绝不与 `.nav.png` 共用。
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .env 在包根（本脚本在 packages/app-lynx/scripts/ 下）
PKG_ROOT="$(cd "$HERE/.." && pwd)"
ENV_FILE="$PKG_ROOT/.env"
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
OUT="${1:?用法: capture-md3-matrix.sh <输出目录>}"
PKG="io.pictelio.app"; ACT="$PKG/.LynxActivity"
# ⚠️ `ACT` 是**组件名的唯一来源**：`relaunch` 必须用 `"$ACT"` 而不是再写一遍
#    `"$PKG/.LynxActivity"`。早先 `relaunch` 硬编码了组件名而 `ACT` 只剩注释在用 ⇒
#    同一个事实两次书写，改包名/类名时漏一处就**静默起不来**（`am start` 报错被 `2>&1 >/dev/null`
#    吞掉，只表现为「进程起不来」）。已改为单一来源，由
#    `tests/captureScriptInvariants.test.ts` 钉住（把 `"$ACT"` 改回字面量即转红）。
REF_W=1080; REF_H=2160
# CUR_W/CUR_H 必须**在任何用到它们的常量表达式之前**就有值：`set -u` 下
# 「先算 MODE_X_LIGHT 再 reset_size」会直接 unbound variable 退出。
CUR_W=$REF_W; CUR_H=$REF_H
# 外观卡的 7 个色板圆心（由 detect_control 填）。`set -u` 下空数组下标会报
# unbound，所以先声明为空，用前一定由 detect_control 填满并校验过长度。
SW_X=()
mkdir -p "$OUT"

# ── D-6：坐标必须换算进 **app 内容区**，不是整屏 ──────────────────────
# ⚠️ 这里的换算原来按**整屏**做，于是 `tap 950 1885`（FAB）在 720×1280 上换算成
#    `(633,1117)`，而 FAB 真实 bbox 是 y 999–1105、中心 `(636,1052)` ⇒ 换算点落在
#    下沿**之外 12px**，点空、**画面零变化、不报错**。x 方向几乎无偏（633 vs 636）、
#    **只有 y 偏** ⇒ 正是竖直内边距的特征，不是标定漂移。
# 设备自己知道答案：`dumpsys window displays` 的 `mStable` 就是内容区
# （本机 `mStable=[0,48][720,1184]` ⇒ 状态栏 48、导航栏 96、内容区高 **1136**）。
# 按内容区换算：Y(1885) = 48 + 1885*1136/2160 = **1039**，落在 FAB 内 ⇒ 实测点得开。
# ⚠️ REF_W/REF_H 本来就是**按内容区**标定的（否则旧设备上的坐标不会落在控件上），
#    所以这是「补上一段被漏掉的换算」，不是「改标定」。
INSET_L=0; INSET_T=0; INSET_R=0; INSET_B=0
read_insets() {
  local s kind four l t r b
  # ⚠️ **两种 dumpsys 格式都要认**，本仓两台 AVD 各出一种（实测）：
  #   `mStable=[l,t][r,b]`        —— pictelio_low：是**内容区矩形**（要用 CUR_W/CUR_H 反算右边距）
  #   `nonDecorInsets=[l,t][r,b]` —— pictelio_ui：**就是 inset 本身**，直接用
  # 语义不同、字段名不同，只认一种就会在另一台上**读不到 → 降级 0 inset → D-6 原样复发**
  #（降级本身有告警，但告警只是噪音，坐标照样点空）。
  s="$($ADB shell dumpsys window displays 2>/dev/null \
        | grep -m1 -o -E '(mStable|nonDecorInsets)=\[[0-9]+,[0-9]+\]\[[0-9]+,[0-9]+\]' \
        | tr -d '\r')"
  if [ -z "$s" ]; then
    INSET_L=0; INSET_T=0; INSET_R=0; INSET_B=0
    echo "    ! dumpsys 里既无 mStable 也无 nonDecorInsets ⇒ 按整屏换算，坐标会偏（D-6 会复发）" >&2
    return 1
  fi
  kind="${s%%=*}"
  # ⚠️⚠️ 解析坑（真踩过）：直接 `tr -dc '0-9,'` 会把 `48]` + `[720` **粘成 48720** ——
  #    方括号被删掉，两段数字无缝相连，读出的 T=48720 比屏高还大。
  #    **先把方括号换成逗号**再取数字。
  four="$(printf '%s' "$s" | tr '[]' ',,' | tr -dc '0-9,\n' | tr ',' '\n' | grep -E '^[0-9]+$' | head -4 | tr '\n' ' ')"
  if [ "$(printf '%s' "$four" | wc -w | tr -d ' ')" -ne 4 ]; then
    INSET_L=0; INSET_T=0; INSET_R=0; INSET_B=0
    echo "    ! ${kind} 解析出 [${four}] 不足 4 个数 ⇒ 按整屏换算（D-6 会复发）" >&2
    return 1
  fi
  read -r l t r b <<< "$four"
  if [ "$kind" = "mStable" ]; then
    INSET_L=$l; INSET_T=$t; INSET_R=$(( CUR_W - r )); INSET_B=$(( CUR_H - b ))
  else
    INSET_L=$l; INSET_T=$t; INSET_R=$r; INSET_B=$b
  fi
  # ⚠️ 合理性校验：内容区必须是**正的且大于半屏**。`wm size` 刚改过时 dumpsys 可能
  #    还没跟上 ⇒ 拿着上一档的边距去换算（错的边距比没有边距更难查）；
  #    而 nonDecorInsets 那台若误当成矩形读，右边距会变成 CUR_W ⇒ 内容宽为 0。
  local cw=$(( CUR_W - INSET_L - INSET_R )) ch=$(( CUR_H - INSET_T - INSET_B ))
  if [ "$cw" -le $(( CUR_W / 2 )) ] || [ "$ch" -le $(( CUR_H / 2 )) ]; then
    echo "    ! ${kind} 推出的内容区 ${cw}x${ch} 不合理（屏 ${CUR_W}x${CUR_H}）⇒ 按整屏换算" >&2
    INSET_L=0; INSET_T=0; INSET_R=0; INSET_B=0
    return 1
  fi
  dbg "内边距(${kind}) L=${INSET_L} T=${INSET_T} R=${INSET_R} B=${INSET_B}（内容区 ${cw}x${ch}）"
  return 0
}

X() { echo $(( INSET_L + $1 * (CUR_W - INSET_L - INSET_R) / REF_W )); }
Y() { echo $(( INSET_T + $1 * (CUR_H - INSET_T - INSET_B) / REF_H )); }
tap()   { $ADB shell input tap "$(X $1)" "$(Y $2)"; sleep "${3:-1.4}"; }
# ⚠️ tap_abs 收**已经换算好的实际像素**（如检测器的输出），**不再过 X()/Y()**。
# 踩过的坑：把检测出的 cy=462 喂给 tap()，在 1080×2160 下 Y(462)=462 恰好恒等，
# 看起来一切正常；一换到 720×1280 就变成 Y(462)=274，偏了 188px ⇒ 点空 ⇒
# 「声称 dark、实测亮度 241」。**换算两次比不换算更难查**，因为它在一个分辨率下是对的。
tap_abs() { $ADB shell input tap "$1" "$2"; sleep "${3:-1.4}"; }
swipe() { $ADB shell input swipe "$(X $1)" "$(Y $2)" "$(X $3)" "$(Y $4)" "${5:-260}"; sleep 0.5; }
# swipe_abs 收**已经换算好的实际像素**（检测器量出来的修正量），不过 X()/Y()。
# 与 tap_abs 同一个理由：换算两次比不换算更难查 —— 在 1080 上恰好恒等，
# 一换到 720 就偏，两次都"看起来对"。
swipe_abs() { $ADB shell input swipe "$1" "$2" "$3" "$4" "${5:-300}"; sleep 0.7; }
back()  { $ADB shell input keyevent KEYCODE_BACK; sleep 0.9; }
luma()  { python3 "$HERE/png-luma.py" "$1" 2>/dev/null | awk '{print $1}'; }
# 内容区亮度标准差（排除状态栏、底部未渲染带、左右留白）。
# ⚠️ 必须**限定内容区**：整幅标准差会被页面底部那条未渲染暗带抬高 ——
# 实测那张空白 Feed 整幅 36.98，反而高于加载完成的暗色 Me（32.25），门禁被骗过去；
# 限定内容区后是 12.91 vs 20.88~93.73，干净分开。
content_sd() { python3 "$HERE/png-luma.py" --region=0.05,0.10,0.95,0.78 "$1" 2>/dev/null | awk '{print $2}'; }
# 实测（31 张合法截图，`probe()` Pillow 路径）：负样本空白页 12.91；
# 正样本下沿 **20.88**（`pg-dark-02-fab-expanded` —— FAB 展开态的 scrim 把整屏压成
# 一片均匀暗色，是**合法**样本不是「没内容」）。
# ⚠️ 早先这里写「加载完成的内容页最低 32.46，20 落在中间，两侧都有余量」——
# **两处都错**（S-4）：32.46 只在**屏宽轴那 12 张**上成立；而且余量极不对称——
# 距负样本 +7.09、距正样本下沿只有 **+0.88（4.4%）**。20 并非落在中间（几何中点 16.90）。
# 跨界条件：**改 MD3 scrim 的不透明度**就会动这条下沿。真掉到 20 以下要调的是阈值，
# 不是把那张样本从统计里剔掉。
MIN_CONTENT_SD=20
# FAB 区饱和度下限（见文件抬头）：负样本登录页 7.00；正样本 25.02~66.93。
# ⚠️ 本值原按 5.2.0 标定（Feed 下沿 25.02 / 登录页 7.00）。6.3.0 换成 MD3 淡蓝 FAB 后，
#    真机实测 Feed 降到 **14.16**、登录页 6.11（第二十五轮）⇒ 原值 20 会把**合法登录态**
#    判成「会话失效」。⚠️ 阈值**必须保持字面量**：可被环境覆盖就失去 oracle 溯源性
#    （`constOf` 会当场转红，这是对的）。重标定须基于**整批实测分布**（doc §8.6）。
MIN_FAB_SAT=10

# 截图是否「有内容」：内容区标准差达标。
has_content() { local sd; sd="$(content_sd "$1")"; [ -n "$sd" ] && awk "BEGIN{exit !($sd >= $MIN_CONTENT_SD)}"; }

# FAB 区平均饱和度（判据原文见文件抬头：登录页 7.00，app 内页面 25.02~66.93）。
fab_sat() { python3 "$HERE/png-luma.py" --region=0.80,0.84,0.96,0.94 "$1" 2>/dev/null | awk '{print $3}'; }
# 这张图**是不是 app 内的页面**（矩阵里每个页面都有 FAB），而不是登录页 / 冷启动骨架屏。
# 为什么对全矩阵通用而不只是 Feed：实测「我的」「插画」「小说」「搜索」「FAB 展开」
# 的 sat 分别是 66.9/66.4/65.9/66.4/66.2（暗）与 33.1/33.0/33.3/33.8/32.3（亮），
# 最低的 25.02 出现在某套亮色板 Feed 上 —— 与登录页的 7.00 差 3.5 倍。
# ⚠️⚠️ 这条判据**只问像素、不问进程**，所以**Android 桌面会蒙混过关**：
#    真机实测 FAB 区 sat —— 桌面 **60.96**、真实登录页 6.11、真实 Feed 33.18，
#    而 MIN_FAB_SAT=20 ⇒ 桌面的 60.96 **判定为「在 app 页」**（错）。
#    后果：app 没起来时，脚本一路静默，把桌面当成 app 页继续量。
#    修法：**先看系统给的权威信号**（前台组件 / 进程），再看像素。dumpsys 是精确的，
#    而从壁纸颜色反推「是不是 app」本质是启发式，再调阈值也补不齐。
# 页面身份探针：`app` = 1 走 **FAB 探针**（默认，绝大多数页面有 FAB）；`app` = `sheet` 走
# **弹层模式**。返回 0 = 可认证。
#
# ⚠️⚠️ 为什么必须有 sheet 模式（D-11）：搜索页是**底部弹层**，FAB 被弹层**完全遮住**
#   ⇒ FAB 区 sat 实测 **0.00**，比登录页的 6.11 **还低**。像素判据在这一页**原理上**
#   分不出「搜索弹层」与「登录页」——不是阈值没调好，是两个状态的像素**同形**。
#   已实测**证伪**两个「便宜替代」：① 顶带/内容区均值比：scrim 页 0.55/0.98 vs
#   无 scrim 0.09~8.26；② 顶带/弹层上沿窄条比：0.51/0.99 vs 0.09~8.26 —— **都重叠**。
#
# sheet 模式**保留**的门禁：进程存活 + 前台组件 + 内容区非空。
# ⚠️ **残留风险（如实登记，别当已解决）**：若会话恰在弹层打开期间失效并退回登录页，
#   这一页**没有像素判据**能发现（FAB 被遮、scrim 比值无分离）。缓解：preflight 已在
#   每轮开始时 `ensure_session`，且弹层只能从 Feed 的 FAB 菜单进入 —— 到达弹层这件事
#   本身就是「刚刚还在已登录 Feed 上」的弱证据。要彻底堵住需写**弹层专属正信号**探针
#   （标题/关闭按钮存在性），见研究文档 D-11 的补齐条件。
on_app_page() {
  local kind="$2" s
  app_alive || return 1
  app_foreground || return 1
  if [ "$kind" = "sheet" ]; then return 0; fi
  s="$(fab_sat "$1")"
  [ -n "$s" ] && awk "BEGIN{exit !($s >= $MIN_FAB_SAT)}"
}

# 顶栏中段 = app 自己的顶栏表面色，与页面内容无关 ⇒ 拿来判「这张图声称的明暗对不对」。
# ⚠️ **不能用整屏均值**：整屏被内容抬高，暗色插画 97.55 / 暗色搜索 105.26 都 >70，
# 用整屏会把「本来就该是暗色的图」判成错模式（假阳性）。
# 这两个常量定义在 probe_mode 处，但**内容页**这一路（resume_reason / 清单脚本）才用本带。
#
# ⚠️⚠️⚠️ 区域**第三十二轮**从「底部 7%」改成「顶栏中段」。原值不是「不够准」，是**量错了对象**：
#   底部 7%（y 0.93~1.00）在 Android 上整片是**系统导航栏**，不透明、颜色由**系统主题**决定，
#   与 app 主题**无关**。真机逐像素实测（emulator-5554 / 6.3.0 / 720×1280）：
#       底带像素 = (22,24,26) 随系统暗 / (232,232,232) 随系统亮
#       顶带像素 = (16,20,24) 随 app 暗   / (248,250,255) 随 app 亮
#   ⇒ 底带量的是「Android 系统明暗」，app 主题判据却挂了系统的车。
#     app 默认 `darkMode=system`（跟随系统）时两者**恒等**，缺陷完全隐形 ——
#     这正是它能活到今天的原因，也意味着**只有手动把 app 与系统设成相反**才会暴露。
#
# 复现与 2×2 实测（Feed 页 / 「我的」页各一份；「我的」= `probe_mode` 实际量的页，见下）：
#   ┌──────────────┬───────────────┬───────────────┐
#   │ 区域          │ app 暗         │ app 亮         │
#   ├──────────────┼───────────────┼───────────────┤
#   │ 底带 .93-1.00 │ 31.20 / 227.66 │ 140.82 / 249.88│ ← 括号内 = 系统暗 / 系统亮
#   │ 上移带 .85-.93│ 20.16 / 32.39  │ 180.16 / 188.87│
#   │ **顶带 .02-.09** │ **19.00 / 19.00** │ **250.00 / 250.00** │
#   └──────────────┴───────────────┴───────────────┘
#   （「我的」页底带 app 暗两格为 32.97 / **228.01**；上移带为 85.63 / **95.93**）
#
#   · **顶带四格全对**（均值不受系统主题影响）。⚠️ **不是纯色表面**：带内含状态栏
#     图标，实测 sd 3.86~18.25，**无一为 0.00** —— 「纯表面色」只对**均值**成立。
#   · 底带在 app 与系统不一致时**静默判错**（227.66 / 228.01 ⇒ 暗色被判成「亮」）。
#   · **上移带不是解**：它在 Feed 上看着干净（20.16/32.39），但「我的」页暗色两格
#     落在 85.63 / 95.93，**掉进死区** ⇒ 两边都判不出来。
#     「一张图外推全体」的教训在这里又应验了一次。
#
# ⚠️⚠️ 顶带的代价：FAB 展开态的 scrim 是**全窗口均匀 50% 黑**，**app 窗口内无一处豁免**。
#   实测比值处处 0.50（y=30 的 251.0→125.7、y=60 的 20.0→10.0），只有 y≥1136 那 4px
#   窗口外区域不被压暗 —— 而它紧贴系统导航栏（上沿 1184），跨分辨率必然漂回导航栏，
#   **不能用**。⇒ 能同时满足「跟 app 主题」「不被 scrim 压」的区域**不存在**，
#   只能让**阈值**容纳减半：这是本轮把 LIGHT_MIN 从 140 降到 100 的唯一理由。
#   （早先「顶栏也能分开」的说法只看了 Feed，没算 scrim；那张 124.76 的反例是 5.2.0 旧批。）
#
# 阈值依据（**37 张真实截图**，非合成 fixture；含 feed/fab-expanded/me/illus/novel/search
# 全部页型 × 720/1080/1440 三种屏宽 × 7 个色板 × 5.2.0 与 6.3.0 两个版本）：
#   暗色 **10.00 ~ 20.74**（⚠️ 20.74 出自 `p-pal2-dark-feed.png`（1080×2160，色板轴），
#   **不是** 720 宽的 `w-720x1280-dark-feed.png`＝20.68 —— 差一位数字，归属写错会
#   让人以为 720 宽更危险；10.00/10.77/10.77 = FAB 展开与搜索弹层被 scrim 减半）
#   亮色 **124.76 ~ 249.78**（124.76/125.00 = FAB 展开被 scrim 减半）
#   ⇒ 空档 **[20.74, 124.76]**，宽 104.02。scrim 系数实测恒为 0.5000（两版本各一次）。
#   DARK_MAX=70 距暗色上沿 49.26（**保持原值不变**，暗侧 17 张已有防线，不冒险动它）；
#   LIGHT_MIN=100 距亮色下沿 24.76（= scrim 后亮色的 20% 余量，scrim 是确定性渲染故稳定）。
#   ⚠️ 70~100 是**故意留的死区**：落在里面 = 「判不出明暗」，属可疑而非放行。
#
# 为什么顶带**结构上**可靠（不是碰巧）：app 走 edge-to-edge，**状态栏是透明叠加**，
# 状态栏与顶栏**底色**相同（系统栏透明，透出 app 表面）⇒ 整段读的都是 app 自己的
# 表面色，不含任何系统涂装。底带相反，系统栏有**自己的不透明底色**。
# ⚠️ 这一条**静默判错、不报错**，正是本项目要消灭的那类假警报。
MODE_BAND=0.20,0.02,0.80,0.09
band_luma() { python3 "$HERE/png-luma.py" --region=$MODE_BAND "$1" 2>/dev/null | awk '{print $1}'; }
# 截图名里**声称**的明暗；名字不含明暗（如恢复默认段）时返回 1 = 不判。
claim_mode() { case "$1" in *-light-*) echo light ;; *-dark-*) echo dark ;; *) return 1 ;; esac; }

# ── 检测器调用的四态退出码分流 ──────────────────────────────────────
# 0=找到 1=NOTFOUND（画面里确实没有这个东西）2=用法错 3=输入不可读（截图 0 字节 /
# adb 拉失败 / 截断；`--selected` 下「判据失效」也归这一档）。
# ⚠️ 1 与 3 **不能混为一谈**：1 说「页面布局变了，去调判据」，3 说「截图/采集坏了，
# 去查 adb 与本轮产物」。早先把两者都 `2>/dev/null` 掉，于是 `adb 断连留下 0 字节文件`
# 会被报成「找不到控件」，把人引向错误方向查了 3 轮（违反测试硬约束 #3 禁静默降级）。
DET_OUT=""; DET_RC=0; DET_ERRF=""

# ── 登录窗口的暂存截图（**含明文 token，用完即删**）──────────────────
# ⚠️ 为什么必须独占一个文件：`Login.vue` 的 token `<input>` **没有 type="password"**
#    —— 是明文输入框。而重新定位「登录」按钮**必须**在收键盘后再截一次图
#    （收键盘后布局重新居中、按钮下移），那张图里 token 就在屏幕上。
#    早先它写的是 `$OUT/.nav.png` —— 一个被 luma_now() / FAB 探针轮流覆写的共享文件：
#    登录后只要有任何一次导航盖掉它，token 就没了 ⇒ **当前没泄漏纯属侥幸**；
#    而一旦 do_login 之后紧接一次失败退出，明文 token 就留在盘上，
#    而 FAB 诊断提示恰恰在引导人去打开 `.nav.png`。
#    refresh_token 是长期凭据，泄漏等于交出账号的 API 访问权。
LOGIN_PROBE=""
# 清掉登录窗口的截图。`rm -f` 对不存在的路径也返回 0，所以可以无条件调。
scrub_login_probe() { [ -n "$LOGIN_PROBE" ] && rm -f -- "$LOGIN_PROBE"; return 0; }
# 兜底：显式清理覆盖不了「被信号 / 意外退出打断」这条路。
trap 'scrub_login_probe' EXIT
trap 'scrub_login_probe; exit 130' INT
trap 'scrub_login_probe; exit 143' TERM

# det <脚本名> <参数...>：stdout 进 DET_OUT、退出码进 DET_RC、stderr 落临时文件。
# 成功路径上 stderr 依旧是「静默」的（它只是被存起来，不打印），
# 失败时才把检测器自己写的 `输入不可读 <path> / 原因：…` 原样还给使用者 ——
# 那几行字是该脚本留给人的**唯一**诊断线索。
det() {
  DET_ERRF="$OUT/.det.err"
  DET_OUT="$(python3 "$HERE/$1" "${@:2}" 2>"$DET_ERRF")"
  DET_RC=$?
  return $DET_RC
}
# 按退出码把失败**如实分类**再报出去（不许只说「找不到」）。
det_report() {
  local what="$1" why
  why="$(tail -1 "$DET_ERRF" 2>/dev/null)"
  if [ "$DET_RC" -eq 3 ]; then
    echo "    ✗ ${what}：**截图/采集链路坏了**（检测器 rc=3，不是「页面上没有这个东西」）" >&2
    [ -n "$why" ] && echo "      原因：${why}" >&2
    echo "      处理：确认 adb 连接与截图完整性，删掉本轮产物后重跑；不要去调判据阈值。" >&2
  else
    echo "    ✗ ${what}（检测器 rc=${DET_RC}，画面里确实没有这个东西）" >&2
    [ -n "$why" ] && echo "      原因：${why}" >&2
  fi
}

RESUME_WHY=""
# 已存在的截图能不能**直接续采**？返回 0 = 可跳过；返回 1 时 RESUME_WHY 写明原因。
#
# ⚠️ 为什么不能只验「有内容」：跳过判据原本只有「合法 PNG + 内容区非空」，
# 于是上一轮留下的**坏证据**会被逐张固化，而末位 `GOT != EXPECT` 只数张数
# ⇒ 照样打印「完成，产物在 …：32 张」。这正是本仓在消灭的假绿。
# 文档 §5.0 记的 3 例要**分开看**（本轮实测复核）：
#   · `w-1440x2560-light-feed` 内容区 sd 12.5（空白页）—— 真·坏图，已被重拍；
#   · `w-1080x2160-dark-feed` / `w-1440x2560-dark-feed` 记「整屏亮度 94.0 / 109.9 >70」
#     ⇒ 看着像错模式，但**整屏亮度对内容重的页面本就无效**（见 MODE_BAND 处注释）：
#     亲看这两张是**正确的暗色 Feed**（一张插画铺满全屏），底带亮度 24.12 / 23.42 < 70。
#     所以它们不该被判成错模式、也不该被反复重拍 —— 这正是不能用整屏均值的实证。
resume_reason() {
  # ⚠️ $3 = 身份探针模式（app / sheet），**必须透传**给 on_app_page：
  #    漏传时弹层页续采会被 FAB 探针判「不是 app 页」⇒ 每次重跑都重拍那一张。
  local f="$1" name="$2" kind="${3:-app}" want l
  RESUME_WHY=""
  # ① 身份：停在登录页/未加载的图，上一轮存它时就是**假成功**。
  if ! on_app_page "$f" "$kind"; then
    if [ "$kind" = "sheet" ]; then
      RESUME_WHY="系统信号未确认（进程/前台组件；弹层页没有 FAB 可探，见 on_app_page 的 sheet 模式）"
      return 1
    fi
    # ⚠️ 本函数下面的 ②（band_luma）**一直**做了「探针无输出」分流，① 却没做（第七轮 Spec 轴查出）。
    #    「读不出来」与「不是 app 页面」是两回事：照字面印 sat=<20 会把人引去查登录页/FAB 颜色，
    #    而真因是截图根本读不到。措辞分流不需要真机，与 shot() 里的分流保持同形。
    _fs2="$(fab_sat "$f")"
    if [ -z "$_fs2" ]; then
      RESUME_WHY="FAB 区探针无输出（截图读不出来；与「不是 app 页面」是两回事，别去调判据阈值）"
    else
      RESUME_WHY="停留在登录页或未加载（FAB 区 sat=${_fs2} < ${MIN_FAB_SAT}）"
    fi
    return 1
  fi
  # ② 明暗：与文件名声称的一致？（探针无输出也算不一致 —— 那说明这张图读不出来）
  if want="$(claim_mode "$name")"; then
    l="$(band_luma "$f")"
    if [ -z "$l" ]; then
      RESUME_WHY="底带亮度探针无输出（截图读不出来）"; return 1
    elif [ "$want" = dark ] && awk "BEGIN{exit !($l < $DARK_MAX)}"; then : # 一致
    elif [ "$want" = light ] && awk "BEGIN{exit !($l > $LIGHT_MIN)}"; then : # 一致
    else
      RESUME_WHY="声称 ${want} 但实测底带亮度 ${l}（明暗门禁 <${DARK_MAX} / >${LIGHT_MIN}）"
      return 1
    fi
  fi
  # ③ 色板：**离线验不了，只能重拍**。png-luma.py 只给 mean/sd/sat，读不出色相，
  # 而 FAB 区饱和度在色板之间**互相重叠**（本轮实测：pal0 33.18/66.39、
  # pal1 25.02/37.30、pal5 57.65/55.20 —— pal0 的区间盖住了另外两套），
  # 所以任何「按饱和度判色板」的分类器都建不起来：它要靠的正是那批 n=2 的自洽样本，
  # 违反「期望值必须溯源」。`set_palette` 的 `--selected` 回读只能验**设备当前态**，
  # 验不了磁盘上这张**过去**的图。8 张重拍的代价（约 8×6s）远小于固化错证据。
  case "$name" in p-pal*) RESUME_WHY="色板身份无法从 Feed 截图离线回读，重拍以免固化错色板"; return 1 ;; esac
  return 0
}

# ── D-7：撕裂帧检测（切主题后未 repaint）─────────────────────────────
# 真机实测：切暗色后导航到 Feed 立刻截图，y<92（状态栏）已是新主题 `(16,20,24)`、
# y>92（app 内容）仍是旧主题 `(248,250,255)` —— **两者相反**，而截图不报错。
# 判据用**顶栏中段的 sd**：状态栏与顶栏两色并存 ⇒ sd 暴涨。
#
# ⚠️⚠️⚠️ 阈值取 **40**，而**不是**「稳定态 sd=0 ⇒ 随便取个 20」。
#   早先的注释写「37 张稳定帧 sd 全 0.00」——**那是旧批的数字，且是错的**：
#   本带 (y 0.02~0.09) **包含状态栏图标**，图标与顶栏底色构成局部对比 ⇒ 暗色页 sd
#   系统性偏高。32 张 6.3.0 实测的真实分布：
#       亮色页  3.86 ~ **11.59**（上沿 w-720x1280-light-*：density 320 下图标相对最大）
#       暗色页  **8.37** ~ **18.25**（下沿 w-1440x2560-dark-*，上沿 w-720x1280-dark-*）
#       撕裂帧（n=2，两种模式同值） **94.27**
#   ⇒ 真实空档 [18.25, 94.27]。40 是这个空档的**几何中点**（√(18.25×94.27)=41.5）附近取整，
#     两侧余量 **21.75 / 54.27**；若沿用 20，下侧余量只剩 **1.75** —— 换台设备、
#     状态栏图标稍大一点就会把**合法页**判成撕裂。
# ⚠️ 撕裂侧只有 n=2（两种模式各一，值相同）—— 但「部分撕裂会不会漏检」**不再是无数据的
#   未知**，可以解析求解：撕裂的本质是「状态栏(新主题) 与 app 顶栏(旧主题) 两色混合」，
#   两值总体 sd = |a-b|·sqrt(p(1-p))，a/b 取两套主题的表面色（实测 248.53 / 19.00，
#   |a-b| = 229.53）⇒ **sd 降到 40（=MAX_BAND_SD）时 p = 3.14%**。
#   顶带在 1080×2160 下约 163,296 px ⇒ 漏检需撕裂**完全落在** ~5,120 px 内（≈71×71 的小块）。
#   换句话说：**撕裂面积占顶带 ≥3.1% 必被抓住**；低于此值只剩一条几像素宽的色缝，
#   视觉上已不构成「撕裂」。这是按**对比度**算的，比「多抓几张样本」更严谨 ——
#   它对任何符合该失效形态的撕裂都成立，不依赖具体抓到哪几张。
#   ⚠️ 残留：若撕裂是**别的形态**（例如两色对比更小），下限会更高。本轮只对
#   「两套主题表面色互串」这一实测形态给了数。
MAX_BAND_SD=40
band_sd() { python3 "$HERE/png-luma.py" --region=$MODE_BAND "$1" 2>/dev/null | awk '{print $2}'; }
# ⚠️⚠️ **三态返回**（二轮复核 F2）：0=稳定 1=撕裂 2=**探针读不出来**。
#    早先只有「过/不过」，而 `band_sd` 对坏图（0 字节 / 只有 magic / 截断）返回**空串**
#    ⇒ `awk` 拿空值比较 ⇒ 落到「撕裂」⇒ 报「顶栏 sd= > 40，切主题未 repaint」——
#    **根因指错**（真因是截图截空 / adb 断连，属采集链路），消息本身还自相矛盾（sd= 为空）。
#    这正是本仓反复记载的「探针无输出 vs 判据不达标」同形病；`shot()` 在 FAB/内容两条
#    探针上**早就**做了这个分流，唯独这条新路径漏了。
frame_settled() {
  local sd; sd="$(band_sd "$1")"
  [ -z "$sd" ] && return 2
  awk "BEGIN{exit !($sd <= $MAX_BAND_SD)}"
}

# PNG 实际像素尺寸（读 IHDR，不依赖 Pillow）。PNG 第 16..23 字节是宽高（big-endian）。
# ⚠️ `NF>=8 … exit` 两个条件都要：`od` 可能吐出续行，awk 对空行会算出 `0x0`
#    并**追加**到输出后面 —— 于是 `got` 变成两行，字符串比较恒不相等 ⇒ 守卫变成
#    「每张都中止」。这正是「探针多输出一行 ⇒ 判据全废」的同族坑。
png_size() { od -An -tu1 -j16 -N8 "$1" 2>/dev/null | awk 'NF>=8 { w=$1*16777216+$2*65536+$3*256+$4; h=$5*16777216+$6*65536+$7*256+$8; print w"x"h; exit }'; }

# ⚠️⚠️ 尺寸守卫：**存盘前**验「这张图的像素尺寸 == 本档声明的屏尺寸」。
# 起因（真机实测，AVD `pictelio_low`）：`wm size 1080x2160` 之后
#   `wm size` 报 `Override size: 1080x2160`、`dumpsys window displays` 的
#   `DisplayFrames w=1080 h=2160`、`mStable=[0,72][1080,2016]` —— 显示**确实**改了，
#   点击坐标也按新尺寸正确落点（实测 FAB 点得开）；
#   但 `adb exec-out screencap` **恒返回物理分辨率 720×1280**（重启后依旧如此）。
# ⇒ 脚本会「一切正常」地跑完屏宽轴，产出 12 张**名为 `w-1080x2160-*` 实为 720×1280**
#   的图，末位 `GOT != EXPECT` 只数张数照样报「完成，32 张」。
#   **这正是本仓在消灭的假绿**：证据的**文件名**与**内容**不是一回事。
# ⚠️ 所以守卫必须**在存盘这一侧**（而不是事后统计），且两条路径都要查：
#   重拍后查一次、续采读旧文件时再查一次 —— 旧文件重拍也不会变对（环境问题）。
dim_guard() {
  local name="$1" f="$2" got
  got="$(png_size "$f")"
  [ "$got" = "${CUR_W}x${CUR_H}" ] && return 0
  cat >&2 <<EOF
    ✗ ${name} 实得 ${got}，本档声明 ${CUR_W}x${CUR_H} —— 中止
      典型成因：\`wm size\` 覆盖只改了显示，\`screencap\` 仍按**物理**分辨率出图
      （本仓 AVD \`pictelio_low\` 实测如此，重启无效）。
      **不要改文件名凑数** —— 那会把 720 的证据标成 1440，正是「名字对、内容错」。
      处理：换一台 screencap 能跟随覆盖的设备/AVD；或本档降级为物理分辨率并改口径。
EOF
  exit 1
}

shot() {
  local f="$OUT/$1.png" want_content="${3:-1}" kind="${4:-app}" try why=""
  # ── 断点续采：已存在也要验**身份**，不能只验「有内容」（理由见 resume_reason）──
  # 两条都判：只判「是合法 PNG」会把上一轮留下的空白页当成功 ——
  # 实测 1440 宽那张 Feed 只有标题和 FAB，是合法 PNG 却没有任何内容。
  if [ -s "$f" ] && [ "$(head -c 4 "$f" | od -An -tx1 | tr -d ' \n')" = "89504e47" ]; then
    # ⚠️ 续采路径**同样**要过尺寸守卫：旧文件尺寸不对时，重拍也不会变对
    #    （成因在环境/设备，不在截图动作），让「重拍 3 次」白等 3×2s 再失败。
    dim_guard "$1" "$f"
    # ⚠️⚠️ 续采路径**也**必须过撕裂检测（独立复核「重要 3」）。这条原先漏了，而
    #    §8.8 记录的现状恰恰是「已完成 32/32」——**最可能的调用方式就是对同一 OUT 目录
    #    重跑**，此时全部走下面的 `resume_reason` 跳过 ⇒ `frame_settled` 一次都不执行
    #    ⇒ 任何留在盘上的撕裂帧（本改动之前拍的、或中途失败留下的）会被**直接采信**。
    #    `dim_guard` 当初特意在两条路径都调了，`frame_settled` 没跟上 —— 同一个洞。
    #    这里用**中止**而非重拍：盘上的旧图不会因为重拍而变好（它就是那张图）。
    _fsd="$(frame_settled "$f")"
    if [ "$_fsd" = "2" ]; then
      echo "    ✗ ${1} 的顶栏探针**无输出**（截图读不出来）—— 中止" >&2
      echo "      这与「撕裂」是**两回事**：真因是截图截空/截断/adb 断连（采集链路），" >&2
      echo "      **别去查 D-7 的 repaint 时序、也别调 MAX_BAND_SD**。" >&2
      echo "      处理：确认 adb 连接与文件完整性，删掉该文件重采。" >&2
      exit 1
    elif [ "$_fsd" = "1" ]; then
      echo "    ✗ ${1} 已存在但顶栏 sd=$(band_sd "$f") > ${MAX_BAND_SD}（撕裂帧）—— 中止" >&2
      echo "      续采路径不做重拍：这张图**就是**那张图，重拍不会让它变好。" >&2
      echo "      处理：删掉该文件重采，或先确认 D-7 的 repaint 时序。" >&2
      exit 1
    fi
    if [ "$want_content" = "0" ] || has_content "$f"; then
      if resume_reason "$f" "$1" "$kind"; then
        echo "    · ${1}（已存在，跳过）"
        return 0
      fi
      why="$RESUME_WHY"
    else
      # ⚠️ 断点续采这条路径与 shot() 的重拍分支是**同一段逻辑的两份拷贝**，
      #    上一轮只改了后者、漏了这里（第七轮 Spec 轴查出）。措辞分流不需要真机。
      _cs2="$(content_sd "$f")"
      if [ -z "$_cs2" ]; then
        why="内容区探针无输出（截图读不出来；与「内容为空」是两回事）"
      else
        why="内容区为空（stddev ${_cs2} < ${MIN_CONTENT_SD}）"
      fi
    fi
    echo "    ! ${1} 已存在但${why}，重拍" >&2
  fi
  for try in 1 2 3; do
    sleep "${2:-1.5}"
    # 有效性自检必须在打「✓」之前：shell 重定向先建空文件再执行命令，
    # adb 断连时会留下一批 0 字节文件，而 echo 与退出码照样正常。
    $ADB exec-out screencap -p > "$f"
    if [ ! -s "$f" ] || [ "$(head -c 4 "$f" | od -An -tx1 | tr -d ' \n')" != "89504e47" ]; then
      echo "    ✗ ${1} 截图无效（$(wc -c < "$f" | tr -d ' ') 字节）—— 中止" >&2
      exit 1
    fi
    # ⚠️ 尺寸守卫放在**存盘后、身份门禁前**：它比「是不是 app 页」更基础 ——
    # 尺寸不对时，后面所有像素判据量的都是**降采样后**的图，结论一律无效。
    dim_guard "$1" "$f"
    # ⚠️ D-7：撕裂帧**不算**这一张。重拍有可能拿到已 repaint 的帧，所以走重试而不是中止；
    # 但 3 次都撕裂就中止 —— 继续拍只会攒一整批「名字对、内容错」的证据。
    _fsd="$(frame_settled "$f")"
    if [ "$_fsd" = "2" ]; then
      why="顶栏探针无输出（截图读不出来；与「撕裂」是两回事，别去调判据阈值）"
      echo "    ! 第 ${try} 次${why} —— 检查 adb 与截图完整性" >&2
      continue
    elif [ "$_fsd" = "1" ]; then
      why="顶栏 sd > ${MAX_BAND_SD}（画面撕裂：切主题后 app 未 repaint）"
      echo "    ! 第 ${try} 次顶栏 sd=$(band_sd "$f") > ${MAX_BAND_SD} ⇒ 画面撕裂（切主题未 repaint），重拍" >&2
      continue
    fi
    # ── 身份门禁（**后置**：见文件抬头「判据必须后置」的真实事故）──
    # 内容达标不等于「这是要拍的那个页面」：会话在采集途中失效时拍到的是登录页，
    # 而登录页的内容区 sd 实测 40.96，稳稳越过 MIN_CONTENT_SD ⇒ 只判内容会存下
    # 一张「名字对、内容错」的证据并计入成功数。这里用同一条 FAB 判据立刻验。
    if ! on_app_page "$f" "$kind"; then
      # ⚠️ 「探针读不出来」与「真的不是 app 页面」是**两件事**（六轮 Spec 轴查出）。
      #    `on_app_page` 把两者都收敛成「false」，若照字面印 "sat= < 20"，
      #    人会去查「登录页/FAB 颜色」，而真因是**截图根本读不出来**（adb 断连、
      #    文件被截断）—— 这正是本脚本 :174-178 记的老病的同一形状。
      #    只改**措辞**、不改控制流（下面的分支与退出码完全不变）。
      # ⚠️⚠️ sheet 模式**不能**走这条措辞：弹层页 FAB 本就被遮住，印「拍到的是登录页」
      #    是**误导**（D-11 实测：搜索页 FAB 区 sat=0.00，比登录页 6.11 还低，
      #    但页面完全正常）。sheet 模式只报系统信号，措辞必须与实际检查一致。
      if [ "$kind" = "sheet" ]; then
        why="系统信号未确认（进程/前台组件，见 on_app_page 的 sheet 模式说明）"
      else
        _fs="$(fab_sat "$f")"
        if [ -z "$_fs" ]; then
          why="FAB 区探针无输出（截图读不出来；与「不是 app 页面」是两回事，别去调判据阈值）"
        else
          why="拍到的是登录页或未加载（FAB 区 sat=${_fs} < ${MIN_FAB_SAT}）"
        fi
      fi
      echo "    ! ${1} ${why}，第 ${try} 次重拍" >&2
      continue
    fi
    if [ "$want_content" = "0" ] || has_content "$f"; then
      if [ "$kind" = "sheet" ]; then
      # ⚠️ 不报 FAB sat：弹层页该值必然 ≈0，报出来会被误读成「探针坏了」
      echo "    ✓ ${1}（内容区 stddev $(content_sd "$f")，弹层页：身份由进程/前台组件确认）"
      return 0
    fi
    echo "    ✓ ${1}（内容区 stddev $(content_sd "$f")，FAB 区 sat $(fab_sat "$f")）"
      return 0
    fi
    _cs="$(content_sd "$f")"
    if [ -z "$_cs" ]; then
      why="内容区探针无输出（截图读不出来；与「内容为空」是两回事）"
    else
      why="内容区为空（stddev ${_cs} < ${MIN_CONTENT_SD}）"
    fi
    echo "    ! ${1} ${why}，第 ${try} 次重拍" >&2
  done
  echo "    ✗ ${1} 连拍 3 次都不合格（${why}）—— 中止（登录页/空白页会冒充视觉证据）" >&2
  echo "      若原因是会话失效：直接重跑本脚本即可 —— preflight 会重新登录，" >&2
  echo "      已采到的合格截图会被续采跳过，不必从头再来。" >&2
  exit 1
}

# 改完分辨率**必须重启 app**，否则坐标系与渲染尺寸不一致。
# 实测踩过：`wm size` 生效了、系统也发了配置变更，但 Lynx 侧不一定立刻重排 ——
# 此时脚本已按新尺寸算坐标，app 还按旧尺寸渲染 ⇒ 点击落在屏幕外 ⇒
# FAB 展开的亮度**一格没动**（244.28 → 244.28，两张同一个图）⇒ 导航静默失败。
# 症状极具欺骗性：后面一路报「找不到控件」，真因却在上一步的尺寸。
# ⚠️ 屏宽同样不能假设等于 REF：AVD `pictelio_low` 原生是 **720×1280**，
#    而 `reset_size` 原来硬写 `CUR_W=$REF_W`（1080×2160）⇒ 复位后 CUR_* 与真实屏幕
#    对不上，**每一次换算都是错的**。同属 D-6 家族（拿「标定时的屏」当「现在的屏」）。
#    `wm size` 在有覆盖时**两行并存**，有效的是 `Override size` 那行 ⇒ 优先取它。
read_size() {
  local want="${1:-}" ovr phys s
  # ⚠️⚠️ **声明值必须与回读值比对**（一轮复核「重要 2」）：`wm size <w>x<h>` 可能
  #    **被拒或未生效**（此时输出里没有 `Override size` 行）⇒ 下面会回落
  #    `Physical size`。若不比对，`CUR` 就等于物理尺寸，`dim_guard` 比的也是它 ⇒
  #    截图 720×1280 == CUR ⇒ **放行** ⇒ 落盘成 `w-1440x2560-*.png`。
  #    **这与 D-8 记的失败形态（名字 1080、实为 720）完全同形**，守卫却形同虚设。
  ovr="$($ADB shell wm size 2>/dev/null | grep -m1 -o 'Override size: *[0-9]*x[0-9]*' | grep -o '[0-9]*x[0-9]*' | tr -d '\r')"
  phys="$($ADB shell wm size 2>/dev/null | grep -m1 -o 'Physical size: *[0-9]*x[0-9]*' | grep -o '[0-9]*x[0-9]*' | tr -d '\r')"
  if [ -z "$ovr" ] && [ -z "$phys" ]; then
    echo "    ✗ 读不到当前屏幕尺寸（wm size 无 Physical/Override 行）—— 中止，别拿猜的尺寸去点" >&2
    exit 1
  fi
  if [ "$want" = "reset" ]; then
    # ⚠️⚠️ `reset` 的正确后置条件不是「豁免比对」，而是「**覆盖必须已消失**」（二轮复核 F4）。
    #    早先直接豁免：`wm size reset` 未生效时 Override 仍在 ⇒ `CUR_*` 变成**陈旧 override**
    #    ⇒ `dim_guard` 拿它当声明值比对 ⇒ **重新失效**。那正是 D-8 唯一的防线，
    #    而修复「声明 vs 回读」的那一步在 reset 路径上把它又打开了。
    if [ -n "$ovr" ]; then
      echo "    ✗ 已要求 wm size reset，但 Override 仍是 ${ovr}（reset 被拒或未生效）—— 中止" >&2
      echo "      不中止的后果：CUR_* 变成陈旧 override，dim_guard 拿它当声明值 ⇒ 又变回假绿。" >&2
      exit 1
    fi
    s="$phys"
  else
    s="${ovr:-$phys}"
    if [ -n "$want" ] && [ "$s" != "$want" ]; then
      echo "    ✗ 已要求屏幕为 ${want}，实际回读为 ${s}（wm size 被拒或未生效？）—— 中止" >&2
      echo "      不中止的后果：dim_guard 比的也是回读值 ⇒ 720 的图会被存成 ${want}，" >&2
      echo "      **正是 D-8「名字对、内容错」那类假绿**。" >&2
      exit 1
    fi
  fi
  CUR_W="${s%%x*}"; CUR_H="${s##*x}"
  read_insets
  dbg "屏 ${CUR_W}x${CUR_H}（声明 ${want:-物理}）"
}

set_size() { $ADB shell wm size "$1"; $ADB shell wm density "$2"; sleep 2; relaunch; read_size "$1"; }
reset_size() { $ADB shell wm size reset; $ADB shell wm density reset; sleep 2; relaunch; read_size reset; }
# 导航前先确认会话有效 —— **但只在重启边界检查**。
#
# ⚠️ 为什么不是每次 `go_tab` 都查（第一版就是这么写的，结果自己把自己搞挂了）：
# 判据用的是「FAB 区饱和度」，而那片区域**只有在 Feed 上才有固定语义**。
# 页内正常态同样能落在阈值下方：实测「我的」页带 scrim 时 sat=13.81（阈值 20），
# 于是脚本判定「掉登录」→ 去登录页找按钮 → 当前根本不是登录页 → `--wide-solid NOTFOUND`
# → 整轮中止。**假阳性比漏检更贵**，因为它会主动做破坏性的事。
#
# 证据支持只在重启边界查：实测 app 静置 102 秒**不会**自己掉线（FAB 区 sat 恒为 28.02），
# 观察到的掉线全部发生在脚本自己的 `am force-stop` 之后。
SESSION_DIRTY=0
# 进程是否真的活着 + 前台是不是我们 —— 这两个信号**比像素判据可靠得多**。
# 起因：真机实测 `am start -n <component>` 被拒（LynxActivity 不 exported，logcat 明确写了
# `Permission Denial: … not exported`），而旧写法 `>/dev/null 2>&1` 把拒绝**吞掉了**，
# 于是脚本以为重启成功、实际停在**桌面**，一路静默走到 FAB 响应测试才炸。
app_alive()    { [ -n "$($ADB shell pidof $PKG 2>/dev/null | tr -d '\r')" ]; }
app_foreground() { $ADB shell dumpsys window 2>/dev/null | grep -q "mCurrentFocus=.*$PKG"; }

relaunch() {
  $ADB shell am force-stop $PKG; sleep 1
  # ⚠️ 启动方式按「最不依赖镜像特性」排序，任一奏效即止：
  #   ① `am start -a MAIN -c LAUNCHER -n <组件>` —— 带 LAUNCHER 意图，系统按 launcher
  #      路径放行。**这正是 D-1 的正解**：裸 `am start -n $ACT` 因 activity 未 exported
  #      每次都被拒（pidof 恒空），而补上 MAIN+LAUNCHER 后同一个组件就能起来
  #      （pictelio_ui 实测：形式① pidof 空、形式② pid 5117）。
  #   ② monkey —— D-1 当年的修法，但它**依赖镜像**：pictelio_ui 上稳定 rc=251、
  #      进程始终不出现（pictelio_low 上正常）。留着当回退，不当主力。
  #   ③ 都没有 ⇒ 明确中止（**不静默**，D-1 的教训：失败被 `2>&1 >/dev/null` 吞掉时
  #      脚本一路量桌面，还报「完成」）。
  local i
  for i in 1 2; do
    if [ "$i" = 1 ]; then
      $ADB shell am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n "$ACT" >/dev/null 2>&1
    else
      $ADB shell monkey -p $PKG -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
    fi
    sleep "${1:-9}"
    app_alive && { SESSION_DIRTY=1; return 0; }
    echo "    · 启动方式 $i 未拉起进程，换下一种" >&2
  done
  echo "    ✗ relaunch 后 $PKG 进程不存在（am start 与 monkey 都失败）—— 中止，不要继续量桌面" >&2
  return 1
}

# 导航期探针：只写 .nav.png，**不碰登录窗口**（登录窗口走独占的 .login.png）。
# 因此 .nav.png 可证明不含 refresh_token —— 诊断提示可以放心让使用者打开它。
luma_now() { $ADB exec-out screencap -p > "$OUT/.nav.png"; luma "$OUT/.nav.png"; }

# 数值比较：$1 是否比 $2 小 $3 以上
lower_by() { awk "BEGIN{exit !($1 < $2 - $3)}"; }

# ── 预检：app 必须真的停在 Feed（有 FAB），而不是登录页 / 冷启动未完成 ──
# 见文件抬头「判据统一走两个 oracle」下方的实测数据。
# 用饱和度而非亮度：登录页与亮色 Feed 的亮度实测只差 0.02，判据同形失效。
# 重试是因为冷启动要 9~15s 才渲染出 FAB，第一次量到骨架屏不算失败。
preflight() {
  local try
  for try in 1 2 3; do
    relaunch
    sleep 4
    # 复用 ensure_session：它既量又自愈。`pm clear`/首次安装后 app 必然在登录页，
    # 没有这一层预检就会在轴 0 第一步就中止，整轮白跑。
    if ensure_session; then
      echo "    ✓ 预检通过（app 在 Feed 上）"
      SESSION_DIRTY=0
      return 0
    fi
    echo "    ! 预检第 ${try} 次未通过，重试" >&2
  done
  echo "    ✗ 预检连续 3 次失败：app 始终不在 Feed 上 —— 停在登录页或 token 失效。" >&2
  echo "      请用 packages/app-lynx/.env 的 PIXIV_REFRESH_TOKEN 重新登录后重跑。" >&2
  echo "      判据原文见本文件抬头（登录页 sat=7.00 vs Feed sat=33.01/67.96）。" >&2
  exit 1
}

# ── 会话自愈：掉登录就重新登录，而不是整轮中止 ──
# 为什么不直接中止：实测 app **静置 102 秒不会自己掉线**（FAB 区 sat 恒为 28.02），
# 掉线是采集脚本自己反复 `am force-stop`（改 wm size 后必须重启）打出来的。
# 一轮矩阵要重启 30+ 次，撞上一次会话失效就前功尽弃太浪费 —— 重新登录后继续。
# 为什么必须用 .env：项目约定凭据放包根 .env（PIXIV_REFRESH_TOKEN），
# 不落 1Password/keychain/环境变量。**token 不回显、不进日志、不进仓库**。
# 登录页控件位置按屏宽等比推算（720×1280 实测：输入框中心 (0.500,0.495)、
# 登录按钮中心 (0.500,0.584)），因为登录页是居中卡片布局，分数坐标跨分辨率稳定。
do_login() {
  local token probe
  [ -f "$ENV_FILE" ] || { echo "    ✗ 找不到 ${ENV_FILE}，无法自动登录" >&2; return 1; }
  token="$(grep '^PIXIV_REFRESH_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d "\"' \r\n")"
  [ -n "$token" ] || { echo "    ✗ ${ENV_FILE} 里没有 PIXIV_REFRESH_TOKEN" >&2; return 1; }
  # 独占暂存文件：收键盘后那张截图**含明文 token**（input 无 type=password），
  # 所以每条返回路径都要删（下面的 scrub）+ EXIT/INT/TERM 兜底，绝不共用 .nav.png。
  probe="$OUT/.login.png"
  LOGIN_PROBE="$probe"
  scrub_login_probe          # 上一次若被信号打断，残片先清掉再开新的
  $ADB exec-out screencap -p > "$probe"
  # 登录按钮**检测**而非写死比例：实测它在 720×1280 是屏高 0.584、在 1080×2160 是 0.552
  # ——同样 9:16 的两个分辨率比例并不守恒（卡片高度不是纯宽度缩放），
  # 写死会在一个分辨率上正好命中、在另一个上偏 70px ⇒ 点空且不报错。
  # find-ui-band.py --wide-solid 实测：1080 命中 y=1195（人工量得 1193）、
  # 720 命中 y=748（人工量得 747），两张差 1~2px。
  # ⚠️ 不用 `2>/dev/null` 裸接：这会把「截图读不出来」也报成「登录页上找不到按钮」。
  det find-ui-band.py --wide-solid --csv "$probe" || {
    det_report "登录页上定位「登录」按钮失败"
    scrub_login_probe; return 1
  }
  local bx by
  IFS=, read -r bx by <<< "$DET_OUT"
  tap_abs "$bx" $(( CUR_H * 495 / 1000 )) 1.2      # 输入框：布局在收键盘后不变，比例稳定
  $ADB shell input text "$token"
  sleep 0.8
  $ADB shell input keyevent KEYCODE_BACK           # 收键盘，否则按钮被挡
  sleep 1.2
  # 收键盘后布局会**重新居中**，按钮下移 ⇒ 必须重新检测，不能沿用收键盘前的坐标。
  # ⚠️ 这一张截图里**有明文 token** —— 它落在独占的 .login.png 上，且本函数
  # 退出时（下面每一处 return 与正常返回）都会删掉它。
  $ADB exec-out screencap -p > "$probe"
  det find-ui-band.py --wide-solid --csv "$probe" || {
    det_report "收键盘后重新定位「登录」按钮失败"
    scrub_login_probe; return 1
  }
  IFS=, read -r bx by <<< "$DET_OUT"
  scrub_login_probe      # 按钮坐标已取到 ⇒ 截图（含 token）立刻销毁，之后不再需要
  tap_abs "$bx" "$by" 6.0
}

# 返回 0 = 会话有效；1 = 重新登录后仍无效（调用方决定中止）
#
# ⚠️ 登录后**必须轮询**，不能量一次就下结论：实测登录链路要 ~6.5s
# （logcat：11:43:28 `loginWithRefreshToken` → 11:43:34 `setItem.refresh_token`），
# 首版只 `sleep 6` 就去量，量到的还是登录页 ⇒ 报「token 可能已失效」——
# **又一次把「等待不足」误报成「凭据失效」**，两者都表现为 sat=7.00。
ensure_session() {
  local sat i
  # 本函数**整个登录窗口**的截图都走独占的 .login.png。
  # ⚠️ 轮询那 8 次尤其关键：登录请求在飞的时候（实测 ~6.5s）token 还留在
  # 输入框里，那几张截图**含明文 token**。早先它们写的是共享的 .nav.png ——
  # 也就是说「 FAB 诊断提示让人打开的那个文件」正是可能含 token 的那个。
  # 登录窗口结束后（进入 Feed）才回到 .nav.png 体系，它因此可证明无 token。
  LOGIN_PROBE="$OUT/.login.png"
  local probe="$LOGIN_PROBE"
  scrub_login_probe
  $ADB exec-out screencap -p > "$probe"
  sat="$(fab_sat "$probe")"
  [ -n "$sat" ] && awk "BEGIN{exit !($sat >= $MIN_FAB_SAT)}" && { scrub_login_probe; return 0; }
  # ⚠️ 「探针读不出来」与「会话真的失效」是**两件事**（第八轮 Spec 轴 F1）。
  #    旧写法是 `${sat:-无输出}` —— 它**缓解了显示**（不至于印出 "sat= < 20" 让
  #    人以为测到了 0），却**没缓解归因**：句子仍在断言成因。探针无输出时真因可能是
  #    adb 断连 / 截图被截断 / 设备掉线，而**不是**会话失效。
  #    这里改成与 shot()/resume_reason() 同形的显式分流（措辞不需要真机）。
  # ⚠️ 「读不出来时**要不要自动重登**」是另一回事，属**控制流**、需真机裁决，
  #    本轮**刻意不改**（见 doc §8.8 挂账）。
  if [ -z "$sat" ]; then
    #    ⚠️ 措辞**必须描述代码真正在做的事**：下一行的 do_login 是**无条件**的，
    #    探针无输出时照样会走重登。此前这里写「别去重登/换 token」，与控制流**自相矛盾**
    #    （第九轮 Spec 轴留下、第十六轮才被逐行核出）。归因提醒（别认定 token 失效）仍然
    #    有效，要改的是「别去重登」这个**行为声明** —— 它描述了代码没有做也不会做的事。
    echo "    ! FAB 区探针无输出（截图读不出来；**未判定**会话是否失效）—— 仍会照常自动重登（控制流未改），但别据此认定 token 失效" >&2
  else
    echo "    ! 会话失效（FAB 区 sat=${sat} < ${MIN_FAB_SAT}），自动重新登录" >&2
  fi
  do_login || { scrub_login_probe; return 1; }
  for i in 1 2 3 4 5 6 7 8; do
    sleep 3
    $ADB exec-out screencap -p > "$probe"
    sat="$(fab_sat "$probe")"
    if [ -n "$sat" ] && awk "BEGIN{exit !($sat >= $MIN_FAB_SAT)}"; then
      echo "    ✓ 已重新登录（FAB 区 sat=${sat}，等待 $((i * 3))s）"
      scrub_login_probe; return 0        # 已进 Feed，截图不再含 token
    fi
  done
  # 同上：这句原本**指挥人去查错方向**（重登 / 换 token），而探针读不出来时真因未必在此。
  if [ -z "$sat" ]; then
    echo "    ✗ 重登后 FAB 区探针**无输出**（截图读不出来；会话状态**未判定**，别直接归因到 token）" >&2
  else
    echo "    ✗ 重新登录后 24s 内仍停在登录页（sat=${sat}）—— token 可能已失效，需人工处理" >&2
  fi
  scrub_login_probe
  return 1
}

# ── 导航（FAB 坐标按屏宽等比换算；**每一步都用可观测验证**）──
# 外环：推荐home 插画explore 小说menu_book 我的person；内环：search；close 在 FAB 原位。
#
# ⚠️ 为什么必须验证：实测出现过「两次点击都落空、app 仍停在 Feed、而脚本毫无察觉」
# 就继续往下滚 8 步，最后报「找不到控件」—— 把**导航失败**误报成**检测失败**。
# FAB 展开会给整屏加一层 scrim ⇒ 亮度明显下降，这是现成的 oracle。
# 另注：FAB 是**切换**态，若上次是展开的，第一次点击是收起（亮度反升），
# 所以判据要看「相对点击前的变化方向」，不能只看绝对值。
go_tab() {
  local tx ty b a
  case "$1" in
    me)    tx=575; ty=1868 ;;
    illus) tx=729; ty=1614 ;;
    novel) tx=623; ty=1749 ;;
    *) return 0 ;;
  esac
  # 只在「刚重启过」这个唯一已知的掉线窗口里查会话（理由见 SESSION_DIRTY 处的注释）
  if [ "$SESSION_DIRTY" = 1 ]; then
    ensure_session || exit 1
    SESSION_DIRTY=0
  fi
  b="$(luma_now)"
  tap 950 1885 2.2
  a="$(luma_now)"
  if ! lower_by "$a" "$b" 8; then
    # 可能是「上次已是展开态」→ 这次点击是收起（亮度反升，实测 33.88 → 49.97）。
    # 再点一次应当展开。⚠️ 判据的基准必须是**紧邻这次点击前**的 a，不能是最初的 b：
    # 重新展开后亮度会回到 b 附近（≈相等），拿 b 当基准会判成「没变化」而误报失败。
    tap 950 1885 1.8
    local c
    c="$(luma_now)"
    if ! lower_by "$c" "$a" 8; then
      # ── 先重试，再报错 ──
      # `am force-stop` + 重启是**唯一确定**能把 app 拨回「Feed + FAB 收起」的动作。
      # 上一版在这里直接中止并「分诊」，结果连续两轮都误诊：sat=13.81 被当成
      # 「停在登录页」——而 13.81 其实是**页内正常态**（带 scrim 的「我的」页），
      # 那片区域只有在 Feed 上才有「FAB 底部主题色」的固定语义。
      # **假阳性比漏检更贵**：它会把人引向「重新登录」这种破坏性动作。
      echo "    ! FAB 未响应（${b} → ${a} → ${c}）—— 重启 app 后重试一次" >&2
      relaunch
      if [ "$SESSION_DIRTY" = 1 ]; then
        ensure_session || exit 1
        SESSION_DIRTY=0
      fi
      local expanded=1 b2 a2 c2
      b2="$(luma_now)"
      tap 950 1885 2.2
      a2="$(luma_now)"
      if lower_by "$a2" "$b2" 8; then
        expanded=1                       # 第一次点击就展开了，不必再点
      else
        tap 950 1885 1.8                # 上次是展开态 → 这次点击是收起，再点应展开
        c2="$(luma_now)"
        lower_by "$c2" "$a2" 8 || expanded=0
      fi
      if [ "$expanded" = 0 ]; then
        # 重试过还不行 ⇒ 如实报**测到的事实**，不给未经证实的因果。
        local sat
        sat="$(fab_sat "$OUT/.nav.png")"
        echo "    ✗ 重启后 FAB 仍无响应（${b2} → ${a2} → ${c2:-未测}，期望后一次下降 >8；FAB 区 sat=${sat:-无输出}）—— 中止" >&2
        echo "      已排除：尺寸未生效（set_size 强制重启过）、登录态失效（重启后 ensure_session 通过）。" >&2
        echo "      未判定：点击落点 / FAB 状态 / 过渡动画未结束 —— 这三者症状同形，需人工看屏判断。" >&2
        # 这张图**可证明无 token**：.nav.png 只由 luma_now() 写（导航期探针），
        # 而上面三次 luma_now 都发生在 ensure_session 通过、app 已在 Feed 之后。
        # 登录窗口的截图走独立的 .login.png 并用完即删（见 scrub_login_probe）。
        echo "      诊断截图：${OUT}/.nav.png" >&2
        exit 1
      fi
      b="$b2"; a="$a2"
    fi
  fi
  tap "$tx" "$ty" 2.8
}

# ── 外观区：滑动 + **检测**，直到色板行进到屏幕中段 ──
#
# ⚠️ 为什么锚点是**色板行**而不是分段控件 —— 两轮实测踩出来的：
#
#  1) 分段控件**不是无歧义锚点**。设置页上至少三张卡都长这样，x 几何完全相同
#     （1080 实测三者的段中心都是 234/540/846）：
#       · AI 作品   三段控件（显示/遮罩/仅看）
#       · 外观模式  三段控件（亮色/暗色/跟随系统）  ← 只有它下面有 7 个色板圆点
#       · 界面语言  三药丸（跟随系统/简体中文/English）
#     认错卡的后果：照着「外观模式」的假设去点，**点空、改错设置、不报错**。
#
#  2) 用分段控件当锚点还会**滚过头**。原来每步下滑 800px，而外观卡只有 ~400px 高：
#     实测第 3 步时色板行已在 y=454，控件早滚出屏幕上方，检测器当然找不到 ——
#     症状是「找不到控件」，真实原因是「已经滑过去了」。
#
# 所以改成：**先检出色板行**，要求它落在屏幕 45%–72% 这个安全带里（此时控件在
# 锚点上方 ~15.2% 屏宽处，稳稳落在 find-ui-band 的扫描窗 12%–85% 内），
# 再由色板行**反算**控件几何。
#
# 反算依据（emulator-5556 实测）：
#   · 色板行**外沿**与分段控件等宽：色板圆心 137..941、半径 55 ⇒ 外沿 82..996，
#     控件实测 82..999（差 3px = 描边）。
#   · 控件纵向偏移随**屏宽**线性：1080 → 164px、1440 → 218px
#     （折合 15.19% / 15.14% 屏宽；按屏高则不等比 7.59% / 8.52%）。
#   · 三段中心 = 外沿左端 + (i+0.5)×外沿宽/3 ⇒ 234 / 540 / 846，与实测一致。
SW_Y=0; SW_R=0; CTRL_CY=0; CTRL_CX=0; SEG_W=0
SW_SEEN_Y=0   # 本次探测里色板行出现的位置（哪怕不在安全带内），供闭环修正用
SW_X=()
# 外观模式卡下的色板圆点**恰好 7 个** —— 这是设计约定，不是「至少 7 个」。
# find-palette-swatches.py 的 MIN_BLOBS=5 / MAX_BLOBS=9 是**故意放开**的
# （它不替调用方判断「这一行是不是外观卡的色板行」），所以 8/9 个会被它照收。
# 而卡片中心取的是「首末圆心的中点」：实测 9 个等距圆点（140..740）时
# 按末元素算是 540，写死第 7 个（=740）算成 440，**偏 100px**。
# 守卫必须按**实际个数**等于约定值来判，写 `-lt 7` 会把 8/9 放行。
SWATCH_COUNT=7
detect_control() {
  local probe="$OUT/.ctrl.png" sw swy r x rest cx cy bw
  SW_SEEN_Y=0
  $ADB exec-out screencap -p > "$probe"
  # ① 色板行：确认「这是外观卡」+ 给出圆点坐标。安全带 40%–80% 屏高。
  #
  # rc=1（NOTFOUND）与 rc=3（截图读不出来）在这里**必须分开**：前者是
  # 「还没滚到位，继续滚」，后者是「这张探针废了，后面 36 步全废」⇒ 响亮中止。
  if ! det find-palette-swatches.py "$probe" --csv; then
    if [ "$DET_RC" -eq 3 ]; then det_report "外观卡探针输入不可读，无法继续闭环滚动"; exit 1; fi
    dbg_lazy _dbg_no_swatch "$probe"
    return 1
  fi
  sw="$DET_OUT"
  [ -z "$sw" ] && return 1
  swy="${sw%%,*}"; rest="${sw#*,}"; r="${rest%%,*}"
  SW_SEEN_Y=$swy
  # 安全带 40%–80% 屏高，**由两条真实约束推出**，不是拍的百分比：
  #   下界 40%：控件在色板行上方约 15.2% 屏宽处（1080→164px、720→109px），
  #            要让它留在 find-ui-band 的扫描窗 12%–85% 内。720 下 512−109=403 > 154 ✓
  #   上界 80%：色板行要**点得到**。FAB 在右下角（1080 实测 y 1836..2030，
  #            720 折合约 1090..1210），色板行压到 FAB 高度上时右侧几个圆点会被挡。
  # 取 80% 而非更松：720 实测滚到底时色板行稳定停在 y≈954，落在带内。
  # ⚠️ 早先取 45%–72%（带宽 345px）时，720 步长 474px **一步跨过整条带**，
  #    实测连续出现 y=1152/1143/1091/954 四次「找到了但在带外」。
  local band_lo band_hi
  band_lo=$(( CUR_H * 40 / 100 )); band_hi=$(( CUR_H * 80 / 100 ))
  [ "$swy" -lt "$band_lo" ] && { dbg "色板行 y=${swy} 低于安全带下沿 ${band_lo}"; return 1; }
  [ "$swy" -gt "$band_hi" ] && { dbg "色板行 y=${swy} 高于安全带上沿 ${band_hi}"; return 1; }
  SW_Y=$swy; SW_R=$r
  SW_X=(); rest="${rest#*,}"
  while [ -n "$rest" ]; do
    if [ "${rest#*,}" = "$rest" ]; then SW_X+=("$rest"); break; fi
    x="${rest%%,*}"; SW_X+=("$x"); rest="${rest#*,}"
  done
  [ "${#SW_X[@]}" -ne "$SWATCH_COUNT" ] && {
    dbg "色板行 y=${swy} 有 ${#SW_X[@]} 个圆心，与约定的 ${SWATCH_COUNT} 个不符"; return 1; }
  # ② 控件：卡已确认无歧义，这时再让 find-ui-band 量**段宽**与**纵向位置**。
  #    同样分流 rc=3（探针废了 ⇒ 后续滚动全都不可信，中止）与 rc=1（还没对齐，继续滚）。
  if ! det find-ui-band.py "$probe" --csv; then
    if [ "$DET_RC" -eq 3 ]; then det_report "分段控件探针输入不可读（色板行已就位 y=${swy}）"; exit 1; fi
    dbg_lazy _dbg_ctrl_miss "$swy" "$probe"
    return 1
  fi
  [ -z "$DET_OUT" ] && return 1
  IFS=, read -r cx cy <<< "$DET_OUT"
  # --explain 的人类可读块走 stdout（拒因走 stderr），所以从 DET_OUT 刮。
  # rc=3 在这里几乎不可能（上一行刚用同一张图读成功），但仍分流：段宽取不到时
  # 分不清「没这一行」与「图读不出来」，后者去调 print 格式是白费力气。
  if det find-ui-band.py "$probe" --explain; then
    bw="$(printf '%s\n' "$DET_OUT" | sed -n 's/.*尺寸=\([0-9]*\)x[0-9]*.*/\1/p' | head -1)"
  else
    bw=""
    [ "$DET_RC" -eq 3 ] && det_report "段宽探针输入不可读"
  fi
  [ -z "${bw:-}" ] && { dbg "取不到段宽（--explain 无「尺寸=WxH」行）"; return 1; }
  SEG_W=$bw
  # ③ 卡片中心：控件与色板行同为卡片内**居中**，1080 实测 540 vs 算出的 539（差 1px）。
  #    段中心 = 卡片中心 ± 段宽。⚠️ 这里喂进去的 SEG_W 是**检测器实测段宽**，
  #    同一屏宽下它会漂：实测 1080 是 300 或 306、1440 是 402 或 408（capture.log
  #    35 次命中：300×17 / 306×15 / 200×2 / 408×1 / 402×1），
  #    所以段中心的真实误差上界是 |Δ中心| + |Δ段宽| ≈ 1 + 6 = **7px**，不是 ≤1px。
  #    7px 只有段宽的 2.3%，稳稳落在段内 —— 这是**已量化、可接受**的近似，
  #    保留它（真要 ≤1px 就得放弃实测段宽、退回写死 306，那会在窄屏上错得更多）。
  #    （不用「色板外沿反推控件外沿」—— 那个要先知道圆点半径，而半径从
  #      饱和段宽度估出来偏小 18px，段中心会偏 12–15px。）
  CTRL_CX=$(( (SW_X[0] + SW_X[${#SW_X[@]} - 1]) / 2 ))
  CTRL_CY=$cy
  return 0
}
# 第 i 段（0=亮色 1=暗色 2=跟随系统）的中心 x
mode_x() { echo $(( CTRL_CX + ($1 - 1) * SEG_W )); }

goto_appearance() {
  local attempt step
  for attempt in 1 2 3; do
    # 首次直接走 FAB；第 2/3 次先 relaunch —— relaunch 保证落在 Feed 且 FAB 收起，
    # 这是**唯一**确定的状态。`wm size` 刚改过时布局需要重排，此时 FAB 坐标可能点空，
    # 而点空不报错（只是没导航），8 步滑完就误判成「找不到控件」。
    if [ "$attempt" -eq 1 ]; then go_tab me; else relaunch; go_tab me; fi
    for _ in 1 2 3 4 5; do swipe 540 700 540 1750 200; done
    sleep 0.8
    # 盲步进只负责「把外观卡滚进视野」；一旦**见到色板行**（哪怕在安全带外），
    # 就改用闭环修正：按实测 y 与目标 y 的差值精确滚。
    #
    # ⚠️ 为什么必须闭环：安全带宽 = 72%−45% = 27% 屏高（720 下 576..921，宽 345px），
    #    而固定步长是 30% 屏高（`Y(1600)−Y(800)` 在 720 下 = 948−474 = 474px）——
    #    **步长比安全带还宽**，于是「找到了但落在带外」，只能一直盲滚下去。
    #    实测 720 暗色轮就卡在这里：连续 8 步「无色板行」后，
    #    接着 y=1158（高于上沿）、y=546（低于下沿），两次都擦边而过。
    local target delta
    target=$(( CUR_H * 60 / 100 ))
    for step in 1 2 3 4 5 6 7 8 9 10 11 12; do
      if detect_control; then
        dbg "第 ${step} 步命中外观卡（色板行 y=${SW_Y} 控件 cy=${CTRL_CY} 段宽=${SEG_W}）"; return 0
      fi
      if [ "$SW_SEEN_Y" -gt 0 ]; then
        delta=$(( SW_SEEN_Y - target ))
        [ "$delta" -lt 0 ] && delta=$(( -delta ))
        [ "$delta" -gt $(( CUR_H * 55 / 100 )) ] && delta=$(( CUR_H * 55 / 100 ))
        dbg "闭环修正：色板行 y=${SW_SEEN_Y} → 目标 ${target}，滚 ${delta}px"
        # ⚠️ 方向：**手指上移 ⇒ 内容上移**（看到更靠后的内容，色板行 y 变小）。
        #    实测增益 ≈ 1.0（手指下移 300px ⇒ 色板行 1572→1885，位移 +313px），
        #    所以 delta 不需要缩放。
        #    这两个分支一开始写反了（y_sw>target 时用手指下移），于是修正越修越偏：
        #    实测 1938 → 1846 → 1835 三次几乎不动。方向错是闭环里最难自查的一类错 ——
        #    它不报错，只是**稳定地不收敛**。
        if [ $(( SW_SEEN_Y - target )) -gt 0 ]; then
          swipe_abs $(( CUR_W / 2 )) $(( CUR_H / 2 + delta )) $(( CUR_W / 2 )) $(( CUR_H / 2 )) 400
        else
          swipe_abs $(( CUR_W / 2 )) $(( CUR_H / 2 )) $(( CUR_W / 2 )) $(( CUR_H / 2 + delta )) 400
        fi
      else
        swipe 540 1600 540 800 400; sleep 0.6
      fi
    done
    echo "    ! 第 ${attempt} 次未定位到控件，重来" >&2
  done
  echo "    ✗ 重试 3 次仍未定位到「外观模式」控件 —— 中止（盲点坐标会静默改错设置）" >&2
  exit 1
}

# ⚠️ 段位置由 `mode_x` 从**实测的色板行**推导，不再用写死比例。
#    写死版（`CUR_W*234/1080`、`CUR_W*540/1080`）在 1080 上恰好对（实测段中心
#    234/540/846），但那是**巧合**：它成立的前提是控件左缘恒为 82px，
#    而这个前提没在任何地方被验证过。窄屏下实测 720 的段中心是 74/257/440，
#    写死公式给 156/360 —— 差 82px，点在段与段的边界上。

DARK_MAX=70; LIGHT_MIN=100
# `PROBE_WHY` = 最近一次 probe_mode 失败的**分类**。独立复核「次要 6」指出：
# 撕裂帧走的是同一个 `return 1`，与「点空了」在 `set_mode` 的终局诊断上**完全同形** ——
# 早先的注释承诺「不据此判定切换失败」，而代码并没有兑现。保留分类才能让终局报错
# 指向真正的根因（否则人会去查点击落点，而真因是 app 没 repaint）。
PROBE_WHY=""
probe_mode() {
  local want="$1" probe="$OUT/.probe.png" l
  PROBE_WHY=""
  sleep 2.5
  $ADB exec-out screencap -p > "$probe"
  # ⚠️ D-7：`set_mode` 刚点完主题就量，而 app 内容**不一定已 repaint** ⇒ 可能量到
  #    撕裂帧（状态栏新、内容旧）。撕裂帧一律当「还没生效」，交给下面既有的重试循环，
  #    **不**据此判定切换失败 —— 否则会把「没 repaint」误报成「点空了」。
  _fsd="$(frame_settled "$probe")"
  if [ "$_fsd" = "2" ]; then
    PROBE_WHY="探针无输出（截图读不出来；**不是**撕裂，别去查 D-7 时序）"
    echo "    ! ${PROBE_WHY}，本帧不作判据" >&2
    return 1
  elif [ "$_fsd" = "1" ]; then
    PROBE_WHY="撕裂帧（顶栏 sd=$(band_sd "$probe") > ${MAX_BAND_SD}，切主题后 app 未 repaint）"
    echo "    ! ${PROBE_WHY}，本帧不作判据" >&2
    return 1
  fi
  l="$(luma "$probe")"
  # ⚠️ 刻意**不**用 `if` 块写「探针无输出」那一支：那是 `resume_reason` ② 的**块首**，
  #    夹具按出现次序取块（`c++; on=(c==k)`），而 `index()` 是对**原始行**做子串匹配
  #    —— **注释行也算**。同名块多一处、或注释里引用一次，都会让「resume_reason ②」的
  #    断言抽到 probe_mode 这块 ⇒ 指向一条不存在的消息。单行形式两者都避开。
  [ -z "$l" ] && { PROBE_WHY="亮度探针无输出（截图损坏）"; echo "    ! ${PROBE_WHY}" >&2; return 1; }
  if [ "$want" = dark ]  && awk "BEGIN{exit !($l < $DARK_MAX)}";  then return 0; fi
  if [ "$want" = light ] && awk "BEGIN{exit !($l > $LIGHT_MIN)}"; then return 0; fi
  PROBE_WHY="声称 ${want} 但实测整幅亮度 ${l}（落在 ${DARK_MAX}~${LIGHT_MIN} 死区或另一侧）"
  echo "    ! ${PROBE_WHY}" >&2
  return 1
}

set_mode() {
  local want="$1" try
  for try in 1 2 3; do
    goto_appearance          # 成功返回即已 detect 到控件，CTRL_CY 就绪
    tap_abs "$( [ "$want" = light ] && mode_x 0 || mode_x 1 )" "$CTRL_CY" 1.8
    back
    if probe_mode "$want"; then return 0; fi
    echo "    ! 第 ${try} 次未生效，重放动作链" >&2
  done
  # ⚠️ 终局诊断**必须区分**「点空了」与「没 repaint」—— 否则会把人引去查点击落点，
  #    而真因是 app 的渲染时序（独立复核「次要 6」）。三个重试里只要**有一次**是撕裂，
  #    就说明点击大概率是生效的，只是量到撕裂帧 ⇒ 报撕裂而不是报「点空」。
  local last_torn=""
  [ -n "$PROBE_WHY" ] && case "$PROBE_WHY" in 撕裂帧*) last_torn="$PROBE_WHY" ;; esac
  if [ -n "$last_torn" ]; then
    echo "    ✗ 外观切换连续 3 次未确认（声称 ${want}）。最近一次原因：${last_torn}" >&2
    echo "      ⇒ 指向 **D-7 渲染时序**，不是点击落点。可增大 set_mode 里的 sleep 后重试。" >&2
  else
    echo "    ✗ 外观切换连续 3 次失败（声称 ${want}，最近一次：${PROBE_WHY:-未知}）。中止" >&2
    echo "      ⇒ 指向**点击落点/段控坐标**，先查 mode_x 与 detect_control。" >&2
  fi
  exit 1
}

# 色板：7 个圆形 swatch，位于外观模式分段控件正下方。
#
# ⚠️ 坐标**全部来自检测器**（find-palette-swatches.py），不再用写死比例。
#    原来写的是 `CUR_W*(134+136*i)/1080` + `CTRL_CY + CUR_H*120/2160`，
#    两处都错，且错法不同：
#      · x 勉强能用（1080 实测圆心 137/272/406/540/673/807/941，
#        公式给 134/270/406/542/678/814/950，最大偏 9px，圆点直径 ~110px 尚可）
#      · y **必错**：真实偏移随**屏宽**线性（1080 → 164px、1440 → 218px，
#        折合 15.19% / 15.14% 屏宽），而随屏高**不等比**（7.59% / 8.52%）。
#        公式按屏高缩放 ⇒ 1080 偏 44px、1440 偏 76px、720 偏 38px，
#        落在色板行带（高 90px）的**顶边**，等于擦边点。
#    顺带补上**一直缺的 oracle**：点完必须回读「哪个圆点带选中环」，
#    对不上就重试。原来点空了也不报错，4 色板 × 2 明暗这 8 张会全拍成天蓝。
set_palette() {
  local i="$1" try got
  for try in 1 2 3; do
    goto_appearance
    tap_abs "${SW_X[$i]}" "$SW_Y" 1.6
    back
    goto_appearance          # 回读 oracle 必须重新进卡：back 之后页面位置不可信
    $ADB exec-out screencap -p > "$OUT/.pal.png"
    # ⚠️ 回读失败要分两类：rc=3（探针废了 / 判据失效）与 rc=1（回读时压根不在外观卡上）。
    # 合成一句「读不到 ${got:-读不到}」会把「adb 断了」报成「色板没生效」，
    # 于是白重试 3 次再报「外观切换连续 3 次失败」—— 指向错误的根因。
    if det find-palette-swatches.py "$OUT/.pal.png" --selected; then
      got="$DET_OUT"
      if [ "$got" = "$i" ]; then return 0; fi
      echo "    ! 第 ${try} 次：期望色板 ${i}，回读 ${got:-空}" >&2
    else
      got=""
      det_report "色板选中态回读失败（期望色板 ${i}）"
    fi
  done
  echo "    ✗ 色板切换连续 3 次未生效（期望 ${i}）。中止（继续采会把 8 张全拍成同一个色板）" >&2
  exit 1
}

# ── 采集 ────────────────────────────────────────────────
NARROW="720x1280:320"; STD="1080x2160:480"; WIDE="1440x2560:560"
reset_size
echo "▸ 预检：确认 app 在 Feed 上（不是登录页 / 未加载完）"
preflight
echo "▸ 轴 0：清零基线 —— 亮色 + 天蓝(0)"
set_mode light; set_palette 0

echo "▸ 轴 1：屏宽扫描（天蓝 / Feed + Me）"
for wh in "$NARROW" "$STD" "$WIDE"; do
  set_size "${wh%%:*}" "${wh##*:}"
  for mode in light dark; do
    set_mode $mode
    relaunch; sleep 3; shot "w-${wh%%:*}-${mode}-feed" 6.0
    go_tab me;   shot "w-${wh%%:*}-${mode}-me" 2.5
  done
done
reset_size
set_mode light; set_palette 0

echo "▸ 轴 2：色板扫描（标准屏宽 / Feed）"
for pi in 0 1 2 5; do
  set_palette "$pi"
  for mode in light dark; do
    set_mode $mode
    relaunch; sleep 3; shot "p-pal${pi}-${mode}-feed" 6.0
  done
done
set_palette 0; set_mode light

echo "▸ 轴 3：页面扫描（标准屏宽 / 天蓝 / 亮暗）"
for mode in light dark; do
  set_mode $mode
  relaunch; sleep 3; shot "pg-${mode}-01-feed" 6.0
  go_tab me; sleep 1; tap 950 1885 2.2; shot "pg-${mode}-02-fab-expanded" 1.5
  tap 950 1885 1.0
  go_tab me;    shot "pg-${mode}-03-me" 2.5
  go_tab illus; shot "pg-${mode}-04-illus" 5.0
  go_tab novel; shot "pg-${mode}-05-novel" 5.0
  relaunch; sleep 2; tap 950 1885 2.2; tap 891 1749 2.8; shot "pg-${mode}-06-search" 2.5 1 sheet
  back; sleep 1
done

echo "▸ 收尾：恢复默认"
reset_size; set_mode light; set_palette 0
# 期望张数：轴1 3×2×2=12 + 轴2 4×2=8 + 轴3 2×6=12 = 32
EXPECT=32
GOT=$(ls -1 "$OUT"/*.png 2>/dev/null | wc -l | tr -d ' ')
if [ "$GOT" != "$EXPECT" ]; then
  echo "    ✗ 期望 ${EXPECT} 张，实得 ${GOT} 张 —— 中止（缺张说明某支循环没跑）" >&2
  exit 1
fi
echo "完成，产物在 ${OUT}：${GOT} 张"
