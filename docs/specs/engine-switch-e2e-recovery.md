# Spec: 引擎切换线 E2E 恢复（桥线程卸载 + 测试契约刷新）

- 状态：implemented（2026-09-14；分支 fix/engine-switch-e2e-recovery，T1-T7 全部落地 + code-review 双轮 PASS。E2E 验收：最终 APK 下 oneway / roundtrip / 3x / settings-sync-contract 18/18 绿、roundtrip-low 2/2 绿（ADR-0153 降级实测通过）、fab-hit-testing 2/2 绿（该套件自 2026-08-30 以来首次完整跑通）——移交清单 10 failed → 0 failed、连带的 fab 跳过转绿。工程门禁：check:all / lint:all 绿；单测 app 1752 / lynx 1221 / ugoira 等全绿（根 test:all 并发下 relatedInjectionStore 有与本 effort 无关的既有 flake，单跑稳定）。agent-browser 套件的失败已做基线 bisect 实证：在分叉点 0e6bba07 复跑同样 4 spec 得到逐字一致的 9 失败（横向溢出 600>360、Feed 空、保存失败等）——为分支既有的内容/UI 问题，非本 effort 回归，见 #528）
- 日期：2026-09-13
- 决策依据：ADR-0159（插件桥线程卸载与引擎切换线 E2E 契约修复）
- 失败清单：`docs/android-e2e-engine-switch-known-failures.md`（10 failed / 21 passed / 5 skipped，6 spec）
- 术语表：`docs/adr/glossary-client-switch.md`（插件桥线程 / 桥线程阻塞 / 契约层 / UI 路径 / E2E 钩子 / DOM 契约 / 渲染就绪信号）

## Problem Statement

用户点「确认切换渲染引擎」后，应用可能毫无反应——切换选择不落盘、重启后引擎不变。根因是插件桥线程被 Feed 的同步网络 I/O 阻塞，切换写入被排队饿死。同时，验证这条链路的 10 条 E2E 用例全部失败：一部分因页面 DOM 契约腐化点不到真实入口，一部分因用例跑错设备，还有一条因迁移断言不等落盘而 flaky，Lynx 侧登录用例因盲操作整文件跳过。失败长期静默存在，因为所有失败路径都被静默吞掉。

## Solution

按 ADR-0159 六项决策落地：网络插件方法卸载到自有执行器（与 Web 端 fetch 并发语义对齐）；冷态丢写与切换结果显式可观测；E2E 用例改绑语义化 aria-label、落盘断言一律轮询、设备条件用例 pin AVD、Lynx 登录等渲染就绪信号。修完后引擎切换线全量 E2E 转绿。

## User Stories

1. As a 移动端用户, I want 点「确认切换」后应用一定记住我的选择, so that 重启后进入我选的引擎
2. As a 弱网环境用户, I want 切换引擎不被首页图片/接口加载卡住, so that 任何时刻操作都即时生效
3. As a 设置页用户, I want 在设置里改的开关（如 R-18 分档）确定保存, so that 下次打开还是我的偏好
4. As a 低端机（WebView 过旧）用户, I want 启动时自动进入可用的 Lynx 引擎, so that 不被静态升级页挡死
5. As a 用户, I want 切换失败时得到明确反馈而非无声无息, so that 我知道该重试还是换网络
6. As a 开发者, I want 冷态丢弃的设置写入打出带 key 的警告, so that 时序问题当场可见而非潜伏
7. As a 开发者, I want E2E 钩子回传切换结果（成功/失败原因）, so that 用例失败时直接看到 reason 而非"pref 为 null"
8. As a E2E 维护者, I want 用例绑定语义化 aria-label, so that UI 重构不再静默作废选择器
9. As a E2E 维护者, I want 所有落盘断言轮询等待, so that 异步 apply 的时序不再产生 flaky
10. As a E2E 维护者, I want 设备条件用例在代码里 pin AVD 并在错误设备上显式 skip, so that 忘设环境变量时不会静默跑错设备
11. As a E2E 维护者, I want Lynx 登录前等待渲染就绪日志, so that 慢渲染设备上盲操作链不再整批失效
12. As a 新接手的开发者, I want README 写清 e2e 构建模式与 AVD 选择, so that 复现时不再被"钩子缺失"误导
13. As a 排查线上问题的开发者, I want 网络请求与插件调用互不阻塞, so that 接口慢不再放大成全局功能失灵
14. As a reviewer, I want 桥线程卸载语义有独立单元测试锁定, so that 后续改动不回归串行阻塞

## Implementation Decisions

1. **新增"网络卸载器"小类（唯一新增 seam）**：包装一个线程池与提交语义——`dispatch(task, onSuccess, onFailure)`：提交即返回（不阻塞调用线程），任务在池内线程执行，正常完成回调 `onSuccess`、抛异常回调 `onFailure`。请求与预取两个插件方法改造为：桥线程上只做参数校验（快路径），执行体交给卸载器，`PluginCall.resolve/reject` 在回调中进行（线程安全，Capacitor 标准异步插件模式）。
2. **并发语义对齐 Web 端**：Web 端 fetch 本就并发，native 桥线程串行是实现缺陷；请求响应顺序不再保证，JS 侧均以 Promise 消费、无顺序依赖；401 刷新已有 Java 侧互斥锁，天然支持并发；OkHttp 自身 dispatcher 承担限流。
3. **settings registry 写门槛可观测**：`phase !== "warm"` 命中丢弃写入时 `console.warn`（模块前缀 + key + 当前 phase），不改"冷态不落盘"语义本身。
4. **E2E 钩子结果契约**：`confirmSwitchClient` 调用后先把 `document.title` 置为 `E2E-HOOK-CALLED`（保持既有标记），`switchClient` 结算后改为 `E2E-SWITCH-OK` 或 `E2E-SWITCH-<REASON>`（REASON ∈ `BUSY` / `WRITE-FAILED` / `TIMEOUT` / `RESTART-FAILED`）。说明页确认按钮的产品行为（遮罩、toast）完全不变。
5. **共享轮询工具**：契约工具层新增 `pollPrefs(serial, predicate, timeoutMs)`：按间隔轮询读取真实 prefs 直到谓词满足或超时（超时抛出并附最后一次快照）。roundtrip 的单读断言点、settings-sync-contract 的两个单读断言点全部改为轮询。
6. **导航 DOM 契约刷新**：`/home → /settings` 统一为点击 SideNavShell 的设置按钮（aria-label「设置」，首页直达设置页，无需 /me 中转）；oneway / roundtrip / 3x 三份 spec 的顺序导航统一抽取为共享 helper（WebView 内 `clickByText` / aria 点击已在用例内重复三份，顺手收敛）。
7. **AVD pin**：`switch-client-roundtrip-low` 与 `fab-hit-testing-regression` 一致化：默认 AVD 解析为 `pictelio_low`，运行时非该设备则整文件 `skip`（skip 消息说明需要的目标设备）。
8. **Lynx 登录加固**：登录操作前轮询 logcat 渲染就绪信号（`onPageChanged|OnPatchFinishForFiber`，与 lynx-boot-renders 同口径，超时独立配置）；输入完成后用 uiautomator dump 校验输入框内容（dump 不可用时记 warn 不静默）；保留失败证据收集。
9. **README 补文档**：`ANDROID_E2E_BUILD_MODE=e2e`（哪些用例依赖 E2E 钩子）、AVD 选择规则（默认值 / 哪些 spec 需要哪台设备）、常见"钩子缺失"误读。

## Testing Decisions

- **只测外部行为**：卸载器测三性质——提交后调用线程立即返回、任务在工作线程完成、任务抛异常转为失败回调——不测线程池实现细节；先例：`LynxRuntimeInitializerTest`（Robolectric，testFull source set）与 InitGate 状态机测法。
- **warn 与钩子契约**：registry 冷态丢写的 warn 用现有 store/settings 单测约定（vi spy console.warn + 断言值未持久化）；钩子 title 契约用 routes 层组件测试约定（挂载说明页 → 调钩子 → flush 微任务 → 断言 title 序列）；oracle 来源 = 本 spec 决策 4 的契约字面量。
- **pollPrefs 纯函数单测**：注入 fake 读取函数返回预设序列（超时不满足 / 第 N 次满足两分支）；oracle = 独立构造的序列，非实现反推。
- **E2E 验收（真门禁）**：`ANDROID_E2E_BUILD_MODE=e2e` 下引擎切换线 6 spec 全量——pictelio_ui（oneway / roundtrip / 3x / settings-sync-contract / smoke 等）+ `ANDROID_E2E_AVD=pictelio_low`（roundtrip-low / fab / webview-only-upgrade）；期望 10 failed → 0 failed（skip 数不增加）。
- **回归底线**：app + lynx 全量单测、类型检查、lint 全绿（工程门禁）。

## Out of Scope

- `PixivApiCore` 改 OkHttp 全异步（enqueue 化）——插件边界卸载已解除桥阻塞，核心异步化另行立项。
- AuthPlugin / NetDiagPlugin / WebDavPlugin / GallerySaverPlugin 等低频阻塞方法的线程卸载——做一次审计记录，按需另立。
- Lynx a11y 树暴露修复 / Lynx 侧完整 UI 自动化（SDK 限制，见 roundtrip spec 头注释）。
- `switchClient` 5s 超时调参（治标，ADR-0159 已否决）。
- `loggingBehavior` 调整、iOS、webview/lynx 单引擎 flavor 变更。

## Further Notes

- 失败轮实证与根因证据链（CDP 探针数据、二分复现记录、失败轮日志行号）见 ADR-0159 背景节，不再重复。
- 桥线程阻塞潜伏约两个月的教训：契约层全绿 ≠ UI 路径健康——「契约层绕过桥」正是它测不出此缺陷的原因，UI 路径用例不可删。
- 模拟器验收时的已知环境项：`PIXIV_REFRESH_TOKEN` 由 `packages/app/.env` 提供；两台 AVD（pictelio_ui=5556 / pictelio_low=5554）需在线；`ensureEmulator` 在已在线设备非目标 AVD 时直接抛错。
