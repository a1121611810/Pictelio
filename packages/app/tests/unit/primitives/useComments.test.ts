import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";
import type { UseCommentsResult } from "@/primitives/useComments";

// Polyfill IntersectionObserver for Node.js test environment
class MockIntersectionObserver {
  readonly root: Element | Document | null = null;
  readonly rootMargin: string = "";
  readonly thresholds: ReadonlyArray<number> = [];
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  takeRecords = vi.fn(() => []);
  constructor(_callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {
    this.root = _options?.root ?? null;
    this.rootMargin = _options?.rootMargin ?? "";
    this.thresholds = _options?.threshold
      ? Array.isArray(_options.threshold)
        ? _options.threshold
        : [_options.threshold]
      : [0];
  }
}
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

const mockLoadRootComments = vi.fn();
const mockLoadRootCommentsNext = vi.fn();
const mockPostComment = vi.fn().mockResolvedValue(undefined);
const mockDeleteComment = vi.fn();

vi.mock("@/api/comment", () => ({
  loadRootComments: (...args: unknown[]) => mockLoadRootComments(...args),
  loadRootCommentsNext: (...args: unknown[]) => mockLoadRootCommentsNext(...args),
  postComment: (...args: unknown[]) => mockPostComment(...args),
  deleteComment: (...args: unknown[]) => mockDeleteComment(...args),
}));

async function loadUseComments(): Promise<{
  useComments: (
    type: () => "illust" | "novel",
    targetId: () => number,
    enabled: () => boolean,
  ) => UseCommentsResult;
}> {
  vi.resetModules();
  return import("@/primitives/useComments");
}

/** Helper: wrap useComments in createRoot, return result + dispose */
function createUseComments(
  useComments: ReturnType<typeof loadUseComments> extends Promise<infer T>
    ? T["useComments"]
    : never,
  type: "illust" | "novel",
  targetId: number,
  enabled: boolean,
): { result: UseCommentsResult; dispose: () => void } {
  let result!: UseCommentsResult;
  const dispose = createRoot((d) => {
    result = useComments(
      () => type,
      () => targetId,
      () => enabled,
    );
    return d;
  });
  return { result, dispose };
}

describe("useComments primitive", () => {
  beforeEach(() => {
    mockLoadRootComments.mockReset();
    mockLoadRootCommentsNext.mockReset();
    mockPostComment.mockClear();
    mockDeleteComment.mockReset();
  });

  it("returns initial state", async () => {
    const { useComments } = await loadUseComments();
    const { result, dispose } = createUseComments(useComments, "illust", 123, false);

    expect(result.comments()).toEqual([]);
    expect(result.hasLoaded()).toBe(false);
    // loading() is true initially because !hasLoaded && !error
    expect(result.loading()).toBe(true);
    expect(result.hasMore()).toBe(false);
    expect(result.error()).toBeNull();
    expect(result.postError()).toBeNull();
    expect(result.posting()).toBe(false);
    expect(result.deletingId()).toBeNull();

    dispose();
  });

  it("calls loadRootComments when enabled", async () => {
    mockLoadRootComments.mockResolvedValue({
      comments: [],
      next_url: null,
    });

    const { useComments } = await loadUseComments();
    const { dispose } = createUseComments(useComments, "illust", 123, true);

    // Wait for createEffect microtask + promise resolution
    await vi.waitFor(() => {
      expect(mockLoadRootComments).toHaveBeenCalledWith("illust", 123, expect.any(Object));
    });

    dispose();
  });

  it("does not call loadRootComments when disabled", async () => {
    const { useComments } = await loadUseComments();
    const { dispose } = createUseComments(useComments, "illust", 123, false);

    // Small delay to ensure effect didn't fire
    await new Promise((r) => setTimeout(r, 20));
    expect(mockLoadRootComments).not.toHaveBeenCalled();

    dispose();
  });

  it("loadMore calls loadRootCommentsNext and appends", async () => {
    mockLoadRootComments.mockResolvedValue({
      comments: [
        { id: 1, comment: "a", user: { id: 1, name: "u" }, date: "2024-01-01T00:00:00+00:00" },
      ],
      next_url: "https://next.url",
    });
    mockLoadRootCommentsNext.mockResolvedValue({
      comments: [
        { id: 2, comment: "b", user: { id: 1, name: "u" }, date: "2024-01-01T00:00:00+00:00" },
      ],
      next_url: null,
    });

    const { useComments } = await loadUseComments();
    const { result, dispose } = createUseComments(useComments, "illust", 123, true);

    // Wait for initial load
    await vi.waitFor(() => {
      expect(result.comments()).toHaveLength(1);
    });
    expect(result.hasMore()).toBe(true);

    // Trigger loadMore
    result.loadMore();

    // Wait for loadMore to resolve
    await vi.waitFor(() => {
      expect(result.comments()).toHaveLength(2);
    });
    expect(mockLoadRootCommentsNext).toHaveBeenCalledWith("https://next.url");
    expect(result.hasMore()).toBe(false);

    dispose();
  });

  it("postComment sends and refreshes list", async () => {
    mockLoadRootComments
      .mockResolvedValueOnce({
        comments: [],
        next_url: null,
      })
      .mockResolvedValueOnce({
        comments: [
          {
            id: 42,
            comment: "new",
            user: { id: 1, name: "me" },
            date: "2024-01-01T00:00:00+00:00",
          },
        ],
        next_url: null,
      });

    const { useComments } = await loadUseComments();
    const { result, dispose } = createUseComments(useComments, "illust", 123, true);

    // Wait for initial load
    await vi.waitFor(() => {
      expect(result.comments()).toHaveLength(0);
    });

    // Post
    await result.post("new comment");

    expect(mockPostComment).toHaveBeenCalledWith("illust", 123, "new comment", undefined);
    // The list should be refreshed (2nd loadRootComments call)
    expect(mockLoadRootComments).toHaveBeenCalledTimes(2);
    expect(result.comments()).toHaveLength(1);
    expect(result.comments()[0].id).toBe(42);
    expect(result.posting()).toBe(false);

    dispose();
  });

  it("deleteComment removes from list", async () => {
    mockLoadRootComments.mockResolvedValue({
      comments: [
        { id: 1, comment: "keep", user: { id: 1, name: "u" }, date: "2024-01-01T00:00:00+00:00" },
        { id: 2, comment: "remove", user: { id: 1, name: "u" }, date: "2024-01-01T00:00:00+00:00" },
      ],
      next_url: null,
    });
    mockDeleteComment.mockResolvedValue(undefined);

    const { useComments } = await loadUseComments();
    const { result, dispose } = createUseComments(useComments, "illust", 123, true);

    // Wait for initial load
    await vi.waitFor(() => {
      expect(result.comments()).toHaveLength(2);
    });

    // Delete
    await result.remove(2);

    expect(mockDeleteComment).toHaveBeenCalledWith("illust", 2);
    expect(result.comments()).toHaveLength(1);
    expect(result.comments()[0].id).toBe(1);
    expect(result.deletingId()).toBeNull();

    dispose();
  });

  it("handles post error gracefully", async () => {
    mockLoadRootComments.mockResolvedValue({ comments: [], next_url: null });

    const { useComments } = await loadUseComments();
    const { result, dispose } = createUseComments(useComments, "illust", 123, true);

    await vi.waitFor(() => {
      expect(result.comments()).toHaveLength(0);
    });

    mockPostComment.mockRejectedValue(new Error("Network error"));

    await result.post("fail");
    expect(result.postError()).toBe("发送失败，请重试");
    expect(result.posting()).toBe(false);

    dispose();
  });
});
