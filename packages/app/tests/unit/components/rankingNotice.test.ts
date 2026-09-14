// R-18 指引显隐判定（spec docs/specs/ranking.md §5.7）。
// oracle：spec §5.7「R-18/R-18G 档**服务端返回空或报错** → 可操作指引，不静默降级为空态」。
// 关键：判定依据是**服务端返回条目数（过滤前）**，不是客户端过滤后的可见数。
import { describe, expect, it } from "vitest";
import { isR18Mode, shouldShowR18Notice } from "@/components/ranking/rankingNotice";

const input = (over: Partial<Parameters<typeof shouldShowR18Notice>[0]> = {}) => ({
  mode: "r18" as const,
  hasError: false,
  paginationError: false,
  serverCount: 0,
  loading: false,
  ...over,
});

describe("shouldShowR18Notice", () => {
  it("非 R-18 档永不显示", () => {
    expect(shouldShowR18Notice(input({ mode: "daily" }))).toBe(false);
    expect(shouldShowR18Notice(input({ mode: "weekly", hasError: true }))).toBe(false);
  });

  it("R-18/R-18G 档服务端返回空且已落定 → 显示", () => {
    expect(shouldShowR18Notice(input({ mode: "r18" }))).toBe(true);
    expect(shouldShowR18Notice(input({ mode: "r18g" }))).toBe(true);
  });

  it("加载中不显示（骨架优先）", () => {
    expect(shouldShowR18Notice(input({ loading: true }))).toBe(false);
  });

  it("服务端有数据但被客户端过滤光 → 不显示（避免指向错误的 pixiv 设置）", () => {
    expect(shouldShowR18Notice(input({ serverCount: 30 }))).toBe(false);
  });

  it("首载报错且服务端无数据 → 显示", () => {
    expect(shouldShowR18Notice(input({ hasError: true }))).toBe(true);
  });

  it("报错但已有服务端数据 → 不显示（不覆盖已渲染列表）", () => {
    expect(shouldShowR18Notice(input({ hasError: true, serverCount: 30 }))).toBe(false);
  });

  it("分页失败但已有数据 → 不显示（底部内联重试承担）", () => {
    expect(
      shouldShowR18Notice(input({ hasError: true, paginationError: true, serverCount: 5 })),
    ).toBe(false);
  });

  it("isR18Mode 由核心目录派生（r18/r18g）", () => {
    expect(isR18Mode("r18")).toBe(true);
    expect(isR18Mode("r18g")).toBe(true);
    expect(isR18Mode("daily")).toBe(false);
    expect(isR18Mode("rookie")).toBe(false);
  });
});
