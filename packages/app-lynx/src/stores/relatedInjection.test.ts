// 相关作品注入行状态机（lynx）单元测试（spec docs/specs/related-injection.md §3/§4/§6）。
// Oracle 溯源：状态语义与 app 端 relatedInjectionStore.test.ts 同源（spec §4）；
// settings 以 mock 注入（isRestricted = x_restrict===1，与 settingsStore 遮罩判定契约一致）。
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  relatedInjection: true,
  loadRelated: vi.fn(),
}));

vi.mock("./settingsStore", () => ({
  useSettingsStore: () => ({
    relatedInjection: mockState.relatedInjection,
    isRestricted: (i: { x_restrict: number }) => i.x_restrict === 1,
    isAiRestricted: (_i: unknown) => false,
  }),
}));

vi.mock("../api/illust", () => ({
  loadRelated: mockState.loadRelated,
}));

import { useRelatedInjectionStore, MAX_RELATED_ANCHORS, type RelatedFeedTab } from "./relatedInjection";
import { createPinia, setActivePinia } from "pinia";

const flush = () => new Promise<void>((r) => setTimeout(r, 0));

function illust(id: number, xRestrict = 0) {
  return {
    id,
    title: `work-${id}`,
    x_restrict: xRestrict,
    image_urls: { square_medium: "", medium: "", large: "" },
    user: { id: 1, name: "u" },
  };
}

/** 每个 tab 独立会话：tab 隔离验证用 */
const tabs: RelatedFeedTab[] = ["recommend", "follow"];

describe("relatedInjection store（lynx，spec §4）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockState.relatedInjection = true;
    mockState.loadRelated.mockReset();
  });

  it("无 pending 锚点消费为 no-op", async () => {
    const store = useRelatedInjectionStore();
    await store.consumeAnchor("recommend", []);
    expect(store.rows("recommend")).toHaveLength(0);
  });

  it("成功路径：注入行排除锚点与主列表 id，过滤 R18", async () => {
    const store = useRelatedInjectionStore();
    mockState.loadRelated.mockResolvedValue({ illusts: [illust(1), illust(2), illust(3, 1), illust(4)] });
    store.recordAnchor("recommend", 11);
    await store.consumeAnchor("recommend", [2]);
    await flush();
    const rows = store.rows("recommend");
    expect(rows).toHaveLength(1);
    expect(rows[0].anchorId).toBe(11);
    expect(rows[0].loading).toBe(false);
    // 锚点 11 不在 related 列表内、主列表 2 排除、R18 3 过滤 → 剩 1、4
    expect(rows[0].items.map((i) => i.id)).toEqual([1, 4]);
    expect(mockState.loadRelated).toHaveBeenCalledWith(11);
  });

  it("过滤后为空 → 不注入行", async () => {
    const store = useRelatedInjectionStore();
    // 锚点 12 自身 + 主列表 2 被排除、R18 3 过滤 → 空行移除
    mockState.loadRelated.mockResolvedValue({ illusts: [illust(12), illust(2), illust(3, 1)] });
    store.recordAnchor("recommend", 12);
    await store.consumeAnchor("recommend", [2]);
    await flush();
    expect(store.rows("recommend")).toHaveLength(0);
  });

  it("行内容过滤后非空则注入", async () => {
    const store = useRelatedInjectionStore();
    mockState.loadRelated.mockResolvedValue({ illusts: [illust(5)] });
    store.recordAnchor("recommend", 13);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")[0].items.map((i) => i.id)).toEqual([5]);
  });

  it("上限 MAX_RELATED_ANCHORS=3 与同锚点去重", async () => {
    const store = useRelatedInjectionStore();
    mockState.loadRelated.mockResolvedValue({ illusts: [illust(9)] });
    for (const id of [21, 22, 23]) {
      store.recordAnchor("recommend", id);
      await store.consumeAnchor("recommend", []);
      await flush();
    }
    expect(store.rows("recommend")).toHaveLength(MAX_RELATED_ANCHORS);
    store.recordAnchor("recommend", 24);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")).toHaveLength(MAX_RELATED_ANCHORS);
    store.recordAnchor("recommend", 21);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")).toHaveLength(MAX_RELATED_ANCHORS);
  });

  it("失败路径：行移除 + warn（禁静默降级）", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const store = useRelatedInjectionStore();
    mockState.loadRelated.mockRejectedValue(new Error("boom"));
    store.recordAnchor("recommend", 31);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("relatedInjection"), expect.anything());
    warnSpy.mockRestore();
  });

  it("开关关闭：消费但不注入、不发请求", async () => {
    mockState.relatedInjection = false;
    const store = useRelatedInjectionStore();
    store.recordAnchor("recommend", 32);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")).toHaveLength(0);
    expect(mockState.loadRelated).not.toHaveBeenCalled();
  });

  it("tab 隔离：recommend 的锚点不被 follow 消费", async () => {
    const store = useRelatedInjectionStore();
    mockState.loadRelated.mockResolvedValue({ illusts: [illust(7)] });
    store.recordAnchor("recommend", 33);
    await store.consumeAnchor("follow", []);
    await flush();
    expect(store.rows("follow")).toHaveLength(0);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")).toHaveLength(1);
  });

  it("removeRow / clearRows（含跨 tab 隔离）", async () => {
    const store = useRelatedInjectionStore();
    mockState.loadRelated.mockResolvedValue({ illusts: [illust(9)] });
    for (const tab of tabs) {
      store.recordAnchor(tab, 41);
      await store.consumeAnchor(tab, []);
      await flush();
    }
    store.removeRow("recommend", 41);
    await flush();
    expect(store.rows("recommend")).toHaveLength(0);
    expect(store.rows("follow")).toHaveLength(1);
    store.clearRows("follow");
    await flush();
    expect(store.rows("follow")).toHaveLength(0);
  });
});
