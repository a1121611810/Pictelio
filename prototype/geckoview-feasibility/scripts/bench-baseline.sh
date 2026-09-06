#!/usr/bin/env bash
# 基线（io.pictelio.app，Capacitor WebView）同口径 bench。
# 用法：bench-baseline.sh <phase>
set -uo pipefail
export PATH="$PATH:/Users/lilianda/Library/Android/sdk/platform-tools"
PKG=io.pictelio.app
ACT=$PKG/.MainActivity
TOKEN='LXa0TEPbcckouDoW5BJymPY01Q7guBjBW7_FB4apwGs'
OUT=/tmp/gvbench
PORT=9222
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$OUT"

cdp_forward() {
  SOCK=$(adb shell cat /proc/net/unix | grep 'webview_devtools_remote_' | sed 's/.*@//' | head -1)
  adb forward tcp:$PORT "localabstract:$SOCK" >/dev/null
}

coldstart() {
  adb shell pm clear "$PKG" >/dev/null 2>&1
  for i in 1 2 3 4 5; do
    adb shell am force-stop "$PKG"; adb logcat -c; sleep 2
    T=$(adb shell am start -W -n "$ACT" | grep -E 'TotalTime' | head -1)
    echo "run$i total=$T" | tee -a "$OUT/coldstart-baseline.txt"
    sleep 4
  done
}

login() {
  adb shell am force-stop "$PKG"; sleep 1
  adb shell am start -n "$ACT" >/dev/null
  sleep 8
  cdp_forward
  python3 "$HERE/cdp_eval.py" $PORT "document.querySelector('fluent-textarea').value='${TOKEN}'; document.querySelector('fluent-textarea').dispatchEvent(new Event('input',{bubbles:true})); 'filled'" | tee -a "$OUT/baseline-login.txt"
  sleep 1
  python3 "$HERE/cdp_eval.py" $PORT "Array.from(document.querySelectorAll('fluent-button')).find(b=>b.textContent.includes('登录')).click(); 'clicked'" | tee -a "$OUT/baseline-login.txt"
  sleep 12
  python3 "$HERE/cdp_eval.py" $PORT "location.pathname" | tee -a "$OUT/baseline-login.txt"
}

fps() {
  # 与原型相同手势：14 次 swipe；rAF 计数窗口 15s（CDP 注入）
  adb shell am force-stop "$PKG"; adb logcat -c; sleep 1
  adb shell am start -n "$ACT" >/dev/null
  sleep 10
  cdp_forward
  python3 "$HERE/cdp_eval.py" $PORT "(()=>{window.__fps={frames:0,long:0,t0:performance.now(),on:true};function tick(t){const f=window.__fps;f.frames++;if(t-f.last>32)f.long++;f.last=t;if(t-f.t0<15000)requestAnimationFrame(tick);else f.on=false;}window.__fps.last=performance.now();requestAnimationFrame(tick);'fps_started'})()" | tee -a "$OUT/fps-baseline.txt"
  for i in $(seq 1 14); do
    adb shell input swipe 540 1700 540 500 300
    sleep 0.9
  done
  sleep 3
  python3 "$HERE/cdp_eval.py" $PORT "(()=>{const f=window.__fps;const s=(f.last-f.t0)/1000;return 'fps='+(f.frames/s).toFixed(1)+' frames='+f.frames+' long32ms='+f.long+' window='+s.toFixed(1)+'s'})()" | tee -a "$OUT/fps-baseline.txt"
}

gfxscroll() {
  # gfxinfo 口径（WebView 可见；GeckoView 预期不可见——对照实验）
  adb shell dumpsys gfxinfo "$PKG" reset >/dev/null
  for i in $(seq 1 14); do
    adb shell input swipe 540 1700 540 500 300
    sleep 0.9
  done
  sleep 2
  adb shell dumpsys gfxinfo "$PKG" | sed -n '/Total frames rendered/,/95th/p' | head -8 | tee -a "$OUT/gfx-baseline.txt"
}

mem() {
  adb shell dumpsys meminfo "$PKG" | sed -n '/Total PSS by process/,/^$/p; /App Summary/,/^$/p' | head -30 | tee -a "$OUT/mem-baseline.txt"
  adb shell ps -A | grep "$PKG" | tee -a "$OUT/mem-baseline.txt"
}

rtt() {
  # Capacitor 桥 RTT（Preferences.get ×200）
  python3 "$HERE/cdp_eval.py" $PORT "(async()=>{const t=[];const P=Capacitor.Plugins.Preferences;for(let i=0;i<200;i++){const s=performance.now();await P.get({key:'rtt_probe'});t.push(performance.now()-s);}t.sort((a,b)=>a-b);return 'bridge_rtt n=200 avg='+(t.reduce((s,v)=>s+v,0)/t.length).toFixed(2)+'ms p50='+t[99].toFixed(2)+'ms p95='+t[189].toFixed(2)+'ms max='+t[199].toFixed(2)+'ms'})()" | tee -a "$OUT/rtt-baseline.txt"
  # API RTT（Java 网关全链路 ×10，novel/follow ~95KB 响应，与原型 __api 同口径）
  python3 "$HERE/cdp_eval.py" $PORT "(async()=>{const t=[];const P=Capacitor.Plugins.PixivApi;for(let i=0;i<10;i++){const s=performance.now();const r=await P.request({method:'GET',path:'/v1/novel/follow'});t.push(performance.now()-s);}t.sort((a,b)=>a-b);return 'api_rtt n=10 p50='+t[4].toFixed(0)+'ms p95='+t[8].toFixed(0)+'ms min='+t[0].toFixed(0)+'ms max='+t[9].toFixed(0)+'ms'})()" | tee -a "$OUT/rtt-baseline.txt"
}

case "${1:-all}" in
  coldstart) coldstart ;;
  login) login ;;
  fps) fps ;;
  gfxscroll) gfxscroll ;;
  mem) mem ;;
  rtt) rtt ;;
  all) coldstart; login; fps; gfxscroll; mem; rtt ;;
esac
echo "=== done phase=$1 ==="
