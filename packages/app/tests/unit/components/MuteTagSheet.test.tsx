// @vitest-environment happy-dom
// MuteTagSheet 交互（ADR-0187 D5）：渲染列表 / 移除 / 空态。
// oracle = BlocklistSheet 形态契约（底部 sheet + 列表行「标签名 + 取消静音」+ 空态）。
// muteTagStore 用 vi.hoisted 可变状态 mock；fluent-button 为未升级的 custom element
// （happy-dom 无 button role），按 GateOverlay.test 先例经 querySelector + .click() 交互。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@solidjs/testing-library";

const storeState = vi.hoisted(() => ({
  tags: [] as string[],
  unmuted: [] as string[],
}));

vi.mock("@/stores/muteTagStore", () => ({
  mutedTags: () => new Set(storeState.tags),
  unmuteTag: (name: string) => {
    storeState.unmuted.push(name);
    storeState.tags = storeState.tags.filter((t) => t !== name);
    return Promise.resolve();
  },
}));

import MuteTagSheet from "@/components/MuteTagSheet";

function renderSheet() {
  const onClose = vi.fn();
  const result = render(() => <MuteTagSheet isOpen onClose={onClose} />);
  return { onClose, ...result };
}

beforeEach(() => {
  cleanup();
  storeState.tags = [];
  storeState.unmuted = [];
});

describe("MuteTagSheet 静音标签管理", () => {
  it("渲染全部已静音标签及逐行「取消静音」按钮", () => {
    storeState.tags = ["R-18G", "グロ"];
    const { container } = renderSheet();

    expect(container.textContent).toContain("R-18G");
    expect(container.textContent).toContain("グロ");
    expect(container.textContent).toContain("静音标签");
    expect(container.querySelectorAll("fluent-button[aria-label^='取消静音标签']")).toHaveLength(2);
  });

  it("点「取消静音」调用 unmuteTag 并传入标签名", () => {
    storeState.tags = ["R-18G"];
    const { container } = renderSheet();

    const btn = container.querySelector("fluent-button[aria-label='取消静音标签 R-18G']");
    expect(btn).not.toBeNull();
    (btn as unknown as { click: () => void }).click();

    expect(storeState.unmuted).toEqual(["R-18G"]);
  });

  it("空词表展示空态文案，无任何取消静音出口", () => {
    const { container } = renderSheet();

    expect(container.textContent).toContain("暂无静音标签");
    expect(container.querySelector("fluent-button[aria-label^='取消静音标签']")).toBeNull();
  });

  it("点关闭按钮回调 onClose", () => {
    const { container, onClose } = renderSheet();

    const btn = container.querySelector("fluent-button[aria-label='关闭']");
    expect(btn).not.toBeNull();
    (btn as unknown as { click: () => void }).click();

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
