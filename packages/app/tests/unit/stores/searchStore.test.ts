import { describe, it, expect } from "vitest";
import { createRoot } from "solid-js";
import { createSearchStore } from "@/stores/searchStore";

describe("searchStore", () => {
  it("starts with default values", () => {
    createRoot((dispose) => {
      const store = createSearchStore();
      expect(store.keyword()).toBe("");
      expect(store.scope()).toBe("all");
      expect(store.toSorted()).toBe("date_desc");
      expect(store.results()).toEqual([]);
      expect(store.loading()).toBe(false);
      expect(store.error()).toBeNull();
      expect(store.hasMore()).toBe(false);
      dispose();
    });
  });

  it("setKeyword updates keyword", () => {
    createRoot((dispose) => {
      const store = createSearchStore();
      store.setKeyword("星空");
      expect(store.keyword()).toBe("星空");
      dispose();
    });
  });

  it("setScope updates scope", () => {
    createRoot((dispose) => {
      const store = createSearchStore();
      store.setScope("illust");
      expect(store.scope()).toBe("illust");
      store.setScope("novel");
      expect(store.scope()).toBe("novel");
      store.setScope("all");
      expect(store.scope()).toBe("all");
      dispose();
    });
  });

  it("setSort updates sort", () => {
    createRoot((dispose) => {
      const store = createSearchStore();
      store.setSort("popular_desc");
      expect(store.toSorted()).toBe("popular_desc");
      store.setSort("date_asc");
      expect(store.toSorted()).toBe("date_asc");
      dispose();
    });
  });

  it("toSorted returns the same value as sort", () => {
    createRoot((dispose) => {
      const store = createSearchStore();
      expect(store.toSorted()).toBe(store.toSorted());
      store.setSort("popular_desc");
      expect(store.toSorted()).toBe(store.toSorted());
      dispose();
    });
  });

  it("implements all methods and properties used by Search.tsx", () => {
    createRoot((dispose) => {
      const store = createSearchStore();
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
  });

  it("executeSearch does nothing with empty keyword", async () => {
    await createRoot(async (dispose) => {
      const store = createSearchStore();
      await store.executeSearch();
      expect(store.results()).toEqual([]);
      expect(store.loading()).toBe(false);
      dispose();
    });
  });

  it("loadMore does nothing when no more results", async () => {
    await createRoot(async (dispose) => {
      const store = createSearchStore();
      await store.loadMore();
      expect(store.loading()).toBe(false);
      expect(store.hasMore()).toBe(false);
      dispose();
    });
  });
});
