"""状态栏带内的**背景色**取样（顶部遮罩对比度对拍用）。

单独成文件的理由与 `top_inset_metrics.py` 一致：**要能对合成 fixture 跑**。
内嵌在 `verify-statusbar-contrast.mjs` 字符串里的 python 只有「连着真机跑一遍」
这一条验证路径，而「它现在是对的」与「它对所有输入都对」完全同形。

用法：
    python3 status_bar_contrast_metrics.py <png> <x0> <x1> <y0> <y1>

输出（空格分隔，单行）：
    OK    <dr> <dg> <db> <lr> <lg> <lb> <flatness> <rows>
    EMPTY                                       采样窗与画布无交集 / 空

字段含义：
    <d*> 该窗内**最暗的行众数背景色**；<l*> 最亮的那行众数背景色
    <flatness> 逐行「众数像素数 / 该行采样数」的中位数（横向平色度）
    <rows>  采样到的行数

## 为什么取「行众数」而不是「全窗极值像素」（关键）

状态栏那一条 x∈[0.42W, 0.58W] 的**正中竖带**恰好落在**系统时钟**上。
时钟字形是**稀疏深色像素**，直接取全窗最暗像素量到的会是**字形本身**，
于是对比度恒 ≈ 1.0 —— 一个「看起来在量、其实量的是字形自己」的自造数。

故逐行取**精确 RGB 的众数**当该行背景：
  · 稀疏字形只占少数像素，众数仍是背景 ⇒ 对字形免疫；
  · PNG 是无损的，平色渐变的一行精确等于一个 RGB ⇒ **不需要量化**，
    众数就是真实色值（这与 `top_inset_metrics.py` 用 `QUANT=8` 量化不同：
    那里要的是抗噪的**形状**度量，这里要的是**精确色值**，量化会直接污染对比度）。
  · 代价：若一行被**大片实心内容**占据（如首页右上角的通知铃铛暗底圆钮），
    众数会翻转到那个暗色上。此时该行的 `flatness` 同步塌陷 ⇒ 由调用方判 REJECT。

## 横向平色度 = REJECT 闸门（不是「顺手报的数」）

判据问的是「遮罩在**状态栏带**上够不够」，而这条判据**只在窗内只有遮罩+封面**时成立。
窗内一旦有应用内容（铃铛、标题胶囊、系统字形铺满），量到的底色就不是遮罩的效果。
两个度量都过不了 ⇒ 显式拒绝，**REJECT ≠ 通过**。

⚠️ 本脚本**只用标准库**，且**一个第三方 import 都不尝试**。

PNG 解码复用 `top_inset_metrics.py` 的 `load_png_rgb`（→ `(w, h, RGB bytearray)`），
不写第三份解码器：多份解码器一旦对 filter / color type 的假设不同，
同一张图会得到两个结果，症状是「判据时灵时不灵」，极难归因。

**为什么不是 `png-luma.py`**（它也能解，且 `scrim-contrast.py` 复用的是它）：
那个文件**会尝试** `from PIL import ...` 作可选加速，缺失时回落标准库。
对本脚本来说「尝试过」就足以把一个未声明的第三方依赖带进执行路径 ——
而本仓已经吃过这个亏：`c403aa42` 修的正是「度量脚本用了仓里没声明的 Pillow，
本地全绿、CI 全红」。要零依赖，就得连**尝试**都不发生。
`top_inset_metrics.py` 的 `load_png_rgb` 覆盖面（bit depth 8 + color type 2/6）
足够 `adb exec-out screencap -p` 的输出。
"""

import importlib.util
import os
import sys
from collections import Counter

_HERE = os.path.dirname(os.path.abspath(__file__))

# 横向采样步长。1 = 逐像素全取（窗宽约 172 px、带高 64 行 ⇒ 约 1.1 万采样点，
# 标准库纯 Python 下可接受；量化到 3 只会让「众数是否翻转」的判据失真）。
_XSTEP = 1

# 量化步长，**只用于横向平色度**（与 `top_inset_metrics.py` 的 `QUANT = 8` 同值同理由）。
# ⚠️ 极值（最暗/最亮像素）**必须用精确 RGB** —— 对比度算到小数点后两位，
#    量化 8 级会直接把读数污染掉。两个度量用两套口径是**有意的**：
#    平色度要的是**形状**（对压缩噪点与色阶台阶免疫），极值要的是**色值**。
#
# ⚠️ 不量化会让暗色主题**假 REJECT**（真机实测踩到）：暗色遮罩是 #101418 渐隐到透明，
#    叠在深色封面上整条带只跨 ~10 级色阶，相邻行色差 1 级。此时精确 RGB 的众数
#    在几个近乎同色的值之间**掷硬币**，平色度塌到 0.55 ——
#    而窗内其实**什么都没有**。门禁把「干净样本」判成不可用，比没有门禁更糟。
_QUANT = 8


def _q(rgb):
    return (rgb[0] // _QUANT, rgb[1] // _QUANT, rgb[2] // _QUANT)


def _load_sibling():
    """复用 `top_inset_metrics.py` 的解码器（同目录既有文件，非第三方包）。"""
    spec = importlib.util.spec_from_file_location(
        "top_inset_metrics", os.path.join(_HERE, "top_inset_metrics.py")
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("找不到 top_inset_metrics.py，无法解码截图")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decode_band(path, y0, y1):
    """复用 `top_inset_metrics.load_png_rgb` 的**带限**解码。

    → `(width, band_rows, px, y0)`：缓冲里只含原图第 y0..y1-1 行，
    行 r 对应原图第 `y0 + r` 行。带限不是可选优化 —— 全图 2160 行而采样窗只有
    64 行，不截断则 97% 的反滤波纯属白算（该函数 docstring 记着实测 18.9s/次）。

    ⚠️ 该函数是**同仓既有文件**（非第三方包），但它正在被并行开发改动。
       故此处显式记录所依赖的契约：`(path, lo, hi) -> (w, rows, px, y0)`、
       `px` 恒 3 通道、`(r*w + x)*3` 寻址。契约变了本脚本会**显式报错**，
       不猜、不静默降级 —— 猜错的后果是量到错位的行且照样输出一个自信的数。
    """
    return _load_sibling().load_png_rgb(path, max(0, y0), max(0, y1))


def measure(png_path, x0, x1, y0, y1):
    w, rows, px, base_y0 = decode_band(png_path, y0, y1)
    x0, x1 = max(0, x0), min(w, x1)
    # rows 可能小于请求的带高（截图比请求的窗短 ⇒ 平台真值与截图不匹配）。
    # 少行就少行，**不补齐也不报错**：调用方拿 `rows` 就能看出窗被截断，
    # 而凭空补齐会让「窗被截断」这件事在输出里消失。
    if x1 <= x0 or rows <= 0:
        print("EMPTY")
        return

    flats = []
    dark_px = None
    light_px = None
    dark_l = 1e9
    light_l = -1e9
    for r in range(rows):
        base = r * w * 3
        cnt = Counter()
        n = 0
        for x in range(x0, x1, _XSTEP):
            i = base + x * 3
            rgb = (px[i], px[i + 1], px[i + 2])
            cnt[_q(rgb)] += 1  # ← 量化：平色度只要**形状**
            n += 1
            # 极值走**逐像素**（不是行众数）：判据问的是「状态栏文字压着的
            # 最坏那一个像素」。遮罩在带底 ~55% 不透明，封面亮/暗像素会透上来 ——
            # 那一档才是真会被文字压住的东西，行众数会把它平滑掉。
            l = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]
            if l < dark_l:
                dark_l, dark_px = l, rgb
            if l > light_l:
                light_l, light_px = l, rgb
        if n == 0:
            continue
        # 众数只用来算**横向平色度**（REJECT 闸门）；极值是上面逐像素累积的结果。
        (_modal_rgb, modal_n) = cnt.most_common(1)[0]
        flats.append(modal_n / float(n))
    if not flats:
        print("EMPTY")
        return

    # ⚠️ 极值的排序用 Rec.601 亮度**只为选像素**，不算对比度 ——
    #    对比度一律走 WCAG 相对亮度（`statusBarContrastVerdict.mjs`）。
    flats.sort()
    flatness = flats[len(flats) // 2]
    assert base_y0 == max(0, y0), "带限解码契约变了（base_y0 与请求不符）"
    print(
        f"OK {dark_px[0]} {dark_px[1]} {dark_px[2]} "
        f"{light_px[0]} {light_px[1]} {light_px[2]} "
        f"{flatness:.4f} {len(flats)}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 6:
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    measure(png_path=sys.argv[1], x0=int(sys.argv[2]), x1=int(sys.argv[3]),
            y0=int(sys.argv[4]), y1=int(sys.argv[5]))
