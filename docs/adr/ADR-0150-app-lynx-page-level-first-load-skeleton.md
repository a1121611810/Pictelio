# ADR-0150: app-lynx 页级首载骨架（空态文案仅在首载成功落定后出现）

- 状态：accepted
- 日期：2026-09-10
- 关联：ADR-0118（推荐轮播沉浸骨架——本决策把它推广为通例）、ADR-0104（feed 分页收敛 / 错误槽分流）、ADR-0082（首屏失败必须渲染错误而非空态）、ADR-0038（先渲染后加载）、`packages/app-lynx/CONTEXT.md`（新增词条：页级首载骨架 / 首载落定）、vue-lynx IFR 文档（https://vue.lynxjs.org/zh/guide/ifr）
- 来源：`/grill-with-docs` 收敛的需求（用户确认，Q1–Q18 全部确认）

## 背景

用户反馈：lynx 各页面「优先显示无数据文案，等数据加载后才出现骨架和数据」。

盘点后根因：app-lynx 的骨架条件普遍写成 `loading && 渲染流为空`，而页面本地 `loading` ref 只在 `sync()` 里写入，`sync()` 又在 `await feed.refresh()` **之后**才调用。于是首屏请求整个在途期间 `loading` 恒为初始 `false`、渲染流为空 → 命中空态文案分支，骨架从未出现；数据回来后卡片内的图级骨架（`SkeletonImage` / `CoverImage` 的 shimmer）才让人误以为「加载后才显示骨架」。仅推荐轮播页（ADR-0118）用「渲染流为空即骨架、不依赖 loading」正确。

受影响面（盘点结论）：

- 骨架 = `loading && 空`（首载永不显示骨架）：`IllustList` / `Following` / `NovelList` / `Watchlist`
- 完全没有页级骨架：`Bookmarks` / `UserHome` / `FollowList`
- 首帧闪空态：`CommentOverlay`（初始 `status='idle'` 落入 ready 分支）
- 首搜索无骨架：`SearchSheet`（只有「搜索中…」文字）
- 详情页（`NovelDetail` / `IllustDetail` / `UgoiraViewer`）初始 `loading=true`，行为已正确

IFR（首屏直出）事实：vue-lynx 的 IFR 在 `loadTemplate` 期间、后台线程启动之前，用模板 + 组件**初始状态**绘制首屏。因此首帧画什么完全由 setup 时的初始 ref 决定——要让首帧是骨架，骨架必须落在初始状态分支，不能依赖 `onMounted` 里才置真的 `loading`。

## 决策

1. **统一三态语义**（取代「骨架依赖 loading」）：
   - 骨架 = 渲染流为空 ∧ 该源尚未成功落定 ∧ 无错误
   - 空态文案 = 渲染流为空 ∧ 已成功落定 ∧ 无错误
   - 错误文案 = 有错误（失败且无数据）
   - 已有数据时刷新 → 保留数据、不闪骨架
2. **落定信号收敛到共享层**：`createMixFeed` / `watchlistFeed` 新增「首载已成功落定」状态（首载成功才置真，失败不算，`autoStart:false` 实例从假开始）；页面沿用 `sync()` ref 快照桥接（它同时是「有数据刷新不闪骨架」的实现基础）并新增该快照 ref。`useComments`（`idle` 视同 `loading`）与 `useSearch`（首次搜索）做同语义区分；手写 fetch 页（`FollowList`）本地实现同语义。
3. **补齐缺失的页级骨架**：`Bookmarks` / `UserHome` / `FollowList` 新增与各自布局匹配的骨架（复用 `SkeletonCard` / 用户行骨架）。
4. **条件收成互斥单链**：改造页面统一为「骨架 → 错误 → 空态 → 列表」单一 `v-if/v-else-if` 链，修掉现存的独立 `v-if` 矛盾态（如错误文案与列表同屏）。
5. **保持不变**：分页 footer（「加载中…」/「没有更多了」/ 分页错误）语义、详情页现有骨架、`DownloadManager` 等**无网络请求**的本地数据页（不新增骨架，避免假等待）、图片三态的图级骨架。
6. **显式刷新/重试回到骨架**：刷新或失败重试时同步清错误、进入骨架；真·空态下再刷新同样显示骨架（视为一次重新确认）。
7. **不做人为延迟/最短展示时长**：骨架立即显示。

## 被考虑的方案

- **继续依赖 `loading` 标志**：冷启动/IFR 首帧 `loading` 为假 → 空态文案仍会闪现，ADR-0118 已否决同类；否决。
- **各页面模板各加一个「已挂载/已发起」本地标志**：N 处复制、约束无法集中，后续仍会漂移；否决。
- **把 `CarouselSkeleton` 通用套到所有页**：与列表页布局不匹配，reflow 更严重；否决。
- **本地数据页（下载管理/设置/更新）也加骨架**：同步数据无加载期，制造假等待；否决。
- **真·空态刷新期间保持「暂无」文案**：与「默认骨架」目标不一致；否决。
- **做骨架最短展示时长**：让所有正常加载都变慢，收益不足以抵消；否决。

## 后果

**正面**：所有网络加载页/组件首帧即骨架，消除「先空态文案后内容」的闪现；判定语义单一、集中（共享层落定信号 + 统一互斥链），不再依赖各页 `sync()` 时序；IFR 首帧得到正确内容。

**负面 / 代价**：改动面广（4 个 createMixFeed 列表页 + Watchlist + 3 个补骨架页 + SearchSheet + CommentOverlay + 2 个 primitive 及其单测），需按 TDD 覆盖落定信号的成功/失败/空三态，并按「首帧骨架 / 刷新不闪 / 失败显错误」做真机 + web-core 验证；`CONTEXT.md` 词条与命名需一并更新，避免「沉浸骨架」被误当通用名。
