import { describe, it, expect, vi, afterEach } from "vitest";
import { isNewer, checkForUpdate } from "@/services/updateService";

describe("isNewer", () => {
  it("returns false when versions are equal", () => {
    expect(isNewer("1.0.0", "1.0.0")).toBe(false);
  });

  it("returns true when remote major is newer", () => {
    expect(isNewer("1.0.0", "2.0.0")).toBe(true);
  });

  it("returns true when remote minor is newer", () => {
    expect(isNewer("1.2.0", "1.3.0")).toBe(true);
  });

  it("returns true when remote patch is newer", () => {
    expect(isNewer("1.2.3", "1.2.4")).toBe(true);
  });

  it("returns false when local is newer", () => {
    expect(isNewer("2.0.0", "1.9.9")).toBe(false);
  });

  it("handles leading v prefix on remote", () => {
    expect(isNewer("1.0.0", "v1.1.0")).toBe(true);
  });

  it("handles leading v prefix on local", () => {
    expect(isNewer("v1.0.0", "1.1.0")).toBe(true);
  });

  it("handles leading v prefix on both sides", () => {
    expect(isNewer("v1.0.0", "v1.0.1")).toBe(true);
  });

  it("ignores build metadata after plus sign", () => {
    expect(isNewer("1.0.0+1", "1.1.0+99")).toBe(true);
  });

  it("ignores build metadata when core versions are equal", () => {
    expect(isNewer("1.0.0+1", "1.0.0+2")).toBe(false);
  });

  it("trims whitespace around version strings", () => {
    expect(isNewer(" 1.0.0 ", " 1.1.0 ")).toBe(true);
  });

  it("handles mixed depth (remote shorter)", () => {
    expect(isNewer("1.2.3", "1.3")).toBe(true);
  });

  it("handles mixed depth (local shorter) when equal", () => {
    expect(isNewer("1.2", "1.2.0")).toBe(false);
  });

  it("handles mixed depth when local is newer", () => {
    expect(isNewer("1.2", "1.1.9")).toBe(false);
  });
});

describe("checkForUpdate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("解析 version.json 的 url 字段为 latestReleaseUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          version: "9.9.9",
          url: "https://github.com/a1121611810/pixivizer/releases/tag/v9.9.9",
          changelog: "test",
        }),
    });
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate();

    expect(result.hasUpdate).toBe(true);
    expect(result.latestReleaseUrl).toBe(
      "https://github.com/a1121611810/pixivizer/releases/tag/v9.9.9",
    );
  });

  it("fetch 失败时返回安全默认值", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network down"));
    vi.stubGlobal("fetch", mockFetch);

    const result = await checkForUpdate();

    expect(result).toEqual({
      hasUpdate: false,
      latestVersion: "",
      latestReleaseUrl: "",
      latestChangelog: "",
    });
  });
});
