// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import GlassTabBar, { type GlassTabItem } from "@/components/ui/GlassTabBar";

const items: GlassTabItem[] = [
  { key: "recommended", label: "推荐" },
  { key: "follow", label: "关注" },
  { key: "bookmarks", label: "收藏" },
  { key: "history", label: "历史" },
];

describe("GlassTabBar", () => {
  afterEach(() => cleanup());

  it("renders all item labels in capsule variant", () => {
    render(() => (
      <GlassTabBar items={items} activeKey="recommended" onSelect={vi.fn()} variant="capsule" />
    ));
    for (const item of items) {
      expect(screen.getByText(item.label)).toBeTruthy();
    }
  });

  it("renders all item labels in segmented variant", () => {
    render(() => (
      <GlassTabBar items={items} activeKey="recommended" onSelect={vi.fn()} variant="segmented" />
    ));
    for (const item of items) {
      expect(screen.getByText(item.label)).toBeTruthy();
    }
  });

  it("marks the active item with aria-selected and the active style class", () => {
    render(() => <GlassTabBar items={items} activeKey="follow" onSelect={vi.fn()} />);
    const active = screen.getByRole("tab", { name: "关注" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.classList.contains("glass-tab-item-active")).toBe(true);
    // roving tabindex：仅激活项可聚焦
    expect(active.getAttribute("tabindex")).toBe("0");
    const inactive = screen.getByRole("tab", { name: "推荐" });
    expect(inactive.getAttribute("aria-selected")).toBe("false");
    expect(inactive.getAttribute("tabindex")).toBe("-1");
    expect(inactive.classList.contains("glass-tab-item-active")).toBe(false);
  });

  it("calls onSelect with the clicked item key", () => {
    const onSelect = vi.fn();
    render(() => <GlassTabBar items={items} activeKey="recommended" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(onSelect).toHaveBeenCalledWith("history");
  });

  it("switches to the next item with ArrowRight", () => {
    const onSelect = vi.fn();
    render(() => <GlassTabBar items={items} activeKey="recommended" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).toHaveBeenCalledWith("follow");
  });

  it("switches to the previous item with ArrowLeft", () => {
    const onSelect = vi.fn();
    render(() => <GlassTabBar items={items} activeKey="follow" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowLeft" });
    expect(onSelect).toHaveBeenCalledWith("recommended");
  });

  it("stops at the first/last item on arrow navigation", () => {
    const onSelect = vi.fn();
    render(() => <GlassTabBar items={items} activeKey="history" onSelect={onSelect} />);
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("does not navigate with arrow keys when disabled", () => {
    const onSelect = vi.fn();
    render(() => (
      <GlassTabBar items={items} activeKey="recommended" onSelect={onSelect} disabled />
    ));
    fireEvent.keyDown(screen.getByRole("tablist"), { key: "ArrowRight" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("disables all items when disabled", () => {
    render(() => <GlassTabBar items={items} activeKey="recommended" onSelect={vi.fn()} disabled />);
    for (const button of screen.getAllByRole("tab")) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
  });

  it("renders a pointer highlight layer in capsule variant", () => {
    const { container } = render(() => (
      <GlassTabBar items={items} activeKey="recommended" onSelect={vi.fn()} variant="capsule" />
    ));
    expect(container.querySelector(".glass-tab-highlight")).toBeTruthy();
  });

  it("does not render a pointer highlight layer in segmented variant", () => {
    const { container } = render(() => (
      <GlassTabBar items={items} activeKey="recommended" onSelect={vi.fn()} variant="segmented" />
    ));
    expect(container.querySelector(".glass-tab-highlight")).toBeNull();
  });

  it("skips the pointer highlight layer under prefers-reduced-motion", () => {
    const matchMediaMock = vi.fn().mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    vi.stubGlobal("matchMedia", matchMediaMock);
    const { container } = render(() => (
      <GlassTabBar items={items} activeKey="recommended" onSelect={vi.fn()} variant="capsule" />
    ));
    expect(container.querySelector(".glass-tab-highlight")).toBeNull();
    vi.unstubAllGlobals();
  });
});
