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

全部数值**实测**（emulator-5554 / 1080×2160，窗 = [inset+10, inset+barH−10] = [82, 246]）：

| 样本                        | median_unif | cross_agree | 只看 unif | 只看 agree |
|-----------------------------|-------------|-------------|-----------|------------|
| 平色顶栏（合成）             | 1.000       | 1.000       | 放行 ✅   | 放行 ✅    |
| 平色顶栏（真机·书签页）       | 1.000       | 1.000       | 放行 ✅   | 放行 ✅    |
| 随机噪声图（合成）           | 0.007       | 0.098       | 拦截 ✅   | 拦截 ✅    |
| 高细节封面（合成）           | 0.050       | 0.128       | 拦截 ✅   | 拦截 ✅    |
| 平滑纵向渐变（合成）         | **1.000**   | **0.555**   | **放行 ❌** | 拦截 ✅  |
| 整屏浅纯色底（合成）         | 1.000       | 1.000       | 放行 ❌   | 放行 ❌    |
| B 变体首页·某一张封面（真机） | 0.285       | 0.896       | 拦截 ✅   | 拦截 ✅    |

复算命令：合成样本见 `tests/topInsetMetrics.test.ts`（现画，期望与几何同处）；
真机两行用 `python3 scripts/top_inset_metrics.py <截图> 82 246`。

⚠️ 首页那一行是**一张具体作品**，不是族的代表 —— 同一页换一张封面实测出现过
`0.117 / 0.817`，另一张是 `0.285 / 0.896`。**这正是不能用像素当主判据的原因**：
首页有无顶栏由路由声明说了算（见 `topInsetVerdict.mjs` 的 `resolveDeclaredTopInset`），
这两个度量只是第二、第三道防线。

单独任一维度都会漏：
- `median_unif` 对**纵向渐变**恒为 1.000（每行横向本就同色），而渐变封面在推荐流里很常见；
- 只看 `cross_agree` 会漏掉「每行同色但逐行微变」的高细节图。

"""
import struct
import sys
import zlib
from collections import Counter

# ⚠️ 本脚本**只用标准库**，刻意不依赖 Pillow。
# 首版用 `from PIL import Image`，本地全绿、CI 全红 —— GitHub runner 上没有 Pillow，
# 而仓里**任何地方都没声明它**（`grep -rn -i pillow` 零命中）。即：
# 「本地能跑」不等于「提交后能跑」，未声明的依赖会在干净环境里炸。
#
# 代价是要自己解 PNG（约 50 行 stdlib）。这是值得的：
#   · 免掉一条 CI 依赖与一次网络安装；
#   · 度量结果不再随 Pillow 版本/解码差异漂移；
#   · 脚本在**任何**有 python3 的机器上可直接跑（含 CI、含评审者的本机）。
#
# 覆盖面：bit depth 8 + color type 2（RGB）/ 6（RGBA），逐行 filter 0-4。
# 超出范围（16-bit、调色板、隔行）一律**显式报错退出**，不猜、不静默降级。

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


def _paeth(a, b, c):
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    return b if pb <= pc else c


def load_png_rgb(png_path):
    """解 PNG 为 (width, height, bytearray RGB)。仅支持 bit depth 8 + color type 2/6。"""
    with open(png_path, "rb") as f:
        data = f.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise SystemExit(f"不是 PNG 文件：{png_path}")
    pos, idat, w = 8, [], None
    while pos + 8 <= len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        body = data[pos + 8 : pos + 8 + length]
        if ctype == b"IHDR":
            w, h, depth, color, comp, filt, inter = struct.unpack(">IIBBBBB", body)
            if depth != 8 or color not in (2, 6) or comp != 0 or filt != 0 or inter != 0:
                raise SystemExit(
                    f"只支持 bit depth 8 + color type 2/6、非隔行；实得 depth={depth} "
                    f"color={color} interlace={inter}（{png_path}）"
                )
        elif ctype == b"IDAT":
            idat.append(body)
        elif ctype == b"IEND":
            break
        pos += 12 + length
    if w is None:
        raise SystemExit(f"PNG 缺 IHDR：{png_path}")
    raw = zlib.decompress(b"".join(idat))
    bpp = 3 if color == 2 else 4
    stride = w * bpp
    out = bytearray(w * h * 3)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        ft = raw[p]
        p += 1
        line = bytearray(raw[p : p + stride])
        p += stride
        if ft == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ft == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ft == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ft == 4:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                ul = prev[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + _paeth(left, prev[i], ul)) & 0xFF
        elif ft != 0:
            raise SystemExit(f"未知 filter 类型 {ft}")
        row = y * w * 3
        for x in range(w):
            s = x * bpp
            out[row + x * 3 : row + x * 3 + 3] = line[s : s + 3]
        prev = line
    return w, h, out


def measure(png_path, lo, hi):
    w, h, px = load_png_rgb(png_path)
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
    def _at(x, y):
        o = (y * w + x) * 3
        return (px[o], px[o + 1], px[o + 2])

    for y in range(lo, hi):
        dark = sum(1 for x in xs_text if _luma(_at(x, y)) < DARK_LUMA_MAX)
        ratio = dark / len(xs_text)
        if ratio > peak:
            peak = ratio
        if dark > MIN_DARK_PX and ratio <= MAX_ROW_DARK_RATIO:
            # 稀疏才可能是文字；连续必是背景
            rows.append(y)
        cnt = Counter(_quant(_at(x, y)) for x in xs_unif)
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
