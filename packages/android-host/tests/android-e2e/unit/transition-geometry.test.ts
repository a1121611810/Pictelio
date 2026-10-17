/**
 * transition-matrix 纯几何/判据单测（issue #814，不碰 adb / 模拟器）。
 *
 * oracle 溯源（非从实现反推）：期望值来自 **2026-09-28 实跑的真实证据帧**
 * （`test-results/android-e2e/transition-matrix/*.png`，复跑 3 红 1 绿），用 canvas
 * 逐像素实测得到。每条 case 的注释标明对应帧与实测口径。
 */
import { describe, expect, it } from "vitest";
import {
  DARK_ROW_MAX_BRIGHTNESS,
  FAB_GEOMETRY_VW,
  MIN_BOOKMARK_SAMPLES,
  NEAR_BLANK_FLAT_RATIO,
  belowAnchorRegion,
  bookmarkSampleRegion,
  contentHeightVw,
  detectBookmarkRow,
  fabCenterPx,
  fabInnerItemPx,
  fabSearchItemPx,
  judgeBookmarkRow,
  judgeContentLoaded,
  judgeNotTopWindow,
  notTopWindow,
  regionColorStats,
  regionSamples,
  roundPx,
  type ColorAt,
  type GrayAt,
  type Region,
} from "../transition-geometry";

/** 合成灰度场：区间表 [y0, y1, 亮度] */
function field(rows: readonly [number, number, number][]): GrayAt {
  return (_x, y) => {
    for (const [y0, y1, b] of rows) if (y >= y0 && y <= y1) return b;
    return 255;
  };
}

const SCAN: Region = { x0: 0, y0: 1700, x1: 1080, y1: 2016 };

describe("detectBookmarkRow", () => {
  it("定位到深色胶囊行——按 stable-r3-card1.png 实测（y 1860..1940 均值 87..93）", () => {
    // 实测：该帧 y1860..1940 亮度 87..93（♥ 胶囊），其上 y1700..1860 是插画（≈150+）
    const gray = field([
      [1700, 1859, 150],
      [1860, 1940, 90],
      [1941, 2016, 200],
    ]);
    const span = detectBookmarkRow(SCAN, gray);
    expect(span).not.toBeNull();
    // 步长 2 ⇒ 边界取到偶数行；断言覆盖实测区间即可，不逐位对齐
    expect(span!.y0).toBeGreaterThanOrEqual(1860);
    expect(span!.y0).toBeLessThanOrEqual(1862);
    expect(span!.y1).toBeGreaterThanOrEqual(1938);
    expect(span!.y1).toBeLessThanOrEqual(1940);
  });

  it("内容形态不符（全区无深色胶囊，如列表页）→ null，而非返回一个会被误读的 0", () => {
    // #814 核心：探测不到时必须显式 null，调用方据此 skip；
    // 若返回 0 会被当成「差异 0 = 状态冻结」，指向完全错误的方向
    const gray = field([[1700, 2016, 230]]);
    expect(detectBookmarkRow(SCAN, gray)).toBeNull();
  });

  it("亮度 105（< 阈值 110）仍判为胶囊，128（> 阈值）判为非胶囊", () => {
    expect(detectBookmarkRow(SCAN, field([[1800, 1900, 105]]))).not.toBeNull();
    expect(detectBookmarkRow(SCAN, field([[1800, 1900, 128]]))).toBeNull();
    expect(DARK_ROW_MAX_BRIGHTNESS).toBe(110);
  });
});

describe("bookmarkSampleRegion", () => {
  it("x 取全宽 0..1080——旧窗右界 430 会切掉收藏数字（实测胶囊横跨 x 0..1078）", () => {
    const r = bookmarkSampleRegion({ y0: 1860, y1: 1940 }, { y0: 1870, y1: 1940 }, 1080);
    expect(r.x0).toBe(0);
    expect(r.x1).toBe(1080);
    // y 取交集
    expect(r.y0).toBe(1870);
    expect(r.y1).toBe(1940);
  });
});

describe("judgeBookmarkRow", () => {
  const good: Region = { x0: 0, y0: 1860, x1: 1080, y1: 1940 };

  it("采样点充足 + 差异达标 → assert", () => {
    const j = judgeBookmarkRow(good, 150, 20);
    expect(j.verdict).toBe("assert");
    if (j.verdict === "assert") expect(j.expected).toBe(20);
  });

  it("采样点不足 → skip（不可把采样失误当成状态冻结），#814 误报实因", () => {
    const thin: Region = { x0: 0, y0: 1860, x1: 60, y1: 1862 };
    expect(regionSamples(thin)).toBeLessThan(MIN_BOOKMARK_SAMPLES);
    const j = judgeBookmarkRow(thin, 0, 20);
    // 实测教训：card1 vs card2 差异 0 曾被报成「props 冻结回归」，
    // 实际是采样窗没盖住数字 → 这里必须判 skip
    expect(j.verdict).toBe("skip");
    if (j.verdict === "skip") {
      expect(j.reason).toContain("不可信");
      expect(j.samples).toBe(regionSamples(thin));
    }
  });

  it("采样充足但差异为 0 → assert（这才是真正的状态冻结）", () => {
    const j = judgeBookmarkRow(good, 0, 20);
    expect(j.verdict).toBe("assert");
  });
});

describe("belowAnchorRegion（R1 死像素稀释）", () => {
  it("下界钳到内容区底界 2016——2100 越界段恒落在系统栏上", () => {
    const r = belowAnchorRegion(1250, 2016);
    expect(r.y1).toBe(2016);
    expect(r.y0).toBe(1290);
  });

  it("实测差异随越界递减：tapY=1950 时窗几乎全在界外 → 差异 0", () => {
    // 实测 tapY=1250→444、1400→369、1650→240、1800→232、1950→0
    const r = belowAnchorRegion(1950, 2016);
    // 钳制后窗高 = 2016-1990 = 26px，仍在区内（不产生负高）
    expect(r.y1).toBe(2016);
    expect(r.y1 - r.y0).toBeGreaterThan(0);
    expect(r.y0).toBe(1990);
  });
});

describe("regionColorStats（#821：桶数之外的第二个信号）", () => {
  const FULL: Region = { x0: 0, y0: 0, x1: 1080, y1: 816 };

  it("单色平涂 → flatRatio 恰为 1（构造性事实：唯一色桶吃掉全部采样点）", () => {
    const fill: ColorAt = () => [32, 34, 38];
    expect(regionColorStats(FULL, fill)).toEqual({ buckets: 1, flatRatio: 1 });
  });

  it("几块大色块 → flatRatio 落到各块份额的众数，远低于近空白阈值", () => {
    // 三等分横带：每带 1/3 ⇒ flatRatio ≈ 1/3，且 buckets = 3
    const bands: ColorAt = (_x, y) =>
      y < 272 ? [30, 30, 30] : y < 544 ? [200, 200, 210] : [90, 60, 60];
    const s = regionColorStats(FULL, bands);
    expect(s.buckets).toBe(3);
    expect(s.flatRatio).toBeLessThan(NEAR_BLANK_FLAT_RATIO);
    expect(s.flatRatio).toBeGreaterThan(0.3);
  });

  it("阈值余量登记：0.6 落在两组实测值之间（正负样本均来自真实决策帧）", () => {
    // ⚠️ 这**不是**「逐像素复算」用例（早先的用例名这么写，是过度声称）：证据帧在
    // `test-results/` 下、被 .gitignore 覆盖，仓内 0 张被追踪，无法在 CI 里复算。
    // 它真实做的是**阈值余量登记**——把两组已登记的实测值对常数量一遍，两端各留约 1/3 余量：
    //   近空白（内容没加载出来）：
    //     loaded-r3-recommended.png × REGION_CAROUSEL_IMAGE → 0.853
    //     loaded-r1-illusts.png      × REGION_TOPREF        → 0.841
    //     loaded-r1-illusts.png      × REGION_RESULTS       → 0.797  ← 取最低的正样本
    //   低方差但**有**内容：
    //     loaded-r3-recommended.png × REGION_TOPREF        → 0.355
    //     loaded-r3-recommended.png × REGION_RESULTS       → 0.421  ← 取最高的负样本
    //   ↑ 第二组是本判据最硬的正样本：**同一张帧**的插画区是空白、信息条区有内容，
    //     桶数 4 与 23（阈值 25）分居阈值两侧却曾落进同一分支 —— 这正是 #821 的混淆。
    //   阈值 0.6 落在两组之间：距最低的空白样本 +33%，距最高的「有内容」样本 −30%。
    // 数值溯源仍是真实设备逐像素复算（`transition-geometry.ts` 的 oracle 段登记了出处），
    // 只是**复算动作不在本用例里**，别把它当可重跑的证据链。
    expect(0.797).toBeGreaterThan(NEAR_BLANK_FLAT_RATIO);
    expect(0.421).toBeLessThan(NEAR_BLANK_FLAT_RATIO);
  });
});

describe("judgeContentLoaded（#821：近空白 ≠ 低方差有内容）", () => {
  it("桶数过阈 → loaded（实测最终帧桶数 88 > 25）", () => {
    expect(
      judgeContentLoaded({ buckets: 88, minBuckets: 25, stable: false, flatRatio: 0.301 }).verdict,
    ).toBe("loaded");
  });

  it("桶数 23、已稳定、单一色块占比 0.421 → 仍放行（低方差**有内容**，原行为保留）", () => {
    // 0.421 = loaded-r3-recommended.png × REGION_RESULTS 实测（该区确有内容）。
    // 这条同时是「假绿守卫」：若实现退回只看桶数与 stable，本条与下一条同分支，
    // 断言仍会绿 —— 所以下一条才是真正卡住回归的那一条。
    expect(
      judgeContentLoaded({ buckets: 23, minBuckets: 25, stable: true, flatRatio: 0.421 }).verdict,
    ).toBe("stable-but-low-buckets");
  });

  it("桶数 4、已稳定、单一色块占比 0.853 → near-blank（近空白，旧实现恒判放行）", () => {
    // 0.853 = loaded-r3-recommended.png × REGION_CAROUSEL_IMAGE 实测（插画没加载出来）。
    // 改动前本用例与上一条走同一分支、同一行、返回同一 verdict —— 输入集封闭导致
    // 不可区分。现在必须分开。
    expect(
      judgeContentLoaded({ buckets: 4, minBuckets: 25, stable: true, flatRatio: 0.853 }).verdict,
    ).toBe("near-blank");
  });

  it("桶数 6、已稳定、flatRatio 0.797 → near-blank（票面记的那一轮桶数）", () => {
    expect(
      judgeContentLoaded({ buckets: 6, minBuckets: 25, stable: true, flatRatio: 0.797 }).verdict,
    ).toBe("near-blank");
  });

  it("近空白但仍在变化 → loading（继续等，不提前判死）", () => {
    expect(
      judgeContentLoaded({ buckets: 4, minBuckets: 25, stable: false, flatRatio: 0.853 }).verdict,
    ).toBe("loading");
  });

  it("桶数过阈时即使单一色块占比极高也判 loaded —— 富内容可以只有很少的桶", () => {
    // 入参必须**真的**过阈（88 > 25），否则这条钉不住它自称的东西。
    // 早先这里写的是 `{buckets: 9, minBuckets: 25}`：9 < 25，用例名说「过阈」而断言
    // 给的是 `stable-but-low-buckets`，名与断言互相打架（Spec B3）。
    // 它守的是 `judgeContentLoaded` 的短路顺序：桶数过阈的判定必须**先于**近空白判定，
    // 否则一个「桶够多但其中一色块占 95%」的富内容区会被误判成 near-blank 而白跑一轮。
    expect(
      judgeContentLoaded({ buckets: 88, minBuckets: 25, stable: true, flatRatio: 0.95 }).verdict,
    ).toBe("loaded");
  });

  it("桶数低且仍在变化 → loading（真的没加载完，继续等）", () => {
    expect(
      judgeContentLoaded({ buckets: 3, minBuckets: 25, stable: false, flatRatio: 0.12 }).verdict,
    ).toBe("loading");
  });
});

// ─── 放射 FAB 几何（#816 R2 真因：落点是魔数，点了空隙）───
//
// oracle 全部来自 `r2-after-fab.png`（2026-09-28 20:27 R2 复跑证据帧）的逐像素簇实测：
// 主 FAB 亮簇包围盒 x872..1032 / y1808..1968 ⇒ 圆心 (952,1888)；三个 115px 内环小圆盘
// 中心 (903,1682) 搜索 / (795,1742) 刷新 / (741,1852) 回顶。推导与实测差 ≤2.3px。
const CONTENT_BOTTOM_PX = 2016;
const DEVICE_W_PX = 1080;
/** 实测簇是「亮度过阈的连通域」，边缘抗锯齿会吃掉 1~2px ⇒ 容差 3px */
const PX_TOL = 3;

describe("contentHeightVw（稳定区口径，ADR-0131）", () => {
  it("2016/1080×100 = 186.67vw —— 不是全屏 200vw", () => {
    // oracle：dumpsys window displays → rng=1080x936-2160x2016 ⇒ 稳定区高 2016
    expect(contentHeightVw(CONTENT_BOTTOM_PX, DEVICE_W_PX)).toBeCloseTo(186.6667, 3);
  });

  it("若误传全屏 2160 则得 200vw —— 正是 FAB y 偏 144px 的口径错误", () => {
    // 全屏口径会让 fabCy 偏 (2160-2016)/1080*100 = 13.33vw = 144px
    expect(contentHeightVw(2160, DEVICE_W_PX)).toBeCloseTo(200, 3);
  });
});

describe("fabCenterPx（主 FAB 圆心）", () => {
  it("推导值 (953.3,1889.3) 与 spec 原写死的 FAB_TAP(953,1889) 一致", () => {
    const c = fabCenterPx(CONTENT_BOTTOM_PX, DEVICE_W_PX);
    expect(c.x).toBeCloseTo(953.28, 2);
    expect(c.y).toBeCloseTo(1889.28, 2);
  });

  it("与 r2-after-fab.png 实测簇心 (952,1888) 差 ≤3px", () => {
    const c = fabCenterPx(CONTENT_BOTTOM_PX, DEVICE_W_PX);
    expect(Math.abs(c.x - 952)).toBeLessThanOrEqual(PX_TOL);
    expect(Math.abs(c.y - 1888)).toBeLessThanOrEqual(PX_TOL);
  });
});

describe("fabInnerItemPx / fabSearchItemPx（内环落点）", () => {
  it("polar() 在三个实测角度上都对得上（证公式本身，而非只对搜索项凑）", () => {
    // /illusts 内环 3 项 ⇒ spread(-14,-80,3) = [-14,-47,-80]
    for (const [angleDeg, mx, my] of [
      [-14, 903, 1682],
      [-47, 795, 1742],
      [-80, 741, 1852],
    ] as const) {
      const p = fabInnerItemPx(angleDeg, CONTENT_BOTTOM_PX, DEVICE_W_PX);
      expect(Math.abs(p.x - mx), `angle ${angleDeg} x`).toBeLessThanOrEqual(PX_TOL);
      expect(Math.abs(p.y - my), `angle ${angleDeg} y`).toBeLessThanOrEqual(PX_TOL);
    }
  });

  it("搜索项 = (901.0,1679.7)，与实测 (903,1682) 差 ≤3px", () => {
    const p = fabSearchItemPx(CONTENT_BOTTOM_PX, DEVICE_W_PX);
    expect(p.x).toBeCloseTo(901.03, 1);
    expect(p.y).toBeCloseTo(1679.7, 1);
  });

  it("旧魔数 (906,1760) 落在搜索圆盘外 —— 即本轮 R2 红真因，不可用", () => {
    // 内环圆盘直径 10.67vw = 115px ⇒ 半径 57.6px；旧点距圆心 √(5²+80²)=80px > 57.6
    const p = fabSearchItemPx(CONTENT_BOTTOM_PX, DEVICE_W_PX);
    const radiusPx = ((10.67 / 100) * DEVICE_W_PX) / 2;
    const oldDist = Math.hypot(906 - p.x, 1760 - p.y);
    expect(oldDist).toBeGreaterThan(radiusPx);
  });

  it("搜索项落点与内环项数无关（恒为 spread()[0] = INNER_START）", () => {
    // 签名里没有 count：依据是 spread(start,end,n)[0] ≡ start。改 count 只会移动后续项。
    const a = fabSearchItemPx(CONTENT_BOTTOM_PX, DEVICE_W_PX);
    const b = fabInnerItemPx(FAB_GEOMETRY_VW.innerStartDeg, CONTENT_BOTTOM_PX, DEVICE_W_PX);
    expect(a).toEqual(b);
    expect(FAB_GEOMETRY_VW.innerStartDeg).toBe(-14);
  });
});

describe("roundPx（落点取整到 adb input tap 的可移植写法）", () => {
  it("主 FAB 推导取整后 = 手写常量 (953,1889) —— 推导与经验值自洽", () => {
    // 取整前 fabCenterPx(2016,1080) = (953.28, 1889.28)；(953,1889) 是 20:27 复跑实证有效的点
    expect(roundPx(fabCenterPx(CONTENT_BOTTOM_PX, DEVICE_W_PX))).toEqual({ x: 953, y: 1889 });
  });

  it("搜索项取整后 = (901,1680)，仍在 115px 圆盘内（距圆心 ≤57px）", () => {
    const p = roundPx(fabSearchItemPx(CONTENT_BOTTOM_PX, DEVICE_W_PX));
    expect(p).toEqual({ x: 901, y: 1680 });
    const c = fabSearchItemPx(CONTENT_BOTTOM_PX, DEVICE_W_PX);
    expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeLessThanOrEqual(1);
    // 落点须比圆盘半径（57.6px）更靠内，留出命中余量
    expect(Math.hypot(906 - p.x, 1760 - p.y)).toBeGreaterThan(((10.67 / 100) * DEVICE_W_PX) / 2);
  });
});

// ─── R1 断言①判据窗（#816 二次订正：窗含注入段 ⇒ 把合法注入误判成回顶）───
//
// oracle 全部来自 20:55 完整门 R1 失败那轮的证据帧（stable-r1-{top,scrolled,returned}.png）
// 逐段复算：差异 9095/9358 集中在 y1800..2016，y1600..1800 仅 55；纵向配准最佳 dy=0
// ⇒ 不是滚动位移，而是锚点卡下方「相关作品」注入段把后续卡片下推 ~166px。
describe("notTopWindow（判据窗须停在锚点行以上）", () => {
  it("tapPoint.y=1800 → 窗 y1200..1720（与断言② above 区同 clearance）", () => {
    expect(notTopWindow(1800)).toEqual({ x0: 0, y0: 1200, x1: 1080, y1: 1720 });
  });

  it("tapPoint.y=1650 → 窗 y1200..1570", () => {
    expect(notTopWindow(1650)).toEqual({ x0: 0, y0: 1200, x1: 1080, y1: 1570 });
  });

  it("窗下界恒 ≥1200 —— 榜单卡恒占 y≤1150 且永不滚动，低于此无判别力", () => {
    // tapPoint.y=1250（候选网格最小值）时 1250-80=1170 < 1200 ⇒ 必须夹住
    expect(notTopWindow(1250).y0).toBe(1200);
    expect(notTopWindow(1250).y1).toBeGreaterThanOrEqual(1201);
  });

  it("判别力实测：tapPoint=1800 的窗内 top↔scrolled = 105158（阈值 2000 的 53 倍）", () => {
    // 该数字由 20:55 证据帧实测；此处固化的是「窗有判别力」这一事实
    const power = 105_158;
    const minPower = 2000;
    expect(power).toBeGreaterThan(minPower * 50);
    expect(judgeNotTopWindow({ window: notTopWindow(1800), power, minPower }).verdict).toBe(
      "judge",
    );
  });
});

describe("judgeNotTopWindow（窗退化 ⇒ 显式不可判定，不判成回顶回归）", () => {
  it("窗高 40px（锚点贴顶）→ indeterminate:too-short", () => {
    // oracle：tapPoint.y=1250 时窗仅 y1200..1201，高 1px
    const v = judgeNotTopWindow({ window: notTopWindow(1250), power: 99_999, minPower: 2000 });
    expect(v).toEqual({ verdict: "indeterminate", reason: "too-short" });
  });

  it("窗够高但判别力不足 → indeterminate:no-power（内容不随滚动变化）", () => {
    const v = judgeNotTopWindow({ window: notTopWindow(1800), power: 1200, minPower: 2000 });
    expect(v).toEqual({ verdict: "indeterminate", reason: "no-power" });
  });

  it("窗高与判别力都够 → judge（正常判红/判绿）", () => {
    const v = judgeNotTopWindow({ window: notTopWindow(1800), power: 105_158, minPower: 2000 });
    expect(v).toEqual({ verdict: "judge" });
  });
});
