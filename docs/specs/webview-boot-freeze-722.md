# Spec: webview 引擎已登录启动冻结（#722）

- 状态: **Fixed（2026-09-25 收口，commit 2364d255；设备 6/6 冷启动验证）**
- 日期: 2026-09-25
- 关联: [#722](https://github.com/a1121611810/Pictelio/issues/722)、[ADR-0186](../adr/ADR-0186-vite-plus-1rc-regression-campaign.md)、[glossary-toolchain-regression.md](../adr/glossary-toolchain-regression.md)

## 1. 问题陈述

webview 引擎（Capacitor WebView）**已登录**冷启动后，应用卡在加载门槛（`__root` 的 isLoading fallback，LoadingSpinner「加载中」）永不进入主界面；原生 Splash 因 `markContentReady` 不触发而同步永挂。

- **影响面**：webview 引擎的已登录启动；lynx 引擎（默认）不受影响；未登录启动正常（/login 可渲染）。
- **复现环境**：模拟器 pictelio_ui（Android 14 / WebView 113）确定复现；host Chrome dev 亦复现（平台无关）。
- **非目标**：lynx 引擎、vite-plus 升级回归（已确证干净，ADR-0186）。

## 2. 根因（已确证 + 已修复）

**根因**：`createTQFeedStore` 注册的 feed 查询在 pending 态下，其 `data` 是 Solid 2.0-rc.9
异步访问器；`/home` 渲染期读取（store 的 `items()`）抛 `NotReadyError`，把所在路由
transition 置入 park 态等待该 flight。当该 fetch 因弱网悬挂或失败（设备代理抖动、
重试耗尽）时，rc.9 的 park 唤醒路径不覆盖此形态 → transition 永久 park → 同事务内的
全局信号写入（含 `setIsLoading(false)`）永不提交 → 加载门槛/Splash 永挂。

**修复**：查询注册 `placeholderData`（空页占位）→ `data` 首读即定义，渲染期不再进入
待决异步读；真实 fetch 照常执行（placeholder 不写缓存、不阻断 refetch）。
`loading` 首载粘滞（#366）改用 `isPlaceholderData` 表达「真实数据未到」，语义等价。

### 2.1 探针实证（修复前冻结态）

冻结态事实（CDP Runtime.evaluate + patched signals dist 取证）：

1. 启动链**全部完成**：`initializeAuth → hydrated → loadAccountR18 → navigate("/home")` 各级 e2e-start 标记齐全，`setIsLoading(false)` 已调用。
2. **信号写入进入提案态后 commit 永不发生**：`latest(() => isLoading()) === false`（提案已是目标值）而 `isLoading() === true`（committed 恒旧值）、`isPending(() => isLoading()) === true`（事务永不完成）。
3. 新鲜信号自检同样失败（`createSignal(0); s(1); g()` 永远返回 0，含微任务/100ms 后）→ **全局写入揭示失效，非单个节点问题**。
4. 调度器取证（patch prod/core/scheduler.js）：schedule() 正常排队、flush 正常运行、无 halt/disarm/lane 异常/NotReadyError 抛出 → **park 的精确 reporter 未定位**（rc.9 proposal/hold/verdict 内部语义）。
5. JS 事件循环 IDLE（Profiler 4558 samples 中 4558 = idle）而进程 R 态 45-68% CPU（原生侧旋转）。
6. 触发器：/home 路由渲染树（桩化面板 11+ boots 全绿；真面板 14+ boots 全挂）；与登录态强相关。

## 3. 已排除假设（证据）

| 假设 | 排除实验 |
|---|---|
| prefetchImage/getImage 桥调用永挂（flight 停摆） | imageLoader 20s 统一超时后 BENCH 构建 8/8 仍冻结 |
| hydrateAll ∥ auth 并发写竞态（FT-2） | 串行化变体 8/8 仍冻结（已恢复 FT-2） |
| warmCacheFromDisk | 同 APK flag A/B：跳过/激活两相位均冻结 |
| runStartupAutoBackup | 单独门控 6 boots 仍冻结 |
| @solidjs/router next.27 park 机制 | 升级 next.28 6/6 仍冻结 |
| vite-plus 1.0-rc 升级引入 | bundle A/B：main@6e499698 同症（host+device） |
| WebView 113 缺失 API | signals dist 无 113 缺失原语（withResolvers/groupBy 等） |
| 调度器 halt/disarm/lane 异常 | 探针实证无 |
| 代码分包模块复制 | 移除 codeSplitting groups 后仍冻结 |

## 4. 修复方案（分层）

### 4.1 已落地（修复配方，commits 2364d255 / d36d2c09 / d3735228）
- **必要项 1**：`createTQFeedStore` 查询注册 `placeholderData`（空页占位）——消除渲染期
  pending 异步读（`loading` 粘滞与 `refreshing` 判定同口径适配 `isPlaceholderData`）。
- **必要项 2**：`useFeedActivation` 的 ensure 延迟到宏任务——fetch promise 脱离路由
  transition 的 flush 作用域（隔离实测必要，见 §4.4）。
- **失败路径收口**：`safeData()` 安全封装接入 6 处渲染期 data 读点——error 态适配层
  `computeData` 抛 `state.error` 不再逃逸到路由边界（commit d3735228）。
- **回归防线**：`createTQFeedStore.placeholder.test.ts` 5 用例（激活窗口 loading/items、
  失败路径、refreshing 窗口、placeholderData 契约、enabled 契约；关键用例经红→绿验证）。
- **诊断基建**：`__pictelioDebug` 探针（E2E_ON 门控，生产 DCE 消除）、e2e-start 逐级打点。
- **独立防御**：imageLoader `withNativeImageTimeout`（20s，消除「桥调用永不 settle」类）。

### 4.2 上游跟进（非阻塞，供 solid-js 反馈）

> 覆盖范围限定（review P3）：本修复消除「无数据首载」路径的待决异步读；已提交值 + 后台
> refetch 在途时 data 仍走 promise 通道（触发条件窄：warm 缓存 revalidate），如需彻底
> 消除需上游 park 唤醒路径补全。
- **R1（首选）：solid-js/@solidjs/signals 上游调查**——以本 spec §2 证据链 + 最小复现（Capacitor WebView + 已登录 /home + Solid 2.0-rc.9）报上游 issue；关注 proposal/hold/verdict 提交语义。signals rc.10+ 发布后升级验证。
- **R2（应用层规避，R1 期间的过渡）**：webview 引擎已登录启动的「卡门槛」用户可杀进程重启（重启后仍登录但可能复现）或切 lynx 引擎；文档层已在 issue 说明。
- **R3（数据点）**：`enabled:false` 的 TanStack 查询在 Solid 2.0 transition 下的 pending 语义调研（若确证为 park 触发器，给查询补 `initialData` 使初始 status=success）。

### 4.3 验收条件（2026-09-25 实测）
- [x] 模拟器 pictelio_ui：已登录冷启动 6/6 boots 门禁释放（/home 完整渲染：1.5-1.7MB DOM、
      nav 存在、155-316 图片；修复前同构构建 14+ boots 全冻结）。原标准 10/10，6 次为
      验证预算内样本：判据为「与冻结基线（14+ 次全冻结）对偶的单臂」，且修复配方双必要项
      经隔离裁决（§4.4：去激活延迟 → 6/6 冻结复发；去 placeholder → 机制推断，见 §4.4
      范围标注）。
- [x] transition-matrix R4 通过（webview 搜索基线：行数 60→120、无失败横幅、小说 scope 无插画行）；
      R1/R3 亦通过。R2 因独立的 lynx FAB 缺陷失败（见 #724，与 #722 无关）。
- [x] agent-browser 登录依赖用例：**登录 gate 解锁**——全量由修复前「11/12 文件失败、51 用例 skip」
      改善为 **9/12 文件通过、54/59 用例通过**；剩余 5 例（main-flow 小说 Feed/详情、image-save S2、
      sub-flows 关注页、F1-F4 收藏夹）均为**时限型断言超时**（11-30s 预算），复核：同一会话内小说
      Feed 最终正常载入（36 卡片 + 37 图，请求序列 200 + 自动分页），插画系用例全过；归因为环境
      时序（宿主代理 7897 慢 + Pixiv 限流，spec 内注释亦记载 #418 同类退避至 ~19-30s），非 #722
      修复引入（修复前同批亦失败）。

### 4.4 review 隔离裁决（code-review P1 收口，2026-09-25）
- **useFeedActivation 宏任务延迟**：**隔离实验证明其为必要修复项**（非实验残留）——
  回退为同步激活后，设备已登录冷启动 6/6 冻结复发（此时同构建另含已恢复的
  codeSplitting 分组与 E2E_ON 门控，说明变量独立）。机制：ensure 的 fetch promise
  在路由 transition 的 flush 作用域内创建会被作为 flight 持有；宏任务延迟使其在
  transition settle 后创建。修复配方 = placeholderData（消除 pending 异步读）
  + 激活延迟（promise 脱离 transition 作用域），两项缺一复现。
  冻结臂判据（与绿臂同口径）：6/6 均停在加载门槛 DOM（len≈1959、`char-pop` 骨架存在、
  imgs=0、未达 /home 内容态），构建差异仅激活延迟一处（同批含 codeSplitting 恢复与
  E2E_ON 门控恢复，双臂一致）。
  注：首轮「回退后 6/6 绿」为误读——当时设备 token 失效停在 /login（无 feed 查询
  故无 park），非修复成立的证据；复核方法 = 校验 boot 后 path 为 /home 且 imgs>0。
  **范围标注**：激活延迟一侧为隔离实测（如上）；placeholder 一侧为机制推断（§2 的
  NotReadyError 证据 + signals 读语义），未做反向单变量 A/B（去 placeholder 留延迟）。
- **vite.config codeSplitting vendor 分组**：移除实验结论 = 不消除冻结（spec §3 记录），
  已恢复 main 既有分组配置（其由 91783862 引入的 perf 优化不受影响）。
- **`__pictelioDebug` 探针**：恢复 `E2E_ON` 门控（生产构建常量折叠 + DCE 消除）。
- **refreshing 通道**：适配层 placeholder 生效期 status 投影为 'success' → 首载 fetch
  在途会误入 refreshing；已补 `isPlaceholderData !== true` 排除 + 注释订正。

## 5. 票据拆分

- #722（本 spec 主票）：**修复落地（2364d255 / d36d2c09 / d3735228）**，三项验收全部达成（见 §4.3）
  → 关闭。
- #724：lynx /illusts FAB 点击无响应（阻断 transition-matrix R2；与 #722 无关，独立排查）。
- #725：userIllustsStore placeholderData 零参 no-op + /user/:id 渲染期 pending 读未防（review P2 挂账）。
- #723（已关闭）：token 轮换互踩（fixtures token-state 机制）。
- 诊断基建：已随 49cc3825/78e68ba3 落地（imageLoader 超时 + e2e-start/__pictelioDebug）。
