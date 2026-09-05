#!/usr/bin/env python3
"""VFR screenrecord 逐帧分析工具（#362 真实交互体检）

输入: adb screenrecord 录制的 mp4（VFR：帧间隔=可见变化间隔）
输出: JSON（每帧 pts 时间戳 + 与前一帧差异量），并可选导出关键帧 PNG

用法:
  python3 analyze_rec.py <in.mp4> --out <out.json> [--keyframes-prefix p] [--save-frames a,b,c]

依赖: imageio_ffmpeg（自带 ffmpeg 二进制）、numpy、PIL
"""
import argparse
import json
import os
import re
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image

from imageio_ffmpeg import get_ffmpeg_exe

FFMPEG = get_ffmpeg_exe()


def probe_pts(mp4_path: str):
    """解析每帧 pts_time（秒），返回列表 float"""
    proc = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", mp4_path,
         "-vf", "showinfo", "-f", "null", "-"],
        capture_output=True, text=True,
    )
    pts_list = []
    for m in re.finditer(r"showinfo.*n:\s*(\d+)\s+pts:\s*(-?\d+)\s+pts_time:([\d.]+)", proc.stderr):
        pts_list.append(float(m.group(3)))
    return pts_list


def extract_frames(mp4_path: str, out_dir: str):
    subprocess.run(
        [FFMPEG, "-hide_banner", "-loglevel", "error", "-i", mp4_path,
         "-vsync", "0", "-q:v", "3", os.path.join(out_dir, "%05d.jpg")],
        check=True,
    )
    return sorted(os.listdir(out_dir))


def frame_diff(path_a: str, path_b: str) -> float:
    """降采样灰度图均方差差异，0~255 归一化"""
    a = np.asarray(Image.open(path_a).convert("L").resize((90, 160)), dtype=np.float32)
    b = np.asarray(Image.open(path_b).convert("L").resize((90, 160)), dtype=np.float32)
    return float(np.abs(a - b).mean())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mp4")
    ap.add_argument("--out", required=True)
    ap.add_argument("--keyframes-prefix", default=None,
                    help="若给，diff 超过阈值的关键帧另存 PNG，前缀+帧号")
    ap.add_argument("--save-frames", default="",
                    help="逗号分隔帧号（1-based），另存为 PNG（用于报告插图）")
    ap.add_argument("--diff-threshold", type=float, default=2.0,
                    help="判定为显著变化的 diff 阈值（默认 2.0）")
    args = ap.parse_args()

    pts = probe_pts(args.mp4)
    if not pts:
        print("ERROR: no pts parsed", file=sys.stderr)
        sys.exit(1)

    workdir = tempfile.mkdtemp(prefix="recframes_")
    names = extract_frames(args.mp4, workdir)
    if len(names) != len(pts):
        # pts 与实际解码帧数不齐时以实际帧为准，重取 pts（防御）
        pts = pts[:len(names)]

    frames = []
    prev = None
    for i, name in enumerate(names):
        full = os.path.join(workdir, name)
        d = frame_diff(prev, full) if prev else 0.0
        prev = full
        frames.append({
            "n": i + 1,
            "pts_ms": round(pts[i] * 1000),
            "delta_ms": round((pts[i] - pts[i - 1]) * 1000) if i > 0 else 0,
            "diff": round(d, 3),
        })

    # 显著变化段（diff > threshold 的连续区间）
    segments = []
    start = None
    for f in frames:
        if f["diff"] > args.diff_threshold and start is None:
            start = f
        elif f["diff"] <= args.diff_threshold and start is not None:
            segments.append({"from_ms": start["pts_ms"], "to_ms": f["pts_ms"],
                             "peak_diff": max(x["diff"] for x in frames if start["pts_ms"] <= x["pts_ms"] < f["pts_ms"])})
            start = None
    if start is not None:
        segments.append({"from_ms": start["pts_ms"], "to_ms": frames[-1]["pts_ms"], "peak_diff": None})

    # 长静止段（delta 累计 > 200ms 无变化）——卡顿信号
    stalls = []
    stall_start = None
    for i in range(1, len(frames)):
        if frames[i]["diff"] <= args.diff_threshold:
            if stall_start is None:
                stall_start = frames[i - 1]["pts_ms"]
        else:
            if stall_start is not None and frames[i]["pts_ms"] - stall_start > 200:
                stalls.append({"from_ms": stall_start, "to_ms": frames[i]["pts_ms"],
                               "duration_ms": frames[i]["pts_ms"] - stall_start})
            stall_start = None

    out = {
        "mp4": os.path.basename(args.mp4),
        "frame_count": len(frames),
        "duration_ms": frames[-1]["pts_ms"],
        "mean_fps": round(len(frames) / (frames[-1]["pts_ms"] / 1000), 2) if frames[-1]["pts_ms"] > 0 else 0,
        "vfr": True,
        "diff_threshold": args.diff_threshold,
        "frames": frames,
        "change_segments": segments,
        "stalls_over_200ms": stalls,
    }

    # 关键帧导出
    if args.keyframes_prefix:
        saved = 0
        prev_kept = -10**9
        for f in frames:
            if f["diff"] > args.diff_threshold and f["pts_ms"] - prev_kept >= 120:
                src = os.path.join(workdir, names[f["n"] - 1])
                Image.open(src).save(f"{args.keyframes_prefix}_f{f['n']:05d}_t{f['pts_ms']}ms.png")
                prev_kept = f["pts_ms"]
                saved += 1
    if args.save_frames:
        for n in args.save_frames.split(","):
            n = int(n.strip())
            if 1 <= n <= len(names):
                src = os.path.join(workdir, names[n - 1])
                Image.open(src).save(f"frame_{n:05d}_t{frames[n-1]['pts_ms']}ms.png")

    with open(args.out, "w") as fp:
        json.dump(out, fp, ensure_ascii=False, indent=1)
    print(f"OK {len(frames)} frames, {frames[-1]['pts_ms']}ms, "
          f"{len(segments)} segments, {len(stalls)} stalls -> {args.out}")


if __name__ == "__main__":
    main()
