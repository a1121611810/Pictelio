# Pixiv 搜索排序 Bug：「最新」与「热门」结果相同

> **Status:** 研究文档 / Bug 分析
> **Created:** 2026-07-30
> **Updated:** 2026-07-30
> **Related:** [ADR 0009: 搜索功能](./adr/0009-search-feature.md)、`src/api/search.ts`、`src/api/types.ts`、`src/stores/searchStore.ts`

## 问题描述

搜索页的排序切换中，「最新」和「热门」两个 Tab 返回的搜索结果看起来相同，用户无法区分。

## 根因

### 问题来源

当前「最新」和「热门」使用了**同一个 API 端点** `/v1/search/illust`，仅仅传递了不同的 `sort` 参数值：

| 排序 | 发送的 sort 值 | 调用的 API |
|------|---------------|-----------|
| 最新 | `date_desc` | `/v1/search/illust?sort=date_desc` |
| 最早 | `date_asc` | `/v1/search/illust?sort=date_asc` |
| 热门 | `popular_desc` ⚠️ | `/v1/search/illust?sort=popular_desc` ⚠️ |

### `sort=popular_desc` 的实际行为

根据 Pixiv 官方 API 的反向工程社区（[pixivpy](https://github.com/upbit/pixivpy)）的研究：

- `sort=popular_desc` **确实是 `/v1/search/illust` 的有效参数**，不是静默被忽略
- 该参数对非 Premium 用户也可用（PR #134 证实："没开premium的账号照样能用"）
- **但实现方式很差**：Pixiv 服务端按投稿时间抓取一批结果，然后**在内存中对这批结果按收藏数重新排序**。因此第一页后面的结果（通过 `next_url` 翻页获取的）的收藏数实际上很少，与 `date_desc` 没本质区别
- 对于很多搜索关键词，第一页的"最新"和"热门"结果因为排序算法问题，看起来可能高度相似

### Pixiv 官方的正确热门端点

Pixiv 官方 iOS/Android App 中，"热门"搜索实际使用的是**独立的预览端点**：

| 功能 | 正确 API |
|------|---------|
| 最新 | `GET /v1/search/illust?sort=date_desc` |
| 最早 | `GET /v1/search/illust?sort=date_asc` |
| **热门** | **`GET /v1/search/popular-preview/illust`**（独立预览端点） |

该端点的特性：

- **只返回 ~30 条真正的热门结果**（社区称之为"热度排序的预览"）
- **不分页，不返回 `next_url`** — 这一点与标准搜索端点完全不同
- 响应结构与标准搜索类似，返回 `{ illusts: [...], ... }`（不含 `next_url` 字段或 `next_url` 为 `null`）
- 小说对应端点：`GET /v1/search/popular-preview/novel`

> 来源：[pixivpy Issue #237](https://github.com/upbit/pixivpy/issues/237) "请求添加搜索热度排序 30 张预览" — 官方提供的热门预览端点，返回约 30 张最热门作品

## 对「热门」分页行为的影响

由于 `/v1/search/popular-preview/illust` **不分页**，使用该端点后：

- 热门搜索将只显示 ~30 条结果
- 无法滚动加载更多（没有 `loadMore` 功能）
- 这与标准搜索（`date_desc`/`date_asc`）的无限滚动体验不同

这是一个有意的产品决策取舍：热门预览提供的是真正高质量的热门结果，而不是大量虚假的"热门"结果。

## 涉及的文件

| 文件 | 说明 |
|------|------|
| `src/api/types.ts:177` | `SearchSort` 类型定义，允许 `"popular_desc"` |
| `src/api/search.ts:20-44` | `searchIllust` / `searchNovel` 直接使用 `/v1/search/illust` + `/v1/search/novel`，未区分热门端点 |
| `src/stores/searchStore.ts:142` | `executeSearch` 函数只调 `searchIllust` / `searchNovel`，`sort` 作为参数传入 |
| `src/routes/Search.tsx:18-22` | `SORT_OPTIONS` 常量包含 `{ value: "popular_desc", label: "热门" }` |

## 影响范围

- 当前的「热门」搜索结果**质量很差**，底部结果实际收藏数很低，与「最新」高度相似
- 用户无法通过排序功能发现真正高人气作品
- 这个问题从一开始就存在（ADR 0009 中就已列出了 `popular_desc`，但当时未意识到其实现缺陷）

## 修复方向

需要做以下改动：

### 1. 新增 API 函数

在 `src/api/search.ts` 中添加：

```typescript
// 热门插画预览 — 不分页，返回 ~30 条
export function searchPopularIllust(
  word: string,
  searchTarget: SearchTarget = "partial_match_for_tags",
  signal?: AbortSignal,
): Promise<PixivIllustListResponse> {
  return apiClient.get<PixivIllustListResponse>(
    "/v1/search/popular-preview/illust",
    { word, search_target: searchTarget, filter: "for_ios" },
    signal,
  );
}

// 热门小说预览 — 不分页，返回 ~30 条
export function searchPopularNovel(
  word: string,
  searchTarget: SearchTarget = "partial_match_for_tags",
  signal?: AbortSignal,
): Promise<PixivNovelListResponse> {
  return apiClient.get<PixivNovelListResponse>(
    "/v1/search/popular-preview/novel",
    { word, search_target: searchTarget, filter: "for_ios" },
    signal,
  );
}
```

### 2. 修改 searchStore

`executeSearch` 中根据 `sort()` 的值分流：

- `sort === "date_desc" | "date_asc"` → 调原 `/v1/search/illust` 端点（标准分页搜索）
- `sort === "popular_desc"` → 调 `/v1/search/popular-preview/illust` 端点（无分页预览）
- 同样逻辑套用到 novel

**关键差异**：由于 popular-preview 不分页，`loadMore()` 在热门模式下应无操作（`hasMore()` 返回 `false`）。

### 3. 适配响应类型

`PixivIllustListResponse` 和 `PixivNovelListResponse` 接口已有 `next_url: string | null` 字段，popular-preview 的 `next_url` 为 `null`，所以响应类型无需改动。

### 4. `SearchSort` 类型修改

```typescript
// 建议保留现有值，仅新增文档说明 popular_desc 对应的 API 端点特殊
export type SearchSort = "date_desc" | "date_asc" | "popular_desc";
```

## 参考

- Pixiv App API 端点: `/v1/search/illust`, `/v1/search/novel`, `/v1/search/popular-preview/illust`, `/v1/search/popular-preview/novel`
- [pixivpy Issue #237](https://github.com/upbit/pixivpy/issues/237) — 关于 popular-preview 端点的讨论
- [pixivpy PR #134](https://github.com/upbit/pixivpy/pull/134) — `sort=popular_desc` 的实现确认
- ADR 0009: 原始搜索功能设计文档
