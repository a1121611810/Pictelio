// @vitest-environment happy-dom
// capacitorShare 单测（spec docs/specs/download-manager.md §4.1）。
import { describe, it, expect, vi } from "vitest";
import { createCapacitorSharer, type PictelioShareNative } from "@/utils/capacitorShare";

describe("createCapacitorSharer（spec §4.1）", () => {
  it("把 uris 原样传给原生分享插件", async () => {
    const share = vi.fn(async () => {});
    const sharer = createCapacitorSharer({ share } as unknown as PictelioShareNative);
    await sharer(["content://a", "content://b"]);
    expect(share).toHaveBeenCalledWith({ uris: ["content://a", "content://b"] });
  });

  it("空列表显式失败（不调用原生）", async () => {
    const share = vi.fn(async () => {});
    const sharer = createCapacitorSharer({ share } as unknown as PictelioShareNative);
    await expect(sharer([])).rejects.toThrow("没有可分享的文件");
    expect(share).not.toHaveBeenCalled();
  });
});
