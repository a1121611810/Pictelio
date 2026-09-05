#!/bin/zsh
ADB=$HOME/Library/Android/sdk/platform-tools/adb
SERIAL=emulator-5554
OUT=/tmp/switch-e0/raw
mkdir -p $OUT
end=$((SECONDS+70))
while [ $SECONDS -lt $end ]; do
  ts=$(python3 -c 'import time;print(int(time.time()*1000))')
  $ADB -s $SERIAL shell "dumpsys gfxinfo io.pictelio.app framestats" > $OUT/gfx-$ts.txt 2>&1
  sleep 0.3
done
