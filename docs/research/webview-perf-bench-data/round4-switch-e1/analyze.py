#!/usr/bin/env python3
import json, glob, sys
d = sys.argv[1] if len(sys.argv) > 1 else "/tmp/switch-e1"
rows = [json.loads(l) for l in open(f"{d}/webview_switch.jsonl") if l.strip()]
print(f"{'kind':>8} {'g':>2} {'path':>11} {'n':>2} {'benchTotals':<32} {'trueTotals':<32} {'deadlines':<20} {'jankTrue':>8}")
for r in rows:
    kind = r['kind']; g = r['group']
    path = r.get('parsePath', '?')
    bt = r.get('frameTotalMs', [])
    tt = r.get('frameTrueTotalMs', [])
    dl = r.get('frameDeadlineMs', [])
    jt = r.get('jankTrueRate', r.get('jankRate'))
    print(f"{kind:>8} {g:>2} {path:>11} {len(bt):>2} {str(bt):<32} {str(tt):<32} {str(dl):<20} {jt:>8}")
