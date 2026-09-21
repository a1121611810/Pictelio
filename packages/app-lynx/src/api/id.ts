/**
 * 领域 ID Branded Types（API 层身份隔离 seam）
 *
 * 用途：TypeScript 结构化类型系统只认"形状"不认"身份"——所有 `number` 互相同形。
 * 给核心领域 ID（IllustId / NovelId / UserId / SeriesId / ChapterId）加唯一品牌标记，
 * 在 API 函数签名处拒绝跨类型 ID 误传（`loadDetail(novelId)` 接 `illustId` 会编译报错）。
 *
 * 机制（`unique symbol` + 交叉类型）：
 * - `unique symbol` 在编译期绝对唯一（不能用字符串字面量替代——会被其他类型意外满足）
 * - 交叉类型 `number & { readonly [Brand]: typeof Brand }` 把品牌钉死在 type 层面
 * - 运行时：symbol 被擦除，所有 Branded 类型仍是 `number`——零运行时代价、bundle 零增长
 *
 * 边界规则：
 * - HTTP / DB 反序列化：response 字段声明 Branded 类型（`api/types.ts`），调用方从 `response.id` 取值自动获得 Branded
 * - API 函数签名：仅接受 Branded；调用方传 raw `number` 立即 TS2345 拒绝
 * - 非 response 源（localStorage / URL 参数 / parseInt）：经工厂函数转换（`toIllustId(raw)` 等）
 *
 * @example
 * ```ts
 * const illustId = toIllustId(123);    // IllustId
 * loadDetail(illustId);                // ✓ 类型匹配
 * loadDetail(illustId);                // ✗ loadDetail 期望 NovelId → TS2345
 * ```
 *
 * 跨端策略：双端 byte-identical 复制（沿 assertNever ADR-0181 D2 / "双端差分对齐"惯例）。
 *
 * @see docs/adr/ADR-0182-branded-types-for-api-ids.md
 * @see docs/specs/branded-types-for-api-ids.md
 */

// ─── 5 个 unique symbol（编译期绝对唯一；运行时擦除）───

declare const IllustIdBrand: unique symbol;
declare const NovelIdBrand: unique symbol;
declare const UserIdBrand: unique symbol;
declare const SeriesIdBrand: unique symbol;
declare const ChapterIdBrand: unique symbol;

// ─── 5 个 Branded 类型（结构同形但身份不同）───

export type IllustId = number & { readonly [IllustIdBrand]: typeof IllustIdBrand };
export type NovelId = number & { readonly [NovelIdBrand]: typeof NovelIdBrand };
export type UserId = number & { readonly [UserIdBrand]: typeof UserIdBrand };
export type SeriesId = number & { readonly [SeriesIdBrand]: typeof SeriesIdBrand };
export type ChapterId = number & { readonly [ChapterIdBrand]: typeof ChapterIdBrand };

// ─── 5 个工厂函数（系统边界：raw number → Branded）───

/** 把 raw `number` 转换为 `IllustId`。在 HTTP 响应解析、URL 参数、localStorage 持久化值等边界处调用。 */
export function toIllustId(raw: number): IllustId {
  return raw as IllustId;
}

/** 把 raw `number` 转换为 `NovelId`。 */
export function toNovelId(raw: number): NovelId {
  return raw as NovelId;
}

/** 把 raw `number` 转换为 `UserId`。 */
export function toUserId(raw: number): UserId {
  return raw as UserId;
}

/** 把 raw `number` 转换为 `SeriesId`。 */
export function toSeriesId(raw: number): SeriesId {
  return raw as SeriesId;
}

/** 把 raw `number` 转换为 `ChapterId`。 */
export function toChapterId(raw: number): ChapterId {
  return raw as ChapterId;
}
