#!/usr/bin/env python3
"""PNG 平均亮度探针 —— 给截图矩阵采集做**自检**。

为什么需要它：T16 首版矩阵脚本把文件名写成 `light` 而实际拍到 `dark`
（`set_mode` 点空、坐标未随 wm size 换算）。这类失效**不报错**，
只会让判读者以为明暗两态都验过了 —— 比崩掉危险得多。

所以采集脚本每切一次外观就要验一次：探针读到亮/暗与声称的不符就中止。

**两条实现，锁的是「判定一致」而不是「数字相等」**：优先用 Pillow（快 ~50 倍），
没有则退回标准库（zlib + struct 手解，只依赖标准库，保证任何机器都能跑）。
⚠️ 双实现最危险的不是「慢」，而是**同一个脚本在两台机器上读出不同的数**，
而所有阈值（明暗分界、内容区下界、FAB 饱和度）都是照着某一版定的。
  · 数字层面**确实对不齐**：标准库按 7×11 步长抽样（整幅要跑 ~25s），
    Pillow 取全量 —— 抽样 vs 全量，数值不可能逐位相同。
    本轮（2026-09-30）实测：整幅口径抽 2 张真图（pg-light-01-feed / w-1080x2160-dark-feed）
    三维最大差 **0.60**；底部 7% 窄带口径抽 5 张最大差 **5.07**（窄带只有 ~7% 高，
    7×11 网格混叠更厉害）。**窄带的差比整幅大一个数量级** —— 这是选择口径时该记住的。
    所以「两路必须给出相同小数」这种断言是错的，别写。
    ⚠️ 早先这里写「实测最大偏差 2.40（luma 217.37 vs 219.72）」—— **复算不出来**：
       两者相减是 2.35 不是 2.40，且 217.37 全仓只有这一处、无第二来源（六轮 Standards 查出）。
       数字改为本轮可复算的实测值；旧数已作废，不要再引用。
  · 真正的不变式是**判定一致**：对每条门禁，两条路径必须落在阈值 `t` 的同一侧。
留了 `--selfcheck`：同图跑两遍，打印数字偏差**并**逐条校验门禁判定一致
（清单用 `--preset` 或 `--gates`，见下节；不给清单就拒绝自检）。

标准库路径支持 8 位 RGB / RGBA / 灰度 / 灰度+alpha（PNG color type 0/2/4/6）。
⚠️ 灰度（color type 0/4）**只有 1–2 个通道**：照 RGB 那样取 `pixels[i..i+2]`
会跨到下一个像素去 ⇒ 均值/标准差取错、饱和度恒不为 0，而且**不报错**。
所以下面按 color type 显式取值：灰度复制成三通道、**丢弃** alpha（不合成），
口径与 Pillow 的 `convert("RGB")` 逐位对齐（L→(v,v,v)、LA→(v,v,v)、RGBA→丢 A）。
（该缺陷原先是**潜伏**的：Android `screencap` 出的是 RGBA，恰好绕开了灰度分支。）

## 门禁语义（`--selfcheck` 校验的就是这四条）

`--selfcheck` 唯一要证明的不变式是「**双路径对每条真实门禁判定的落点一致**」。
所以门禁必须**带维度、带区域**地写出来，不能只给一串数字再让三维交叉组合 ——
那会产生大量「看起来很严谨、实际没有任何判据在用」的组合。
四条门禁与 `capture-md3-matrix.sh` 的常量同源（见 `GATE_PRESET` 的注释）。
"""

from __future__ import annotations

import struct
import sys
import zlib

try:  # 可选加速；缺失时静默走标准库路径（--selfcheck 已证明两者判定一致）
    from PIL import Image, ImageChops, ImageStat  # type: ignore

    _HAVE_PIL = True
except ImportError:  # pragma: no cover - 环境差异，走 stdlib 即可
    _HAVE_PIL = False


def _chunks(data: bytes):
    pos = 8
    while pos < len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        yield ctype, data[pos + 8 : pos + 8 + length]
        pos += 12 + length


def _unfilter(raw: bytes, width: int, height: int, bpp: int) -> bytearray:
    """还原 PNG 的逐行滤波（5 种 filter type）。"""
    out = bytearray()
    stride = width * bpp
    prev = bytearray(stride)
    pos = 0
    for _ in range(height):
        ftype = raw[pos]
        pos += 1
        line = bytearray(raw[pos : pos + stride])
        pos += stride
        if ftype == 1:  # Sub
            for i in range(bpp, stride):
                line[i] = (line[i] + line[i - bpp]) & 0xFF
        elif ftype == 2:  # Up
            for i in range(stride):
                line[i] = (line[i] + prev[i]) & 0xFF
        elif ftype == 3:  # Average
            for i in range(stride):
                left = line[i - bpp] if i >= bpp else 0
                line[i] = (line[i] + ((left + prev[i]) >> 1)) & 0xFF
        elif ftype == 4:  # Paeth
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


def avg_luma(
    path: str,
    region: tuple[float, float, float, float] | None = None,
) -> tuple[float, float, float]:
    """返回 (平均亮度, 亮度标准差, 平均饱和度)，前两维 0–255（ITU-R BT.601 加权）。

    `region` = (x0, y0, x1, y1)，均为 0–1 的比例；不给则整幅。

    标准差这一维是**内容门禁**的依据：一张「只有标题和 FAB、内容还没加载出来」
    的截图是合法 PNG、均值也正常（实测 236.9），但内容区几乎是纯色。
    ⚠️ **整幅标准差不够**：实测那张空白页整幅 stddev=36.98，反而高于加载完成的
    暗色 Me 页（32.25）—— 因为页面底部有一条未渲染的暗带，把方差抬起来了。
    所以必须**限定到内容区**再算，否则门禁会被这条暗带骗过去。

    饱和度这一维（`(max(R,G,B)-min(R,G,B))` 的均值）解决**另一类同形失效**：
    采集脚本曾把「app 停在登录页 / 冷启动未完成」报成「FAB 点不开」——
    因为登录页的平均亮度与亮色 Feed 几乎一样（实测 240.5 vs 240.5），
    FAB 展开判据「亮度下降」自然也不动，两者**症状完全同形**。
    亮/暗判据只看得见明度，看不见**当前是哪个页面**；FAB 底色是饱和的主题色，
    登录页那一片是近灰纯色，用饱和度一刀切开。
    """
    return _stats_from_pixels(path, *_decode_pixels(path), region)


def _decode_pixels(path: str) -> tuple[bytearray, int, int, int]:
    """解出 (像素字节, 宽, 高, 通道数)。像素按**实际**通道数平铺，不做任何扩通道。

    单独成函数是为了让 `--selfcheck` 在多区域门禁下只解一次码。
    """
    with open(path, "rb") as fh:
        data = fh.read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{path} 不是 PNG")

    width = height = 0
    bit_depth = color_type = 0
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
    # 0=灰度 2=RGB 4=灰度+alpha 6=RGBA。1（调色板）与 3（16 位）不支持。
    channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color_type)
    if channels is None:
        raise ValueError(f"未知的 color type: {color_type}")

    return _unfilter(zlib.decompress(bytes(idat)), width, height, channels), width, height, channels


def _stats_from_pixels(
    path: str,
    pixels: bytearray,
    width: int,
    height: int,
    channels: int,
    region: tuple[float, float, float, float] | None = None,
) -> tuple[float, float, float]:
    """已解出的像素 → (亮度均值, 标准差, 饱和度均值)。

    独立成函数是为了让 `--selfcheck` 只解一次码、就能在**多个区域**上跑统计
    （标准库解一张 1080×2160 约 25s，按门禁数重复解码会放大成几分钟）。
    """
    x0r, y0r, x1r, y1r = region or (0.0, 0.0, 1.0, 1.0)
    px0, px1 = int(width * x0r), int(width * x1r)
    py0, py1 = int(height * y0r), int(height * y1r)

    # 采样而非全量：屏幕截图 1080×2160，逐像素 Python 循环太慢。
    # 步长与宽高互质，避免只采到某一列/某一行。
    step_x, step_y = 7, 11
    # ⚠️ 灰度只有 1 个通道（灰度+alpha 是 2 个），按 RGB 取值会**跨像素**。
    # 这里统一成「先取出 r,g,b」再算，gray 时 r=g=b=该像素灰度。
    gray = channels < 3
    offsets = range(px0, px1, step_x)
    values: list[float] = []
    sats: list[float] = []
    for y in range(py0, py1, step_y):
        row = y * width * channels
        for x in offsets:
            i = row + x * channels
            if gray:
                # color type 0 = (gray)，4 = (gray, alpha)；两者的 alpha 都在 i+1，一律丢弃。
                v = pixels[i]
                r = g = b = v
            else:
                # color type 2 = (R,G,B)，6 = (R,G,B,alpha)；alpha 在 i+3，不参与统计。
                r, g, b = pixels[i], pixels[i + 1], pixels[i + 2]
            values.append(0.299 * r + 0.587 * g + 0.114 * b)
            hi, lo = max(r, g, b), min(r, g, b)
            sats.append(hi - lo)
    if not values:
        raise ValueError(f"{path} 指定区域采样点为 0（{width}×{height}，region={region}）")
    mean = sum(values) / len(values)
    var = sum((v - mean) ** 2 for v in values) / len(values)
    return mean, var**0.5, sum(sats) / len(sats)


def avg_luma_pil(
    path: str,
    region: tuple[float, float, float, float] | None = None,
) -> tuple[float, float, float]:
    """Pillow 路径，统计口径与 `avg_luma` 对齐，只快在「不做逐像素 Python 循环」。

    · 亮度均值/标准差：整段 `convert("L")` 交给 C 实现的 `ImageStat`。
      ⚠️ PIL 的 L 是**按 ITU-R BT.601 加权后取整**的（`round(0.299R+0.587G+0.114B)`），
      而 stdlib 路径留浮点不取整 ⇒ 两者存在 ≤0.5 的系统性偏差。
      这个偏差**小于所有阈值的余量**（最窄的一处是饱和度：负样本 7.00 / 正样本下沿 25.02，
      阈值 20 距正样本仅 5.02 —— 全套门禁里余量最窄的一处；
      ⚠️ 早先这里写「7.00 vs 32.79」，32.79 来自只扫了 26 张的旧样本，已作废 SPEC-B3），
      实测偏差见 `--selfcheck` 的输出，**不是**「实测 0.00」这种想当然的宣称。
    · 饱和度：`ImageChops.lighter/darker` 求逐像素 max/min，再 `subtract`，
      全程 C 实现；若走 Python 循环，1080×2160 实测要 ~25s。
    """
    x0r, y0r, x1r, y1r = region or (0.0, 0.0, 1.0, 1.0)
    # ⚠️ 只对「**这张文件根本不是图片**」这一类失败，两路才给**逐字相同**的一句话。
    #    `Image.open` 对非图片抛的是 UnidentifiedImageError（"cannot identify image file"），
    #    标准库路径给的是「<path> 不是 PNG」—— 装了 Pillow 与没装的机器文案不同，
    #    下游按整句 grep 的消费者会静默失配。
    #
    # ⚠️⚠️ **只收窄到 UnidentifiedImageError，绝不用 except Exception**（六轮 Spec 阻塞项）：
    #    宽 catch 会把「文件不存在 / 是目录 / 无权限」一律误诊成「不是 PNG」——
    #    实测 `png-luma.py /tmp/does-not-exist.png` 报「不是 PNG」，而标准库路给的是
    #    FileNotFoundError。这类**误诊**正是本脚本 :174-178 记的那个老病：
    #    「0 字节 / 截图读不出来」被报成「页面上找不到控件」，把人引去查错方向。
    #    I/O 错误必须原样冒出去。
    # ⚠️ **截断 PNG 不在统一范围内**：`Image.open` 对它**成功**（magic 完整），失败发生在
    #    之后的 convert/crop，两路消息本就不同（Pillow「image file is truncated」
    #    vs 标准库「zlib Error -5」）。**别声称「两路对所有失败都相同」。**
    #    异常类型没丢：挂在 `__cause__` 上，traceback 仍能看到。
    try:
        im = Image.open(path)  # type: ignore[union-attr]
    except Image.UnidentifiedImageError as exc:  # noqa: B014 - 刻意只收这一类
        raise ValueError(f"{path} 不是 PNG") from exc
    with im:
        rgb = im.convert("RGB")
        w, h = rgb.size
        box = (int(w * x0r), int(h * y0r), int(w * x1r), int(h * y1r))
        if box[2] <= box[0] or box[3] <= box[1]:
            raise ValueError(f"{path} 指定区域采样点为 0（{w}×{h}，region={region}）")
        crop = rgb.crop(box)
    st = ImageStat.Stat(crop.convert("L"))  # type: ignore[union-attr]
    r, g, b = crop.split()
    sat_img = ImageChops.subtract(  # type: ignore[union-attr]
        ImageChops.lighter(ImageChops.lighter(r, g), b),  # type: ignore[union-attr]
        ImageChops.darker(ImageChops.darker(r, g), b),  # type: ignore[union-attr]
    )
    sat_mean = ImageStat.Stat(sat_img).mean[0]  # type: ignore[union-attr]
    return st.mean[0], st.stddev[0], sat_mean


def probe(
    path: str,
    region: tuple[float, float, float, float] | None = None,
    force_stdlib: bool = False,
) -> tuple[float, float, float]:
    """统一入口：有 Pillow 走快路径，否则走标准库。两条路径口径已由 --selfcheck 对齐。"""
    if _HAVE_PIL and not force_stdlib:
        return avg_luma_pil(path, region)
    return avg_luma(path, region)


# ── 门禁清单 ────────────────────────────────────────────────────────────────
# 一条门禁 = (维度, 阈值, 区域)。三个字段缺一不可：
#   · 维度 —— 采集脚本分别读 3 列（亮度/标准差/饱和度），把 70 套到标准差上毫无意义；
#   · 阈值 —— 抄自采集脚本的常量；
#   · 区域 —— 同一条 sd/sat 门禁在不同区域上量的东西完全不同（整幅 vs 内容区 vs FAB 区）。
GATE_DIMS = {"mean": 0, "luma": 0, "1": 0, "sd": 1, "stddev": 1, "2": 1, "sat": 2, "3": 2}
GATE_DIM_NAMES = ("亮度均值", "标准差", "饱和度")

# 内置的**四条门禁**，与 capture-md3-matrix.sh 的常量同源。
# ⚠️ 别再称它们「采集脚本**真实在用**」—— shell 侧 `probe_mode()` 判的是**「我的」页**
#    （`set_mode` 里那记 `back` 不离开页面）且仍用**整幅**（刻意的，理由见
#    `tests/captureScriptInvariants.test.ts` 文件头「两个明暗消费点」），
#    ⇒ 4 条里有 2 条（mean）**不再**逐字描述 shell 在线那一路的口径。
#    `--selfcheck --preset` 因此验不到 `probe_mode`；它验的是**内容页**那条离线判据。
# ⚠️ **同源 ≠ 独立**：`GATE_PRESET` 是采集脚本常量的**副本**，不是它的独立事实源。
#    谁把谁抄进谁的，注释里写清楚；别拿「同源」当「两处独立互证」用
#    （断言 A==B 而 B 是 A 的抄本 = 同义反复）。真正的独立依据是阈值本身的实测余量。
#
#   mean: 70 / 100  ← DARK_MAX / LIGHT_MIN。区域是**顶栏中段**，不是整幅、也不是底部：
#     整幅被作品图主导，31 张实测整幅 dark 上沿 115.22 / light 下沿 137.43 ⇒ 8 张暗色 +
#     1 张亮色越过阈值（「9 条假警报」）。
#   ⚠️⚠️⚠️ 第三十二轮把区域从「底部 7%」改成「顶栏中段」，**并**把 LIGHT_MIN 140 → 100。
#     两处是**同一个决定的两半，只改一处必然错**：
#     (a) 区域：底部那一段在 Android 上整片是**系统导航栏**，不透明、跟**系统主题**走；
#         app 主题判据因此在 app 与系统不一致时**静默判错**。逐像素实测
#         （emulator-5554 / 6.3.0 / 720×1280）：底带 (22,24,26) 随系统暗 /
#         (232,232,232) 随系统亮；顶带 (16,20,24) 随 app 暗 / (248,250,255) 随 app 亮。
#         2×2（括号内 = 系统暗 / 系统亮）：顶带 19.00/19.00（暗）、250.00/250.00（亮）；
#         底带 app 暗时 31.20 / **227.66** ⇒ 暗色被判成「亮」。
#         ⚠️ 顶带**不是纯色**：它含状态栏图标，32 张 6.3.0 实测 sd 亮 3.86~**11.59**（上沿 w-720x1280-light-*）/ 暗 **8.37**~18.25（下沿 w-1440x2560-dark-*）。
#     (b) 阈值：顶带在 **FAB 展开态**被**全窗口均匀 50% 黑** scrim 减半（实测比值处处
#         0.50，app 窗口内无豁免；唯一豁免的 y≥1136 那 4px 紧贴系统导航栏，跨分辨率会漂
#         回去，**不可用**）⇒ 亮色最低落到 **124.76**。空档实测 [20.74, 124.76]，
#         原 LIGHT_MIN=140 **高于**上沿 15.24，必然误判那两张；降到 100（余量 24.76）。
#     依据是 **37 张真实截图**（feed/fab-expanded/me/illus/novel/search × 720/1080/1440
#     三种屏宽 × 7 色板 × 5.2.0 与 6.3.0），不是合成 fixture。DARK_MAX 保持 70 不动
#     （暗侧 17 张已有防线，距上沿 49.26，冒险改它没有收益）。
#     ⚠️ 上移带（.85-.93）**不是解**：Feed 上干净（20.16/32.39），但「我的」页暗色落在
#     85.63/95.93，**掉进死区**。详见 capture-md3-matrix.sh 的 MODE_BAND 注释。
#     ⚠️ 早先这里写 `full` 且注释「luma() 整屏，实测真暗 27.3 / 真亮 202.5」——
#     那是**被 §8.6 证伪的口径**，留着会让下一个人照着退回整幅。
#   sd:   20        ← MIN_CONTENT_SD=20（content_sd()，空白页 12.91 / 正样本下沿 **20.88**）
#     ⚠️ 早先写「有内容 ≥32.46」只在屏宽轴那 12 张上成立，扩到 31 张后失效（S-4）。
#   sat:  10        ← MIN_FAB_SAT=10。**第二十六轮按 6.3.0 重标定**：6.3.0 换了 MD3 淡蓝
#     FAB，登录态实测 **14.16**（n=4，**方差 0**）⇒ 原值 20 会把**合法登录态**判成
#     「会话失效」。登录页 6.11 ⇒ 阈值 10 两侧裕量 4.16 / 3.89。
#     （旧值 20 的依据是 5.2.0：登录页 7.00 / 正样本 25.02~66.93，**已不适用于 6.3.0**。）
#     ⚠️ 早先写「Feed 32.79~68.51」同上，样本集不一致（SPEC-B3）。
# ⚠️ 这四条以外的组合**没有任何判据在用**（例如「饱和度 vs 70」永远不会是门禁），
# 校验它们只会制造「12 组全绿」的假证据，所以不再默认交叉组合。
GATE_PRESET = (
    "mean:70:0.20,0.02,0.80,0.09;mean:100:0.20,0.02,0.80,0.09;"
    "sd:20:0.05,0.10,0.95,0.78;sat:10:0.80,0.84,0.96,0.94"
)


class GateSpecError(ValueError):
    """门禁清单本身写错了 —— 属于「判据不存在」，必须报错停下而不是降级。"""


def _parse_region(text: str) -> tuple[float, float, float, float]:
    parts = [p.strip() for p in text.split(",")]
    if len(parts) != 4:
        raise GateSpecError(f"区域要 4 个比例值 x0,y0,x1,y1，实际 {text!r}")
    try:
        return (float(parts[0]), float(parts[1]), float(parts[2]), float(parts[3]))
    except ValueError as exc:
        raise GateSpecError(f"区域含非数字：{text!r}（{exc}）") from exc


def _parse_gates(spec: str) -> list[tuple[int, str, float, tuple[float, float, float, float] | None]]:
    """解析 `维:阈值:区域`，多项用 `;` 分隔。区域写 `full` 表示整幅。

    ⚠️ 任何写错的地方都抛异常：门禁清单是**判据的来源**，
    解析失败却继续跑 = 又一次「没检查却报通过」。
    """
    gates: list[tuple[int, str, float, tuple[float, float, float, float] | None]] = []
    for item in spec.split(";"):
        item = item.strip()
        if not item:
            continue
        parts = item.split(":")
        if len(parts) != 3:
            raise GateSpecError(
                f"门禁要 3 段 维:阈值:区域，实际 {item!r}（{len(parts)} 段）"
            )
        name, thr, reg = parts[0].strip().lower(), parts[1].strip(), parts[2].strip()
        if name not in GATE_DIMS:
            raise GateSpecError(
                f"未知维度 {name!r}，可用：{', '.join(sorted(GATE_DIMS))}（中文名不支持）"
            )
        try:
            threshold = float(thr)
        except ValueError as exc:
            raise GateSpecError(f"阈值不是数字：{item!r}（{exc}）") from exc
        region = None if reg.lower() == "full" else _parse_region(reg)
        gates.append((GATE_DIMS[name], name, threshold, region))
    if not gates:
        raise GateSpecError("门禁清单为空")
    return gates


def _usage() -> None:
    print(
        "用法: png-luma.py [--region x0,y0,x1,y1] <file.png>...\n"
        "      png-luma.py --selfcheck --preset <file.png>...",
        file=sys.stderr,
    )
    print("  输出（首行，机器可解析）：平均亮度 亮度标准差 平均饱和度  路径", file=sys.stderr)
    print("  --region=x0,y0,x1,y1：0–1 比例，限定首行统计的范围", file=sys.stderr)
    print("  --selfcheck：双路径（Pillow vs 标准库）判定一致校验，**必须**配门禁清单", file=sys.stderr)
    print("  --preset：用内置的四条真实门禁（与 capture-md3-matrix.sh 同源）", file=sys.stderr)
    print(f"    等价于 --gates='{GATE_PRESET}'", file=sys.stderr)
    print("  --gates=维:阈值:区域[;...]：自定义门禁。维 = mean/sd/sat，区域 = full 或 x0,y0,x1,y1", file=sys.stderr)
    print(f"  当前实现：{'Pillow 快路径' if _HAVE_PIL else '标准库路径（Pillow 不可用）'}", file=sys.stderr)
    print("  ⚠️ 判据全在 stderr；stdout 只有统计首行，供 awk '$1'/'$2'/'$3' 取值", file=sys.stderr)


def main(argv: list[str]) -> int:
    files: list[str] = []
    region: tuple[float, float, float, float] | None = None
    selfcheck = False
    preset = False
    gates_spec: str | None = None
    # ⚠️ 参数必须**逐个认领**：旧实现是 `[a for a in argv[1:] if not a.startswith("--")]`
    # 静默吞掉一切 `--` 开关，于是打错的开关名等于没开 —— 同一类 fail-open。
    for a in argv[1:]:
        if a in ("-h", "--help"):
            _usage()
            return 0
        if a == "--selfcheck":
            selfcheck = True
        elif a == "--preset":
            preset = True
        elif a.startswith("--region"):
            try:
                region = _parse_region(a.split("=", 1)[1] if "=" in a else "")
            except (GateSpecError, IndexError) as exc:
                print(f"  FAIL  --region 写法错误：{exc}", file=sys.stderr)
                return 2
        elif a.startswith("--gates="):
            gates_spec = a.split("=", 1)[1]
        elif a.startswith("--thresholds"):
            print(
                "  FAIL  --thresholds 已废弃：只给数字会被套到三个维度上交叉组合，\n"
                "        其中绝大多数不对应任何真实门禁（= 假证据）。\n"
                f"        改用 --gates='维:阈值:区域'，或 --preset（= --gates='{GATE_PRESET}'）。",
                file=sys.stderr,
            )
            return 2
        elif a.startswith("-"):
            print(f"  FAIL  未知开关 {a}（不认领的开关等于没开，拒绝静默忽略）", file=sys.stderr)
            _usage()
            return 2
        else:
            files.append(a)

    if not files:
        _usage()
        return 2

    # ── 门禁清单：没有它就没有「判定一致」可验 ──
    # ⚠️ 这一段是本脚本唯一的 fail-closed 闸门。旧行为是「没给阈值也打印
    # 「阈值判定不一致 0 处」并 exit 0」—— 没检查却报通过，正是本脚本要治的病。
    if preset and gates_spec:
        print("  FAIL  --preset 与 --gates 只能给一个（别猜哪条会生效）", file=sys.stderr)
        return 2
    if preset and not selfcheck:
        print("  FAIL  --preset 只是门禁清单，必须与 --selfcheck 同用", file=sys.stderr)
        return 2
    if selfcheck and not (preset or gates_spec):
        print(
            "  FAIL  --selfcheck 缺门禁清单 ⇒ 无法校验判定一致，**不执行自检**。\n"
            "        原因：只比数字偏差 ≠ 验过门禁；旧实现正是此处打印「不一致 0 处」并 exit 0。\n"
            f"        用 --preset（= --gates='{GATE_PRESET}'）或 --gates='维:阈值:区域[;...]'。",
            file=sys.stderr,
        )
        return 2
    gates: list[tuple[int, str, float, tuple[float, float, float, float] | None]] = []
    if selfcheck:
        try:
            gates = _parse_gates(GATE_PRESET if preset else (gates_spec or ""))
        except GateSpecError as exc:
            print(f"  FAIL  门禁清单无法解析：{exc}", file=sys.stderr)
            return 2
        if not _HAVE_PIL:
            print("  FAIL  无 Pillow，无法自检（双路径校验需要两条实现）", file=sys.stderr)
            return 1

    worst = 0.0
    disagree = 0
    checked = 0
    for path in files:
        try:
            mean, sd, sat = probe(path, region)
            # 首行保持「亮度 标准差 饱和度 路径」四列 —— capture-md3-matrix.sh 的
            # luma()/content_sd()/ensure_session() 直接 awk '$1'/'$2'/'$3' 取值。
            print(f"{mean:6.2f} {sd:7.2f} {sat:6.2f}  {path}")
            if selfcheck:
                print(f"  [自检] {path}：校验 {len(gates)} 条门禁（{', '.join(g[1] for g in gates)}）", file=sys.stderr)
                # 标准库只解一次码，区域不同的门禁复用同一份像素（解一张约 25s）。
                px = _decode_pixels(path)
                for dim, name, thr, gregion in gates:
                    pa = avg_luma_pil(path, gregion)
                    pb = _stats_from_pixels(path, *px, gregion)
                    d = tuple(abs(x - y) for x, y in zip(pa, pb))
                    worst = max(worst, *d)
                    checked += 1
                    where = "full" if gregion is None else ",".join(f"{v:g}" for v in gregion)
                    print(
                        f"        {name:<4} 阈值 {thr:<6g} 区域 {where:<22}"
                        f"PIL={pa[dim]:8.2f} stdlib={pb[dim]:8.2f} Δ={d[dim]:.2f}",
                        file=sys.stderr,
                    )
                    # 判定一致才是真不变式：数字差（实测整幅 0.60、窄带 5.07）无所谓，跨过阈值就致命。
                    side_a = (pa[dim] >= thr) - (pa[dim] < thr)
                    side_b = (pb[dim] >= thr) - (pb[dim] < thr)
                    if side_a != side_b:
                        disagree += 1
                        print(
                            f"  FAIL  门禁「{name} vs {thr:g}」判定不一致："
                            f"PIL={pa[dim]:.2f} vs stdlib={pb[dim]:.2f}",
                            file=sys.stderr,
                        )
        except Exception as exc:  # noqa: BLE001 - 探针自身失败必须显式暴露，禁静默
            print(f"  FAIL  {path}: {exc}", file=sys.stderr)
            return 1
    if selfcheck:
        # 走到这里 checked 必然 > 0（缺门禁已在入口 exit 2），仍显式兜底，
        # 免得将来有人改了入口条件就又变回「0 条门禁 = 全绿」。
        if checked == 0:
            print("  FAIL  门禁清单解析出 0 条 ⇒ 没检查任何东西，拒绝报通过", file=sys.stderr)
            return 1
        print(
            f"  门禁 {checked} 条，判定不一致 {disagree} 处；双路径最大数字偏差 {worst:.4f}",
            file=sys.stderr,
        )
        if disagree:
            return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
