#!/bin/zsh
cd /Users/lilianda/develop/pixivizer/packages/app
node scripts/bench-webview-nav.mjs switch --serial emulator-5554 --groups 2 --out /tmp/switch-e0 2>&1 | while IFS= read -r l; do print "$(date '+%H:%M:%S') $l"; done
