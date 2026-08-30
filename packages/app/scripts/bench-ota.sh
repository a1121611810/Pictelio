#!/usr/bin/env bash
# ─── OTA 生产四场景 bench（#256）───
# 在 emulator 上验证 packages/app 生产构建的四场景：
#   场景① 好包 → 下次启动生效（静默）
#   场景② 坏签名 → 拒装（pending 不写）
#   场景③ 崩包 → 10s 回滚 lastGood
#   场景④ 门槛 floor → 阻断（需 OTA 自愈失败才可见；先验证 floor 触发自愈链路）
# 前置：模拟器 emulator-5556 已启动；APK 已构建；OTA 服务器已起（python3 -m http.server 8899）
# 用法：bash packages/app/scripts/bench-ota.sh
set -euo pipefail

ADB=~/Library/Android/sdk/platform-tools/adb
PKG=io.pictelio.app
OTA_SERVER=http://127.0.0.1:8899
APK=/Users/lilianda/develop/pixivizer/packages/app/android/app/build/outputs/apk/webview/debug/app-webview-debug.apk
SLEEP=${SLEEP:-2}

say()  { printf "\n\033[1;34m== %s ==\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m  ✓ %s\033[0m\n" "$*"; }
fail() { printf "\033[1;31m  ✗ %s\033[0m\n" "$*"; }

# ── 打包三件套（本地 OTA 服务器）──
# 用 release-bundle.mjs 打一个版本目录（改 index.html 标题为版本号便于观察）
prepare_bundle() {
  local version="$1" broken="${2:-}"
  local dist_dir="/tmp/ota-bench-dist"
  rm -rf "$dist_dir"; mkdir -p "$dist_dir"
  # 用已构建的 web 产物（改标题便于识别版本）
  cp -r /Users/lilianda/develop/pixivizer/packages/app/dist/. "$dist_dir/" 2>/dev/null || true
  # 基于真实构建产物改造 index.html：替换 <title> 为版本号（保留 /assets/ 引用过防呆）
  python3 - "$dist_dir/index.html" "${version}${broken}" <<'PYEOF'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
html = p.read_text()
v = sys.argv[2]
html = html.replace("<title>", f"<title>OTA-BENCH-{v} ")
if "OTA-BENCH-" not in html:
    html = html.replace("</head>", f"<title>OTA-BENCH-{v}</title></head>", 1)
p.write_text(html)
PYEOF
  [ -n "$broken" ] && echo "<script>throw new Error('ota-broken')</script>" >> "$dist_dir/index.html"
  node /Users/lilianda/develop/pixivizer/packages/app/scripts/release-bundle.mjs \
    --dist "$dist_dir" --version "$version" --out /tmp/ota-bench-out --min-apk 1.0.0
  # 服务器目录需要三件套平铺 + 版本化子目录（用 bundle 名）
  rm -rf /tmp/ota-server; mkdir -p /tmp/ota-server
  cp /tmp/ota-bench-out/pictelio-${version}-web-bundle.zip /tmp/ota-server/pictelio-bench-web-bundle.zip
  cp /tmp/ota-bench-out/pictelio-${version}-manifest.json /tmp/ota-server/pictelio-bench-manifest.json
  cp /tmp/ota-bench-out/pictelio-${version}-manifest.json.sig /tmp/ota-server/pictelio-bench-manifest.json.sig
  # 服务器 version.json（floor 场景）
  cat > /tmp/ota-server/version.json <<EOF
{"version":"9.9.9","minWebVersion":"${OTA_FLOOR:-9.9.9}","webBundle":{"version":"${version}","url":"${OTA_SERVER}"}}
EOF
  say "bundle ${version}${broken} 已打包 → /tmp/ota-server"
}

# ── 装 APK + 清 OTA 状态 ──
install_apk() {
  say "安装 APK（清数据保证干净基线）"
  $ADB -s emulator-5556 install -r "$APK" >/dev/null
  $ADB -s emulator-5556 shell pm clear "$PKG" >/dev/null 2>&1 || true
  $ADB -s emulator-5556 reverse tcp:8899 tcp:8899 || true
  ok "APK 已装，adb reverse 已配"
}

# ── 启动 app 并等首屏 ──
launch() {
  $ADB -s emulator-5556 shell am force-stop "$PKG" || true
  sleep "$SLEEP"
  $ADB -s emulator-5556 shell am start -n "$PKG/.MainActivityWebview" >/dev/null
  sleep 6
}

# ── 检查当前加载的 bundle 版本（WebView CDP 读 document.title）──
current_version() {
  # 通过 CDP 端口转发读页面标题（WebView debug 构建已开 WebContentsDebugging）
  local port=9223
  $ADB -s emulator-5556 forward tcp:$port localabstract:webview_devtools_remote_$port >/dev/null 2>&1 || true
  # 简化：用 logcat 的 OtaPlugin 标记（比 CDP 稳）
  $ADB -s emulator-5556 logcat -d -s OtaPlugin 2>/dev/null | tail -3
}

scenario1_good_bundle() {
  say "场景①：好包 → 下次启动生效"
  prepare_bundle "2.0.0"
  launch
  # 触发安装（JS 侧 T0 预热逻辑经 native prewarm 入队；这里直接经 CDP 调插件不可行，
  # 用 logcat 观察：启动检查 → prewarm → install-ok）
  $ADB -s emulator-5556 logcat -c
  # 重启触发 adopt
  $ADB -s emulator-5556 shell am force-stop "$PKG"; sleep 1
  $ADB -s emulator-5556 shell am start -n "$PKG/.MainActivityWebview" >/dev/null
  sleep 6
  $ADB -s emulator-5556 logcat -d -s OtaPlugin 2>/dev/null | grep -E "adopt-pending|install-ok|applyPointer" | tail -5
}

scenario2_bad_signature() {
  say "场景②：坏签名 → 拒装"
  prepare_bundle "2.1.0"
  # 篡改签名
  echo "corrupted" >> /tmp/ota-server/manifest.json.sig
  launch
  sleep 8
  $ADB -s emulator-5556 logcat -d -s OtaPlugin 2>/dev/null | grep -E "bad-signature|install-rejected" | tail -3
}

scenario3_broken_rollback() {
  say "场景③：崩包 → 10s 回滚"
  prepare_bundle "2.2.0" "BROKEN"
  launch
  sleep 12
  $ADB -s emulator-5556 logcat -d -s OtaPlugin 2>/dev/null | grep -E "rollback|notifyReady-ignored|回滚" | tail -5
}

scenario4_gate() {
  say "场景④：门槛 floor → 自愈/阻断"
  OTA_FLOOR=9.9.9 prepare_bundle "3.0.0"
  launch
  sleep 8
  $ADB -s emulator-5556 logcat -d -s OtaPlugin 2>/dev/null | grep -E "门槛|gate|自愈|install" | tail -5
}

main() {
  install_apk
  scenario1_good_bundle
  scenario2_bad_signature
  scenario3_broken_rollback
  scenario4_gate
  say "bench 完成（各场景输出见上，判定依据 logcat OtaPlugin 标记）"
}

main "$@"
