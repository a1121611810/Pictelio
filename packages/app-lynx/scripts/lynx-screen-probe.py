#!/usr/bin/env python3
"""#1036 标定探针：在真实截图上量 classify 各中间量的分布（阈值溯源用，非门禁）。

用法: lynx-screen-probe.py <png> [<png> ...]

三个中间量的口径说明（都是为「主题归一」服务的，旧的绝对判据见 CALIBRATION.md）：
- `topbar_bg_lum`：顶栏带（y 48..140）亮度中位数。顶栏是**纯表面色**，不会被作品图污染
  ⇒ 用它做 light/dark 主题锚点，比整页中位数可靠（实测整页中位数会被大图带偏：
  推荐页 69 / 详情页 226，而两者同为暗色主题）。
- `rowmode_content_by_delta`：逐行取亮度众数当**该行的背景**，再数偏离该背景的像素占比。
  行内局部背景 ⇒ 对「暗色/亮色」和「文字压在大图上/文字压在表面上」同时免疫。
- `colored_run`：saturated 像素的连续彩色带数（theme 无关，detail 单大图 vs 瀑布流多块）。
"""
import importlib.util
import json
import sys
from collections import Counter

spec = importlib.util.spec_from_file_location("a", "scripts/lynx-screen-analyze.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

DELTAS = (8, 12, 16, 20, 24, 32, 48)


def lum(c):
    r, g, b = c
    return int(0.299 * r + 0.587 * g + 0.114 * b)


def mode(vals, bucket=8):
    return Counter((v // bucket) * bucket for v in vals).most_common(1)[0][0]


def probe(path):
    w, h, rows = m.load_png(path)

    # ── 主题锚点：顶栏带亮度中位数（顶栏是纯表面色） ──
    tb = [lum(m.pixel(rows, y, x)) for y in range(48, min(140, h), 4) for x in range(0, w, 4)]
    tb.sort()
    tb_bg = tb[len(tb) // 2]

    # ── 顶栏文字：相对顶栏自身背景的高对比占比 ──
    topbar_text = {}
    for d in DELTAS:
        n = tot = 0
        for y in range(48, min(140, h), 2):
            for x in range(0, w, 2):
                tot += 1
                if abs(lum(m.pixel(rows, y, x)) - tb_bg) > d:
                    n += 1
        topbar_text[d] = round(n / tot, 4) if tot else 0.0

    # ── 行局部背景的内容占比（内容区） ──
    def rowmode_ratio(delta, y0, y1, step=6, xstep=12):
        n = tot = 0
        for y in range(y0, min(h, y1), step):
            vals = [lum(m.pixel(rows, y, x)) for x in range(0, w, xstep)]
            base = mode(vals)
            for x in range(0, w, xstep):
                tot += 1
                if abs(lum(m.pixel(rows, y, x)) - base) > delta:
                    n += 1
        return round(n / tot, 4) if tot else 0.0

    # ── 标题带（y 220..400）：detail 的大标题 vs text 页正文起首 ──
    title_band = {d: rowmode_ratio(d, 220, 400, step=4, xstep=8) for d in DELTAS}
    # ── 中部（y 220..h*0.85） ──
    mid = {d: rowmode_ratio(d, 220, int(h * 0.85)) for d in DELTAS}

    # ── saturated 彩色带连续数（theme 无关；沿用 classify 的 max_run 算法） ──
    colored = tot2 = 0
    col_bands = {}
    for y in range(0, h, 6):
        band = y // 60
        for x in range(0, w, 12):
            r, g, b = m.pixel(rows, y, x)
            tot2 += 1
            if m.saturated(r, g, b):
                colored += 1
                col_bands[band] = col_bands.get(band, 0) + 1
    max_run = run = 0
    prev = -10
    for band in sorted(col_bands):
        run = run + 1 if band - prev <= 2 else 1
        max_run = max(max_run, run)
        prev = band

    return {
        "file": path.split("/")[-1],
        "size": f"{w}x{h}",
        "topbar_bg_lum": tb_bg,
        "theme": "dark" if tb_bg < 128 else "light",
        "topbar_text_by_delta": topbar_text,
        "mid_by_delta": mid,
        "title_band_by_delta": title_band,
        "colored_ratio": round(colored / tot2, 4) if tot2 else 0.0,
        "colored_bands": len(col_bands),
        "colored_max_run": max_run,
        "colored_top_band": min(col_bands) if col_bands else None,
    }


if __name__ == "__main__":
    for p in sys.argv[1:]:
        print(json.dumps(probe(p), ensure_ascii=False))
