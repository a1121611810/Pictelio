/**
 * 编解码 round-trip 与非法输入归一。oracle：spec docs/specs/search-advanced-filters.md
 * §6.3 键表（fp/fd/fb/fr/fw/fa，**六个键** / **五个维度**——period 一维出两键 fp+fd）。
 *
 * ⚠️ 键表**不含** `target`（搜索目标档位，spec docs/specs/search-target-mode.md §3.2 新增）：
 * 该维度不参与 URL 编解码。这是本票明确排除的**已知缺口**，不是遗漏——唯一落点是下方
 * 「已知缺口登记」用例，不在 round-trip fixture 里做暗示。
 */
import { describe, expect, it } from "vitest";
import { decodeFiltersQuery, encodeFiltersQuery } from "../src/urlCodec";
import { BOOKMARK_BANDS, DEFAULT_SEARCH_FILTERS } from "../src/filters";

/**
 * URL 键表覆盖的**五个维度**（period/bookmark/ratio/minPixels/aiOverride），对应**六个键**
 * ——period 一维出 fp+fd。维度数 ≠ 键数：勿写成「六维」，那会把键数当成维数，
 * 并让人误以为 target 被算进了第 6 维（它根本不在键表里，见下方「已知缺口登记」）。
 */
const FULL_URL_KEYS = {
  period: { kind: "preset", preset: "1m" } as const,
  bookmark: BOOKMARK_BANDS[4]!,
  ratio: "portrait" as const,
  minPixels: 1000,
  aiOverride: "hide" as const,
};

describe("encodeFiltersQuery / decodeFiltersQuery", () => {
  it("默认筛选 → 空 query（不落任何键）", () => {
    expect(encodeFiltersQuery(DEFAULT_SEARCH_FILTERS)).toEqual({});
    expect(decodeFiltersQuery({})).toEqual(DEFAULT_SEARCH_FILTERS);
  });

  it("全维度 round-trip（五维 / 六键表；解码端恒补出 target=partial，见下方缺口登记）", () => {
    const f = { ...FULL_URL_KEYS, target: "partial" as const };
    const q = encodeFiltersQuery(f);
    expect(q).toEqual({ fp: "1m", fb: "4", fr: "portrait", fw: "1000", fa: "hide" });
    // 期望值显式展开：编码丢掉 target、解码经 normalizeFilters 补回 partial，两者恰好相等，
    // 但那是「默认值巧合」而非「该维度参与了 round-trip」——语义由下一条用例固定。
    expect(decodeFiltersQuery(q)).toEqual(f);
  });

  it("自定义期间 fd 编解码（含下划线分隔）", () => {
    const f = {
      ...DEFAULT_SEARCH_FILTERS,
      period: { kind: "custom", start: "2026-08-01", end: "2026-08-15" } as const,
    };
    expect(encodeFiltersQuery(f)).toEqual({ fd: "2026-08-01_2026-08-15" });
    expect(decodeFiltersQuery({ fd: "2026-08-01_2026-08-15" })).toEqual(f);
  });

  it("fd 优先于 fp（互斥）", () => {
    const f = decodeFiltersQuery({ fp: "1w", fd: "2026-08-01_2026-08-15" });
    expect(f.period).toEqual({ kind: "custom", start: "2026-08-01", end: "2026-08-15" });
  });

  /**
   * 已知缺口登记：`target` 完全不参与 URL query（非默认档经 URL 往返丢失）。
   *
   * 事实（src/urlCodec.ts）：encodeFiltersQuery 不写 target 键；decodeFiltersQuery 不传
   * target，normalizeFilters 缺省回 "partial"。⇒ 任何非默认档过一趟 URL 就被抹回 partial。
   * 选择登记而非沉默：本票明确不动 urlCodec —— spec docs/specs/search-target-mode.md §2
   * 非目标（「零生产消费方的遗留死代码」）、§9（建议另开技术债票）。两处只引小节号、不引
   * 行号：本仓并行改这些 spec，行号锚必然漂移（读法以小节号为准）。
   * ⚠️ 这是**缺口特征化**用例：将来补齐 target 编解码时它会红，届时应改写而非删除。
   */
  it("已知缺口登记：target 不进 URL query（编码不落键、解码恒回 partial、猜键名也不行）", () => {
    // 只改 target、其余全默认 → 编码产物是空 query（该维度对 URL 完全不可见）
    expect(encodeFiltersQuery({ ...DEFAULT_SEARCH_FILTERS, target: "exact" })).toEqual({});
    // 五维齐全（六键）+ 非默认档：编码产物不含 target 键，解码恒回默认档
    const q = encodeFiltersQuery({ ...FULL_URL_KEYS, target: "title_and_caption" });
    expect(Object.keys(q)).not.toContain("target");
    expect(decodeFiltersQuery(q).target).toBe("partial");
    // 手写 ft=（buildCacheKey 的键名）同样不被识别——排除「只是键名不同」的误读
    expect(decodeFiltersQuery({ ft: "exact" }).target).toBe("partial");
  });

  it("非法值一律回默认（容忍手改 URL）：未知预设/坏日期/越界带宽/非数字宽度/未知覆盖", () => {
    expect(decodeFiltersQuery({ fp: "2y" }).period).toEqual({ kind: "any" });
    expect(decodeFiltersQuery({ fd: "bad_bad" }).period).toEqual({ kind: "any" });
    expect(decodeFiltersQuery({ fb: "99" }).bookmark).toBeNull();
    expect(decodeFiltersQuery({ fb: "-1" }).bookmark).toBeNull();
    expect(decodeFiltersQuery({ fr: "diagonal" }).ratio).toBeNull();
    expect(decodeFiltersQuery({ fw: "abc" }).minPixels).toBeNull();
    expect(decodeFiltersQuery({ fw: "0" }).minPixels).toBeNull();
    expect(decodeFiltersQuery({ fa: "only" }).aiOverride).toBe("follow");
  });
});
