# Spec: app-lynx 列表翻页失效 + 追更询问不弹 修复

- 状态：draft（Grill 已收敛，待用户确认后进 to-tickets）
- 日期：2026-08-29
- 关联：`docs/specs/app-lynx-novel-series-watchlist.md`（US2–US5 触发语义不变）、ADR-0107/0109/0110（平台事实与 patch 错位 workaround）

## 1. 背景

两个线上 bug，上一轮会话声称已修复，但用户在**真机与模拟器双端**复测均未生效。流程根因：**修复后无任何验证闭环**——所有平台事实产自模拟器，真机端事件派发面为空白；且模拟器端也未实际复现验证。

## 2. 问题定义

### Bug 1：列表翻页不拼接

- 现象：lynx 列表向下滑动接近底部，下一页数据不追加（双端复现）。
- 涉及面：全部消费 `createMixFeed` / `@scrolltolower` 的 9 个列表实例（Recommended / Following / IllustList / NovelList / Bookmarks×2 / UserHome×2 / Watchlist）。
- 期望：接近底部时请求下一页并拼接，可连续翻页直到源耗尽显示到底 footer。

### Bug 2：追更询问不弹

- 现象：小说详情读到底部后按返回，「追更询问」弹窗不出现（双端复现）。
- 语义（Grill 已确认，**维持 spec 原义，不变更**）：触发条件全命中——系列小说 + 未追更 + 本会话未「暂不」+ 停留 ≥10s +（滚动 ≥70% 或到达底部）；弹出时机 = **按返回键时**（返回守卫拦截），非到底自动弹。
- 期望：满足条件时按返回（‹ 箭头与系统返回两路）弹窗；decline/cancel/confirm 语义遵循 watchlist spec §US5。

## 3. 嫌疑人清单（诊断假设，按层划分）

### Bug 1

| # | 层 | 假设 | 依据 |
|---|----|------|------|
| H1 | 渲染层 | 翻页 append 踩 vue-lynx patch 错位框架 bug：数据已请求成功但新 list-item 未渲染/渲染错乱。现有 epoch 重建 workaround（ADR-0107 D4）只覆盖 refresh 整体替换，**未覆盖翻页追加** | Recommended.vue L89-93 注释记录的实证框架 bug |
| H2 | 逻辑层 | 双防抖（throttle 800ms + cooldown 3s）吞事件后**无重试机制**；真机 `scrolltolower` 若为单发事件，落入冷却窗被吞即永久卡死 | createMixFeed.ts `fetchMore()` 两个早退 `return` |
| H3 | 事件层 | 真机原生 `<list>`（waterfall）的 `scrolltolower` 派发与否/频次无实证 | 平台事实全部产自模拟器（ADR-0110） |

### Bug 2

| # | 层 | 假设 | 依据 |
|---|----|------|------|
| H4 | 触发源 | 原生端 scroll-view 的 `@scroll` 不派发（代码注释自留口子）且 `@scrolltolower` 兜底也失效 → progress 恒 0、reachedBottom 恒 false | NovelDetail.vue L60-65 注释；ADR-0109 结论仅模拟器实证 |
| H5 | 判定输入 | 系列状态预取失败 → `watchAdded=null` → 保守不弹（仅 console.warn，用户无感）；或测试用小说非系列小说（`hasSeries=false`，不弹为正确行为） | shouldPromptWatchlist 保守不弹语义 |
| H6 | 守卫链 | 系统返回桥（pictelioBack → handleSystemBack → runGuards）或 ‹ 箭头 requestBack 链路断裂 | router.ts L141-190，静态审查结构完整，需运行时验证 |

## 4. 方案（四阶段，顺序执行）

### T0 · 模拟器/web-core 复现（已执行，2026-08-29）

**执行方式**：`src/debug/t0Diag.ts` UI 横幅打点（App.vue 顶部渲染最近 6 条）+ 截图取证，替代 logcat。
**平台事实（已实证，记入修复）**：
1. lynx JS `console.log` **不进 logcat**（LynxLogService 仅桥原生侧日志）；`adb logcat -d --pid` 对 app 进程零 JS 日志。诊断信息只能走 UI 横幅 + 截图（t0Diag 注释）。
2. 原生模拟器 `<list>` 的 `scrolltolower` 正常派发，但为**低频单发**（到达阈值附近才发一次），非 web-core 高频连发。
3. 原生模拟器 `<scroll-view>` 的 `@scroll`（payload 含 scrollTop/scrollHeight）与 `@scrolltolower` 均正常派发。
4. 真机事件面未验证（T2）。

**Bug 1 确诊**：H2 成立——`createMixFeed` 双防抖（cooldown 3s）吞掉低频单发事件后无重试，列表永久停住（横幅实拍：`SWALLOW cooldown 965ms<3000` → `synced items=40` 卡死）。H1 渲染层证伪（append 正常渲染）、H3 模拟器证伪（事件派发正常）。
**Bug 2 模拟器证伪**：完整链路工作（系列小说 + 预取成功 + dwell + progress≥0.7 + 系统返回 → hit=true → 弹窗）；用户复现失败待真机定性。

（初版曾以 Appium E2E spec `t0-repro.spec.ts` 驱动 + logcat 断言取证，因通道事实 1 使断言恒失败、且断言字符串与打点不匹配，已删除；诊断价值由横幅+截图+手动 adb 驱动完整承接。）

### T1 · 确定性逻辑缺陷修复（已实现，2026-08-29）

1. **H2**：`createMixFeed.fetchMore` 被防抖抑制时，若仍有可加载内容（`pending` 非空或 `hasNext()`），注册**一次性重试定时器**在窗口结束后自动补触发；refresh/dispose 时清除。补发完成后调用 `onUpdate` 回调通知页面重新快照（P1：重试路径不经页面 loadMore/sync，不回调则列表数据变但页面不重渲染——standards 复检发现）。单测覆盖：吞事件→定时补发（含 onUpdate 契约）、refresh 清定时器、dispose 清定时器、耗尽不注册、不叠加、一次性不幽灵级联。
2. **watchlistFeed 同款补触发**（standards 复检残留风险）：在飞锁吞掉的单发事件 → 800ms 后自动补发 + onUpdate 快照 + dispose。
3. **H5 加固**：预取失败的 `console.warn` 已存在（非静默降级，符合测试硬约束 3），本次不改语义，仅 T0 验证其触发情况。
4. 已接受的 minor（记录在案，不修）：补触发在两个模块重复实现（延迟语义不同，合并得不偿失）；缺 firstLoadInFlight 吞→refresh 完成后重排的确定性单测（实现经推演正确）。
5. 两轮 code-review 结论：第一轮 F1/F2/F3 全部闭环；第二轮 P1（onUpdate 快照）+ P2（dispose）闭环；变异验证（父会话执行）：删 clearRetry() → refresh 清定时器用例红；删 scheduleRetry() → watchlistFeed 重试用例红；还原后 476 测试全绿。

### T2 · 真机探针（事实钉死）

复用 ADR-0110 四色探针方法论，在临时探针页对双端实测并记录：

- `<list>`（waterfall）：`scrolltolower` 是否派发、频次（单发/连发）、`lower-threshold-item-count` 行为。
- `<scroll-view>`：`@scroll` 是否派发、payload 字段、`@scrolltolower` 是否派发。
- 产出：新平台事实写入 ADR（修订 ADR-0110 事实②的适用范围或新增 ADR），探针页随 T3 收尾移除或保留在 debug 路由。

### T3 · 修复落地 + 验证闭环

- 按 T0/T2 确诊结果修复（如 H1 成立：翻页追加路径接入 epoch 重建类 workaround 或找到 append 安全通道；如 H3/H4 成立：按探针事实设计保底通道）。
- **验证闭环（本次新增的流程硬性要求）**：
  1. 逻辑修复全部有单测（防抖重试、判定链路）；
  2. web-core + 模拟器实测双 bug 现象消失；
  3. 产出**真机手动验证 checklist** 交付用户逐项打勾；
  4. **用户确认真机通过前，不得宣称修复完成。**

## 5. 验收条件

- Bug 1：真机 + 模拟器，推荐/插画/小说 feed 接近底部自动拼接下一页，可连续翻页直至到底 footer 出现；翻页失败底部内联错误且保留重试。
- Bug 2：系列小说停留 ≥10s 滚到底（或 ≥70%），按返回（‹ 与系统返回两路）弹追更询问；非系列/已追更/已暂不/停留不足均不弹。
- 两个 bug 的修复均有对应单测；真机平台事实沉淀 ADR；CONTEXT.md 术语已更新（追更询问，本次 Grill 已完成）。

## 6. 排除项

- 不变更追更询问触发语义（Grill 已确认维持 spec §US2 原义，不做"到底自动弹"）。
- 不重构列表渲染架构、不引入原生桥新面（ADR-0106 红线不变）。
- webview 主端（packages/app）行为不在本次范围。
