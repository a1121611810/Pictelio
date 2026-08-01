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
    """定位登录页输入框（中灰细条）与按钮（品牌蓝块）中心。"""
    # 逐行统计中灰/品牌蓝，找密集段
    gray_rows, blue_rows = {}, {}
    for y in range(0, h, 4):
        g_cnt = b_cnt = 0
        for x in range(120, w - 120, 6):
            r, g, b = pixel(rows, y, x)
            if is_gray(r, g, b):
                g_cnt += 1
            if is_blue(r, g, b):
                b_cnt += 1
        if g_cnt > 8:
            gray_rows[y] = g_cnt
        if b_cnt > 6:
            blue_rows[y] = b_cnt
    # 聚合成段（连续 y）
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

    gray_segs = segments(gray_rows)
    blue_segs = segments(blue_rows)
    result = {"input": None, "button": None}
    for y0, y1 in gray_segs:
        # 输入框：细条（高度 < 150px）
        if y1 - y0 < 150:
            result["input"] = {"y": (y0 + y1) // 2}
    for y0, y1 in blue_segs:
        if y1 - y0 > 40:  # 按钮/标题块
            result["button"] = {"y": (y0 + y1) // 2}
    for k in ("input", "button"):
        if result[k]:
            result[k]["x"] = w // 2
    return result


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
    else:
        print(json.dumps({"error": f"unknown mode {mode}"}))


if __name__ == "__main__":
    main()
