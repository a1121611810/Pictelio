#!/usr/bin/env python3
import json
d = json.load(open("/tmp/switch-e4/trace-back.json"))
evs = [e for e in d["events"] if e.get("ph") == "X"]
t0 = min(e["ts"] for e in evs)
main = 30894
big = sorted([e for e in evs if e.get("tid") == main and e.get("dur", 0) > 8000], key=lambda e: e["ts"])
print("back trace: main-thread blocks >8ms (chronological)")
for e in big:
    print(f"  +{(e['ts']-t0)/1000:>7.1f}ms dur={e.get('dur',0)/1000:>7.1f}ms {e['name']}")
# 找 v8.callFunction 大块与 UpdateLifecycle 大块的嵌套关系：取 >50ms 的事件，列出其时间区间内的子事件 top5
print("\nnesting check: children of the two biggest blocks")
tops = sorted([e for e in evs if e.get("tid") == main and e.get("dur", 0) > 50000], key=lambda e: -e.get("dur",0))[:2]
for t in tops:
    s, e_ = t["ts"], t["ts"] + t.get("dur", 0)
    kids = [e for e in evs if e.get("tid") == main and e.get("ts", 0) >= s and e.get("ts", 0) < e_ and e is not t and e.get("dur", 0) > 1000]
    kids.sort(key=lambda e: -e.get("dur", 0))
    print(f"  block +{((t['ts']-t0)/1000):.1f}ms dur={t.get('dur',0)/1000:.1f}ms {t['name']}")
    for k in kids[:8]:
        print(f"     - {k.get('dur',0)/1000:>6.1f}ms {k['name']}")
