/**
 * 日期工具真值表。
 *
 * oracle 出处（期望值均为独立来源，非从实现反推）：
 * - JST = UTC+9 固定偏移（spec docs/specs/ranking.md §3.1「缺省 = 服务端当日（JST）」）；
 *   Japan 无夏令时。
 * - 日历事实：公历闰年规则（2024 闰 / 2025 平）、各月天数（4/6/9/11 月 30 天）。
 * - 展示分段 = ISO 字面量的年/月/日数字（前导零去掉，对齐既有 i18n key
 *   ranking.dateLong 的 {{year}}/{{month}}/{{day}} 插值槽）。
 */
import { describe, expect, it } from "vitest";
import { formatRankingDate, isDateString, jstToday, shiftDate } from "../src/date";

describe("jstToday", () => {
  it("以日本时区（UTC+9）当天为界", () => {
    // UTC 14:59 = JST 23:59 同日；UTC 15:00 = JST 次日 00:00
    expect(jstToday(new Date("2026-09-12T14:59:00Z"))).toBe("2026-09-12");
    expect(jstToday(new Date("2026-09-12T15:00:00Z"))).toBe("2026-09-13");
  });

  it("跨年边界", () => {
    expect(jstToday(new Date("2026-12-31T15:00:00Z"))).toBe("2027-01-01");
    expect(jstToday(new Date("2026-12-31T14:59:00Z"))).toBe("2026-12-31");
  });
});

describe("isDateString", () => {
  it("接受合法 YYYY-MM-DD（含闰日）", () => {
    expect(isDateString("2026-09-13")).toBe(true);
    expect(isDateString("2024-02-29")).toBe(true);
    expect(isDateString("2026-12-31")).toBe(true);
  });

  it("拒绝非严格 YYYY-MM-DD 形式", () => {
    for (const bad of [
      "2026-9-3",
      "2026/09/13",
      "20260913",
      "",
      "2026-09-13T00:00:00Z",
      " 2026-09-13",
      "2026-09-13 ",
    ]) {
      expect(isDateString(bad)).toBe(false);
    }
  });

  it("拒绝非字符串", () => {
    expect(isDateString(20260913)).toBe(false);
    expect(isDateString(null)).toBe(false);
    expect(isDateString(undefined)).toBe(false);
    expect(isDateString(new Date("2026-09-13"))).toBe(false);
  });

  it("世纪闰年规则（格里高利）：2000 闰 / 1900、2100 平", () => {
    expect(isDateString("2000-02-29")).toBe(true);
    expect(isDateString("1900-02-29")).toBe(false);
    expect(isDateString("2100-02-29")).toBe(false);
  });

  it("低年份按字面年处理，不被 JS 两位数年份重映射（0000 是闰年）", () => {
    expect(isDateString("0000-02-29")).toBe(true);
    expect(isDateString("0001-02-29")).toBe(false);
  });

  it("拒绝形式合法但日历不存在的日期", () => {
    // 2025 平年无 2/29；4/31、2/30 不存在；月 0/13 越界
    for (const bad of [
      "2025-02-29",
      "2026-02-30",
      "2026-04-31",
      "2026-13-01",
      "2026-00-10",
      "2026-01-00",
    ]) {
      expect(isDateString(bad)).toBe(false);
    }
  });
});

describe("shiftDate", () => {
  it("同日加减一天", () => {
    expect(shiftDate("2026-09-13", 1)).toBe("2026-09-14");
    expect(shiftDate("2026-09-13", -1)).toBe("2026-09-12");
    expect(shiftDate("2026-09-13", 0)).toBe("2026-09-13");
  });

  it("跨月", () => {
    expect(shiftDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftDate("2026-04-30", 1)).toBe("2026-05-01");
  });

  it("跨年", () => {
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("闰年：2024-02-28 +1 = 02-29，再 +1 = 03-01；平年 2025-02-28 +1 = 03-01", () => {
    expect(shiftDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(shiftDate("2024-02-29", 1)).toBe("2024-03-01");
    expect(shiftDate("2025-02-28", 1)).toBe("2025-03-01");
  });

  it("跨整年（2026 平年 365 天）", () => {
    expect(shiftDate("2026-01-01", 365)).toBe("2027-01-01");
    expect(shiftDate("2024-01-01", 366)).toBe("2025-01-01");
  });

  it("跨世纪 / 低年份不被两位数年份重映射（Date.UTC 陷阱）", () => {
    expect(shiftDate("0099-12-31", 1)).toBe("0100-01-01");
    expect(shiftDate("1899-12-31", 1)).toBe("1900-01-01");
    expect(shiftDate("1999-12-31", 1)).toBe("2000-01-01");
    expect(shiftDate("0100-01-01", -1)).toBe("0099-12-31");
  });

  it("结果超出 4 位年份范围时显式抛错（不返回非 YYYY-MM-DD）", () => {
    expect(() => shiftDate("9999-12-31", 1)).toThrow(RangeError);
    expect(() => shiftDate("0000-01-01", -1)).toThrow(RangeError);
  });

  it("Date 范围溢出（Invalid Date / NaN）也显式抛错，不返回 NaN 串", () => {
    expect(() => shiftDate("2026-01-01", 1e9)).toThrow(RangeError);
    expect(() => shiftDate("2026-01-01", -1e15)).toThrow(RangeError);
    expect(() => jstToday(new Date(8.64e15))).toThrow(RangeError);
  });

  it("非法输入显式抛错（不静默返回错误日期）", () => {
    expect(() => shiftDate("2026-02-30", 1)).toThrow(RangeError);
    expect(() => shiftDate("2026-9-3", 1)).toThrow(RangeError);
    expect(() => shiftDate("", 1)).toThrow(RangeError);
    expect(() => shiftDate("2026-09-13", 1.5)).toThrow(RangeError);
  });
});

describe("formatRankingDate", () => {
  it("拆为 {year, month, day} 展示分段（数字，无前导零）", () => {
    expect(formatRankingDate("2026-09-13")).toEqual({ year: 2026, month: 9, day: 13 });
    expect(formatRankingDate("2024-02-29")).toEqual({ year: 2024, month: 2, day: 29 });
  });

  it("不经本地时区（同一天不会因 TZ 漂移到前后一天）", () => {
    expect(formatRankingDate("2026-01-01")).toEqual({ year: 2026, month: 1, day: 1 });
    expect(formatRankingDate("2026-12-31")).toEqual({ year: 2026, month: 12, day: 31 });
  });

  it("非法输入显式抛错", () => {
    expect(() => formatRankingDate("2026-13-01")).toThrow(RangeError);
    expect(() => formatRankingDate("garbage")).toThrow(RangeError);
  });
});
