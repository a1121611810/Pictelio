#!/bin/zsh
TIER=$1
cd /Users/lilianda/develop/pixivizer/packages/app
rm -f /tmp/switch-e3/bench-$TIER.log
node scripts/bench-webview-nav.mjs switch --serial emulator-5554 --groups 10 --out /tmp/switch-e3$TIER > /tmp/switch-e3/bench-$TIER.log 2>&1 &
BPID=$!
until grep -q "应用就绪" /tmp/switch-e3/bench-$TIER.log 2>/dev/null; do sleep 0.15; done
node /tmp/switch-e3/inject.mjs $TIER
wait $BPID
cat /tmp/switch-e3/bench-$TIER.log
