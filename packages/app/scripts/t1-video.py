#!/usr/bin/env python3
"""T1 视频判读（wayfinder #306/#312）：screenrecord + Show taps → 触摸→内容首帧时延。

输入：mp4（设备录屏，含「显示点按」白点）+ 注入起点/终点物理坐标。
输出：latencyMs（白点出现帧 → 内容帧差首帧）×帧间隔；打印一行 JSON。

用法：t1-video.py <video.mp4> <tapX> <tapY> [--fps-auto]
"""
import json
import sys

import cv2
import numpy as np

video, tap_x, tap_y = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])

cap = cv2.VideoCapture(video)
fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
dt_ms = 1000.0 / fps
n_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

# 状态栏/底部屏蔽带（比例，兼容不同分辨率）
STATUS_H = 0.09  # 顶部 9% 屏蔽（状态栏）
BOTTOM_H = 0.09  # 底部 9% 屏蔽（导航条/FAB 附近）

frames = []
while True:
    ok, img = cap.read()
    if not ok:
        break
    frames.append(img)
cap.release()

if len(frames) < 3:
    print(json.dumps({"error": "帧数过少"})); sys.exit(1)
h, w = frames[0].shape[:2]
# ROI：白点检测区（注入起点附近 ±60px，限制在图内）
r0x, r0y = max(0, tap_x - 60), max(0, tap_y - 60)
roi = (slice(r0y, min(h, tap_y + 60)), slice(r0x, min(w, tap_x + 60)))
# 内容区（屏蔽状态栏/底条）：全图灰度
top = int(h * STATUS_H)
bot = int(h * (1 - BOTTOM_H))

def white_count(img):
    g = cv2.cvtColor(img[roi], cv2.COLOR_BGR2GRAY)
    return int((g > 200).sum())

def frame_gray(img):
    return cv2.cvtColor(img[top:bot, :], cv2.COLOR_BGR2GRAY)

wcs = [white_count(f) for f in frames]
# 白点出现：白像素计数显著提升（阈值 = 基线 + 15 或 300px）
base_wc = sorted(wcs)[max(0, len(wcs) // 4)]
thr = max(base_wc + 300, int(base_wc * 1.8) + 200)
tap_idx = None
for i, wc in enumerate(wcs):
    if wc >= thr:
        tap_idx = i
        break

grays = [frame_gray(f) for f in frames]
diffs = [cv2.absdiff(grays[i], grays[i - 1]).mean() for i in range(1, len(grays))]
# 内容首帧差：背景噪底（四分之一分位）显著抬升
base_d = sorted(diffs[max(0, len(diffs) // 4)])
base_d = base_d[0] if base_d else 0
d_thr = max(base_d * 1.8 + 1.0, base_d + 2.0)
move_idx = None
search_from = (tap_idx if tap_idx is not None else 0)
for i in range(search_from, len(diffs)):
    if diffs[i] >= d_thr:
        move_idx = i + 1  # diff i 对应 frames[i+1] 与 frames[i]
        break

if tap_idx is None or move_idx is None or move_idx <= tap_idx:
    print(json.dumps({
        "error": "判读失败", "tap_idx": tap_idx, "move_idx": move_idx,
        "fps": round(fps, 2), "frames": len(frames),
        "wc_base": base_wc, "wc_thr": thr, "diff_base": round(base_d, 2), "diff_thr": round(d_thr, 2),
    })); sys.exit(0)

latency_ms = (move_idx - tap_idx) * dt_ms
print(json.dumps({
    "latencyMs": round(latency_ms, 1),
    "tapFrame": tap_idx, "moveFrame": move_idx, "deltaFrames": move_idx - tap_idx,
    "fps": round(fps, 2), "frameDtMs": round(dt_ms, 2), "frames": len(frames),
}))
