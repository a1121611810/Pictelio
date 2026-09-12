// @vitest-environment happy-dom
// Solid 2.0 微任务批处理：事件后 await flush() 再断言（对齐 DownloadManager/PagePickerSheet 范式）。
// 每用例至多一次 mount（cleanup 在 afterEach；同用例双 mount 会因 DOM 未卸载串查询）。
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@solidjs/testing-library";
import SearchFilterSheet from "@/components/search/SearchFilterSheet";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS, type SearchFilters } from "@pictelio/search-core";

afterEach(() => cleanup());

interface Harness {
  onChange: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
}

function mount(over: {
  filters?: SearchFilters;
  scope?: "all" | "illust" | "novel";
  sort?: "date_desc" | "date_asc" | "popular_desc";
}): Harness {
  const onChange = vi.fn();
  const onClose = vi.fn();
  render(() => (
    <SearchFilterSheet
      isOpen={true}
      onClose={onClose}
      filters={() => over.filters ?? DEFAULT_SEARCH_FILTERS}
      scope={() => over.scope ?? "all"}
      sort={() => over.sort ?? "date_desc"}
      onChange={onChange}
    />
  ));
  return { onChange, onClose };
}

function group(name: string) {
  return within(screen.getByRole("group", { name }));
}

async function setInput(label: string, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
  await Promise.resolve(); // Solid 2.0 微任务批处理：事件后 flush 再断言
}

describe("SearchFilterSheet", () => {
  it("默认态：五个维度分组可见，无「清除全部」", () => {
    mount({});
    for (const name of ["投稿期间", "收藏数", "比例", "分辨率", "AI 作品"]) {
      expect(screen.getByRole("group", { name })).toBeTruthy();
    }
    expect(screen.queryByRole("button", { name: "清除全部筛选" })).toBeNull();
  });

  it("期间：点预设上报 preset", async () => {
    const h = mount({});
    group("投稿期间").getByRole("button", { name: "一周内" }).click();
    await Promise.resolve();
    expect(h.onChange.mock.calls[0]![0].period).toEqual({ kind: "preset", preset: "1w" });
  });

  it("期间：再点已选回「不限」（逐维可清，#476 Q6）", async () => {
    const h = mount({
      filters: { ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1w" } },
    });
    group("投稿期间").getByRole("button", { name: "一周内" }).click();
    await Promise.resolve();
    expect(h.onChange.mock.calls[0]![0].period).toEqual({ kind: "any" });
  });

  it("自定义日期：双字段齐且有序才上报 custom（生效时机 spec Q3）", async () => {
    const h = mount({});
    await setInput("开始日期", "2026-08-01");
    await setInput("结束日期", "2026-08-15");
    const last = h.onChange.mock.calls.at(-1)![0] as SearchFilters;
    expect(last.period).toEqual({ kind: "custom", start: "2026-08-01", end: "2026-08-15" });
  });

  it("自定义日期：乱序不上报（半途状态不生效）", async () => {
    const h = mount({});
    await setInput("开始日期", "2026-08-15");
    await setInput("结束日期", "2026-08-01");
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it("收藏数：点档位上报带宽（七档 oracle=官方 bookmark_ranges）", async () => {
    const h = mount({});
    group("收藏数").getByRole("button", { name: "300-499" }).click();
    await Promise.resolve();
    expect(h.onChange.mock.calls[0]![0].bookmark).toEqual({ min: 300, max: 499 });
  });

  it("收藏数：再点已选回不限（逐维可清）", async () => {
    const h = mount({
      filters: { ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[0]! },
    });
    group("收藏数").getByRole("button", { name: "10-29" }).click();
    await Promise.resolve();
    expect(h.onChange.mock.calls[0]![0].bookmark).toBeNull();
  });

  it("scope=novel：比例/分辨率置灰（值保留），标注可见", () => {
    mount({
      filters: { ...DEFAULT_SEARCH_FILTERS, ratio: "landscape" },
      scope: "novel",
    });
    expect(
      (group("比例").getByRole("button", { name: "横图" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (group("分辨率").getByRole("button", { name: "≥1000px" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("切到「插画」范围后可用（已设的值会保留）")).toBeTruthy();
  });

  it("scope=all：比例/分辨率可用", () => {
    mount({ scope: "all" });
    expect(
      (group("比例").getByRole("button", { name: "横图" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it("热门排序：收藏数整组置灰 + 标注（#478）", () => {
    mount({ sort: "popular_desc" });
    expect(
      (group("收藏数").getByRole("button", { name: "不限" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (group("收藏数").getByRole("button", { name: "100-299" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByText("热门榜不支持按收藏数筛（切回最新/最早恢复）")).toBeTruthy();
  });

  it("AI 覆盖三档：点选上报 override（#479，无仅看档）", async () => {
    const h = mount({});
    group("AI 作品").getByRole("button", { name: "隐藏 AI" }).click();
    await Promise.resolve();
    expect(h.onChange.mock.calls[0]![0].aiOverride).toBe("hide");
    group("AI 作品").getByRole("button", { name: "全部显示" }).click();
    await Promise.resolve();
    expect(h.onChange.mock.calls[1]![0].aiOverride).toBe("all");
    expect(screen.queryByRole("button", { name: "仅看 AI" })).toBeNull();
  });

  it("激活态出现「清除全部」，点击重置为默认", () => {
    const h = mount({
      filters: { ...DEFAULT_SEARCH_FILTERS, period: { kind: "preset", preset: "1w" } },
    });
    screen.getByRole("button", { name: "清除全部筛选" }).click();
    expect(h.onChange).toHaveBeenCalledWith(DEFAULT_SEARCH_FILTERS);
  });
});
