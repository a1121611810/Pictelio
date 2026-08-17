# ADR-0093: 采用 TanStack Query 管理服务端状态

## 状态

已批准 — Phase 1 实施中

## 背景

Pictelio 的服务端状态管理长期依赖手写模式：`createStore` + 命令式 async 函数（feedStore, novelStore）、`createResource`（bookmarkStore, userIllustsStore）、以及纯 `createSignal` + 手写 try/catch（userStore, followListStore）。存在以下问题：

1. **样板代码重复** — 每个 store 手动维护 `setLoading` / `setError` / `fetchMore` 开关，全项目约 200 行相似模式
2. **缓存永不失效** — `tabIllusts` / `tabNextUrl` 等模块级对象存储的数据直到页面刷新才释放，导致内存泄漏
3. **缺少缓存 TTL** — 数据不会因时效自动过期，用户看到的数据可能已是数十分钟前的快照
4. **缺少后台刷新** — 前台恢复无自动重新校验，需手写 `appStateChange` 监听
5. **请求去重逻辑重复** — `client.ts` 已有 `inflightGetRequests` 做请求层去重，但组件层仍可能发起重复请求

## 调研的方案

| 方案 | 说明 | 结论 |
|------|------|------|
| TanStack Query v5 | @tanstack/solid-query，原生 SolidJS 适配器 | ✅ 采用 |
| SolidJS createResource | 已有，不支持缓存 TTL、断点续传 | ❌ 保留但不再扩展 |
| SWR（Vercel） | 无官方 Solid 适配器 | ❌ |
| 自建缓存层 | 可控但工程量与 TQ 相当 | ❌ |

## 决定

**采用 `@tanstack/solid-query` v5，Phase 1 用 Thin Store 封装模式逐步替换。**

### 关键设计决策

1. **queryKey 工厂函数** — 集中定义在 `src/api/queryKeys.ts`，`as const` 保证类型精确，支持前缀级批量失效
2. **createInfiniteQuery + select flatMap** — 分页使用 Pixiv 的 cursor（`next_url`）模式，`select` 将 `pages` 扁平化为单层数组
3. **Thin Store 封装** — Phase 1 保持 store 文件的向外 API 不变，route 文件和 loader 零修改；后续 Phase 可视情况 collapse
4. **`structuralSharing: false`** — Solid 适配器硬编码此值，确认在 flatMap 场景下 `createMemo` 和 `<For>` 的 reconciliation 仍正常工作（已有 item 引用不变，`<For>` 按引用匹配跳过重渲染）
5. **错误归一化** — `normalizeQueryError()` 统一处理 TQ 的 `Error` 类型和 client.ts 抛出的 `ApiError` 类型

### QueryClient 默认配置

```ts
staleTime: 5 * 60 * 1000   // 5 分钟内不重新拉取
gcTime: 30 * 60 * 1000     // 离开页面后缓存保留 30 分钟
retry: 1                    // 只重试 1 次（client.ts 另有指数退避）
refetchOnWindowFocus: false // Capacitor 下 window focus 不可靠
```

### 分阶段计划

- **Phase 1**: bookmarkStore, userIllustsStore, followListStore
- **Phase 2**: feedStore, novelStore（保留聚合层）
- **Phase 3**: userStore

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| Solid 适配器 `structuralSharing: false` 导致重渲染 | 确认 item 引用 identity 不变，`<For>` reconciliation 跳过已有元素 |
| `createInfiniteQuery` cache miss 后全量重拉 | Phase 1 数据量小（~2-3 页），`gcTime: 30min` 覆盖常见返回场景 |
| 测试 mock 层变更 | Thin Store 保持接口不变，仅替换 mock `createResource` → mock `createInfiniteQuery` |

## 术语表

| 术语 | 定义 |
|------|------|
| Thin Store | 保持原有导出接口不变，仅将内部实现替换为 TQ hooks 的 store 文件 |
| queryKey 工厂 | `queryKeys.bookmarks(uid, restrict)` 形式返回 `as const` tuple 的函数 |
| select flatMap | `createInfiniteQuery` 的 `select` 选项将 `data.pages.flatMap(p => p.illusts)` 返回单层数组 |
| cursor 分页 | 使用 Pixiv API 返回的 `next_url` 作为 `getNextPageParam` 的游标 |
