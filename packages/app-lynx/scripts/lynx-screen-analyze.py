#!/usr/bin/env python3
"""真机 Lynx 截图分析器（自动化验证用）。

用法:
  lynx-screen-analyze.py <png> login-elements   # 输出 JSON: 输入框/按钮中心坐标
  lynx-screen-analyze.py <png> page-state       # 输出 JSON: 页面状态
  lynx-screen-analyze.py <png> image-ratio      # 输出 JSON: 彩色(图片)区域占比
"""
import json
import sys
import zlib
from struct import unpack


def load_png(path):
    with open(path, "rb") as f:
        data = f.read()
    pos = 8
    idat = b""
    w = h = None
    while pos < len(data):
        ln = unpack(">I", data[pos : pos + 4])[0]
        typ = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + ln]
        if typ == b"IHDR":
            w, h = unpack(">II", chunk[:8])
        elif typ == b"IDAT":
            idat += chunk
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4
    prev = bytearray(stride)
    rows = []
    i = 0
    for _y in range(h):
        ft = raw[i]
        i += 1
        line = bytearray(raw[i : i + stride])
        i += stride
        if ft == 1:
            for x in range(4, stride):
                line[x] = (line[x] + line[x - 4]) & 255
        elif ft == 2:
            for x in range(stride):
                line[x] = (line[x] + prev[x]) & 255
        elif ft == 3:
            for x in range(stride):
                line[x] = (line[x] + ((prev[x] + (line[x - 4] if x >= 4 else 0)) >> 1)) & 255
        elif ft == 4:
            for x in range(stride):
                a = line[x - 4] if x >= 4 else 0
                b = prev[x]
                c = prev[x - 4] if x >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[x] = (line[x] + pr) & 255
        rows.append(bytes(line))
        prev = line
    return w, h, rows


def pixel(rows, y, x):
    return rows[y][x * 4], rows[y][x * 4 + 1], rows[y][x * 4 + 2]


def is_blue(r, g, b):
    return b > 140 and b - r > 80 and 60 < g < 150


def is_gray(r, g, b):
    return 140 <= r <= 235 and abs(r - g) < 12 and abs(g - b) < 12


def is_whiteish(r, g, b):
    return r > 240 and g > 240 and b > 240


def luminance(c):
    """Rec.601 亮度（0..255）。主题归一的全部判据都建立在它之上（#1036）。"""
    r, g, b = c
    return int(0.299 * r + 0.587 * g + 0.114 * b)


# ─── #1036 标定常量（每一项的实测依据见 docs/verification/CALIBRATION-flow-check.md） ───
#
# 旧判据（`is_whiteish` 定义「非白」+ 6 个魔数）的主题盲根因：暗色主题下几乎没有白像素，
# 于是「非白占比」恒 ≈1、每个页面都走进 detail 分支。
#
# 新判据一律**背景相对**：每行取自己的亮度众数当该行背景，数偏离它的像素占比
# （下称 busy）。行内局部背景对两件事同时免疫：① 亮/暗主题 ② 文字压在大图上还是表面上。
# 主题锚点另取顶栏带中位亮度（顶栏是纯表面色，不会被作品图带偏）。
CALIB_DELTA = 20  # 「偏离背景」判定亮度差。实测各帧在 δ=8..32 间排序稳定，取中间值
CALIB_BUSY_ART = 0.20  # busy ≥ 此值 = 作品页（推荐 0.390 / 详情 0.296）
CALIB_BUSY_TEXT = 0.06  # busy ≥ 此值 = 文本页（设置 0.124）；我的页 0.032 在其下
CALIB_RUN_DETAIL = 13  # 连续彩色带 ≥ 此值 = 单大图详情（详情 16 / 推荐 10）
CALIB_BUSY_LOGIN_MAX = 0.03  # 登录页头部无导航文字（实测登录页与空页均 <0.03）
CALIB_BUSY_BLANK = 0.008
CALIB_BTN_ROW_COVER = 0.45  # 登录按钮行的饱和像素覆盖率下限（实测按钮行 0.65-0.70，其余页 0）
CALIB_BTN_ROWS = 8  # 连续实心饱和行数下限（实测登录页 19，其余页 0）  # busy < 此值 = 近乎空白（实测空小说列表 0.019、我的页 0.033）

# 头部带 / 内容带的纵向范围（比例式，避免 1080 与 720 宽屏的硬编码越界问题）
HEADER_Y0, HEADER_Y1 = 0.035, 0.20
BODY_Y0, BODY_Y1 = 0.20, 0.85


def _row_mode(values, bucket=8):
    """一行的亮度众数。桶宽 8 是采样噪声的量级（相邻行同色像素亮度抖动 <8）。"""
    hist = {}
    for v in values:
        k = (v // bucket) * bucket
        hist[k] = hist.get(k, 0) + 1
    return max(hist.items(), key=lambda kv: kv[1])[0]


def busy_ratio(w, h, rows, y0_frac, y1_frac, y_step=6, x_step=12, delta=CALIB_DELTA):
    """背景相对的内容占比：每行独立取背景，再统计偏离该背景的像素比例。

    > 与旧 `mid_nonwhite / mid_total` 的区别（这是 #1036 的核心）：旧判据拿**整页**的
    > 「白 vs 非白」比，暗色下分母里的「白」几乎为 0 ⇒ 比值恒 1。新判据的行局部背景
    > 在纯背景行上给出 ≈0、在有内容的行上给出有意义的占比，于是暗色与亮色同构。
    """
    n = 0
    total = 0
    for y in range(int(h * y0_frac), min(h, int(h * y1_frac)), y_step):
        vals = [luminance(pixel(rows, y, x)) for x in range(0, w, x_step)]
        base = _row_mode(vals)
        for x in range(0, w, x_step):
            total += 1
            if abs(luminance(pixel(rows, y, x)) - base) > delta:
                n += 1
    return n / total if total else 0.0


def theme_background_lum(w, h, rows):
    """主题锚点：顶栏带亮度中位数。顶栏是纯表面色 ⇒ 不会被作品图污染。

    > 为什么不用整页中位数：实测推荐页整页中位亮度 69、详情页 226，而**两者同为暗色
    > 主题**——大图（推荐页插画 / 详情页大图）会把整页统计带偏。顶栏带没有这个问题。
    """
    vals = sorted(
        luminance(pixel(rows, y, x))
        for y in range(int(h * HEADER_Y0), int(h * 0.12), 4)
        for x in range(0, w, 4)
    )
    return vals[len(vals) // 2] if vals else 128


def saturated(r, g, b):
    return max(r, g, b) - min(r, g, b) > 50 and max(r, g, b) > 100


def login_elements(w, h, rows):
    """定位登录页输入框与按钮。

    启发式（稳定性优先）：
    1. 主按钮 = 中下部**宽而实心的饱和色块**（判形态不判色相）；
    2. 输入框 = 按钮上方最近的、与卡片底色不同的**矩形条带**（不按高度猜）。

    ⚠️ #1036：此处原先用 `is_blue` 找按钮，而 `is_blue` 对真实登录帧**一个像素都命中
    不了**（按钮实测色 `(155,203,250)`，卡在 `g<140` 上）⇒ 登录自动化一直报
    「登录页定位失败」。补硬编码色值是 #709 已栽过的坑，故一律改判形态。
    """
    y0, y1 = int(h * 0.35), int(h * 0.70)
    # 逐行统计饱和色覆盖率（按钮）/ 与卡片底色的差异（输入框）
    sat_rows, card_rows = {}, {}
    for y in range(y0, y1, 4):
        sat = 0
        for x in range(0, w, 6):
            if saturated(*pixel(rows, y, x)):
                sat += 1
        cover = sat * 100 // max(1, len(range(0, w, 6)))
        if cover >= CALIB_BTN_ROW_COVER * 100:
            sat_rows[y] = cover
        # 输入框：整行众数亮度明显高于/低于卡片底色且该行较均匀 ⇒ 记一条带
        vals = [luminance(pixel(rows, y, x)) for x in range(0, w, 8)]
        mode_l = _row_mode(vals)
        uniform = sum(1 for v in vals if abs(v - mode_l) <= CALIB_DELTA) / max(1, len(vals))
        if uniform >= 0.45:
            card_rows[y] = mode_l

    def segments(d):
        segs = []
        cur = None
        for y in sorted(d):
            if cur and y - cur[1] <= 12:
                cur = (cur[0], y)
            else:
                if cur:
                    segs.append(cur)
                cur = (y, y)
        if cur:
            segs.append(cur)
        return segs

    result = {"input": None, "button": None}

    # 按钮 = 最长的实心饱和条带
    btn_segs = segments(sat_rows)
    button = max(btn_segs, key=lambda s: s[1] - s[0]) if btn_segs else None
    if button and button[1] - button[0] >= 30:
        result["button"] = {"y": (button[0] + button[1]) // 2, "x": w // 2}
        btn_top = button[0]
    else:
        btn_top = h

    # 输入框 = 按钮上方最近的「与卡片底色不同」的条带（输入框是浅色块、卡片更深）
    dark = sorted(card_rows.items())
    card_mode = None
    if dark:
        card_mode = max(set(v for _, v in dark), key=lambda v: sum(1 for _, x in dark if x == v))
    best = None
    for y, lv in dark:
        if y < btn_top and card_mode is not None and abs(lv - card_mode) > CALIB_DELTA:
            if best is None or y > best:
                best = y
    if best is not None:
        result["input"] = {"y": best, "x": w // 2}

    return result


def topbar_nav(w, h, rows):
    """定位顶栏文字行：返回 {"y": 文字行中心, "blocks": [{x0,x1,cx}...]}。

    用途：带系统状态栏的屏幕上，顶栏（11.733vw 高）位于状态栏下方，
    固定坐标缩放不可靠（曾误点入卡片/状态栏）。动态检测文字行最稳。

    ⚠️ **主题归一（#1036）**：原实现把「深色」写死为 `r<140 and g<140 and b<140`。
    暗色主题下**未选中**的 tab 是暗灰（实测亮度 ≥140）根本检测不到，只剩选中 tab
    一个块 ⇒ flow-check 步骤 8 的「blocks≥3 才算推荐页」**永远不满足**，每次退出 1
    （2026-10-17 实测「无法回到推荐页顶栏（blocks=0）」即此）。现改为「相对顶栏
    背景高对比」，对明暗主题同构。

    扫描带取 y[0.035h, 0.20h]：推荐页的三 tab 在 y≈95，设置页的「← 标题」在 y≈205
    （两种布局的顶栏高度不同，取窄带会漏掉后者）。
    """
    y0, y1 = int(h * HEADER_Y0), int(h * 0.20)
    # 顶栏背景：扫描带内容区的亮度众数（顶栏是纯表面色）
    vals = [luminance(pixel(rows, y, x)) for y in range(y0, y1, 4) for x in range(0, w, 4)]
    if not vals:
        return {}
    base = _row_mode(vals)

    pts = []
    for y in range(y0, y1, 2):
        vals = [luminance(pixel(rows, y, x)) for x in range(0, w, 4)]
        # 只认**顶栏行**：该行众数必须贴近顶栏背景。内容行（大图/卡片）众数是它自己的
        # 颜色，不贴近 ⇒ 排除。否则扫描带下缘的内容会把 tab 连成一大块（实测推荐页
        # 曾因此返回 x0..x1 贯穿全屏的单块）。
        if abs(_row_mode(vals) - base) > CALIB_DELTA:
            continue
        for x in range(0, w, 2):
            # 文字 = 相对顶栏背景的高对比像素（明暗主题同构：暗色下文字比背景亮）
            if abs(luminance(pixel(rows, y, x)) - base) > CALIB_DELTA:
                pts.append((x, y))
    if not pts:
        return {}
    ys = [p[1] for p in pts]
    yc = sum(ys) // len(ys)
    xs = sorted(set(p[0] for p in pts))
    blocks = []
    cur = [xs[0]]
    for x in xs[1:]:
        if x - cur[-1] <= 24:
            cur.append(x)
        else:
            blocks.append((min(cur), max(cur)))
            cur = [x]
    blocks.append((min(cur), max(cur)))
    out = []
    for x0, x1 in blocks:
        if x1 - x0 >= 10:  # 过滤单点噪声
            out.append({"x0": x0, "x1": x1, "cx": (x0 + x1) // 2})
    return {"y": yc, "blocks": out}


def classify(w, h, rows):
    """细粒度页面分类（完整流程自动化用）。

    返回 {"page": recommended|detail|text|me|login|blank, "colored": 彩色占比,
          "red": 红色像素数, "busy": 背景相对内容占比, "theme_lum": 顶栏背景亮度}

    ⚠️ **主题归一（#1036）**：本函数原先用 `is_whiteish` 定义「非白」，暗色主题下该比值
    恒 ≈1 ⇒ **每个页面都返回 detail**（实测推荐页/详情页/我的页全部误判 detail）。
    现全部改为背景相对判据，阈值依据见本文件 CALIB_* 常量与
    docs/verification/CALIBRATION-flow-check.md 的真实帧实测表。
    """
    colored = 0
    total = 0
    red = 0
    # 彩色行分布：判断"单大块"（详情图）vs"多块分散"（瀑布流）
    col_bands = {}
    for y in range(0, h, 6):
        band = y // 60
        for x in range(0, w, 12):
            r, g, b = pixel(rows, y, x)
            total += 1
            if saturated(r, g, b):
                colored += 1
                col_bands[band] = col_bands.get(band, 0) + 1
            if r > 170 and g < 110 and b < 110:
                red += 1
    ratio = colored / total if total else 0
    # 彩色集中度：最大连续彩色带（单大块 = 详情图）
    bands = sorted(col_bands.items())
    max_run = 0
    run = 0
    prev = -10
    for b, _n in bands:
        run = run + 1 if b - prev <= 2 else 1
        max_run = max(max_run, run)
        prev = b

    # 背景相对的两个占比（替代旧的 mid_nonwhite/total 与 dark_top/topbar_text）
    busy_body = busy_ratio(w, h, rows, BODY_Y0, BODY_Y1)
    busy_header = busy_ratio(w, h, rows, HEADER_Y0, HEADER_Y1, y_step=3, x_step=6)
    theme_lum = theme_background_lum(w, h, rows)
    out = {"colored": round(ratio, 3), "red": red, "busy": round(busy_body, 3), "theme_lum": theme_lum}

    # 登录页：屏幕中下部有一个**宽而实心的饱和色块**（主按钮）。
    #
    # ⚠️ 这里**不再用 is_blue**（#1036）。旧判据 `b>140 and b-r>80 and 60<g<150` 在真实
    # 登录帧上一个像素都命中不了：登录按钮实测色 `(155,203,250)`，卡在 `g<150` 上 ⇒
    # classify 把登录页判成 text（2026-10-18 实测）。补硬编码色值是 #709 已经栽过的坑
    # （判据里钉死色板值 → 配色一改即失效），故改判**形态**不判**色相**：
    # 「整行 ≥CALIB_BTN_ROW_COVER 比例的像素是饱和色，且这样的行连续出现 ≥CALIB_BTN_ROWS 行」。
    # 真实帧实测（720×1280 暗色）：登录页 19 行，推荐/详情/设置/我的/空列表**全部 0 行**。
    btn_rows = 0
    for y in range(int(h * 0.35), int(h * 0.70), 4):
        sat = tot = 0
        for x in range(0, w, 6):
            tot += 1
            if saturated(*pixel(rows, y, x)):
                sat += 1
        if tot and sat / tot >= CALIB_BTN_ROW_COVER:
            btn_rows += 1
    if btn_rows >= CALIB_BTN_ROWS and busy_header < CALIB_BUSY_LOGIN_MAX:
        return dict(out, page="login", btn_rows=btn_rows)

    # 作品页（推荐瀑布流 / 详情大图）：内容区背景相对占比高
    if busy_body >= CALIB_BUSY_ART:
        # 单大图详情 = saturated 像素集中在**连续**少数几个带；瀑布流分散在多带。
        if max_run >= CALIB_RUN_DETAIL:
            return dict(out, page="detail")
        return dict(out, page="recommended")

    # 列表型页面（我的）：文字稀疏、几乎无图
    if busy_body >= CALIB_BUSY_TEXT:
        return dict(out, page="text")

    # 近乎空白（骨架屏空壳 / 加载中）：比空列表（实测 0.019）更低，比列表型页面（0.033）更低。
    # ⚠️ 必须保留这一支：flow-check 多处以 `page != blank` 作为「页面已就绪」的判据，
    # 若 classify 永不返回 blank，那些判断会静默退化成恒真（#1036 的第二类缺陷）。
    if busy_body < CALIB_BUSY_BLANK:
        return dict(out, page="blank")

    # 列表型页面（我的）
    return dict(out, page="me")


def page_state(w, h, rows):
    """判断页面状态：login / blank / skeleton / images。"""
    blue_btn_area = 0  # 登录按钮区（y 900-1150）品牌蓝
    colored = 0
    colored_total = 0
    for y in range(300, min(h, 2000), 6):
        for x in range(0, w, 12):
            r, g, b = pixel(rows, y, x)
            if saturated(r, g, b):
                colored += 1
                if 900 <= y <= 1150 and is_blue(r, g, b):
                    blue_btn_area += 1
            colored_total += 1
    ratio = colored / colored_total if colored_total else 0
    if blue_btn_area > 10:
        return {"state": "login", "image_ratio": round(ratio, 3)}
    if ratio > 0.06:
        return {"state": "images", "image_ratio": round(ratio, 3)}
    if ratio > 0.01:
        return {"state": "skeleton_or_sparse", "image_ratio": round(ratio, 3)}
    return {"state": "blank", "image_ratio": round(ratio, 3)}


def read_chip_tokens(tokens_css):
    """从 tokens.css 解析收藏 chip 两态底色（#709）。

    返回 [{theme, tertiary:(r,g,b), inverse:(r,g,b)}]。**运行时解析**而不是硬编码色值：
    配色一改这里自动跟随 —— 旧判据（按青度找已收藏色）失效的根因就是「判据里钉死了
    某个色板的值」。7 主题 × 明暗 = 14 个组合，只有 3 个（sky/green/bili 亮色板）
    的 tertiary 偏青，其余全部判不出「已收藏」。
    """
    import re

    with open(tokens_css, "r", encoding="utf-8") as f:
        css = f.read()
    css = re.sub(r"/\*[\s\S]*?\*/", " ", css)  # 注释会混进「选择器」，必须先剥
    out = {}
    for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
        sel = " ".join(sel.split())
        t = re.search(r"--md-tertiary:\s*(#[0-9a-fA-F]{6})\s*;", body)
        inv = re.search(r"--md-inverse-surface:\s*(#[0-9a-fA-F]{6})\s*;", body)
        if not t or not inv:
            continue
        name = re.search(r"\.theme-([\w-]+)", sel)
        if not name:
            continue
        dark = bool(re.search(r"\.theme-[\w-]+\.dark\b", sel))
        if bool(re.search(r"\.dark\b", sel)) != dark:
            continue
        out.setdefault(name.group(1) + (".dark" if dark else ""), (t.group(1), inv.group(1)))
    tokens = []
    for theme in sorted(out):
        t_hex, inv_hex = out[theme]
        tokens.append(
            {
                "theme": theme,
                "tertiary": tuple(int(t_hex[i : i + 2], 16) for i in (1, 3, 5)),
                "inverse": tuple(int(inv_hex[i : i + 2], 16) for i in (1, 3, 5)),
            }
        )
    return tokens


# 色值容差（RGB 三通道和）：跨族最近色对距离 50（tokens.css 全表算出），取 24 留 2 倍余量。
CHIP_TOLERANCE = 24
# 窗口内 chip 实色占比下限（设备实测已收藏态 0.308 / 未收藏 0，取 0.15 留余量）
CHIP_MIN_SHARE = 0.15
# 采样窗口半宽/半高/步长：与 packages/android-host/tests/android-e2e/bookmark-chip.ts
# 的 WINDOW_HALF_WIDTH / WINDOW_HALF_HEIGHT / WINDOW_STEP **逐字一致**。
# ⚠️ 这三个常量必须与 TS 版同步：占比的分母是**窗口内**采样点数（120），
# 不是整个卡片区网格。两者同用 0.15 阈值但分母差两个数量级时，真机会恒判 unknown。
CHIP_WIN_HALF_W = 19
CHIP_WIN_HALF_H = 22
CHIP_WIN_STEP = 4


def bookmark_chip(w, h, rows, tokens_css):
    """定位收藏 chip 并判收藏态（#709，配色无关）。

    输出 {"x","y","bg","share","state"}：
      state ∈ bookmarked / not-bookmarked / unknown
      unknown = 判不出（窗口里没有 chip 实色，或色值同时落在两族令牌里）。

    为什么不能继续用红像素：chip 底色是 M3 令牌实色（未收藏 `--md-inverse-surface`、
    已收藏 `--md-tertiary`，spec docs/specs/bookmark-color.md §配色）。措辞要说准：
    这 28 个 chip 色里**有 13 个是 R > G 的**（如 violet.dark `#efb8c8`），所以
    「没有一个是红的」是错的；成立的是更弱也更有用的那句——**没有一个能命中旧定位器的
    判据** `r > 150 and g < 100 and b < 100`（实测 0 命中，因为它们的 G 都远大于 100）。
    而推荐流的作品图里**到处是能被该判据命中的红**，旧定位器于是会去点画上的
    红色插画，然后报「收藏未生效」。

    两段式：**粗扫**在卡片区找 chip 令牌色的像素团并取质心（定位），
    **细测**在质心周围的固定窗口内按精确 RGB 分组取众数（判态）。
    占比的分母是窗口内采样点数，与 TS 版同口径。
    """
    tokens = read_chip_tokens(tokens_css)
    if not tokens:
        return {"x": None, "y": None, "state": "unknown", "reason": "tokens.css 未解析出任何主题"}

    def near(c, t):
        return abs(c[0] - t[0]) + abs(c[1] - t[1]) + abs(c[2] - t[2]) <= CHIP_TOLERANCE

    def matchable(c):
        return any(near(c, t["tertiary"]) or near(c, t["inverse"]) for t in tokens)

    # 粗扫：卡片区（屏幕下半部，推荐流轮播卡 + 收藏胶囊都落在那里）内找 chip 令牌色像素，
    # 按精确 RGB 分组并累加质心。不用「红色」等任何色相条件，作品图不会因此被选中。
    y_lo = int(h * 0.45)
    colors = {}
    for y in range(y_lo, h, 2):
        for x in range(0, w, 2):
            c = pixel(rows, y, x)
            if not matchable(c):
                continue
            e = colors.get(c)
            if e is None:
                colors[c] = [1, x, y]
            else:
                e[0] += 1
                e[1] += x
                e[2] += y
    if not colors:
        return {"x": None, "y": None, "state": "unknown", "reason": "卡片区未检出 chip 实色"}

    _, (n, sum_x, sum_y) = max(colors.items(), key=lambda kv: kv[1][0])
    cx = sum_x // float(n)
    cy = sum_y // float(n)

    # 细测：质心周围的固定窗口内，可匹配像素按精确 RGB 分组，取众数。
    groups = {}
    total = 0
    for y in range(int(cy) - CHIP_WIN_HALF_H, int(cy) + CHIP_WIN_HALF_H + 1, CHIP_WIN_STEP):
        if y < 0 or y >= h:
            continue
        for x in range(int(cx) - CHIP_WIN_HALF_W, int(cx) + CHIP_WIN_HALF_W + 1, CHIP_WIN_STEP):
            if x < 0 or x >= w:
                continue
            total += 1
            c = pixel(rows, y, x)
            if not matchable(c):
                continue
            groups[c] = groups.get(c, 0) + 1
    if total == 0:
        return {"x": None, "y": None, "state": "unknown", "reason": "采样窗口完全落在画面外"}

    bg, best_n = max(groups.items(), key=lambda kv: kv[1]) if groups else (None, 0)
    share = best_n / float(total)
    if bg is None:
        return {
            "x": int(cx),
            "y": int(cy),
            "bg": None,
            "share": round(share, 3),
            "state": "unknown",
            "reason": f"窗口内 chip 实色占比 {share:.3f} < {CHIP_MIN_SHARE}",
        }
    marked = [t["theme"] for t in tokens if near(bg, t["tertiary"])]
    unmarked = [t["theme"] for t in tokens if near(bg, t["inverse"])]
    if share < CHIP_MIN_SHARE:
        return {
            "x": int(cx),
            "y": int(cy),
            "bg": "#%02x%02x%02x" % bg,
            "share": round(share, 3),
            "state": "unknown",
            "reason": f"chip 实色占比 {share:.3f} < {CHIP_MIN_SHARE}",
        }
    if marked and not unmarked:
        state = "bookmarked"
    elif unmarked and not marked:
        state = "not-bookmarked"
    else:
        state = "unknown"
    return {
        "x": int(cx),
        "y": int(cy),
        "bg": "#%02x%02x%02x" % bg,
        "share": round(share, 3),
        "state": state,
        "marked": marked,
        "unmarked": unmarked,
    }


def main():
    path, mode = sys.argv[1], sys.argv[2]
    w, h, rows = load_png(path)
    if mode == "login-elements":
        print(json.dumps(login_elements(w, h, rows)))
    elif mode == "page-state":
        print(json.dumps(page_state(w, h, rows)))
    elif mode == "classify":
        print(json.dumps(classify(w, h, rows)))
    elif mode == "topbar-nav":
        print(json.dumps(topbar_nav(w, h, rows)))
    elif mode == "bookmark-chip":
        # 第 3 个参数 = tokens.css 路径（调用方给，脚本不猜 cwd）
        css = sys.argv[3] if len(sys.argv) > 3 else "src/styles/tokens.css"
        print(json.dumps(bookmark_chip(w, h, rows, css)))
    else:
        print(json.dumps({"error": f"unknown mode {mode}"}))


if __name__ == "__main__":
    main()
