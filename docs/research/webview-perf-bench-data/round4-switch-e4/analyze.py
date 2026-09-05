#!/usr/bin/env python3
import json, sys, collections
for mode in ("forward", "back"):
    d = json.load(open(f"/tmp/switch-e4/trace-{mode}.json"))
    evs = d["events"]
    xs = [e for e in evs if e.get("ph") == "X"]
    if not xs: print(f"{mode}: no X events"); continue
    t0 = min(e["ts"] for e in xs)
    # 线程识别：tid → 聚合时长
    by_tid = collections.Counter()
    for e in xs: by_tid[e.get("tid")] += e.get("dur", 0)
    main_tid = by_tid.most_common(1)[0][0]
    # 事件名聚合（全线程 / 主线程）
    agg_all = collections.defaultdict(lambda: [0, 0.0, 0.0])   # name -> [count, totalDur, maxDur]
    agg_main = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for e in xs:
        a = agg_all[e["name"]]; a[0] += 1; a[1] += e.get("dur", 0); a[2] = max(a[2], e.get("dur", 0))
        if e.get("tid") == main_tid:
            a = agg_main[e["name"]]; a[0] += 1; a[1] += e.get("dur", 0); a[2] = max(a[2], e.get("dur", 0))
    print(f"\n===== {mode} ===== ({len(xs)} X events, window {(max(e['ts']+e.get('dur',0) for e in xs)-t0)/1000:.0f}ms, main tid={main_tid})")
    print("--- main thread by name (top 16 by totalDur) ---")
    for name, (c, tot, mx) in sorted(agg_main.items(), key=lambda kv: -kv[1][1])[:16]:
        print(f"  {name:<38} n={c:<5} total={tot/1000:>8.1f}ms max={mx/1000:>7.1f}ms")
    print("--- all threads: RasterTask/GPUTask/DecodeImage etc ---")
    for name in ("RasterTask", "GPUTask", "DecodeImage", "DecodeImageOnWorker", "ImageDecodeTask", "TextureUpload", "Paint", "PrePaint", "Layerize"):
        if name in agg_all:
            c, tot, mx = agg_all[name]
            print(f"  {name:<38} n={c:<5} total={tot/1000:>8.1f}ms max={mx/1000:>7.1f}ms")
    # 主线程 >2ms 的顶层事件时间线（前 25 个）
    print("--- main-thread events >2ms (chronological, first 25) ---")
    big = sorted([e for e in xs if e.get("tid") == main_tid and e.get("dur", 0) > 2000], key=lambda e: e["ts"])
    for e in big[:25]:
        print(f"  +{(e['ts']-t0)/1000:>7.1f}ms dur={e.get('dur',0)/1000:>7.1f}ms {e['name']}")
