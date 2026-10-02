"""搜索窗内的几何度量（顶部让位对拍用）。

单独成文件而不是内嵌在 verify-top-inset.mjs 的字符串里，理由与
`find-ui-band.py` 一样：**要能对合成 fixture 跑**。内嵌在 JS 字符串里的
python 只有「连着真机跑一遍」这一条验证路径 —— 而本仓反复吃过的亏正是
「它现在是对的」与「它对所有输入都对」完全同形，真机回归永远抓不到。

用法：
    python3 top_inset_metrics.py <png> <lo_y> <hi_y>

输出（空格分隔，单行）：
    OK  <center> <start> <end> <peak> <median_unif> <cross_agree>
    NONE <median_unif> <cross_agree>     窗内无稀疏深色文字
    BG   <median_unif> <cross_agree>     窗内是连续暗背景

## 两个度量为什么都要

- `median_unif`：**每行**横向「8 级色阶众数占比」的中位数。
  抓高细节封面（照片/噪点/密集线稿）。
  ⚠️ 它对**平滑纵向渐变**无效：天空那种渐变每一行横向本就近乎同色 ⇒ 该值饱和到 1.000。
- `cross_agree`：各行的众数**颜色**与整窗众数一致的比例。
  抓纵向渐变（每行众数各不相同）。真顶栏各行众数恒为同一个 surface 色 ⇒ 1.000。

单独任一个都会漏：
    样本              median_unif  cross_agree
    平色顶栏(真机)        1.000        1.000   ← 两个都放行（正确）
    噪声图                0.004        0.012   ← 两个都拦（正确）
    纵向渐变              1.000        0.555   ← 只有 cross_agree 拦得住
"""
import sys
from collections import Counter

from PIL import Image

DARK_LUMA_MAX = 128
MIN_DARK_PX = 4
MAX_ROW_DARK_RATIO = 0.6
QUANT = 8  # 量化到 8 级色阶，容忍抗锯齿与压缩噪点
HSAMPLE = 2  # 均匀度横向采样步长
DSAMPLE = 3  # 文字探测横向采样步长


def _luma(c):
    return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]


def _quant(c):
    return (c[0] // QUANT, c[1] // QUANT, c[2] // QUANT)


def measure(png_path, lo, hi):
    im = Image.open(png_path).convert("RGB")
    w, h = im.size
    px = im.load()
    hi = min(hi, h)
    if hi <= lo:
        print(f"NONE 0.000 0.000")
        return

    xs_text = list(range(int(w * 0.15), int(w * 0.85), DSAMPLE))
    xs_unif = list(range(0, w, HSAMPLE))

    rows = []
    peak = 0.0
    unifs = []
    row_modals = []
    for y in range(lo, hi):
        dark = sum(1 for x in xs_text if _luma(px[x, y]) < DARK_LUMA_MAX)
        ratio = dark / len(xs_text)
        if ratio > peak:
            peak = ratio
        if dark > MIN_DARK_PX and ratio <= MAX_ROW_DARK_RATIO:
            # 稀疏才可能是文字；连续必是背景
            rows.append(y)
        cnt = Counter(_quant(px[x, y]) for x in xs_unif)
        unifs.append(cnt.most_common(1)[0][1] / len(xs_unif))
        row_modals.append(cnt.most_common(1)[0][0])

    unifs.sort()
    median_unif = unifs[len(unifs) // 2]
    cross_agree = Counter(row_modals).most_common(1)[0][1] / len(row_modals)

    if not rows:
        kind = "BG" if peak > MAX_ROW_DARK_RATIO else "NONE"
        print(f"{kind} {median_unif:.3f} {cross_agree:.3f}")
        return

    start = rows[0]
    end = start
    for y in rows[1:]:
        if y - end <= 6:
            end = y
        else:
            break
    print(
        f"OK {(start + end) / 2.0:.2f} {start} {end} "
        f"{peak:.3f} {median_unif:.3f} {cross_agree:.3f}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    measure(sys.argv[1], int(sys.argv[2]), int(sys.argv[3]))
