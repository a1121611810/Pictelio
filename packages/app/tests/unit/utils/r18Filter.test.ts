import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemo, createRoot, createSignal } from "solid-js";
import { filterNovels, filterFeedIllusts, filterUserPreviews } from "@/utils/r18Filter";
import type { PixivNovel, PixivIllust, PixivUserPreview } from "@/api/types";

vi.mock("@/stores/settingsStore", () => ({
  showR18: vi.fn(() => false),
  showR18G: vi.fn(() => false),
  aiFilterMode: vi.fn(() => "show"),
}));

vi.mock("@/stores/blockStore", () => ({
  isBlocked: vi.fn((id: number) => id === 999),
  blockedIds: vi.fn(() => new Set<number>([999])),
}));

vi.mock("@/stores/muteTagStore", () => ({
  mutedTags: vi.fn(() => new Set<string>()),
}));

import { showR18, showR18G, aiFilterMode } from "@/stores/settingsStore";
import { mutedTags } from "@/stores/muteTagStore";

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

  describe("静音标签过滤（ADR-0187 D3：命中即剔除，快照读）", () => {
    beforeEach(() => {
      vi.mocked(showR18).mockReturnValue(true);
      vi.mocked(showR18G).mockReturnValue(true);
      vi.mocked(aiFilterMode).mockReturnValue("show");
    });

    const withTags = (illust: PixivIllust, tags: PixivIllust["tags"] | undefined): PixivIllust =>
      ({ ...illust, tags }) as PixivIllust;

    it("标签命中静音词表的插画被剔除，未命中的保留", () => {
      vi.mocked(mutedTags).mockReturnValue(new Set(["R-18G"]));
      const illusts = [
        withTags(createIllust(1, 0, 1), [{ name: "R-18G" }]),
        withTags(createIllust(2, 0, 1), [{ name: "風景" }]),
      ];
      expect(filterFeedIllusts(illusts)).toEqual([illusts[1]]);
    });

    it("匹配前对 tag.name 做 trim（存储态为 trim 后原始名）", () => {
      vi.mocked(mutedTags).mockReturnValue(new Set(["R-18G"]));
      const illusts = [withTags(createIllust(1, 0, 1), [{ name: "  R-18G  " }])];
      expect(filterFeedIllusts(illusts)).toEqual([]);
    });

    it("translated_name 不参与匹配（ADR-0187 D2）", () => {
      vi.mocked(mutedTags).mockReturnValue(new Set(["グロ"]));
      const illusts = [
        withTags(createIllust(1, 0, 1), [{ name: "guro", translated_name: "グロ" }]),
      ];
      expect(filterFeedIllusts(illusts)).toEqual(illusts);
    });

    it("空 tags / undefined tags 放行（spec 边界 #1）", () => {
      vi.mocked(mutedTags).mockReturnValue(new Set(["R-18G"]));
      const illusts = [
        withTags(createIllust(1, 0, 1), []),
        withTags(createIllust(2, 0, 1), undefined),
      ];
      expect(filterFeedIllusts(illusts)).toEqual(illusts);
    });

    it("filterNovels：小说标签命中静音词表被剔除", () => {
      vi.mocked(mutedTags).mockReturnValue(new Set(["R-18G"]));
      const novels = [
        { ...createNovel(1, 0, 1), tags: [{ name: "R-18G" }] },
        { ...createNovel(2, 0, 1), tags: [{ name: "短編" }] },
      ];
      expect(filterNovels(novels)).toEqual([novels[1]]);
    });

    it("filterUserPreviews：预览内层命中静音词表的插画被移除，预览本身保留", () => {
      vi.mocked(mutedTags).mockReturnValue(new Set(["R-18G"]));
      const preview: PixivUserPreview = {
        user: { id: 1, name: "author", account: "author", profile_image_urls: {} },
        illusts: [
          withTags(createIllust(1, 0, 1), [{ name: "R-18G" }]),
          withTags(createIllust(2, 0, 1), [{ name: "風景" }]),
        ],
        novels: [],
        is_muted: false,
      };
      const out = filterUserPreviews([preview]);
      expect(out).toHaveLength(1);
      expect(out[0].illusts.map((i) => i.id)).toEqual([2]);
    });
  });

  describe("静音集合快照语义（spec 边界 #4：已渲染列表不回溯移除，v1 只影响后续组装）", () => {
    beforeEach(() => {
      vi.mocked(showR18).mockReturnValue(true);
      vi.mocked(showR18G).mockReturnValue(true);
      vi.mocked(aiFilterMode).mockReturnValue("show");
    });

    /** mock mutedTags 由 createSignal 驱动（模拟真实 muteTagStore 的响应式面） */
    function driveMutedTagsBySignal() {
      const [muted, setMuted] = createSignal<ReadonlySet<string>>(new Set());
      vi.mocked(mutedTags).mockImplementation(() => muted());
      return setMuted;
    }

    const withTags = (illust: PixivIllust, tags: PixivIllust["tags"] | undefined): PixivIllust =>
      ({ ...illust, tags }) as PixivIllust;

    it("filterFeedIllusts：mute 集合变化不触发既有 memo 重算，重新调用才反映新集合", () => {
      const setMuted = driveMutedTagsBySignal();
      const illusts = [
        withTags(createIllust(1, 0, 1), [{ name: "R-18G" }]),
        withTags(createIllust(2, 0, 1), [{ name: "風景" }]),
      ];

      let runs = 0;
      let filtered!: () => PixivIllust[];
      let dispose!: () => void;
      createRoot((d) => {
        dispose = d;
        // memo 在 root 内存活（dispose 延后），signal 写入须在 owned scope 之外（Solid 2.0）
        filtered = createMemo(() => {
          runs++;
          return filterFeedIllusts(illusts);
        });
        expect(filtered()).toHaveLength(2);
      });
      const initialRuns = runs;

      // 长按静音（mutedTags signal 翻转）：已挂载列表的 memo 不重算（不回溯移除卡片）
      // flush：Solid 2.0 批处理语义，set 后同步读返回旧值，先落定再断言（对齐 muteTagStore.test）
      setMuted(new Set(["R-18G"]));
      flush();
      expect(filtered()).toHaveLength(2);
      expect(runs).toBe(initialRuns);

      // 后续组装（查询 transform / 翻页 / 刷新重新调用过滤函数）读取新快照
      expect(filterFeedIllusts(illusts)).toHaveLength(1);
      dispose();
    });

    it("filterNovels / filterUserPreviews 同样为组装时快照读", () => {
      const setMuted = driveMutedTagsBySignal();
      const novels = [{ ...createNovel(1, 0, 1), tags: [{ name: "R-18G" }] }];
      const preview: PixivUserPreview = {
        user: { id: 1, name: "author", account: "author", profile_image_urls: {} },
        illusts: [withTags(createIllust(1, 0, 1), [{ name: "R-18G" }])],
        novels: [],
        is_muted: false,
      };

      let novelRuns = 0;
      let previewRuns = 0;
      let novelMemo!: () => PixivNovel[];
      let previewMemo!: () => PixivUserPreview[];
      let dispose!: () => void;
      createRoot((d) => {
        dispose = d;
        novelMemo = createMemo(() => {
          novelRuns++;
          return filterNovels(novels);
        });
        previewMemo = createMemo(() => {
          previewRuns++;
          return filterUserPreviews([preview]);
        });
        expect(novelMemo()).toHaveLength(1);
        expect(previewMemo()[0]!.illusts).toHaveLength(1);
      });
      const novelRuns0 = novelRuns;
      const previewRuns0 = previewRuns;

      setMuted(new Set(["R-18G"]));
      flush(); // 2.0 批处理语义：先落定再断言
      expect(novelMemo()).toHaveLength(1);
      expect(previewMemo()[0]!.illusts).toHaveLength(1);
      expect(novelRuns).toBe(novelRuns0);
      expect(previewRuns).toBe(previewRuns0);

      expect(filterNovels(novels)).toHaveLength(0);
      expect(filterUserPreviews([preview])[0]!.illusts).toHaveLength(0);
      dispose();
    });
  });
});
