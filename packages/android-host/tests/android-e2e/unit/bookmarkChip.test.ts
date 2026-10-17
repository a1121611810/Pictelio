/**
 * 收藏 chip 底色判据的单测（#709）。**不碰 adb / 模拟器**，直接驱动纯函数。
 *
 * ## 这条判据为什么必须改（不要回滚成旧实现）
 *
 * 旧实现判「已收藏」= 窗口内「青度像素」占比 ≥ 0.15，即
 * `(g-r) ≥ 25 且 (b-r) ≥ 25 且 g < 200`。那是**按色相**判的：M3 的 tertiary 在
 * 7 套主题 × 明暗 = **14 个组合**里，有 11 个的 tertiary 是藕荷 / 赭 / 橄榄 / 灰蓝
 * 一类，红通道 ≥ 绿通道 ⇒ 判据恒假 ⇒ **真的已收藏被判成未收藏**，该 spec 在那些
 * 组合上结构性不可通过。当前设备验收所用的主题恰好落在成立的 3 个组合里 ⇒
 * 换色板即再次假阴性，且在现有 e2e 里完全看不出来（见下方「旧判据演示」）。
 *
 * 新实现**不认色相**：chip 底色是 M3 令牌的实色值，两态分别等于该主题的
 * `--md-tertiary` / `--md-inverse-surface`（spec `docs/specs/bookmark-color.md`
 * §配色）。故判据改为「窗口内实测色值最接近哪一族令牌」，并对任何无法归类的
 * 情形（窗口里没有 chip 实色 / 同时命中两族）返回 `unknown`，**绝不静默返回
 * 「未收藏」**——那正是旧实现最贵的一种错法。
 *
 * oracle 溯源：
 * ① 令牌表由 `packages/app-lynx/src/styles/tokens.css` **运行时解析**得到
 *    （不手抄），所以色板一改，本表自动跟随；
 * ② 采样窗与占比阈值沿用设备实测（见 `bookmark-chip.ts` 的说明段）。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  BOOKMARK_TOKENS_CSS_PATH,
  BOOKMARK_CHIP_TOLERANCE,
  MIN_CHIP_SHARE,
  WINDOW_HALF_HEIGHT,
  WINDOW_HALF_WIDTH,
  WINDOW_STEP,
  chipBookmarkState,
  classifyChipColor,
  crossStateMinDistance,
  readBookmarkChipTokens,
  type BookmarkChipToken,
  type Rgb3,
} from "../bookmark-chip";

/** 全量令牌表（14 组合；从 tokens.css 解析，非手抄） */
const TOKENS: BookmarkChipToken[] = readBookmarkChipTokens();

/**
 * 旧判据的**逐字保留副本**（本文件内，刻意不进产品代码）。
 *
 * 它在这里只有一个用途：证明下面的表驱动用例不是同义反复。
 * 若哪天有人把色相判据当成更好的方案改回去，本文件会立刻指出它在多少个
 * 组合上失效——而这个失效在设备上完全看不出来（当前 e2e 用的主题恰好能过）。
 */
function legacyTealCast(c: Rgb3): boolean {
  const [r, g, b] = c;
  return g - r >= 25 && b - r >= 25 && g < 200;
}

/** 合成取色器：整片单色（可按比例掺入干扰色），用于驱动采样窗口。 */
function solidSampler(
  base: Rgb3,
  opts: { w?: number; h?: number; noiseShare?: number; noise?: Rgb3 } = {},
): (x: number, y: number) => readonly [number, number, number] {
  const w = opts.w ?? 200;
  const h = opts.h ?? 200;
  const noiseShare = opts.noiseShare ?? 0;
  const noise = opts.noise ?? [240, 241, 247];
  // ⚠️ 用乘法哈希而不是「随机采样去重」：后者在 95% 密度下碰撞极多，实际比例
  // 远低于设定值 ⇒ 占比阈值那条用例的边界是假的（实测踩到：设 0.95 实得 ~0.9，
  // 断言仍绿）。哈希给出与设定值成正比的精确比例，且确定性可复跑。
  const isNoise = (i: number): boolean =>
    noiseShare > 0 && Math.imul(i, 2654435761) / 4294967296 < noiseShare;
  // ⚠️ 必须环绕取模：采样窗的中心 y ≈ 1698，远超 h，索引不取模的话所有点都落在
  // 噪声集合之外 ⇒ 合成的「95% 干扰色」实际是 0%，用例会假绿。
  const cell = (x: number, y: number): number => (((y % h) + h) % h) * w + (((x % w) + w) % w);
  return (x, y) => (isNoise(cell(x, y)) ? noise : base);
}

describe("令牌表（运行时解析 tokens.css，不手抄）", () => {
  it("恰好 14 个组合 = 7 主题 × 明暗；缺一个都会让下方的表驱动覆盖变窄", () => {
    expect(TOKENS.length).toBe(14);
    // 主题名带 `.dark` 后缀 ⇒ 去后缀后才是 7 个主题
    expect(new Set(TOKENS.map((t) => t.theme.replace(/\.dark$/u, ""))).size).toBe(7);
    expect(TOKENS.filter((t) => t.theme.endsWith(".dark")).length).toBe(7);
    expect(TOKENS.filter((t) => !t.theme.endsWith(".dark")).length).toBe(7);
    for (const t of TOKENS) {
      expect(t.tertiary, `${t.theme} 的 tertiary 必须是实色值`).toMatch(/^#[\da-f]{6}$/);
      expect(t.inverseSurface, `${t.theme} 的 inverse-surface 必须是实色值`).toMatch(
        /^#[\da-f]{6}$/,
      );
    }
  });

  it("基准色板（.theme-sky）两态就是票面记的那两个实测值", () => {
    // 票面 #709 正文 + spec §残余风险 记的 2026-09-29 设备实测：
    //   未收藏胶囊底 rgb(46,49,54) = #2e3136；已收藏底 rgb(59,100,112) = #3b6470
    const sky = TOKENS.find((t) => t.theme === "sky");
    expect(sky).toBeDefined();
    expect(sky!.inverseSurface).toBe("#2e3136");
    expect(sky!.tertiary).toBe("#3b6470");
  });

  it("暗色板里 inverse-surface 反相成浅色、tertiary 也是浅色 accent —— 判据不能假设 chip 一定是深色", () => {
    const dark = TOKENS.filter((t) => t.theme.endsWith(".dark"));
    expect(dark.length).toBe(7);
    for (const t of dark) {
      const inv = hexToRgb(t.inverseSurface);
      expect(inv[0], `${t.theme} 暗色 inverse-surface 应偏亮`).toBeGreaterThan(200);
    }
  });
});

describe("旧色相判据的失效面（证明本表驱动用例不是同义反复）", () => {
  it("14 个已收藏令牌里，旧判据只在 3 个上成立", () => {
    const failing = TOKENS.filter((t) => !legacyTealCast(hexToRgb(t.tertiary)));
    // oracle = 对 tokens.css 全部 14 个 tertiary 逐个代入旧判据算术（证明式，无抽样）：
    // 成立的恰好是 sky / green / bili 三个亮色板。
    expect(failing.map((t) => t.theme).toSorted()).toEqual([
      "bili.dark",
      "green.dark",
      "orange",
      "orange.dark",
      "pink",
      "pink.dark",
      "sky.dark",
      "teal",
      "teal.dark",
      "violet",
      "violet.dark",
    ]);
  });

  it("旧判据在「未收藏」令牌上全不成立 —— 所以它只会把已收藏误判成未收藏（单向假阴性）", () => {
    for (const t of TOKENS) {
      expect(
        legacyTealCast(hexToRgb(t.inverseSurface)),
        `${t.theme} 的未收藏底色不该被判成已收藏`,
      ).toBe(false);
    }
  });
});

describe("classifyChipColor（逐组合表驱动）", () => {
  it("每个主题的 tertiary ⇒ bookmarked", () => {
    for (const t of TOKENS) {
      const v = classifyChipStateName(t.tertiary);
      expect(v, `${t.theme} 的 tertiary ${t.tertiary}`).toBe("bookmarked");
    }
  });

  it("每个主题的 inverse-surface ⇒ not-bookmarked", () => {
    for (const t of TOKENS) {
      expect(classifyChipStateName(t.inverseSurface), `${t.theme} 的 inv ${t.inverseSurface}`).toBe(
        "not-bookmarked",
      );
    }
  });

  it("两族在当前容差下**可分**（跨状态最小距离 > 2× 容差）——这是上面两条成立的前提", () => {
    // 若哪天有人调小容差到跨状态最小距离以内，这条会红：那时「已收藏」与「未收藏」
    // 在像素上已不可分，正确做法是让判据返回 unknown（下方那条），而不是硬判。
    const minDist = crossStateMinDistance(TOKENS);
    expect(minDist).toBeGreaterThan(BOOKMARK_CHIP_TOLERANCE * 2);
  });

  it("容差大到两族重叠时 ⇒ unknown，绝不静默返回 not-bookmarked", () => {
    // 造一个**必然重叠**的场景：容差取「sky.dark 的 tertiary 到它自己 inverse-surface
    // 的距离」，此时该色值同时落在两族里（距离由令牌表算出，不写死数值）。
    const skyDark = TOKENS.find((t) => t.theme === "sky.dark")!;
    const gap = dist(hexToRgb(skyDark.tertiary), hexToRgb(skyDark.inverseSurface));
    const r = classifyChipColor(hexToRgb(skyDark.tertiary), TOKENS, gap);
    expect(r.state).toBe("unknown");
    expect(r.marked.length).toBeGreaterThan(0);
    expect(r.unmarked.length).toBeGreaterThan(0);
  });

  it("不属于任何 chip 令牌的颜色（作品图上的任意色）⇒ unknown", () => {
    const r = classifyChipColor([1, 2, 3], TOKENS);
    expect(r.state).toBe("unknown");
    expect(r.marked).toEqual([]);
    expect(r.unmarked).toEqual([]);
  });
});

describe("chipBookmarkState（采样窗口 → 底色 → 状态）", () => {
  const spot = { x: 100, y: 1698 };

  it("窗口内主要是 tertiary ⇒ bookmarked", () => {
    const sky = TOKENS.find((t) => t.theme === "sky")!;
    const s = solidSampler(hexToRgb(sky.tertiary), { noiseShare: 0.3 });
    const r = chipBookmarkState(s, spot, TOKENS);
    expect(r.state).toBe("bookmarked");
    expect(r.share).toBeGreaterThanOrEqual(MIN_CHIP_SHARE);
  });

  it("窗口内主要是 inverse-surface ⇒ not-bookmarked", () => {
    const sky = TOKENS.find((t) => t.theme === "sky")!;
    const s = solidSampler(hexToRgb(sky.inverseSurface), { noiseShare: 0.3 });
    expect(chipBookmarkState(s, spot, TOKENS).state).toBe("not-bookmarked");
  });

  it("每个主题明暗 14 个组合都能判出来（采样层，不是只测分类函数）", () => {
    for (const t of TOKENS) {
      expect(
        chipBookmarkState(solidSampler(hexToRgb(t.tertiary), { noiseShare: 0.3 }), spot, TOKENS)
          .state,
        `${t.theme} 已收藏态`,
      ).toBe("bookmarked");
      expect(
        chipBookmarkState(
          solidSampler(hexToRgb(t.inverseSurface), { noiseShare: 0.3 }),
          spot,
          TOKENS,
        ).state,
        `${t.theme} 未收藏态`,
      ).toBe("not-bookmarked");
    }
  });

  it("窗口里没有 chip 实色（心形笔画/计数文字占满）⇒ unknown，不判 not-bookmarked", () => {
    const s = solidSampler([239, 241, 247]);
    const r = chipBookmarkState(s, spot, TOKENS);
    expect(r.state).toBe("unknown");
  });

  it("窗口内 chip 实色占比不足 MIN_CHIP_SHARE ⇒ unknown", () => {
    const sky = TOKENS.find((t) => t.theme === "sky")!;
    // 掺入比例取到刚好落在阈值下方（阈值由 MIN_CHIP_SHARE 导出，不写死数值）
    const s = solidSampler(hexToRgb(sky.tertiary), { noiseShare: 0.95 });
    expect(MIN_CHIP_SHARE).toBeLessThan(0.95);
    expect(chipBookmarkState(s, spot, TOKENS).state).toBe("unknown");
  });

  it("采样窗口径 = 设备实测的那一扇（改它会让既有设备证据失效）", () => {
    // oracle = 2026-09-29 实跑两帧同坐标窗口实测：120 个采样点，
    // 已收藏底色命中 37/120 = 0.308、未收藏 0/120 ⇒ 阈值取 0.15。
    expect(WINDOW_HALF_WIDTH).toBe(19);
    expect(WINDOW_HALF_HEIGHT).toBe(22);
    expect(WINDOW_STEP).toBe(4);
    const points =
      Math.ceil((WINDOW_HALF_HEIGHT * 2 + 1) / WINDOW_STEP) *
      Math.ceil((WINDOW_HALF_WIDTH * 2 + 1) / WINDOW_STEP);
    expect(points).toBe(120);
    expect(MIN_CHIP_SHARE).toBe(0.15);
  });
});

describe("容差取值（不是随手写的数字）", () => {
  it("容差 ≥ 实测抗锯齿/压缩漂移，又远小于跨状态最小距离的一半", () => {
    const css = readFileSync(BOOKMARK_TOKENS_CSS_PATH, "utf8");
    expect(css, "tokens.css 必须存在（判据的单一事实源）").toContain("--md-tertiary");
    // 28 个条目里最近的一对（同族）通道和距离 = 3；跨族最近 = 50。
    // 取 24 ⇒ 对同族近邻有 8 倍余量、对跨族分界有 2 倍余量。
    expect(BOOKMARK_CHIP_TOLERANCE).toBe(24);
    expect(crossStateMinDistance(TOKENS)).toBe(50);
  });
});

// ── 本地小工具 ──
function hexToRgb(hex: string): Rgb3 {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

function classifyChipStateName(hex: string): string {
  return classifyChipColor(hexToRgb(hex), TOKENS).state;
}

/** RGB 三通道绝对差之和（与 `bookmark-chip.ts` 内部同一口径） */
function dist(a: Rgb3, b: Rgb3): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}
