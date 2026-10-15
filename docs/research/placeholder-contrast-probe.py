"""T4-6 像素验收（issue #693 / #1014）：暗色下输入框 placeholder 对比度 ≥ 4.5:1。

## 自检纪律（本文件已踩三次坑，每次都是「算出一个看起来合理的数字」）

1. `lum()` 必须吃**归一化 0–1** 的值。喂 0–255 会静默算出 25.46:1 这种不可能值。
2. `np.abs(list - scalar)` 是 **Python 列表语义**，不是数组运算 —— 曾经选中错的像素，
   把真实的 7.3 PASS 报成 1.03 FAIL。必须 `np.abs(np.array(...) - lb)`。
3. 采样窗手算坐标会偏。窗口应**按实测文字像素自动定位**，或至少打印窗内颜色分布自查。

⇒ 因此这里不只钉黑白端点，而是跑一条**合成图端到端自检**：造一张已知 fg/bg 的图，
用与正式测量**完全相同**的代码路径跑一遍，断言能还原出原值与原对比度。
端点自检挡不住「中间的 argmax 选错像素」这类错误。
"""
import subprocess
import sys

import numpy as np
from PIL import Image


def _lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def rel_lum(rgb255):
    c = _lin(np.asarray(rgb255, dtype=float) / 255.0)
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]


def contrast(a, b):
    la, lb = rel_lum(a), rel_lum(b)
    hi, lo = max(la, lb), min(la, lb)
    return (hi + 0.05) / (lo + 0.05)


def measure(img, win, label, quiet=False):
    """win=(x0,y0,x1,y1)。背景=窗口众数分箱内真实像素的中位数；
    前景=背景之外亮度差最大的像素（笔画峰值）。"""
    x0, y0, x1, y1 = win
    px = img[y0:y1, x0:x1].reshape(-1, 3)
    if len(px) == 0:
        print(f"{label:<30} 窗口无像素")
        return None
    q = (px // 4) * 4
    vals, counts = np.unique(q, axis=0, return_counts=True)
    in_bin = np.all(q == vals[int(np.argmax(counts))], axis=1)
    bg = np.median(px[in_bin], axis=0)
    ink = px[np.abs(px - bg).sum(axis=1) >= 12]
    if len(ink) == 0:
        print(f"{label:<30} 无前景像素（文字与背景色差 < 12，视为不可辨识）")
        return None
    lb = rel_lum(bg)
    # ⚠️ 必须先转 ndarray：`np.abs([list] - lb)` 走 Python 列表语义，会选中错的像素。
    lums = np.array([rel_lum(p) for p in ink], dtype=float)
    fg = ink[int(np.argmax(np.abs(lums - lb)))]
    ratio = contrast(fg, bg)
    hx = lambda c: "#%02x%02x%02x" % tuple(int(round(v)) for v in c)
    if not quiet:
        print(f"{label:<30} fg={hx(fg)}  bg={hx(bg)}  对比度={ratio:5.2f}  "
              f"{'PASS' if ratio >= 4.5 else 'FAIL'}")
    return ratio


def _synthetic_selfcheck():
    """端到端自检：造已知 fg/bg 的图，走同一条 measure() 路径，断言能还原。"""
    cases = [
        ((65, 71, 78), (224, 227, 233), "亮色 #41474e on #e1e3e9"),
        ((194, 199, 207), (50, 53, 57), "暗色 #c2c7cf on #323539"),
        ((255, 255, 255), (0, 0, 0), "黑白极值"),
        ((219, 221, 228), (224, 224, 232), "近邻色（应判 FAIL）"),
    ]
    H = W = 60
    for fg, bg, name in cases:
        img = np.zeros((H, W, 3), dtype=int)
        img[:, :] = bg
        # 画几笔「文字」：横条纹，模拟字形覆盖 ~12% 面积（与真实 placeholder 接近）
        for r in range(10, 50, 3):
            img[r, 8:30] = fg
        got = measure(img, (0, 0, W, H), f"[自检] {name}", quiet=True)
        want = contrast(np.array(fg), np.array(bg))
        assert got is not None and abs(got - want) < 0.01, (
            f"自检失败：{name} 期望 {want:.4f}，实得 {got}"
        )
    print(f"[自检] {len(cases)} 张合成图端到端还原成功（含近邻色反例）\n")


def _endpoint_selfcheck():
    black, white = np.array([0, 0, 0]), np.array([255, 255, 255])
    assert abs(contrast(black, white) - 21.0) < 0.01
    assert abs(contrast(white, white) - 1.0) < 1e-9
    print("[自检] 端点（黑白 21:1 / 同色 1:1）通过")


def grab(path="/tmp/t46.png"):
    with open(path, "wb") as f:
        subprocess.run(["adb", "exec-out", "screencap", "-p"], stdout=f, check=True)
    return np.asarray(Image.open(path).convert("RGB")).astype(int)


if __name__ == "__main__":
    _endpoint_selfcheck()
    _synthetic_selfcheck()
    if len(sys.argv) > 2:
        img = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
        win = tuple(int(v) for v in sys.argv[2].split(","))
        label = sys.argv[3] if len(sys.argv) > 3 else "窗口"
        r = measure(img, win, label)
        if r is not None:
            print(f"→ {r:.2f}:1 {'PASS (≥4.5)' if r >= 4.5 else 'FAIL'}")
