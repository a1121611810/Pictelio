# Spec: app-lynx 小说介绍页底部操作行（收藏·追更·下载·系列目录）

> 阶段：to-spec（Grill 决策已锁定，见 §2）
> 范围：**仅 packages/app-lynx**；webview 端不动
> 关联：ADR-0167（小说介绍页三段式）、ADR-0167 补充（追更/收藏入口）、ADR-0165（小说文本选择）、ADR-0146（下载队列）、ADR-0083（dead-code cleanup）、ADR-0123（原生 LynxView hit-testing 平台约束）

## 1. 背景与目标

当前 `NovelIntro.vue` 底部 CTA 行仅承载「BookmarkButton + 开始阅读」，覆盖不全：

- **收藏**：已存在（ADR-0167）✓
- **系列目录**：系列名仅展示文字，不可点击；lynx 端无 `SeriesSheet`（webview 有）
- **追更**：「已追更」chip 被动展示，**不可点击**；正文页有 `createWatchlistPrompt`（滚到底/返回时弹窗），但介绍页入口缺失
- **下载**：完全未展示；lynx 端目前只有「导出为文件」入队（`enqueueNovelExport`），下载队列里有 `status: 'completed'` 但只能按 taskId 查询，无 `novelId` 维度的「已完成一次」直查

本期目标（用户原始需求 4 条）：

1. 介绍页底部新增 **4 个次级动作按钮**（收藏 · 追更 · 下载 · 系列目录），收藏按钮从原 CTA 行上移至此行；原 CTA 行保留「开始阅读」主按钮（占满整行）
2. 全部按钮在 R-18/R-18G/AI 屏蔽态下一致置灰（与现有 `startReading` / `openCaption` 同判定）
3. 追更交互采**直击切换**（沿用 `useBookmarkMutation` 的乐观触发 + 静息回滚范式）；不弹窗确认；状态与正文页 `createWatchlistPrompt` 共享 `watchlistStore`
4. 「下载」采**复用现有导出**语义——点击弹格式选择器（复用 `NovelExportSheet`），走 `enqueueNovelExport`；「已下载」按 `illustId+kind='novel'+status='completed'` 查 `downloadQueueCore`，新增 `utils/novelDownloadStatus.ts` helper
5. 系列目录采**底部弹层**（modalStack），新建 `SeriesSheet.vue`（lynx 版）；点击章节 → 关闭弹层 + 跳转该章节正文页

## 2. 决策记录（Grill 结论，2026-09-26 锁定）

| # | 决策点 | 结论 | 理由 |
|---|--------|------|------|
| D1 | 「下载」语义 | 复用现有导出（`enqueueNovelExport`）；「已下载」= 在 `downloadQueueCore` 按 `illustId+kind='novel'+status='completed'` 查询 | 零新模块、零新数据流；与正文页导出按钮对齐 |
| D2 | 按钮布局 | 两行布局：Row 1 = 4 个次级按钮（收藏·追更·下载·系列目录）；Row 2 = 全宽主 CTA「开始阅读」 | 视觉层次清晰，主 CTA 不被淹没；语义聚合（次级动作集中在 Row 1） |
| D3 | 系列目录展示 | 底部弹层（modalStack），新建 `SeriesSheet.vue`（lynx 版） | 与 webview 范式对齐；modalStack 自带返回键关弹层（#163）；URL 干净，不引入新路由 |
| D4 | 追更确认机制 | 直击切换（不弹窗），乐观触发 + 静息回滚 | 介绍页是「看封面就决策」界面，二次确认与心智不符；正文页弹窗保留，两层入口互不冲突 |
| D5 | 收藏按钮位置 | 与追更/下载/系列目录同一行（Row 1） | 收藏是次级动作（与追更/下载同级），样式保留 ♥ chip + 计数 |
| D6 | 屏蔽态下行为 | 全部 5 个按钮（收藏·追更·下载·系列目录·开始阅读）一致置灰 | 与现有 #580「CTA 一致置灰」范式对齐，最保守 |
| D7 | 系列弹层章节点击 | 直接跳到该章节正文页（关闭弹层 + `navigate(/novel/:id)`） | 减少一次点击；当前介绍页骨架（D 案页内不滚动）不承载章节列表 |
| D8 | 追更按钮可见性 | 仅当 `novel.series` 存在时渲染（Pixiv 单本无追更概念） | 系列存在 = 唯一可能追更的场景 |
| D9 | 系列目录按钮可见性 | 仅当 `novel.series` 存在时渲染 | 章节列表前提 = 必须是系列 |
| D10 | 下载按钮可见性 | 始终渲染（非系列也允许下载；R-18/R-18G 屏蔽态置灰） | 单本小说同样可导出为文件 |
| D11 | 「已下载」点击行为 | 「已下载」chip 仍可点击 → 重新打开格式选择器（与正文页「导出」入口同语义） | 二次下载不视为异常动作；保持入口可达 |
| D12 | 运行模式覆盖 | 双端：web-core 预览 + 原生 LynxView 真机；以原生为准 | 与现有 lynx 范式一致（ADR-0123 平台约束） |
| D13 | 范围 | 只做 app-lynx | webview 介绍页路径不同（无三段式 + 无 modalStack），单独规划 |

## 3. 接口契约

### 3.1 已存在端点（直接复用）

| 用途 | 端点 | 当前 lynx 端实现 |
|------|------|------------------|
| 收藏（加） | `POST /v2/novel/bookmark/add` | `addNovelBookmark` ✓ |
| 收藏（删） | `POST /v1/novel/bookmark/delete` | `deleteNovelBookmark` ✓ |
| 追更（加） | `POST /v1/watchlist/novel/add` | `addNovelWatchlist` ✓ |
| 追更（删） | `POST /v1/watchlist/novel/delete` | `deleteNovelWatchlist` ✓ |
| 系列详情（含追更状态） | `GET /v2/novel/series` | `loadNovelSeries` ✓（**但响应字段不全，见 §3.2**） |
| 小说导出载荷构造 | 共享包 `@pictelio/novel-export` `buildNovelExportPayload` | `NovelDetail.vue:62` ✓ |

### 3.2 缺口：`loadNovelSeries` 需扩展（US1）

当前 lynx `NovelSeriesDetailResponse` 仅含 4 字段（id/title/content_count/is_concluded/watchlist_added），缺 **章节列表** `novels[]` + **分页** `next_url`。Webview 端 `packages/app/src/api/novel.ts:120-132` 完整形态已存在。

**扩展方案**：将 lynx 端 `NovelSeriesDetailResponse` 改为对齐 webview（含 `novels: PixivNovel[]` + `next_url: string | null`），新增 `loadNovelSeriesChapters(seriesId, lastOrder?, signal?)` / `loadNovelSeriesChaptersNext(url, signal?)`。同端点同解析，仅 lynx 端之前简化时省略了。

字段调整（`packages/app-lynx/src/api/types.ts:108-118`）：
- 保留：id, title, content_count, is_concluded, watchlist_added
- 新增：`novels: PixivNovel[]`（章节列表，分页返回时增量追加）、`next_url: string | null`

**理由**：与 webview 同源（避免双端契约分叉）；同一端点一次拿全，无需额外请求。

### 3.3 新增下载状态查询（US4）

`packages/app-lynx/src/utils/downloadQueueCore.ts:25` 已定义 `DownloadTask` 含 `illustId: number` + `kind: DownloadKind` + `status: DownloadStatus`。**无需新 API、无需新端点**——「已下载」状态本地查询即可。

`packages/app-lynx/src/stores/downloadStore.ts` 已通过 `downloadState` 暴露完整 `QueueState`，新增派生函数：

```ts
// packages/app-lynx/src/utils/novelDownloadStatus.ts（新增，pure function）
export function isNovelDownloaded(
  state: QueueState,
  novelId: number,
): boolean {
  return state.tasks.some(
    (t) => t.kind === 'novel' && t.illustId === novelId && t.status === 'completed',
  )
}
```

## 4. 功能分解

### US1 · API 层扩展（类型 + 函数）

`packages/app-lynx/src/api/`：

- `types.ts` 扩展 `NovelSeriesDetailResponse`：保留旧字段 + 新增 `novels: PixivNovel[]` + `next_url: string | null`。**兼容**：旧消费方（`NovelDetail.vue` / `NovelIntro.vue` 现有 watchlist 预取）不读 `novels` / `next_url`，类型扩展为零影响
- `novel.ts` 新增：
  - `loadNovelSeriesChapters(seriesId, lastOrder?, signal?)` → `GET /v2/novel/series`（带 `last_order` 增量参数对齐 webview `loadSeries:139-141`）
  - `loadNovelSeriesChaptersNext(url, signal?)` → 分页

### US2 · 追更交互（composable）

新建 `packages/app-lynx/src/composables/useNovelWatchlistToggle.ts`，对齐 `useBookmarkMutation` 形态：

```ts
export interface UseNovelWatchlistToggleOptions {
  seriesId: number
  initialAdded: boolean
}

export interface UseNovelWatchlistToggleReturn {
  readonly added: Ref<boolean>
  readonly busy: Ref<boolean>
  readonly errorMsg: Ref<string>
  toggle(): Promise<void>
}
```

**关键不变量**（对照 `useBookmarkMutation` 6 条）：

1. **乐观翻转**：`toggle()` 同步翻转 `added` 后才发 API
2. **busy 锁**：API pending 期间重复 toggle no-op
3. **失败静息回滚**：状态复位 + `errorMsg` 提示
4. **跨入口状态共享**：toggle 成功后调 `watchlistStore.setWatchState(seriesId, true/false)`——`createWatchlistPrompt` 通过 `getWatchState()` 读同一份缓存，正文页 `prompt.watchAdded` 自动同步（无需事件总线）
5. **失败显式 warn**：`console.warn('[useNovelWatchlistToggle]')`（禁静默降级）
6. **重复入参检查**：`seriesId` 变化时宿主按 `:key="novel.series.id"` 重挂载 composable（`BookmarkButton` 已采用同范式）

`mutationFn`：调 `addNovelWatchlist(toSeriesId(seriesId))` / `deleteNovelWatchlist(toSeriesId(seriesId))`，复用 `mutationKeys`。

### US3 · 系列目录弹层（组件）

新建 `packages/app-lynx/src/components/SeriesSheet.vue`（lynx 版），对齐 webview `packages/app/src/components/SeriesSheet.tsx` 行为：

- **触发**：宿主（`NovelIntro.vue`）用 `modalStack` 模式打开（对齐 `NovelCaptionSheet` 形态：`absolute inset-0` 宿主 + `@close` 事件）
- **加载**：`onMounted` 调 `loadNovelSeriesChapters(seriesId)`；分页用 `loadNovelSeriesChaptersNext`
- **渲染**：分页列表（标题 + 作者 + 字数 + 当前章节高亮）
  - 当前章节高亮：传入 `currentNovelId` prop；匹配项 `bg-secondary-container`（同 `BookmarkButton.is-bookmarked` 实色 chip 范式）
- **交互**：点击章节 → `@tap="select(novelId)"` → 关闭弹层 + `emit('select', novelId)` → 宿主 `navigate('/novel/:id')`
- **状态机**：loading / loaded / loadingMore / error（与 `RefreshableList` 同源）
- **关闭路径**：返回键 → `modalStack` 通道自动关闭（#163）+ tap scrim 关闭

### US4 · 下载状态查询（pure function）

新增 `packages/app-lynx/src/utils/novelDownloadStatus.ts`：

```ts
import type { QueueState } from './downloadQueueCore'

/**
 * 判定某小说是否至少已被成功导出一次。
 * 单测驱动：mock queue state 覆盖空 / 进行中 / 已完成三种。
 */
export function isNovelDownloaded(state: QueueState, novelId: number): boolean {
  return state.tasks.some(
    (t) => t.kind === 'novel' && t.illustId === novelId && t.status === 'completed',
  )
}
```

宿主用法（`NovelIntro.vue`）：
```ts
import { downloadState } from '../stores/downloadStore'
import { isNovelDownloaded } from '../utils/novelDownloadStatus'

const downloaded = computed(() =>
  novel.value ? isNovelDownloaded(downloadState.value, novel.value.id) : false,
)
```

下载按钮 `downloaded.value === false` 时显示「下载」图标按钮；`true` 时显示「已下载」chip（M3 filled tonal + ✓ 图标）。两者**都可点**：未下载走 `enqueueNovelExport`，已下载点击同样打开格式选择器（让用户主动重新导出，spec D11）。

### US5 · 介绍页模板重组（`NovelIntro.vue`）

**模板变化**（行级 diff，模板骨架沿用现有 D 案全屏封面 + 底部渐变 scrim）：

- **删除**：原 259-279 行（CTA 行：`BookmarkButton + StartReading` 双元素）
- **新增 Row 1（次级按钮行）**：
  ```vue
  <view class="mt-4 flex flex-row items-stretch">
    <!-- 收藏：外层 wrap 设 flex-1 + masked 态 opacity-50/pointer-events-none -->
    <view class="flex-1 flex items-center justify-center" :class="masked ? 'opacity-50 pointer-events-none' : ''">
      <BookmarkButton :key="novel.id" target-kind="novel"
        :illust-id="novel.id" :initial-bookmarked="novel.is_bookmarked"
        :bookmark-count="novel.total_bookmarks" />
    </view>
    <!-- 追更：仅 novel.series 存在 -->
    <WatchlistAction v-if="novel.series" :key="novel.series.id"
      :series-id="novel.series.id" :initial-added="prompt?.watchAdded ?? false"
      :masked="masked" />
    <!-- 下载 -->
    <ActionButton :icon="downloaded ? '✓' : '↓'"
      :label="downloaded ? t('novelIntro.actionDownloaded') : t('novelIntro.actionDownload')"
      :active="downloaded" :disabled="masked" @tap="openExportSheet" />
    <!-- 系列目录：仅 novel.series 存在 -->
    <ActionButton v-if="novel.series" :icon="'≡'"
      :label="t('novelIntro.actionSeries')"
      :active="false" :disabled="masked" @tap="openSeriesSheet" />
  </view>
  ```
- **新增 Row 2（主 CTA 行）**：
  ```vue
  <view class="mt-3 w-full h-[12.8vw] rounded-[var(--md-shape-full)] flex items-center justify-center"
    :class="masked ? 'bg-white/20' : 'bg-primary active:opacity-80'"
    @tap="startReading">
    <text class="text-label-large font-medium" :class="masked ? 'text-white/50' : 'text-primary-on'">
      {{ t('novelIntro.startReading') }}
    </text>
  </view>
  ```

**脚本变化**（新增 + 修改）：

- 新增 `watchAdded` 响应式（读 `prompt.watchAdded`，已存在）
- 新增 `downloaded` computed（US4）
- 新增 `exportOpen` ref + `openExportSheet()` 函数（弹 `NovelExportSheet`）
- 新增 `seriesSheetOpen` ref + `openSeriesSheet()` 函数
- 新增 `onSeriesSelect(novelId)` 处理器（关闭 + navigate）
- 删除原 262-269 行 BookmarkButton 内嵌代码（已上移到 Row 1）

**平台约束遵守**（ADR-0123）：
- 全屏覆盖层一律 `v-if` 条件渲染 + `@tap` 句柄（modalStack 模式沿用现有）
- 弹层用 `modalStack`（已在 `router.ts` 注册通道）
- 子按钮 `@tap.stop` 防止冒泡到容器

## 5. UI 规范

### 5.1 次级按钮视觉（M3 icon-button + label chip 风格）

> 修订（2026-09-26）：Row 1 容器由 items-center justify-around gap-2 改为 items-stretch（实现侧决策）。items-stretch + flex-1 子项 = 4 列等宽 + 子项高度撑满容器，BookmarkButton wrap hug-content 与之兼容，视觉更紧凑。

与现有 `BookmarkButton` 同视觉族（不是同组件）：
- 容器：`min-w-0 flex-1`（等宽四列）+ `flex flex-col items-center justify-center` + `py-2`
- 容器背景：`bg-transparent`，hover/active 态：`bg-white/10`
- 图标：`text-[6.4vw] leading-none`
- 文字：`text-label-small text-white/85 mt-1`

**3 种状态**：

| 状态 | 图标 | 文字 | 容器色 |
|------|------|------|--------|
| 默认（未操作） | `♥︎` / `☆` / `↓` / `≡` | `收藏 N` / `追更` / `下载` / `目录` | transparent |
| 已激活 | `♥` (color tertiary) / `★` filled (color tertiary) / `✓` (color tertiary) / `≡` | `已收藏` / `已追更` / `已下载` / `目录` | transparent |
| masked | 同默认，色 `text-white/50` | 同默认 | pointer-events-none |

### 5.2 主 CTA 行（Row 2）

沿用现有规范：`h-[12.8vw] rounded-full` + `bg-primary` + `text-primary-on`。masked 态 `bg-white/20 text-white/50`，与 #580 对齐。

### 5.3 系列弹层 `SeriesSheet.vue`

- 容器：`absolute inset-0` 全屏 + 背景 scrim `bg-black/50`
- 面板：`absolute bottom-0 left-0 right-0 max-h-[80vh] rounded-t-3xl bg-surface-container` + 内 padding `px-6 pt-4 pb-6`
- 标题：`text-title-medium font-semibold mb-2` — 系列名
- 列表：`<list>` 容器 + `<list-item>` 单章节
- 单章节：`min-h-12 px-4 rounded-[var(--md-shape-medium)] flex items-center`
  - 默认：`bg-transparent`
  - 当前章节（`novel.id === currentNovelId`）：`bg-secondary-container`
  - active：`bg-state-pressed-on-surface`
- 章节标题：`text-body-medium` + 字数 `text-label-small text-on-surface-variant`
- 分页 footer：`list-loadmore` 三态（沿用 `RefreshableList` 同源形态）
- 关闭按钮：scrim 任意 tap + 系统返回键（modalStack 自动处理）

### 5.4 导出弹层 `NovelExportSheet.vue`

**沿用现有组件**（`NovelDetail.vue:32` 已 import），不修改。宿主仅需传 `novel/text/images` + 调 `enqueueNovelExport(format)`，与正文页同语义。

## 6. 状态机

### 6.1 追更按钮状态机

```
        tap                API ok              API fail
[未追更] ────────► [未追更 busy] ────────► [未追更 ✓]
                              │
                              └─ fail ─► [未追更 + errorMsg]

        tap                API ok              API fail
[已追更] ────────► [已追更 busy] ────────► [已追更 ✓]
                              │
                              └─ fail ─► [已追更 + errorMsg]
```

`watchAdded` 改变 → `watchlistStore.setWatchState` → 正文页 `createWatchlistPrompt.watchAdded` 同步（同一份 reactive cache，零事件总线）。

### 6.2 下载按钮状态机

```
                tap                API ok (enqueue)
[未下载] ────────────► [未下载 busy] ────────► [未下载 + exportNotice]
                                                     │
                                                     └─ exportNotice 4s 自动隐藏

（已下载 = 当前实现，重启点击同样打开格式选择器）
[已下载] ───── tap ────────► [已下载 + exportOpen = true]
```

「已下载」状态完全由本地 `downloadState` 派生，无独立状态机——按下重新导出与未下载按下行为一致。

### 6.3 系列弹层状态机

```
[关闭]
  │ tap "目录"
  ▼
[加载中] ──── ok ────► [已加载 chapters]
  │                       │
  └─ fail ─► [错误 + 重试] │ scrolltolower
                          ▼
                  [加载更多 chapters]
                          │
                          ├─ ok ─► [已加载 chapters]（追加）
                          └─ fail ─► [已加载 + 底部 inline retry]
```

## 7. 测试策略

### 7.1 单测（vitest，强制门禁）

| 模块 | 测试文件 | 覆盖点 |
|------|---------|--------|
| `utils/novelDownloadStatus.ts` | `utils/novelDownloadStatus.test.ts` | 空 queue / 有 in-progress / 有 completed / 多任务 novelId 匹配 |
| `composables/useNovelWatchlistToggle.ts` | `composables/useNovelWatchlistToggle.test.ts` | 6 条不变量：乐观翻转 / busy 锁 / 静息回滚 / 状态共享 / 显式 warn / `:key` 重挂载 |
| `components/SeriesSheet.vue` | `components/SeriesSheet.template.test.ts` | 当前章节高亮 / 点击关闭 + emit select / 分页 footer 三态 |
| `api/novel.ts` | `api/novel.test.ts`（新增 case） | `loadNovelSeriesChapters` 携带 `last_order` 参数对齐 webview |

### 7.2 模板快照测试

`SeriesSheet.template.test.ts`：取 lynx `<list-item>` 模板，对齐 `BookmarkButton.host-matrix.test.ts` 范式。

### 7.3 真机验证（手动 + 门禁）

按 ADR-0123 / ADR-0146 D2 范式：web-core 预览 + 原生 LynxView 真机双重验证。

- **必测**：四按钮同行布局在窄屏/横屏不溢出；弹层 modalStack 返回键关弹层（#163）；masked 态置灰在 R-18 / R-18G / AI 三种场景全命中
- **可选**（dev 阶段手动）：与正文页 `prompt.watchAdded` 双向同步（介绍页 toggle → 正文页 chip 刷新；反之亦然）

> **真机 spike 记录（2026-09-26 显式挂账）**：本期因 agent 无设备访问能力，未留 `/platform-check` 自检页 + logcat/截图取证。Lynx 平台事实风险（`SeriesSheet.vue` `<list>` 结构变更 + modalStack 返回键关闭）单测绿但真机才暴露（ADR-0162 / ADR-0163 已知反例）。**必须**在发版前由人工补做——issue #737「spec #734 真机 spike 记录（Lynx `<list>` + modalStack）」已建，挂账交付现状。补完时同步删本段挂账文本。

### 7.4 E2E（agent-browser / 非本期门禁）

不进入 `tests/agent-browser/specs/`，功能太局部（按 ADR-0084 局部行为不进 CI 门禁）。手动按需。

## 8. ADR 提议

**新增一个 ADR**：`ADR-0xxx-lynx-novel-intro-action-row.md`

记录内容：
1. **硬决策**：四按钮同行 + 主 CTA 单独全宽（视觉层次选择）
2. **硬决策**：追更直击切换（不与正文页弹窗统一，UX 一致性 vs 简介页快速决策场景的权衡）
3. **硬决策**：「已下载」派生本地状态而非新建持久层（避免新建离线缓存模块，scope 收敛）
4. **跨端契约同步**：扩 `loadNovelSeries` 返回 `novels[]` + `next_url`（避免双端契约分叉）

**不写 ADR 的**：
- 屏蔽态置灰（沿用 #580，无新决策）
- 复用 NovelExportSheet（沿用既有组件，无新决策）

## 9. Glossary 增项（`packages/app-lynx/CONTEXT.md`）

新增 3 个词条到「小说导航」章节：

**小说介绍页操作行（novel intro action row）**：
介绍页底部 D 案 scrim 区内的两行动作布局——第一行四个次级按钮（收藏 · 追更 · 下载 · 系列目录），第二行主 CTA「开始阅读」全宽。次级按钮视觉等宽、图标+短文字 chip 形态；屏蔽态一致置灰。**布局变更**：2026-09-26 之前收藏与「开始阅读」同行，之后收藏上移至次级行。_Avoid_: 收藏保留在主 CTA 行（视觉权重混淆）、所有按钮堆一行（密度过载）。

**已下载（downloaded status）**：
小说被**至少成功导出一次**的派生状态。来源：`downloadQueueCore` 中 `kind='novel' && illustId === targetId && status='completed'` 至少一条。纯本地状态、无独立持久层；进入 App / 重启 / 清空下载队列后归零。_Avoid_: 误以为"已下载 = 可在 App 内离线阅读"（本期仅导出到文件系统；离线阅读功能未立项）。

**追更直击切换（watchlist direct toggle）**：
介绍页追更按钮的交互形态——点击 = 立即追更/取消追更，无二次确认弹窗。乐观触发 + 失败静息回滚（沿用 `useBookmarkMutation` 范式）。与正文页 `createWatchlistPrompt`（返回键弹窗）共存——前者服务快速决策（介绍页），后者服务深度交互（读完走人）。两者通过 `watchlistStore.setWatchState` 共享状态缓存，零事件总线。_Avoid_: 介绍页引入弹窗（拖慢决策流程）、双入口状态分裂（独立信号源导致漂移）。

## 10. 文件清单（实施期交付物）

**新增**：
- `packages/app-lynx/src/composables/useNovelWatchlistToggle.ts`
- `packages/app-lynx/src/composables/useNovelWatchlistToggle.test.ts`
- `packages/app-lynx/src/components/SeriesSheet.vue`
- `packages/app-lynx/src/components/SeriesSheet.template.test.ts`
- `packages/app-lynx/src/components/ActionButton.vue`（次级按钮通用基础组件，复用 4 处）
- `packages/app-lynx/src/components/ActionButton.template.test.ts`
- `packages/app-lynx/src/utils/novelDownloadStatus.ts`
- `packages/app-lynx/src/utils/novelDownloadStatus.test.ts`
- `docs/adr/ADR-0xxx-lynx-novel-intro-action-row.md`
- `docs/specs/app-lynx-novel-intro-action-row.md`（本文件）

**修改**：
- `packages/app-lynx/src/api/types.ts` — 扩 `NovelSeriesDetailResponse`
- `packages/app-lynx/src/api/novel.ts` — 新增 `loadNovelSeriesChapters` / `loadNovelSeriesChaptersNext` + 对应测试
- `packages/app-lynx/src/api/api.test.ts`（如存在）— 新增 API 测试
- `packages/app-lynx/src/pages/NovelIntro.vue` — 模板重组 + 脚本新增（§4 US5）
- `packages/app-lynx/src/i18n/locales/zh-CN/misc.ts` — 新增 3-4 个 key
- `packages/app-lynx/src/i18n/locales/en/misc.ts` — 同步英文
- `packages/app-lynx/CONTEXT.md` — 新增 3 个 glossary 词条
- `tests/novelIntroEntryGuards.test.ts` — 现有守卫加新 case（介绍页含 4 个动作按钮时仍守「不路由级重定向」）

## 11. 不做 / 留给未来

- **离线阅读**（在 App 内阅读已下载小说）：需要 novel body 缓存 + IndexedDB + 阅读适配层，独立 spec
- **下载管理入口直达**：从介绍页「已下载」点击直接跳 `/downloads` 页面。当前行为 = 重新打开格式选择器
- **追更通知开关**（`/v1/watchlist/notification`）：已 ADR-0xxx-novel-series-watchlist D6 排除
- **批量操作**（多选收藏 / 批量下载）：介绍页是单作品页，批量语义不匹配
- **i18n key 国际化之外的多语言 SEO**：本期仅 zh-CN + en，沿用 ADR-0157 双语

## 12. 风险与回退

| 风险 | 触发条件 | 回退方案 |
|------|----------|----------|
| modalStack 弹层在原生 LynxView 返回键关闭失效 | 真机复现 #163 旧症状 | 回退到 `v-if` 全屏遮罩 + 显式 close 按钮 |
| `setWatchState` 双入口同步漂移 | 介绍页 toggle 后正文页 chip 仍显示旧值 | 暴露 `watchlistStore` 改 Pinia store（reactive 而非 module-level Map） |
| `isNovelDownloaded` 在大量历史任务下性能 | 任务数 > 100 | 改用 `Map<illustId, true>` 缓存层（一次构造，多次查询） |
| 4 按钮同行在极窄屏溢出 | 视口宽 < 320px | 改 2×2 网格布局 |
| `loadNovelSeriesChapters` 端点行为差异 | 实测发现 Pixiv App API 与 Web API 对 `series` 端点的 `novels` 字段行为不同 | 回落单端点策略 + 加类型守卫 `if (response.novels)` 容错 |