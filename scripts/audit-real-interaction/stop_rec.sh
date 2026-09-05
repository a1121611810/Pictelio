#!/usr/bin/env bash
# stop_rec <device>：SIGINT 结束 screenrecord（finalize mp4）
set -u
DEV="${1:?device}"
adb -s "$DEV" shell "pkill -2 screenrecord" 2>/dev/null || true
sleep 1
