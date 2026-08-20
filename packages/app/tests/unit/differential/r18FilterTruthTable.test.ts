// app 侧 isRestricted 12 例参数化测试：以共享 truth-table fixture 为 oracle。
// isRestricted 是 r18Filter.ts 的私有函数，无法直接 import——通过 vi.mock
// settingsStore 的 showR18/showR18G 注入开关态，经 filterNovels 间接断言
// （参考 r18Filter.test.ts 的 mock 模式；blockStore 一并 mock，隔离屏蔽逻辑）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterNovels } from "@/utils/r18Filter";
import type { PixivNovel } from "@/api/types";
import { RESTRICTION_TRUTH_TABLE } from "./sharedRestrictionTruthTable";

vi.mock("@/stores/settingsStore", () => ({
  showR18: vi.fn(() => false),
  showR18G: vi.fn(() => false),
}));

vi.mock("@/stores/blockStore", () => ({
  isBlocked: vi.fn(() => false),
}));

import { showR18, showR18G } from "@/stores/settingsStore";

function createNovel(id: number, xRestrict: number): PixivNovel {
  return {
    id,
    title: `novel-${id}`,
    user: { id: 1, name: "author", account: "author", profile_image_urls: {} },
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

describe("r18Filter × 共享 truth table（12 例差分 fixture）", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it.each(RESTRICTION_TRUTH_TABLE)(
    "x_restrict=$x_restrict, showR18=$showR18, showR18G=$showR18G → restricted=$expectedRestricted",
    ({ x_restrict, showR18: s18, showR18G: s18g, expectedRestricted }) => {
      vi.mocked(showR18).mockReturnValue(s18);
      vi.mocked(showR18G).mockReturnValue(s18g);
      const kept = filterNovels([createNovel(1, x_restrict)]);
      expect(kept).toHaveLength(expectedRestricted ? 0 : 1);
    },
  );
});
