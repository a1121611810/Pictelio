// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import ThemeSelector from "@/components/ThemeSelector";
import { setThemePersisted } from "@/stores/themeStore";

vi.mock("@/stores/themeStore", () => ({
  setThemePersisted: vi.fn(),
  getTheme: () => "system" as const,
}));

describe("ThemeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the three color theme options", async () => {
    render(() => <ThemeSelector />);
    expect(screen.getByText("浅色")).toBeTruthy();
    expect(screen.getByText("跟随系统")).toBeTruthy();
    expect(screen.getByText("深色")).toBeTruthy();
  });

  it("marks the active theme as selected", async () => {
    render(() => <ThemeSelector />);
    const active = screen.getAllByRole("button", { name: "跟随系统" })[0];
    expect(active.getAttribute("aria-pressed")).toBe("true");
    const inactive = screen.getAllByRole("button", { name: "深色" })[0];
    expect(inactive.getAttribute("aria-pressed")).toBe("false");
  });

  it("persists the picked theme on click", async () => {
    render(() => <ThemeSelector />);
    screen.getAllByRole("button", { name: "深色" })[0].click();
    expect(setThemePersisted).toHaveBeenCalledWith("dark");
  });

  it("does not render the removed page style group", async () => {
    render(() => <ThemeSelector />);
    expect(screen.queryByRole("group", { name: "页面风格选择" })).toBeNull();
    expect(screen.queryByText("Fluent 默认")).toBeNull();
    expect(screen.queryByText("卡片式")).toBeNull();
  });
});
