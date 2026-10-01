#!/usr/bin/env python3
"""沉浸卡 scrim 的文字对比度探针（issue #891）。

## 为什么是这个脚本

沉浸卡（推荐页作品卡 / 排行榜入口卡 / 小说介绍页）把白字叠在**不可预测**的
作品图上。判断「白字读不读得清」只有一个诚实的口径：**把渐变按 WCAG 的 alpha
合成规则叠到最坏底色上，再算相对亮度比**。

⚠️ 本项目已踩过的坑：手写 PNG 解码器解出的色值与肉眼矛盾，于是「实测对比度」
是自造的。**所以本脚本的像素解码直接复用 `png-luma.py` 的 `_decode_pixels`**
（color type 0/2/4/6 显式取通道、丢弃 alpha、5 种 filter 全实现），不再写第二份。

## 校准锚点（不通过就别信输出）

`--calibrate` 会在一张已知截图上解出若干令牌色并与 tokens.css 的值比对。
tokens.css 亮色板 `--md-primary: #1a6fa8` ⇒ `rgb(26, 111, 168)`。
**校准不过就抛异常退出**，不做「差不多就算了」。

## 两种口径

1. `--probe`：**实测**。给截图 + 文字包围盒，取盒内**最亮的背景像素**
   （文字本身是白的，会污染统计；这里要的是「字缝之间露出的渐变底」），
   算它与白字的对比度。用来验证解析模型对不对。
2. `--model`：**解析**。给定渐变色标 + 盒子的纵向位置（占盒高的比例），
   算纯白底（最坏情况）下的对比度。用来证明修法**对所有图片都成立**，
   而不是只对当前这张成立。

## WCAG 相对亮度

sRGB 分量先线性化：`c' = c/12.92`（c ≤ 0.04045）否则 `((c+0.055)/1.055)**2.4`；
`L = 0.2126R' + 0.7152G' + 0.0722B'`；`ratio = (L_light+0.05)/(L_dark+0.05)`。
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import re
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))


def _load_png_luma():
    """复用 png-luma.py 的解码器（不复制一份，那正是本项目踩过的坑）。"""
    spec = importlib.util.spec_from_file_location(
        "png_luma", os.path.join(_HERE, "png-luma.py")
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("找不到 png-luma.py，无法解码截图")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_PNG_LUMA = None


def decode(path):
    """→ (pixels, width, height, channels)"""
    global _PNG_LUMA
    if _PNG_LUMA is None:
        _PNG_LUMA = _load_png_luma()
    return _PNG_LUMA._decode_pixels(path)


# ── WCAG ──────────────────────────────────────────────────────────────────


def _lin(c: int) -> float:
    s = c / 255.0
    return s / 12.92 if s <= 0.04045 else ((s + 0.055) / 1.055) ** 2.4


def luminance(rgb) -> float:
    r, g, b = rgb
    return 0.2126 * _lin(r) + 0.7152 * _lin(g) + 0.0722 * _lin(b)


def contrast(a, b) -> float:
    la, lb = luminance(a), luminance(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def over(fg_rgb, alpha, bg_rgb):
    """source-over 合成：fg 以 alpha 叠在 **不透明** bg 上（截图与作品图都是不透明底）。"""
    a = max(0.0, min(1.0, alpha))
    return tuple(fg_rgb[i] * a + bg_rgb[i] * (1.0 - a) for i in range(3))


def over_text(fg_rgb, fg_alpha, bg_rgb):
    """文字本身也带 alpha（`text-white/85` 这类）时先合成到**它实际压着的背景**上，
    再比亮度。⚠️ 不能拿纯白当这里的 bg——`text-white/85` 叠在白底上还是白，
    会把 alpha 变体静默变成 no-op（第一版就这么写，/85 与 /100 读数完全相同）。"""
    return over(fg_rgb, fg_alpha, bg_rgb)


# ── 渐变解析 ──────────────────────────────────────────────────────────────


def _split_top_level(s: str) -> list[str]:
    """按**顶层**逗号切色标。

    ⚠️ 不能直接 `split(",")`：`rgba(0, 0, 0, 0.82)` 自己就带逗号，直接切会把它
    撕成 `rgba(0` / ` 0` / ` 0` / ` 0.82)` 四段，随后 fullmatch 全失败。
    第一版就是这么写的，`--probe`/`--calibrate` 两条路都不碰渐变所以**没暴露**，
    直到 `--model` 第一次真跑才炸——潜伏的错误比缺失的错误更难查。
    """
    out: list[str] = []
    depth = 0
    cur = ""
    for ch in s:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        if ch == "," and depth == 0:
            if cur.strip():
                out.append(cur.strip())
            cur = ""
        else:
            cur += ch
    if cur.strip():
        out.append(cur.strip())
    return out


def parse_stops(css: str) -> list[tuple[float, tuple[int, int, int], float]]:
    """`linear-gradient(to top, rgba(...) A, rgba(...) B 45%, ...)` → [(pos, rgb, alpha), ...]

    刻意只吃 `to top`：本仓三处 scrim 全部是 `to top`，且「to top」里 0% 在**下边**。
    方向写错会整套读反，故不认识的 `to <dir>` 直接抛。
    """
    m = re.search(r"linear-gradient\(\s*to\s+(\w+)\s*,(.*)\)\s*$", css.strip(), re.S)
    if not m:
        raise ValueError(f"不是 linear-gradient：{css!r}")
    if m.group(1) != "top":
        raise ValueError(f"只支持 to top（0% 在下边），实际 {m.group(1)!r}")
    raw: list[tuple[float | None, tuple[int, int, int], float]] = []
    for part in _split_top_level(m.group(2)):
        part = part.strip()
        if not part:
            continue
        pos: float | None = None
        pm = re.search(r"([\d.]+)%\s*$", part)
        if pm:
            pos = float(pm.group(1)) / 100.0
            part = part[: pm.start()].strip()
        cm = re.fullmatch(
            r"rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)", part
        )
        if not cm:
            raise ValueError(f"色标解析不了：{part!r}")
        rgb = (int(cm.group(1)), int(cm.group(2)), int(cm.group(3)))
        alpha = float(cm.group(4)) if cm.group(4) is not None else 1.0
        raw.append((pos, rgb, alpha))
    if not raw:
        raise ValueError("色标为空")
    return _fill_positions(raw)


def _fill_positions(
    raw: list[tuple[float | None, tuple[int, int, int], float]],
) -> list[tuple[float, tuple[int, int, int], float]]:
    """补齐省略百分比的色标位置（CSS 语义：省略位置 = 在相邻已声明位置间**均分**；
    首个省略 → 0%，末个省略 → 100%）。

    ⚠️ 第一版把省略位置一律当 0%：`rgba(0,0,0,0)`（渐变**顶端**）被当成 0%，
    于是「to top」的最后一档整个塌到盒子下沿，插值全错——alpha 算出来比真实值小
    （标题处 0.089 而非 0.189）。**错的方向是「更容易达标」**，所以依赖它的
    「不达标」断言照样绿 = 一条自己骗自己的绿。这里必须按 CSS 语义补齐。
    """
    n = len(raw)
    out: list[float | None] = [p for p, _, _ in raw]
    if all(p is None for p in out):
        step = 1.0 / max(1, n - 1)
        return [(i * step, rgb, a) for i, (_, rgb, a) in enumerate(raw)]
    # 末个省略 → 100%
    if out[-1] is None:
        out[-1] = 1.0
    # 首个省略 → 0%
    if out[0] is None:
        out[0] = 0.0
    # 中间省略 → 相邻已声明位置的中点（迭代一轮即可覆盖常规写法）
    for _ in range(n):
        for i in range(1, n - 1):
            if out[i] is None and out[i - 1] is not None and out[i + 1] is not None:
                out[i] = (float(out[i - 1]) + float(out[i + 1])) / 2.0
    if any(p is None for p in out):
        raise ValueError("存在无法确定位置的色标（相邻位置都未声明）")
    return [(float(p), rgb, a) for p, (_, rgb, a) in zip(out, raw)]


def stop_at(stops, pos: float):
    """在 pos（0=盒子下沿，1=上沿）处取插值后的 (rgb, alpha)。段外沿用最近端点。"""
    pts = sorted(stops, key=lambda s: s[0])
    if pos <= pts[0][0]:
        return pts[0][1], pts[0][2]
    if pos >= pts[-1][0]:
        return pts[-1][1], pts[-1][2]
    for (p0, c0, a0), (p1, c1, a1) in zip(pts, pts[1:]):
        if p0 <= pos <= p1:
            t = 0.0 if p1 == p0 else (pos - p0) / (p1 - p0)
            rgb = tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
            return rgb, a0 + (a1 - a0) * t
    raise AssertionError("unreachable")


def scrim_bg(css, pos, image_rgb, scrim_rgb=(0, 0, 0)):
    """图片色 image_rgb 叠上 pos 处的渐变 → 合成后的实际背景色。"""
    c, a = stop_at(parse_stops(css), pos)
    return over(scrim_rgb, a, image_rgb)


# ── 实测口径 ──────────────────────────────────────────────────────────────


def probe(path, box, fg=(255, 255, 255), fg_alpha=1.0, quantile=1.0):
    """box = (x0, y0, x1, y1) 像素。返回该盒内背景的亮度分位统计 + 对比度。

    `quantile=1.0` 取盒内**最亮**的背景像素（阳数对照 = 字缝最亮处）。
    ⚠️ 盒子里若含白色字身，quantile 会直接被拉到 1.0，此时输出是**上界**不是实测
    ——所以取样盒必须落在**与文字同高、但没有字**的位置（文字右侧 / 字间空档），
    `max_lum - q_lum` 就是「盒里混进了字身」的信号，不为 0 要警觉。
    """
    pixels, w, h, ch = decode(path)
    x0, y0, x1, y1 = box
    x0, y0 = max(0, x0), max(0, y0)
    x1, y1 = min(w, x1), min(h, y1)
    if x1 <= x0 or y1 <= y0:
        raise ValueError(f"盒子与画布无交集：{box} vs {w}×{h}")
    samples: list[tuple[float, tuple[int, int, int]]] = []
    for y in range(y0, y1, 2):
        row = y * w * ch
        for x in range(x0, x1, 2):
            i = row + x * ch
            rgb = (pixels[i], pixels[i + 1], pixels[i + 2])
            samples.append((luminance(rgb), rgb))
    if not samples:
        raise ValueError(f"盒子内采样点为 0：{box}")
    samples.sort(key=lambda t: t[0])
    n = len(samples)
    pick_l, pick_rgb = samples[min(n - 1, int(n * quantile))]
    eff = over_text(fg, fg_alpha, pick_rgb)
    eff_l = luminance(eff)
    return {
        "box": [x0, y0, x1, y1],
        "min_lum": round(samples[0][0], 5),
        "p50_lum": round(samples[n // 2][0], 5),
        "max_lum": round(samples[-1][0], 5),
        "q_lum": round(pick_l, 5),
        "q_rgb": list(pick_rgb),
        "fg_effective_lum": round(eff_l, 5),
        "contrast_vs_fg": round((eff_l + 0.05) / (pick_l + 0.05), 3),
        "samples": n,
    }


# ── 校准 ──────────────────────────────────────────────────────────────────

#: tokens.css 亮色板的事实源。**不是**从 tokens.css 现读的（会变成同义反复），
#: 而是手抄的常量 + 由 `--calibrate` 逐个锚点自检。
#: ⚠️ 每个锚点**各配一个盒子**：两个锚点在截图上处于不同位置，拿同一个盒子去
#:    验两个色等于自造矛盾（第一版就这么写，解码器明明准的却报失败）。
ANCHOR = {"--md-primary": (26, 111, 168), "--md-surface": (248, 250, 255)}


def calibrate(path, boxes):
    """boxes = {anchor_name: box}。在已知亮色截图上逐锚点比对。

    校准不过抛异常——不降级、不取整蒙混。宁可停下来也不给出「看起来有数据」的读数。
    """
    out = {"anchor": {}}
    for name, expect in ANCHOR.items():
        if name not in boxes:
            raise ValueError(f"锚点 {name} 缺 --box")
        box = boxes[name]
        got = probe_pixel(path, box)
        d = max(abs(got[i] - expect[i]) for i in range(3))
        out["anchor"][name] = {
            "box": list(box),
            "expect": list(expect),
            "decoded": list(got),
            "delta": d,
        }
        if d > 2:
            raise ValueError(
                f"校准失败：{name} 在 {box} 解出 {tuple(got)} 与锚点 {expect} 差 {d} > 2。"
                " 解码器不可信，停止（不要信后面的读数）。"
            )
    return out


def probe_pixel(path, box):
    pixels, w, h, ch = decode(path)
    x0, y0, x1, y1 = box
    i = ((y0 + y1) // 2) * w * ch + ((x0 + x1) // 2) * ch
    return (pixels[i], pixels[i + 1], pixels[i + 2])


def main() -> int:
    ap = argparse.ArgumentParser(description="沉浸卡 scrim 文字对比度探针")
    ap.add_argument("--calibrate", metavar="PNG")
    ap.add_argument("--probe", metavar="PNG", help="实测：读盒内背景最亮像素")
    ap.add_argument("--model", metavar="CSS", help="解析：纯白最坏底色下的对比度")
    ap.add_argument("--box", metavar="x0,y0,x1,y1", help="--md-primary 锚点盒 / --probe 盒")
    ap.add_argument("--box-surface", metavar="x0,y0,x1,y1", help="--md-surface 锚点盒")
    ap.add_argument("--fg", default="255,255,255")
    ap.add_argument("--fg-alpha", type=float, default=1.0)
    ap.add_argument("--at", default="0,0.25,0.5,0.75,1", help="模型：0=盒下沿 1=上沿")
    ap.add_argument("--image", default="255,255,255", help="模型：底图色（默认纯白最坏）")
    ap.add_argument("--threshold", type=float, default=4.5, help="WCAG AA 正文")
    args = ap.parse_args()

    if args.calibrate:
        if not args.box or not args.box_surface:
            print("--calibrate 需要 --box（primary 锚点）与 --box-surface", file=sys.stderr)
            return 2
        print(
            json.dumps(
                calibrate(
                    args.calibrate,
                    {"--md-primary": _box(args.box), "--md-surface": _box(args.box_surface)},
                ),
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0

    if args.model:
        img = _rgb(args.image)
        fg = _rgb(args.fg)
        rows = []
        for pos in [float(x) for x in args.at.split(",")]:
            bg = scrim_bg(args.model, pos, img)
            eff = over_text(fg, args.fg_alpha, bg)
            c = contrast(eff, bg)
            rows.append(
                {
                    "pos": pos,
                    "bg": [round(v, 1) for v in bg],
                    "contrast": round(c, 3),
                    "pass": c >= args.threshold,
                }
            )
        print(json.dumps(rows, ensure_ascii=False, indent=2))
        return 0 if all(r["pass"] for r in rows) else 1

    if args.probe:
        if not args.box:
            print("--probe 需要 --box", file=sys.stderr)
            return 2
        r = probe(args.probe, _box(args.box), _rgb(args.fg), args.fg_alpha)
        r["pass"] = r["contrast_vs_fg"] >= args.threshold
        print(json.dumps(r, ensure_ascii=False, indent=2))
        return 0 if r["pass"] else 1

    ap.print_help()
    return 2


def _box(s):
    return tuple(int(v) for v in s.split(","))


def _rgb(s):
    return tuple(int(v) for v in s.split(","))


if __name__ == "__main__":
    raise SystemExit(main())
