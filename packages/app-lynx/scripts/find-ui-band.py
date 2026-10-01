#!/bin/env python3
"""Lynx 页面几何探针 —— 按**像素特征**定位控件，不假设它在哪。

## 为什么需要它

T16 截图矩阵第一版把「我的 → 外观」那一段的点击坐标写死，标定值来自一次肉眼测量。
实测证明该位置**不可靠**：

- 短促 `input swipe` 是甩动，有惯性，滚动量逐次不同；
- 换成 900ms 慢速拖拽（位移即滚动量）后，**同参数连跑两次仍差 6.94% 像素**
  （已排除状态栏时钟：那部分只占 0.x%）。滚动量不确定 ⇒ 点击落到色板行上，
  静默把主题色改掉 ⇒ 拍出「文件名说 light、图是 dark」的假证据。

`uiautomator dump` 在本应用上也**抓不到任何 Lynx 文本节点**（实测 0 个 text 属性），
「按文本定位」不通。剩下唯一稳的路：**认像素，不认坐标**。

## 识别目标：外观模式分段控件的「已选中实心段」

它在一屏里最好认：**又宽又扁、内部颜色高度均匀的实心色块**。

判据按顺序过筛，每一维都排除一类误报（**不是**只看一个最佳候选就下结论 ——
首版就是这么写的，结果一行「我的」标题被当成选中段；加严后又变成一律 NOTFOUND）：

| 维 | 阈值 | 排除什么 |
|---|---|---|
| 行占比 | 峰值 ≥ 0.15 | 纯色区域、渐变背景 |
| 宽度 | 15%–60% 屏宽 | 圆形色板（约 12%）、整行分隔线（太宽） |
| 实心度 | ≥ 0.85 | **文字行**（首版误报源：494px 宽但内部高低起伏） |
| 高度 | ≥ 3.5% 屏高 | **文字行**（约 30px = 1.4%）、卡片细描边（1–2px） |
| 宽高比 | 1.0 ≤ w/h ≤ 8.0 | 竖长块（头像方块、竖版图、侧栏）——「宽而扁」是目标形态 |
| 高度上界 | ≤ 15% 屏高 | 整幅横幅 / 主视觉大色块（20%+ 屏高） |
| 两侧间隙 | 左右各 ≥ 0.5% 屏宽的背景色 | 贴边块、通栏底色块 |

后三维是**目标同一性**校验：前四维只能证明「有一条实心带」，
证明不了「这条带就是外观模式分段控件的选中段」。第三类是那个「认错对象」的
真实同形失效 —— 认到别的实心块时脚本照样打印坐标、照样点下去、照样不报错。

⚠️ **刻意不加「水平居中」这一维**，理由写在这里免得下一个人补回来：
1080 实测三个分段中心的 x 是 234 / 540 / 846，即选中段中心离屏心最远 **0.283 屏宽**。
所以任何「离屏心太远就拒」的容差都必然误杀首/尾分段（容差 <0.283 屏宽时），
而容差放大到 0.35 屏宽后又几乎拒不掉任何左右对齐的块 —— 是个只会装样子的判据。
真正能分开的是**两侧间隙**（选中段是三段式里的一段，左右必然是另外两段的透明区）。

候选带按「面积 = 宽 × 高」降序，取第一个通过**全部七维**的。

只用标准库（zlib + struct）手解 PNG。

## 退出码

| 码 | 含义 | 什么时候 |
| --- | --- | --- |
| 0 | 找到 | 有候选通过全部七维判据（`--help` 也走这条） |
| 1 | **NOTFOUND** | 图**读得懂**，但画面里没有这个东西 —— legit 的「页面上没有」，不是故障 |
| 2 | 用法错误 | 未知开关 / 没给路径（维持现状，见 `_usage`） |
| 3 | **输入不可读** | 文件不存在 / 不是 PNG / 色深或 color type 不支持 / IDAT 被截断 |

⚠️ 1 与 3 曾经**完全同形**，而这个同形是会误导人的那种：

- Python 的**未捕获异常**退出码也是 1，而 `decode()` 的四种失败（`find-ui-band.py`
  的 `非 PNG` / `色深≠8` / `未知 color type` / `zlib` 截断）都走未捕获异常；
- 上游 `capture-md3-matrix.sh` 的四处调用都是 `2>/dev/null`，traceback 被吞掉后
  只看 rc ⇒ **`screencap` 断连留下的 0 字节文件**（设备/线缆问题）
  被报成「登录页上找不到按钮」「页面布局变了」—— 报错**指向错误根因**，
  人会去调判据阈值，而该修的是采集链路。

把两档分开是让错误**可诊断**的唯一办法（测试硬约束 #3「禁止静默降级」）。
`tests/scriptExitCodes.test.ts` 是这两档的门禁，断言必须分别钉住 1 与 3 ——
只断言「非 0」等于没测，那正是这个缺陷的形态。
"""
from __future__ import annotations

import struct
import sys
import zlib

EXIT_OK = 0  # 找到
EXIT_NOTFOUND = 1  # legit 的「页面上没有这个东西」
EXIT_USAGE = 2  # 用法错误
EXIT_UNREADABLE = 3  # 输入不可读（**不是**「没找到」）


class UnreadableInput(Exception):
    """输入**读不了**（文件不存在 / 不是 PNG / 色深或 color type 不支持 / IDAT 截断）。

    为什么必须是**独立类型**而不是继续抛裸 `ValueError`：`find-palette-swatches.py`
    的 `selected_index` 用 `ValueError` 表达「本页没有色板行」= NOTFOUND（rc 1）。
    只要 `decode()` 还抛裸 `ValueError`，那两条路径就必然在 `except` 里撞在一起 ——
    调换顺序也只能把「没找到」错报成 3，救不回来。归一之后约定是：
    **输入问题一律 `UnreadableInput`（rc 3），`ValueError` 一律 NOTFOUND（rc 1）。**
    """


# 「输入读不了」的兜底集合。`decode()` 已把常见失败归一成 `UnreadableInput`，
# 这里再兜住「解码之后才暴露」的结构性坏数据（IDAT 短于画布 ⇒ 索引越界等）。
# ⚠️ **刻意不含 `ValueError`**：在本仓库的这两个脚本里 `ValueError` 是 NOTFOUND
# 的哨兵，并进来会把 rc 1 吞成 rc 3。
DECODE_ERRORS = (UnreadableInput, IndexError, zlib.error, struct.error, OSError)

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
COLOR_DIFF = 60  # 肉眼可辨的色差阈值（RGB 三通道绝对差之和）
UNIFORM_TOL = 24  # 实心度判定容差
# ② 阶段的列扫描步长：`flags` 的下标 k 对应像素 x = k * FLAG_STEP。
# ⚠️ 量纲必须跟着走：下面所有「间隙宽度」都是 flags 下标差，要换回像素得乘它
# （find_wide_solid 的第一版就栽在「存抽样计数、拿它比像素阈值」上）。
FLAG_STEP = 2
# 判定「这一列是背景」的异色率上界（背景列几乎不含带内色块像素）。
BG_FLAG_MAX = 0.15
# ④ 实心度采样区的内缩比例（按带宽/带高各内缩此比例，剔除描边环与圆角）
UNIFORM_INSET = 0.12


def _chunks(data: bytes):
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        yield ctype, data[pos + 8 : pos + 8 + length]
        pos += 12 + length


def _unfilter(raw: bytes, width: int, height: int, bpp: int) -> bytearray:
    out = bytearray()
    stride = width * bpp
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if ftype == 1:
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:
            for i in range(stride):
                a = line[i - bpp] if i >= bpp else 0
                b = prev[i]
                c = prev[i - bpp] if i >= bpp else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif ftype != 0:
            raise ValueError(f"未知的 PNG filter type: {ftype}")
        out += line
        prev = line
    return out


def decode(path: str) -> tuple[int, int, int, bytearray]:
    """读 PNG 并解出像素；一切「读不了」都归一成 `UnreadableInput`（见该类注释）。"""
    try:
        return _decode(path)
    except UnreadableInput:
        raise
    except (OSError, ValueError, zlib.error, struct.error, IndexError) as exc:
        # `from exc` 保留异常链：诊断时既看到统一的类型，也拿得到原始原因。
        raise UnreadableInput(f"{type(exc).__name__}: {exc}") from exc


def _decode(path: str) -> tuple[int, int, int, bytearray]:
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != PNG_MAGIC:
        raise ValueError(f"{path} 不是 PNG")
    width = height = bit_depth = color_type = 0
    idat = bytearray()
    for ctype, payload in _chunks(data):
        if ctype == b"IHDR":
            width, height, bit_depth, color_type = struct.unpack(">IIBB", payload[:10])
        elif ctype == b"IDAT":
            idat += payload
        elif ctype == b"IEND":
            break
    if bit_depth != 8:
        raise ValueError(f"只支持 8 位色深，实际 {bit_depth}")
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise ValueError(f"未知的 color type: {color_type}")
    return width, height, channels, _unfilter(zlib.decompress(bytes(idat)), width, height, channels)


def _median_color(samples: list[bytes]) -> bytes:
    return bytes(sorted(s[i] for s in samples)[len(samples) // 2] for i in range(3))


def _diff(a: bytes, b: bytes) -> int:
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) + abs(a[2] - b[2])


def find_filled_band(
    path: str,
    y_min_ratio: float = 0.12,
    y_max_ratio: float = 0.85,
    min_width_ratio: float = 0.15,
    max_width_ratio: float = 0.60,
    min_uniform: float = 0.85,
    min_height_ratio: float = 0.035,
    min_aspect: float = 1.0,
    max_aspect: float = 8.0,
    max_height_ratio: float = 0.15,
    min_edge_inset_ratio: float = 0.02,
    explain: list[str] | None = None,
) -> dict[str, object] | None:
    """找「又宽又扁、内部颜色均匀的实心色块」，返回几何；找不到返回 None。

    `explain` 非空时把每个候选被拒的原因追加进去（`--explain` 走这条）——
    判据必须能被审计，否则「一律 NOTFOUND」和「认错对象」一样查不出来。
    """

    def _drop(reason: str) -> None:
        if explain is not None:
            explain.append(reason)

    w, h, ch, px = decode(path)
    step_x = max(1, w // 90)
    xcols = list(range(0, w, step_x))
    y0, y1 = int(h * y_min_ratio), int(h * y_max_ratio)

    # ① 逐行：取该行众数色当背景，算异色像素占比
    ratios: list[tuple[float, int]] = []
    for y in range(y0, y1):
        base = y * w * ch
        samples = [bytes(px[base + x * ch : base + x * ch + 3]) for x in xcols]
        med = _median_color(samples)
        cnt = 0
        for x in xcols:
            i = base + x * ch
            if _diff(bytes(px[i : i + 3]), med) > COLOR_DIFF:
                cnt += 1
        ratios.append((cnt / len(xcols), y))

    # ② 收集所有**上升沿**行作为候选带起点，向右穿过平台直到带底
    #
    # ⚠️ 缺陷 1（已修）：旧判据是「一直向右走到**严格下降处**才停」。停下来的那行是
    #    平台**最后一行**，于是 `ry1` 落到了带底 ⇒ `bh = 0` ⇒ 整条带被
    #    `min_height_ratio`（屏高 3.5%）拒掉，报「带高 0px」。**平坦顶必然踩中** ——
    #    实心矩形、圆角矩形的中段，异色率剖面顶部都是平的。
    #    为什么能潜伏这么久：当天那张真机图在带顶恰好有 1px 的小回落，
    #    旧判据于是「碰巧」停在首行 ⇒ 真机绿。证据：`tests/findUiBand.test.ts`
    #    的 F1/F2/F3/F7，旧版 4/4 红。
    #
    # ⚠️ 缺陷 2（已修）：锚点改成上升沿之后，**扩展阈值不能跟着改**。若拿
    #    「上升沿那一行」当种子（`floor = ratios[i][0] * 0.45`），种子会小到
    #    只覆盖 1 个抽样列（0.011）⇒ floor 从 0.13 掉到 0.005，**低 26 倍** ⇒
    #    上方任何细竖条/分隔线/图标竖条都会被并进带里。实测 24294 条带里
    #    **47.6% 过度延伸**（最多多吃 20 行，丢失 0 条），真机实心度余量
    #    0.887−0.85 = 0.037，≥6 行就 NOTFOUND。证据：同文件 F8。
    #
    # 所以：**锚点用上升沿，阈值用峰值** —— 两者是不同职责，不该共用一个数。
    # 两趟走：① 用「不低于本行」宽松圈出候选段；② 取段内 max 作 peak，
    # 再按 `peak*0.45` 把两端收紧。平顶情况下「上升沿」与「首个达标行」重合，
    # 于是这个收紧后的口径对平顶恰好退化成缺陷 1 修好后的行为。
    candidates: list[tuple[int, int, float]] = []  # (ry1, ry2, peak)
    n_rows = len(ratios)
    i = 0
    while i < n_rows:
        left = ratios[i - 1][0] if i > 0 else 0.0
        if ratios[i][0] <= left:  # 非上升沿 ⇒ 不是带顶，跳过
            i += 1
            continue
        j = i
        # 圈定用**绝对显著性阈值 0.15**，与下面 `base >= 0.15` 同源。
        # ⚠️ 不能拿「上升沿那一行」的值当阈值（那是缺陷 2 的老毛病，26 倍误差）；
        #    也不能拿「不低于首行」当条件 —— 剖面在上升沿后**紧跟一个小回落**就会
        #    立刻截断。真机实测（樱花粉主题，y1292 起）：1292=0.267、1296=0.256，
        #    条件 `ratios[j+1] >= ratios[i]` 立刻为假 ⇒ 带被腰斩成 68px，
        #    撞上 `min_height_ratio`（75.6px）被拒，症状又是「找不到控件」。
        while j + 1 < n_rows and ratios[j + 1][0] >= 0.15:
            j += 1
        # 基线取**中位数**而不是最大值。
        # ⚠️ 段内最大值会被**标签文字**抬高：分段控件的填充行异色率约 0.27，
        #    穿过文字的行升到 0.42。真机实测 1080 樱花粉主题：peak(max)=0.433
        #    ⇒ floor=0.45×0.433=0.195 已经贴到填充行 0.267 的边缘，
        #    稍有噪声就把整段削掉（1440 的「界面语言」药丸就是这样从 102px
        #    被削到 84px，撞上 min_height_ratio 被拒）。
        #    中位数代表「这一段**典型**长什么样」，不受少数高值行影响：
        #    同一张图中位数 0.28 ⇒ floor 0.126，填充行全部保留。
        #    对 F8（细竖条 0.011 + 平台 0.289，60:98 行）而言中位数落在平台上，
        #    竖条照样被削掉 —— 两个用例同时成立。
        run = sorted(ratios[k][0] for k in range(i, j + 1))
        base = run[len(run) // 2]
        peak = run[-1]  # 仅用于输出/诊断
        if base < 0.15:
            i = j + 1
            continue
        floor = base * 0.45
        lo_k = i
        while lo_k < j and ratios[lo_k][0] < floor:
            lo_k += 1
        hi_k = j
        while hi_k > lo_k and ratios[hi_k][0] < floor:
            hi_k -= 1
        candidates.append((ratios[lo_k][1], ratios[hi_k][1], peak))
        i = j + 1

    scored: list[tuple[int, dict[str, object]]] = []
    for ry1, ry2, peak in candidates:
        bh = ry2 - ry1
        if bh < h * min_height_ratio:
            _drop(f"y[{ry1}..{ry2}] 带高 {bh}px < 屏高 {min_height_ratio:.1%}")
            continue
        # ③ 带内逐列异色率（用带内**左侧留白处**的像素当背景，代表卡片底色）
        bg_samples = []
        for y in range(ry1, ry2 + 1, max(1, (ry2 - ry1) // 6)):
            b0 = y * w * ch
            i2 = b0 + int(w * 0.04) * ch
            bg_samples.append(bytes(px[i2 : i2 + 3]))
        med_all = _median_color(bg_samples)
        flags: list[float] = []
        for x in range(0, w, FLAG_STEP):
            hit = tot = 0
            for y in range(ry1, ry2 + 1, 2):
                i2 = y * w * ch + x * ch
                tot += 1
                if _diff(bytes(px[i2 : i2 + 3]), med_all) > COLOR_DIFF:
                    hit += 1
            flags.append(hit / tot if tot else 0.0)
        if not flags:
            continue
        # 取**最宽的连续高命中列区间**，而不是「异色率最高的那一列」。
        #
        # ⚠️ 旧写法 `best = max(range(len(flags)), key=...)` + 从 best 向两边扩展，
        #    有一个**已被合成 fixture 实证**的缺陷：Python 的 `max` 在并列时返回
        #    **最左**那个下标。控件的**竖描边**（3px，整列都是描边色 ⇒ flag 恰为 1.0）
        #    与选中段**填充**（也是 1.0）**并列** ⇒ best 锁死在描边上；再向右扩展时
        #    撞上未选中段的白底（白 vs 页面底色差仅 12 < COLOR_DIFF 60）立刻停下
        #    ⇒ 带宽塌成 2px，被 `min_width_ratio` 拒掉，症状是「找不到控件」。
        #
        #    真机图当天**侥幸**没发作：MD3 分段控件是**药丸形**，圆角把描边列的
        #    flag 削到 0.5 以下，描边不构成独立高命中区间。可方角卡片、列表分隔线、
        #    任何整列同色的竖边都会踩中 —— 靠圆角躲过去不是判据，是运气。
        #
        #    并列时取**最左**，保证同一张图多次运行输出稳定（可复现的采集坐标）。
        runs: list[tuple[int, int]] = []
        k = 0
        while k < len(flags):
            if flags[k] < 0.5:
                k += 1
                continue
            s = k
            while k + 1 < len(flags) and flags[k + 1] >= 0.5:
                k += 1
            runs.append((s, k))
            k += 1
        if not runs:
            peak_col = max(flags)
            _drop(f"y[{ry1}..{ry2}] 峰值列异色率 {peak_col:.2f} < 0.50")
            continue
        lo, hi = max(runs, key=lambda r: (r[1] - r[0], -r[0]))
        x1, x2 = lo * FLAG_STEP, min(w - 1, hi * FLAG_STEP)
        bw = x2 - x1
        if not (w * min_width_ratio <= bw <= w * max_width_ratio):
            _drop(
                f"y[{ry1}..{ry2}] 宽 {bw}px = {bw / w:.1%} 屏宽，"
                f"不在 [{min_width_ratio:.0%},{max_width_ratio:.0%}]"
            )
            continue
        # ④ 实心度
        #
        # 采样区**按比例内缩**后再统计。为什么：带是按「异色率剖面」切出来的，
        # 切出来的是控件的**外接框**，里面必然含两样非填充物 ——
        # 3px 描边环与四个圆角。1080 实测它们合计占 6.9% + 约 2%：
        # 300×120 的外接框，去掉描边后 294×114 ⇒ 环占 6.9%。
        # 不内缩就把它们算成「不实心」，于是同一条带在
        # 「trim 得狠（外接框偏小）」与「trim 得松（外接框完整）」两种切法下
        # 得到 0.92 与 0.82 两个值 —— 同一个控件，判据读数却随切法漂移 0.10。
        # 内缩 12% 后描边与圆角都落在采样区外，读数只反映「内部是否实心」。
        #
        # ⚠️ 阈值 0.85 看着偏高，但**它已经贴着真阳性的下沿**，而且没有更好的
        #    判据可换 —— 下面是把它从 0.50 提回来时踩到的实证：
        #
        #   实测分布（emulator-5556，逐像素统计带内「与众数色色差 ≤ UNIFORM_TOL」的比例）
        #   ⚠️ 下面这组是**内缩前**的历史读数，是「阈值为什么定在 0.85」的依据，
        #      **不是**当前代码的输出。内缩后的复测值见下面的独立小节。
        #     真阳性（真实控件的已选中段）
        #       0.92   1080 外观模式·跟随系统（天蓝）      0.88   1080 外观模式（樱花粉）
        #       0.87   720  AI 作品·显示                   0.77   1440「界面语言」小药丸
        #     真阴性（Feed 里的作品图 / 深色缩略图）
        #       0.77   Feed 底部的深色缩略图（46,49,54 铺 76%，少量浅色文字）
        #       0.25   05-dark.png 作品图                   0.01  04/10 作品图
        #
        #    **0.77 同时出现在两侧** ⇒ 这条判据**在原理上分不开**控件与深色块：
        #    它量的是「带内多少像素恰好等于众数色」，而控件的**标签文字**和缩略图的
        #    **浅色文字**对它是一样的噪声来源。
        #    曾把它降到 0.50，理由是「负样本只有 0.01/0.25，空档 [0.25,0.77]」——
        #    那是**只采了 2 个负样本**的结论；补采后立刻有 3 张 Feed 截图假阳性。
        #    教训：「数据空档」只在你采到的样本上成立。
        #
        #   内缩 12% 之后的复测（2026-09-30，`find-ui-band.py <图> --explain` 读
        #   `实心度=`，9 张 emulator-5556「设置 → 外观」页截图）：
        #       0.87  sw-1080x2160 / palette-sakura / pt / pt2 / app1080
        #       0.886 sw-720x1280        0.924  sw-1440x2560
        #       0.947 n.png / nav-ok.png
        #   ⇒ 区间 0.87–0.947，阈值 0.85，**最小余量 0.02**。
        #   余量这么薄是**待观察项**：内缩比例 / 阈值 / 圆角半径任一变动都可能吃掉它，
        #   改这三者中的任何一个都要重跑上表并把新区间回写此处与
        #   docs/research/md3-visual-regression-2026-09.md §8.2。
        #
        #    ⚠️ 已知局限：**小药丸 + 长标签**（1440「界面语言」，4 字标签占面积 ~23%）
        #    实测 0.77 会被拒。不影响采集 —— `capture-md3-matrix.sh` 现在以
        #    **色板行**为锚点定位外观卡（见该文件 detect_control），
        #    find_filled_band 只用来量「段宽」，拒绝非控件的能力**不再是承重项**。
        #    真要修，得换成与文字无关的量（前三色调色板覆盖率 / 连通域面积比）。
        inner: list[bytes] = []
        inset_x = int(bw * UNIFORM_INSET)
        inset_y = int(bh * UNIFORM_INSET)
        cx0_i, cx1_i = x1 + inset_x, x2 - inset_x
        cy0_i, cy1_i = ry1 + inset_y, ry2 - inset_y
        for y in range(cy0_i, cy1_i + 1, 2):
            b0 = y * w * ch
            for x in range(cx0_i, cx1_i + 1, 2):
                i2 = b0 + x * ch
                inner.append(bytes(px[i2 : i2 + 3]))
        if not inner:
            continue
        med_in = _median_color(inner)
        uniform = sum(1 for c in inner if _diff(c, med_in) <= UNIFORM_TOL) / len(inner)
        if uniform < min_uniform:
            _drop(f"y[{ry1}..{ry2}] 实心度 {uniform:.2f} < {min_uniform}")
            continue
        # ⑤ 宽高比：目标是「宽而扁」的一段，竖长块不可能是它
        aspect = bw / bh
        if not (min_aspect <= aspect <= max_aspect):
            _drop(
                f"y[{ry1}..{ry2}] 宽高比 {aspect:.2f} 不在 [{min_aspect},{max_aspect}]"
                f"（{bw}×{bh}px）—— 竖长块不是分段控件的选中段"
            )
            continue
        # ⑥ 高度上界：通栏横幅 / 主视觉大色块同样满足「宽、扁、实心」
        if bh > h * max_height_ratio:
            _drop(
                f"y[{ry1}..{ry2}] 带高 {bh}px = {bh / h:.1%} 屏高 > {max_height_ratio:.0%}"
                " —— 横幅/主视觉大色块，不是控件"
            )
            continue
        # ⑦ 离屏边距离 —— 一道**兜底**的同一性检查（证据强度见下，勿高估）：
        #    真·通栏色块（横幅 / 主视觉底色）会一路贴到屏幕左右边；分段控件不会，
        #    它被卡片内边距包着。1080 实测：三段控件最外缘离屏边约 80px（≈7.4% 屏宽），
        #    本阈值 2%（21px）留足余量。
        #
        #    ⚠️ 它替换掉的是一条**已被真机证伪**的判据。原来写的是「左右两侧都要有背景
        #    间隙 ≥0.5% 屏宽」，理由是「选中段左右必然各有一段透明区」——**问错了对象**：
        #    三段控件的**最左段**与控件左缘齐平，其左侧紧邻控件自身描边而非背景，
        #    量出来必然是 0。真机实证（emulator-5556，1080×2160，「详情画质」三段控件、
        #    左侧「标准」段选中）：该段被判成「两侧背景间隙 左0px/右114px」而拒掉；
        #    把该判据的阈值置 0 后，同一张图立刻检出 `x[90..390] y[696..816] 中心=(240,756)`，
        #    与目视位置一致。而这恰恰是**采集流程第一个要点的段**
        #    （`mode_x_light` = 屏宽×234/1080）⇒ 旧判据会让 T16 采集在浅色态下每轮都
        #    NOTFOUND，表现为「找不到控件」这种**指向错误根因**的报错。
        #
        #    ⚠️ **本条自身的判别力未经反事实证实**：四次尝试构造「宽度合规(15–60%) 且贴屏边」
        #    的色块，全部被**更早的判据**拦下（宽度上限，或下方注释所述的平台段缺陷），
        #    始终没走到本条。所以它是**兜底**而不是已验证的关卡 —— 别在注释或评审里
        #    把它说成「能拦住通栏色块」。要证明它有判别力，得先修平台段缺陷（那会改变
        #    `cy`），需要真机回归。
        inset_px = int(w * min_edge_inset_ratio)
        if x1 < inset_px or x2 > w - 1 - inset_px:
            _drop(
                f"y[{ry1}..{ry2}] x[{x1}..{x2}] 离屏边仅 左{x1}px/右{w - 1 - x2}px，"
                f"要求各 ≥{inset_px}px —— 通栏色块，不是分段控件"
            )
            continue
        gl = 0
        while lo - 1 - gl >= 0 and flags[lo - 1 - gl] < BG_FLAG_MAX:
            gl += 1
        gr = 0
        while hi + 1 + gr < len(flags) and flags[hi + 1 + gr] < BG_FLAG_MAX:
            gr += 1
        scored.append(
            (
                bw * bh,
                {
                    "x1": x1, "x2": x2, "y1": ry1, "y2": ry2,
                    "cx": (x1 + x2) // 2, "cy": (ry1 + ry2) // 2,
                    "width": bw, "height": bh,
                    "uniform": round(uniform, 3), "peak": round(peak, 3),
                    "aspect": round(aspect, 2),
                    "gap": (gl * FLAG_STEP, gr * FLAG_STEP),
                },
            )
        )

    if not scored:
        return None
    scored.sort(key=lambda kv: kv[0], reverse=True)
    return scored[0][1]


def find_wide_solid(
    path: str,
    sat_min: int = 40,
    width_frac: float = 0.30,
    min_h_frac: float = 0.012,
    max_h_frac: float = 0.15,
    min_margin_frac: float = 0.02,
    explain: list[str] | None = None,
) -> dict | None:
    """找「横跨很宽、且是饱和实心色」的色块 —— 用来定位**登录按钮**。

    为什么不能用 `find_filled_band`：那个检测器找的是分段控件那种
    「宽而扁 + 内部颜色均匀」的**中性色**带；登录按钮是**高饱和**的
    （主题蓝），实测在登录页上 `find_filled_band` 直接 NOTFOUND。

    为什么必须检测、不能写死比例坐标：实测登录按钮中心在
    720×1280 是屏高的 0.584、在 1080×2160 是 0.552 ——
    **同样 9:16 的两个分辨率，比例并不守恒**（卡片高度不是纯宽度缩放）。
    写死比例会在某一个分辨率上正好命中、在另一个上偏 70px ⇒ 点空且不报错。

    ⚠️ 第一版只按「每行有多少饱和像素」找带，返回值却**编造**了
    `x1=0, x2=width-1, width=width, cx=width//2, uniform=1.0, peak=1.0`
    —— 六个字段全是没量过的数：登录卡片居中、按钮两边明明有留白，
    输出却报「横贯整屏、实心度 100%」。按这份输出画框必然画错，
    而它偏偏又是判据里最容易被当成「量过了」的那部分。现在全部真量。
    """

    def _drop(reason: str) -> None:
        if explain is not None:
            explain.append(reason)

    width, height, ch, px = decode(path)
    rows: list[int] = []
    # ⚠️ 横向按 3 像素步长采样 ⇒ `rows` 存**抽样计数**、门槛也按抽样宽度算。
    # 第一版两处量纲打架（存 cnt*3 却拿它比 width*frac/3 ⇒ 实际门槛 0.10 屏宽），
    # 结果 Feed 页整片内容都被认成「按钮」。
    # ⚠️ 另一个更隐蔽的：Android 截图是 **RGBA**（ch=4），按 x*3 索引等于斜着抹像素 ——
    # 症状是「调阈值输出纹丝不动」，因为读的根本不是同一行的颜色。
    need = int(width * width_frac) // 3 + 1
    for y in range(height):
        base = y * width * ch
        cnt = 0
        for x in range(0, width, 3):
            i = base + x * ch
            r, g, b = px[i], px[i + 1], px[i + 2]
            hi = r if r > g else g
            if b > hi:
                hi = b
            lo = r if r < g else g
            if b < lo:
                lo = b
            if hi - lo >= sat_min:
                cnt += 1
        rows.append(cnt)

    bands: list[tuple[int, int]] = []
    start: int | None = None
    for y, c in enumerate(rows):
        if c >= need and start is None:
            start = y
        elif c < need and start is not None:
            bands.append((start, y - 1))
            start = None
    if start is not None:
        bands.append((start, len(rows) - 1))

    min_h = max(4, int(height * min_h_frac))
    max_h = int(height * max_h_frac)
    margin_min = int(width * min_margin_frac)
    xstep = 3
    xcols = len(range(0, width, xstep))
    best: tuple[int, int, int, int, int, int, int] | None = None
    # (area, y1, y2, sx1, sx2, 饱和像素数, 量过的行数)
    for y1, y2 in bands:
        bh = y2 - y1 + 1
        if bh < min_h:
            _drop(f"y[{y1}..{y2}] 带高 {bh}px < {min_h}px")
            continue
        if bh > max_h:
            _drop(
                f"y[{y1}..{y2}] 带高 {bh}px = {bh / height:.1%} 屏高 > {max_h_frac:.0%}"
                " —— 通栏色块，不是按钮"
            )
            continue
        # 真实横向外沿：在带内抽样若干行，量「饱和像素」的 min/max x。
        probe_rows = list(range(y1, y2 + 1, max(1, bh // 6))) or [y1]
        xs: list[int] = []
        for y in probe_rows:
            base = y * width * ch
            for x in range(width):
                i = base + x * ch
                r, g, b = px[i], px[i + 1], px[i + 2]
                if max(r, g, b) - min(r, g, b) >= sat_min:
                    xs.append(x)
        if not xs:
            _drop(f"y[{y1}..{y2}] 带内量不到饱和像素")
            continue
        sx1, sx2 = min(xs), max(xs)
        # 目标同一性：登录按钮在**居中卡片**里，左右必然有留白；
        # 贴到屏幕边的通栏色块不是它。
        if sx1 < margin_min or width - 1 - sx2 < margin_min:
            _drop(
                f"y[{y1}..{y2}] 饱和色块 x[{sx1}..{sx2}] 贴边"
                f"（左留白 {sx1}px / 右留白 {width - 1 - sx2}px，要求各 ≥{margin_min}px）"
            )
            continue
        area = sum(rows[y1 : y2 + 1])
        if best is None or area > best[0]:
            best = (area, y1, y2, sx1, sx2, len(xs), len(probe_rows))
    if best is None:
        return None
    _area, y1, y2, sx1, sx2, nsat, nrow = best
    bh = y2 - y1 + 1
    # uniform/peak 都是**实测量**。注意两个口径不同、别混用：
    #   · peak 来自 `rows`，是 3px 抽样列 ⇒ 分母 xcols；
    #   · uniform 来自上面那次**逐列全宽**扫描 ⇒ 分母是 width 而不是 xcols
    #     （混用会算出 >1 的「实心度」，第一版就是这么把假数写进输出的）。
    uniform = round(nsat / (nrow * width), 3) if nrow and width else 0.0
    peak = round(max(rows[y1 : y2 + 1]) / xcols, 3) if xcols else 0.0
    return {
        "x1": sx1, "x2": sx2, "y1": y1, "y2": y2,
        "cx": (sx1 + sx2) // 2, "cy": (y1 + y2) // 2,
        "width": sx2 - sx1, "height": bh,
        "uniform": uniform, "peak": peak,
        "aspect": round((sx2 - sx1) / bh, 2),
        "gap": (sx1, width - 1 - sx2),
    }


def main(argv: list[str]) -> int:
    args: list[str] = []
    csv = False
    wide_solid = False
    explain_on = False
    for a in argv[1:]:
        if a in ("-h", "--help"):
            _usage()
            return EXIT_OK
        if a == "--csv":
            csv = True
        elif a == "--wide-solid":
            wide_solid = True
        elif a == "--explain":
            explain_on = True
        elif a.startswith("-"):
            # ⚠️ 不认领的开关等于没开 —— 静默忽略会让「以为开了 --explain」
            # 和「以为没开 --wide-solid」都变成静默错判。
            print(f"  FAIL  未知开关 {a}", file=sys.stderr)
            _usage()
            return EXIT_USAGE
        else:
            args.append(a)
    if not args:
        _usage()
        return EXIT_USAGE
    rc = EXIT_OK
    for path in args:
        notes: list[str] = []
        try:
            band = find_wide_solid(path, explain=notes) if wide_solid else find_filled_band(path, explain=notes)
        except DECODE_ERRORS as exc:
            # 退出码 3 = 「这张图我没读懂」，与 1 = 「画面里没有这个东西」严格分开。
            # 报文必须**带路径 + 具体原因**：上游 `2>/dev/null` 吞掉的正是这部分信息，
            # 换句话说这些字是该脚本留给人的**唯一**诊断线索。
            print(f"输入不可读  {path}", file=sys.stderr)
            print(f"  原因：{type(exc).__name__}: {exc}", file=sys.stderr)
            # 聚合规则：多文件入参时取**最严重**的一档（1 < 3）——
            # 「有文件读不了」不该被后面某个文件的「没找到」盖掉。
            # ⚠️ 现有调用方（capture-md3-matrix.sh）每次只传一个文件，
            # 所以这条规则对它们不可观测。
            rc = max(rc, EXIT_UNREADABLE)
            continue
        if band is None:
            print(f"NOTFOUND  {path}", file=sys.stderr)
            for note in notes:
                print(f"  拒：{note}", file=sys.stderr)
            rc = max(rc, EXIT_NOTFOUND)
            continue
        if csv:
            print(f"{band['cx']},{band['cy']}")
        else:
            gap = band.get("gap")
            gap_txt = f" 两侧间隙={gap[0]}/{gap[1]}px" if isinstance(gap, tuple) else ""
            print(
                f"{path}\n"
                f"  控件 x[{band['x1']}..{band['x2']}] y[{band['y1']}..{band['y2']}] "
                f"中心=({band['cx']},{band['cy']}) 尺寸={band['width']}x{band['height']} "
                f"实心度={band['uniform']} 峰值={band['peak']} 宽高比={band.get('aspect')}{gap_txt}"
            )
        if explain_on:
            print(f"  [通过全部判据] {path}")
            for note in notes:
                print(f"  拒：{note}")
    return rc


def _usage() -> None:
    print("用法: find-ui-band.py <file.png> [--csv] [--wide-solid] [--explain]", file=sys.stderr)
    print("  --wide-solid：找宽实心**饱和**色块（定位登录按钮），而非中性分段控件", file=sys.stderr)
    print("  --csv：只输出 cx,cy（capture-md3-matrix.sh 的 detect_control 依赖这两列）", file=sys.stderr)
    print("  --explain：把每个被拒候选的原因打出来（判据可审计，防「一律 NOTFOUND」）", file=sys.stderr)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
