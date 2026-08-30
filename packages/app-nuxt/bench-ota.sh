#!/usr/bin/env bash
# PROTOTYPE（#245）— OTA 四场景最终编排：每步 install 与 restart 分离，全自动（无 tap）
set -u
ADB="adb -s emulator-5556"
PKG=io.pictelio.nuxtproto
cd "$(dirname "$0")"
DIST=ota-dist
SRV=/tmp/ota-server

serve() { cp "$DIST/$1/"* "$SRV/" 2>/dev/null; }
hard() { $ADB shell am force-stop $PKG; sleep 2; $ADB shell am start -n $PKG/.MainActivity >/dev/null; sleep 6; }
badge() { $ADB shell "uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; grep -o 'text=\"web 版本：[^\"]*\"' /sdcard/ui.xml | head -1" | tr -d '\r'; }
otalog() { $ADB logcat -d | grep "OTAPROTO" | grep -E "$1" | tail -"${2:-1}" | tr -d '\r'; }

mkdir -p "$SRV"
pkill -f "http.server 8899" 2>/dev/null; sleep 1
serve good-v2
(cd "$SRV" && nohup python3 -m http.server 8899 >/dev/null 2>&1 &)
sleep 1
$ADB reverse tcp:8899 tcp:8899 >/dev/null

echo "═══ S0 基线：卸载重装，内置 v1 自动安装 v2 → pending ═══"
$ADB uninstall $PKG >/dev/null 2>&1
$ADB install android/app/build/outputs/apk/debug/app-debug.apk >/dev/null
$ADB logcat -c
$ADB shell am start -n $PKG/.MainActivity >/dev/null; sleep 7
otalog "install-ok|gate-ok"
echo "badge: $(badge)"

echo
echo "═══ S1 坏签名：自动安装被拒，保持 v1 ═══"
serve bad-sig
$ADB logcat -c
hard
otalog "install-rejected"
echo "badge: $(badge)"

echo
echo "═══ S2 好 bundle：pending=v2 → 重启 adopt → 健康上报 ═══"
serve good-v2
$ADB logcat -c
hard
otalog "adopt-pending|notifyReady-ok" 2
echo "badge: $(badge)"

echo
echo "═══ S3 broken v3：pending=v3 → 重启 adopt → 10s 超时回滚 v2 ═══"
serve broken-v3
$ADB logcat -c
hard   # v2 页面加载，自动安装 broken-v3 → pending=v3
otalog "install-ok version=v3"
$ADB logcat -c
hard   # adopt v3 → 启动即崩 → 10s 回滚
sleep 8 # 越过 10s 定时器
otalog "adopt-pending|rollback-timeout|notifyReady" 3
echo "badge: $(badge)"
$ADB exec-out screencap -p > screenshot-ota-rollback.png && echo "截图：screenshot-ota-rollback.png"

echo
echo "═══ S4 强制门槛：floor=99 → 自愈失败（404）→ 阻断 ═══"
serve gate
rm -f "$SRV/bundle.zip" "$SRV/manifest.json" "$SRV/manifest.json.sig"
$ADB logcat -c
hard
sleep 3
otalog "gate-triggered|self-heal failed" 2
echo "badge: $(badge)"
$ADB exec-out screencap -p > screenshot-ota-gate.png && echo "截图：screenshot-ota-gate.png"

echo
echo "═══ done ══"
