// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { createRoot } from "solid-js";
import { useCardInteractions } from "@/primitives/useCardInteractions";
import type { PixivIllust } from "@/api/types";

// Mock the API module before importing useCardInteractions
vi.mock("@/api/illust", () => ({
  addBookmark: vi.fn().mockResolvedValue(undefined),
  deleteBookmark: vi.fn().mockResolvedValue(undefined),
  followUser: vi.fn().mockResolvedValue(undefined),
  unfollowUser: vi.fn().mockResolvedValue(undefined),
}));

import * as illustApi from "@/api/illust";

function makeIllust(overrides: Partial<PixivIllust> = {}): PixivIllust {
  return {
    id: 123,
    title: "Test Illust",
    type: "illust",
    user: {
      id: 456,
      name: "Author",
      account: "author",
      profile_image_urls: {},
      is_followed: false,
    },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 800,
    height: 600,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 10,
    total_view: 100,
    tags: [],
    x_restrict: 0,
    create_date: "2024-01-01T00:00:00+09:00",
    meta_pages: [],
    meta_single_page: {},
    ...overrides,
  };
}

describe("useCardInteractions", () => {
  describe("initial state", () => {
    it("returns bookmarked from illust.is_bookmarked", () =>
      createRoot((dispose) => {
        const illust = makeIllust({ is_bookmarked: true });
        const { bookmarked } = useCardInteractions(illust);
        expect(bookmarked()).toBe(true);
        dispose();
      }));

    it("returns isFollowed from illust.user.is_followed", () =>
      createRoot((dispose) => {
        const illust = makeIllust({
          user: { ...makeIllust().user, is_followed: true },
        });
        const { isFollowed } = useCardInteractions(illust);
        expect(isFollowed()).toBe(true);
        dispose();
      }));

    it("defaults isFollowed to false when not set", () =>
      createRoot((dispose) => {
        const illust = makeIllust({
          user: { ...makeIllust().user, is_followed: undefined },
        });
        const { isFollowed } = useCardInteractions(illust);
        expect(isFollowed()).toBe(false);
        dispose();
      }));

    it("initial bookmarkBurstTrigger is 0", () =>
      createRoot((dispose) => {
        const { bookmarkBurstTrigger } = useCardInteractions(makeIllust());
        expect(bookmarkBurstTrigger()).toBe(0);
        dispose();
      }));

    it("initial privateHint is false", () =>
      createRoot((dispose) => {
        const { privateHint } = useCardInteractions(makeIllust());
        expect(privateHint()).toBe(false);
        dispose();
      }));

    it("initial following is false", () =>
      createRoot((dispose) => {
        const { following } = useCardInteractions(makeIllust());
        expect(following()).toBe(false);
        dispose();
      }));
  });

  describe("toggleBookmark", () => {
    it("calls addBookmark and sets bookmarked to true when not bookmarked", () =>
      createRoot(async (dispose) => {
        const illust = makeIllust({ is_bookmarked: false });
        const { bookmarked, toggleBookmark } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        const stopSpy = vi.spyOn(e, "stopPropagation");
        await toggleBookmark(e);
        expect(illustApi.addBookmark).toHaveBeenCalledWith(123, "public");
        expect(bookmarked()).toBe(true);
        expect(stopSpy).toHaveBeenCalled();
        dispose();
      }));

    it("calls deleteBookmark and sets bookmarked to false when bookmarked", () =>
      createRoot(async (dispose) => {
        const illust = makeIllust({ is_bookmarked: true });
        const { bookmarked, toggleBookmark } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        const stopSpy = vi.spyOn(e, "stopPropagation");
        await toggleBookmark(e);
        expect(illustApi.deleteBookmark).toHaveBeenCalledWith(123);
        expect(bookmarked()).toBe(false);
        expect(stopSpy).toHaveBeenCalled();
        dispose();
      }));

    it("passes 'private' to addBookmark when privateBookmark is true", () =>
      createRoot(async (dispose) => {
        const illust = makeIllust({ is_bookmarked: false });
        const { toggleBookmark } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleBookmark(e, true);
        expect(illustApi.addBookmark).toHaveBeenCalledWith(123, "private");
        dispose();
      }));

    it("increments bookmarkBurstTrigger on bookmark", () =>
      createRoot(async (dispose) => {
        const illust = makeIllust({ is_bookmarked: false });
        const { bookmarkBurstTrigger, toggleBookmark } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleBookmark(e);
        expect(bookmarkBurstTrigger()).toBe(1);
        dispose();
      }));

    it("shows privateHint when privateBookmark is true and hides after 1500ms", () =>
      createRoot(async (dispose) => {
        vi.useFakeTimers();
        const illust = makeIllust({ is_bookmarked: false });
        const { privateHint, toggleBookmark } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleBookmark(e, true);
        expect(privateHint()).toBe(true);
        vi.advanceTimersByTime(1500);
        expect(privateHint()).toBe(false);
        vi.useRealTimers();
        dispose();
      }));

    it("handles addBookmark error silently (state unchanged)", () =>
      createRoot(async (dispose) => {
        vi.mocked(illustApi.addBookmark).mockRejectedValueOnce(new Error("Network"));
        const illust = makeIllust({ is_bookmarked: false });
        const { bookmarked, toggleBookmark } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleBookmark(e);
        // setBookmarked(true) is never called because addBookmark threw
        expect(bookmarked()).toBe(false);
        dispose();
      }));

    it("handles deleteBookmark error silently (state unchanged)", () =>
      createRoot(async (dispose) => {
        vi.mocked(illustApi.deleteBookmark).mockRejectedValueOnce(new Error("Network"));
        const illust = makeIllust({ is_bookmarked: true });
        const { bookmarked, toggleBookmark } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleBookmark(e);
        // setBookmarked(false) is never called because deleteBookmark threw
        expect(bookmarked()).toBe(true);
        dispose();
      }));
  });

  describe("toggleFollow", () => {
    it("calls followUser and sets isFollowed to true when not followed", () =>
      createRoot(async (dispose) => {
        const illust = makeIllust();
        const { isFollowed, toggleFollow } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        const stopSpy = vi.spyOn(e, "stopPropagation");
        await toggleFollow(e);
        expect(illustApi.followUser).toHaveBeenCalledWith(456);
        expect(isFollowed()).toBe(true);
        expect(stopSpy).toHaveBeenCalled();
        dispose();
      }));

    it("calls unfollowUser and sets isFollowed to false when followed", () =>
      createRoot(async (dispose) => {
        const illust = makeIllust({
          user: { ...makeIllust().user, is_followed: true },
        });
        const { isFollowed, toggleFollow } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleFollow(e);
        expect(illustApi.unfollowUser).toHaveBeenCalledWith(456);
        expect(isFollowed()).toBe(false);
        dispose();
      }));

    it("restores isFollowed state on API error", () =>
      createRoot(async (dispose) => {
        vi.mocked(illustApi.followUser).mockRejectedValueOnce(new Error("Network"));
        const illust = makeIllust();
        const { isFollowed, toggleFollow } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleFollow(e);
        // Optimistically set to true then rolled back on error
        expect(isFollowed()).toBe(false);
        dispose();
      }));

    it("sets following to false after error", () =>
      createRoot(async (dispose) => {
        vi.mocked(illustApi.followUser).mockRejectedValueOnce(new Error("Network"));
        const illust = makeIllust();
        const { following, toggleFollow } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        await toggleFollow(e);
        expect(following()).toBe(false);
        dispose();
      }));

    it("ignores toggleFollow while already following", () =>
      createRoot(async (dispose) => {
        const illust = makeIllust();
        const { toggleFollow } = useCardInteractions(illust);
        const e = new MouseEvent("click");
        // First call starts following
        const p1 = toggleFollow(e);
        // Second call should be ignored (following() is true)
        const p2 = toggleFollow(e);
        await Promise.all([p1, p2]);
        expect(illustApi.followUser).toHaveBeenCalledTimes(1);
        dispose();
      }));
  });

  describe("pointer events", () => {
    it("onPointerDown sets a timer that triggers private bookmark after 500ms", () =>
      createRoot(async (dispose) => {
        vi.useFakeTimers();
        const illust = makeIllust({ is_bookmarked: false });
        const { bookmarked, bookmarkBurstTrigger, onPointerDown } = useCardInteractions(illust);

        onPointerDown(new PointerEvent("pointerdown"));
        expect(vi.getTimerCount()).toBe(1);

        // Not yet 500ms
        vi.advanceTimersByTime(499);
        expect(bookmarked()).toBe(false);

        // Timer fires at 500ms → private bookmark
        // Use async variant so toggleBookmark's await resolves
        await vi.advanceTimersByTimeAsync(1);
        expect(bookmarked()).toBe(true);
        expect(bookmarkBurstTrigger()).toBe(1);

        vi.useRealTimers();
        dispose();
      }));

    it("onPointerUp clears timer and triggers public bookmark before 500ms", () =>
      createRoot(async (dispose) => {
        vi.useFakeTimers();
        const illust = makeIllust({ is_bookmarked: false });
        const { bookmarked, bookmarkBurstTrigger, onPointerDown, onPointerUp } =
          useCardInteractions(illust);

        onPointerDown(new PointerEvent("pointerdown"));
        expect(vi.getTimerCount()).toBe(1);

        onPointerUp(new PointerEvent("pointerup"));

        // Timer cleared, immediate public bookmark
        expect(vi.getTimerCount()).toBe(0);
        // Await microtasks so toggleBookmark's await resolves
        await vi.advanceTimersByTimeAsync(0);
        expect(bookmarked()).toBe(true);
        expect(bookmarkBurstTrigger()).toBe(1);

        vi.useRealTimers();
        dispose();
      }));

    it("onPointerLeave clears timer without bookmark action", () =>
      createRoot((dispose) => {
        vi.useFakeTimers();
        const illust = makeIllust({ is_bookmarked: false });
        const { bookmarked, onPointerDown, onPointerLeave } = useCardInteractions(illust);

        onPointerDown(new PointerEvent("pointerdown"));
        expect(vi.getTimerCount()).toBe(1);

        onPointerLeave();
        expect(vi.getTimerCount()).toBe(0);

        // No bookmark action should have occurred
        expect(bookmarked()).toBe(false);

        vi.useRealTimers();
        dispose();
      }));
  });
});
