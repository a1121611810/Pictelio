#!/usr/bin/env python3
import json, collections
d = json.load(open("/tmp/switch-e4/trace-forward-illust.json"))
evs = [e for e in d["events"] if e.get("ph") == "X"]
t0 = min(e["ts"] for e in evs)
by_tid = collections.Counter()
for e in evs: by_tid[e.get("tid")] += e.get("dur", 0)
main = by_tid.most_common(1)[0][0]
agg = collections.defaultdict(lambda: [0, 0.0, 0.0])
for e in evs:
    if e.get("tid") != main: continue
    a = agg[e["name"]]; a[0] += 1; a[1] += e.get("dur", 0); a[2] = max(a[2], e.get("dur", 0))
print(f"forward-illust: {len(evs)} X events, main tid={main}")
for name, (c, tot, mx) in sorted(agg.items(), key=lambda kv: -kv[1][1])[:15]:
    print(f"  {name:<40} n={c:<5} total={tot/1000:>8.1f}ms max={mx/1000:>7.1f}ms")
print("--- main-thread blocks >5ms chronological ---")
for e in sorted([e for e in evs if e.get("tid") == main and e.get("dur",0) > 5000], key=lambda e: e["ts"])[:20]:
    print(f"  +{(e['ts']-t0)/1000:>7.1f}ms dur={e.get('dur',0)/1000:>7.1f}ms {e['name']}")
