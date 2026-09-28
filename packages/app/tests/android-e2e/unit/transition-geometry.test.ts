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
  MIN_BOOKMARK_SAMPLES,
  belowAnchorRegion,
  bookmarkSampleRegion,
  detectBookmarkRow,
  judgeBookmarkRow,
  judgeContentLoaded,
  regionSamples,
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

describe("judgeContentLoaded（R2 桶数不可信）", () => {
  it("桶数过阈 → loaded（实测最终帧桶数 88 > 25）", () => {
    expect(judgeContentLoaded({ buckets: 88, minBuckets: 25, stable: false }).verdict).toBe(
      "loaded",
    );
  });

  it("桶数低但画面已稳定 → stable-but-low-buckets（放行，不误报超时）", () => {
    // 实测骨架屏逐带桶数 1..5；但单张大图铺屏时桶数天然低 → 稳定即可放行
    expect(judgeContentLoaded({ buckets: 23, minBuckets: 25, stable: true }).verdict).toBe(
      "stable-but-low-buckets",
    );
  });

  it("桶数低且仍在变化 → loading（真的没加载完，继续等）", () => {
    expect(judgeContentLoaded({ buckets: 3, minBuckets: 25, stable: false }).verdict).toBe(
      "loading",
    );
  });
});
