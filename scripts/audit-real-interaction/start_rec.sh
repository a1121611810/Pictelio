#!/usr/bin/env bash
# 录制辅助：start_rec <device> <remote_name> <seconds>  后台启动 screenrecord
#          stop_rec  <device>                            SIGINT 结束并 finalize
set -u
DEV="${1:?device}"
NAME="${2:?remote file name}"
SECS="${3:-20}"
adb -s "$DEV" shell "rm -f /sdcard/$NAME"
adb -s "$DEV" shell "screenrecord --time-limit $SECS --bit-rate 4M /sdcard/$NAME" >/dev/null 2>&1 &
echo "record pid: $! (/$NAME, ${SECS}s)"
