# AI 作品三态过滤（显示/隐藏/仅看）可行性研究报告

**研究问题**：目前的接口能提供做到"AI 作品三态过滤（显示/隐藏/仅看）"吗？

**研究日期**：2025年
**研究范围**：Pixiv API 类型定义、现有过滤基础设施、搜索端点、Web 公开文档

---

## 一、当前 API 能力

### 1.1 Pixiv API 是否提供 AI 作品字段？

**答案：✅ 提供。**

Pixiv API 在作品（Illust）和小说（Novel）响应中均包含 `ai_type` 字段：

```typescript
// packages/app/src/api/types.ts

export interface PixivIllust {
  // ...
  illust_ai_type?: number;   // ← AI 类型字段（line 54）
  // ...
}

export interface PixivNovel {
  // ...
  novel_ai_type?: number;    // ← AI 类型字段（line 82）
  // ...
}
```

**类型值含义**（基于 Greasy Fork `Pixiv AI Artwork Marker` 脚本源码，该脚本通过官方 Pixiv API 获取 `ai_type` 进行标记）：

| `ai_type` 值 | 含义 | 当前 app 行为 |
|---|---|---|
| `0` 或 `undefined` / `null` | 非 AI 作品（纯人工创作） | 不显示 AI 标记 |
| `1` | AI 辅助创作（AI-assisted） | 显示"AI辅"badge |
| `2` | 纯 AI 生成（AI-generated） | 显示"AI"badge |

### 1.2 现有 UI 对 AI 字段的使用

当前 Pictelio 仅**显示** AI badge，**不进行过滤**。实现位置：

- `packages/app/src/components/GridCard.tsx:91-94`
- `packages/app/src/components/ImageCard.tsx:104-106`
- `packages/app/src/components/home/IllustSingleCard.tsx:100-102`
- `packages/app/src/components/NovelCard.tsx:90-92, 263-265`
- `packages/app/src/components/NovelTextListCard.tsx:88-94`
- `packages/app/src/components/home/NovelRowCard.tsx:60-61`

以 `GridCard.tsx` 为例：

```tsx
{props.illust.illust_ai_type != null && props.illust.illust_ai_type > 1 && (
  <fluent-badge appearance="filled" style="font-size:var(--fontSizeBase100)">
    {props.illust.illust_ai_type === 2 ? "AI" : "AI辅"}
  </fluent-badge>
)}
```

**注意**：当前判断条件是 `> 1`（即 `2` 显示"AI"，`1` 显示"AI辅"），与上表的语义一致。

### 1.3 搜索 API 是否支持 AI 过滤？

**答案：❌ 不支持。**

`searchIllust()` 调用 `/v1/search/illust` 和 `/v1/search/popular-preview/illust`，参数为：

```typescript
{ word, sort, search_target: searchTarget, filter: "for_ios" }
```

搜索参数中 **没有** `illust_ai_type` 相关字段。Pixiv 搜索端点不支持通过 AI 类型筛选，搜索结果的 AI 过滤必须由客户端完成。

---

## 二、现有过滤基础设施模式

### 2.1 R18/R18G 过滤实现 — `r18Filter.ts`

`packages/app/src/utils/r18Filter.ts` 建立了完整的客户端过滤模式，是实现 AI 过滤的最佳参考：

```typescript
import type { PixivIllust, PixivNovel, PixivUserPreview } from "../api/types";
import { showR18, showR18G } from "../stores/settingsStore";
import { isBlocked } from "../stores/blockStore";

/**
 * 判断内容是否应被过滤（R-18 或 R-18G 开关关闭时隐藏对应内容）。
 * x_restrict: 0=全年龄, 1=R-18, 2=R-18G
 */
function isRestricted(item: { x_restrict: number }): boolean {
  if (!showR18() && item.x_restrict === 1) {
    return true;
  }
  if (!showR18G() && item.x_restrict === 2) {
    return true;
  }
  return false;
}

/** 判断内容作者是否已被屏蔽 */
function isBlockedUser(item: { user: { id: number } }): boolean {
  return isBlocked(item.user.id);
}

/**
 * 过滤作品列表：同时应用 R18 / R-18G 开关与屏蔽用户。
 */
export function filterFeedIllusts(illusts: PixivIllust[]): PixivIllust[] {
  return illusts.filter((i) => !isRestricted(i) && !isBlockedUser(i));
}

/**
 * 过滤小说列表
 */
export function filterNovels(novels: PixivNovel[]): PixivNovel[] {
  return novels.filter((n) => !isRestricted(n) && !isBlockedUser(n));
}

/** 过滤 user_previews */
export function filterUserPreviews(previews: PixivUserPreview[]): PixivUserPreview[] {
  return previews
    .filter((p) => !isBlocked(p.user.id))
    .map((p) =>
      Object.assign({}, p, {
        illusts: p.illusts.filter((i) => !isRestricted(i)),
      }),
    );
}
```

### 2.2 设置持久化 — `settingsStore.ts`

R18/R18G 开关通过账号级偏好存储持久化，使用 `settings.defineFactory` 按 uid 隔离：

```typescript
// 账号级 R18/R18G 偏好工厂
const r18Factory = settings.defineFactory(uid => ({
  key: `show_r18_${uid}`,
  default: false,
  ...
}));

const r18gFactory = settings.defineFactory(uid => ({
  key: `show_r18g_${uid}`,
  default: false,
  ...
}));

// showR18 / showR18G 导出供 r18Filter.ts 使用
export const showR18 = () => r18Factory.forId(uid()).value();
export const showR18G = () => r18gFactory.forId(uid()).value();
```

### 2.3 过滤调用点覆盖

`filterFeedIllusts` / `filterNovels` 被以下数据源使用：

| Store 文件 | 数据源 | 过滤函数 |
|---|---|---|
| `userIllustsStore.ts` | 用户作品列表 | `filterFeedIllusts` |
| `bookmarkStore.ts` | 收藏 | `filterFeedIllusts` |
| `followStore.ts` | 关注作品 | `filterFeedIllusts` |
| `recommendedStore.ts` | 推荐 | `filterFeedIllusts` |
| `followListStore.ts` | 关注/粉丝列表 | `filterUserPreviews` |
| `novelBookmarkStore.ts` | 小说收藏 | `filterNovels` |
| `novelFollowStore.ts` | 关注小说 | `filterNovels` |
| `novelRecommendedStore.ts` | 推荐小说 | `filterNovels` |

所有 feed 数据都经由这些过滤函数，**架构上完全统一**，新增 AI 过滤只需修改 `r18Filter.ts`。

---

## 三、可行性评估

### 3.1 三态过滤定义

参考 R18/R18G 的二态模式，设计 AI 三态：

| 状态 | 设置值 | 过滤逻辑 |
|---|---|---|
| 显示全部 | `showAll` | 不过滤任何作品 |
| 隐藏 AI 作品 | `hideAI` | 过滤 `ai_type === 2` 的作品 |
| 仅看 AI 作品 | `showOnlyAI` | 仅显示 `ai_type >= 1` 的作品（即包含 1 和 2）|

> **注意**：`ai_type = 1`（AI 辅助）和 `ai_type = 2`（纯 AI）在语义上都是"AI 相关作品"，"仅看 AI 作品"时应同时包含两者。

### 3.2 所需改动范围

| 层级 | 文件 | 改动 |
|---|---|---|
| **类型** | `packages/app/src/api/types.ts` | 可选：定义 `AIFilterMode` 联合类型 |
| **设置** | `packages/app/src/stores/settingsStore.ts` | 新增 `aiFilterMode` 账号级设置项 |
| **过滤** | `packages/app/src/utils/r18Filter.ts` | 扩展 `isRestricted` 或新增 `isAIFiltered` 函数，同时应用于 `filterFeedIllusts` / `filterNovels` |
| **UI** | `packages/app/src/components/settings/` | 新增 AI 过滤三态选择器 UI |
| **app-lynx** | `packages/app-lynx/src/stores/settingsStore.ts` | 同步 AI 过滤设置（同 R18/R18G 模式） |

### 3.3 关键约束

1. **搜索结果无法服务端过滤**：由于 Pixiv 搜索 API 不支持 `illust_ai_type` 参数，搜索结果中的 AI 过滤必须完全在客户端执行，与 R18/R18G 过滤模式一致。

2. **推荐/关注/收藏等 Feed 已完全接入过滤**：现有 `filterFeedIllusts` / `filterNovels` 覆盖所有 feed 数据源，改动集中在一处即可全量生效。

3. **app-lynx 需同步**：`packages/app-lynx/src/stores/settingsStore.ts` 独立维护了一套 R18/R18G 设置，AI 过滤设置需按同样模式同步到 app-lynx。

4. **AI 类型字段为 `number` 而非枚举**：需在注释中明确约定值语义，并补充单元测试防止值域漂移。

---

## 四、结论与建议

### 结论

| 问题 | 答案 |
|---|---|
| Pixiv API 是否提供 AI 类型字段？ | ✅ 是，`illust_ai_type`（插画）和 `novel_ai_type`（小说） |
| 字段值含义是否明确？ | ✅ 是：`0/1/2` 对应 非AI/AI辅助/纯AI |
| 客户端是否已有过滤基础设施？ | ✅ 是，`r18Filter.ts` 提供了完整模式 |
| 搜索 API 是否支持 AI 过滤？ | ❌ 否，但客户端过滤可覆盖 |
| **三态过滤是否可行？** | **✅ 完全可行，API + 基础设施均已就绪** |

### 建议实施路径

1. **扩展 `r18Filter.ts`**：新增 `AIFilterMode` 类型定义和 `isAIFiltered` 判断函数，在 `filterFeedIllusts` / `filterNovels` 中追加 AI 过滤逻辑。

2. **在 `settingsStore.ts` 新增设置项**：按 `r18Factory` / `r18gFactory` 同款模式新增 `aiFilterModeFactory`，导出 `aiFilterMode()` 供 `r18Filter.ts` 调用。

3. **添加单元测试**：参照 `tests/unit/utils/r18Filter.test.ts` 补充 AI 过滤的真值表测试，覆盖 `ai_type` 三个值的各种组合。

4. **UI 层实现**：参照 R18/R18G 开关 UI，在设置页添加三态选择器（全部 / 隐藏AI / 仅看AI）。

5. **app-lynx 同步**：按 `settingsStore.ts` 的跨引擎契约模式同步实现。

---

## 参考资料

- Pixiv API 类型定义：`packages/app/src/api/types.ts`
- R18/R18G 过滤实现：`packages/app/src/utils/r18Filter.ts`
- R18/R18G 设置存储：`packages/app/src/stores/settingsStore.ts`
- AI Badge UI 示例：`packages/app/src/components/GridCard.tsx:91-94`
- Greasy Fork `Pixiv AI Artwork Marker` 脚本：https://greasyfork.org/scripts/544700 （通过官方 API `ai_type=2` 标记 AI 作品）
