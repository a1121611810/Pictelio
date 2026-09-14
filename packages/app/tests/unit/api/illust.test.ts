import { describe, it, expect, vi, beforeEach } from "vitest";
import { ApiErrorType } from "@/api/types";

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

// ─── 收藏加标签数据层（T1，GitHub #530 / ADR-0160 / spec D1/D2/D4/D5） ───
// oracle 溯源（测试硬约束 #6）：
// - addBookmark 请求体格式：pixivpy3 aapi.py `illust_bookmark_add`——多标签空格 join 成
//   单值、字面量字段名 `tags[]`、空标签集不发 tags 字段；第二来源：
//   docs/research/bookmark-tags-similar-clients.md 六实现差分（六实现一致收敛）。
// - loadBookmarkDetail / loadUserBookmarkTags 响应形状：同调研报告对应端点节，
//   字段 optional 宽容解析。
// - 覆盖式编辑语义：ADR-0160 D2（编辑已收藏 = 重发 add 覆盖，不先 delete）。
// - 失败路径错误对象形状：src/api/client.ts classifyError 产出的 ApiError 真实形态
//   （types.ts ApiErrorType），仅断言传播、不重复测分类（client 测试已覆盖）。
describe("api/illust.ts 收藏加标签", () => {
  it("addBookmark 零标签：不发 tags[] 字段（默认 restrict=public）", async () => {
    mockPost.mockResolvedValue(undefined);
    const { addBookmark } = await loadApi();
    await addBookmark(111);

    expect(mockPost).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "111",
      restrict: "public",
    });
  });

  it("addBookmark 空数组：与未传一致，不发 tags[] 字段", async () => {
    mockPost.mockResolvedValue(undefined);
    const { addBookmark } = await loadApi();
    await addBookmark(111, "private", []);

    expect(mockPost).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "111",
      restrict: "private",
    });
  });

  it("addBookmark 单标签：tags[] 单值 + restrict 透传", async () => {
    mockPost.mockResolvedValue(undefined);
    const { addBookmark } = await loadApi();
    await addBookmark(111, "public", ["風景"]);

    expect(mockPost).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "111",
      restrict: "public",
      "tags[]": "風景",
    });
  });

  it("addBookmark 多标签：空格 join 单值（pixivpy3 契约，非重复键数组）", async () => {
    mockPost.mockResolvedValue(undefined);
    const { addBookmark } = await loadApi();
    await addBookmark(222, "private", ["風景", "watercolor", "東方Project"]);

    expect(mockPost).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "222",
      restrict: "private",
      "tags[]": "風景 watercolor 東方Project",
    });
  });

  it("addBookmark 含空格标签原样透传（服务端按空格切分 = 已知行为 spec D11）", async () => {
    mockPost.mockResolvedValue(undefined);
    const { addBookmark } = await loadApi();
    await addBookmark(333, "public", ["a b", "c"]);

    expect(mockPost).toHaveBeenCalledWith("/v2/illust/bookmark/add", {
      illust_id: "333",
      restrict: "public",
      "tags[]": "a b c",
    });
  });

  it("addBookmark 失败路径：apiClient.post 错误向上传播（不吞错，硬约束 #3）", async () => {
    const apiError = { type: "SERVER", message: "服务器错误 (HTTP 500)", status: 500 };
    mockPost.mockRejectedValue(apiError);
    const { addBookmark } = await loadApi();

    await expect(addBookmark(444, "public", ["x"])).rejects.toEqual(apiError);
  });

  it("loadBookmarkDetail 成功：GET illust_id 参数 + 返回 bookmark_detail", async () => {
    const detail = {
      is_bookmarked: true,
      restrict: "private",
      tags: [{ name: "風景", is_registered: true }],
    };
    mockGet.mockResolvedValue({ bookmark_detail: detail });
    const { loadBookmarkDetail } = await loadApi();
    const result = await loadBookmarkDetail(999);

    expect(result).toEqual(detail);
    expect(mockGet).toHaveBeenCalledWith(
      "/v2/illust/bookmark/detail",
      { illust_id: "999" },
      undefined,
    );
  });

  it("loadBookmarkDetail 未收藏：bookmark_detail null → 返回 null", async () => {
    mockGet.mockResolvedValue({ bookmark_detail: null });
    const { loadBookmarkDetail } = await loadApi();

    await expect(loadBookmarkDetail(999)).resolves.toBeNull();
  });

  it("loadBookmarkDetail 可选字段缺省宽容：bookmark_detail 空对象不抛错", async () => {
    mockGet.mockResolvedValue({ bookmark_detail: {} });
    const { loadBookmarkDetail } = await loadApi();

    await expect(loadBookmarkDetail(999)).resolves.toEqual({});
  });

  it("loadBookmarkDetail 契约破坏：响应缺 bookmark_detail 键 → warn + throw（禁止静默归一为未收藏）", async () => {
    // oracle（测试硬约束 #6）：2026-09-14 真机 probe —— 未收藏时服务端仍返回对象
    // （is_bookmarked:false + 作品标签 is_registered:false），且 lynx 侧同语义
    // （packages/app-lynx/src/composables/useBookmarkPanel.ts：字段缺失 = 契约破坏）。
    // 静默归一为 null 会让面板以「空预填」覆盖已有收藏（清空既有标签），
    // 违反 spec D6「无真值不覆盖」。
    mockGet.mockResolvedValue({});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { loadBookmarkDetail } = await loadApi();

    // 断言「显式失败且展示层可本地化」：抛 ApiError 形状（带 messageKey），不是裸 Error——
    // message 快照是简中、只作日志兜底；面板经 apiErrorMessage 必须拿到 messageKey 才能随 locale 渲染
    await expect(loadBookmarkDetail(999)).rejects.toMatchObject({
      type: ApiErrorType.UNKNOWN,
      messageKey: "error.fallback.loadFailed",
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("[loadBookmarkDetail]"));
  });

  it("loadBookmarkDetail 失败路径：apiClient.get 错误向上传播", async () => {
    const apiError = { type: "SERVER", message: "服务器错误 (HTTP 500)", status: 500 };
    mockGet.mockRejectedValue(apiError);
    const { loadBookmarkDetail } = await loadApi();

    await expect(loadBookmarkDetail(999)).rejects.toEqual(apiError);
  });

  it("loadUserBookmarkTags 成功：user_id/restrict/offset 参数 + 返回响应", async () => {
    const res = { bookmark_tags: [{ name: "風景", count: 3 }], next_url: null };
    mockGet.mockResolvedValue(res);
    const { loadUserBookmarkTags } = await loadApi();
    const result = await loadUserBookmarkTags(789, "private", 30);

    expect(result).toEqual(res);
    expect(mockGet).toHaveBeenCalledWith(
      "/v1/user/bookmark-tags/illust",
      { user_id: "789", restrict: "private", offset: "30" },
      undefined,
    );
  });

  it("loadUserBookmarkTags 缺省：restrict=public，不传 offset 时 params 无 offset 键", async () => {
    mockGet.mockResolvedValue({ bookmark_tags: [], next_url: null });
    const { loadUserBookmarkTags } = await loadApi();
    await loadUserBookmarkTags(789);

    expect(mockGet).toHaveBeenCalledWith(
      "/v1/user/bookmark-tags/illust",
      { user_id: "789", restrict: "public" },
      undefined,
    );
  });

  it("loadUserBookmarkTags 缺字段宽容：响应缺 next_url 不抛错", async () => {
    mockGet.mockResolvedValue({ bookmark_tags: [] });
    const { loadUserBookmarkTags } = await loadApi();

    await expect(loadUserBookmarkTags(789)).resolves.toEqual({ bookmark_tags: [] });
  });

  it("loadUserBookmarkTags 失败路径：apiClient.get 错误向上传播", async () => {
    const apiError = { type: "UNAUTHORIZED", message: "登录已过期 (HTTP 401)", status: 401 };
    mockGet.mockRejectedValue(apiError);
    const { loadUserBookmarkTags } = await loadApi();

    await expect(loadUserBookmarkTags(789)).rejects.toEqual(apiError);
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

it("downloadAndExtractUgoira range 模式：GET 探测 + 尾部目录 + 按帧 Range 取帧（T4）", async () => {
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
    // 断言发过 bytes=0-0 探测与 Range 请求（未全量下载）
    expect(
      fetchMock.mock.calls.some(
        ([, i]) => (i?.headers as Record<string, string> | undefined)?.Range === "bytes=0-0",
      ),
    ).toBe(true);
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

it("downloadAndExtractUgoira range 模式：Range 返回长度不符 → 降级 fflate（ADR-0126 防截断）", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: { medium: "https://i.pximg.net/z.zip" },
      frames: [{ file: "frame_0.png", delay: 100 }],
    },
  });
  const zip = buildStoreZip([{ name: "frame_0.png", data: new Uint8Array([1, 2, 3]) }]);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    // 探测（bytes=0-0）正常；其余 Range 返回截断（少 1 字节）→ fetchRange 抛「长度不符」
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const m = /bytes=(\d+)-(\d+)/.exec(range ?? "");
    if (m) {
      const s = parseInt(m[1]!, 10);
      const e = parseInt(m[2]!, 10);
      if (s === 0 && e === 0) {
        return new Response(new Uint8Array([zip[0]!]), {
          status: 206,
          headers: { "content-range": `bytes 0-0/${zip.length}` },
        });
      }
      return new Response(zip.slice(s, e), { status: 206 }); // 截断
    }
    return new Response(zip, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const createObjectURL = vi.fn(() => "blob:mock-fallback");
  // @ts-expect-error node URL 无 createObjectURL
  URL.createObjectURL = createObjectURL;
  try {
    const { downloadAndExtractUgoira } = await loadApi();
    // 降级后成功返回（fflate 全量路径），不再抛错
    const { frames } = await downloadAndExtractUgoira(123, undefined, "range");
    expect(frames).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[ugoira] range 取帧失败，降级 fflate:",
      expect.stringContaining("长度不符"),
    );
    // 降级后发生全量下载（无 init 的 fetch 调用 = 无 Range 头）
    expect(fetchMock.mock.calls.some(([, i]) => i === undefined)).toBe(true);
  } finally {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    // @ts-expect-error 清理
    delete URL.createObjectURL;
  }
});

it("downloadAndExtractUgoira range 模式：中帧失败释放已建 blob URL 再降级（code-review S1）", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: { medium: "https://i.pximg.net/z.zip" },
      frames: [
        { file: "frame_0.png", delay: 100 },
        { file: "frame_1.png", delay: 120 },
      ],
    },
  });
  // zip 缺 frame_1：range 路径在 i=1 抛错（此时 frame_0 的 blob 已建）→ 必须 revoke
  const zip = buildStoreZip([{ name: "frame_0.png", data: new Uint8Array([1, 2, 3]) }]);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const revokeSpy = vi.fn();
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const range = (init?.headers as Record<string, string> | undefined)?.Range;
    const m = /bytes=(\d+)-(\d+)/.exec(range ?? "");
    if (m) {
      const s = parseInt(m[1]!, 10);
      const e = parseInt(m[2]!, 10);
      if (s === 0 && e === 0) {
        return new Response(new Uint8Array([zip[0]!]), {
          status: 206,
          headers: { "content-range": `bytes 0-0/${zip.length}` },
        });
      }
      return new Response(zip.slice(s, e + 1), { status: 206 });
    }
    return new Response(zip, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const createObjectURL = vi.fn(() => "blob:leak-test");
  // @ts-expect-error node URL 无 createObjectURL
  URL.createObjectURL = createObjectURL;
  // @ts-expect-error node URL 无 revokeObjectURL
  URL.revokeObjectURL = revokeSpy;
  try {
    const { downloadAndExtractUgoira } = await loadApi();
    // 降级后 fflate 对同一残缺 zip 也失败（缺帧 = zip 损坏，错误态正确）→ reject
    await expect(downloadAndExtractUgoira(123, undefined, "range")).rejects.toThrow("缺少帧文件");
    expect(warnSpy).toHaveBeenCalledWith(
      "[ugoira] range 取帧失败，降级 fflate:",
      expect.stringContaining("缺少帧文件"),
    );
    // 已建帧 blob 必须释放（防降级路径泄漏）
    expect(revokeSpy).toHaveBeenCalledWith("blob:leak-test");
  } finally {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    // @ts-expect-error 清理
    delete URL.createObjectURL;
    // @ts-expect-error 清理
    delete URL.revokeObjectURL;
  }
});

it("downloadAndExtractUgoira range 模式：探测非 206 → 降级 fflate（ADR-0126）", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: { medium: "https://i.pximg.net/z.zip" },
      frames: [{ file: "frame_0.png", delay: 100 }],
    },
  });
  const zip = buildStoreZip([{ name: "frame_0.png", data: new Uint8Array([1, 2, 3]) }]);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
    // 所有请求都返回 200 全量（模拟不支持 Range 的代理/服务器）
    return new Response(zip, { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  const createObjectURL = vi.fn(() => "blob:mock-fallback2");
  // @ts-expect-error node URL 无 createObjectURL
  URL.createObjectURL = createObjectURL;
  try {
    const { downloadAndExtractUgoira } = await loadApi();
    const { frames } = await downloadAndExtractUgoira(123, undefined, "range");
    expect(frames).toHaveLength(1);
    expect(warnSpy).toHaveBeenCalledWith(
      "[ugoira] range 取帧失败，降级 fflate:",
      expect.stringContaining("HTTP 200"),
    );
  } finally {
    warnSpy.mockRestore();
    vi.unstubAllGlobals();
    // @ts-expect-error 清理
    delete URL.createObjectURL;
  }
});

// ─── T2（ADR-0127）：streamUgoiraFrames 流式渐进取帧 ───
// oracle：ADR-0127 接口事实（帧就绪序/错误模式/进度语义）+ 原型报告
// docs/research/ugoira-stream-frames-proto.md（与 unzipSync 逐字节一致已由共享包单测覆盖，
// 此处验证 app 接线：事件序/delay/进度/abort/损坏）

it("streamUgoiraFrames：分片喂入 → onFrame 按序回调 + 进度单调至 100", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: { medium: "https://i.pximg.net/img-zip-ugoira/z.zip" },
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
  const fetchMock = vi.fn(async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(zip.slice(0, 2));
        controller.enqueue(zip.slice(2, 5));
        controller.enqueue(zip.slice(5));
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: { "content-length": String(zip.length) },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  const createObjectURL = vi.fn(() => "blob:stream-test");
  // @ts-expect-error node URL 无 createObjectURL
  URL.createObjectURL = createObjectURL;
  try {
    const { streamUgoiraFrames } = await loadApi();
    const frames: { delay: number; index: number; total: number }[] = [];
    const progress: number[] = [];
    await streamUgoiraFrames(
      123,
      (url, delay, index, total) => {
        expect(url).toBe("blob:stream-test");
        frames.push({ delay, index, total });
      },
      (p) => progress.push(p),
    );
    // 事件序与 delay（metadata 契约）与 index/total
    expect(frames.map((f) => f.delay)).toEqual([100, 120]);
    expect(frames[0]!.index).toBe(0);
    expect(frames[1]!.index).toBe(1);
    expect(frames[1]!.total).toBe(2);
    // 进度单调递增且收于 100
    expect(progress[progress.length - 1]).toBe(100);
    expect(progress.every((p, i) => i === 0 || p >= progress[i - 1]!)).toBe(true);
  } finally {
    vi.unstubAllGlobals();
    // @ts-expect-error 清理
    delete URL.createObjectURL;
  }
});

it("streamUgoiraFrames：损坏 zip → rejects ugoira: 可读错误", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: { medium: "https://i.pximg.net/z.zip" },
      frames: [{ file: "frame_0.png", delay: 100 }],
    },
  });
  const garbage = new Uint8Array([1, 2, 3, 4, 5]);
  const fetchMock = vi.fn(async () => {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(garbage);
          controller.close();
        },
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { streamUgoiraFrames } = await loadApi();
    await expect(streamUgoiraFrames(123, () => {})).rejects.toThrow(/ugoira: zip/);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("streamUgoiraFrames：abort → rejects（AbortError 语义，reader 中断）", async () => {
  mockGet.mockResolvedValue({
    ugoira_metadata: {
      zip_urls: { medium: "https://i.pximg.net/z.zip" },
      frames: [{ file: "frame_0.png", delay: 100 }],
    },
  });
  const ac = new AbortController();
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener("abort", () => {
            controller.error(new DOMException("Aborted", "AbortError"));
          });
        },
      }),
      { status: 200 },
    );
  });
  vi.stubGlobal("fetch", fetchMock);
  try {
    const { streamUgoiraFrames } = await loadApi();
    const p = streamUgoiraFrames(123, () => {}, undefined, ac.signal);
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toThrow(/abort/i);
  } finally {
    vi.unstubAllGlobals();
  }
});
