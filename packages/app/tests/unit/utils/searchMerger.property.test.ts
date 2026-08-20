// ─── searchMerger 属性测试 ───
// 期望值来源 = 性质/不变量（oracle 为性质本身，不从实现反推）：
//
// mergeSearchResults 的问题定义（实现注释声明）：将 search/illust 与 search/novel 结果
// 按 create_date 降序合流为单一时间线，同一 create_date 内保持 illust → novel 排序。
// 由此不变量：
//   - 长度守恒：merged 数量 = illusts + novels 数量（不丢失、不新增）
//   - 按 create_date 降序：任意相邻项 date 非升（localeCompare ≥ 0；同格式 ISO 串下等价时间序）
//   - 类型标记保留：每项 type ∈ {illust, novel}，且 (type, entity.id, date) 与输入一一对应
//   - 同日期块内 illust 全部排在 novel 之前
//
// 生成策略：统一 ISO 格式的日期串（fc.date → toISOString），保证字符串序 = 时间序。
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeSearchResults } from "@/utils/searchMerger";
import type { PixivIllust, PixivNovel } from "@/api/types";

// ── 生成器 ──

// fc.integer → Date：shrink 恒在 [min, max] 内，杜绝 fc.date 的 shrink 生成 Invalid Date 问题
const dateArb = fc
  .integer({ min: Date.UTC(2020, 0, 1), max: Date.UTC(2026, 11, 31, 23, 59, 59, 999) })
  .map((t) => new Date(t).toISOString());

const illustRecord = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  date: dateArb,
});

const novelRecord = fc.record({
  id: fc.integer({ min: 1, max: 100_000 }),
  date: dateArb,
});

const illustListArb = fc.array(illustRecord, { minLength: 0, maxLength: 30 });
const novelListArb = fc.array(novelRecord, { minLength: 0, maxLength: 30 });

function toIllust(r: { id: number; date: string }): PixivIllust {
  return {
    id: r.id,
    title: `illust-${r.id}`,
    type: "illust",
    user: { id: 1, name: "a", account: "a", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    width: 100,
    height: 100,
    page_count: 1,
    is_bookmarked: false,
    total_bookmarks: 0,
    tags: [],
    x_restrict: 0,
    create_date: r.date,
    meta_pages: [],
    meta_single_page: {},
  } as PixivIllust;
}

function toNovel(r: { id: number; date: string }): PixivNovel {
  return {
    id: r.id,
    title: `novel-${r.id}`,
    user: { id: 1, name: "a", account: "a", profile_image_urls: {} },
    image_urls: { square_medium: "", medium: "", large: "" },
    tags: [],
    page_count: 1,
    text_length: 100,
    is_bookmarked: false,
    total_bookmarks: 0,
    x_restrict: 0,
    create_date: r.date,
  } as PixivNovel;
}

describe("mergeSearchResults 属性（oracle=性质/不变量）", () => {
  it("长度守恒：len(merged) = len(illusts) + len(novels)", () => {
    fc.assert(
      fc.property(illustListArb, novelListArb, (illusts, novels) => {
        const merged = mergeSearchResults(illusts.map(toIllust), novels.map(toNovel));
        expect(merged).toHaveLength(illusts.length + novels.length);
      }),
    );
  });

  it("按 create_date 降序：任意相邻项 date 非升", () => {
    fc.assert(
      fc.property(illustListArb, novelListArb, (illusts, novels) => {
        const merged = mergeSearchResults(illusts.map(toIllust), novels.map(toNovel));
        for (let i = 1; i < merged.length; i++) {
          expect(merged[i - 1].date.localeCompare(merged[i].date)).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("类型标记保留：每项 (type, entity.id, date) 与输入一一对应（无丢失、无新增）", () => {
    fc.assert(
      fc.property(illustListArb, novelListArb, (illusts, novels) => {
        const merged = mergeSearchResults(illusts.map(toIllust), novels.map(toNovel));
        for (const item of merged) {
          expect(item.type === "illust" || item.type === "novel").toBe(true);
          expect(item.date).toBe(item.entity.create_date);
        }
        // 按 (type, id) 计数：merged 与输入的键序列一致（长度守恒 + 键集合一致）
        const key = (type: string, id: number) => `${type}:${id}`;
        const inputKeys = [
          ...illusts.map((i) => key("illust", i.id)),
          ...novels.map((n) => key("novel", n.id)),
        ].toSorted();
        const mergedKeys = merged.map((m) => key(m.type, m.entity.id)).toSorted();
        expect(mergedKeys).toEqual(inputKeys);
      }),
    );
  });

  it("同日期块内 illust 全部排在 novel 之前", () => {
    fc.assert(
      fc.property(illustListArb, novelListArb, (illusts, novels) => {
        const merged = mergeSearchResults(illusts.map(toIllust), novels.map(toNovel));
        for (let i = 0; i < merged.length;) {
          let j = i;
          while (j < merged.length && merged[j].date === merged[i].date) j++;
          // [i, j) 为同一 date 的连续块：块内不得出现 novel 在 illust 之前
          let seenNovel = false;
          for (let k = i; k < j; k++) {
            if (merged[k].type === "novel") seenNovel = true;
            else expect(seenNovel).toBe(false);
          }
          i = j;
        }
      }),
    );
  });
});
