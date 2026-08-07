// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import StickySubTabs from "@/components/ui/StickySubTabs";

describe("StickySubTabs", () => {
  afterEach(() => cleanup());

  it("header 可见时停靠 top-16 不动，隐藏时 transform 上移 64px（-translate-y-16）", () => {
    const [visible, setVisible] = createSignal(true);
    const { container } = render(() => (
      <StickySubTabs headerVisible={visible()}>子标签</StickySubTabs>
    ));
    const el = () => container.firstElementChild as HTMLElement;
    // 停靠点恒为 top-16（可达，对应 A2 卡片式 header 高度 64px），header 隐藏仅做视觉位移
    expect(el().classList.contains("sticky")).toBe(true);
    expect(el().classList.contains("top-16")).toBe(true);
    expect(el().classList.contains("translate-y-0")).toBe(true);
    expect(el().classList.contains("-translate-y-16")).toBe(false);

    setVisible(false);
    expect(el().classList.contains("translate-y-0")).toBe(false);
    expect(el().classList.contains("-translate-y-16")).toBe(true);
    // top-16 常量不受影响（transform 补偿，无 sticky 重算）
    expect(el().classList.contains("top-16")).toBe(true);
  });

  it("未传 headerVisible 时按 undefined 处理：transform 上移（header 不可见语义）", () => {
    const { container } = render(() => <StickySubTabs>子标签</StickySubTabs>);
    const el = container.firstElementChild as HTMLElement;
    expect(el.classList.contains("-translate-y-16")).toBe(true);
    expect(el.classList.contains("translate-y-0")).toBe(false);
  });

  it("保留页面背景容器令牌与过渡动画类（ADR-0070：去毛玻璃改页面背景色）", () => {
    render(() => (
      <StickySubTabs headerVisible={true} class="px-4 pb-2">
        子标签
      </StickySubTabs>
    ));
    const el = screen.getByText("子标签");
    // A2 化（ADR-0070）：容器不再用 surface-appbar 毛玻璃，改页面背景色
    expect(el.classList.contains("surface-appbar")).toBe(false);
    expect(el.classList.contains("bg-[var(--colorNeutralBackground3)]")).toBe(true);
    // transform 动画（与 header 的 translate 同机制），非布局属性
    expect(el.classList.contains("transition-transform")).toBe(true);
    // 额外类透传
    expect(el.classList.contains("px-4")).toBe(true);
    expect(el.classList.contains("pb-2")).toBe(true);
  });
});
