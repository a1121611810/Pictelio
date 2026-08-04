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


def saturated(r, g, b):
    return max(r, g, b) - min(r, g, b) > 50 and max(r, g, b) > 100


def login_elements(w, h, rows):
    """定位登录页输入框与按钮。

    启发式（稳定性优先）：
    1. 品牌蓝大块 = 登录按钮（最可靠特征）；
    2. 输入框 = 按钮上方最近的灰细条（<150px 高）。
    """
    # 逐行统计品牌蓝/中灰密度
    blue_rows, gray_rows = {}, {}
    for y in range(0, h, 4):
        b_cnt = g_cnt = 0
        for x in range(120, w - 120, 6):
            r, g, b = pixel(rows, y, x)
            if is_blue(r, g, b):
                b_cnt += 1
            if is_gray(r, g, b):
                g_cnt += 1
        if b_cnt > 6:
            blue_rows[y] = b_cnt
        if g_cnt > 8:
            gray_rows[y] = g_cnt

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

    blue_segs = segments(blue_rows)
    gray_segs = segments(gray_rows)

    result = {"input": None, "button": None}

    # 按钮 = 品牌蓝最宽（密度最高）的段（标题也有蓝但字少、密度低）
    button = None
    for y0, y1 in blue_segs:
        density = max(blue_rows.get(y, 0) for y in range(y0, y1 + 1, 4))
        if density > (button[2] if button else 0):
            button = (y0, y1, density)
    if button and button[1] - button[0] > 30:  # 高度 >30px 才算按钮（排除细文字）
        result["button"] = {"y": (button[0] + button[1]) // 2, "x": w // 2}
        btn_top = button[0]
    else:
        btn_top = h  # 无按钮 → 不约束输入框位置

    # 输入框 = 按钮上方最近的灰细条（<150px 高）——取最靠近按钮的（按钮正上方是输入框）
    best = None
    for y0, y1 in gray_segs:
        if y1 - y0 < 150 and y1 < btn_top:
            if best is None or y1 > best[1]:
                best = (y0, y1)
    if best:
        result["input"] = {"y": (best[0] + best[1]) // 2, "x": w // 2}

    return result


def topbar_nav(w, h, rows):
    """定位顶栏文字行：返回 {"y": 文字行中心, "blocks": [{x0,x1,cx}...]}。

    用途：带系统状态栏的屏幕上，顶栏（11.733vw 高）位于状态栏下方，
    固定坐标缩放不可靠（曾误点入卡片/状态栏）。动态检测深色文字行最稳。
    约定：最右侧文字块 = "我的"tab（推荐页），最左侧 = 返回按钮（详情/设置页）。
    """
    pts = []
    # 顶栏区域：跳过状态栏（灰色条，r≈g≈b 且整行都是会被误判为文字块），
    # 从 h*4.5% 开始（模拟器状态栏 ≈ 48px/1280）到 h*11%（顶栏 11.733vw 结束附近）
    for y in range(int(h * 0.045), int(h * 0.11), 2):
        for x in range(0, w, 2):
            r, g, b = pixel(rows, y, x)
            # 顶栏 tab 文字是品牌蓝（b 高）或深色（foreground）；排除纯灰（状态栏 r≈g≈b）
            is_dark = r < 140 and g < 140 and b < 140 and not (abs(r - g) < 20 and abs(g - b) < 20)
            is_brand = b > 120 and b > r + 30 and b > g + 20
            if is_dark or is_brand:
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
          "red": 红色像素数, "topbar": 顶部导航栏是否有内容}
    """
    colored = 0
    total = 0
    red = 0
    topbar = 0
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
            if 60 <= y <= 220 and not is_whiteish(r, g, b):
                topbar += 1
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

    # 顶部导航栏：y 80-210 的深色文字（登录页 pt-32vw 顶部空白，无导航文字）
    topbar_text = 0
    for y in range(80, 210, 4):
        for x in range(0, w, 8):
            r, g, b = pixel(rows, y, x)
            if r < 120 and g < 120 and b < 120:
                topbar_text += 1

    # 登录页：品牌蓝大按钮（屏幕中下部，随分辨率缩放——原硬编码 850-1150 是
    # OPPO 2160p 真机区域，720p 模拟器下按钮位置不同导致误判 blank）+ 无顶部导航文字
    blue_btn = 0
    blue_total = 0
    btn_y0, btn_y1 = int(h * 0.39), int(h * 0.53)
    for y in range(btn_y0, btn_y1, 4):
        for x in range(0, w, 8):
            r, g, b = pixel(rows, y, x)
            blue_total += 1
            if is_blue(r, g, b):
                blue_btn += 1
    if blue_total > 0 and blue_btn * 100 // blue_total >= 2 and topbar_text < 30:
        return {"page": "login", "colored": round(ratio, 3), "red": red}

    has_topbar = topbar_text > 30

    # 详情页：单一大块（max_run 连续彩色带 ≥8 = 480px+，大图）+ 中部非白密集
    if has_topbar and max_run >= 8:
        mid_nonwhite = 0
        mid_total = 0
        for y in range(220, min(h, 1400), 8):
            for x in range(0, w, 16):
                r, g, b = pixel(rows, y, x)
                mid_total += 1
                if not is_whiteish(r, g, b):
                    mid_nonwhite += 1
        mid_ratio = mid_nonwhite / mid_total if mid_total else 0
        if mid_ratio > 0.4:
            return {"page": "detail", "colored": round(ratio, 3), "red": red}

    if has_topbar:
        if ratio > 0.25 and max_run >= 8:
            return {"page": "detail", "colored": round(ratio, 3), "red": red}
        if ratio > 0.05:
            return {"page": "recommended", "colored": round(ratio, 3), "red": red}
        # 中部大块非白（浅色大图/文本页）→ 详情或文本：靠顶部栏+标题文字区分
        mid_nonwhite = 0
        mid_total = 0
        for y in range(220, min(h, 1200), 8):
            for x in range(0, w, 16):
                r, g, b = pixel(rows, y, x)
                mid_total += 1
                if not is_whiteish(r, g, b):
                    mid_nonwhite += 1
        mid_ratio = mid_nonwhite / mid_total if mid_total else 0
        if mid_ratio > 0.35 and ratio > 0.01:
            # 顶部有标题文字（深色行）+ 中部大块 → 详情页（大图浅色时彩色低）
            dark_top = 0
            for y in range(220, 400, 4):
                for x in range(60, 1020, 8):
                    r, g, b = pixel(rows, y, x)
                    if r < 120 and g < 120 and b < 120:
                        dark_top += 1
            if dark_top > 30:
                return {"page": "detail", "colored": round(ratio, 3), "red": red}
            return {"page": "text", "colored": round(ratio, 3), "red": red}
        if ratio > 0.005:
            return {"page": "text", "colored": round(ratio, 3), "red": red}
        return {"page": "me", "colored": round(ratio, 3), "red": red}
    # 无顶部栏：登录页（品牌蓝按钮）或空白
    for y in range(850, 1150, 4):
        for x in range(0, w, 8):
            r, g, b = pixel(rows, y, x)
            if is_blue(r, g, b):
                return {"page": "login", "colored": round(ratio, 3), "red": red}
    return {"page": "blank", "colored": round(ratio, 3), "red": red}


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
    else:
        print(json.dumps({"error": f"unknown mode {mode}"}))


if __name__ == "__main__":
    main()
