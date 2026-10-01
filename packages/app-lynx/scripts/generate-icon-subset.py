"""生成 Material Symbols Outlined 子集字体（离线，产物提交进仓库）。

用法：python3 scripts/generate-icon-subset.py

输入：src/utils/iconMap.ts 解析出的 name→codepoint（唯一事实源）
源字体：Google Material Symbols Outlined 可变字体（构建期外下载到 /tmp，不入库）
产物：src/assets/fonts/material-symbols-outlined-subset.ttf

字体实例化：FILL=0（Outlined 变体，ADR-0208 决策 1）、GRAD=0、opsz=24、wght=400
—— Lynx 的 @font-face 不支持 font-style/font-weight/font-variant（见 Lynx 文档
/api/css/at-rule/font-face.md「Difference from W3C」），可变轴必须在构建期外定死。
"""
from __future__ import annotations

import base64
import re
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ICON_MAP = ROOT / "src" / "utils" / "iconMap.ts"
OUT_TTF = ROOT / "src" / "assets" / "fonts" / "material-symbols-outlined-subset.ttf"
OUT_CSS = ROOT / "src" / "styles" / "icon-font.css"
SRC_TTF_URL = (
    "https://raw.githubusercontent.com/google/material-design-icons/master/"
    "variablefont/MaterialSymbolsOutlined%5BFILL%2CGRAD%2Copsz%2Cwght%5D.ttf"
)

# 从 iconMap.ts 抽 ICON_CODEPOINTS 字面量块（单一事实源，不在本脚本另抄一份）
ENTRY_RE = re.compile(r"^\s{2}([a-z0-9_]+):\s*0x([0-9a-fA-F]+),\s*(?://.*)?$", re.M)
BLOCK_RE = re.compile(r"ICON_CODEPOINTS[^=]*=\s*\{(.*?)\n\}", re.S)


def read_codepoints() -> dict:
    src = ICON_MAP.read_text(encoding="utf-8")
    block = BLOCK_RE.search(src)
    if block is None:
        sys.exit("iconMap.ts 未找到 ICON_CODEPOINTS 块")
    out = {}
    for name, hexv in ENTRY_RE.findall(block.group(1)):
        cp = int(hexv, 16)
        if cp in out.values():
            sys.exit(f"码点冲突 0x{cp:04x}（{name} 与其他 name 重复）")
        out[name] = cp
    if not out:
        sys.exit("ICON_CODEPOINTS 解析为空")
    return out


def read_declared_family() -> str:
    """从 iconMap.ts 读出 ICON_FONT_FAMILY —— 字体族名的唯一事实源。
    生成器不另抄一份：抄了就会漂，而漂了的表现是「全站豆腐块」而非任何报错。"""
    src = ICON_MAP.read_text(encoding="utf-8")
    m = re.search(r"ICON_FONT_FAMILY\s*=\s*'([^']+)'", src)
    if m is None:
        sys.exit("iconMap.ts 未找到 ICON_FONT_FAMILY 声明")
    return m.group(1)


def rename_family(ttf_path: Path, family: str | None = None) -> None:
    """把子集字体的族名改写为 ICON_FONT_FAMILY（@font-face 的匹配键）。

    没有这一步，产物会带着源字体的族名（或干脆没有族名），@font-face 一条都匹配不上，
    私用区码点便回退到默认字体渲染成豆腐块 —— **静默、无报错、无崩溃**。
    """
    from fontTools.ttLib import TTFont

    family = family or read_declared_family()
    # ⚠️ recalcTimestamp=False 是**可复现性的关键**：fontTools 默认在 save() 时把
    # 当前时间写进 head.modified，于是「重跑生成脚本」产出的字节每次都不同
    # （实测两次仅差 6 字节，全部在 head 表及其目录校验和）。后果是
    # 「产物离线生成、提交进仓库」名不副实：任何人重跑都会得到一个 diff，
    # 任何「重跑应无 diff」的可复现性检查都会红。源字体是固定发布物、时间戳稳定，
    # 关掉重算即可让产物只由「源字体 + ICON_CODEPOINTS」决定。
    f = TTFont(ttf_path, recalcTimestamp=False)
    # ⚠️ recalcTimestamp=False 只保证「save() 不再刷新时间」，**不能**保证产物确定：
    # `fontTools.subset` 那一步已经把当次运行的挂钟时间写进了 head.modified，
    # 保留 ≠ 固定。实测两次重跑仅差 4 字节（head.modified 及其派生的校验和）。
    # 这里显式把 modified 对齐到源字体的 created（固定发布物里的常量），
    # 让产物只由「源字体字节 + ICON_CODEPOINTS」决定，与运行时刻无关。
    head = f["head"]
    head.modified = head.created
    name_tbl = f["name"]
    # 只留 Windows(3,1) 与 Mac(1,0) 两套平台的记录，其余平台的残留会让某些
    # 平台匹配到「另一个名字」，行为不一致。
    for rec in list(name_tbl.names):
        if rec.nameID in (1, 2, 4, 6) and (rec.platformID, rec.platEncID) not in (
            (3, 1),
            (1, 0),
        ):
            name_tbl.removeNames(rec.nameID, rec.platformID, rec.platEncID)
    for pid, eid, lid in ((3, 1, 0x409), (1, 0, 0)):
        name_tbl.setName(family, 1, pid, eid, lid)  # family
        name_tbl.setName("Regular", 2, pid, eid, lid)  # subfamily
        name_tbl.setName(f"{family} Regular", 4, pid, eid, lid)  # full name
        name_tbl.setName(family.replace(" ", ""), 6, pid, eid, lid)  # postscript
    f.save(ttf_path)

    # 立刻回读校验：写完不验等于没写（这次缺陷的教训正是「只写不验」）。
    check = TTFont(ttf_path, recalcTimestamp=False)
    got = {
        r.toUnicode()
        for r in check["name"].names
        if r.nameID == 1 and (r.platformID, r.platEncID) in ((3, 1), (1, 0))
    }
    if got != {family}:
        sys.exit(
            f"❌ 族名回读失败：期望 {{{family!r}}}，实际 {got or '（空 —— 字体没有 nameID 1）'}\n"
            "   没有族名的字体永远匹配不上 @font-face ⇒ 全站图标豆腐块 ⊠。"
        )
    print(f"族名已写入并回读校验通过：{family!r}")


def write_base64_css(css_path: Path, ttf_path: Path, family: str | None = None) -> None:
    """把子集字体以 **base64 data URI** 形式写成一条 @font-face。

    为什么必须内联而不是 `url('./xxx.ttf')`——这是真机抓到的缺陷，不是风格选择：
    Lynx 官方 @font-face 文档（lynxjs.org/4.0/api/css/at-rule/font-face）写明
      「Use url() function for **remote fonts and Base64-encoded fonts**.
        Use local() function for local fonts. On Android: local(file://absolute/path).」
    即 `url()` 只吃 http(s) 远程地址或 base64，**不吃打包器本地的相对资源路径**。
    打包器会把 `url('./x.ttf')` 改写成 `url('webpack:///static/x.<hash>.ttf')`，
    Lynx 原生引擎解析不了这个 scheme ⇒ 字体静默不加载 ⇒ 私用区码点回退默认字体
    ⇒ **全站图标渲染成豆腐块 ⊠**（无报错、无崩溃、cmap 与族名断言全绿）。

    体积代价：TTF 4.5KB → base64 约 6.1KB，换全站图标可用，值得。
    """
    family = family or read_declared_family()
    b64 = base64.b64encode(ttf_path.read_bytes()).decode("ascii")
    css_path.parent.mkdir(parents=True, exist_ok=True)
    css_path.write_text(
        "/* 本文件由 scripts/generate-icon-subset.py 生成，**不要手改**。\n"
        " * 重新生成：python3 scripts/generate-icon-subset.py\n"
        " *\n"
        " * 为什么是 base64 而不是 url('./xxx.ttf')：见本函数 docstring ——\n"
        " * Lynx 的 @font-face url() 只支持远程地址与 base64，打包器改写出的\n"
        " * webpack:/// 路径在原生端不解析，结果是全站图标豆腐块 ⊠ 且全绿。\n"
        " */\n"
        "@font-face {\n"
        f"  font-family: '{family}';\n"
        f"  src: url('data:font/ttf;base64,{b64}') format('truetype');\n"
        "}\n",
        encoding="utf-8",
    )
    print(f"base64 @font-face 已写出：{css_path.relative_to(ROOT)}  {css_path.stat().st_size}B")


def main() -> int:
    codepoints = read_codepoints()
    print(f"映射表条目：{len(codepoints)}")

    with tempfile.TemporaryDirectory() as tmp:
        src_ttf = Path(tmp) / "MSOutlined-VF.ttf"
        if not src_ttf.exists():
            print("下载源字体 …")
            subprocess.run(
                ["curl", "-sSL", "--max-time", "300", "-o", str(src_ttf), SRC_TTF_URL], check=True
            )

        inst = Path(tmp) / "inst.ttf"
        # 固定可变轴：Outlined(FILL=0) / GRAD=0 / opsz=24 / wght=400
        subprocess.run(
            [
                sys.executable, "-m", "fontTools.varLib.instancer",
                str(src_ttf), "FILL=0", "GRAD=0", "opsz=24", "wght=400",
                "-o", str(inst),
            ],
            check=True,
        )

        unicodes = ",".join(f"U+{cp:04X}" for cp in sorted(codepoints.values()))
        OUT_TTF.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            [
                sys.executable, "-m", "fontTools.subset", str(inst),
                f"--unicodes={unicodes}",
                "--layout-features=", "--no-hinting", "--desubroutinize",
                # ⚠️ name-IDs 必须**显式列出**。传空（`--name-IDs=`）会把族名一并丢掉，
                # 产出一款「没有 nameID 1」的字体——而 @font-face 正是靠族名匹配的：
                # 匹配不上 ⇒ 回退默认字体 ⇒ 私用区码点无字形 ⇒ 全站图标渲染成豆腐块 ⊠。
                # 该缺陷曾真实发生（子代理只验了「字体进了 APK」+「bundle 里有族名字符串」，
                # 没验字体自己声明了什么族名），故此处显式保留并随后强制改名。
                "--name-IDs=1,2,3,4,6",
                "--drop-tables+=DSIG",
                f"--output-file={OUT_TTF}",
            ],
            check=True,
        )
        rename_family(OUT_TTF)
        write_base64_css(OUT_CSS, OUT_TTF)

    size = OUT_TTF.stat().st_size
    print(f"产物：{OUT_TTF.relative_to(ROOT)}  {size}B ({size / 1024:.1f} KiB)")
    if size > 60 * 1024:
        print(f"❌ 超过 60 KiB 上限（{size}B）——字集选多了，砍", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
