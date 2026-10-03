#!/bin/bash
# PROTOTYPE / THROWAWAY —— 交错 ABBA A/B（2026-10-04 原型，测完即删）
#
# 目的：把宿主机负载漂移从 IFR 效应里分离。
#   做法：两个埋点完全一致、仅 enableIFR 不同的 release 包，ABBA 交替
#         （每轮内部 ON/OFF 反序、整体逐轮再反转，抵消顺序效应），
#         按**配对差**统计而不是比较两组绝对值。
#
# 踩过的坑：非交错批次（先跑完 ON 再跑 OFF）给出过 +147ms 和 +81ms 两个
#          不同的数，而同配置不同批次漂移达 66ms，与效应量同量级 ⇒ 不作数。
#
# 用法: probe.sh [设备] [对数]
#   依赖: /tmp/pictelifr-ON.apk 与 /tmp/pictelifr-OFF.apk（见 README 复现步骤）

DEV=${1:-emulator-5554}
N=${2:-5}
PKG=io.pictelio.app
ACT=.LynxActivity

one_run() {  # $1=apk  $2=label  $3=idx
  adb -s "$DEV" install -r -g "$1" >/dev/null 2>&1
  adb -s "$DEV" shell am force-stop "$PKG" >/dev/null 2>&1
  sleep 2
  adb -s "$DEV" logcat -c >/dev/null 2>&1
  adb -s "$DEV" shell am start -n "$PKG/$ACT" >/dev/null 2>&1
  sleep 7
  local ev scv firstdraw
  ev=$(adb -s "$DEV" logcat -d -s PICO_PROTO:I 2>/dev/null | sed 's/^.*PICO_PROTO: *//')
  scv=$(echo "$ev" | grep -o 'setContentView_done @[0-9-]*ms' | grep -o '[0-9-]*ms' | tr -d 'ms')
  firstdraw=$(echo "$ev" | grep -o 'lynxView_FIRST_DRAW @[0-9-]*ms' | grep -o '[0-9-]*ms' | tr -d 'ms')
  echo "$2#$3 scv=${scv:-NA}ms firstdraw=${firstdraw:-NA}ms"
}

for i in $(seq 1 "$N"); do
  if [ $((i % 2)) -eq 1 ]; then
    one_run /tmp/pictelifr-OFF.apk OFF "$i"
    one_run /tmp/pictelifr-ON.apk  ON  "$i"
  else
    one_run /tmp/pictelifr-ON.apk  ON  "$i"
    one_run /tmp/pictelifr-OFF.apk OFF "$i"
  fi
done
echo "===== ABBA DONE ====="
