# ADR-0189: app-lynx 小说介绍页底部动作行（收藏·追更·下载·系列目录）

- 状态：Accepted
- 日期：2026-09-26
- 关联：spec `docs/specs/app-lynx-novel-intro-action-row.md`（§2 决策表）、ADR-0167（小说介绍页三段式 / 视觉骨架 / `BookmarkButton` / `createWatchlistPrompt` 入口归属）、ADR-0165（小说文本选择工具栏 — 工具栏避让约束）、ADR-0146（下载队列与 `enqueueNovelExport` — 「已下载」语义来源）、ADR-0123（原生 LynxView hit-testing 平台约束）、ADR-0163（`BookmarkButton` `:key` 重挂载契约）、ADR-0083（dead-code cleanup — 验证清理锚点）

## 背景

ADR-0167 把 `NovelIntro.vue` 视觉骨架定型为 D 案（封面 + 底部 scrim），落地时底部 CTA 行仅承载 `BookmarkButton` + 「开始阅读」，覆盖不全：

1. **收藏**：✓（ADR-0167 落位）
2. **系列目录**：系列名仅展示文字，不可点击；lynx 端无 `SeriesSheet`（webview 端存在）
3. **追更**：「已追更」chip 被动展示、**不可点击**；正文页 `createWatchlistPrompt` 在返回键触发，介绍页入口缺失
4. **下载**：完全未展示；lynx 端只有正文页 `NovelExportSheet`（`enqueueNovelExport`），下载队列按 `taskId` 查，无 `novelId` 维度的「已完成一次」直查

四缺口让介绍页承担不起「看封面就决策」的角色——用户必须跳到正文页才能完成追更/导出，或返回首页进系列页。本期把四缺口一次性补齐，并把「开始阅读」作为唯一的主 CTA 单列全宽。

## 决策

### D1 · 操作行两行布局（Row 1 = 四个次级动作，Row 2 = 主 CTA 全宽）

把「收藏 · 追更 · 下载 · 系列目录」四个次级动作放进同一行（Row 1，等宽四列，`flex-1`），「开始阅读」独占第二行（Row 2，`w-full h-[12.8vw] rounded-full bg-primary`）。Row 1 视觉形态 = M3 icon-button + label chip（与 `BookmarkButton` 同视觉族而非同组件）：图标 `text-[6.4vw]` + 短文字 `text-label-small`；激活态 = icon 切实色 + 文字改「已 X」。Row 2 沿用现有主 CTA 规范，仅调整几何位置。

**理由**：用户决策层级 = 「是否读」（主 CTA 独占一行凸显）+ 「如何处置这本书」（次级动作聚合一行）。收藏与追更/下载同级——它在 ADR-0167 落地时暂列主 CTA 行是因为三段式落地的首要目标是「保证有收藏入口」，现在主 CTA 与收藏的关系是「主 CTA 才是阅读入口，收藏只是确认动作」。

**备选**：
- **五按钮同行**：极窄屏（< 320px）必溢出 + 单按钮触控目标 < 40px，违反 M3 触控规范。
- **次级按钮散落各处**（如收藏嵌 scrim 顶部、系列目录嵌封面右下）：跨作品类型不一致，且增加认知成本。
- **栈式垂直布局**（4 行次级 + 1 行主）：罗列感过重，与 D 案视觉骨架的「沉浸封面 + 决策面板」调性冲突。

否决：极窄屏虽未在本期 P1 真机矩阵，但 `< 320px` 规格降级到 `2×2` 网格已在 spec §12 风险表挂账。

### D2 · 追更直击切换（介绍页点击即触发，不与正文页弹窗统一）

介绍页追更按钮采**直击切换**：点击 = 立即追更 / 取消追更，无二次确认弹窗，沿用 `useBookmarkMutation` 的乐观翻转 + 静息回滚范式。`createWatchlistPrompt`（正文页返回键弹窗）**保留不动**——两者并存。

**理由**：介绍页是「看封面就决策」界面（ADR-0167 §决策 2 D 案视觉方向），用户在 1-2 秒内决定是否追更，二次确认弹窗与心智不符，反而拖慢决策流。正文页弹窗的服务场景是「读完章节想顺手订阅/退订」，返回键触发恰好对齐时机——两套交互的服务场景不同，不应被「统一交互形态」覆盖。

**否决「介绍页也用弹窗」**：与 D 案视觉调性冲突，与「看封面就决策」的流程假设矛盾。**否决「介绍页去掉追更入口，仅保留 chip 展示」**：与 #576-#584 决策轨中「补齐入口」的明确意图冲突，且正文页 chip 已是 ADR-0167 落地的被动展示形态，不能直接作为交互入口复用。

### D3 · 「已下载」派生本地状态而非新建持久层

`isNovelDownloaded(state, novelId)` 是 **pure function**：扫描 `downloadQueueCore.tasks`（已存在），匹配 `kind === 'novel' && illustId === targetId && status === 'completed'`。落 `packages/app-lynx/src/utils/novelDownloadStatus.ts` 一处，宿主 `NovelIntro.vue` 用 `computed(() => isNovelDownloaded(downloadState.value, novel.value.id))` 派生。

**理由**：「已下载」语义在当前 lynx 能力下 = 「曾被成功导出为本地文件」——这是导出队列的事实查询，没有独立的持久化需求。**离线阅读**（在 App 内读已下载小说）是另一件事，需要 novel body 缓存 + IndexedDB + 阅读适配层，独立 spec（已挂账 spec §11）。

**否决「新建离线缓存模块」**：scope 爆炸。下载队列 `DownloadTask` 已有 `illustId` + `kind` + `status` 三字段，事实查询一行代码；新增持久层意味着要解决「缓存失效 / 多端同步 / 阅读器接入」三重问题，不是本期任务。**否决「扩展 DownloadTask 增 downloadedAt 字段」**：派生已经足够，新增字段会污染下载队列 schema（与「导出任务」语义脱钩）。

### D4 · 跨端契约同步：扩 `loadNovelSeries` 返回 `novels[]` + `next_url`

`packages/app-lynx/src/api/types.ts:108-118` 的 `NovelSeriesDetailResponse` 简化为 4 字段（`id`/`title`/`content_count`/`is_concluded`/`watchlist_added`），缺章节列表 `novels: PixivNovel[]` + 分页 `next_url: string | null`。本期对齐 webview 端 `packages/app/src/api/novel.ts:120-132` 完整形态，新增 `loadNovelSeriesChapters(seriesId, lastOrder?, signal?)` / `loadNovelSeriesChaptersNext(url, signal?)`，与 webview `loadSeries:139-141` 同形态。

**理由**：Pixiv `/v2/novel/series` 端点本就返回 `novels[]` + `next_url`，lynx 端之前简化时省略了——补齐是契约对齐，不是新端点。同端点同解析同字段，避免双端契约分叉；现有消费方（`NovelDetail.vue` 预取 / `NovelIntro.vue` 的 `watchlist_added`）不读 `novels` / `next_url`，类型扩展为零影响。

**否决「保留 lynx 简化版 + 另起一个章节端点」**：同一事实分两个端点表达，未来扩展要双端同步，违背 ADR-0146 的「一次拿全」原则。**否决「直接复用 webview 类型 / 共享类型包」**：双端类型各自维护是本仓一贯形态（`PixivIllustTag` 等），跨包共享会引入构建依赖，本期收益不抵成本。

### D5 · 跨入口状态共享：`watchlistStore.setWatchState`，无事件总线

`useNovelWatchlistToggle` toggle 成功后调 `watchlistStore.setWatchState(seriesId, true|false)`；正文页 `createWatchlistPrompt.watchAdded` 改读 `watchlistStore.getWatchState(seriesId)`。两者共享同一份 reactive cache，零事件总线、零订阅。

**理由**：介绍页直击切换与正文页返回键弹窗是同一事实（用户是否追更该系列）的两个交互入口。共享 reactive cache 让两入口自动同步——介绍页 toggle → 正文页 chip 立即刷新；反之亦然。这是 SolidJS / Vue reactivity 的天然能力，不引入事件总线是因为事件总线会让「谁是信号源」变得模糊（双源信号 = 漂移风险，spec §12 已挂账）。

**否决「事件总线 + 广播」**：违反「禁止静默降级 / 多源信号导致状态不一致」的硬约束。**否决「正文页 chip 不刷新，仅在下次进入时拉取」**：违反「先渲染后加载」与「状态共享无漂移」的体验承诺，用户切换页面看到陈旧 chip 会怀疑交互是否生效。**否决「抽 Pinia / SolidJS store 跨包共享」**：scope 过大，且会让 watchlist store 从模块级 Map 升格为跨包依赖，不符合 lynx 端 composables 轻量化范式（spec §12 风险表挂账：若出现漂移才升 Pinia store）。

## 不决策（沿用既有约定）

以下「决策」来自 spec §2 决策表 D1/D3/D5/D6/D7/D8/D9/D10/D11/D12/D13，但**不**写 ADR——它们是既定范式的沿用，不构成「难以逆转 + 缺上下文难理解 + 真实权衡」的三条件：

| 项 | 沿用约定 | 出处 |
| --- | --- | --- |
| 屏蔽态置灰（`masked` 命中时 5 个按钮一致置灰） | 「CTA 一致置灰」范式 | spec #580 / ADR-0167 §决策 4 |
| 复用 `NovelExportSheet`（介绍页「下载 / 已下载」点击 = 弹同一组件） | 「同源组件复用」范式 | 正文页 `NovelDetail.vue:32` 已 import |
| 弹层用 `modalStack` + 返回键自动关闭 | 「init-only props 宿主矩阵」 | ADR-0163 / spec §5.3 |
| 系列目录仅 `novel.series` 存在时渲染 | 「条件渲染 + 可选字段显式降级」 | ADR-0167 §决策 3 |
| 「已下载」点击 = 重新打开格式选择器 | 「二次下载不视为异常动作」 | spec D11 |
| 双端覆盖 = web-core 预览 + 原生 LynxView 真机 | 「原生为准」 | ADR-0123 |
| 范围只做 app-lynx | 「双端不对称是现状」 | ADR-0167 §后果 |
| 章节点击 = 关闭弹层 + `navigate(/novel/:id)` | 「弹层内导航跳转」范式 | spec D7 / ADR-0162 |
| 收藏按钮位置 = Row 1（与追更/下载/系列目录同级） | D1 决策的子结论 | spec D5 |
| i18n 仅 zh-CN + en 双语 | 「双语」 | ADR-0157 |

## 后果

**正面**：

- 介绍页四缺口一次性闭合，用户在封面 + scrim 阶段即可完成所有次级动作决策，进入正文时已无遗漏交互。
- 追更直击切换 + 跨入口 cache 共享，让介绍页的快速决策与正文页的深度决策在同一份 reactive cache 上互不干扰，零事件总线漂移风险。
- 跨端契约对齐（`loadNovelSeries` 补齐 `novels[]` + `next_url`）消除 lynx/webview 双端契约分叉，单端点单解析。
- 「已下载」派生自现有下载队列事实，零新模块，scope 收敛。
- 5 个按钮在受限态（R-18 / R-18G / AI）一致置灰，复用现有 `masked` 守卫（#580），与正文页同源。
- 防线补齐：新增 `utils/novelDownloadStatus.test.ts`（IO 边界）、`useNovelWatchlistToggle.test.ts`（6 条不变量）、`SeriesSheet.template.test.ts`（模板快照）、`api/novel.test.ts`（端点契约），覆盖成功/失败双路径。

**成本 / 风险**：

- 4 按钮同行密度高——极窄屏（视口宽 < 320px）需降级为 `2×2` 网格布局，spec §12 风险表已挂账（本期 P1 真机矩阵不含 < 320px）。
- `isNovelDownloaded` 在大量历史任务（> 100 条）下性能线性——spec §12 已挂账「改用 `Map<illustId, true>` 缓存层」为回退方案。
- `watchlistStore` 模块级 Map 升格路径——若双入口出现 drift，按 spec §12 回退到 Pinia store（reactive 而非 module-level Map）。
- `modalStack` 弹层在原生 LynxView 真机返回键关闭失效——spec §12 已挂账回退 `v-if` 全屏遮罩 + 显式 close 按钮（#163 旧症状）。

**未来候选（不在本期）**：

- **离线阅读**：在 App 内阅读已下载小说。需 novel body 缓存 + IndexedDB + 阅读适配层，独立 spec。
- **下载管理入口直达**：从介绍页「已下载」点击直接跳 `/downloads` 页面。spec §11 已挂账。
- **`/v1/watchlist/notification` 追更通知开关**：spec §11 已挂账。
- **批量操作**：介绍页是单作品页，批量语义不匹配。
- **4 按钮触控目标进一步优化**：M3 icon-button + label chip 当前形态在窄屏已是 40×40 下限，进一步优化需考虑 `ActionButton` 抽象层（spec §10 文件清单已列 `ActionButton.vue` 作为基础组件候选）。

## 参考

- spec `docs/specs/app-lynx-novel-intro-action-row.md` §2 决策表（D1-D13）、§3 接口契约、§4 功能分解、§6 状态机、§7 测试策略、§10 文件清单、§11 不做 / 留给未来、§12 风险与回退
- ADR-0167：小说介绍页三段式 — 视觉骨架、`BookmarkButton` 落位、`createWatchlistPrompt` 入口归属
- ADR-0165：小说文本选择工具栏 — 工具栏避让约束
- ADR-0146：下载队列与 `enqueueNovelExport` — 「已下载」语义来源（`downloadQueueCore.tasks[].illustId + kind + status`）
- ADR-0123：原生 LynxView hit-testing 平台约束 — `v-if` 全屏遮罩 + `@tap` 句柄 + `@tap.stop` 防冒泡
- ADR-0163：QA 防线 + `BookmarkButton` `:key` 重挂载契约 — `useNovelWatchlistToggle` 同样按 `:key="novel.series.id"` 重挂载
- ADR-0083：dead-code cleanup — 验证清理锚点