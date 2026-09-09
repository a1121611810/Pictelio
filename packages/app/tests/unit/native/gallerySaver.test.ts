// @vitest-environment happy-dom
/**
 * GallerySaver TS 桥 Web 回退（spec docs/specs/image-save-download.md §3 D3/§6）。
 * oracle 溯源：Web 回退 = 「代理 URL fetch 成 blob → <a download> 点击」；
 * 非 2xx 抛可读错误（无静默）。toWebProxyUrl 保留真实实现（纯函数，happy-dom 下
 * location 可用）。Native 路径（GallerySaverPlugin.java）由 Java 单测覆盖。
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { GallerySaverWeb } from "@/native/GallerySaver";

const ORIGINAL_URL = "https://i.pximg.net/img-original/123456_p0.jpg";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GallerySaverWeb web 回退", () => {
  it("fetch 代理 URL → blob → <a download> 点击触发", async () => {
    const blob = new Blob(["bytes"], { type: "image/jpeg" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: () => Promise.resolve(blob) });
    vi.stubGlobal("fetch", fetchMock);

    const clicks: string[] = [];
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tag: string) => {
      const el = origCreate(tag);
      if (tag === "a") {
        (el as HTMLAnchorElement).click = () => {
          clicks.push((el as HTMLAnchorElement).download);
        };
      }
      return el;
    });

    const result = await new GallerySaverWeb().saveImage({
      url: ORIGINAL_URL,
      fileName: "Pictelio_123456_p0.jpg",
    });

    expect(fetchMock).toHaveBeenCalledWith(`/pixiv-img/img-original/123456_p0.jpg`);
    expect(clicks).toEqual(["Pictelio_123456_p0.jpg"]);
    expect(result.uri).toBe("Pictelio_123456_p0.jpg");
  });

  it("非 2xx 抛可读错误（无静默）", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 403 }));
    await expect(
      new GallerySaverWeb().saveImage({ url: ORIGINAL_URL, fileName: "a.jpg" }),
    ).rejects.toThrow("403");
  });
});
