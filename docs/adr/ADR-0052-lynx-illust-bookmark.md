# ADR 0052: app-lynx 插画收藏（详情页 + 列表卡片 ♥）

## 状态

已采纳

## 分类

技术决策 / 功能

## 日期

2026-08-01

## 背景

app-lynx 的插画详情/列表**只读**——无收藏操作（只有展示性 `total_bookmarks` 文本）。主项目 app 有完整收藏：`api/illust.ts` 的 `addBookmark(illustId, restrict="public")`（POST `/v2/illust/bookmark/add`）与 `deleteBookmark`（POST `/v1/illust/bookmark/delete`），入口在列表卡片（ImageCard ♥）与详情页（♥ + 收藏数），默认收藏到 public。

app-lynx 数据层已就绪：`PixivIllust.is_bookmarked` 字段（types.ts:49）由推荐/详情接口返回。

## 决策

### 1. 收藏 API（`api/illust.ts`）

对齐主项目端点与参数，**默认 `restrict: "public"`**：

- `addBookmark(illustId)` → POST `/v2/illust/bookmark/add`（body: illust_id + restrict=public）
- `deleteBookmark(illustId)` → POST `/v1/illust/bookmark/delete`

### 2. `BookmarkButton.vue` 组件（列表 + 详情复用）

- Props：`illustId` / `initialBookmarked` / `bookmarkCount?`（可选，传入显示计数）
- 本地响应式 `bookmarked` / `count`：点击调 API 切换，成功后更新本地状态与计数（±1）
- `@tap.stop`：**阻止冒泡到卡片 tap（进详情）**——列表卡片点击 ♥ 不应触发 `openDetail`
- 失败显示"操作失败"小字；`busy` 防重复点击

### 3. 两处入口

- **详情页**（`IllustDetail.vue`）：原"♥ 收藏数"文字替换为 BookmarkButton（带计数）
- **列表卡片**（`Recommended.vue`）：底部收藏数行替换为 BookmarkButton（带计数）

## 权衡

| 方案 | 结论 |
|------|------|
| 入口：仅详情页 | 被否——用户要求列表卡片也要（对齐主项目 ImageCard） |
| 公开/私密选择 UI | MVP 简化——默认 public（对齐主项目默认），私密收藏后续 |
| 状态管理：全局 store vs 组件本地 | **组件本地**——收藏状态以服务端为唯一事实源（is_bookmarked），本地仅做点击即时反馈；全局 store 需额外同步（主项目 bookmarkStore 是 feed 级联动，app-lynx MVP 不必） |
| 冒泡控制 | `@tap.stop`（vue 修饰符）——实测生效（点击 ♥ 不跳详情） |

## 风险

- **本地状态与服务端短暂不一致**：点击后本地立即更新，若 API 失败回滚提示"操作失败"；重新进入页面以 API 返回的 `is_bookmarked` 为准。
- **`@tap.stop` 依赖 vue-lynx 事件修饰符**：已实测生效；原生 LynxView（#41）需验证 tap 事件冒泡/阻止语义。
- **列表与详情状态不同步**：列表收藏后进详情，详情 `is_bookmarked` 以接口返回为准（会显示最新状态）——无冲突。
- **小说收藏**：本 ADR 仅覆盖插画（主项目另有 novelBookmarkStore）；小说收藏后续。

### 正面

- 两入口对齐主项目交互（卡片 ♥ + 详情 ♥）
- 组件复用、本地状态简洁（无全局同步负担）
- 默认 public 与主项目一致

### 反面

- 无私密收藏（MVP 简化）
- 小说收藏未覆盖

## 相关

- 主项目 `api/illust.ts`（端点/参数对齐来源）
- ADR-0050/0051（IndexedDB 存储层，收藏状态不持久化——以服务端为准）
- 实施提交：`10c7695`
