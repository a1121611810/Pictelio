#!/usr/bin/env python3
"""定位「外观 → 选择主题色」那一行 **7 个圆形色板 swatch**。

## 为什么需要它（而不是继续用分段控件当锚点）

`find-ui-band.py` 的 `find_filled_band` 找的是「宽而扁、内部颜色均匀的实心带」。
设置页上**至少有三个**结构满足它，且它们的 x 几何完全一样：

| 卡片 | 结构 | 选中段中心 @1080 |
| --- | --- | --- |
| AI 作品 | 三段控件（显示/遮罩/仅看） | 234 / 540 / 846 |
| **外观模式** | 三段控件（亮色/暗色/跟随系统） | 234 / 540 / 846 |
| 界面语言 | 三药丸（跟随系统/简体中文/English） | ≈234 / 540 / 846 |

⇒ 只靠 `find_filled_band` **分不出认到了哪张卡**，而点错卡的后果是
`capture-md3-matrix.sh` 把「外观模式」切成了别的东西、且**不报错**
（`set_mode` 里的 `probe_mode` 亮度探针只验明暗，验不了「是不是这张卡」）。

色板 swatch 行是**唯一无歧义的锚点**：它是页面上唯一一行「≥5 个等间距饱和色块」，
且它**只在外观卡里**。所以判别式是：

> 认到分段控件 **且** 它的**正下方**存在色板行 ⇒ 这才是外观卡。

## 顺带解决色板点击的标定错误

`capture-md3-matrix.sh` 原来用 `CTRL_CY + 屏高*120/2160` 定位 swatch 行。
实测（emulator-5556，竖排 7 圆点）：

| 屏宽 | 控件 cy | swatch 中心 y | 偏移 | 偏移/屏宽 | 偏移/屏高 | 原公式给的值 |
| --- | --- | --- | --- | --- | --- | --- |
| 1080×2160 | 1378 | 1542 | 164px | **15.19%** | 7.59% | 120px ❌ |
| 1440×2560 | 1523 | 1741 | 218px | **15.14%** | 8.52% | 142px ❌ |

偏移随**屏宽**线性（15.19% / 15.14%），随屏高则**不等比**（7.59% / 8.52%）
—— 因为 app 的纵向间距也是 rpx（随屏宽缩放），不是随屏高。
原公式两处都错：基数错、缩放维度也错，720 下偏 38px、1440 下偏 76px，
而圆点直径只有 ~110px，**必然点空或只擦到边缘**。

## 输出

`--csv`：`y,x0,x1,...,x6`（swatch 行中心 y + 7 个圆心 x），按 x 升序。
NOTFOUND 时退出码 1 且不输出任何坐标。

## 退出码

| 码 | 含义 | 什么时候 |
| --- | --- | --- |
| 0 | 找到 | 检出 5–9 个等距饱和块构成的一行（`--selected` 下 = 唯一命中一个选中态） |
| 1 | **NOTFOUND** | 图**读得懂**，但本页没有色板行 —— legit 的「这个页面上没有它」 |
| 2 | 用法错误 | 未知开关 / 没给路径 / 共用解码器加载失败（维持现状） |
| 3 | **不可用** | 输入不可读（文件不存在 / 不是 PNG / IDAT 截断）**或判据失效**（命中 0 个 / ≥2 个选中态） |

⚠️ 「判据失效」也归 3，理由：`selected_index` 认不出唯一选中态时，
**唯一能让流程继续的假答案就是「取第一个命中」** —— 而 `capture-md3-matrix.sh`
的 `set_palette` 正是按这个返回值点色板的 ⇒ 4 个色板会被**全拍成天蓝**，
文件名声称是 4 种主题色。所以这是**故障**（判据没生效），不是「没找到」，
必须与 1 分开，否则错误信息会把人引去查页面而不是查判据。

⚠️ 1 与 3 的另一半同形问题：Python 未捕获异常退出码也是 1，
而 `decode()` 的失败（非 PNG / 截断 / 文件不存在）走的正是未捕获异常；
上游用 `2>/dev/null` 吞掉 traceback 后只看 rc ⇒ 「adb 拉失败留下 0 字节文件」
被报成「本页没有色板行」。详见 `find-ui-band.py` 文件头「退出码」。

## 判别力的反事实

`--explain` 会打印每个被拒的候选及原因。已验证：
- Feed 页（无色板行）⇒ NOTFOUND
- 设置页但**只滚到「界面语言」**（色板行在**上方**，不在下方）⇒ 由调用方
  用「swatch 行必须在控件下方」这条判别式拒绝，本脚本本身只报位置。
"""
from __future__ import annotations

import struct
import sys
import zlib
from collections import Counter
from pathlib import Path

EXIT_OK = 0  # 找到
EXIT_NOTFOUND = 1  # legit 的「这个页面上没有色板行」
EXIT_USAGE = 2  # 用法错误
EXIT_UNREADABLE = 3  # 输入不可读 **或** 判据失效（都归这一档，见文件头）

# 共用 `find-ui-band.py` 的解码实现，避免仓库里出现第二份 PNG 解析器
# （两份解析器一旦对 zlib 边界处理的假设不同，同一张图会给出两个答案）。
try:  # 文件名带连字符，不能直接 import
    import importlib.util

    _spec = importlib.util.spec_from_file_location(
        "_find_ui_band", Path(__file__).resolve().parent / "find-ui-band.py"
    )
    fib = importlib.util.module_from_spec(_spec)
    assert _spec.loader is not None
    _spec.loader.exec_module(fib)
except Exception as exc:  # pragma: no cover - 依赖缺失要显式报错，不静默降级
    print(f"无法加载 find-ui-band.py（共用 PNG 解码）：{exc}", file=sys.stderr)
    raise SystemExit(EXIT_USAGE) from exc


class CriterionFailed(Exception):
    """判据**失效**（既不是「没找到」，也不是「输入读不了」）。

    与 `ValueError`（本页没有色板行 = NOTFOUND 语义）必须分成两个类型，
    因为这两件事给调用方的处置完全不同：前者照常往下走，后者要停下来查判据。
    """


# 「输入读不了」的兜底集合。`fib.decode()` 已把常见失败归一成 `fib.UnreadableInput`，
# 这里再兜住「解码之后才暴露」的结构性坏数据（行数不足 ⇒ 索引越界等）。
# ⚠️ **刻意不含 `ValueError`**：本文件里 `ValueError` 是 `selected_index` 的
# NOTFOUND 哨兵（「本页没有色板行」），并进来会把 rc 1 吞成 rc 3。
DECODE_ERRORS = (fib.UnreadableInput, IndexError, zlib.error, struct.error, OSError)

SAT_MIN = 40  # 与 find_wide_solid 同口径：max(r,g,b)-min(r,g,b)
MIN_BLOBS = 5  # 一行至少 5 个饱和块才可能是 swatch 行（实测恰好 7）
MAX_BLOBS = 9
MIN_BLOB_PX = 20  # 单个色块最小宽度，滤掉文字笔画
EVEN_TOL = 0.12  # 相邻圆心间距相对中位数的最大允许偏差


def find_swatches(path: str, explain: list[str] | None = None) -> dict | None:
    """返回 `{y, centers:[x0..x6]}`；找不到返回 None。"""

    def _drop(reason: str) -> None:
        if explain is not None:
            explain.append(reason)

    w, h, ch, px = fib.decode(path)
    xstep = 2
    ncols = len(range(0, w, xstep))

    # 逐行：找出该行所有「连续饱和列段」，段数达标的行才是候选
    best: tuple[int, int, int, list[int], list[int]] | None = None
    run_rows: list[tuple[int, list[int], list[int]]] = []
    for y in range(h):
        segs: list[tuple[int, int]] = []
        cur: list[int] | None = None
        for k in range(ncols):
            i = (y * w + k * xstep) * ch
            sat = max(px[i], px[i + 1], px[i + 2]) - min(px[i], px[i + 1], px[i + 2])
            if sat >= SAT_MIN:
                cur = [k, k] if cur is None else [cur[0], k]
            else:
                if cur is not None and (cur[1] - cur[0]) * xstep >= MIN_BLOB_PX:
                    segs.append((cur[0] * xstep, cur[1] * xstep))
                cur = None
        if cur is not None and (cur[1] - cur[0]) * xstep >= MIN_BLOB_PX:
            segs.append((cur[0] * xstep, cur[1] * xstep))
        if MIN_BLOBS <= len(segs) <= MAX_BLOBS:
            # 取**中点**而不是左边界：要输出的是「点哪一下会命中圆心」，
            # 左边界点在抗锯齿边缘上，横向偏 30–40px。
            run_rows.append((y, [(a + b) // 2 for a, b in segs], [b - a + 1 for a, b in segs]))
        elif run_rows:
            best = _consider(run_rows, best)
            run_rows = []
    if run_rows:
        best = _consider(run_rows, best)

    if best is None:
        _drop(f"全屏 {h} 行里没有出现过 {MIN_BLOBS}–{MAX_BLOBS} 个饱和色块的行（阈值 sat≥{SAT_MIN}）")
        return None
    n, ra, rb, centers, widths = best
    if rb - ra + 1 < 10:
        _drop(f"y[{ra}..{rb}] 色块行带只有 {rb - ra + 1}px，太薄，不像 swatch 行")
        return None
    # 圆点半径：行带内各色块宽度的中位数的一半。`selected_index` 的扫描窗要用它。
    widths.sort()
    radius = max(1, widths[len(widths) // 2] // 2) if widths else 1
    # **等距判据** —— 缺了它会在 Feed 页上假阳性。
    # 实测（emulator-5556）：真色板 7 个圆心间距恒为 134px（1080），
    # 而 Feed 的 `04-feed-scrolled.png` 上凑出的 7 个"色块"间距是
    # 88/300/162/174/40/50 —— 那是 7 张并排的作品图，不是 swatch 行。
    gaps = [b - a for a, b in zip(centers, centers[1:])]
    med = sorted(gaps)[len(gaps) // 2]
    dev = max(abs(g - med) for g in gaps)
    if med <= 0 or dev > med * EVEN_TOL:
        _drop(
            f"y[{ra}..{rb}] 圆心间距 {gaps} 不等距（中位 {med}px，最大偏差 {dev}px "
            f"> {EVEN_TOL:.0%}×{med}）—— 不是 swatch 行"
        )
        return None
    return {
        "y": (ra + rb) // 2, "y1": ra, "y2": rb,
        "centers": centers, "count": n, "radius": radius,
    }


def _consider(rows, best):
    """把一段连续候选行并进 `best`（圆点多的优先，再比行带高度）。"""
    if not rows:
        return best
    ra, rb = rows[0][0], rows[-1][0]
    # 该行带内「出现次数最多的那一组圆心」= 真圆心序列。
    # 逐行取交集会把圆点因抗锯齿而时隐时现的行直接丢掉，所以用众数而非交集。
    tally = Counter((tuple(c) for _y, c, _wd in rows))
    centers, _n = max(tally.items(), key=lambda kv: (kv[1], -len(kv[0])))
    centers = list(centers)
    widths = [wd[i] for _y, _c, wd in rows if len(wd) == len(centers) for i in range(len(wd))]
    cand = (len(centers), ra, rb, centers, widths)
    if best is None or (cand[0], cand[2] - cand[1]) > (best[0], best[2] - best[1]):
        return cand
    return best


def selected_index(path: str, explain: list[str] | None = None) -> int:
    """返回当前**被选中**的 swatch 下标。

    两种「给不出下标」是**不同的事**，用不同异常表达，调用方据此选退出码：

    | 异常 | 含义 | 退出码 |
    | --- | --- | --- |
    | `ValueError` | 本页没有色板行 —— legit 的 NOTFOUND | 1 |
    | `CriterionFailed` | 色板行在，但认不出**唯一**选中态 —— 判据失效 | 3 |

    第二个为什么必须和第一个分开：静默取第一个命中会让 `set_palette`
    把 4 个色板全拍成天蓝（见下）。

    ## 判别式：横向饱和**连续段数** ≥ 2

    实测（emulator-5556 / 1080×2160 / 外观卡，y=1572 横扫）：

        选中「天蓝」  x=83 环 → x=89 **白缝** → x=95..191 本体   ⇒ 3 段
        未选「紫罗兰」x=230..314 单块本体，无环无缝              ⇒ 1 段

    选中态多出来的那一圈**环 + 白缝**把饱和像素切成多段，这是唯一稳定的结构差异
    ——「圆点更大」「圆点更亮」都随主题色变化，不能当判据。

    这条判据是 `capture-md3-matrix.sh` 的 `set_palette` 的 **oracle**：
    没有它，点空色板不报错，4 个色板 × 2 明暗这 8 张会全部拍成天蓝。
    """
    got = find_swatches(path, explain=explain)
    if got is None:
        raise ValueError("本页没有色板行")
    w, h, ch, px = fib.decode(path)
    y = got["y"]

    def at(x: int) -> bytes:
        i = (y * w + x) * ch
        return bytes(px[i : i + 3])

    def sat(c: bytes) -> bool:
        return max(c) - min(c) >= SAT_MIN

    hits: list[int] = []
    for idx, cx in enumerate(got["centers"]):
        lo = max(0, cx - got["radius"] - 24)
        hi = min(w - 1, cx + got["radius"] + 24)
        runs = 0
        prev = False
        for x in range(lo, hi + 1):
            cur = sat(at(x))
            if cur and not prev:
                runs += 1
            prev = cur
        if runs >= 2:
            hits.append(idx)
    if len(hits) != 1:
        # ⚠️ 不是 ValueError：这不是「没找到」，是**判据没生效**。
        # 静默取第一个会让 `set_palette` 把 4 个色板全拍成天蓝（4 个文件名、1 张图）。
        raise CriterionFailed(f"选中态判别失败：命中 {len(hits)} 个 {hits}（应恰好 1 个）")
    if explain is not None:
        explain.append(f"选中 swatch 下标 = {hits[0]}（7 个圆点里唯一有「环+白缝」的）")
    return hits[0]


def main(argv: list[str]) -> int:
    args: list[str] = []
    csv = False
    explain = False
    want_selected = False
    for a in argv[1:]:
        if a == "--csv":
            csv = True
        elif a == "--explain":
            explain = True
        elif a == "--selected":
            want_selected = True
        elif a.startswith("-"):
            print(f"  FAIL  未知开关 {a}", file=sys.stderr)
            return EXIT_USAGE
        else:
            args.append(a)
    if not args:
        print(
            "用法: find-palette-swatches.py <file.png> [--csv] [--selected] [--explain]",
            file=sys.stderr,
        )
        return EXIT_USAGE
    # 聚合规则：多文件入参时取**最严重**的一档（1 < 3），理由同 find-ui-band.py。
    # 现有调用方（capture-md3-matrix.sh）每次只传一个文件，这条规则对它们不可观测。
    rc = EXIT_OK
    for path in args:
        notes: list[str] = []
        if want_selected:
            try:
                print(selected_index(path, explain=notes))
            except CriterionFailed as exc:
                # 退出码 3：判据失效。**不是** NOTFOUND —— 继续跑会让
                # `set_palette` 把 4 个色板全拍成天蓝，所以必须响亮地失败。
                print(f"判据失效  {path}", file=sys.stderr)
                print(f"  原因：{exc}", file=sys.stderr)
                rc = max(rc, EXIT_UNREADABLE)
                continue
            except DECODE_ERRORS as exc:
                # 退出码 3：图读不了。报文带路径 + 原因，上游 `2>/dev/null` 吞掉的
                # 正是这部分信息，而它决定人去查采集链路还是查判据。
                print(f"输入不可读  {path}", file=sys.stderr)
                print(f"  原因：{type(exc).__name__}: {exc}", file=sys.stderr)
                rc = max(rc, EXIT_UNREADABLE)
                continue
            except ValueError as exc:
                # 退出码 1：legit 的「本页没有色板行」。这两行输出是**契约**，
                # 逐字保持原样（下游按 `拒：` 文本判导航状态）。
                print(f"NOTFOUND  {path}", file=sys.stderr)
                print(f"  拒：{exc}", file=sys.stderr)
                rc = max(rc, EXIT_NOTFOUND)
                continue
            for n in notes:
                print(f"  {n}", file=sys.stderr if not csv else sys.stdout)
            continue
        try:
            got = find_swatches(path, explain=notes)
        except DECODE_ERRORS as exc:
            print(f"输入不可读  {path}", file=sys.stderr)
            print(f"  原因：{type(exc).__name__}: {exc}", file=sys.stderr)
            rc = max(rc, EXIT_UNREADABLE)
            continue
        if got is None:
            print(f"NOTFOUND  {path}", file=sys.stderr)
            for n in notes:
                print(f"  拒：{n}", file=sys.stderr)
            rc = max(rc, EXIT_NOTFOUND)
            continue
        line = f"{got['y']},{got['radius']}," + ",".join(str(c) for c in got["centers"])
        print(
            line
            if csv
            else (
                f"{path}\n  色板行 y[{got['y1']}..{got['y2']}] 中心 y={got['y']} "
                f"半径 {got['radius']}px 圆心 x={got['centers']}（{got['count']} 个）\n"
                f"  控件外沿 = [{got['centers'][0] - got['radius']}..{got['centers'][-1] + got['radius']}]"
                "（色板行外沿与分段控件等宽：1080 实测 82..996 vs 控件 82..999）"
            )
        )
        if explain:
            for n in notes:
                print(f"  拒：{n}")
    return rc


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
