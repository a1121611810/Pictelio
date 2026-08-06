// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import StickySubTabs from "@/components/ui/StickySubTabs";

describe("StickySubTabs", () => {
  afterEach(() => cleanup());

  it("停靠点跟随 headerVisible：可见时 top-12，隐藏时 top-0", () => {
    const [visible, setVisible] = createSignal(true);
    const { container } = render(() => (
      <StickySubTabs headerVisible={visible()}>子标签</StickySubTabs>
    ));
    const el = () => container.firstElementChild as HTMLElement;
    expect(el().classList.contains("sticky")).toBe(true);
    expect(el().classList.contains("top-12")).toBe(true);
    expect(el().classList.contains("top-0")).toBe(false);

    setVisible(false);
    expect(el().classList.contains("top-12")).toBe(false);
    expect(el().classList.contains("top-0")).toBe(true);
  });

  it("未传 headerVisible 时默认 top-12（保持原有停靠行为）", () => {
    const { container } = render(() => <StickySubTabs>子标签</StickySubTabs>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.classList.contains("top-12")).toBe(true);
    expect(el.classList.contains("top-0")).toBe(false);
  });

  it("保留玻璃容器令牌与过渡动画类", () => {
    render(() => (
      <StickySubTabs headerVisible={true} class="px-4 pb-2">
        子标签
      </StickySubTabs>
    ));
    const el = screen.getByText("子标签");
    expect(el.classList.contains("surface-appbar")).toBe(true);
    expect(el.classList.contains("transition-[top]")).toBe(true);
    // 额外类透传
    expect(el.classList.contains("px-4")).toBe(true);
    expect(el.classList.contains("pb-2")).toBe(true);
  });
});
