import { describe, it, expect, vi, beforeEach } from "vitest";
import { Preferences } from "@capacitor/preferences";

vi.mock("@capacitor/preferences", () => ({
  Preferences: { get: vi.fn(), set: vi.fn() },
}));

async function loadService() {
  vi.resetModules();
  const mod = await import("@/services/imageHostService");
  return mod;
}

describe("validateHostInput", () => {
  it("rejects empty name", async () => {
    const { validateHostInput } = await loadService();
    expect(validateHostInput({ name: "", baseUrl: "https://a.com" })).toBe("名称不能为空");
  });

  it("rejects invalid URL", async () => {
    const { validateHostInput } = await loadService();
    expect(validateHostInput({ name: "A", baseUrl: "not a url" })).toBe("请输入有效的 URL");
  });

  it("rejects Pixiv official domain", async () => {
    const { validateHostInput } = await loadService();
    expect(validateHostInput({ name: "A", baseUrl: "https://i.pximg.net" })).toBe(
      "图床 URL 不能直接使用 Pixiv 官方域名",
    );
  });

  it("accepts valid proxy URL", async () => {
    const { validateHostInput } = await loadService();
    expect(validateHostInput({ name: "A", baseUrl: "https://i.pixiv.re/{path}" })).toBeNull();
  });

  // ── 明文 HTTP 拦截（spec #382 Q1；oracle = Android 9+ 默认 usesCleartextTraffic=false，
  //    manifest 未放行 cleartext → native 下 http:// 镜像被系统层拒绝，属死配置） ──

  it("rejects cleartext http mirror on native", async () => {
    const { validateHostInput, HTTP_MIRROR_REJECTED_MESSAGE } = await loadService();
    expect(validateHostInput({ name: "A", baseUrl: "http://mirror.example" }, true)).toBe(
      HTTP_MIRROR_REJECTED_MESSAGE,
    );
  });

  it("accepts https mirror on native", async () => {
    const { validateHostInput } = await loadService();
    expect(validateHostInput({ name: "A", baseUrl: "https://mirror.example" }, true)).toBeNull();
  });

  it("accepts cleartext http mirror on web (default platform in node)", async () => {
    const { validateHostInput } = await loadService();
    // 默认平台参数走运行时判定：node 测试环境 Capacitor.isNativePlatform()=false → web 规则
    expect(validateHostInput({ name: "A", baseUrl: "http://mirror.example" })).toBeNull();
  });
});

describe("transformUrl", () => {
  it("replaces hostname for plain proxy", async () => {
    const { transformUrl } = await loadService();
    expect(
      transformUrl(
        "https://i.pximg.net/c/600x600/img-master/img/2020/01/01/0_p0_master1200.jpg",
        "https://i.pixiv.re",
      ),
    ).toBe("https://i.pixiv.re/c/600x600/img-master/img/2020/01/01/0_p0_master1200.jpg");
  });

  it("replaces {path} placeholder", async () => {
    const { transformUrl } = await loadService();
    expect(
      transformUrl(
        "https://i.pximg.net/c/600x600/img-master/img/2020/01/01/0_p0_master1200.jpg",
        "https://example.com/image/{path}",
      ),
    ).toBe("https://example.com/image/c/600x600/img-master/img/2020/01/01/0_p0_master1200.jpg");
  });

  it("returns original URL on parse error", async () => {
    const { transformUrl } = await loadService();
    expect(transformUrl("", "https://i.pixiv.re")).toBe("");
  });
});

describe("selection strategies", () => {
  beforeEach(() => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
    vi.mocked(Preferences.set).mockResolvedValue(undefined);
  });

  it("selectWeightedHost returns undefined when no hosts enabled", async () => {
    const { selectWeightedHost } = await loadService();
    expect(selectWeightedHost([])).toBeUndefined();
  });

  it("selectWeightedHost honors weights", async () => {
    const { selectWeightedHost } = await loadService();
    const hosts = [
      {
        id: "a",
        name: "A",
        baseUrl: "",
        enabled: true,
        weight: 100,
        isBuiltIn: true,
        edited: false,
      },
      { id: "b", name: "B", baseUrl: "", enabled: true, weight: 0, isBuiltIn: true, edited: false },
    ];
    for (let i = 0; i < 10; i++) {
      expect(selectWeightedHost(hosts)?.id).toBe("a");
    }
  });

  it("getEffectiveImageUrl returns original URL when disabled", async () => {
    vi.resetModules();
    const store = await import("@/stores/imageHostStore");
    const service = await import("@/services/imageHostService");
    await store.loadImageHostPreference();
    const original = "https://i.pximg.net/a.jpg";
    expect(service.getEffectiveImageUrl(original)).toBe(original);
  });

  it("getEffectiveImageUrl returns weighted candidate when enabled", async () => {
    vi.resetModules();
    const store = await import("@/stores/imageHostStore");
    const service = await import("@/services/imageHostService");
    await store.loadImageHostPreference();
    store.setMasterEnabled(true);

    const original = "https://i.pximg.net/c/600x600/a.jpg";
    const url = service.getEffectiveImageUrl(original);
    expect(url.startsWith("https://i.pixiv")).toBe(true);
  });

  it("getRaceCandidateUrls returns all enabled URLs in race mode", async () => {
    vi.resetModules();
    const store = await import("@/stores/imageHostStore");
    const service = await import("@/services/imageHostService");
    await store.loadImageHostPreference();
    store.setMasterEnabled(true);
    store.setMode("race");

    const original = "https://i.pximg.net/c/600x600/a.jpg";
    const urls = service.getRaceCandidateUrls(original);
    expect(urls.length).toBeGreaterThanOrEqual(2);
  });

  it("getRaceCandidateUrls returns single URL in weighted mode", async () => {
    vi.resetModules();
    const store = await import("@/stores/imageHostStore");
    const service = await import("@/services/imageHostService");
    await store.loadImageHostPreference();
    store.setMasterEnabled(true);
    store.setMode("weighted");

    const original = "https://i.pximg.net/c/600x600/a.jpg";
    const urls = service.getRaceCandidateUrls(original);
    expect(urls.length).toBe(1);
  });
});

describe("hasDuplicateBaseUrl", () => {
  beforeEach(() => {
    vi.mocked(Preferences.get).mockResolvedValue({ value: null });
  });

  it("detects duplicate ignoring trailing slash", async () => {
    vi.resetModules();
    await import("@/stores/imageHostStore");
    const service = await import("@/services/imageHostService");
    expect(service.hasDuplicateBaseUrl("https://i.pixiv.re/", "other")).toBe(true);
    expect(service.hasDuplicateBaseUrl("https://i.pixiv.nl", "pixiv-nl")).toBe(false);
  });
});
