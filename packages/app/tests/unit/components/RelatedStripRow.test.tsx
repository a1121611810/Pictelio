// @vitest-environment happy-dom
/**
 * RelatedStripRow — 相关作品注入行组件契约测试（spec docs/specs/related-injection.md §4.3/§6）。
 * Oracle 溯源：交互语义来自 spec §4（缩略图点击 onNavigate / 收起 onDismiss / loading 占位）；
 * mock 字段结构对齐 api/types.ts 的 PixivIllust 契约。
 */
import { describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import type { PixivIllust } from "@/api/types";
import RelatedStripRow from "@/components/home/RelatedStripRow";
import type { RelatedRow } from "@/stores/relatedInjectionStore";

function makeIllust(id: number): PixivIllust {
  return {
    id,
    title: `相关作品${id}`,
    type: "illust",
    user: { id: 100, name: "作者", account: "author", profile_image_urls: {} },
    image_urls: { square_medium: `https://example.test/sq-${id}.jpg`, medium: "", large: "" },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 0,
    tags: [],
    x_restrict: 0,
    create_date: "2026-09-01T00:00:00+09:00",
    meta_pages: [],
  } as unknown as PixivIllust;
}

describe("RelatedStripRow", () => {
  it("渲染标题与缩略图，缩略图点击触发 onNavigate", async () => {
    const onNavigate = vi.fn();
    const row: RelatedRow = {
      anchorId: 1,
      items: [makeIllust(11), makeIllust(12)],
      loading: false,
    };
    render(() => <RelatedStripRow row={row} onNavigate={onNavigate} onDismiss={() => {}} />);
    expect(screen.getByText("相关作品")).toBeTruthy();
    const thumbs = await screen.findAllByRole("listitem");
    expect(thumbs).toHaveLength(2);
    fireEvent.click(thumbs[0]);
    expect(onNavigate).toHaveBeenCalledWith(11);
    cleanup();
  });

  it("收起按钮触发 onDismiss", () => {
    const onDismiss = vi.fn();
    const row: RelatedRow = { anchorId: 1, items: [makeIllust(11)], loading: false };
    render(() => <RelatedStripRow row={row} onNavigate={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByLabelText("收起相关作品"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("loading 态渲染占位且不渲染缩略图列表", () => {
    const row: RelatedRow = { anchorId: 1, items: [], loading: true };
    render(() => <RelatedStripRow row={row} onNavigate={() => {}} onDismiss={() => {}} />);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    cleanup();
  });
});
