// @vitest-environment happy-dom
/**
 * BottomActionBar 保存入口契约（spec docs/specs/image-save-download.md §5/§6）。
 * oracle：onSave 提供时显示「保存」按钮、ugoira 场景（onSave 缺省）不显示；
 * saving 时禁用并显示「保存中…」；点击回调 onComments/onSave 各自触发。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import BottomActionBar from "@/components/illust/BottomActionBar";

function renderBar(overrides: Partial<Parameters<typeof BottomActionBar>[0]> = {}) {
  const onSave = vi.fn();
  const result = render(() => (
    <BottomActionBar
      name="作者名"
      avatarUrl=""
      isBookmarked={false}
      bookmarking={false}
      onBookmarkPointerDown={() => {}}
      onBookmarkPointerUp={() => {}}
      onComments={() => {}}
      {...overrides}
    />
  ));
  return { onSave, ...result };
}

beforeEach(() => {
  cleanup();
});

describe("BottomActionBar 保存入口", () => {
  it("onSave 提供时显示保存按钮，点击触发回调", () => {
    const { onSave } = renderBar({ onSave: () => onSave() });
    const save = screen.getByLabelText("保存到相册");
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("onSave 缺省（ugoira）不渲染保存按钮", () => {
    renderBar();
    expect(screen.queryByLabelText("保存到相册")).toBeNull();
  });

  it("saving 时按钮禁用并显示保存中", () => {
    renderBar({ onSave: () => {}, saving: true });
    const save = screen.getByLabelText("保存到相册") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    expect(save.textContent).toContain("保存中");
  });
});
