#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# app-lynx 系统返回回归脚本（ticket #334 / spec #329 Seam 3，ADR-0138 迁移验收）
#
# 验证对象：app-lynx（vue-lynx，Host = 原生 LynxActivity）的系统返回行为：
#   原生 OnBackPressedDispatcher 拦截（返回键 KEYCODE_BACK 与侧滑手势同路径）
#   → sendGlobalEvent("pictelioBack") → JS handleSystemBack 裁决链
#   （modalStack → back-guard → meta.backBehavior:'exit' → hasBackEntry→router.back()
#    → 根路由「再按一次退出应用」提示 → 2s 窗口内再按 → PictelioApp.exitApp()）。
#
# 依赖：
#   - Android 模拟器（默认 emulator-5554，用 ADB_SERIAL 覆盖）；S4 需要 gesture nav
#   - adb（platform-tools）；像素分析复用仓库自有 scripts/lynx-screen-analyze.py 的
#     纯标准库 PNG 解码（importlib 加载，零第三方依赖，无需 PIL）
#   - app-lynx bundle 已同步到 android assets（pnpm sync:app-lynx-bundle），
#     APK：packages/app/android/app/build/outputs/apk/full/debug/app-full-debug.apk
#     （本脚本只跑 gradle assembleFullDebug，不重新构建 bundle）
#   - .env 的 PIXIV_REFRESH_TOKEN（S5 登出后 / 首次运行的自助登录）
#
# ADR-0137 采样方法（证据链 + 时机）：
#   「再按一次退出应用」提示条是瞬态 UI（存活 2s，EXIT_HINT_DURATION_MS）——
#   采用「按键后立即采样」：keyevent 4 → sleep 0.45 → screencap（~0.3s，总 <1s 落在窗口内）。
#   ADR-0137 滚动中采样（swipe 并发连拍）用于滚动态 UI；本脚本无滚动态断言，仅借其
#   「验证瞬态 UI 必须在存活窗口内采样」的姿势。S3 双击退出在 2s 窗口内完成
#   （时序见场景内注释），截图与退出判定链式取证。
#
# 证据链设计（产品代码无系统返回专用日志，全部外部取证）：
#   - logcat：`LynxView sendGlobalEvent pictelioBack`（原生桥已触发，稳定输出）
#     —— 证明「系统返回被拦截且已转发 JS」；
#   - 截图：返回键/侧滑后的页面形态（详情页返回箭头 `‹` 消失 / 提示条出现）；
#   - dumpsys：退出后 mCurrentFocus = launcher（S3/S6）；
#   - 结论 = 上述链条叠加，任一环缺失即该场景 FAIL。
#
# 已知坑（实测/先例，改动脚本前先读）：
#   1. APK 全变体：必须用 apk/full/debug/app-full-debug.apk（full = webview+lynx 双 client）。
#      旧包 apk/debug/app-debug.apk 是基础变体产物，装错会测到错误的返回行为。
#   2. `am start -S` 不可靠（Activity 路由 + Splash 时序竞态）：一律 force-stop + am start，
#      本脚本统一 relaunch() 幂等准备。
#   3. 屏幕分辨率：`adb shell wm size` 探测；所有坐标按「宽度比例」缩放（lynx 布局 vw 单位
#      ——与宽度成正比；纵向同样按宽度换算，flow-check 同款注释）。
#   4. ANR/卡死先例：模拟器无响应时 `adb reboot` 后等待 boot 完成再跑（脚本不自动处理）。
#   5. benchNav（ADR-0136）当前仅在 lynx-only APK + BENCH_NAV=1 bundle 下可用：
#      full 包 MainActivity 路由到 LynxActivity 时新建 Intent 不转发 --es 参数；
#      且默认构建的 bundle 无 __BENCH_NAV__（无 pictelioBenchNav 字符串）。脚本已内置
#      自动探测（APK bundle strings 扫描），有则优先 benchNav，无则 UI 点击兜底。
#   6. logcat 无产品侧系统返回标记日志（handleSystemBack 无 console 输出）：
#      判定以截图+焦点为主，logcat 仅作「桥已触发」的辅助证据（见上）。
#   7. S5 登出：Me.vue 当前迁移 WIP 树存在 `resetHistory is not defined`（未 import）→
#      S5 预期 FAIL 直到产品修复（这正是回归脚本的价值；脚本会打 logcat 诊断提示）。
#   8. S6（/update、/error meta-exit）：产品无外部触发通道（benchNav 无 update/error 目标，
#      version.json 无法从设备侧伪造）→ 默认 SKIP；产品侧补 benchNav 目标后脚本自动可测。
#   9. 提示条像素判据已按模拟器实测校准（M3 inverse-surface #322F35 深胶囊 / #E6E1E5 浅胶囊，
#      仅匹配「条带」不与白底/浅灰卡片混淆）：正样 93 行、负样 0 行（8 张样本）。
#
# 用法：
#   ./scripts/lynx-router-back-regression.sh                 # 全场景（S1-S5 执行，S6 SKIP）
#   ADB_SERIAL=emulator-5554 S6=1 ./scripts/lynx-router-back-regression.sh
#   SKIP_INSTALL=1 ./scripts/lynx-router-back-regression.sh  # 不重新构建/安装 APK
#   S1=0 S2=0 ./scripts/lynx-router-back-regression.sh       # 单独跑 S3-S6
# 退出码：有任一 FAILED 场景 → 1；全部 PASS → 0；SKIP 不算失败。
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
# macOS 自带 bash 3.2：非 C locale 下 `$VAR` 后紧跟全角字符（如「（」）会被当成变量名的一部分
#（实测 `$OUT_DIR（` 报 "OUT_DIR�: unbound variable"）→ 强制 C locale；
# 本脚本输出版本与内嵌 python 均只输出字节/ASCII，不受影响。
export LC_ALL=C
cd "$(dirname "$0")/.." # packages/app-lynx

# ─── 参数区（环境变量可覆盖） ─────────────────────────────────────────────
ADB_SERIAL="${ADB_SERIAL:-emulator-5554}"
APP_ID="${APP_ID:-io.pictelio.app}"
APK_PATH="${APK_PATH:-../app/android/app/build/outputs/apk/full/debug/app-full-debug.apk}"
SKIP_INSTALL="${SKIP_INSTALL:-0}" # 1 = 跳过 assembleDebug + adb install
S1="${S1:-1}"; S2="${S2:-1}"; S3="${S3:-1}"; S4="${S4:-1}"; S5="${S5:-1}"; S6="${S6:-1}"

OUT_DIR="${OUT_DIR:-.tmp-back-regression}" # 截图归档（结尾不清除——wipe me；可覆盖避免多进程共享目录）
mkdir -p "$OUT_DIR"

# ─── ADB 便捷封装（统一带 serial） ────────────────────────────────────────
adb() { command adb -s "$ADB_SERIAL" "$@"; }

say() { printf '%s\n' "$*"; }
warn() { printf '   ⚠️ %s\n' "$*"; }
ok() { printf '   ✓ %s\n' "$*"; }
ng() { printf '   ❌ %s\n' "$*"; }

RESULTS=()
REASON="" # 场景函数可写入 SKIP 原因（run_scenario 汇总时输出）
record() { RESULTS+=("$1"); }

# ─── 像素分析（内嵌 python，复用 lynx-screen-analyze.py 的 PNG 解码，零第三方依赖） ───
# 用法: px <mode> <png>  → stdout JSON
# mode: classify        页面分类（透传 lynx-screen-analyze.py）
#       hint-band       提示条「最大连续匹配行数」（正样 ≥15；S2/S3/S5）
#       chevron         顶栏左缘返回箭头暗像素数（详情页 ≥30，其余页 <30；S1/S4/S6）
#       login-btn       M3 primary 紫色登录按钮 {found,x,y,rows}
#       me-page         我的页判定 {found,colored,mid_dark}
#       red-text        红色文字块质心（退出登录按钮）{x,y,count}
#       fab-center      主 FAB（淡紫 secondary-container）质心（找不到 {x:0,y:0}）
px() {
  local mode="$1" png="$2"
  PX_MODE="$mode" PX_PNG="$png" python3 - <<'PYEOF'
import json, os
import importlib.util
spec = importlib.util.spec_from_file_location('a', 'scripts/lynx-screen-analyze.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
w, h, rows = m.load_png(os.environ['PX_PNG'])
mode = os.environ['PX_MODE']
out = {}

if mode == 'classify':
    print(json.dumps(m.classify(w, h, rows)))
elif mode == 'hint-band':
    # 提示条（M3 inverse-surface 胶囊，底部居中）：亮色主题 #322F35 深 / 暗色主题 #E6E1E5 浅。
    # 只扫提示条约落地带 y∈[0.78H,0.92H]、横向 [0.15W,0.85W]（避开右下 FAB 与底部导航条）。
    # 判据：每行匹配像素数 40..180（条带自身 ~141；页面纯白/纯灰背景行不会落入该区间——
    # 白底 max<255 被浅色精确容差排除；全宽深色条带被 180 上限排除）；返回值 = 最大连续
    # 匹配行数（gap≤6 并带）——连续 40+ 行 = 面板/异常背景，单一小条带 = 噪声。
    hits = []
    for y in range(int(h * 0.78), int(h * 0.92)):
        cnt = 0
        for x in range(int(w * 0.15), int(w * 0.85), 2):
            r, g, b = m.pixel(rows, y, x)
            dark = abs(r - 50) <= 25 and abs(g - 47) <= 25 and abs(b - 53) <= 25
            light = abs(r - 230) <= 10 and abs(g - 225) <= 10 and abs(b - 229) <= 10
            if dark or light:
                cnt += 1
        if 40 <= cnt <= 180:
            hits.append(y)
    best = 0
    cur = 0
    prev = -100
    for y in hits:
        cur = cur + 1 if y - prev <= 6 else 1
        best = max(best, cur)
        prev = y
    out = {'band': best}
elif mode == 'chevron':
    # 顶栏左缘返回箭头：y∈[0.08H,0.13H]（避开状态栏）、x<0.12W、暗像素（max<140）
    n = 0
    for y in range(int(h * 0.08), int(h * 0.13)):
        for x in range(0, int(w * 0.12)):
            r, g, b = m.pixel(rows, y, x)
            if max(r, g, b) < 140:
                n += 1
    out = {'dark': n}
elif mode == 'login-btn':
    # M3 primary 紫（#6750A4 附近）：登录按钮；返回 {found, x, y, rows}
    ys = []
    xs = []
    for y in range(int(h * 0.3), int(h * 0.7), 4):
        cnt = 0
        for x in range(0, w, 4):
            r, g, b = m.pixel(rows, y, x)
            if 80 <= r <= 150 and 40 <= g <= 115 and 130 <= b <= 210 and b - g > 50 and b - r > 20:
                cnt += 1
                xs.append(x)
        if cnt > 30:
            ys.append(y)
    out = {'found': len(ys) > 3,
           'x': sum(xs) // len(xs) if xs else 0,
           'y': sum(ys) // len(ys) if ys else 0,
           'rows': len(ys)}
elif mode == 'me-page':
    # 我的页：全程低彩色（纯列表） + 顶栏居中标题暗像素 + 无紫按钮/无左缘箭头
    colored = 0
    total = 0
    for y in range(0, h, 8):
        for x in range(0, w, 16):
            r, g, b = m.pixel(rows, y, x)
            total += 1
            if m.saturated(r, g, b):
                colored += 1
    ratio = colored / total if total else 0
    mid_dark = 0
    for y in range(int(h * 0.08), int(h * 0.13)):
        for x in range(int(w * 0.15), int(w * 0.85)):
            r, g, b = m.pixel(rows, y, x)
            if max(r, g, b) < 140:
                mid_dark += 1
    # 推荐页首卡是全宽大图，彩色占比实测 >0.09；我的页 <0.01。登录页有紫按钮排除。
    out = {'found': ratio < 0.03 and mid_dark >= 250, 'colored': round(ratio, 3), 'mid_dark': mid_dark}
elif mode == 'red-text':
    # 红色文字（退出登录 text-error）：质心 + 计数（y 下限 0.4H 避开顶栏）
    xs = []
    ys = []
    for y in range(int(h * 0.4), int(h * 0.95), 2):
        for x in range(int(w * 0.05), int(w * 0.95), 4):
            r, g, b = m.pixel(rows, y, x)
            if r > 170 and g < 110 and b < 110:
                xs.append(x)
                ys.append(y)
    out = {'count': len(xs),
           'x': sum(xs) // len(xs) if xs else 0,
           'y': sum(ys) // len(ys) if ys else 0}
elif mode == 'fab-center':
    # 主 FAB（secondary-container 淡紫，右下角）：质心；找不到 {x:0,y:0}（公式兜底在调用方）
    xs = []
    ys = []
    for y in range(int(h * 0.82), h, 2):
        for x in range(int(w * 0.6), w, 2):
            r, g, b = m.pixel(rows, y, x)
            if r > 228 and g > 215 and b > 240 and b - r > 6:
                xs.append(x)
                ys.append(y)
    out = {'x': sum(xs) // len(xs) if xs else 0,
           'y': sum(ys) // len(ys) if ys else 0}
else:
    out = {'error': 'unknown mode ' + mode}
print(json.dumps(out))
PYEOF
}

# ─── 屏幕探测与坐标换算（wm size；坐标按「宽度比例」缩放——lynx 布局 vw 单位） ───
WM_SIZE=$(adb shell wm size 2>/dev/null | grep -oE '[0-9]+x[0-9]+' | head -1 || true)
WM_W=${WM_SIZE%x*}
WM_H=${WM_SIZE#*x}
[ -n "${WM_W:-}" ] && [ -n "${WM_H:-}" ] || { say "❌ 无法读取屏幕分辨率（wm size）"; exit 1; }
sx() { echo $(( $1 * WM_W / 720 )); } # 横向按宽度缩放（基准 720）
sy() { echo $(( $1 * WM_W / 720 )); } # 纵向同按宽度缩放（lynx vw 布局语义）

# ─── 截图（screencap 偶发写空文件 → 重试至非空，flow-check 同款防坑） ───
shot() {
  local name="$1" f="$OUT_DIR/$name.png"
  for t in 1 2 3; do
    adb exec-out screencap -p > "$f" 2>/dev/null || true
    [ -s "$f" ] && break
    sleep 1
  done
  echo "$f"
}

# ─── 页面形态小工具 ───
page_classify() { px classify "$1" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('page',''))" 2>/dev/null || echo ""; }
chevron_dark() { px chevron "$1" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('dark',-1))" 2>/dev/null || echo "-1"; }
hint_band() { px hint-band "$1" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('band',0))" 2>/dev/null || echo "0"; }
login_btn() { px login-btn "$1" 2>/dev/null || echo '{"found":false,"x":0,"y":0,"rows":0}'; }
fab_center() { px fab-center "$1" 2>/dev/null || echo '{"x":0,"y":0}'; }

# 页面非空判定（blank=白屏/加载中；login=需登录）
page_ready() { [ "$1" != "blank" ] && [ "$1" != "login" ]; }

# ─── 幂等准备：确保 lynx client 状态（run-as 写 CapacitorStorage prefs） ───
set_client_kind_lynx() {
  # 与 MainActivity 分发、flow-check 同款：debug 包可 run-as；full 包默认 webview 必须改
  if adb shell "run-as $APP_ID sh -c '
    mkdir -p shared_prefs
    printf \"<?xml version=\\\"1.0\\\" encoding=\\\"utf-8\\\" standalone=\\\"yes\\\" ?>\n<map>\n    <string name=\\\"pictelio_client_kind\\\">lynx</string>\n</map>\n\" > shared_prefs/CapacitorStorage.xml' 2>/dev/null"; then
    ok "client kind = lynx（CapacitorStorage.xml 已写）"
  else
    warn "run-as 写 prefs 失败（需 debug 包；将按已安装状态继续）"
  fi
}

# ─── 自助登录（token 从 .env 读 PIXIV_REFRESH_TOKEN） ───
TOKEN=""
[ -f .env ] && TOKEN=$(grep -oE '^PIXIV_REFRESH_TOKEN=.*' .env | head -1 | cut -d= -f2- || true)

do_login() {
  local shot_path btn bx by p i
  shot_path=$(shot login_pre)
  btn=$(login_btn "$shot_path")
  if ! echo "$btn" | python3 -c "import json,sys; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
    warn "登录页未定位到紫色登录按钮，跳过自助登录"
    return 1
  fi
  [ -n "$TOKEN" ] || { ng "无 PIXIV_REFRESH_TOKEN（.env）——无法自助登录，请先用 UI 登录"; return 1; }
  bx=$(echo "$btn" | python3 -c "import json,sys; print(json.load(sys.stdin)['x'])")
  by=$(echo "$btn" | python3 -c "import json,sys; print(json.load(sys.stdin)['y'])")
  # 输入框 = 按钮上方固定相对位置（实测 y≈0.461H；按钮 y≈0.531H，此处直接 tap 再文本）
  adb shell input tap "$(sx 360)" "$(sy 590)"; sleep 1
  adb shell input text "$TOKEN"; sleep 0.8
  adb shell input keyevent 111; sleep 0.8 # ESC 收起键盘（flow-check 同款）
  adb shell input tap "$bx" "$by"; sleep 1
  say "   …等待登录完成"
  for i in $(seq 1 12); do
    sleep 2
    p=$(page_classify "$(shot login_wait_$i)")
    if page_ready "$p"; then
      ok "登录完成（页面=$p）"
      return 0
    fi
  done
  ng "登录后仍未进入内容页"
  return 1
}

# ─── 幂等启动：force-stop → am start → 等首屏；遇到登录页则自助登录 ───
relaunch() {
  local p ch i
  adb shell am force-stop "$APP_ID" || true
  sleep 1.5
  # full 包 launcher=MainActivity（路由到 LynxActivity）；lynx-only 包 launcher=LynxActivity
  adb shell am start -n "$APP_ID/.MainActivity" >/dev/null 2>&1 \
    || adb shell am start -n "$APP_ID/.LynxActivity" >/dev/null 2>&1
  say "   …等待首屏（bundle 加载 + 登录态恢复）"
  p="blank"
  for i in $(seq 1 15); do
    sleep 2
    p=$(page_classify "$(shot ready_$i)")
    # classify 对登录页返回「blank」（无顶部/无彩色块）→ 用紫色登录按钮补判登录态
    if [ "$p" = "blank" ]; then
      local lb
      lb=$(login_btn "$OUT_DIR/ready_$i.png" 2>/dev/null || true)
      if echo "$lb" | python3 -c "import json,sys; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
        p="login"
      fi
    fi
    if [ "$p" = "login" ]; then
      if ! do_login; then
        return 1
      fi
      p=$(page_classify "$(shot relogged_$i)")
    fi
    if page_ready "$p"; then
      ch=$(chevron_dark "$(shot _last_$i)" 2>/dev/null || echo 0)
      [ "${ch:-0}" -lt 30 ] && return 0
    fi
  done
  # 最后兜底：轮询窗口内未定型（模拟器慢启动常见）——若屏上已是登录页则补自助登录
  p=$(page_classify "$(shot ready_lastresort)")
  if [ "$p" != "login" ] && [ "$p" != "blank" ]; then
    warn "页面就绪但在详情页（chevron≥30）——按一次返回键后继续"
    adb shell input keyevent 4
    sleep 2
    return 0
  fi
  lb=$(login_btn "$(shot ready_lastresort)") || true
  if echo "$lb" | python3 -c "import json,sys; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
    warn "轮询窗口结束仍在登录页——补自助登录"
    if ! do_login; then
      ng "首屏等待超时（最后页面分类=$p）"
      return 1
    fi
    return 0
  fi
  ng "首屏等待超时（最后页面分类=$p）"
  return 1
}

# bundle 是否含 benchNav 钩子标记（__BENCH_NAV__ 注入时才存在字符串字面量）
# [lynx:fix×2] ①TASM 二进制用长度前缀编码（非 NUL 结尾）——strings 扫不出该串（实测恒 0），
#   必须 grep -a 二进制直扫；②set -o pipefail 下 grep -q 命中即退 → unzip 收 SIGPIPE(141) →
#   管道恒失败（实测：q 版恒 SKIP，c 版正常）——必须用 grep -c 消费全量再判计数
bundle_has_benchnav() {
  [ -f "$APK_PATH" ] || return 1
  local hit
  hit=$(unzip -p "$APK_PATH" assets/main.lynx.bundle 2>/dev/null | grep -a -c "pictelioBenchNav" || true)
  [ "${hit:-0}" -gt 0 ]
}

# 等待内容页真正有内容（classify colored>0.02），避免骨架屏/加载期点击落空
wait_content() {
  local i c
  c=0
  for i in $(seq 1 10); do
    c=$(px classify "$(shot content_$i)" 2>/dev/null | python3 -c "import json,sys; print(json.load(sys.stdin).get('colored',0.0))" 2>/dev/null || echo "0")
    if python3 -c "exit(0 if float('${c:-0}') > 0.02 else 1)" 2>/dev/null; then
      return 0
    fi
    sleep 2
  done
  warn "内容等待超时（colored=$c）——继续尝试"
  return 0
}

# ─── S1/S4 通用：进入插画详情页（benchNav 优先，UI 点击兜底） ───
# 进入详情 = 推荐页全宽首卡点击（实测 720x1280 下 (350,380) 命中；R18 遮罩吞点击 → 重试多位置）
enter_detail() {
  local shot_path i chev ch
  # ① benchNav（ADR-0136）：仅当 bundle 含钩子标记才尝试（full 包 extra 实际被丢弃，自动落到 ②）
  if bundle_has_benchnav; then
    say "   …尝试 benchNav illust（bundle 含钩子标记）"
    adb shell am start --es benchNav illust -n "$APP_ID/.MainActivity" >/dev/null 2>&1 || true
    sleep 8
    shot_path=$(shot bench_after)
    chev=$(chevron_dark "$shot_path")
    if [ "${chev:-0}" -ge 30 ]; then
      ok "benchNav 直达详情页（chevron=$chev）"
      return 0
    fi
    warn "benchNav 未生效（chevron=${chev:-?}）→ UI 点击兜底"
  fi
  # ② UI 点击兜底（full 包默认路径）：先等首卡图片渲染完成再点击
  wait_content
  for pos in "360 380" "270 500" "540 550"; do
    set -- $pos
    adb shell input tap "$(sx $1)" "$(sy $2)"; sleep 8
    shot_path=$(shot detail_try)
    ch=$(chevron_dark "$shot_path")
    if [ "${ch:-0}" -ge 30 ]; then
      ok "进入详情页 at ($1,$2)（chevron=$ch）"
      return 0
    fi
  done
  ng "未进入详情页（chevron=${ch:-?}）"
  return 1
}

# ─── 通用「返回已生效」判定（S1/S4）：chevron 消失 + 桥已触发 + 页面非空 ───
# $1 = logcat 基线（sendGlobalEvent pictelioBack 已有行数）
verify_back_effect() {
  local base="$1" shot_path p chev emits
  shot_path=$(shot back_after)
  p=$(page_classify "$shot_path")
  chev=$(chevron_dark "$shot_path")
  emits=$(adb logcat -d 2>/dev/null | grep -c "sendGlobalEvent pictelioBack" || true)
  if [ "${chev:-999}" -ge 0 ] && [ "$chev" -lt 30 ] && page_ready "$p"; then
    ok "返回已生效（chevron=$chev, page=$p, 桥触发 +$((emits - base)) 次）"
    return 0
  fi
  ng "返回未生效：chevron=$chev page=$p（桥触发 $((emits - base)) 次）"
  return 1
}

# ─── 场景 1：详情页返回键 → 回退上一页 ───
run_s1() {
  say "═══ S1 详情页返回键 → 回退上一页 ═══"
  relaunch || return 1
  enter_detail || return 1
  local base
  base=$(adb logcat -d 2>/dev/null | grep -c "sendGlobalEvent pictelioBack" || true)
  adb shell input keyevent 4
  sleep 2.5
  verify_back_effect "$base"
}

# ─── 场景 2：根路由返回键 → 「再按一次退出应用」提示条 ───
run_s2() {
  say "═══ S2 根路由返回键 → 提示条 ═══"
  relaunch || return 1
  local base shot_path band emits
  base=$(adb logcat -d 2>/dev/null | grep -c "sendGlobalEvent pictelioBack" || true)
  adb shell input keyevent 4
  sleep 0.45 # ADR-0137 时机：提示条存活 2s，必须在窗口内采样
  shot_path=$(shot s2_hint)
  band=$(hint_band "$shot_path")
  emits=$(adb logcat -d 2>/dev/null | grep -c "sendGlobalEvent pictelioBack" || true)
  if [ "${band:-0}" -ge 15 ] && [ $((emits - base)) -ge 1 ]; then
    ok "提示条可见（连续匹配行 $band，桥触发 $((emits - base)) 次）"
    return 0
  fi
  ng "提示条未检出（连续匹配行 $band，桥触发 $((emits - base)) 次）——检查 0.45s 采样时机与主题色"
  return 1
}

# ─── 场景 3：2s 窗口内再按返回键 → 退出应用（焦点回 launcher） ───
run_s3() {
  say "═══ S3 双击返回（2s 窗口）→ 退出应用 ═══"
  relaunch || return 1
  adb shell input keyevent 4
  sleep 0.5
  shot s3_hint >/dev/null # 证据：此刻提示条应可见（0.5s 已过渲染帧）
  adb shell input keyevent 4 # 距首按 ~1.0s → 在 2s 窗口内
  sleep 3                    # exitApp → LynxActivity finish
  local focus rows
  focus=$(adb shell dumpsys window 2>/dev/null | grep mCurrentFocus || true)
  if echo "$focus" | grep -qi launcher; then
    ok "已退出应用（焦点 = launcher）"
    rows=$(hint_band "$OUT_DIR/s3_hint.png")
    if [ "${rows:-0}" -ge 15 ]; then
      ok "第一次返回提示条证据也在（连续匹配行 $rows）"
    else
      warn "第一次返回提示条未捕获（$rows）——仅证据缺失，不影响退出判定"
    fi
    return 0
  fi
  ng "未退出应用（焦点仍为：$focus）——2s 窗口时序或 exitApp 桥有问题"
  return 1
}

# ─── 场景 4：侧滑手势返回（gesture nav；左缘横滑 → 同走 OnBackPressedDispatcher） ───
run_s4() {
  say "═══ S4 侧滑手势 → 回退上一页 ═══"
  local nav_mode
  nav_mode=$(adb shell settings get secure navigation_mode 2>/dev/null | tr -d '\r' || true)
  if [ "$nav_mode" != "2" ]; then
    warn "navigation_mode=$nav_mode（非 gesture）→ 启用 gestural 导航条"
    adb shell cmd overlay enable com.android.internal.systemui.navbar.gestural || true
    sleep 1.5
  fi
  relaunch || return 1
  enter_detail || return 1
  local base
  base=$(adb logcat -d 2>/dev/null | grep -c "sendGlobalEvent pictelioBack" || true)
  # 左缘横滑（起点物理 x≈0，终点整宽，250ms）——按宽度缩放
  adb shell input swipe 2 "$(sy 640)" "$(( WM_W - 4 ))" "$(sy 640)" 250
  sleep 2.5
  verify_back_effect "$base"
}

# ─── 场景 5：登出后返回键 → 提示条（不可回业务页） ───
run_s5() {
  say "═══ S5 登出（我的页）→ 返回键 → 提示条而非业务页 ═══"
  relaunch || return 1
  wait_content # 等推荐页内容就绪，再定位 FAB（否则 FAB 检测/点击落空）
  # ① FAB 菜单 → 「我的」外环项（外环 4 tab，/me 为最左底位，角度 -88°）
  local fshot fx fy R mx my i mshot me_ok
  fshot=$(shot fab_closed)
  fx=$(fab_center "$fshot" | python3 -c "import json,sys; print(json.load(sys.stdin)['x'])" 2>/dev/null || echo 0)
  fy=$(fab_center "$fshot" | python3 -c "import json,sys; print(json.load(sys.stdin)['y'])" 2>/dev/null || echo 0)
  if [ "${fx:-0}" -eq 0 ] || [ "${fy:-0}" -eq 0 ]; then
    fx=$(sx 636); fy=$(sy 1147) # 实测质心公式兜底（720x1280）
    warn "FAB 质心未检出，用公式坐标 ($fx,$fy)"
  fi
  R=$(( 35 * WM_W / 100 ))                     # 外环半径 35vw
  mx=$(( fx - R )); my=$(( fy - (10 * R / 287) )) # sin88°≈0.999、cos88°≈0.0349
  adb shell input tap "$fx" "$fy"; sleep 1.2   # 展开 FAB 菜单
  adb shell input tap "$mx" "$my"; sleep 3     # 点「我的」外环项
  # ② 确认到「我的」页（低彩列表 + 顶栏标题；未命中重试一次）
  me_ok=""
  for i in 1 2; do
    mshot=$(shot me_$i)
    if px me-page "$mshot" | python3 -c "import json,sys; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
      # 排除 /error、/update 等无 FAB 的页面（低彩+标题字同样能骗过 me-page 启发式）
      fx2=$(fab_center "$mshot" | python3 -c "import json,sys; print(json.load(sys.stdin)['x'])" 2>/dev/null || echo 0)
      if [ "${fx2:-0}" -gt 0 ]; then
        me_ok="yes"
        break
      fi
      warn "页面低彩但无 FAB（疑似 /error 或 /update 页）→ 重试"
    fi
    adb shell input tap "$fx" "$fy"; sleep 1.2
    adb shell input tap "$mx" "$my"; sleep 3
  done
  if [ -z "$me_ok" ]; then
    ng "未能进入「我的」页（FAB 环项 tap 可能失效——真机有先例，模拟器一般可用）"
    return 1
  fi
  ok "已进入「我的」页"
  # ③ 滚到底 → 定位「退出登录」（红色文字）→ 点按
  adb shell input swipe "$(sx 360)" "$(sy 1000)" "$(sx 360)" "$(sy 400)" 300; sleep 1.2
  adb shell input swipe "$(sx 360)" "$(sy 1000)" "$(sx 360)" "$(sy 400)" 300; sleep 1.5
  local rshot rx ry rcount
  rshot=$(shot me_bottom)
  rx=$(px red-text "$rshot" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['x'])" 2>/dev/null || echo 0)
  ry=$(px red-text "$rshot" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['y'])" 2>/dev/null || echo 0)
  rcount=$(px red-text "$rshot" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['count'])" 2>/dev/null || echo 0)
  if [ "${rcount:-0}" -lt 30 ]; then
    ng "未找到「退出登录」红字（count=$rcount）——滚动未到底或布局变更"
    return 1
  fi
  adb shell input tap "$rx" "$ry"; sleep 3
  # ④ 确认落在登录页（紫色登录按钮）
  local lshot lbtn err
  lshot=$(shot after_logout)
  lbtn=$(login_btn "$lshot")
  if ! echo "$lbtn" | python3 -c "import json,sys; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
    # 登出后未到登录页：用 logcat 找产品代码报错作诊断（如 WIP 的 resetHistory 未导入）
    err=$(adb logcat -d 2>/dev/null | grep -iE "ReferenceError|JSError|onAppJSError" | head -3 || true)
    ng "登出后未落到登录页（仍停留在旧页）；logcat 诊断：${err:-（无 JS 错误——点击可能未命中）}"
    return 1
  fi
  ok "已登出 → /login"
  # ⑤ 返回键 → 应见提示条（且仍在登录页——未回业务页）
  adb shell input keyevent 4
  sleep 0.45
  local hsh band hone
  hsh=$(shot s5_hint)
  band=$(hint_band "$hsh")
  if echo "$(login_btn "$hsh")" | python3 -c "import json,sys; exit(0 if json.load(sys.stdin).get('found') else 1)" 2>/dev/null; then
    hone="yes"
  else
    hone=""
  fi
  if [ "${band:-0}" -ge 15 ] && [ -n "$hone" ]; then
    ok "提示条可见且仍停留登录页（连续匹配行 $band）——登出后返回不可回业务页 ✓"
    return 0
  fi
  ng "登出后返回键行为异常（提示条连续匹配行 $band，仍在登录页=$([ -n "$hone" ] && echo yes || echo no)）"
  return 1
}

# ─── 场景 6：/update、/error（meta.backBehavior:'exit'）返回键直接退出 ───
# 前置：产品侧必须有外部触发通道（benchNav 新增 update/error 目标，ADR-0136 同款）。
# 当前产品代码无此通道（full 包 Intent 参数丢弃 + 默认 bundle 无 __BENCH_NAV__ +
# 版本检查 URL 固定为 GitHub 无法设备侧伪造）→ 本场景默认 SKIP（记录原因，不计失败）。
run_s6() {
  say "═══ S6 /update、/error meta-exit（返回键直接退出） ═══"
  if ! bundle_has_benchnav; then
    REASON="产品侧无外部触发通道（benchNav 缺 update/error 目标；version.json 不可伪造）——需产品先补钩子"
    warn "当前 bundle 无 benchNav 钩子（__BENCH_NAV__ 未注入），且产品无其他外部通道可进 /update、/error"
    warn "→ SKIP：$REASON"
    return 2
  fi
  # 前置满足才执行（产品侧补钩子后即生效）：benchNav 直达 → 校验页面 → 返回键 → 焦点 launcher
  # [lynx:fix] 必须冷启动：LynxActivity 已运行时 am start 只恢复旧实例，onLoadSuccess 不再触发，
  #    benchNav 广播不发出（实测直达失败停在登录页 → 返回键走根路由语义 → 本场景假 FAIL）
  local tgt label failed=0
  for tgt in update error; do
    [ "$tgt" = "update" ] && label="update（强制更新页）" || label="error（会话失效页）"
    say "   …benchNav $label"
    adb shell am force-stop "$APP_ID" || true
    sleep 1.5
    adb shell am start --es benchNav "$tgt" -n "$APP_ID/.MainActivity" >/dev/null 2>&1 || true
    sleep 8
    local shot_path chev p focus
    shot_path=$(shot "s6_${tgt}_page")
    chev=$(chevron_dark "$shot_path")
    p=$(page_classify "$shot_path")
    if ! page_ready "$p" || [ "${chev:-999}" -ge 0 ] && [ "$chev" -ge 30 ]; then
      ng "未识别到 /$tgt 页面（chevron=$chev page=$p）——或产品侧尚未补 benchNav 目标"
      failed=1
      continue
    fi
    adb shell input keyevent 4
    sleep 3
    focus=$(adb shell dumpsys window 2>/dev/null | grep mCurrentFocus || true)
    if echo "$focus" | grep -qi launcher; then
      ok "meta-exit 生效（/$tgt）：返回键直接退出（焦点 = launcher）"
    else
      ng "meta-exit 未生效（/$tgt）：焦点仍为：$focus"
      failed=1
    fi
  done
  [ "$failed" -eq 0 ] && return 0
  return 1
}

# ───────────────────────── 主流程 ─────────────────────────
say ""
say "════════ app-lynx 系统返回回归（Seam 3 / #334）════════"
say "设备: $ADB_SERIAL  屏幕: ${WM_W}x${WM_H}  APK: $APK_PATH"
say "场景: S1=$S1 S2=$S2 S3=$S3 S4=$S4 S5=$S5 S6=$S6  SKIP_INSTALL=$SKIP_INSTALL"
say "归档: $OUT_DIR（结尾不清除——wipe me）"
say ""

# 0. 前置检查
adb get-state >/dev/null 2>&1 || { say "❌ 无设备 $ADB_SERIAL（检查模拟器与 adb）"; exit 1; }
say "═ 0. 前置 ═"
if [ "$SKIP_INSTALL" != "1" ]; then
  local_apk="$(pwd)/${APK_PATH}" # APK_PATH 为相对 packages/app-lynx 的路径
  if [ ! -f "$local_apk" ]; then
    say "   …APK 不存在，先构建（gradlew assembleFullDebug）"
    ( cd ../app/android && ./gradlew -q assembleFullDebug )
  fi
  [ -f "$local_apk" ] || { say "❌ APK 仍不存在：$local_apk（assembleFullDebug 未产出，或 APK_PATH 配置错误）"; exit 1; }
  say "   …安装 $APK_PATH"
  adb install -r "$local_apk" >/dev/null 2>&1 || { say "❌ adb install 失败"; exit 1; }
else
  say "   …SKIP_INSTALL=1（使用已安装包）"
fi
set_client_kind_lynx

# 场景依次运行（各自独立 relaunch，某场景失败不中断后续——聚合成败汇报）
run_scenario() {
  local name="$1" fn="$2" rc
  say ""
  REASON=""
  set +e
  "$fn"
  rc=$?
  set -e
  case "$rc" in
    0) record "$name PASS" ;;
    2) record "$name SKIP${REASON:+：$REASON}" ;;
    *) record "$name FAIL" ;;
  esac
}

if [ "$S1" = "1" ]; then run_scenario "S1-返回键回退" run_s1; else record "S1 SKIP(--off)"; fi
if [ "$S2" = "1" ]; then run_scenario "S2-根路由提示条" run_s2; else record "S2 SKIP(--off)"; fi
if [ "$S3" = "1" ]; then run_scenario "S3-双击退出" run_s3; else record "S3 SKIP(--off)"; fi
if [ "$S4" = "1" ]; then run_scenario "S4-侧滑返回" run_s4; else record "S4 SKIP(--off)"; fi
if [ "$S5" = "1" ]; then run_scenario "S5-登出后返回" run_s5; else record "S5 SKIP(--off)"; fi
if [ "$S6" = "1" ]; then run_scenario "S6-meta-exit" run_s6; else record "S6 SKIP(--off)"; fi

# ─── 汇总 ───
say ""
say "════════ 结果汇总 ════════"
FAILED=0
for r in "${RESULTS[@]}"; do
  say "  $r"
  case "$r" in
    *FAIL*) FAILED=$((FAILED + 1)) ;;
  esac
done
if [ "$FAILED" -eq 0 ]; then
  say "✅ 全部通过（截图归档于 $OUT_DIR/，可清理）"
  exit 0
fi
say "❌ $FAILED 个场景失败（详情见上方日志；截图归档于 $OUT_DIR/）"
exit 1
