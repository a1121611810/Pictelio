import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock apiClient
const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock("@/api/client", () => ({
  apiClient: {
    get: (...args: unknown[]) => mockGet(...args),
    post: (...args: unknown[]) => mockPost(...args),
  },
}));

async function loadApi() {
  vi.resetModules();
  return import("@/api/illust");
}

describe("api/illust.ts", () => {
  it("loadRecommended calls apiClient.get with correct params", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadRecommended } = await loadApi();
    await loadRecommended("illust");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/illust/recommended",
      {
        content_type: "illust",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("loadRecommended defaults to illust", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadRecommended } = await loadApi();
    await loadRecommended();

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/illust/recommended",
      {
        content_type: "illust",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("loadMangaRecommended delegates to loadRecommended with manga", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadMangaRecommended } = await loadApi();
    await loadMangaRecommended();

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/illust/recommended",
      {
        content_type: "manga",
        filter: "for_ios",
      },
      undefined,
    );
  });

  it("loadFollow calls apiClient.get with restrict", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadFollow } = await loadApi();
    await loadFollow("private");

    expect(mockGet).toHaveBeenCalledWith(
      "/v2/illust/follow",
      {
        restrict: "private",
      },
      undefined,
    );
  });

  it("loadFollow defaults to public", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadFollow } = await loadApi();
    await loadFollow();

    expect(mockGet).toHaveBeenCalledWith(
      "/v2/illust/follow",
      {
        restrict: "public",
      },
      undefined,
    );
  });

  it("loadDetail calls apiClient.get with illust_id", async () => {
    mockGet.mockResolvedValue({ illust: {} });
    const { loadDetail } = await loadApi();
    await loadDetail(456);

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/illust/detail",
      {
        illust_id: "456",
      },
      undefined,
    );
  });

  it("loadNext passes URL directly", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadNext } = await loadApi();
    await loadNext("https://app-api.pixiv.net/v1/illust/recommended?offset=30");

    expect(mockGet).toHaveBeenCalledWith(
      "https://app-api.pixiv.net/v1/illust/recommended?offset=30",
      undefined,
      undefined,
    );
  });

  it("loadBookmarks calls apiClient.get with userId and restrict", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadBookmarks } = await loadApi();
    await loadBookmarks(789, "public");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/user/bookmarks/illust",
      {
        user_id: "789",
        restrict: "public",
      },
      undefined,
    );
  });

  it("loadUgoiraMetadata returns ugoira_metadata", async () => {
    mockGet.mockResolvedValue({
      ugoira_metadata: { frames: [{ file: "1.jpg", delay: 100 }] },
    });
    const { loadUgoiraMetadata } = await loadApi();
    const result = await loadUgoiraMetadata(123);

    expect(result).toEqual({ frames: [{ file: "1.jpg", delay: 100 }] });
    expect(mockGet).toHaveBeenCalledWith(
      "/v1/ugoira/metadata",
      {
        illust_id: "123",
      },
      undefined,
    );
  });

  it("addBookmark calls apiClient.post with illust_id and restrict", async () => {
    mockPost.mockResolvedValue(undefined);
    const { addBookmark } = await loadApi();
    await addBookmark(111, "private");

    expect(mockPost).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "111",
      restrict: "private",
    });
  });

  it("deleteBookmark calls apiClient.post with illust_id", async () => {
    mockPost.mockResolvedValue(undefined);
    const { deleteBookmark } = await loadApi();
    await deleteBookmark(222);

    expect(mockPost).toHaveBeenCalledWith("/v1/illust/bookmark/delete", {
      illust_id: "222",
    });
  });

  it("followUser calls apiClient.post with user_id", async () => {
    mockPost.mockResolvedValue(undefined);
    const { followUser } = await loadApi();
    await followUser(333);

    expect(mockPost).toHaveBeenCalledWith("/v1/user/follow/add", {
      user_id: "333",
      restrict: "public",
    });
  });

  it("unfollowUser calls apiClient.post", async () => {
    mockPost.mockResolvedValue(undefined);
    const { unfollowUser } = await loadApi();
    await unfollowUser(444);

    expect(mockPost).toHaveBeenCalledWith("/v1/user/follow/delete", {
      user_id: "444",
    });
  });

  it("loadUserIllusts calls apiClient.get with userId and type", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadUserIllusts } = await loadApi();
    await loadUserIllusts(555, "manga");

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/user/illusts",
      {
        user_id: "555",
        type: "manga",
      },
      undefined,
    );
  });

  it("loadUserIllusts defaults to illust type", async () => {
    mockGet.mockResolvedValue({ illusts: [] });
    const { loadUserIllusts } = await loadApi();
    await loadUserIllusts(555);

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/user/illusts",
      {
        user_id: "555",
        type: "illust",
      },
      undefined,
    );
  });
});

it("downloadAndExtractUgoira 用共享包 @pictelio/ugoira 解压（T2 fflate 替换 JSZip）", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: {
        medium: "https://i.pximg.net/img-zip-ugoira/img/2020/01/01/00/00/00/1_ugoira600x600.zip",
      },
      frames: [
        { file: "frame_0.png", delay: 100 },
        { file: "frame_1.png", delay: 120 },
      ],
    },
  });
  // 手工构造 store zip（Pixiv ugoira 真实格式：未压缩条目，独立于 fflate）
  const zip = buildStoreZip([
    { name: "frame_0.png", data: new Uint8Array([1, 2, 3]) },
    { name: "frame_1.png", data: new Uint8Array([4, 5]) },
  ]);
  const zipResp = new Response(zip, {
    status: 200,
    headers: { "content-length": String(zip.length) },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(zipResp));
  // node 的 URL 无 createObjectURL——直接挂到全局类上（不替换整个 URL，保留 constructor）
  const createObjectURL = vi.fn(() => "blob:mock-ugoira");
  // @ts-expect-error node URL 无 createObjectURL
  URL.createObjectURL = createObjectURL;
  try {
    const { downloadAndExtractUgoira } = await loadApi();
    const { frames, blobUrls } = await downloadAndExtractUgoira(123);
    expect(frames).toHaveLength(2);
    expect(frames[0]!.delay).toBe(100);
    expect(frames[1]!.delay).toBe(120);
    expect(blobUrls).toHaveLength(2);
    expect(createObjectURL).toHaveBeenCalledTimes(2);
  } finally {
    vi.unstubAllGlobals();
    // @ts-expect-error 清理
    delete URL.createObjectURL;
  }
});

// ─── store zip 构造 helper（T2 契约测试：Pixiv ugoira 未压缩条目格式） ───
function u16(v: number, out: number[]): void {
  out.push(v & 0xff, (v >> 8) & 0xff);
}
function u32(v: number, out: number[]): void {
  out.push(v & 0xff, (v >> 8) & 0xff, (v >> 16) & 0xff, (v >> 24) & 0xff);
}
function nameBytes(name: string, out: number[]): void {
  for (let i = 0; i < name.length; i++) out.push(name.charCodeAt(i));
}
function buildStoreZip(frames: { name: string; data: Uint8Array }[]): Uint8Array {
  const parts: number[] = [];
  const localOffsets: number[] = [];
  for (const f of frames) {
    localOffsets.push(parts.length);
    u32(0x04034b50, parts);
    u16(20, parts);
    u16(0, parts);
    u16(0, parts);
    u16(0, parts);
    u16(0, parts);
    u32(0, parts);
    u32(f.data.length, parts);
    u32(f.data.length, parts);
    u16(f.name.length, parts);
    u16(0, parts);
    nameBytes(f.name, parts);
    for (const b of f.data) parts.push(b);
  }
  const cdStart = parts.length;
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]!;
    u32(0x02014b50, parts);
    u16(20, parts);
    u16(20, parts);
    u16(0, parts);
    u16(0, parts);
    u16(0, parts);
    u16(0, parts);
    u32(0, parts);
    u32(f.data.length, parts);
    u32(f.data.length, parts);
    u16(f.name.length, parts);
    u16(0, parts);
    u16(0, parts);
    u16(0, parts);
    u16(0, parts);
    u32(0, parts);
    u32(localOffsets[i]!, parts);
    nameBytes(f.name, parts);
  }
  const cdSize = parts.length - cdStart;
  u32(0x06054b50, parts);
  u16(0, parts);
  u16(0, parts);
  u16(frames.length, parts);
  u16(frames.length, parts);
  u32(cdSize, parts);
  u32(cdStart, parts);
  u16(0, parts);
  return new Uint8Array(parts);
}

it("downloadAndExtractUgoira range 模式：HEAD + 尾部目录 + 按帧 Range 取帧（T4）", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: {
        medium: "https://i.pximg.net/img-zip-ugoira/img/2020/01/01/00/00/00/1_ugoira600x600.zip",
      },
      frames: [
        { file: "frame_0.png", delay: 100 },
        { file: "frame_1.png", delay: 120 },
      ],
    },
  });
  const zip = buildStoreZip([
    { name: "frame_0.png", data: new Uint8Array([1, 2, 3]) },
    { name: "frame_1.png", data: new Uint8Array([4, 5]) },
  ]);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-length": String(zip.length) } });
    }
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const m = /bytes=(\d+)-(\d+)/.exec(range ?? "");
    if (m) {
      const s = parseInt(m[1]!, 10);
      const e = parseInt(m[2]!, 10);
      const slice = zip.slice(s, e + 1);
      return new Response(slice, {
        status: 206,
        headers: { "content-range": `bytes ${s}-${e}/${zip.length}` },
      });
    }
    return new Response(zip, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const createObjectURL = vi.fn(() => "blob:mock-range");
  // @ts-expect-error node URL 无 createObjectURL
  URL.createObjectURL = createObjectURL;
  try {
    const { downloadAndExtractUgoira } = await loadApi();
    const { frames, blobUrls } = await downloadAndExtractUgoira(123, undefined, "range");
    expect(frames).toHaveLength(2);
    expect(frames[0]!.delay).toBe(100);
    expect(blobUrls).toHaveLength(2);
    // 断言发过 HEAD 与 Range 请求（未全量下载）
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/pixiv-img/"), {
      method: "HEAD",
    });
    expect(
      fetchMock.mock.calls.some(
        ([, i]) => (i?.headers as Record<string, string> | undefined)?.Range,
      ),
    ).toBe(true);
    expect(fetchMock.mock.calls.some(([, i]) => i && !i.method && !i.headers)).toBe(false);
  } finally {
    vi.unstubAllGlobals();
    // @ts-expect-error 清理
    delete URL.createObjectURL;
  }
});

it("downloadAndExtractUgoira range 模式：Range 返回长度不符 → 抛错（T4 防截断）", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: { medium: "https://i.pximg.net/z.zip" },
      frames: [{ file: "frame_0.png", delay: 100 }],
    },
  });
  const zip = buildStoreZip([{ name: "frame_0.png", data: new Uint8Array([1, 2, 3]) }]);
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "HEAD") {
      return new Response(null, { status: 200, headers: { "content-length": String(zip.length) } });
    }
    // 所有 Range 都返回截断（少 1 字节）
    const m = /bytes=(\d+)-(\d+)/.exec(
      (init?.headers as Record<string, string> | undefined)?.Range ?? "",
    );
    if (m) {
      const s = parseInt(m[1]!, 10);
      const e = parseInt(m[2]!, 10);
      return new Response(zip.slice(s, e), { status: 206 }); // 截断
    }
    return new Response(zip, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { downloadAndExtractUgoira } = await loadApi();
    await expect(downloadAndExtractUgoira(123, undefined, "range")).rejects.toThrow("长度不符");
  } finally {
    vi.unstubAllGlobals();
  }
});
