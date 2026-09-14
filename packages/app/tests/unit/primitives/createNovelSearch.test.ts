// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// ADR-0144：2.0 微任务批处理下，setter 写需经 flush 同步生效后才能同步断言；
// 且 owned scope（createRoot body）内禁止同步写——setQuery/nextMatch 等在真实调用点
// （事件处理器）运行时无 owner，测试以 runWithOwner(null) 模拟同一语境
import { createRoot, createSignal, flush, runWithOwner } from "solid-js";

/** 模拟事件处理器语境（无 active owner）驱动同步写路径（flush 排空效应 apply 亦须在此语境） */
const fire = <T>(fn: () => T): T => runWithOwner(null, fn);
import {
  findMatches,
  clearHighlights,
  applyHighlights,
  createNovelSearch,
  type NovelSearchMatch,
} from "@/primitives/createNovelSearch";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("findMatches", () => {
  it("returns empty array for empty query", () => {
    expect(findMatches(["hello world"], "", false)).toEqual([]);
  });

  it("returns empty array when no match", () => {
    expect(findMatches(["hello world"], "foo", false)).toEqual([]);
  });

  it("finds a single match", () => {
    expect(findMatches(["hello world"], "world", false)).toEqual([
      { paragraphIndex: 0, start: 6, end: 11 },
    ]);
  });

  it("finds multiple matches in one paragraph", () => {
    expect(findMatches(["a b a c a"], "a", false)).toEqual([
      { paragraphIndex: 0, start: 0, end: 1 },
      { paragraphIndex: 0, start: 4, end: 5 },
      { paragraphIndex: 0, start: 8, end: 9 },
    ]);
  });

  it("finds matches across paragraphs", () => {
    expect(findMatches(["hello world", "world peace"], "world", false)).toEqual([
      { paragraphIndex: 0, start: 6, end: 11 },
      { paragraphIndex: 1, start: 0, end: 5 },
    ]);
  });

  it("is case-insensitive by default", () => {
    expect(findMatches(["Hello World"], "world", false)).toEqual([
      { paragraphIndex: 0, start: 6, end: 11 },
    ]);
  });

  it("supports case-sensitive search", () => {
    expect(findMatches(["Hello World"], "world", true)).toEqual([]);
    expect(findMatches(["Hello World"], "World", true)).toEqual([
      { paragraphIndex: 0, start: 6, end: 11 },
    ]);
  });

  it("handles Chinese and Japanese mixed text", () => {
    const paragraphs = ["这是一段小说正文。", "これは小説です。"];
    expect(findMatches(paragraphs, "小说", false)).toEqual([
      { paragraphIndex: 0, start: 4, end: 6 },
    ]);
    expect(findMatches(paragraphs, "小説", false)).toEqual([
      { paragraphIndex: 1, start: 3, end: 5 },
    ]);
  });

  it("skips empty paragraphs", () => {
    expect(findMatches(["hello", "", "world"], "world", false)).toEqual([
      { paragraphIndex: 2, start: 0, end: 5 },
    ]);
  });

  it("caps matches at maxMatches", () => {
    const paragraphs = ["a a a a a a a a a a"];
    expect(findMatches(paragraphs, "a", false, 5)).toHaveLength(5);
  });

  it("does not find overlapping matches", () => {
    expect(findMatches(["aaa"], "aa", false)).toEqual([{ paragraphIndex: 0, start: 0, end: 2 }]);
  });
});

describe("clearHighlights", () => {
  it("unwraps all mark elements and restores text", () => {
    const container = document.createElement("div");
    container.innerHTML =
      '<p><mark class="novel-search-match">world</mark></p><p>foo<mark class="novel-search-match">bar</mark>baz</p>';

    clearHighlights(container);

    expect(container.querySelectorAll("mark.novel-search-match")).toHaveLength(0);
    expect(container.textContent).toBe("worldfoobarbaz");
    expect(container.querySelector("p")?.childNodes.length).toBe(1);
    expect(container.querySelector("p")?.childNodes[0].nodeType).toBe(Node.TEXT_NODE);
  });
});

describe("applyHighlights", () => {
  it("wraps matching text with mark elements and marks active index", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello world</p><p>foo bar</p>";

    const paragraphs = ["hello world", "foo bar"];
    const matches: NovelSearchMatch[] = [
      { paragraphIndex: 0, start: 6, end: 11 },
      { paragraphIndex: 1, start: 0, end: 3 },
    ];

    applyHighlights(container, paragraphs, matches, 1);

    const marks = container.querySelectorAll("mark.novel-search-match");
    expect(marks).toHaveLength(2);
    expect(marks[0].textContent).toBe("world");
    expect(marks[1].textContent).toBe("foo");
    expect(marks[1].dataset.matchIndex).toBe("1");
    expect(marks[1].classList.contains("novel-search-match-active")).toBe(true);
    expect(marks[0].classList.contains("novel-search-match-active")).toBe(false);
  });

  it("preserves non-matching text nodes", () => {
    const container = document.createElement("div");
    container.innerHTML = "<p>hello world</p>";

    const paragraphs = ["hello world"];
    const matches: NovelSearchMatch[] = [{ paragraphIndex: 0, start: 6, end: 11 }];

    applyHighlights(container, paragraphs, matches, 0);

    const p = container.querySelector("p")!;
    expect(p.childNodes.length).toBe(2);
    expect(p.childNodes[0].textContent).toBe("hello ");
    expect(p.childNodes[1].textContent).toBe("world");
  });

  it("clears previous highlights before applying new ones", () => {
    const container = document.createElement("div");
    container.innerHTML = '<p><mark class="novel-search-match">old</mark></p>';

    const paragraphs = ["new text"];
    const matches: NovelSearchMatch[] = [{ paragraphIndex: 0, start: 0, end: 3 }];

    applyHighlights(container, paragraphs, matches, 0);

    const marks = container.querySelectorAll("mark.novel-search-match");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("new");
  });
});

describe("createNovelSearch", () => {
  it("returns empty matches for empty query", () =>
    createRoot((dispose) => {
      const [text] = createSignal<string | null>("hello world\n\nfoo bar");
      const search = createNovelSearch(text);
      expect(search.matches()).toEqual([]);
      expect(search.activeIndex()).toBe(-1);
      dispose();
    }));

  it("finds matches after setting query", () =>
    createRoot((dispose) => {
      const [text] = createSignal<string | null>("hello world\n\nfoo bar");
      const search = createNovelSearch(text, { debounceMs: 100 });
      // 事件处理器语境（无 owner）：setQuery 与其排定的 debounce 回调内的写均在此语境执行
      fire(() => {
        search.setQuery("world");
        vi.advanceTimersByTime(100);
      });
      fire(flush); // ADR-0144：批处理下 set 后同步读为旧值，排空须在无 owner 语境执行
      expect(search.matches()).toEqual([{ paragraphIndex: 0, start: 6, end: 11 }]);
      expect(search.activeIndex()).toBe(0);
      dispose();
    }));

  it("provides getMatchesForParagraph filtered by paragraph", () =>
    createRoot((dispose) => {
      const search = createNovelSearch(() => "hello world\n\nfoo bar", {
        debounceMs: 100,
      });
      fire(() => {
        search.setQuery("o");
        vi.advanceTimersByTime(100);
      });
      fire(flush); // ADR-0144：批处理下 set 后同步读为旧值，排空须在无 owner 语境执行

      const paragraph0Matches = search.getMatchesForParagraph(0);
      const paragraph1Matches = search.getMatchesForParagraph(1);
      expect(paragraph0Matches.length).toBe(2);
      expect(paragraph1Matches.length).toBe(2);
      expect(paragraph0Matches[0]).toEqual({
        paragraphIndex: 0,
        start: 4,
        end: 5,
      });
      dispose();
    }));

  it("navigates matches with nextMatch and prevMatch", () =>
    createRoot((dispose) => {
      const search = createNovelSearch(() => "a b a", { debounceMs: 100 });
      fire(() => {
        search.setQuery("a");
        vi.advanceTimersByTime(100);
      });
      fire(flush); // ADR-0144：批处理下 set 后同步读为旧值，排空须在无 owner 语境执行

      expect(search.matches()).toHaveLength(2);
      expect(search.activeIndex()).toBe(0);
      fire(() => search.nextMatch()); // 事件处理器语境（无 owner）
      fire(flush); // 同上
      expect(search.activeIndex()).toBe(1);
      fire(() => search.nextMatch());
      fire(flush); // 同上
      expect(search.activeIndex()).toBe(0);
      fire(() => search.prevMatch());
      fire(flush); // 同上
      expect(search.activeIndex()).toBe(1);
      dispose();
    }));

  it("clears search state", () =>
    createRoot((dispose) => {
      const search = createNovelSearch(() => "hello world", { debounceMs: 100 });
      fire(() => {
        search.setQuery("world");
        vi.advanceTimersByTime(100);
      });
      fire(flush); // ADR-0144：批处理下 set 后同步读为旧值，排空须在无 owner 语境执行
      expect(search.matches()).toHaveLength(1);

      fire(() => search.clearSearch()); // 事件处理器语境（无 owner）
      fire(flush); // 同上
      expect(search.query()).toBe("");
      expect(search.matches()).toEqual([]);
      expect(search.activeIndex()).toBe(-1);
      dispose();
    }));
});
