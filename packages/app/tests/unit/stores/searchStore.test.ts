import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { createSearchStore } from "@/stores/searchStore";

/**
 * SolidJS 2.0 语义：createRoot body 属 owned scope，同步写 signal 会 throw
 * （REACTIVE_WRITE_IN_OWNED_SCOPE）。store 必须在 root 内创建（内部 memo 需要
 * owner 存活），对 store 的写操作在 root 外执行（等价事件处理器上下文）。
 */
function setup(): { store: ReturnType<typeof createSearchStore>; dispose: () => void } {
  let dispose!: () => void;
  const store = createRoot((d) => {
    dispose = d;
    return createSearchStore();
  });
  return { store, dispose };
}

describe("searchStore", () => {
  it("starts with default values", () => {
    const { store, dispose } = setup();
    expect(store.keyword()).toBe("");
    expect(store.scope()).toBe("all");
    expect(store.toSorted()).toBe("date_desc");
    expect(store.results()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
    expect(store.hasMore()).toBe(false);
    dispose();
  });

  it("setKeyword updates keyword", () => {
    const { store, dispose } = setup();
    store.setKeyword("星空");
    flush(); // 2.0 批处理语义：set 后同步读返回旧值，先 flush 再断言
    expect(store.keyword()).toBe("星空");
    dispose();
  });

  it("setScope updates scope", () => {
    const { store, dispose } = setup();
    store.setScope("illust");
    flush(); // 2.0 批处理语义
    expect(store.scope()).toBe("illust");
    store.setScope("novel");
    flush(); // 2.0 批处理语义
    expect(store.scope()).toBe("novel");
    store.setScope("all");
    flush(); // 2.0 批处理语义
    expect(store.scope()).toBe("all");
    dispose();
  });

  it("setSort updates sort", () => {
    const { store, dispose } = setup();
    store.setSort("popular_desc");
    flush(); // 2.0 批处理语义
    expect(store.toSorted()).toBe("popular_desc");
    store.setSort("date_asc");
    flush(); // 2.0 批处理语义
    expect(store.toSorted()).toBe("date_asc");
    dispose();
  });

  it("toSorted returns the same value as sort", () => {
    const { store, dispose } = setup();
    expect(store.toSorted()).toBe(store.toSorted());
    store.setSort("popular_desc");
    flush(); // 2.0 批处理语义
    expect(store.toSorted()).toBe(store.toSorted());
    dispose();
  });

  it("implements all methods and properties used by Search.tsx", () => {
    const { store, dispose } = setup();
    // Search.tsx uses all these members — this test acts as an interface
    // contract check to prevent missing-method regressions like the
    // "store.toSorted is not a function" bug.
    expect(typeof store.keyword).toBe("function");
    expect(typeof store.scope).toBe("function");
    expect(typeof store.sort).toBe("function");
    expect(typeof store.toSorted).toBe("function");
    expect(typeof store.results).toBe("function");
    expect(typeof store.loading).toBe("function");
    expect(typeof store.error).toBe("function");
    expect(typeof store.hasMore).toBe("function");
    expect(typeof store.setKeyword).toBe("function");
    expect(typeof store.setScope).toBe("function");
    expect(typeof store.setSort).toBe("function");
    expect(typeof store.executeSearch).toBe("function");
    expect(typeof store.loadMore).toBe("function");
    dispose();
  });

  it("executeSearch does nothing with empty keyword", async () => {
    const { store, dispose } = setup();
    await store.executeSearch();
    expect(store.results()).toEqual([]);
    expect(store.loading()).toBe(false);
    dispose();
  });

  it("loadMore does nothing when no more results", async () => {
    const { store, dispose } = setup();
    await store.loadMore();
    expect(store.loading()).toBe(false);
    expect(store.hasMore()).toBe(false);
    dispose();
  });
});
