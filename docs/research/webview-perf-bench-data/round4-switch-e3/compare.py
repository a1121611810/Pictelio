#!/usr/bin/env python3
import json, statistics
def load(d):
    return [json.loads(l) for l in open(f"{d}/webview_switch.jsonl") if l.strip()]
sets = [("baseline(E1)", "/tmp/switch-e1"), ("tierA-kill-anim", "/tmp/switch-e3a"),
        ("tierB-kill-shimmer", "/tmp/switch-e3b"), ("tierC-kill-img", "/tmp/switch-e3c")]
print(f"{'dataset':<20} {'kind':>8} | {'frameCount(每组)':<18} | {'trueTotals 全部帧(中位)':<42} | {'benchTotals(中位)':<20}")
for name, d in sets:
    for kind in ("forward", "back"):
        rows = [r for r in load(d) if r['kind'] == kind]
        fc = [len(r.get('frameTotalMs', [])) for r in rows]
        tt = sorted(t for r in rows for t in r.get('frameTrueTotalMs', []))
        bt = sorted(t for r in rows for t in r.get('frameTotalMs', []))
        med = statistics.median(tt) if tt else float('nan')
        medb = statistics.median(bt) if bt else float('nan')
        print(f"{name:<20} {kind:>8} | {str(fc):<18} | n={len(tt):>2} med={med:<7.2f} p90={tt[int(0.9*(len(tt)-1))]:<7.2f} max={max(tt):<7.2f} | med={medb:.2f} max={max(bt):.2f}")
