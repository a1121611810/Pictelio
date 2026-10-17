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
 *   本测试**不复制**色值；下面断言的 `#3b6470` / `#2e3136` 是票面与
 *   spec `docs/specs/bookmark-color.md` §残余风险 记的 2026-09-29 设备实测值。
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
// 缩到 1/4 面积后各判据的比例量（chip 占比）按构造不变——见 `frame` 的说明。
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
 * `chipHeightFrac` = chip 的纵向高度占屏高的比例。判据的扫描域是 y ≥ 0.45H 的
 * 下半部（推荐流收藏胶囊落在那里），故 chip 的**占比**随这个值线性变化：
 * 0.30 → 约 0.25（过阈），0.03 → 约 0.025（不过阈）。
 */
function frame(chip: Rgb, opts: { redArt?: boolean; chipHeightFrac?: number } = {}): Buffer {
  const chipH = H * (opts.chipHeightFrac ?? 0.3);
  return encodePng((x, y) => {
    // chip 画在画面下半部左侧（推荐流收藏胶囊的位置）
    if (y > H * 0.7 && y < H * 0.7 + chipH && x < W * 0.45) {
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

  it("脚本仍是 bash 语法合法（`bash -n`）——旁路/改动没把它改坏", () => {
    const r = spawnSync("bash", ["-n", FLOW_SCRIPT], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});
