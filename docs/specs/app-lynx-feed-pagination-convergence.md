# app-lynx 分页收敛 + 受限卡等高 —— 功能规格

> 来源：grill-with-docs 会话（用户逐项拍板）；决策记录：ADR-0104（分页收敛）/ ADR-0105（受限卡等高）；术语：`packages/app-lynx/CONTEXT.md`
> 状态：ready-for-agent

## Problem Statement

1. **真机分页 404**：插画推荐/关注滚动到底触发分页返回 HTTP 404。根因 = 原生模式绝对 `next_url` 双域名 URL（ADR-0081 遗留缺口，影响所有分页端点）。
2. **分页 UX 缺陷**：分页失败通过 `errorMsg` 显示在**列表顶部**（内容在下面、错误在上面），到底无提示、无"没有更多了"。
3. **手写分页重复**：5 个列表页手写 loadMore（双防抖/竞态/空页防护），与已存在的深模块 `createMixFeed` 重复。
4. **受限小说卡高度塌陷**：受限条目卡 auto-height 在真机 list-item 测量下塌陷，「受浏览限制，不予显示」文案被裁（三处同款 markup）。

## Decisions（用户拍板）

| # | 决策 | 选项 |
|---|------|------|
| D1 | 复现环境 = 真机 LynxView（两个问题） | 真机 |
| D2 | 受限卡与普通卡等高 | b |
| D3 | 受限卡等高三处统一（NovelList / Bookmarks / UserHome） | 是 |
| D4 | 等高实现 = 显式固定高度（Lynx 最稳定） | a |
| D5 | 根因修复在共享 `client.ts`（rewriteUrl 原生归一化，对齐 ADR-0081） | 是 |
| D6 | 分页 UX = 根因 + 最小 UX（底部内联错误 + "没有更多了"），不加重试按钮 | b |
| D7 | UX 改动范围 = 核心列表页 6 处（IllustList / NovelList / Following / Recommended / UserHome / Bookmarks）；FollowList + 评论保持现状 | b |
| D8 | 受限卡高度 = 全站统一常量（非逐页对齐） | a |
| D9 | UX 实现路径 = 迁移到 createMixFeed 深模块（非就地手写） | X |
| D10 | `RestrictedNovelCard` 接口 = `{ item }`（内部派生 level） | { item } |

## 数据流与状态

### 分页状态机（createMixFeed 内，改造后）

```
首屏/刷新 loadFirstPage
  ├─ 全源成功 → rendered(前 pageSize) + pending(其余)，nextUrl 各源维护
  ├─ 部分失败 → 失败源标记耗尽，用成功源
  └─ 全失败 → firstError（顶部整页提示）
fetchMore（双防抖 800ms+3s、竞态代、优先消费 pending）
  ├─ pending 非空 → 同步追加，无网络
  ├─ 成功翻页 → 追加 + 去重 + 清 pageError
  ├─ 失败 → 置 pageError（底部内联，保留内容，nextUrl 保留供滚动重试）
  └─ 全耗尽 → no-op
到底态判定（页面）：nextUrl() === null && items 非空 && !loadingMore → footer「没有更多了」
```

**错误槽分离**：`error()` = 首屏/刷新失败（页面顶部整页提示）；`pageError()` = 分页失败（列表底部内联，保留已加载内容）。翻页成功只清 `pageError`；refresh 同时清两槽。

### mode/tab 切换（重建 feed 实例）

页面持有 `feed` 为 ref；mode（推荐↔关注）或 activeTab（插画↔小说）变化时**重建 createMixFeed 实例**（新 sources），旧实例 generation 机制自然丢弃在途旧响应。切回已加载 tab 时是否保留数据：跟随各页现状（重建 = 重新首载，符合切 tab 重载的既有行为）。

### 受限卡渲染

```
item → isRestricted(item)？
  ├─ 是 → RestrictedNovelCard :item（固定高度 + 徽章 + 文案，无交互）
  └─ 否 → 普通卡（现状不变）
```

`RestrictedNovelCard` 内部：level = `item.x_restrict === 2 ? 2 : 1`；高度常量 `RESTRICTED_NOVEL_CARD_HEIGHT`（约 40vw，实现后真机截图校准）。

## 边界条件

| 场景 | 行为 |
|------|------|
| mode 切换竞态 | 重建 feed 实例，generation 丢弃旧响应；节流/冷却状态随实例重置 |
| 空页（服务端返回空列表） | `nextUrl=null` → 该源耗尽 → 到底态；不误杀分页 |
| 全受限页 | 列表全量渲染受限卡（遮罩），分页继续（服务端语义判空） |
| 单源 feed | `sources` 长度 1，ratio `[1]`，mergeByRatio 正常 |
| 首屏失败 vs 分页失败 | firstError → 顶部整页；pageError → 底部内联，内容保留 |
| 到底后 scrolltolower | `hasNext()===false && pending 空` → fetchMore no-op，无请求 |
| 分页失败后滚动 | nextUrl 保留 + 3s 冷却 → 自动重试；成功清 pageError |
| 受限卡点击 | `@tap.stop`，不跳详情、不穿透（现状保持） |
| 受限卡高度 | 全站统一常量，不随页面普通卡高度变化 |
| KeepAlive / onActivated 补拉 | 各页现有逻辑保持（迁移不改变） |

## Tickets

依赖图：T1/T2/T9 无前置（可并行）→ T3~T8 依赖 T2（相互独立可并行）→ T10 依赖 T1。

| Ticket | 内容 | 前置 | 关键文件 | 验收 |
|--------|------|------|----------|------|
| **T1** | rewriteUrl 原生归一化 + client.test.ts 用例 | — | `src/api/client.ts`、`src/api/client.test.ts` | 原生分支：绝对 Pixiv URL 剥离域名、相对透传、非 Pixiv 原样；execute/requestRaw 原生分支传归一化路径；`pnpm test:app-lynx` 绿 |
| **T2** | createMixFeed 错误槽分流（firstError/pageError）+ 到底态支持 + 测试 | — | `src/primitives/createMixFeed.ts`、`createMixFeed.test.ts` | `pageError()` 新增；分页失败保留内容、清槽语义正确；单测覆盖 |
| **T3** | 迁移 `IllustList.vue` 到 createMixFeed（mode 切换重建） | T2 | `src/pages/IllustList.vue` | 推荐/关注两 tab 正常；footer 三态；pending 分批保留 |
| **T4** | 迁移 `NovelList.vue`（mode 切换重建） | T2 | `src/pages/NovelList.vue` | 推荐/关注两 tab 正常；footer 三态 |
| **T5** | 迁移 `Following.vue` | T2 | `src/pages/Following.vue` | 单源关注 feed；footer 三态 |
| **T6** | 迁移 `Bookmarks.vue`（两源 + activeTab 切换） | T2 | `src/pages/Bookmarks.vue` | 插画/小说两区各自分页；footer 三态 |
| **T7** | 迁移 `UserHome.vue`（两源 + activeTab 切换） | T2 | `src/pages/UserHome.vue` | 插画/小说两区各自分页；footer 三态 |
| **T8** | `Recommended.vue` 接入 pageError + footer 到底态 | T2 | `src/pages/Recommended.vue` | 混合 feed 错误底部显示；到底"没有更多了" |
| **T9** | `RestrictedNovelCard` 组件 + 三处替换（NovelList/Bookmarks/UserHome）+ 高度常量 | — | `src/components/RestrictedNovelCard.vue`、三页 | 受限卡等高、文案完整、level 派生内部化；真机截图校准高度 |
| **T10** | ADR-0081 遗留注记更新 + 收尾文档核对 | T1 | `docs/adr/ADR-0081-*.md` | 注记更新为已修复并引用 commit |

## 测试决策

- **T1**：rewriteUrl 原生分支 3 用例（绝对剥离/相对透传/非 Pixiv 原样）+ execute 原生传输路径断言——mock 契约来自 Java `PictelioApiModule`（`API_BASE + path` 拼接，真实插件源码），非手写自洽（测试硬约束 2）。
- **T2**：`createMixFeed.test.ts` 扩展——首屏失败 vs 翻页失败槽位分离、翻页成功清 pageError、refresh 清两槽、到底态判定（nextUrl null 且内容非空）。
- **迁移页面**：类型检查 + 现有单测 + web-core 手动回归（骨架/空态/切 tab/KeepAlive 行为不变）。
- **真机验证**：插画推荐/关注滚动到底无 404、"没有更多了"；小说/收藏/用户主页分页正常；受限小说卡高度与普通卡对齐（截图比对，微调 T9 高度常量）。

## 验证命令

- `pnpm check:app-lynx`（类型检查）
- `pnpm test:app-lynx`（单测：client + createMixFeed + 既有）
- 真机回归清单见上
