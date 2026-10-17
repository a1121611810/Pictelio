/**
 * 参数构建真值表。oracle：docs/research/pixiv-appapi-search-filter-params.md
 * - §1.1/§1.2 基础与筛选参数行（官方 iOS 抓包值）
 * - §3/§4 popular-preview：接受筛选但**无 sort、无分页、收藏数被忽略**
 * - 档位映射 oracle：docs/specs/search-target-mode.md §4 表（两端不对称）
 *   + Shaft #906：illust 端 partial **不传** search_target（映射来源）。
 *     ⚠️ #906 的**理由**（显式传 partial 会转严格标签匹配 → 丢标题命中）本次一手实测
 *     **未复现**：omit / 显式 partial / merge=true / 两者并用 四组组合 × 3 检索词 × 2 轮
 *     **交错**采样共 12 次，ID 序列 md5 完全相同；决定性反证是多词 `Rosmontis rosemary`
 *     在 omit 与显式 partial 下同为 4 条（exact 为 1 条）。⇒ 两者**等价**，
 *     「不传」是**保守选择**（无害 + 对齐第三方），**不要再拿「显式发即回归」当理由**。
 *     ⚠️ 方法论：插画端结果集随时间漂移，A/B 比对**必须交错采样**，顺序采样会产出
 *     方向相反的假差异——#906 这条错误结论能活下来就是踩了这个坑。
 *     复跑：docs/research/verify-illust-target-equivalence.sh
 *   + #1038（novel 不传退化为纯字面匹配 → 恒显式 partial；映射方向可信，理由未一手证实）
 *   + docs/research/verify-query-syntax.sh 一手实测（四档 × 双端点）
 *   + 一手实测（交错 2 轮）：novel 端 `search_target=title_and_caption` **被拒（HTTP 400）**，
 *     非「不识别」——省略该参 / 传 partial_match_for_tags 均 200 返 30 条，对照组未知参数名
 *     `foo=bar` 亦 200 且结果不变 ⇒ 服务端**枚举校验硬拒该取值**。见下方真值表注释。
 */
import { describe, expect, it } from "vitest";
import {
  buildIllustSearchRequest,
  buildNovelSearchRequest,
  buildUserSearchRequest,
} from "../src/buildParams";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "../src/filters";

const NOW = new Date("2026-09-12T15:00:00Z");
const input = (over: Partial<Parameters<typeof buildIllustSearchRequest>[0]> = {}) => ({
  word: "東方",
  sort: "date_desc" as const,
  filters: DEFAULT_SEARCH_FILTERS,
  now: NOW,
  ...over,
});

describe("buildIllustSearchRequest", () => {
  it("默认筛选：裸基础参 + 恒发两 bool，partial 档**不传 search_target**（#906 映射；实测与显式发等价，故保守不传）", () => {
    const r = buildIllustSearchRequest(input());
    expect(r.endpoint).toBe("/v1/search/illust");
    expect(r.params).toEqual({
      word: "東方",
      filter: "for_ios",
      merge_plain_keyword_results: "true",
      include_translated_tag_results: "true",
      sort: "date_desc",
    });
  });

  /**
   * ⚠️ **有意行为变更**（spec search-target-mode §5）：改前「含空格多词」由 `word.includes(" ")`
   * 自动派生为 `exact_match_for_tags`；改后档位由用户选定，默认 partial 不再发送该参数
   * ⇒ 服务端并入关键字/标题命中（实测 `Rosmontis rosemary`：exact 1 条 / partial 4 条）。
   * 空格语义不变（服务端仍按 AND 解析），变的只是结果集大小。
   */
  it("多词 + 默认 partial 档 → **不再自动 exact**，不发送 search_target", () => {
    const r = buildIllustSearchRequest(input({ word: "東方 フラン" }));
    expect(Object.keys(r.params)).not.toContain("search_target");
    expect(r.params.word).toBe("東方 フラン");
  });

  it("热门路由 popular-preview：无 sort；partial 档无 search_target", () => {
    const r = buildIllustSearchRequest(input({ sort: "popular_desc" }));
    expect(r.endpoint).toBe("/v1/search/popular-preview/illust");
    expect(r.params).toEqual({
      word: "東方",
      filter: "for_ios",
      merge_plain_keyword_results: "true",
      include_translated_tag_results: "true",
    });
  });

  it("热门矩阵：期间/比例/分辨率透传，**收藏数不携带**，无 sort", () => {
    const r = buildIllustSearchRequest(
      input({
        sort: "popular_desc",
        filters: {
          period: { kind: "preset", preset: "1w" },
          bookmark: BOOKMARK_BANDS[3]!,
          ratio: "landscape",
          minPixels: 2000,
          aiOverride: "follow",
          target: "partial",
        },
      }),
    );
    expect(r.endpoint).toBe("/v1/search/popular-preview/illust");
    expect(r.params.start_date).toBe("2026-09-07");
    expect(r.params.end_date).toBe("2026-09-13");
    expect(r.params.ratio_pattern).toBe("landscape");
    expect(r.params.width_min).toBe("2000");
    expect(r.params.height_min).toBe("2000");
    expect(r.params.sort).toBeUndefined();
    expect(r.params.bookmark_num_min).toBeUndefined();
    expect(r.params.bookmark_num_max).toBeUndefined();
  });

  it("非热门 + 收藏数带宽：闭区间 min/max 落参（七档 oracle=官方 bookmark_ranges）", () => {
    const r = buildIllustSearchRequest(
      input({ filters: { ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[3]! } }),
    );
    expect(r.params.bookmark_num_min).toBe("100");
    expect(r.params.bookmark_num_max).toBe("299");
    const open = buildIllustSearchRequest(
      input({ filters: { ...DEFAULT_SEARCH_FILTERS, bookmark: BOOKMARK_BANDS[6]! } }),
    );
    expect(open.params.bookmark_num_min).toBe("1000");
    expect(open.params.bookmark_num_max).toBeUndefined();
  });

  it("期间自定义合法区间透传；非法区间省略（不静默半区间）", () => {
    const ok = buildIllustSearchRequest(
      input({
        filters: {
          ...DEFAULT_SEARCH_FILTERS,
          period: { kind: "custom", start: "2026-08-01", end: "2026-08-15" },
        },
      }),
    );
    expect(ok.params.start_date).toBe("2026-08-01");
    expect(ok.params.end_date).toBe("2026-08-15");
    const bad = buildIllustSearchRequest(
      input({
        filters: {
          ...DEFAULT_SEARCH_FILTERS,
          period: { kind: "custom", start: "2026-08-15", end: "2026-08-01" },
        },
      }),
    );
    expect(bad.params.start_date).toBeUndefined();
    expect(bad.params.end_date).toBeUndefined();
  });

  it("search_ai_type 永不出现（#479 裁决：AI 全客户端处理）", () => {
    const r = buildIllustSearchRequest(input());
    expect(Object.keys(r.params)).not.toContain("search_ai_type");
    expect(Object.keys(r.params)).not.toContain("duration");
    expect(Object.keys(r.params)).not.toContain("include_potential_violation_works");
  });
});

describe("buildNovelSearchRequest", () => {
  it("novel 端恒显式传 partial（默认档；#1038 同义词展开）", () => {
    const r = buildNovelSearchRequest(input());
    expect(r.endpoint).toBe("/v1/search/novel");
    expect(r.params.search_target).toBe("partial_match_for_tags");
    expect(r.params.sort).toBe("date_desc");
  });

  /**
   * ⚠️ **有意行为变更**（spec search-target-mode §5）：改前含空格自动 exact；改后多词 + partial
   * 仍显式发 `partial_match_for_tags`。小说端 partial 档**必须显式发**（不传 = 纯字面匹配）。
   * 比例/分辨率**永不进小说路**（插画专属维度，状态残留也不发）。
   */
  it("多词 + partial 档 → 仍显式 partial（非 exact）；比例/分辨率**永不进小说路**", () => {
    const r = buildNovelSearchRequest(
      input({
        word: "東方 フラン",
        filters: { ...DEFAULT_SEARCH_FILTERS, ratio: "portrait", minPixels: 3000 },
      }),
    );
    expect(r.params.search_target).toBe("partial_match_for_tags");
    expect(r.params.ratio_pattern).toBeUndefined();
    expect(r.params.width_min).toBeUndefined();
    expect(r.params.height_min).toBeUndefined();
  });

  it("热门路由 popular-preview/novel：无 sort、收藏数不携带、期间透传", () => {
    const r = buildNovelSearchRequest(
      input({
        sort: "popular_desc",
        filters: {
          ...DEFAULT_SEARCH_FILTERS,
          period: { kind: "preset", preset: "1d" },
          bookmark: BOOKMARK_BANDS[0]!,
        },
      }),
    );
    expect(r.endpoint).toBe("/v1/search/popular-preview/novel");
    expect(r.params.start_date).toBe("2026-09-13");
    expect(r.params.bookmark_num_min).toBeUndefined();
    expect(r.params.sort).toBeUndefined();
    expect(r.params.search_target).toBe("partial_match_for_tags");
  });
});

/**
 * 档位 × 端点 真值表（spec search-target-mode §4，**两端不对称**）。
 * oracle 逐字转写自该表，不从实现反推：
 * | 档位 | 插画端 | 小说端 |
 * | partial | 整个参数不传（保守选择，见文件头：实测显式发与不传等价） | 显式发 partial_match_for_tags |
 * | exact | exact_match_for_tags | exact_match_for_tags |
 * | title_and_caption | title_and_caption | **端点实测被拒（HTTP 400）→ 必须不发** |
 *
 * ⚠️ 末行原写「端点不识别 → 不发」，**已被一手实测推翻并订正**：不是「未被识别」，是
 * **被明确拒绝**。`/v1/search/novel` 省略 search_target → 200/30 条；
 * `title_and_caption` → **400/0 条**；`partial_match_for_tags` → 200/30 条；
 * 对照组未知参数名 `foo=bar` → 200/30 条（交错 2 轮一致）。对照组说明服务端不是「不认识
 * 这个参数名」，而是**校验通过、取值被拒**。故措辞从「不识别」改为「实测被拒」——
 * 前者读起来像「发了无害」，后者才是「发了直接 400 失败」的强度。
 * 佐证：docs/research/verify-query-syntax.sh + 上述交错采样；#906 / #1038 的理由见文件头。
 *
 * 基础键集 = baseParams 四项（word/filter/merge/include）+ 非热门恒发 sort，已按字典序写死。
 */
const BASE_KEYS = [
  "filter",
  "include_translated_tag_results",
  "merge_plain_keyword_results",
  "sort",
  "word",
];
const BASE_KEYS_WITH_TARGET = [
  "filter",
  "include_translated_tag_results",
  "merge_plain_keyword_results",
  "search_target",
  "sort",
  "word",
];

describe("search_target 档位矩阵（spec §4：两端不对称）", () => {
  it.each([
    // 档位, 插画端带键?, 插画端值, 小说端带键?, 小说端值
    ["partial", false, undefined, true, "partial_match_for_tags"],
    ["exact", true, "exact_match_for_tags", true, "exact_match_for_tags"],
    ["title_and_caption", true, "title_and_caption", false, undefined],
  ] as const)(
    "%s → 插画端 /v1/search/illust + 小说端 /v1/search/novel 的端点与完整参数键集",
    (mode, illustHasKey, illustValue, novelHasKey, novelValue) => {
      const filters = { ...DEFAULT_SEARCH_FILTERS, target: mode };

      const illust = buildIllustSearchRequest(input({ filters }));
      expect(illust.endpoint).toBe("/v1/search/illust");
      expect(Object.keys(illust.params).toSorted()).toEqual(
        illustHasKey ? BASE_KEYS_WITH_TARGET : BASE_KEYS,
      );
      expect(illust.params.search_target).toBe(illustValue);

      const novel = buildNovelSearchRequest(input({ filters }));
      expect(novel.endpoint).toBe("/v1/search/novel");
      expect(Object.keys(novel.params).toSorted()).toEqual(
        novelHasKey ? BASE_KEYS_WITH_TARGET : BASE_KEYS,
      );
      expect(novel.params.search_target).toBe(novelValue);
    },
  );

  /**
   * 反证断言：插画端 partial 档的参数键集里**没有** search_target（characterization，锁定现状映射）。
   *
   * ⚠️ **勿把这条读成「显式发就是回归」**——旧文案如此写，是错的。#906 的理由（显式
   * partial 会转严格标签匹配、忽略 merge_plain_keyword_results ⇒ 丢标题/关键字命中）
   * 本次一手实测**未复现**：omit / 显式 partial / merge=true / 两者并用 四组组合 × 3 检索词
   * × 2 轮**交错**采样共 12 次，ID 序列 md5 完全相同；决定性反证是多词 `Rosmontis rosemary`
   * 在 omit 与显式 partial 下同为 4 条，而 exact 为 1 条。⇒ 两者**等价**。
   * 所以这条断言防的不是「功能回归」，而是**顺手补全**：它把「partial 档不落该键」钉死，
   * 将来若有人以「补全参数」为由加上 `search_target`，diff 会逼人重看这一段映射决策。
   */
  it("反证：插画端 partial 档**不含** search_target 键（锁定映射；实测显式发与不传等价，非「发了即回归」）", () => {
    for (const word of ["東方", "東方 フラン", "Rosmontis rosemary"]) {
      const r = buildIllustSearchRequest(input({ word, filters: DEFAULT_SEARCH_FILTERS }));
      expect(Object.keys(r.params)).not.toContain("search_target");
      expect(r.params.search_target).toBeUndefined();
      expect(r.params.merge_plain_keyword_results).toBe("true");
    }
  });

  it("档位与检索词无关：单词/多词在同档下发出同一参数（word 不再派生档位）", () => {
    for (const word of ["東方", "東方 フラン"]) {
      expect(
        buildIllustSearchRequest(
          input({ word, filters: { ...DEFAULT_SEARCH_FILTERS, target: "exact" } }),
        ).params.search_target,
      ).toBe("exact_match_for_tags");
      expect(
        buildNovelSearchRequest(
          input({ word, filters: { ...DEFAULT_SEARCH_FILTERS, target: "title_and_caption" } }),
        ).params.search_target,
      ).toBeUndefined();
    }
  });

  it("热门路由同样携带档位参数（档位不因 popular-preview 变体丢失）", () => {
    const popular = { ...input(), sort: "popular_desc" as const };
    const illust = buildIllustSearchRequest({
      ...popular,
      filters: { ...DEFAULT_SEARCH_FILTERS, target: "exact" },
    });
    expect(illust.endpoint).toBe("/v1/search/popular-preview/illust");
    expect(illust.params.search_target).toBe("exact_match_for_tags");
    expect(Object.keys(illust.params)).not.toContain("sort");

    const novel = buildNovelSearchRequest({
      ...popular,
      filters: { ...DEFAULT_SEARCH_FILTERS, target: "title_and_caption" },
    });
    expect(novel.endpoint).toBe("/v1/search/popular-preview/novel");
    expect(Object.keys(novel.params)).not.toContain("search_target");
  });
});

/**
 * 用户搜索参数构建。oracle：
 * - docs/specs/search-user-scope.md §3 一手实测（2026-10-16，`docs/research/verify-search-user-api.sh`）：
 *   `GET /v1/search/user?word=水上&filter=for_ios&sort=date_desc` 响应正常
 * - 同 spec §5.1 参数口径表：`filter` 与另两端一致用 `baseParams` 同款 `for_ios`；
 *   `sort` 直发（pixivpy3/aapi.py L576-596 `search_user` 带 `sort` 形参）
 * - 不发其余参数的佐证（spec §5.1 证据强度）：pixez `getSearchUser` 只发 `word`；
 *   Mako `UserSearchEngine` 只发 `filter` + `word`。⚠️ 未做「发了是否报错」反向实验
 */
describe("buildUserSearchRequest", () => {
  const user = (sort: "date_desc" | "date_asc" | "popular_desc") =>
    buildUserSearchRequest({ word: "水上", sort });

  it("参数集合恰好三项 {word, filter, sort}——精确键集断言，防将来误加筛选参数", () => {
    const r = user("date_desc");
    expect(r.endpoint).toBe("/v1/search/user");
    expect(Object.keys(r.params).toSorted()).toEqual(["filter", "sort", "word"]);
    expect(r.params).toEqual({ word: "水上", filter: "for_ios", sort: "date_desc" });
  });

  it("不发 search_target / bookmark_num_* / 期间 / 比例 / 分辨率 / search_ai_type", () => {
    const keys = Object.keys(user("date_desc").params);
    for (const absent of [
      "search_target",
      "bookmark_num_min",
      "bookmark_num_max",
      "start_date",
      "end_date",
      "ratio_pattern",
      "width_min",
      "height_min",
      "search_ai_type",
    ]) {
      expect(keys).not.toContain(absent);
    }
  });

  it("不复用 baseParams 的两个恒发 bool（实测未发；user 端这两个参数三端均无可观测效果）", () => {
    const keys = Object.keys(user("date_desc").params);
    expect(keys).not.toContain("merge_plain_keyword_results");
    expect(keys).not.toContain("include_translated_tag_results");
  });

  it("三档 sort 全部直发 /v1/search/user——无 popular-preview 对应端点，sort 恒透传", () => {
    for (const sort of ["date_desc", "date_asc", "popular_desc"] as const) {
      const r = user(sort);
      expect(r.endpoint).toBe("/v1/search/user");
      expect(r.params.sort).toBe(sort);
    }
  });
});
