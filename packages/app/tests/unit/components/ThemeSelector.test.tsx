// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import ThemeSelector from "@/components/ThemeSelector";

vi.mock("@/stores/themeStore", () => ({
  pageStyleTheme: () => "fluent",
  setPageStyleTheme: vi.fn(),
  setThemePersisted: vi.fn(),
  getTheme: () => "system" as const,
  PAGE_STYLE_THEME_IDS: ["fluent", "card"],
}));

describe("ThemeSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders page style options", async () => {
    render(() => <ThemeSelector />);
    expect(screen.getByText("Fluent 默认")).toBeTruthy();
    expect(screen.getByText("卡片式")).toBeTruthy();
  });

  it("renders without color theme swatches", async () => {
    render(() => <ThemeSelector />);
    expect(() => screen.getByText("海岸")).toThrow();
    expect(() => screen.getByText("玫瑰")).toThrow();
  });

  it("marks Fluent as selected by default", async () => {
    render(() => <ThemeSelector />);
    const fluentBtn = screen.getAllByRole("button", { name: "Fluent 默认" })[0];
    expect(fluentBtn.getAttribute("aria-pressed")).toBe("true");
  });
});
