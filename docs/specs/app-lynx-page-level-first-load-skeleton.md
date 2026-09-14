# Spec: app-lynx 页级首载骨架（默认骨架，空态/错误仅在首载落定后出现）

- 状态：ready-for-agent
- 日期：2026-09-10
- 关联：ADR-0150（本 spec 的决策记录）、ADR-0118（推荐轮播沉浸骨架——本 spec 把它推广为通例）、ADR-0104（feed 分页收敛 / 错误槽分流）、ADR-0082（首屏失败必须渲染错误而非空态）、`packages/app-lynx/CONTEXT.md`（新增词条：页级首载骨架 / 首载落定）
- 来源：`/grill-with-docs`（Q1–Q18 全部确认）
- 发布：https://github.com/a1121611810/Pictelio/issues/431（`ready-for-agent`）
- 前置：本轮只改 `packages/app-lynx`；不改数据层分页语义（`createMixFeed` 的分页/合并/防抖/错误槽不变），不改 webview（`packages/app`）。

## Problem Statement

lynx 客户端各页面在进入时**先显示「暂无…」空态文案**，等接口返回后才出现内容（卡片内的图片骨架还常被误认为「加载后才显示骨架」）。用户看到「无数据」的时机早于「数据正在加载」的事实，观感是页面先判定为空、再自行改口。冷启动尤其明显：开着 IFR 时首帧本应直接是骨架，实际却是空态文案。

根因：页面骨架条件写成 `loading && 渲染流为空`，而页面本地 `loading` 只在 `sync()` 里写入、`sync()` 又在 `await refresh()` **之后**才调用——首屏请求在整个在途期间本地 `loading` 恒为初始 `false`、渲染流为空，于是永远命中空态分支。收藏 / 用户主页 / 关注粉丝列表三个页面甚至**完全没有页级骨架**；评论浮层初始 `idle` 会闪一下「还没有评论」；搜索首搜只有「搜索中…」文字。

## Solution

统一三态判定，让**骨架成为首载默认态**：

- 渲染流为空且该数据源**尚未成功落定** → 页级骨架；
- 渲染流为空且**已成功落定为空**（含接口成功返回 0 条）→ 「暂无…」空态文案；
- 请求失败且无数据 → 错误文案；
- 已有数据时刷新 → 保留数据、不闪骨架；显式刷新 / 失败重试 → 回到骨架。

判定不再依赖 `loading` 标志的置位时机（IFR 首帧在后台线程启动前用初始状态绘制，骨架必须落在初始分支）。缺失骨架的页面补齐与各自布局匹配的骨架；页面的三态条件统一收成互斥单链。

## User Stories

1. As a 插画浏览用户, I want 进入插画页时立即看到骨架屏, so that 我知道内容正在加载，而不是没有内容。
2. As a 小说浏览用户, I want 小说列表页首帧显示骨架, so that 不会先看到「暂无推荐小说」再被内容替换。
3. As a 关注 Feed 用户, I want 首载显示骨架, so that 加载过程可见、没有空态闪现。
4. As a 收藏用户, I want 收藏页首载显示骨架（此前完全没有页级骨架）, so that 插画/小说收藏加载时不再先显示「暂无收藏」。
5. As a 用户主页访客, I want 作品 tab 首载显示骨架, so that 不会在作者有作品时先看到「暂无作品」。
6. As a 追更用户, I want 追更列表首载显示骨架, so that 不会先看到「暂无追更系列」。
7. As a 关注/粉丝列表用户, I want 首载显示用户行骨架, so that 列表加载过程可见。
8. As a 评论浏览用户, I want 打开评论浮层先看到骨架而不是「还没有评论」, so that 不会误判该作品没有评论。
9. As a 搜索用户, I want 首次搜索时看到结果骨架, so that 知道搜索在进行。
10. As a 搜索用户, I want 换关键词时保留上一次结果并显示「搜索中…」, so that 结果区不闪空。
11. As a 用户, I want 请求失败时看到错误文案而不是无限骨架或空态, so that 我知道发生了什么。
12. As a 用户, I want 真的没有数据时才看到「暂无…」文案, so that 文案与事实一致。
13. As a 用户, I want 已有数据时刷新不闪骨架, so that 刷新过程内容不跳动。
14. As a 用户, I want 失败后重试时重新看到骨架, so that 重试有加载反馈。
15. As a 用户, I want 真·空态页面再次刷新时看到骨架, so that 一次重新确认过程不误显示「暂无」。
16. As a 冷启动用户（IFR 开启）, I want 首帧就是骨架, so that 后台线程启动前没有白屏或空态文案。
17. As a 用户, I want 错误文案与列表不再同时出现, so that 页面状态不自相矛盾。
18. As a 用户, I want 插画/小说 tab 切换时新 tab 显示骨架, so that 切换有明确加载反馈。
19. As a 用户, I want 下载管理等本地数据页不出现无意义骨架, so that 同步数据不制造假等待。
20. As a 开发者, I want 三态判定收敛为一个纯函数, so that 各页行为一致、可集中回归。
21. As a 开发者, I want 落定信号由共享 primitive 提供, so that 各页不再依赖 `sync()` 时序。
22. As a 开发者, I want 分页 footer、详情页骨架、图片三态语义保持不变, so that 本次改动 blast radius 受控。
23. As a 开发者, I want 降级路径显式可见（console.warn / 错误状态）, so that 契约破坏不被静默吞掉。

## Implementation Decisions

- **不改 webview（`packages/app`）**；不改 `createMixFeed` 的分页 / 合并 / 防抖 / 竞态 / 错误槽语义。
- **三态语义（唯一事实源）**：输入 `{ hasItems, loading, settled, hasError }`，输出 `'content' | 'error' | 'skeleton' | 'empty'`，优先级：`hasItems → content`；否则 `loading → skeleton`；否则 `hasError → error`；否则 `!settled → skeleton`；否则 `empty`。`settled` = 该数据源首页**成功返回过**（含 0 条），失败不算。
- **单一纯函数 seam**：新建纯逻辑模块承载上述判定（node 可测），所有列表页 / 详情页首载分支 / 评论浮层 / 搜索弹层统一消费它，不再各自拼 `loading && items.length===0`。这是本 spec 的**主 seam**。
- **共享 primitive 提供落定信号**：
  - `createMixFeed` 返回接口新增「首载已成功落定」只读访问器（`autoStart:false` 实例从假开始；首载成功置真；失败不置真；`dispose` / 重建实例归假）。
  - `watchlistFeed` 同语义新增同一访问器。
  - 页面保留现有 `sync()` ref 快照桥接（它同时是「有数据刷新不闪骨架」的实现基础），并新增该快照 ref。
- **页面的刷新时序**：显式刷新 / 失败重试时，页面在发起请求**前同步**置本地 `loading=true`、清空本地错误文案，使骨架立即占位（不再等到 `await` 之后）。
- **评论浮层**：`useComments` 的 `idle` 视同 `loading`（打开浮层即骨架）；`status==='error'` 仍走错误分支；`ready` 才判定空态。
- **搜索弹层**：首次搜索（无可保留结果）显示骨架；换关键词且已有旧结果时保留旧结果 +「搜索中…」指示（沿用既有「保留旧结果」语义）；`ready` 且结果为空才显示「没有找到相关内容」。
- **补齐页级骨架**：收藏（插画/小说两个 tab）、用户主页（作品 tab）、关注/粉丝列表新增与各自布局匹配的骨架（复用既有 shimmer 微光样式面与 `SkeletonCard`；用户列表用「头像圆 + 两行条」行骨架）。样式遵循 app-lynx 的 Tailwind + M3 令牌约定，不新增手写 scoped CSS、不硬编码尺寸/颜色。
- **条件收成互斥单链**：改造页面统一为「骨架 → 错误 → 空态 → 列表」单一 `v-if/v-else-if` 链，消除现存独立 `v-if` 导致的「错误文案 + 列表同屏」等矛盾态。分页 footer（`loadingMore` / `pageError` / `endOfFeed`）仍挂在列表内部、语义不变。
- **保持不变**：分页 footer 三态、详情页（小说 / 插画 / 动图）现有骨架语义、图片三态（`CoverImage`）、`DownloadManager` / `Me` / `UpdatePage` 等**无网络首载**的本地数据页（不新增骨架）。
- **不做人为延迟 / 最短展示时长**：骨架立即显示。
- **门控/降级显式可见**：任何 `??` / catch 兜底沿用 `console.warn`（带模块前缀）或显式错误状态，禁止静默降级（锚 AGENTS 测试硬约束 #3）。

## Testing Decisions

- **好测试的标准**：只断言**外部可观察行为**——纯函数的状态矩阵、primitive 对外暴露的落定信号随请求成功/失败/空的可观察变化；不测组件内部实现细节、不对模板做快照。期望值全部来自 ADR-0150 / CONTEXT 词条与 Grill 确认的语义，不从被测实现反推。
- **Seam A（新，主 seam）**：三态判定纯函数。表驱动覆盖 `{ hasItems, loading, settled, hasError }` 全组合与优先级，重点：初始未落定 → 骨架；成功空 → 空态；失败 → 错误；`loading` 优先于错误与空态；有数据优先于一切。
- **Seam B（既有，优先复用）**：`createMixFeed` 与 `watchlistFeed` 的 headless 单测——落定信号：`autoStart:false` 初始假；首载成功（有数据 / 0 条）置真；首载失败不置真且错误槽有值；`refresh` 重试阶段回到未落定；重建实例 / `dispose` 后归假。
- **Seam C（既有）**：`useComments` / `useSearch` 的状态单测——`idle` 与 `loading` 归入骨架态；`ready` + 空结果才空态；搜索换关键词保留旧结果。
- **组件渲染面（骨架外观、首帧直出、刷新不闪）**：属 Lynx 渲染行为，归 web-core 预览 + 模拟器/真机验证闭环，node 不测模板。
- **验证闭环**：`pnpm check:app-lynx` + `pnpm test:app-lynx` 全绿；web-core 实测「首帧骨架 → 内容」「失败显错误」「真空显空态」「有数据刷新不闪骨架」；模拟器/真机复验四个列表页 + 三个补骨架页 + 评论/搜索。

## Out of Scope

- 详情页（小说 / 插画 / 动图）骨架语义改动（现状已正确，只做无收益改动）。
- 本地数据页（下载管理 / 我的 / 更新页）新增骨架。
- 骨架最短展示时长 / 延迟显示。
- webview 端（`packages/app`）同类问题。
- 分页 footer（「加载中…」/「没有更多了」/ 分页错误）语义变更。
- `useApiQuery` / `useApiInfiniteQuery`（当前无页面使用，不在本轮范围）。
- 数据层分页 / 合并 / 防抖 / 错误槽逻辑变更。

## Further Notes

- **IFR 约束**：首屏直出在后台线程启动前用组件初始状态绘制，因此骨架必须落在初始分支；这是「落定信号」不能改为「挂载后置位」的原因（ADR-0150）。
- **刷新不闪骨架的实现基础**：页面 `sync()` 快照在 `await` 之后才更新，刷新期间旧数据仍在快照里 → `hasItems` 为真 → 走内容分支。改造时不得为了「提前同步」而破坏这一点。
- **真·空态刷新**（Q16）：靠「刷新前同步置本地 `loading=true`」+ `hasItems` 假 + `settled` 真，使判定回到骨架。
- **不新增「加载中…」文案**：首载期一律骨架；仅分页 footer 保留文字态。

## Ticket 拆解（已发布，垂直切片）

采用 tracer-bullet 垂直切片：每个 ticket 走「数据层 → 纯逻辑 → 页面 → 测试」一条完整可验证路径。T1 是唯一的 foundation + tracer，其余复用。

| # | Ticket | 前置 | 交付（端到端可验证行为） | Issue |
|---|--------|------|--------------------------|-------|
| T1 | 落定信号 + 三态判定 + 插画页（tracer） | 无 | 共享落定访问器（`createMixFeed` / `watchlistFeed`）+ 三态判定纯函数；插画页首帧骨架 / 真空才空态 / 失败显错误 / 刷新不闪骨架；Seam A/B 单测 | #432 |
| T2 | 其余 createMixFeed 列表页接入 | T1 | 关注 Feed / 小说 / 追更三页行为同 T1 | #433 |
| T3 | 补齐页级骨架三页 | T1 | 收藏 / 用户主页 / 关注·粉丝列表新增页级骨架 + 互斥链 | #434 |
| T4 | 评论浮层 + 全局搜索弹层 | T1 | 浮层 idle 即骨架；首搜骨架；换词保留旧结果；Seam C 单测 | #435 |
| T5 | 验证闭环 | T1–T4 | check + 单测 + web-core + 模拟器/真机清单留证 | #436 |

并发策略：T1 先做；T2 / T3 / T4 在 T1 后互不依赖、可并行；T5 收口。父 spec issue：#431。每 ticket 走 TDD + 自测 + code-review 闭环。
