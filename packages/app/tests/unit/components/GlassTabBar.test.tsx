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

  it("marks the active item with aria-current and the active style class", () => {
    render(() => <GlassTabBar items={items} activeKey="follow" onSelect={vi.fn()} />);
    const active = screen.getByRole("tab", { name: "关注" });
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.classList.contains("glass-tab-item-active")).toBe(true);
    const inactive = screen.getByRole("tab", { name: "推荐" });
    expect(inactive.getAttribute("aria-selected")).toBe("false");
    expect(inactive.getAttribute("aria-current")).toBeNull();
    expect(inactive.classList.contains("glass-tab-item-active")).toBe(false);
  });

  it("calls onSelect with the clicked item key", () => {
    const onSelect = vi.fn();
    render(() => <GlassTabBar items={items} activeKey="recommended" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("tab", { name: "历史" }));
    expect(onSelect).toHaveBeenCalledWith("history");
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
