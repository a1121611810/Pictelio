/**
 * 收藏 chip 的**配色无关**底色判据（issue #709）。
 *
 * ## 为什么必须存在
 *
 * `lynx-bookmark-tags.spec.ts` 原先判「已收藏」靠**色相**（青度）：
 * `(g-r) ≥ 25 且 (b-r) ≥ 25 且 g < 200`。那是把「sky 亮色板的 tertiary 长什么样」
 * 当成了「已收藏长什么样」。M3 有 **7 主题 × 明暗 = 14 个组合**，其中 11 个的
 * tertiary 红通道 ≥ 绿通道（藕荷 / 赭 / 橄榄 / 灰蓝一类），判据恒假 ⇒ 真的已收藏
 * 被判成未收藏。更糟的是暗色板：`inverse-surface` 与 `tertiary` 都反相成**浅色**，
 * 任何「深色 chip ⇒ 未收藏」的隐含前提同样不成立。
 *
 * ## 本判据的依据：chip 底色是 M3 令牌的**实色值**
 *
 * spec `docs/specs/bookmark-color.md` §配色：未收藏 = `--md-inverse-surface`，
 * 已收藏 = `--md-tertiary`，且**取实色底**（原型里的 rgba + backdrop-filter 被
 * 明确否掉，Lynx 原生也不支持 backdrop-filter）。⇒ 屏幕上 chip 中心的像素应当
 * **逐位等于**该主题的某个令牌值。设备实测也吻合（2026-09-29 两帧逐像素）：
 * 未收藏 `#2e3136`、已收藏 `#3b6470` = `.theme-sky` 的两个令牌。
 *
 * 于是判据不认色相，只认「这个值属于哪一族令牌」，并把「两族都像 / 都不像」
 * 显式报成 `unknown`——**绝不静默返回「未收藏」**。旧实现最贵的错法正是那句
 * 静默的 `false`：它让 spec 在不该红的地方重试到耗尽，并把根因指向布局/坐标。
 *
 * ## 单一事实源
 *
 * 令牌表**运行时解析** `packages/app-lynx/src/styles/tokens.css`（不手抄、不复制）：
 * 色板一改（含 `generate-theme-palettes.mjs` 重新生成的暗色段）本判据自动跟随，
 * 不会出现「判据还停在旧色板」这种失效——正是旧青度判据的失败形态。
 *
 * ## 采样窗与阈值（不要随手改）
 *
 * 窗口 `±19 × ±22`、步长 4（= 120 个采样点）与占比阈值 0.15 都是**设备实测**值：
 * 2026-09-29 实跑两帧同坐标窗口 (±22/±19、步长 4) 逐像素统计，已收藏态 chip 底色
 * 命中 **37/120 = 0.308**，未收藏态 **0/120**，同坐标空白对照 **0/120**。
 * 阈值取 0.15：距实测信号 2 倍余量、距阴性 0 有 15% 硬间隔。窗口与步长与旧实现
 * **逐字一致**，所以那组设备证据在本次改动后仍然成立（改动只换「怎么分类」，
 * 不换「在哪采样」）。
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type Rgb3 = readonly [number, number, number];

/** 取色器（由调用方从 canvas 像素注入，便于单测用合成数据） */
export type ColorSampler = (x: number, y: number) => Rgb3;

/** 令牌表单一事实源：app-lynx 的 M3 令牌文件 */
export const BOOKMARK_TOKENS_CSS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../..",
  "packages/app-lynx/src/styles/tokens.css",
);

/** 采样窗（物理像素；设备实测，见文件头） */
export const WINDOW_HALF_WIDTH = 19;
export const WINDOW_HALF_HEIGHT = 22;
export const WINDOW_STEP = 4;

/** 窗口内 chip 实色占比下限（设备实测 0.308 / 0，取 0.15 留余量） */
export const MIN_CHIP_SHARE = 0.15;

/**
 * 色值容差（RGB 三通道**和**）。
 *
 * 取 24 的依据（对 tokens.css 全部 14 个组合两两算出来的，不是估的）：
 *   · 同族最近的一对（`.theme-pink.dark`/`.theme-bili.dark` 的 tertiary）距离 **3**
 *     —— 它们同属「已收藏」，归错族也无所谓，容差取得比它宽没有代价；
 *   · **跨族**最近的一对（`.theme-sky.dark` 的 tertiary ↔ 同主题的 inverse-surface）
 *     距离 **50** ⇒ 24 留了 2 倍余量，保证「两族绝不重叠」。
 * 截图链路上 chip 中心的实色像素是逐位令牌值（无抗锯齿、无渐变），只有色彩管理
 * 造成的极小漂移，24 已经远宽于它。
 */
export const BOOKMARK_CHIP_TOLERANCE = 24;

export interface BookmarkChipToken {
  /** 主题名：`sky` / `violet` / … / `bili.dark` */
  theme: string;
  /** 已收藏态 chip 底色（`--md-tertiary`） */
  tertiary: string;
  /** 未收藏态 chip 底色（`--md-inverse-surface`） */
  inverseSurface: string;
}

/** 顶层规则块（选择器里可能含换行；体里不含嵌套花括号） */
const RULE = /([^{}]+)\{([^{}]*)\}/g;
const TOKEN_RE = (name: string): RegExp => new RegExp(`--md-${name}:\\s*(#[\\da-fA-F]{6})\\s*;`);

/**
 * 解析 tokens.css，取出全部「主题 × 明暗」组合的 chip 两态底色。
 *
 * 基准色板的选择器是 `page,\n.theme-sky`（二者同规则），按 `.theme-*` 取名 ⇒ `sky`；
 * 暗色段是自动生成的复合选择器 `.theme-X.dark` ⇒ `X.dark`。两者都覆盖到了。
 */
export function parseBookmarkChipTokens(css: string): BookmarkChipToken[] {
  // ⚠️ 必须先剥注释：`[^{}]+` 的选择器匹配会把两条规则之间的 `/* … */` 一并吞进
  // 「选择器」里，于是注释里提到的 `.theme-X.dark` 变成一个幽灵主题
  // （实测症状：主题名多出一个 `X.dark`，14 个组合里有 2 个是错的）。
  const src = css.replace(/\/\*[\s\S]*?\*\//g, " ");
  const out: BookmarkChipToken[] = [];
  for (const m of src.matchAll(RULE)) {
    const selector = (m[1] ?? "").split(/\s+/u).filter(Boolean).join(" ");
    const body = m[2] ?? "";
    const tertiary = TOKEN_RE("tertiary").exec(body)?.[1];
    const inverseSurface = TOKEN_RE("inverse-surface").exec(body)?.[1];
    if (!tertiary || !inverseSurface) continue;
    const dark = /\.dark\b/u.test(selector);
    const name = /\.theme-([\w-]+)/u.exec(selector)?.[1];
    if (!name) continue;
    // 一个规则里可能同时出现多个 `.theme-*`（基准块是 `page, .theme-sky`），
    // 只在「选出来的那个类名与 dark 标记自洽」时收下，避免把 `page` 侧的规则错配。
    if (/\.theme-[\w-]+\.dark\b/u.test(selector) !== dark) continue;
    out.push({ theme: dark ? `${name}.dark` : name, tertiary, inverseSurface });
  }
  return [...new Map(out.map((t) => [t.theme, t])).values()].toSorted((a, b) =>
    a.theme.localeCompare(b.theme),
  );
}

/** 从磁盘读令牌表（单测与 spec 共用同一入口） */
export function readBookmarkChipTokens(
  path: string = BOOKMARK_TOKENS_CSS_PATH,
): BookmarkChipToken[] {
  return parseBookmarkChipTokens(readFileSync(path, "utf8"));
}

function hexToRgb(hex: string): Rgb3 {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** RGB 三通道绝对差之和 */
function channelDistance(a: Rgb3, b: Rgb3): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

/** 跨族（tertiary ↔ inverse-surface）最近色对的距离；单测用它证明两族可分 */
export function crossStateMinDistance(tokens: BookmarkChipToken[]): number {
  let min = Infinity;
  for (const t of tokens) {
    for (const u of tokens) {
      min = Math.min(min, channelDistance(hexToRgb(t.tertiary), hexToRgb(u.inverseSurface)));
    }
  }
  return min;
}

export type BookmarkChipState = "bookmarked" | "not-bookmarked" | "unknown";

export interface ChipColorVerdict {
  state: BookmarkChipState;
  /** 命中「已收藏」族的主题名 */
  marked: string[];
  /** 命中「未收藏」族的主题名 */
  unmarked: string[];
}

/**
 * 把一个实测色值归类到 chip 两态令牌之一。
 *
 * `unknown` 的两种来源（都**不**猜）：
 *   · 两族都命中（容差过大 / 令牌表里出现跨族重复）；
 *   · 两族都没命中（作品图上的任意色、心形笔画色、计数文字色）。
 */
export function classifyChipColor(
  observed: Rgb3,
  tokens: BookmarkChipToken[],
  tolerance: number = BOOKMARK_CHIP_TOLERANCE,
): ChipColorVerdict {
  const marked = tokens
    .filter((t) => channelDistance(observed, hexToRgb(t.tertiary)) <= tolerance)
    .map((t) => t.theme);
  const unmarked = tokens
    .filter((t) => channelDistance(observed, hexToRgb(t.inverseSurface)) <= tolerance)
    .map((t) => t.theme);
  const state: BookmarkChipState =
    marked.length > 0 && unmarked.length === 0
      ? "bookmarked"
      : unmarked.length > 0 && marked.length === 0
        ? "not-bookmarked"
        : "unknown";
  return { state, marked, unmarked };
}

export interface ChipBookmarkVerdict extends ChipColorVerdict {
  /** 窗口内命中「最接近的令牌」的那一族的占比 */
  share: number;
  /** 窗口内被判为 chip 底色的那个色值 */
  observed: Rgb3;
  /** 采样点数 */
  samples: number;
}

/**
 * 采样窗 → chip 底色 → 收藏态。
 *
 * 两步：① 找出窗口里**出现最多的、且能归入某个 chip 令牌**的实测色值；
 * ② 把这个**实测色值**（不是「胜出主题的 tertiary」）交给 `classifyChipColor` 判族。
 *
 * ⚠️ 第②步为什么必须回喂实测色：族归属是由**像素**决定的，不由「哪个主题的哪个字段
 * 赢了计数」决定。窗内最常见的可归类色值通常是胶囊底色；早期实现把胜出主题的
 * **tertiary** 直接当答案，于是 `inverse-surface` 命中时也返回 bookmarked
 * （单元测试立刻抓到：`bili`/`sky` 的未收藏态被判成已收藏）。
 * 多主题命中同一色值（实测 `.theme-sky` 与 `.theme-violet` 的 inverse-surface 距离
 * 仅 7）是正常的——它们说的是同一件事（未收藏），不构成歧义。
 */
export function chipBookmarkState(
  sample: ColorSampler,
  spot: { x: number; y: number },
  tokens: BookmarkChipToken[],
  opts: { tolerance?: number; minShare?: number } = {},
): ChipBookmarkVerdict {
  const tolerance = opts.tolerance ?? BOOKMARK_CHIP_TOLERANCE;
  const minShare = opts.minShare ?? MIN_CHIP_SHARE;

  const counts = new Map<string, number>();
  let total = 0;
  for (let y = spot.y - WINDOW_HALF_HEIGHT; y <= spot.y + WINDOW_HALF_HEIGHT; y += WINDOW_STEP) {
    for (let x = spot.x - WINDOW_HALF_WIDTH; x <= spot.x + WINDOW_HALF_WIDTH; x += WINDOW_STEP) {
      total++;
      const [r, g, b] = sample(x, y);
      const matchable = tokens.some(
        (t) =>
          channelDistance([r, g, b], hexToRgb(t.tertiary)) <= tolerance ||
          channelDistance([r, g, b], hexToRgb(t.inverseSurface)) <= tolerance,
      );
      if (!matchable) continue;
      const key = `${r},${g},${b}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  let dominant: Rgb3 = [0, 0, 0];
  let bestN = 0;
  for (const [key, n] of counts) {
    if (n > bestN) {
      bestN = n;
      dominant = key.split(",").map(Number) as unknown as Rgb3;
    }
  }
  const share = total === 0 ? 0 : bestN / total;
  if (bestN === 0 || share < minShare) {
    return {
      state: "unknown",
      marked: [],
      unmarked: [],
      share,
      observed: dominant,
      samples: total,
    };
  }
  return {
    ...classifyChipColor(dominant, tokens, tolerance),
    share,
    observed: dominant,
    samples: total,
  };
}
