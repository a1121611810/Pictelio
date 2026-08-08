// @vitest-environment happy-dom
/**
 * HistoryRowCard — 历史条目 A2 行卡契约测试（ticket #179，spec: docs/spec-home-c-shell-l5.md）。
 *
 * props 驱动纯渲染，不依赖 store。mock 真实字段结构的 HistoryEntry（见 src/stores/historyStore.ts），
 * 覆盖 xRestrict 0/1/2 三种分级。删除按钮 stopPropagation 契约：
 * click 删除按钮 → 仅触发 onDelete，onOpen 不被调用。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { HistoryEntry } from "@/stores/historyStore";
import HistoryRowCard from "@/components/home/HistoryRowCard";

function makeEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    key: "100_illust_303",
    userId: "100",
    authorId: 100,
    type: "illust",
    id: 303,
    title: "历史条目标题",
    userName: "历史作者",
    thumbnailUrl:
      "https://i.pximg.net/c/250x250_80/img-master/img/2026/06/30/13/50/51/303_p0_square1200.jpg",
    xRestrict: 0,
    // 本地时区 09:05，组件用同构造逻辑取 HH:mm，避免时区差异
    visitedAt: new Date(2026, 0, 15, 9, 5).getTime(),
    visitCount: 3,
    ...overrides,
  };
}

describe("HistoryRowCard", () => {
  afterEach(() => cleanup());

  it("渲染标题、作者·时间·次数（xRestrict 0 无模糊无徽标）", () => {
    render(() => <HistoryRowCard entry={makeEntry()} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("历史条目标题")).toBeTruthy();
    expect(screen.getByText("历史作者 · 09:05 · 3次")).toBeTruthy();
    const img = screen.getByAltText("历史条目标题") as HTMLImageElement;
    expect(img.classList.contains("blur-[8px]")).toBe(false);
    expect(screen.queryByText("R-18")).toBeNull();
    expect(screen.queryByText("R18G")).toBeNull();
  });

  it("xRestrict 1（R-18）时缩略图带 blur 类并显示 R-18 徽标", () => {
    render(() => (
      <HistoryRowCard entry={makeEntry({ xRestrict: 1 })} onOpen={vi.fn()} onDelete={vi.fn()} />
    ));
    const img = screen.getByAltText("历史条目标题") as HTMLImageElement;
    expect(img.classList.contains("blur-[8px]")).toBe(true);
    expect(screen.getByText("R-18")).toBeTruthy();
    expect(screen.queryByText("R18G")).toBeNull();
  });

  it("xRestrict 2（R18G）时缩略图带 blur 类并显示 R18G 徽标", () => {
    render(() => (
      <HistoryRowCard entry={makeEntry({ xRestrict: 2 })} onOpen={vi.fn()} onDelete={vi.fn()} />
    ));
    const img = screen.getByAltText("历史条目标题") as HTMLImageElement;
    expect(img.classList.contains("blur-[8px]")).toBe(true);
    expect(screen.getByText("R18G")).toBeTruthy();
    expect(screen.queryByText("R-18")).toBeNull();
  });

  it("点击行触发 onOpen", () => {
    const onOpen = vi.fn();
    const { container } = render(() => (
      <HistoryRowCard entry={makeEntry()} onOpen={onOpen} onDelete={vi.fn()} />
    ));
    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("点击删除按钮触发 onDelete 且不触发 onOpen（stopPropagation）", () => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(() => <HistoryRowCard entry={makeEntry()} onOpen={onOpen} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "删除 历史条目标题" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
