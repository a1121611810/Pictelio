/**
 * `lynx-flow-check.sh` 收藏步的判据单测（#709）。
 *
 * ## 为什么要有这个文件
 *
 * 那个脚本在真机上手动跑，仓内没有任何自动化防线；它上一版的收藏判据
 * （红像素定位 + 红像素增量确认）在新配色下**恒失效**，却因为不阻断而长期
 * 没人发现——这正是 #709 记的「误导性告警」。这里用**合成 PNG** 把它驱动起来：
 * 设备级脚本第一次进了随 CI 跑的门禁。
 *
 * ## oracle 溯源
 *
 * · 令牌表由被测脚本自己从 `packages/app-lynx/src/styles/tokens.css` 解析，
 *   本测试**不复制**色值；下面断言的 `#3b6470` / `#2e3136` 是 2026-09-21 原生 Lynx
 *   模拟器实测值，出处分两处（早先这里把两者都说成「spec §残余风险 · 2026-09-29」，
 *   三处都错，已订正）：
 *   - `#3b6470`（已收藏 = `--md-tertiary`）→ `docs/specs/bookmark-color.md:52`，
 *     位于该 spec 的 `## Verification（2026-09-21）` 一节，**不是** `## 残余风险`；
 *   - `#2e3136`（未收藏 = `--md-inverse-surface`）→ spec 全篇**没有**这个值，
 *     真出处是 `docs/verification/app-lynx-recommended-novel-bookmark-emulator-2026-09-21.md:14`
 *     （截图定点取色 (46,49,54)）。
 * · 窗口内占比 0.308（= 37/120）由 `docs/specs/bookmark-color.md:66` 登记。
 * · 「红色插画会骗过旧定位器」这条用合成帧直接复现：把大片红色像素放进
 *   画面，旧判据会选中最红的那块（作品图），新判据选 chip 实色。
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const ANALYZER = resolve(here, "../../../app-lynx/scripts/lynx-screen-analyze.py");
const TOKENS_CSS = resolve(here, "../../../app-lynx/src/styles/tokens.css");
const FLOW_SCRIPT = resolve(here, "../../../app-lynx/scripts/lynx-flow-check.sh");

// 帧取 180×320 而不是真机尺寸：分析器是**纯 Python** 解 PNG 并逐像素扫，
// 代价与像素数成正比。720×1280 的帧会让「14 组合逐个代入」那条用例跑 20s+，
// 在默认 5s 超时下直接判红（实测：`pnpm test:all` 下就是这条红的）。
//
// ⚠️ 缩帧**不等价于**保真，差在两处**固定像素**量（早先这里写着「各判据的比例量按
// 构造不变」，是错的，已订正）：采样窗 39×45 与粗扫步长 2px 都不随帧缩放，
// 于是它们相对屏幕被放大了约 4 倍——窗**跨度** 44 行占屏高 13.75%（45 行则 14.06%，
// 同一句里两个口径，已统一用跨度 44），真机 44/1280 = 3.4%；步长 2px 占屏宽
// 1.1%（2/180）vs 真机 0.28%（2/720）。
// 因此本文件的 share 是**夹具专属数值**，只用来钉住窗口几何，不与设备实测对齐；
// 它对「分母用错」那类缺陷的判别力是真的（变异验证记录在 commit `cd6eaede` 的
// message：「换回 HEAD 分析器 + 新夹具 → 4 条红」）——仓内不留图片产物，别指望能重跑。
const W = 180;
const H = 320;

type Rgb = [number, number, number];
type PixelFn = (x: number, y: number) => Rgb;

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** 极小 PNG 编码器（8 位 RGBA，无滤波）——只为造合成帧，不追求压缩率 */
function encodePng(pixels: PixelFn, w = W, h = H): Buffer {
  const raw = Buffer.alloc(h * (1 + w * 4));
  let o = 0;
  for (let y = 0; y < h; y++) {
    raw[o++] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixels(x, y);
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const TMP = mkdtempSync(join(tmpdir(), "flow-chip-"));
let tmpSeq = 0;

function analyzeChip(png: Buffer): Record<string, unknown> {
  // 分析器只认文件路径（load_png 走 open），故先落临时文件
  const file = join(TMP, `frame-${tmpSeq++}.png`);
  writeFileSync(file, png);
  const r = spawnSync("python3", [ANALYZER, file, "bookmark-chip", TOKENS_CSS], {
    maxBuffer: 64 * 1024 * 1024,
    encoding: "buffer",
  });
  if (r.status !== 0)
    throw new Error(`analyzer 退出码 ${String(r.status)}: ${r.stderr.toString()}`);
  return JSON.parse(r.stdout.toString()) as Record<string, unknown>;
}

/**
 * 画面：深色底 + 一块红色插画（模拟推荐流）+ 一颗 chip 胶囊。
 *
 * ## chip 比例：宽有出处，高是构造值
 *
 * spec `docs/specs/bookmark-color.md` 的 2026-09-21 web-core 实测**只量了宽度**：
 * 150px（1280 视口）/ 93.9px（400 视口）—— 即屏宽的 **11.7%**、行宽的 **13.4%**。
 * **全篇没有任何高度测量**（`:51` 的「该行 chip 恰为最高元素」讲的是垂直居中，不是高度）。
 * 故本夹具：
 * - `chipWidthFrac = 0.13` ← 贴 spec 的行宽口径 13.4%（宽度有出处）
 * - `chipHeightFrac = 0.044` ← **构造值，无实测出处**。选它只有一个理由：让固定
 *   45px 采样窗相对 chip 约高 3 倍，窗口内占比因而落在阈值 0.15 附近——夹具小到
 *   「占比」这个量才有判别意义。**别把这个数当设备实测。**
 *
 * 本夹具早先还把 chip 画成占屏高 30%、宽 45% 的巨物，于是**结构上不可能**暴露判据的
 * 分母错配（分母是整屏下半部网格时，巨物也能过阈），而 10 条用例全绿。
 * 夹具比被测代码更假，是最隐蔽的一类假绿。
 *
 * ## 标签带
 *
 * chip 内部留一条**非 chip 色**的标签带，让 share 不恒为 1.0（否则阈值成了摆设）。
 * 注意它**复现不了**设备实测的 0.308：本帧 chip 高 14px、采样窗高 45px，窗比 chip 高
 * 3 倍，命中量由几何决定（见下方用例的逐项推导）。
 *
 * `chipHeightFrac` 用于**故意做小**来验证占比下限真的起作用（`chipWidthFrac` 同理，
 * 但当前无用例传它，见下方已知失效面登记）。
 */
function frame(
  chip: Rgb,
  opts: { redArt?: boolean; chipHeightFrac?: number; chipWidthFrac?: number } = {},
): Buffer {
  const chipH = H * (opts.chipHeightFrac ?? 0.044);
  const chipW = W * (opts.chipWidthFrac ?? 0.13);
  const labelH = Math.max(2, Math.round(chipH * 0.2));
  return encodePng((x, y) => {
    // chip 画在画面下半部左侧（推荐流收藏胶囊的位置）
    if (y > H * 0.7 && y < H * 0.7 + chipH && x < chipW) {
      // 中间一条标签带：非 chip 色 ⇒ 窗口内占比 < 1（阈值 0.15 才有判别意义）
      const inChip = y > H * 0.7 && y < H * 0.7 + chipH;
      if (inChip && y - H * 0.7 > chipH * 0.4 && y - H * 0.7 < chipH * 0.4 + labelH) {
        return [200, 200, 200];
      }
      return chip;
    }
    if (opts.redArt && y > H * 0.2 && y < H * 0.6 && x > W * 0.6) {
      return [214, 40, 44];
    }
    return [24, 26, 30];
  });
}

/** 受限并发的 map：每次只起 N 个 python，避免在 2 核 runner 上互相抢 CPU */
async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (t: T) => R): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) out.push(fn(items[next++] as T));
  });
  await Promise.all(workers);
  return out;
}

/**
 * 已知失效面登记（`workflows/review-fix-loop.md` 门禁纪律：须显式写清抓不到什么）
 *
 * 1. **`chipWidthFrac` 无用例传**：`frame` 暴露它是为了「能验证宽度方向的占比」，
 *    但当前只有 `chipHeightFrac` 被用到。宽度变化对 share 的影响**没有任何断言**——
 *    改 `chipWidthFrac` 默认值，本文件 11 条用例仍全绿。要覆盖得先补一条用例。
 * 2. **跨语言窗口常量无同步断言**：分析器（Python）的 `CHIP_WIN_HALF_W/H/STEP`
 *    与 `packages/android-host/tests/android-e2e/bookmark-chip.ts` 的
 *    `WINDOW_HALF_WIDTH/HEIGHT/STEP` 靠**注释约定**逐字一致，全仓**没有**断言两侧
 *    相等的测试。TS 侧漂 `WINDOW_STEP` 不会有任何测试转红。
 * 3. **本文件的帧不来自真机**：合成帧只驱动纯 Python 判据，证不了 Lynx 运行时、
 *    原生桥回调、或任何跨端契约——那些只能靠真机或 E2E。
 */
describe("flow-check 收藏 chip 判据（#709）", () => {
  const BOOKMARKED: Rgb = [0x3b, 0x64, 0x70]; // .theme-sky tertiary（设备实测已收藏底色）
  const NOT_BOOKMARKED: Rgb = [0x2e, 0x31, 0x36]; // .theme-sky inverse-surface（设备实测未收藏底色）

  it("合成帧：sky 亮色板未收藏底色 ⇒ not-bookmarked", () => {
    const r = analyzeChip(frame(NOT_BOOKMARKED));
    expect(r.state).toBe("not-bookmarked");
    expect(r.bg).toBe("#2e3136");
    expect(typeof r.x).toBe("number");
  });

  it("合成帧：sky 亮色板已收藏底色 ⇒ bookmarked", () => {
    const r = analyzeChip(frame(BOOKMARKED));
    expect(r.state).toBe("bookmarked");
    expect(r.bg).toBe("#3b6470");
    // 窗口确实落在 chip 上（而非落在空背景上被判成「占比恰好过阈」）。
    //
    // ⚠️ 这不是设备实测值的复现，而是**窗口几何的余量登记**，逐项可算（本轮 review
    // 复核过一遍——早先这三条推导有两处算错，见下方「订正」）：
    //   夹具   chipH = 320×0.044 = 14.08 ⇒ 占 y∈[225,238]；chipW = 180×0.13 = 23.4
    //          标签带占 y∈[230,232]（chipH×0.2 = 2.82 ⇒ 取 3）
    //   粗扫   y 步长 2（只取偶数行）落在 chip 区间的是 {226,228,234,236,238}
    //          —— **5 行不是 7 行**：230/232 落在标签带上，返回 [200,200,200]，
    //          该色与 28 个 chip 令牌的曼哈顿距离全部 > CHIP_TOLERANCE(24)，不计入。
    //          x 步长 2 落在 chip 区间的是 {0,2,…,22} = 12 列
    //          ⇒ n = 5×12 = 60，sum_x = 5×132 = 660 ⇒ **cx = 11.0**
    //          sum_y = 12×(226+228+234+236+238) = 13944 ⇒ cy = 232.4 → int 232
    //   细测窗 y = 232±22 步长 4 ⇒ 210..254 共 12 行（画内 12 行）
    //          x = 11±19 步长 4 ⇒ **-8..28**，-8/-4 出画 ⇒ 画内 8 列
    //          ⇒ 分母 12×8 = 96
    //   命中   chip 色采样点：y ∈ {226,234,238}（230 是标签带）× x ≤ 23 的 {0,4,…,20} 6 列
    //          ⇒ 3×6 = 18
    //   ⇒ 18/96 = 0.1875，round(·,3) 后分析器回 0.188
    //
    // 早先这里写的是 `toBeGreaterThan(0.5)`，实测 0.188 —— **断言凭感觉拍的，无出处**。
    // 别拿它去对齐设备实测的 0.308：那边采样窗（45px）只占屏高 3.5%、比 chip 还矮，
    // 几何与本帧（窗高占屏 14%）完全不同。
    // 窗口常量一漂，这个数就跟着动，这正是它要抓的东西 —— 变异验证：`CHIP_WIN_STEP`
    // 4→3 使 share 漂到 0.213 而 `state` 判定仍正确，**只有这条断言能抓到**。
    expect(r.share as number).toBeCloseTo(0.1875, 2);
  });

  it("画面里有大片红色插画时也**不会**判成 chip（旧的红像素定位会被骗）", () => {
    const r = analyzeChip(frame(NOT_BOOKMARKED, { redArt: true }));
    expect(r.state).toBe("not-bookmarked");
    expect(r.bg).toBe("#2e3136");
    // 定位点必须落在 chip 上（下半部左侧），而不是右侧的红色插画区
    expect(r.x as number).toBeLessThan(W * 0.45);
    expect(r.y as number).toBeGreaterThan(H * 0.7);
  });

  it("画面里没有任何 chip 实色 ⇒ unknown，**不**报 not-bookmarked", () => {
    const png = encodePng(() => [24, 26, 30]);
    const r = analyzeChip(png);
    expect(r.state).toBe("unknown");
    expect(r.x).toBeNull();
  });

  it("chip 实色占比过低 ⇒ unknown（判据给不出结论，不是「读到未收藏」）", () => {
    const r = analyzeChip(frame(NOT_BOOKMARKED, { chipHeightFrac: 0.03 }));
    expect(r.state).toBe("unknown");
    expect(String(r.reason)).toContain("占比");
  });

  it("14 个主题组合逐个代入都判得出来（不是只校准了 sky 一个色板）", () => {
    // 显式超时的理由：这条要 spawn 28 次 python（每次解一张 PNG + 解析 tokens.css），
    // 串行 6~8s 超过 vitest 默认的 5s；同时用 mapLimit 控并发，免得在 2 核 runner 上抢 CPU。
    // 直接读令牌表（与被测脚本同一份单一事实源），逐个合成帧驱动。
    const toks = JSON.parse(
      spawnSync("python3", [
        "-c",
        "import importlib.util,json,sys;" +
          "spec=importlib.util.spec_from_file_location('a',sys.argv[1]);" +
          "m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);" +
          "print(json.dumps(m.read_chip_tokens(sys.argv[2])))",
        ANALYZER,
        TOKENS_CSS,
      ]).stdout.toString(),
    ) as {
      theme: string;
      tertiary: [number, number, number];
      inverse: [number, number, number];
    }[];
    expect(toks.length).toBe(14);
    const jobs = toks.flatMap((t) => [
      { theme: `${t.theme} 已收藏`, state: "bookmarked", chip: t.tertiary },
      { theme: `${t.theme} 未收藏`, state: "not-bookmarked", chip: t.inverse },
    ]);
    return mapLimit(jobs, 8, ({ chip }) => analyzeChip(frame(chip))).then((results) => {
      results.forEach((r, i) => {
        expect(r.state, jobs[i]?.theme).toBe(jobs[i]?.state);
      });
    });
  }, 60_000);
});

describe("flow-check 脚本的旁路与措辞（#709 验收项）", () => {
  const src = readFileSync(FLOW_SCRIPT, "utf8");

  it("SETTINGS_ONLY 旁路仍在，且汇总行读到的变量声明在守卫之外", () => {
    expect(src).toContain('SKIP_MID="${SETTINGS_ONLY:-}"');
    // `set -u` 下，声明在守卫内会让 SETTINGS_ONLY=1 走到汇总行时未绑定变量直接 exit
    const guard = src.indexOf('if [ -z "$SKIP_MID" ]; then');
    const decl = src.indexOf('FAV_OK=""');
    expect(decl, "FAV_OK 必须在 SETTINGS_ONLY 守卫之前声明").toBeGreaterThan(-1);
    expect(decl, "FAV_OK 必须在 SETTINGS_ONLY 守卫之前声明").toBeLessThan(guard);
  });

  it("脚本里不再有任何红像素判据（定位与确认都换成了 chip 底色）", () => {
    // 旧实现的三处特征：红像素阈值 `r > 150 and g < 100 and b < 100`、
    // 「收藏红像素 $R0 → $R1」增量、以及那句确定性文案「收藏未生效」。
    // ⚠️ 只查**可执行行**：注释里要引用旧文案说明「为什么删」，那是必需的，
    // 把注释一并判红等于逼人删掉理由（下一个读者就不知道为什么它曾经是错的）。
    const code = src
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code).not.toMatch(/r > 150 and g < 100 and b < 100/u);
    expect(code).not.toContain("收藏红像素");
    expect(code).not.toContain("收藏未生效");
  });

  it("判不出时输出的是「本轮未验证」而不是产品级失败", () => {
    expect(src).toContain("本轮未验证");
    expect(src).toContain("bookmark-chip");
    // 汇总行不得把收藏步并列进「全部通过」
    expect(src).not.toMatch(/全部通过：[^\n]*卡片收藏/u);
  });

  it("还原确认必须分析**还原之后的新帧**，不能复用点击前那张（钉住本轮修的阻塞）", () => {
    // 缺陷（2026-10-17 由 review 查出并修）：还原 tap 之后**没有重新截图**，
    // 直接拿点击后的 `/tmp/flow_fav.png` 重算 ⇒ `[ "$RST" = "$CST" ]` 恒假，
    // 「还原确认」从未看过还原后的画面，而 tap 其实已经真实发出（会给账号留痕）。
    //
    // 钉的是**可观察点**「RESTORED 分析的是哪张帧」，不是实现文本。
    // 变异验证：把 `/tmp/flow_fav_restore.png` 改回 `/tmp/flow_fav.png` → 本条转红。
    const lines = src.split("\n");
    const restored = lines.filter((l) => l.includes("RESTORED="));
    expect(restored).toHaveLength(1);
    expect(restored[0]).toContain("/tmp/flow_fav_restore.png");
    // 且该帧必须由**还原 tap 之后**的 shot 产出
    const shotAt = lines.findIndex((l) => /^\s*shot fav_restore\s*$/u.test(l));
    expect(shotAt, "脚本里找不到 `shot fav_restore`").toBeGreaterThan(-1);
    expect(shotAt, "fav_restore 的截图必须排在「还原基线」tap 之后").toBeGreaterThan(
      lines.findIndex((l) => l.includes("# 还原基线")),
    );
  });

  it("脚本仍是 bash 语法合法（`bash -n`）——旁路/改动没把它改坏", () => {
    const r = spawnSync("bash", ["-n", FLOW_SCRIPT], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});
