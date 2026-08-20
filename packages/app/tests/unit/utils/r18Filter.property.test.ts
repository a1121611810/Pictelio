// ─── r18Filter 属性测试 ───
// 期望值来源 = 性质/不变量（oracle 为性质本身，不从实现反推）：
//
// filterNovels / filterFeedIllusts 的问题定义：按 R18/R18G 开关与屏蔽名单对输入列表
// 逐项过滤（x_restrict: 0=全年龄, 1=R-18, 2=R-18G）。过滤语义必然满足：
//   - 幂等：过滤结果再次过滤不变 ⇒ filter(x) = filter(filter(x))
//   - 输出 ⊆ 输入：过滤只删不增（输出元素必属输入、且不重复）
//   - 单调：打开 R18（showR18: false→true，其余条件不变）后输出 ⊇ 关闭时输出
//     （开关只会放行更多内容，不会隐藏原本可见的内容）
//
// settingsStore / blockStore 按现有 r18Filter.test.ts 的 vi.mock 模式注入；
// 屏蔽名单以可变 Set 传入（vi.hoisted），使性质跨任意屏蔽集合成立。
import { describe, it, expect, vi } from "vitest";
import fc from "fast-check";
import { filterNovels, filterFeedIllusts } from "@/utils/r18Filter";
import type { PixivNovel, PixivIllust } from "@/api/types";

const { blockedIds } = vi.hoisted(() => ({ blockedIds: new Set<number>() }));

vi.mock("@/stores/settingsStore", () => ({
  showR18: vi.fn(() => false),
  showR18G: vi.fn(() => false),
}));

vi.mock("@/stores/blockStore", () => ({
  isBlocked: (id: number) => blockedIds.has(id),
}));

import { showR18, showR18G } from "@/stores/settingsStore";

// ── 生成器 ──

const userIdArb = fc.integer({ min: 1, max: 1000 });
const xRestrictArb = fc.constantFrom(0, 1, 2);

const novelRecord = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  x_restrict: xRestrictArb,
  userId: userIdArb,
});

const illustRecord = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  x_restrict: xRestrictArb,
  userId: userIdArb,
});

function toNovel(r: { id: number; x_restrict: number; userId: number }): PixivNovel {
  return {
    id: r.id,
    title: `novel-${r.id}`,
    user: { id: r.userId, name: "author", account: "author", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 5000,
    is_bookmarked: false,
    total_bookmarks: 10,
    x_restrict: r.x_restrict,
    create_date: "2026-01-01T00:00:00Z",
  } as PixivNovel;
}

function toIllust(r: { id: number; x_restrict: number; userId: number }): PixivIllust {
  return {
    id: r.id,
    title: `illust-${r.id}`,
    type: "illust",
    user: { id: r.userId, name: "author", account: "author", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 10,
    tags: [],
    x_restrict: r.x_restrict,
    create_date: "2026-01-01T00:00:00Z",
    meta_pages: [],
    meta_single_page: {},
  } as PixivIllust;
}

// id 唯一化：性质「输出不引入重复」基于输入 id 唯一的前提
const novelListArb = fc.uniqueArray(novelRecord, { maxLength: 30, selector: (r) => r.id });
const illustListArb = fc.uniqueArray(illustRecord, { maxLength: 30, selector: (r) => r.id });
const blockedSetArb = fc.array(userIdArb, { maxLength: 5 }).map((ids) => new Set(ids));

// ── 性质（对任意（列表, 屏蔽集合, R18G 开关）成立） ──

function applyBlocked(blocked: Set<number>): void {
  blockedIds.clear();
  for (const id of blocked) blockedIds.add(id);
}

function runNovelProperties(
  listArb: typeof novelListArb,
  filterFn: (xs: PixivNovel[]) => PixivNovel[],
) {
  describe("filterNovels 属性（oracle=性质/不变量）", () => {
    it("幂等：filter(x) = filter(filter(x))", () => {
      fc.assert(
        fc.property(listArb, blockedSetArb, (records, blocked) => {
          applyBlocked(blocked);
          const input = records.map(toNovel);
          const once = filterFn(input);
          const twice = filterFn(once);
          expect(twice.map((n) => n.id)).toEqual(once.map((n) => n.id));
        }),
      );
    });

    it("输出 ⊆ 输入：不新增、不重复元素", () => {
      fc.assert(
        fc.property(listArb, blockedSetArb, (records, blocked) => {
          applyBlocked(blocked);
          const input = records.map(toNovel);
          const out = filterFn(input);
          const inputIds = new Set(input.map((n) => n.id));
          for (const o of out) {
            expect(inputIds.has(o.id)).toBe(true);
          }
          // 输出不引入输入中不存在的重复 id
          expect(new Set(out.map((o) => o.id)).size).toBe(out.length);
        }),
      );
    });

    it("单调：showR18=false → true 输出 ⊇ 关闭时输出（R18G 与屏蔽名单不变）", () => {
      fc.assert(
        fc.property(listArb, blockedSetArb, fc.boolean(), (records, blocked, showG) => {
          applyBlocked(blocked);
          vi.mocked(showR18G).mockReturnValue(showG);
          vi.mocked(showR18).mockReturnValue(false);
          const off = filterFn(records.map(toNovel)).map((n) => n.id);
          vi.mocked(showR18).mockReturnValue(true);
          const on = filterFn(records.map(toNovel)).map((n) => n.id);
          for (const id of off) {
            expect(on).toContain(id);
          }
        }),
      );
    });
  });
}

runNovelProperties(novelListArb, filterNovels);

describe("filterFeedIllusts 属性（oracle=性质/不变量）", () => {
  it("幂等：filter(x) = filter(filter(x))", () => {
    fc.assert(
      fc.property(illustListArb, blockedSetArb, (records, blocked) => {
        applyBlocked(blocked);
        const input = records.map(toIllust);
        const once = filterFeedIllusts(input);
        const twice = filterFeedIllusts(once);
        expect(twice.map((i) => i.id)).toEqual(once.map((i) => i.id));
      }),
    );
  });

  it("输出 ⊆ 输入：不新增、不重复元素", () => {
    fc.assert(
      fc.property(illustListArb, blockedSetArb, (records, blocked) => {
        applyBlocked(blocked);
        const input = records.map(toIllust);
        const out = filterFeedIllusts(input);
        const inputIds = new Set(input.map((i) => i.id));
        for (const o of out) {
          expect(inputIds.has(o.id)).toBe(true);
        }
        expect(new Set(out.map((o) => o.id)).size).toBe(out.length);
      }),
    );
  });

  it("单调：showR18=false → true 输出 ⊇ 关闭时输出（R18G 与屏蔽名单不变）", () => {
    fc.assert(
      fc.property(illustListArb, blockedSetArb, fc.boolean(), (records, blocked, showG) => {
        applyBlocked(blocked);
        vi.mocked(showR18G).mockReturnValue(showG);
        vi.mocked(showR18).mockReturnValue(false);
        const off = filterFeedIllusts(records.map(toIllust)).map((i) => i.id);
        vi.mocked(showR18).mockReturnValue(true);
        const on = filterFeedIllusts(records.map(toIllust)).map((i) => i.id);
        for (const id of off) {
          expect(on).toContain(id);
        }
      }),
    );
  });
});
