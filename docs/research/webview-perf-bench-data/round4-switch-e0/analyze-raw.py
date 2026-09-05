#!/usr/bin/env python3
import re, glob, os, json

files = sorted(glob.glob('/tmp/switch-e0/raw/gfx-*.txt'), key=lambda f: int(re.search(r'gfx-(\d+)', f).group(1)))
COLS = "Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,FrameStartTime,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime,CommandSubmissionCompleted".split(',')
frames_seen = {}   # IntendedVsync -> dict(first_file_ts, vals)
dumps = []
for f in files:
    ts = int(re.search(r'gfx-(\d+)', f).group(1))
    txt = open(f, encoding='utf-8', errors='replace').read()
    total = re.search(r'Total frames rendered: (\d+)', txt)
    stats_since = re.search(r'Stats since: (\d+)ns', txt)
    rows = []
    m = re.search(r'---PROFILEDATA---\n(.*?)---PROFILEDATA---', txt, re.S)
    if m:
        for line in m.group(1).strip().split('\n'):
            if not re.match(r'^\d+,\d+,', line): continue
            c = line.split(',')
            if len(c) < 22: continue
            rows.append({COLS[i]: (int(c[i]) if c[i] != '' else None) for i in range(22)})
    dumps.append({'ts': ts, 'total': int(total.group(1)) if total else None,
                  'stats_since': int(stats_since.group(1)) if stats_since else None, 'rows': rows})
    for r in rows:
        iv = r['IntendedVsync']
        if iv not in frames_seen:
            frames_seen[iv] = {'first_seen_ts': ts, **r}

# bench-style parse for comparison
def bench_parse(txt):
    frames = []
    m = re.search(r'---PROFILEDATA---\n(.*?)---PROFILEDATA---', txt, re.S)
    if not m: return frames
    for line in m.group(1).strip().split('\n'):
        if not re.match(r'^\d+,\d+,', line): continue
        c = line.split(',')
        if len(c) < 21: continue
        iv = int(c[2]); hs = int(c[5]); dl = int(c[9]); fi = int(c[11]); fc = int(c[15])
        if not fi or fi < 1e6 or fi > 1e9: continue
        if not fc or fc <= iv: continue
        frames.append({'bench_totalMs': (fc-iv)/1e6, 'bench_deadlineMs': (dl-iv)/1e6,
                       'bench_unknownDelayMs': (hs-iv)/1e6})
    return frames

print("=== dump timeline (ts=wallclock ms; total=Total frames rendered; nrows=PROFILEDATA rows; stats_since) ===")
for d in dumps:
    t = d['ts']
    print(f"{t} total={d['total']} nrows={len(d['rows'])} stats_since_delta_from_prev={d['stats_since']}")

print("\n=== unique frames (first appearance order), bench-style vs true ===")
print(f"{'IntendedVsync':>16} {'first_seen':>12} {'bench_total':>11} {'true_total':>10} {'deadline':>8} {'swapbufs_tail':>13} {'gpu_tail':>9} {'jank_bench':>10} {'jank_true':>9}")
for iv, fr in sorted(frames_seen.items()):
    bt = (fr['SwapBuffers'] - iv)/1e6
    tt = (fr['FrameCompleted'] - iv)/1e6
    dl = (fr['FrameDeadline'] - iv)/1e6
    tail = (fr['FrameCompleted'] - fr['SwapBuffers'])/1e6
    gpu = (fr['GpuCompleted'] - fr['SwapBuffers'])/1e6
    print(f"{iv:>16} {fr['first_seen_ts']:>12} {bt:>11.2f} {tt:>10.2f} {dl:>8.2f} {tail:>13.2f} {gpu:>9.2f} {str(bt>dl):>10} {str(tt>dl):>9}")

print("\n=== bench-parse reproducibility per dump ===")
for d in dumps:
    bp = bench_parse(open(d['ts'] and f"/tmp/switch-e0/raw/gfx-{d['ts']}.txt", encoding='utf-8', errors='replace').read())
    print(f"{d['ts']}: bench-parse frames={len(bp)} nrows={len(d['rows'])}")
