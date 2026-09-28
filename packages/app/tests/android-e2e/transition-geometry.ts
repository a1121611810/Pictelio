/**
 * transition-matrix 发版门的**纯几何 / 判据逻辑**（issue #814，不碰 adb / 模拟器）。
 *
 * 抽出理由：spec 是 CLI 编排脚本（顶层执行 describe + 真实截图），无法直接单测——
 * 与 prefs.pollPrefs / prefs.loginViaDevIntent 同款「编排与纯逻辑分离」惯例
 * （先例见 tests/android-e2e/unit/prefs.poll.test.ts）。
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

// ─── 放射 FAB 几何（2026-09-28 #816 R2 订正）───
//
// 为什么要推导而不是写死坐标：本轮 R2 的真因就是「FAB_SEARCH_ITEM_TAP 是魔数」。
// 该常量首跑写成 (906,1760)，与实机差 87px 横 / 213px 纵 → 落在两环之间的空隙里，
// 点下去菜单收起、回到列表，报错却写「SearchSheet 未打开」（把人引向布局回归）。
// 与 `FAB_TAP` 同款失败模式已连续三轮复发，故把落点改为**由组件几何算出**：
// 组件改了半径/起始角/边距，spec 自动跟随；不改就由单测拦下。
//
// 数值唯一事实源 = packages/app-lynx/src/components/GlobalFab.vue
//   :40-46  FAB_RIGHT_VW=4.267 / FAB_SIZE_VW=14.933 / R_INNER_VW=20
//   :86-88  fabCx = 100 - RIGHT - SIZE/2；fabCy = screenHeightVw - RIGHT - SIZE/2
//   :117-120 polar(): x = cx + sin(a)·r，y = cy - cos(a)·r
//   :130    INNER_START = -14
// 改组件几何时**必须**同步本段并跑 unit/transition-geometry.test.ts。

/** GlobalFab.vue 的 vw 几何常量（镜像组件，不可在此处自行调参） */
export const FAB_GEOMETRY_VW = {
  /** FAB 右尾随边距 = bottom-4 */
  right: 4.267,
  /** 主 FAB 直径 = 56dp */
  size: 14.933,
  /** 内环半径 */
  innerRadius: 20,
  /** 内环起始角（0°=正上方，顺时针为负往左） */
  innerStartDeg: -14,
} as const;

/** 物理像素点 */
export interface Point {
  x: number;
  y: number;
}

function vwToPx(vw: number, deviceWidthPx: number): number {
  return (vw * deviceWidthPx) / 100;
}

/**
 * 逻辑屏高（vw）= 内容区高 / 屏宽 × 100。
 *
 * ADR-0131：`screenHeightVw` 在 `contentSize` 命中时返回 `(contentSize.h / contentSize.w) * 100`，
 * 而 `contentSize.h` 是**稳定区**高度（撇除系统导航条 inset），**不是全屏**。
 * 本轮已两次因口径混淆写错坐标（全屏 2160 vs 稳定区 2016，差 144px）。
 */
export function contentHeightVw(contentBottomPx: number, deviceWidthPx: number): number {
  return (contentBottomPx / deviceWidthPx) * 100;
}

/**
 * 主 FAB 圆心（px）。
 *
 * oracle：`r2-after-fab.png` 实测主 FAB 亮簇包围盒 x872..1032 / y1808..1968
 * （160×160，`w-[14.93vw]`=161px）⇒ 圆心 (952, 1888)；推导值 (953.3, 1889.3)，
 * 差 ≤1.3px（簇心 vs 抗锯齿边缘）。推导值与 spec 原写死的 FAB_TAP(953,1889) 一致。
 */
export function fabCenterPx(contentBottomPx: number, deviceWidthPx: number): Point {
  const h = contentHeightVw(contentBottomPx, deviceWidthPx);
  const cx = 100 - FAB_GEOMETRY_VW.right - FAB_GEOMETRY_VW.size / 2;
  const cy = h - FAB_GEOMETRY_VW.right - FAB_GEOMETRY_VW.size / 2;
  return { x: vwToPx(cx, deviceWidthPx), y: vwToPx(cy, deviceWidthPx) };
}

/** 内环某项圆心（px）：`polar(angleDeg, R_INNER_VW, fabCy)`，镜像组件 `polar()`。 */
export function fabInnerItemPx(
  angleDeg: number,
  contentBottomPx: number,
  deviceWidthPx: number,
): Point {
  const center = fabCenterPx(contentBottomPx, deviceWidthPx);
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: center.x + Math.sin(rad) * vwToPx(FAB_GEOMETRY_VW.innerRadius, deviceWidthPx),
    y: center.y - Math.cos(rad) * vwToPx(FAB_GEOMETRY_VW.innerRadius, deviceWidthPx),
  };
}

/**
 * 内环「搜索」项落点（px）= `innerPair[0]`。
 *
 * 恒定 `INNER_START` 的依据（不随内环项数变化，故不需在 spec 里数项数）：
 *   - `createGlobalFab.ts:131` 的 `const items: FabInnerItem[] = [GLOBAL_SEARCH_INNER_ITEM]`
 *     以**数组字面量首元素**固定搜索项首位（激活页动作在其后 `push`）；
 *   - `GlobalFab.vue` 模板 `v-for="e in innerPair"` **不按 `visible()` 过滤**，序号即渲染序；
 *   - `spread(start, end, count)` 的第 0 项恒为 `start`（`i=0` 时分母项为 0）。
 *   ⇒ 搜索项角度恒 `INNER_START`，页面注册几个动作都只影响后续项的角度。
 *
 * oracle：`r2-after-fab.png` 实测三个内环小圆盘（10.67vw=115px）——放大镜 🔍 (903,1682)、
 * ↻ 刷新 (795,1742)、↑ 回顶 (741,1852)。/illusts 注册 refresh + backToTop ⇒ 内环共 3 项，
 * `spread(-14,-80,3)` = [-14,-47,-80]；推导 (901.0,1679.7)/(795.3,1742.0)/(740.6,1851.8)，
 * 逐点差 ≤2.3px（搜索项偏差最大，因其角度固定、而另两项角度随 count 变）⇒ 公式与实机一致。
 */
export function fabSearchItemPx(contentBottomPx: number, deviceWidthPx: number): Point {
  return fabInnerItemPx(FAB_GEOMETRY_VW.innerStartDeg, contentBottomPx, deviceWidthPx);
}

/**
 * 落点取整到整像素。
 *
 * 理由（不夸大为「adb 拒绝浮点」——实测 `input tap 953.28 1889.28` 退出码仍为 0）：
 *   ① `adb shell input tap` 的实参解析随 Android 版本而异，**整数是唯一可移植写法**；
 *   ② 环项触控目标是 115px 圆盘、FAB 是 161px 方块，亚像素毫无意义；
 *   ③ 取整后主 FAB 落点 (953.28,1889.28) → **(953, 1889)**，与本轮像素实测并
 *      验证过有效的手写常量逐位相同 ⇒ 推导与经验值自洽。
 */
export function roundPx(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

// ─── R1 断言①「未回顶」判据窗（#816 二次订正）───

/** 判据窗默认下界（= REGION_TOPREF 顶；榜单卡恒占 y≤1150 且永不滚动，低于此无判别力） */
export const NOT_TOP_WINDOW_Y0 = 1200;
/** 窗高下限：低于此高度不足以分辨「顶部」与「下滑」⇒ 判据失效 */
export const NOT_TOP_WINDOW_MIN_HEIGHT = 200;
/** 锚点行上方留白（与断言② 的 above 区同口径） */
export const ANCHOR_ROW_CLEARANCE = 80;

/**
 * 断言①判据窗 = `REGION_TOPREF` 中**锚点行以上**的部分。
 *
 * 为什么必须排除注入段：返回后锚点卡下方会插入「相关作品」段（relatedRowFor），
 * 该段把同列后续卡片整体下推约 166px——这是**产品正确行为**，却正落在原判据窗
 * （y1200..2016）内。现场实测（20:55 完整门 R1 红 9358）：差异 9095/9358 集中在
 * y1800..2016，而 y1600..1800 仅 55；纵向配准最佳对齐 dy=0 ⇒ 不是滚动位移。
 * 注入段渲染在锚点卡**下方**，故取锚点行以上即天然免疫。
 *
 * oracle（20:55 实跑证据帧逐段复算）：`tapPoint.y=1800` → 窗 y1200..1720，
 * 判别力（top↔scrolled）**105,158** = 阈值 2000 的 53 倍；纯净度（scrolled↔returned）
 * 由 9358 降到 **263**。判别力未降、污染已除。
 */
export function notTopWindow(tapY: number): Region {
  return {
    x0: 0,
    y0: NOT_TOP_WINDOW_Y0,
    x1: 1080,
    y1: Math.max(NOT_TOP_WINDOW_Y0 + 1, tapY - ANCHOR_ROW_CLEARANCE),
  };
}

/**
 * 断言① 可判定性：窗高够 + 窗内判别力够 ⇒ 才允许判红/判绿。
 *
 * 缺这一层会把「窗退化」误报成「回顶回归」——正是本轮之前反复踩的坑
 * （报错文案预设了一个未验证的机制，把人引向错误的产品改动）。
 * 判别力不足时**显式返回不可判定**，由调用方打日志并 skip。
 */
export function judgeNotTopWindow(params: {
  window: Region;
  /** 窗内 top↔scrolled 差异：真回顶时该窗会剧变，值大才说明窗有判别力 */
  power: number;
  minPower: number;
}): { verdict: "judge" | "indeterminate"; reason?: "too-short" | "no-power" } {
  const height = params.window.y1 - params.window.y0;
  if (height < NOT_TOP_WINDOW_MIN_HEIGHT) return { verdict: "indeterminate", reason: "too-short" };
  if (params.power <= params.minPower) return { verdict: "indeterminate", reason: "no-power" };
  return { verdict: "judge" };
}
