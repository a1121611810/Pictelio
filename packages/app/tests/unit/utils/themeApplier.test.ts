// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from "vitest";
import { applyDarkClass } from "@/utils/themeApplier";

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("dark");
});

describe("applyDarkClass", () => {
  it("does nothing when document is undefined (SSR)", () => {
    vi.stubGlobal("document", undefined);
    expect(() => applyDarkClass(true)).not.toThrow();
    expect(() => applyDarkClass(false)).not.toThrow();
  });

  it("adds dark class when isDark is true", () => {
    applyDarkClass(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("removes dark class when isDark is false", () => {
    document.documentElement.classList.add("dark");
    applyDarkClass(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("is idempotent across repeated calls", () => {
    applyDarkClass(true);
    applyDarkClass(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    applyDarkClass(false);
    applyDarkClass(false);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
