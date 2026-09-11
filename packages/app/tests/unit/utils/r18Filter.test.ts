import { describe, it, expect, vi, beforeEach } from "vitest";
import { filterNovels, filterFeedIllusts, filterUserPreviews } from "@/utils/r18Filter";
import type { PixivNovel, PixivIllust, PixivUserPreview } from "@/api/types";

vi.mock("@/stores/settingsStore", () => ({
  showR18: vi.fn(() => false),
  showR18G: vi.fn(() => false),
  aiFilterMode: vi.fn(() => "show"),
}));

vi.mock("@/stores/blockStore", () => ({
  isBlocked: vi.fn((id: number) => id === 999),
}));

import { showR18, showR18G, aiFilterMode } from "@/stores/settingsStore";

function createNovel(id: number, xRestrict: number, userId: number): PixivNovel {
  return {
    id,
    title: `novel-${id}`,
    user: { id: userId, name: "author", account: "author", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 5000,
    is_bookmarked: false,
    total_bookmarks: 10,
    x_restrict: xRestrict,
    create_date: "2026-01-01T00:00:00Z",
  } as PixivNovel;
}

function createIllust(id: number, xRestrict: number, userId: number, aiType?: number): PixivIllust {
  return {
    id,
    title: `illust-${id}`,
    type: "illust",
    user: { id: userId, name: "author", account: "author", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 10,
    tags: [],
    x_restrict: xRestrict,
    illust_ai_type: aiType,
    create_date: "2026-01-01T00:00:00Z",
    meta_pages: [],
    meta_single_page: {},
  } as PixivIllust;
}

describe("r18Filter", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("filterNovels", () => {
    it("keeps all-age novels by default", () => {
      const novels = [createNovel(1, 0, 1)];
      expect(filterNovels(novels)).toEqual(novels);
    });

    it("filters R-18 novels when showR18 is false", () => {
      vi.mocked(showR18).mockReturnValue(false);
      vi.mocked(showR18G).mockReturnValue(false);
      const novels = [createNovel(1, 1, 1), createNovel(2, 0, 1)];
      expect(filterNovels(novels)).toEqual([novels[1]]);
    });

    it("filters R-18G novels when showR18G is false", () => {
      vi.mocked(showR18).mockReturnValue(false);
      vi.mocked(showR18G).mockReturnValue(false);
      const novels = [createNovel(1, 2, 1), createNovel(2, 0, 1)];
      expect(filterNovels(novels)).toEqual([novels[1]]);
    });

    it("keeps R-18 novels when showR18 is true", () => {
      vi.mocked(showR18).mockReturnValue(true);
      vi.mocked(showR18G).mockReturnValue(false);
      const novels = [createNovel(1, 1, 1)];
      expect(filterNovels(novels)).toEqual(novels);
    });

    it("filters novels from blocked users", () => {
      const novels = [createNovel(1, 0, 999), createNovel(2, 0, 1)];
      expect(filterNovels(novels)).toEqual([novels[1]]);
    });
  });

  describe("filterFeedIllusts backward compatibility", () => {
    it("still filters R-18 and blocked users for illusts", () => {
      vi.mocked(showR18).mockReturnValue(false);
      vi.mocked(showR18G).mockReturnValue(false);
      const illusts = [createIllust(1, 1, 1), createIllust(2, 0, 999), createIllust(3, 0, 1)];
      expect(filterFeedIllusts(illusts)).toEqual([illusts[2]]);
    });
  });

  describe("filterFeedIllusts × AI 三态（ADR-0155）", () => {
    beforeEach(() => {
      vi.mocked(showR18).mockReturnValue(true);
      vi.mocked(showR18G).mockReturnValue(true);
    });

    it("mask：移除 ai_type>=1 的插画，保留非 AI（ai_type=0 / 缺失）", () => {
      vi.mocked(aiFilterMode).mockReturnValue("mask");
      const illusts = [
        createIllust(1, 0, 1, 2),
        createIllust(2, 0, 1, 0),
        createIllust(3, 0, 1, undefined),
      ];
      expect(filterFeedIllusts(illusts)).toEqual([illusts[1], illusts[2]]);
    });

    it("only：仅保留 AI 插画（ai_type=1 也算 AI）", () => {
      vi.mocked(aiFilterMode).mockReturnValue("only");
      const illusts = [
        createIllust(1, 0, 1, 1),
        createIllust(2, 0, 1, 2),
        createIllust(3, 0, 1, 0),
      ];
      expect(filterFeedIllusts(illusts)).toEqual([illusts[0], illusts[1]]);
    });

    it("show：不做 AI 处理", () => {
      vi.mocked(aiFilterMode).mockReturnValue("show");
      const illusts = [createIllust(1, 0, 1, 2), createIllust(2, 0, 1, 0)];
      expect(filterFeedIllusts(illusts)).toEqual(illusts);
    });
  });

  describe("filterUserPreviews × AI 三态（直测）", () => {
    it("mask：从预览内层移除 AI 插画，预览本身保留", () => {
      vi.mocked(showR18).mockReturnValue(true);
      vi.mocked(showR18G).mockReturnValue(true);
      vi.mocked(aiFilterMode).mockReturnValue("mask");
      const preview: PixivUserPreview = {
        user: { id: 1, name: "author", account: "author", profile_image_urls: {} },
        illusts: [createIllust(1, 0, 1, 2), createIllust(2, 0, 1, 0)],
        novels: [],
        is_muted: false,
      };
      const out = filterUserPreviews([preview]);
      expect(out).toHaveLength(1);
      expect(out[0].illusts.map((i) => i.id)).toEqual([2]);
    });

    it("only：预览内层只保留 AI 插画", () => {
      vi.mocked(showR18).mockReturnValue(true);
      vi.mocked(showR18G).mockReturnValue(true);
      vi.mocked(aiFilterMode).mockReturnValue("only");
      const preview: PixivUserPreview = {
        user: { id: 1, name: "author", account: "author", profile_image_urls: {} },
        illusts: [createIllust(1, 0, 1, 1), createIllust(2, 0, 1, 0)],
        novels: [],
        is_muted: false,
      };
      const out = filterUserPreviews([preview]);
      expect(out[0].illusts.map((i) => i.id)).toEqual([1]);
    });
  });
});
