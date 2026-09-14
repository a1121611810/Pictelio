// 相关作品注入行状态机单元测试（spec docs/specs/related-injection.md §3/§4/§6）。
// Oracle 溯源：状态语义来自 spec §4（锚点一次性消费 / MAX_ANCHORS=3 / 去重 / 过滤链 /
// 失败移除行 + warn / 开关关闭隐藏）；fixtures 形状 = PixivIllust 契约（同 recommendedStore.test）。
// @vitest-environment happy-dom
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Settings } from "@/settings/types";
import type { PixivIllust } from "@/api/types";

const mockState = vi.hoisted(() => ({
  current: null as Settings | null,
  fetchQuery: vi.fn(),
}));

vi.mock("@/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/settings")>()),
  get settings() {
    return mockState.current;
  },
}));

vi.mock("@/api/queryClient", () => ({
  queryClient: { fetchQuery: mockState.fetchQuery },
}));

/** 构造 PixivIllust（形状对齐 api/types 契约） */
function createIllust(id: number, xRestrict = 0): PixivIllust {
  return {
    id,
    title: `work-${id}`,
    type: "illust",
    user: { id: 9000 + id, name: "u", account: "u", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 0,
    tags: [],
    x_restrict: xRestrict,
    create_date: "2026-09-01T00:00:00+09:00",
    meta_pages: [],
  } as unknown as PixivIllust;
}

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

async function loadStore(seed: Record<string, string> = {}) {
  vi.resetModules();
  const { createSettings } = await import("@/settings/registry");
  const { createMemoryAdapter } = await import("@/settings/backends/memory");
  const mem = createMemoryAdapter(seed);
  const settings = createSettings({ storages: { preferences: mem } });
  mockState.current = settings;
  const mod = await import("@/stores/relatedInjectionStore");
  await settings.hydrateAll();
  return mod;
}

describe("relatedInjectionStore 状态机（spec §4）", () => {
  beforeEach(() => {
    mockState.fetchQuery.mockReset();
  });

  it("无 pending 锚点时消费为 no-op", async () => {
    const store = await loadStore();
    await store.consumeRelatedAnchor("recommended", []);
    expect(store.relatedRows("recommended")).toHaveLength(0);
  });

  it("tab 不匹配时保留 pending（不消费）", async () => {
    const store = await loadStore();
    store.recordRelatedAnchor("follow", 1);
    await flush();
    await store.consumeRelatedAnchor("recommended", []);
    // pending 仍在：正确的 tab 消费成功
    mockState.fetchQuery.mockResolvedValue({ illusts: [createIllust(11)] });
    await store.consumeRelatedAnchor("follow", []);
    await flush();
    expect(store.relatedRows("follow")).toHaveLength(1);
    expect(store.relatedRows("recommended")).toHaveLength(0);
  });

  it("成功路径：注入行排除锚点自身与主列表已展示 id", async () => {
    const store = await loadStore();
    store.recordRelatedAnchor("recommended", 1);
    await flush();
    mockState.fetchQuery.mockResolvedValue({
      illusts: [createIllust(1), createIllust(2), createIllust(3)],
    });
    await store.consumeRelatedAnchor("recommended", [2]);
    await flush();
    const rows = store.relatedRows("recommended");
    expect(rows).toHaveLength(1);
    expect(rows[0].anchorId).toBe(1);
    expect(rows[0].loading).toBe(false);
    expect(rows[0].items.map((i) => i.id)).toEqual([3]);
  });

  it("过滤链生效：R18（开关默认关）条目被过滤", async () => {
    const store = await loadStore();
    store.recordRelatedAnchor("recommended", 1);
    await flush();
    mockState.fetchQuery.mockResolvedValue({
      illusts: [createIllust(4, 1), createIllust(5)],
    });
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(store.relatedRows("recommended")[0].items.map((i) => i.id)).toEqual([5]);
  });

  it("过滤后为空 → 不注入行", async () => {
    const store = await loadStore();
    store.recordRelatedAnchor("recommended", 1);
    await flush();
    mockState.fetchQuery.mockResolvedValue({ illusts: [createIllust(1)] });
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(store.relatedRows("recommended")).toHaveLength(0);
  });

  it("同锚点不重复注入；达 MAX_ANCHORS=3 上限后不再注入", async () => {
    const store = await loadStore();
    mockState.fetchQuery.mockResolvedValue({ illusts: [createIllust(10)] });
    for (const id of [1, 2, 3]) {
      store.recordRelatedAnchor("recommended", id);
      await flush();
      await store.consumeRelatedAnchor("recommended", []);
      await flush();
    }
    expect(store.relatedRows("recommended")).toHaveLength(3);
    store.recordRelatedAnchor("recommended", 4);
    await flush();
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(store.relatedRows("recommended")).toHaveLength(3);
    // 同锚点重复消费也不新增
    store.recordRelatedAnchor("recommended", 1);
    await flush();
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(store.relatedRows("recommended")).toHaveLength(3);
  });

  it("失败路径：行被移除且 warn（禁止静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = await loadStore();
    store.recordRelatedAnchor("recommended", 1);
    await flush();
    mockState.fetchQuery.mockRejectedValue(new Error("boom"));
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(store.relatedRows("recommended")).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("relatedInjection"),
      expect.any(Error),
    );
    warnSpy.mockRestore();
  });

  it("开关关闭：pending 被消费但不注入", async () => {
    const store = await loadStore({ related_injection: "false" });
    store.recordRelatedAnchor("recommended", 1);
    await flush();
    mockState.fetchQuery.mockResolvedValue({ illusts: [createIllust(11)] });
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(store.relatedRows("recommended")).toHaveLength(0);
    expect(mockState.fetchQuery).not.toHaveBeenCalled();
  });

  it("removeRow / clearRows", async () => {
    const store = await loadStore();
    mockState.fetchQuery.mockResolvedValue({ illusts: [createIllust(10)] });
    store.recordRelatedAnchor("recommended", 1);
    await flush();
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    store.recordRelatedAnchor("recommended", 2);
    await flush();
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(store.relatedRows("recommended")).toHaveLength(2);
    store.removeRelatedRow("recommended", 1);
    await flush();
    expect(store.relatedRows("recommended").map((r) => r.anchorId)).toEqual([2]);
    store.clearRelatedRows("recommended");
    await flush();
    expect(store.relatedRows("recommended")).toHaveLength(0);
  });

  it('queryKey 契约：["related", illustId]', async () => {
    const store = await loadStore();
    store.recordRelatedAnchor("recommended", 42);
    await flush();
    mockState.fetchQuery.mockResolvedValue({ illusts: [createIllust(11)] });
    await store.consumeRelatedAnchor("recommended", []);
    await flush();
    expect(mockState.fetchQuery).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ["related", 42] }),
    );
  });
});
