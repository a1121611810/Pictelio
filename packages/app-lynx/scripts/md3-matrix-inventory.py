#!/usr/bin/env python3
"""把截图矩阵的机器证据汇成一张表（Markdown），供 T16 结论文档引用。

**这张表只回答机器能回答的问题**：
- 该图是否真的拍到了（PNG 合法、非 0 字节）
- 外观模式是否与文件名声称的一致（**顶栏**平均亮度：亮 >100 / 暗 <70，见 MODE_REGION）
- 内容区是否有内容（标准差 ≥20，防「合法 PNG 的空白页」冒充证据）

观感类问题（圆角观感、排版节奏、层级是否可辨、图标观感）**这张表一概不管** ——
它们没有客观阈值，只能人眼判。刻意把机器证据与人工判读分两张表，
就是为了不让下一个人误以为「表全绿 = 视觉没问题」。
"""
from __future__ import annotations

import importlib.util
import pathlib
import re
import sys

HERE = pathlib.Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("pl", HERE / "png-luma.py")
assert spec and spec.loader
pl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pl)

CONTENT_REGION = (0.05, 0.10, 0.95, 0.78)
DARK_MAX, LIGHT_MIN = 70, 100
MIN_CONTENT_SD = 20

# ⚠️ 明暗判据量的是**顶栏中段**，不是整幅 —— 整幅量的是「画」不是「主题」（见结论文档 §8.6）。
# Feed 页被作品图主导：`w-1080x2160-dark-feed.png` 整幅均值 103.68（> 阈值 70）被判
# 「不是暗色」，而图上是黑 app bar / 黑底 / 暗色 FAB。
#
# ⚠️⚠️⚠️ 这里**曾经**是「底部 7%」，第三十二轮改成顶栏 —— 那不是调精度，是**修一个量错对象
# 的缺陷**：底部 7%（y 0.93~1.00）在 Android 上整片是**系统导航栏**，不透明、跟**系统主题**
# 走而不跟 app 主题。app 主题判据因此在 app 与系统不一致时**静默判错**（6.3.0 真机实测：
# app 暗 + 系统亮 ⇒ 底带 227.66 / 228.01，被判成「亮」）。app 默认跟随系统时两者恒等，
# 所以这个错一直隐形 —— 只有手动把 app 与系统设成相反才暴露。
#
# 37 张**真实**截图实测（`png-luma.py probe()`，Pillow 路径；feed/fab-expanded/me/illus/
# novel/search 全部页型 × 720/1080/1440 三种屏宽 × 7 色板 × 5.2.0 与 6.3.0 两个版本）：
#     dark  10.00 .. 20.74      light  124.76 .. 249.78
# ⇒ 空档 [20.74, 124.76]。DARK_MAX=70 不动（余量 49.26）；**LIGHT_MIN 必须 140 → 100**，
#   否则那两张 FAB 展开态（scrim 把亮色减半到 124.76）会被判成「不是亮色」。
#   ⚠️ 区域与阈值是同一个决定的两半，**只改一处必然错**：顶带是 app 自己的表面色
#   ⚠️ 顶带**不是纯色**（它含状态栏图标，32 张 6.3.0 实测：亮 3.86~**11.59**（上沿 w-720x1280-light-*）/ 暗 **8.37**~18.25（下沿 w-1440x2560-dark-*）），
#   但 FAB 展开的 scrim 是全窗口 50% 黑，窗口内无一处豁免。
#
# ⚠️ **两套解码的数字对不齐，但判定一致**（沿用 `png-luma.py` 的既有不变式）：
# 抽样步长 7×11 在窄带/顶带这类小区域上混叠更厉害，标准库路径实测比 Pillow 最多差
# **5.07**（整幅口径实测 0.60、抽 2 张）。仍全部落在阈值同一侧 ⇒ 换机器没装 Pillow
# 也不会改变判定。**别把下面那组 Pillow 数字当「两条路径必须相等」来引用。**
#
# ⚠️ 早先这里写「为什么不是顶栏」并据此选底部带 —— 那条推理的**前提是错的**：
#   它说「底栏不受 scrim 影响」，这话没错；但没意识到**底栏是系统导航栏**，
#   于是用「免疫 scrim」换来了「量错对象」。**两条都不占**的区域不存在（见上）：
#   要么跟 app 主题（顶带）而被 scrim 减半，要么免疫 scrim（底带）而跟系统主题。
#   本轮选前者 + 把阈值降到能容纳减半，代价与余量都写在上面。
MODE_REGION = (0.20, 0.02, 0.80, 0.09)

# 文件名里的模式段：w-…-{light|dark}-… / p-palN-{light|dark}-… / pg-{mode}-…
# ⚠️ 屏宽轴的模式段**前面隔着尺寸**：`w-720x1280-light-feed`。原正则写成 `(?:^w-|^p-pal\d-)`
# 要求 `w-` 后面紧跟模式，于是**屏宽轴一张都匹配不上**，模式列全是 unknown
# ⇒ 明暗一致性这一列对屏宽轴形同虚设（复审 S-2）。尺寸段必须显式吃掉。
MODE_RE = re.compile(r"(?:^w-\d+x\d+-|^p-pal\d+-)(light|dark)-")
PG_MODE_RE = re.compile(r"^pg-(light|dark)-")

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def classify(stem: str) -> tuple[str, str]:
    """返回 (轴, 声称的外观模式)。模式认不出来就如实标 unknown。"""
    if stem.startswith("w-"):
        axis = "屏宽"
    elif stem.startswith("p-pal"):
        axis = "色板"
    elif stem.startswith("pg-"):
        axis = "页面"
    else:
        axis = "?"
    m = MODE_RE.search(stem) or PG_MODE_RE.search(stem)
    return axis, m.group(1) if m else "unknown"


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("用法: md3-matrix-inventory.py <截图目录>", file=sys.stderr)
        return 2
    root = pathlib.Path(argv[1])
    # ⚠️ 必须排除点开头的临时探针（.nav.png / .probe.png / .ctrl.png …）：
    # 采集脚本把中间态截图写在同一目录，它们是**过程产物**不是证据。
    # glob("*.png") 会把它们一并收进表里，让「共 N 张」虚高。
    files = sorted(p for p in root.glob("*.png") if not p.name.startswith("."))
    if not files:
        print(f"{root} 下没有 PNG", file=sys.stderr)
        return 1

    print("| 截图 | 轴 | 声称模式 | 合法非空 | 顶栏亮度 | 内容区标准差 | 模式一致 | 有内容 |")
    print("|---|---|---|---|---|---|---|---|")
    bad = 0
    for p in files:
        axis, claimed = classify(p.stem)
        # 「合法非空」这一列是 docstring 承诺过的，原实现漏了 ——
        # 承诺了不做，读者会以为「表里有」而实际没有。补上真实检查。
        raw = p.read_bytes()
        valid = "\u2705" if (p.stat().st_size > 0 and raw[:8] == PNG_MAGIC) else "\u274c"
        # 明暗判定读**顶栏**（MODE_REGION），不是整幅 —— 理由见常量处的实测。
        # ⚠️ 这里**故意解两次码**（MODE_REGION + CONTENT_REGION 各一次），不是疏忽。
        # `png-luma.py` 确有「多区域只解一次码」的现成设施（`_decode_pixels` +
        # `_stats_from_pixels`，见其自身 docstring），但那条路只覆盖**标准库**实现，
        # 走它就等于放弃 Pillow 快路径。实测代价：Pillow 2.77s / 31 张（可忽略）；
        # 标准库 fallback 约 219s / 31 张（≈3 分 40 秒）。本脚本是**离线取证工具**，
        # 一次性跑 4 分钟可接受，换来两条路径口径一致。代价写在这里而不是让它隐形。
        # ⚠️ 探针**读不了**时不能让它把整张表打断：旧实现直接 `probe()`，
        #    第一张坏图（非 PNG / 截断 / 0 字节）就抛 traceback 退出，于是输出是
        #    **半张表** —— 而「合法非空」这一列的存在意义恰恰是**报出**坏图。
        #    截断的 PNG 尤其阴险：magic 齐全 ⇒ `valid` 是 ✅，只有真正解码才暴露。
        #    ⇒ 逐张兜住，坏图照印一行、测量列留 `—`，并计入不一致。
        try:
            mean, _sd, _sat = pl.probe(str(p), MODE_REGION)
            _cmean, csd, _csat = pl.probe(str(p), CONTENT_REGION)
            unreadable = False
        except Exception as exc:  # noqa: BLE001 - 坏图必须**报出来**而不是中断整表
            mean = csd = 0.0
            unreadable = True
            print(f"  ! 探针读不了 {p.name}：{exc}", file=sys.stderr)
        if unreadable:
            mode_ok = "—"
        elif claimed == "dark":
            mode_ok = "✅" if mean < DARK_MAX else f"❌({mean:.0f})"
        elif claimed == "light":
            mode_ok = "✅" if mean > LIGHT_MIN else f"❌({mean:.0f})"
        else:
            mode_ok = "—"
        has = csd >= MIN_CONTENT_SD
        if not has or mode_ok.startswith("❌") or valid == "❌" or unreadable:
            bad += 1
        luma_txt = "—" if unreadable else f"{mean:.1f}"
        sd_txt = "—" if unreadable else f"{csd:.1f}"
        has_txt = "—" if unreadable else ("✅" if has else "❌")
        print(
            f"| `{p.name}` | {axis} | {claimed} | {valid} | {luma_txt} | {sd_txt} | {mode_ok} | {has_txt} |"
        )
    print()
    print(f"共 {len(files)} 张，不一致 {bad} 张。")
    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
