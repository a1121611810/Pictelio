// @vitest-environment happy-dom
/**
 * RankingControls 契约（spec docs/specs/ranking.md §5.3；#515）。
 * oracle：spec「7 档 chips 可切换」「今日后一天禁用」「日期文本手写不依赖 Intl」
 * 「日历用原生日期输入」。维度 chips 为过滤 chip（aria-pressed），非导航 tab。
 * i18n 用源语言（zh-CN，测试 setup 钉源）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import RankingControls from "@/components/ranking/RankingControls";

const noop = () => {};

/** 维度 chips = 带 aria-pressed 的按钮（排除位置导航按钮） */
const modeChips = () =>
  screen.getAllByRole("button").filter((b) => b.getAttribute("aria-pressed") !== null);

describe("RankingControls", () => {
  afterEach(() => cleanup());

  it("渲染 7 档维度 chips（日/周/月/新人/原创/R-18/R-18G）", () => {
    render(() => (
      <RankingControls
        mode="daily"
        date={null}
        onSelectMode={noop}
        onShiftDay={noop}
        onPickDate={noop}
      />
    ));
    const chips = modeChips();
    expect(chips).toHaveLength(7);
    expect(chips.map((c) => c.textContent)).toEqual([
      "日榜",
      "周榜",
      "月榜",
      "新人",
      "原创",
      "R-18",
      "R-18G",
    ]);
  });

  it("点击 chip 回调 onSelectMode(id)；选中态 aria-pressed", () => {
    const onSelectMode = vi.fn();
    render(() => (
      <RankingControls
        mode="daily"
        date={null}
        onSelectMode={onSelectMode}
        onShiftDay={noop}
        onPickDate={noop}
      />
    ));
    const chips = modeChips();
    expect(chips[0]!.getAttribute("aria-pressed")).toBe("true");
    expect(chips[1]!.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(chips[2]!);
    expect(onSelectMode).toHaveBeenCalledWith("monthly");
  });

  it("今日：后一天禁用、前一天可用，且显示「今日」标记", () => {
    render(() => (
      <RankingControls
        mode="daily"
        date={null}
        onSelectMode={noop}
        onShiftDay={noop}
        onPickDate={noop}
      />
    ));
    expect((screen.getByLabelText("后一天") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("前一天") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByText("今日")).toBeTruthy();
  });

  it("非今日：后一天可用，‹/› 回调 -1/+1", () => {
    const onShiftDay = vi.fn();
    render(() => (
      <RankingControls
        mode="daily"
        date="2026-09-01"
        onSelectMode={noop}
        onShiftDay={onShiftDay}
        onPickDate={noop}
      />
    ));
    const next = screen.getByLabelText("后一天") as HTMLButtonElement;
    expect(next.disabled).toBe(false);
    fireEvent.click(next);
    expect(onShiftDay).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByLabelText("前一天"));
    expect(onShiftDay).toHaveBeenCalledWith(-1);
  });

  it("日期文本手写格式化（不依赖 Intl）：2026-09-01 → 2026年9月1日", () => {
    render(() => (
      <RankingControls
        mode="daily"
        date="2026-09-01"
        onSelectMode={noop}
        onShiftDay={noop}
        onPickDate={noop}
      />
    ));
    expect(screen.getByText("2026年9月1日")).toBeTruthy();
  });

  it("日历为原生日期输入：value=当前日期、max=今日，输入触发 onPickDate", () => {
    const onPickDate = vi.fn();
    render(() => (
      <RankingControls
        mode="daily"
        date="2026-09-01"
        onSelectMode={noop}
        onShiftDay={noop}
        onPickDate={onPickDate}
      />
    ));
    const input = screen.getByLabelText("选择日期") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("2026-09-01");
    fireEvent.input(input, { target: { value: "2026-08-15" } });
    expect(onPickDate).toHaveBeenCalledWith("2026-08-15");
  });
});
