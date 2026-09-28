/**
 * transition-matrix 发版门的**纯几何 / 判据逻辑**（issue #814，不碰 adb / 模拟器）。
 *
 * 抽出理由：spec 是 CLI 编排脚本（顶层执行 describe + 真实截图），无法直接单测——
 * 与 prefs.parseEngineState / prefs.poll 同款「编排与纯逻辑分离」惯例（先例见
 * tests/android-e2e/unit/prefs.*.test.ts）。
 *
 * ⚠️ oracle 溯源（非从实现反推）：全部期望值来自 **2026-09-28 实跑的真实证据帧**
 * （`test-results/android-e2e/transition-matrix/*.png`，#814 复跑 3 红 1 绿），
 * 在该批帧上用 canvas 逐像素实测得到。凡本文件写死��数值，都是那批帧上的实测值，
 * 注释里标注了对应的帧文件名与实测口径。
 *
 * #814 的核心教训（三条红全部因硬编码几何与实际不符，且**报错文案全部指向错误根因**）：
 *   ① 采样窗 x 范围没盖住被测对象 → 差异恒 0 被误报成「状态冻结」；
 *   ② 采样窗越过内容区底界 → 混入恒定系统栏死像素 → 稀释差异；
 *   ③ 「色彩桶数」与「是否加载完」无稳定对应 → 把「加载慢」说成「没加载」。
 * 故判据必须能在「窗不可信」时**显式返回不可信**，而不是返回一个会被误读的 0。
 */

/** 采样区域（物理像素窗口） */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 深色行亮度上限（♥ 收藏胶囊实测均值 87..93；浅色插画/白底实测均 >130） */
export const DARK_ROW_MAX_BRIGHTNESS = 110;

/** 收藏行采样点下限（步长 2）。低于此值差异 0 不可信 → 必须 skip */
export const MIN_BOOKMARK_SAMPLES = 2_000;

/** 区域采样点总数（步长 2，与 spec regionSamples 同口径） */
export function regionSamples(region: Region): number {
  return Math.ceil((region.y1 - region.y0) / 2) * Math.ceil((region.x1 - region.x0) / 2);
}

/** 灰度取值函数（由调用方从 canvas 像素注入，便于单测用合成数据） */
export type GrayAt = (x: number, y: number) => number;

/** 区域平均亮度（步长 4，与 spec avgBrightness 同量级） */
export function regionAvgBrightness(region: Region, gray: GrayAt): number {
  let sum = 0;
  let n = 0;
  for (let y = region.y0; y < region.y1; y += 4) {
    for (let x = region.x0; x < region.x1; x += 4) {
      sum += gray(x, y);
      n++;
    }
  }
  return n === 0 ? 255 : sum / n;
}

/**
 * 探测深色收藏胶囊行（R3 收藏行定位）。
 *
 * oracle：`stable-r3-card1.png` 实测——y 1860..1940 的深色内容**横跨 x 0..1078**
 * （♥ 徽标是整行宽的 scrim 胶囊，不是只占左侧），该段行均亮度 87..93。
 * 原硬编码窗 x 43..430 会把收藏数字切掉，导致同一窗下
 * 「card0 vs card1 = 50（过）」而「card1 vs card2 = 0（不过）」——
 * 同窗同度量两对结果相反 ⇒ 不是状态冻结，是采样窗没盖住被测对象。
 *
 * @returns 胶囊的 y 区间；未探测到（内容形态不符，如非推荐流卡片）返回 null
 */
export function detectBookmarkRow(region: Region, gray: GrayAt): { y0: number; y1: number } | null {
  let best: { y: number; b: number } | null = null;
  for (let y = region.y0; y < region.y1; y += 2) {
    const avg = regionAvgBrightness({ x0: region.x0, y0: y, x1: region.x1, y1: y + 1 }, gray);
    if (!best || avg < best.b) best = { y, b: avg };
  }
  if (!best || best.b > DARK_ROW_MAX_BRIGHTNESS) return null;

  const extendsDark = (y: number): boolean =>
    regionAvgBrightness({ x0: region.x0, y0: y, x1: region.x1, y1: y + 1 }, gray) <=
    DARK_ROW_MAX_BRIGHTNESS + 20;

  let y0 = best.y;
  for (let y = best.y; y >= region.y0 && extendsDark(y); y -= 2) y0 = y;
  let y1 = best.y;
  for (let y = best.y; y < region.y1 && extendsDark(y); y += 2) y1 = y;
  return { y0, y1 };
}

/**
 * 由两帧的探测结果推出采样窗（取交集 y × 全宽 x）。
 *
 * x 从 0 取到 `contentRight`：胶囊横跨全宽，若沿用旧窗右界 430 会切掉收藏数字。
 */
export function bookmarkSampleRegion(
  a: { y0: number; y1: number },
  b: { y0: number; y1: number },
  contentRight: number,
): Region {
  return {
    x0: 0,
    y0: Math.max(a.y0, b.y0),
    x1: contentRight,
    y1: Math.min(a.y1, b.y1),
  };
}

/**
 * 收藏行差异判据的**可信度**裁决。
 *
 * #814 教训：窗内采样点不足时差异 0 **不能**判成「状态冻结」——
 * 采样窗没对准被测对象时报错文案会指向完全错误的方向（本次就误报成
 * 「BookmarkButton init-only props 宿主契约回归」）。
 *
 * @returns "assert" 可断言 | "skip" 窗不可信（内容形态不符），调用方须显式 skip 并说明原因
 */
export function judgeBookmarkRow(
  region: Region,
  diffCount: number,
  threshold: number,
  minSamples: number = MIN_BOOKMARK_SAMPLES,
): { verdict: "assert"; expected: number } | { verdict: "skip"; reason: string; samples: number } {
  const samples = regionSamples(region);
  if (samples < minSamples) {
    return {
      verdict: "skip",
      reason:
        `采样窗 y ${region.y0}..${region.y1} × x ${region.x0}..${region.x1} 仅 ${samples} 个采样点` +
        `（< ${minSamples}），不足以覆盖收藏行——窗不可信，差异 ${diffCount} 不可判定`,
      samples,
    };
  }
  return { verdict: "assert", expected: threshold };
}

/**
 * R1「锚点下方」采样区：把下界钳到内容区底界。
 *
 * oracle：`stable-r1-scrolled.png` vs `stable-r1-returned.png` 实测——below 区
 * （y = tapY+40 .. 2100）差异随 tapY 递减：1250→444、1400→369、1650→240、1800→232、
 * 1950→**0**；而 2100 越过内容区底界 2016，越界部分恒落在系统栏/手势条上（死像素），
 * 按比例稀释差异。实测占比仅 0.2%，却足以把断言压到 INJECT_TH(800) 之下。
 */
export function belowAnchorRegion(tapY: number, contentBottom: number): Region {
  return {
    x0: 0,
    y0: tapY + 40,
    x1: 1080,
    y1: Math.min(contentBottom, Math.max(tapY + 41, 2100)),
  };
}

/**
 * R2「内容已加载」判据：桶数过阈 **或** 画面已稳定。
 *
 * oracle：`loaded-r2-illusts.png`（mtime 17:53:42 = 最后一轮轮询）实测桶数 **88**
 * （阈值 25，远超），但同一函数仍抛「未超过 25」——90s 全部耗在骨架屏上
 * （逐带桶数 1..5、亮度 202..238 的均匀浅灰）。⇒ 色彩桶数与「是否加载完」
 * **没有稳定对应**：单张大幅插画铺满视口时纵向色块少，桶数天然偏低。
 *
 * 「画面已稳定」是内容无关的收敛信号；已稳定但桶数仍低 ⇒ 是内容形态低桶，放行。
 */
export function judgeContentLoaded(params: {
  buckets: number;
  minBuckets: number;
  stable: boolean;
}): { verdict: "loaded" | "stable-but-low-buckets" | "loading" } {
  if (params.buckets > params.minBuckets) return { verdict: "loaded" };
  if (params.stable) return { verdict: "stable-but-low-buckets" };
  return { verdict: "loading" };
}
