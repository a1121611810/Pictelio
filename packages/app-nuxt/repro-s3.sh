#!/usr/bin/env bash
# PROTOTYPE — S2/S3 链路复现 v3（显式 force-stop + PID 取证）
set -u
ADB="adb -s emulator-5556"
PKG=io.pictelio.nuxtproto
cd "$(dirname "$0")"

pid() { $ADB shell pidof $PKG | tr -d '\r'; }

hard_restart() { # force-stop + 起停间隔拉满（-S 在此模拟器不可靠）
  $ADB shell am force-stop $PKG
  sleep 2
  $ADB shell am start -n $PKG/.MainActivity >/dev/null
  sleep 6
}

echo "── 复位：卸载重装，good-v2 在服务器 ──"
cp ota-dist/good-v2/* /tmp/ota-server/
$ADB uninstall $PKG >/dev/null 2>&1
$ADB install android/app/build/outputs/apk/debug/app-debug.apk >/dev/null
$ADB reverse tcp:8899 tcp:8899 >/dev/null
$ADB logcat -c
$ADB shell am start -n $PKG/.MainActivity >/dev/null; sleep 7
echo "pid=$(pid)  ── v1 自动装 v2 ──"
$ADB logcat -d | grep "OTAPROTO" | grep -E "install-ok|install-rejected" | tail -1 | tr -d '\r'

echo "── 硬重启：adopt v2，页面应为 web v2 ──"
$ADB logcat -c
hard_restart
echo "pid=$(pid)"
$ADB logcat -d | grep "OTAPROTO" | grep -E "adopt|notifyReady" | tail -2 | tr -d '\r'
$ADB shell "uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; grep -o 'text=\"web 版本：[^\"]*\"' /sdcard/ui.xml | head -1" | tr -d '\r'

echo "── v2 上装 broken-v3，硬重启，等 10s 回滚 ──"
cp ota-dist/broken-v3/bundle.zip ota-dist/broken-v3/manifest.json ota-dist/broken-v3/manifest.json.sig /tmp/ota-server/
$ADB logcat -c
hard_restart
echo "pid=$(pid)"
sleep 13
$ADB logcat -d | grep "OTAPROTO" | grep -E "adopt|install|rollback|applyPointer|notifyReady" | tail -6 | tr -d '\r'
$ADB shell "uiautomator dump /sdcard/ui.xml >/dev/null 2>&1; grep -o 'text=\"web 版本：[^\"]*\"' /sdcard/ui.xml | head -1" | tr -d '\r'
$ADB exec-out screencap -p > screenshot-ota-rollback.png && echo "截图：screenshot-ota-rollback.png"
