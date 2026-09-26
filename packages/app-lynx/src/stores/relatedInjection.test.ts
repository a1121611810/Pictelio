// 相关作品注入行状态机（lynx）单元测试（spec docs/specs/related-injection.md §3/§4/§6）。
// Oracle 溯源：状态语义与 app 端 relatedInjectionStore.test.ts 同源（spec §4）。
// isRestricted mock = 真实两态契约的镜像（!showR18∧x=1 ∨ !showR18G∧x=2；两态矩阵本身由
// settingsStore.test.ts 12 例真实实现守卫，此处不重写实现，仅消费契约）。
import { describe, expect, it, vi, beforeEach } from "vitest";

const mockState = vi.hoisted(() => ({
  relatedInjection: true,
  showR18: false,
  showR18G: false,
  /** 静音词表（ADR-0187 / #732）：真实 isTagMuted 语义镜像（tags[].name.trim() ∈ 集合） */
  mutedTags: new Set<string>(),
  loadRelated: vi.fn(),
}));

vi.mock("./settingsStore", () => ({
  useSettingsStore: () => ({
    relatedInjection: mockState.relatedInjection,
    isRestricted: (i: { x_restrict: number }) =>
      (!mockState.showR18 && i.x_restrict === 1) || (!mockState.showR18G && i.x_restrict === 2),
    isAiRestricted: (_i: unknown) => false,
    isTagMuted: (item: { tags?: { name: string }[] | null }): boolean => {
      const list = mockState.mutedTags;
      if (list.size === 0) return false;
      const tags = item?.tags;
      if (!tags || tags.length === 0) return false;
      return tags.some((tag) => list.has(tag.name.trim()));
    },
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

/** 带标签的作品（静音过滤链用例） */
function taggedIllust(id: number, names: string[]) {
  return { ...illust(id), tags: names.map((name) => ({ name })) };
}

/** 每个 tab 独立会话：tab 隔离验证用 */
const tabs: RelatedFeedTab[] = ["recommend", "follow"];

describe("relatedInjection store（lynx，spec §4）", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockState.relatedInjection = true;
    mockState.showR18 = false;
    mockState.showR18G = false;
    mockState.mutedTags.clear();
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

  it("R18G 开关关闭时 x_restrict=2 被过滤（两态契约）", async () => {
    const store = useRelatedInjectionStore();
    mockState.showR18 = true;
    mockState.loadRelated.mockResolvedValue({
      illusts: [illust(6, 2), illust(7)],
    });
    store.recordAnchor("recommend", 14);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")[0].items.map((i) => i.id)).toEqual([7]);
  });

  // 标签静音过滤链（ADR-0187 D4 / #732）：命中词表条目在注入行组装层移除
  it("静音标签命中条目被过滤（含 trim 命中）；空 tags / 无命中放行", async () => {
    const store = useRelatedInjectionStore();
    mockState.mutedTags.add("R-18G");
    mockState.mutedTags.add("グロ");
    mockState.loadRelated.mockResolvedValue({
      illusts: [
        taggedIllust(51, ["風景", "R-18G"]), // 任一标签命中 → 移除
        taggedIllust(52, ["  グロ  "]), // 作品侧未 trim 的 name 与存储态 trim 后相等 → 移除
        taggedIllust(53, ["風景"]), // 未命中 → 保留
        taggedIllust(54, []), // 空 tags → 放行
        illust(55), // 无 tags 字段 → 放行
      ],
    });
    store.recordAnchor("recommend", 50);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rows("recommend")[0].items.map((i) => i.id)).toEqual([53, 54, 55]);
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

describe("rowFor（ADR-0162 卡内展开段渲染查询）", () => {
  it("命中 / 未命中 / tab 隔离", async () => {
    const store = useRelatedInjectionStore();
    mockState.loadRelated.mockResolvedValue({ illusts: [illust(11)] });
    store.recordAnchor("recommend", 55);
    await store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rowFor("recommend", 55)?.loading).toBe(false);
    expect(store.rowFor("recommend", 999)).toBeUndefined();
    expect(store.rowFor("follow", 55)).toBeUndefined();
  });

  it("loading 态透传：消费即占位，填充前可查（卡内骨架渲染输入）", async () => {
    const store = useRelatedInjectionStore();
    let resolveFetch!: (v: { illusts: ReturnType<typeof illust>[] }) => void;
    mockState.loadRelated.mockReturnValue(
      new Promise((r) => {
        resolveFetch = r;
      }),
    );
    store.recordAnchor("recommend", 66);
    const pending = store.consumeAnchor("recommend", []);
    await flush();
    expect(store.rowFor("recommend", 66)?.loading).toBe(true);
    expect(store.rowFor("recommend", 66)?.items).toHaveLength(0);
    resolveFetch({ illusts: [illust(12)] });
    await pending;
    await flush();
    const row = store.rowFor("recommend", 66);
    expect(row?.loading).toBe(false);
    expect(row?.items).toHaveLength(1);
  });
});
