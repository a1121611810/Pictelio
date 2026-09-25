// 标签静音真值表（ADR-0187 D2/D3）：webview 侧经 filterFeedIllusts 间接断言
// （hasMutedTag 是 r18Filter.ts 私有函数，参考 r18FilterTruthTable.test.ts 经
// vi.mock 注入静音集合的模式）。fixture 独立于实现（sharedTagMuteTruthTable），
// lynx 侧 isTagMuted 落地后以同一组用例做双端差分（本票仅落 webview 侧）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterFeedIllusts } from "@/utils/r18Filter";
import type { PixivIllust } from "@/api/types";
import { TAG_MUTE_TRUTH_TABLE } from "./sharedTagMuteTruthTable";

const { muted } = vi.hoisted(() => ({ muted: new Set<string>() }));

vi.mock("@/stores/settingsStore", () => ({
  showR18: vi.fn(() => true),
  showR18G: vi.fn(() => true),
  aiFilterMode: vi.fn(() => "show"),
}));

vi.mock("@/stores/blockStore", () => ({
  isBlocked: vi.fn(() => false),
  blockedIds: vi.fn(() => new Set<number>()),
}));

vi.mock("@/stores/muteTagStore", () => ({
  mutedTags: () => new Set(muted),
}));

/** 真值表最小插画工厂：仅 tags 参与静音判定，其余字段取合法形状 */
function createIllustWithTags(
  tags?: { name: string; translated_name?: string }[] | null,
): PixivIllust {
  return {
    id: 1,
    title: "illust-1",
    type: "illust",
    user: { id: 1, name: "author", account: "author", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 10,
    tags: tags as PixivIllust["tags"],
    x_restrict: 0,
    create_date: "2026-01-01T00:00:00Z",
    meta_pages: [],
    meta_single_page: {},
  } as PixivIllust;
}

describe("标签静音 × 共享 truth table（9 例差分 fixture，ADR-0187）", () => {
  beforeEach(() => {
    muted.clear();
  });

  it.each(TAG_MUTE_TRUTH_TABLE)(
    "muted=$muted, tags=$tags → muted=$expectedMuted",
    ({ muted: tableMuted, tags, expectedMuted }) => {
      for (const name of tableMuted) muted.add(name);
      const kept = filterFeedIllusts([createIllustWithTags(tags)]);
      expect(kept).toHaveLength(expectedMuted ? 0 : 1);
      muted.clear();
    },
  );
});
