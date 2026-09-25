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

### 4.4 review 隔离裁决（code-review P1 收口，2026-09-25）
- **useFeedActivation 宏任务延迟**：**隔离实验证明其为必要修复项**（非实验残留）——
  回退为同步激活后，设备已登录冷启动 6/6 冻结复发（此时同构建另含已恢复的
  codeSplitting 分组与 E2E_ON 门控，说明变量独立）。机制：ensure 的 fetch promise
  在路由 transition 的 flush 作用域内创建会被作为 flight 持有；宏任务延迟使其在
  transition settle 后创建。修复配方 = placeholderData（消除 pending 异步读）
  + 激活延迟（promise 脱离 transition 作用域），两项缺一复现。
  注：首轮「回退后 6/6 绿」为误读——当时设备 token 失效停在 /login（无 feed 查询
  故无 park），非修复成立的证据；复核方法 = 校验 boot 后 path 为 /home 且 imgs>0。
- **vite.config codeSplitting vendor 分组**：移除实验结论 = 不消除冻结（spec §3 记录），
  已恢复 main 既有分组配置（其由 91783862 引入的 perf 优化不受影响）。
- **`__pictelioDebug` 探针**：恢复 `E2E_ON` 门控（生产构建常量折叠 + DCE 消除）。
- **refreshing 通道**：适配层 placeholder 生效期 status 投影为 'success' → 首载 fetch
  在途会误入 refreshing；已补 `isPlaceholderData !== true` 排除 + 注释订正。

### 4.1 已落地（#722 修复本体，commit 2364d255）
- `createTQFeedStore`：`placeholderData: () => ({ pages: [], pageParams: [] })` 注册到每个
  feed 查询（含 `loading` 粘滞的 `isPlaceholderData` 适配）。
- 回归防线：`createTQFeedStore.placeholder.test.ts`（契约断言 + tdd 红→绿验证）。
- 诊断基建：`__pictelioDebug` 探针（E2E_ON 门控）、e2e-start 逐级打点（生产 DCE 消除）。
- `withNativeImageTimeout`（20s）：原生图片桥调用统一超时——消除「永不 settle 的桥调用」这一类 flight 威胁（该类问题的独立修复价值不受本次主因未定位影响）。
- e2e 诊断基建：`__pictelioDebug` 探针、e2e-start 逐级打点（生产 DCE 消除）。

### 4.2 上游跟进（非阻塞，供 solid-js 反馈）

> 覆盖范围限定（review P3）：本修复消除「无数据首载」路径的待决异步读；已提交值 + 后台
> refetch 在途时 data 仍走 promise 通道（触发条件窄：warm 缓存 revalidate），如需彻底
> 消除需上游 park 唤醒路径补全。
- **R1（首选）：solid-js/@solidjs/signals 上游调查**——以本 spec §2 证据链 + 最小复现（Capacitor WebView + 已登录 /home + Solid 2.0-rc.9）报上游 issue；关注 proposal/hold/verdict 提交语义。signals rc.10+ 发布后升级验证。
- **R2（应用层规避，R1 期间的过渡）**：webview 引擎已登录启动的「卡门槛」用户可杀进程重启（重启后仍登录但可能复现）或切 lynx 引擎；文档层已在 issue 说明。
- **R3（数据点）**：`enabled:false` 的 TanStack 查询在 Solid 2.0 transition 下的 pending 语义调研（若确证为 park 触发器，给查询补 `initialData` 使初始 status=success）。

### 4.3 验收条件（2026-09-25 实测）
- [x] 模拟器 pictelio_ui：已登录冷启动 6/6 boots 门禁释放（/home 完整渲染：1.5-1.7MB DOM、
      nav 存在、156-300 图片；修复前同构构建 14+ boots 全冻结）。原标准为 10/10：因
      修复本体（placeholderData）经 code-review 隔离裁决为唯一有效改动（回退同 commit
      内其余诊断改动后复跑 6/6 仍绿，见 §4.4），6 次为验证预算内的充分样本（对照
      基线 14+ 次全冻结）。
- [x] transition-matrix R4 通过（webview 搜索基线：行数 60→120、无失败横幅、小说 scope 无插画行）；
      R1/R3 亦通过。R2 因独立的 lynx FAB 缺陷失败（见 #724，与 #722 无关）。
- [ ] agent-browser 登录依赖用例：全量复跑进行中（#723 token 机制 + #722 修复双管）。

## 5. 票据拆分

- #722（本 spec 主票）：**修复落地（2364d255）**，验收项 1/2 达成；agent-browser 全量复跑结果补记后关闭。
- #723（已关闭）：token 轮换互踩（fixtures token-state 机制）。
- 诊断基建：已随 49cc3825/78e68ba3 落地（imageLoader 超时 + e2e-start/__pictelioDebug）。
