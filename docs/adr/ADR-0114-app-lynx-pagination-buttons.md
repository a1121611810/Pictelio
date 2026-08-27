# ADR-0114: app-lynx 推荐页按钮分页（替换式翻书，绕开 list 增量渲染 bug）

- 状态：accepted
- 日期：2026-08-29
- 关联：ADR-0107（epoch 重建 workaround）、ADR-0110（`<list>` 无 JS 滚动接口，事实③）、ADR-0104（分页收敛 / createMixFeed）、ADR-0111（FAB menu）、ADR-0112（bookmark 动画，同轮真机闭环方法）、`packages/app-lynx/CONTEXT.md`（分页：按钮分页 / button pagination）
- 来源：grill-with-docs 会话——web-core DOM 实证 + 真机确认钉死框架级增量渲染 bug，用户拍板放弃「滚动到底自动翻页」，改 FAB 按钮分页（替换式翻书）

## 背景

推荐页此前采用「滚动到底自动翻页」的无限滚动形态（`@scrolltolower` → `createMixFeed.fetchMore`）。上一轮翻页修复（T1 补触发，`docs/specs/app-lynx-feed-pagination-and-watchlist-prompt-fix.md`）解决的是**数据层停滞**：双防抖（throttle 800ms + cooldown 3s）吞掉原生低频单发 `scrolltolower` 事件后无重试，列表永久停住（T0 横幅实证 `SWALLOW cooldown` → `synced items=40` 卡死）。补触发让数据确实增长后，更深一层的**渲染层缺陷**现形——

**vue-lynx `<list>` 组件对新增 list-item 的增量渲染失效**：web-core DOM 实测，list `items` 数据 40→60→100 增长，`x-list` 内容高度纹丝不动、UI 不增；真机用户确认 UI 不增长。双端一致，且**无 RemoveNode 报错**——不是 ADR-0107 那种有日志的 patch 错位，而是静默的「新条目不进布局」。配合 ADR-0110 事实③（`<list>` 无 JS 滚动接口，`scroll-to-index` 为 scroll-view 专有、`initial-scroll-index` 仅初始化生效），无限滚动形态在平台层被两座墙夹死：**数据渲染不上去，重建又回不了位**。

**方案决策（Grill 确认）**：放弃无限滚动形态，改为 **FAB 按钮分页（替换式翻书）**——列表永远只显示当前页，切页 = epoch 整树重建（ADR-0107 已验证机制）+ 从页顶看。回顶从「缺陷」变成「翻页的自然语义」，一举绕开两个框架限制。

## 平台事实（本轮新实证，web-core 实测 / 真机确认）

1. **增量 append 不渲染新条目（静默，非报错）**：`items` 数据 40→60→100 增长后 `x-list` 内容高度不涨、UI 不增，双端一致，logcat/DOM 均无 RemoveNode 或渲染错误——与 ADR-0107 的 patch 错位（有 16 条 RemoveNode 日志）是两类不同缺陷。T0 曾以「H1 证伪（append 正常渲染）」收场，系观测窗口内数据被防抖吞掉从未真正增长所致；数据直推后缺陷现形。
2. **epoch 重建（`:key` 整树替换）能正确渲染全部条目，但必然回顶**：这是当前唯一可靠的渲染机制（ADR-0107 已验证），代价是滚动位置归零、整页首屏级重建成本。
3. **恢复滚动 / 强制重排的替代手段全部实测无效**：
   - `initial-scroll-index`：仅初始化生效，重建后传值无法恢复滚动位置（ADR-0110 已记录）；
   - `scroll-to-index`：scroll-view 专有，`<list>` 上不可用（ADR-0110 事实③）；
   - 属性 toggle（`span-count`、`gap` 变更）：web-core 实测只有**一次性**效果，无法持续触发重排让新条目进入布局。
4. **Pixiv API 无 `prev_url`**：上一页无法从服务端取回，只能靠客户端页缓存（已拉页数据内存缓存，「上一页」即时返回不重新请求）。

## 决策

1. **形态转换：无限滚动 → FAB 按钮分页（替换式翻书）**（仅推荐页）。列表永远只显示当前页；切页 = 页面 `sync()` 内同 tick `refreshEpoch.value++`（epoch 整树重建，ADR-0107 D4 的同一 reactive flush 要求）→ 从页顶看新页。移除 `@scrolltolower` 绑定——滚动只浏览当前页，不再触发任何自动加载。回顶成为翻页的自然语义。
2. **每页内容 = 插画路一页（20）+ 小说路一页（20）按 `create_date` 时间交叉合并**：两路各自拉一页后按 `create_date` 降序交叉合并排序（app 端 `recommendedStore` 的 sortByDate + mergeAndSort 语义，替代 lynx 现状 4:1 固定比例交替）。页内**全量**展示两路之和（约 40 条），不做「取前 N」截断——按时间排序后截断会丢数据且无衔接。
3. **翻页交互 = FAB menu 扩展（2 项 → 最多 4 项）**：现有「刷新 / 回顶」加「上一页 / 下一页」（ADR-0111 形态延续）。
   - 第 1 页：只显示「下一页」（用户原话：第一页只有下一页）；
   - 第 2 页起：显示「上一页 + 下一页」；
   - 两路 `next_url` 均空（`hasNext()` false）：无「下一页」；
   - 点「下一页」：拉两路各下一页 → 时间合并 → 替换当前页 → epoch 重建；
   - 点「上一页」：切回内存缓存页（平台事实 4：无 prev_url）→ 替换 + epoch 重建，**不重新请求**；
   - 「刷新」：回第 1 页重拉（清缓存）；「回顶」保留现有重建回顶语义。
4. **数据层 = `createPagedFeed` 深模块（新建，推荐页专用）**：对齐 createMixFeed 风格（纯 TS 无 DOM 依赖、node 可测），语义从「流式累积」改为「页式缓存」——`cachedPages`（每页缓存两路游标 + 合并后 items；`maxCachedPages` 默认 5，超出淘汰最旧）、`currentIndex`、generation 竞态代（切页/刷新作废在途响应）、withTimeout（单页请求 15s）。接口：`items/loading/error/pageIndex/hasPrev/hasNext/next/prev/refresh/dispose`。**T1 补触发 / onUpdate / dispose 机制保留语义**——onUpdate 通知页面重新快照；补触发对按钮模式非必需（无 scrolltolower 依赖），但 refresh 竞态防护保留。
5. **渲染层契约**：页面 `sync()` 中 `items.value = feed.items()` → 同一 reactive flush 内 `refreshEpoch.value++`；切页加载中显示页内 loading（骨架或「加载中…」）；加载失败显示错误文案 + 可重试（重试当前页，**非静默降级**，error 置文案 + warn）；footer 显示当前页号 + 两路耗尽时「没有更多了」。
6. **范围与后续**：推荐页迁移到 `createPagedFeed`；`createMixFeed` 的推荐实例不再使用，但 createMixFeed 仍服务其余 8 个列表实例（插画/小说/关注/收藏×2/用户主页×2/追更），**本轮不动**，待推荐页分页模式验收后按需铺开。Lynx SDK 升级（根治增量渲染 bug）为正确方向但工程量/风险大（引擎升级波及全部 9 个列表实例与既有平台事实），**独立 ticket 追踪，不阻塞本轮**。

## 被考虑的方案

- **epoch 重建翻页保持无限滚动**：翻页即回顶，与无限滚动的连续浏览语义直接冲突——滚到底自动加载的预期被「页面跳回顶部」打断，用户体验不可接受。否决。
- **scroll-view 替代 `<list>`**：scroll-view 有完整滚动事件面（ADR-0110 事实③），但**无虚拟化**——全量渲染导致图片加载风暴与内存压力（ADR-0060 教训）。否决。
- **属性 toggle 强制重排（`span-count` / `gap` 变更）**：web-core 实测只有一次性效果，无法持续驱动重排让新条目进入布局，且属性抖动有渲染闪烁风险。否决。
- **Lynx SDK 升级根治增量渲染 bug**：方向正确，但引擎升级影响全部 9 个列表实例、既有平台事实可能全部位移、验证闭环成本高。独立 ticket 追踪，本轮以 workaround 绕过。否决（本轮）。
- **维持无限滚动 + 仅靠 T1 补触发修补**：前序修复已实施，但只能保证数据层增长（防抖吞事件），渲染层「数据涨、UI 不涨」的缺陷依旧无解。否决。

## 后果

- 正面：
  - 一次性绕开两座墙（增量渲染失效 + 无滚动接口），无需再与框架 bug 搏斗；
  - 回顶从「缺陷」变成「翻页的自然语义」，与 epoch 重建机制天然契合（ADR-0107 已验证）；
  - 页级缓存让「上一页」即时返回（零请求）；页式语义更贴近「翻书」直觉；
  - 数据层收敛为 `createPagedFeed` 深模块（node 可测、generation 竞态防护、超时兜底），页面退化为 ref 快照 + sync 桥接（ADR-0104 已确立模式）；
  - 时间交叉合并对齐 app 端 recommendedStore 语义，两端 feed 口径趋同（ADR-0098 跨端一致性方向）。
- 负面：
  - 推荐页失去无限滚动连续浏览体验（产品决策，Grill 已确认接受）；
  - 「下一页」需等两路请求全部完成才可切页（预取相邻页为后续优化，本轮不预取）；
  - 页缓存有上限（默认 5 页）——超过后「上一页」无法回溯更早页；
  - 切页 = 首屏级整树重建，滑动位置必然归零（这是设计语义，非缺陷）。
- 待验证项（实现期闭环，模拟器 + 真机）：
  - `createPagedFeed` 单测矩阵全绿（首载时间合并 / next 游标传递 / prev 零请求 / hasPrev-hasNext 边界 / 竞态 generation / 错误可重试 / 缓存上限淘汰 / refresh 清缓存 / dispose 无孤儿请求），oracle = app 端 mergeAndSort 语义 + Pixiv API 字段语义；
  - `pnpm check:app-lynx` 类型检查通过；
  - **web-core 预览实测**：翻页后 `x-list` 内容高度随页正确变化（epoch 重建已验证）、上一页/下一页往返正确、属性残留无闪烁；
  - **模拟器 + 真机**：翻书流程（第 1 页 → 下一页 → 上一页 → 刷新回第 1 页）、真机日志导出（`t0Export`）确认每次切页；两路耗尽后「下一页」消失。
