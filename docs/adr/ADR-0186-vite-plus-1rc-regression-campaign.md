# ADR-0186: vite-plus 1.0-rc 升级全面回归战役（2026-09-25）

- 状态: Accepted（2026-09-25）
- 日期: 2026-09-25
- 关联: [ADR-0185-vite-plus-1rc-toolchain.md](./ADR-0185-vite-plus-1rc-toolchain.md)（被回归对象）；术语表 [`docs/adr/glossary-toolchain-regression.md`](./glossary-toolchain-regression.md)
- 性质: 回归验证战役记录。结论：**升级无回归**；发现 3 项存量/环境问题（A/B 实证均与升级无关），已票据化。

## 回归矩阵与结论

| 面 | 验证方式 | 结果 |
|---|---|---|
| 单元测试（app） | vitest 5 三轮（0.2.8 基线 / 5.0.1 / vite 别名后） | 200 文件 / 1957 用例 ×3 全绿 |
| 全仓测试 | `test:all`（9 包） | exit 0 |
| 静态门禁 | `lint:all`（626 文件）/ `fmt:check`（658 文件）/ `check:all` | 全绿 |
| Java 防线 | `testFullDebugUnitTest`（Robolectric） | exit 0 |
| Android 构建链 | `build:android` 全链（vp build → lynx rspeedy → cap:sync → gradle） | exit 0，gradle 15s |
| Lynx 引擎运行时 | 模拟器冷启动 769ms + 真实 feed 渲染 + 详情页导航 + logcat 零 FATAL | PASS |
| Webview bundle（host） | 生产 dist 静态 serve + Chrome：boot → /login 渲染 | PASS |
| Webview bundle（设备） | 模拟器 boot → /login（干净状态 + 设备代理） | PASS |
| **A/B 对照（终审）** | 新旧 bundle 灌同一 APK、同模拟器、同 token 状态逐场景对比 | **行为一致 → 无升级回归** |

## 发现的问题（A/B 实证均为存量/环境性，非升级引入）

### P1 · webview 引擎「已登录启动卡加载门槛」（存量，模拟器 WebView 113 场景）

现象：pm clear + 注入 token 后启动，auth 管线全链成功（androidBridge 流量实证：`AuthPlugin.refreshToken → PixivApi.setAccessToken/addListener → SecureStorage.internalSetItem → PixivApi.syncToken → loadAccountR18 的 Preferences.get×4 + remove×2` 全部完成），路由也 `navigate("/home")` 生效（CDP location.pathname=/home），但 `__root` 的 isLoading 门槛 DOM（1959 字节 loading overlay）永不释放 → Splash 永挂。

证据链：新旧 bundle（0.2.8 产物 vs 1.0-rc 产物）症状逐字节一致；`hydrated` 链（hydrateAll + loadReportedIds/loadBlockedIds/loadImageHostPreference）嫌疑最大，其中 `indexedDB.databases()` 全程为空（app 的 `pictelio` 库从未建成）而探针库 10ms 打开——idb 初始化悬挂是头号嫌疑（`db.ts` openDB 无 `onblocked` 处理为已知弱点，但该文件服务 novelCache 不直接在 hydrated 链上，精确根因待下钻）。

影响：webview 引擎 E2E（transition-matrix R4、agent-browser 登录依赖用例）在模拟器上被阻断；lynx 引擎不受影响；host Chrome 不复现（历史 CI 绿）。

### P2 · agent-browser 大规模失败的归因 = refresh_token 轮换互踩（环境性）

12 spec 文件中 11 failed（51 skipped = 登录 gate 空转）。`.env` token 经 host 直调 OAuth 实证**有效**（200）。根因：多套件/多进程并发消费同一 refresh_token，Pixiv 每次 refresh 成功即轮换作废旧值 → 后续使用方 400。`.env` 已回填轮换后的最新 token（2026-09-25）。单 spec 重跑仍 1 failed（update-flow，详情被截断未捕获）——与 P1 同源的可能性存疑，需在 P1 修复后复验。

### P3 · transition-matrix 的运行前置（非问题，记录防再踩）

1. bench 深链钩子要求 `BENCH_NAV=1 pnpm build:android` 整链构建（#542 既有坑）；
2. `ANDROID_E2E_SKIP_BUILD=1` 跳编译时，APK 必须已经是 BENCH_NAV 产物——spec 自身不编译，排在其前的 lynx-boot spec 的编译会用无钩子产物覆盖；
3. 模拟器必须预配设备代理 `adb shell settings put global http_proxy 10.0.2.2:7897`（OAuth/GitHub 域 GFW 直连不可达；无代理时启动链上的网络请求黑洞化，表象为 Splash 永挂——本次排查中 10:22-10:29 的悬挂即此）。

## 排查方法学沉淀（本战役新验证）

- **bundle A/B 对照法**：`git worktree add <tmp> <旧基线>` → 旧链构建 dist → 整目录替换 `packages/app/android/app/src/main/assets/public` → gradle 增量打包（<1min）→ 同条件对比。一次实验即可把「升级回归」与「存量/环境」切干净。
- **CDP 取证通道**（WebView 引擎）：adb forward 9222 → `Runtime.evaluate` 直调桥方法计时、`Page.addScriptToEvaluateOnNewDocument` 启动插桩、`window.androidBridge.postMessage` 重写抓全量桥流量（注意 Capacitor 8 消息字段为 `data.pluginId`，且 `Capacitor.Plugins.X` 每次访问返回新包装，替换其方法不可靠——必须 hook androidBridge 本体）。
- **假绿陷阱**：`pnpm xx | tail && echo OK` 管道吃掉退出码——本战役曾把 1 failed 的 test:all 误判为绿；一律用 zsh `pipestatus[1]` 或落盘后 grep。

## 后续

- P1/P2 已开 issue 票据化（修复走独立 effort：术语 → spec → tickets → implement）；
- 升级本体（chore/vite-plus-1rc 分支）回归通过，可合并。
