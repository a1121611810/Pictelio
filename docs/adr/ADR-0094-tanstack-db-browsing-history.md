# ADR-0094: 采用 TanStack DB 实现本地浏览历史

## 状态

已批复 — 待实施

## 背景

Pictelio 缺少用户浏览历史功能。用户浏览过的插画/小说没有记录，无法追溯「刚才看到的好作品」。现需求为增加浏览历史页。

核心约束：

1. **纯本地** — 浏览历史不上传到 Pixiv 服务端
2. **用户隔离** — 多用户登录时数据互不干扰
3. **1 个月自动过期** — 30 天后的记录懒清除
4. **去重** — 同一作品重复打开，仅更新时间戳和累积访问次数

## 调研的方案

| 方案 | 说明 | 结论 |
|------|------|------|
| A) 自定义 2-tier (IndexedDB) | 复用 novelCache 模式，手写 ~150 行 store + 零新依赖 | ❌ 不采用 — 虽然当下零成本，但项目已有 ~1200 行手工缓存代码( feedStore + novelStore )需要重构，先引入 TanStack DB 可为后续铺路 |
| B) TanStack DB + Capacitor SQLite | 原生 SQLite 持久化，但需额外包 + 社区插件 + 原生构建配置 | ❌ 不采用 — 对浏览历史这种 ~422KB 小数据集，Capacitor SQLite 的复杂度过高 |
| C) TanStack DB + localStorage | 装 `@tanstack/solid-db`，用内置 `localStorageCollectionOptions` | ✅ 采用 |

**关键决策因素**：浏览历史数据结构简单（单 collection，insert/update/delete/getAll），不需要差分数据流引擎的跨 collection join 能力，也不需要对服务端的乐观更新。但当下的低引入成本 + 后续 feedStore/novelStore 重构可复用 TanStack DB 生态，是「先投资后收益」的合理选择。

## 决定

**采用 `@tanstack/solid-db` v0.2.30，使用 `localStorageCollectionOptions` 持久化浏览历史。**

### 数据模型

```typescript
interface HistoryEntry {
  key: string;              // `${userId}_${type}_${id}` — TanStack DB getKey
  userId: number;
  type: "illust" | "novel";
  id: number;
  title: string;
  userName: string;
  thumbnailUrl: string;     // square_medium → proxy URL
  xRestrict: 0 | 1 | 2;
  visitedAt: number;        // Date.now() 最后访问
  visitCount: number;
}
```

### Collection 配置

```typescript
import { createCollection } from '@tanstack/solid-db'
import { localStorageCollectionOptions } from '@tanstack/solid-db'

const historyCollection = createCollection(
  localStorageCollectionOptions({
    id: 'browsing-history',
    storageKey: 'pictelio-browsing-history',
    getKey: (entry) => `${entry.userId}_${entry.type}_${entry.id}`,
    // ⚠️ 必须 startSync: true，否则 useLiveQuery 的派生 collection 无法变为 ready
    startSync: true,
  })
)
```

### 响应式查询

```typescript
// HistoryPage.tsx
const query = useLiveQuery((q) =>
  q.from({ h: historyCollection })
   .where(({ h }) => eq(h.userId, currentUserId))
   .orderBy(({ h }) => h.visitedAt, 'desc')
)
```

### 过期策略

不通过 TanStack DB 配置过期——在每次写入前检查 `visitedAt < Date.now() - 30天` 的条目，对符合条件的调用 `collection.delete()`。TanStack DB 在写入时通过 `lastKnownData`（常驻内存的 Map）维护集合状态，过期检查 O(n) 遍历 900 条可接受。

## 依赖变化

| 包 | 版本 | 类型 |
|----|------|------|
| `@tanstack/solid-db` | ^0.2.30 | dependencies（新增） |

## 需要修改的文件

| 文件 | 改动 |
|------|------|
| `packages/app/package.json` | 添加 `@tanstack/solid-db` 依赖 |
| `src/stores/historyStore.ts` | **新建**：`createCollection` + `localStorageCollectionOptions` + 过期清除函数 |
| `src/routes/HistoryPage.tsx` | **新建**：历史页面组件，`useLiveQuery` + `Virtualizer` 时间线 |
| `src/components/NavBar.tsx` | tabs 数组增加 `{ key: "history", label: "历史", icon: "history" }` |
| `src/components/ui/FluentIcon.tsx` | 增加 `history` 图标（regular + filled SVG path） |
| `src/stores/uiStore.ts` | `Tab` 类型增加 `"history"` |
| `src/router.tsx` | 增加 `historyRoute` 并注册到 route tree |
| `src/routes/IllustDetail.tsx` | data loaded 后调用 `addHistoryEntry()` |
| `src/routes/NovelDetail.tsx` | data loaded 后调用 `addHistoryEntry()` |

## 不做的事（明确不包含在本 ADR 中）

- 不同步 Pixiv 服务端历史
- 不迁移 feedStore/novelStore 到 TanStack DB（此 ADR 只负责浏览历史的功能引入）
- 不使用 `@tanstack/query-db-collection`、`@tanstack/capacitor-db-sqlite-persistence` 或 `@tanstack/browser-db-sqlite-persistence`
- 不修改现有 `db.ts`（IndexedDB 抽象）

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| `@tanstack/db` v0.x Beta 版本升级可能 break API | Pin `^0.2.30`，后续升级遵循 semver。浏览历史功能非核心体验，出问题影响面小 |
| localStorage 全量序列化 422KB 可能造成主线程阻塞 | 每次写入 ~2-3ms，用户操作频率 ~1-3次/分钟，不可感知。如果后续数据膨胀可换成 `browser-db-sqlite-persistence` |
| `useLiveQuery` 在 SolidJS 中的响应式追踪 | 已有项目使用 `@tanstack/solid-query`，Solid 适配器经验成熟。`useLiveQuery` 返回的 `data` 是纯数组，配合 `<For>` reconciliation 正常 |
