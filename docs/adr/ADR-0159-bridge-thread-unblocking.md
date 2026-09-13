# ADR-0159: 插件桥线程卸载与引擎切换线 E2E 契约修复

- 状态：accepted
- 日期：2026-09-13
- 关联：ADR-0061（Android 模拟器 E2E 门禁）、ADR-0062（单引擎包隐藏切换 UI）、ADR-0064（引擎切换体验修复）、ADR-0103（跨 client 设置同步）、ADR-0153（引擎可用性判定与降级）、`docs/android-e2e-engine-switch-known-failures.md`（失败移交记录）、`docs/adr/glossary-client-switch.md`（新增词条：插件桥线程 / 桥线程阻塞 / 契约层 / UI 路径 / E2E 钩子 / DOM 契约 / 渲染就绪信号）

## 背景

`docs/android-e2e-engine-switch-known-failures.md` 记录了双引擎切换线 10 条 Android E2E 失败（6 spec 中 10 failed / 21 passed / 5 skipped）。经实弹诊断（CDP 探针 + 模拟器二分复现 + 失败轮日志比对），根因收敛为**两类四个**：

### 根因 1（产品缺陷，#2/#4 与 #10 的共同根因）：插件桥线程被同步网络 I/O 阻塞

Capacitor Android `Bridge` 用**单个** `HandlerThread`（`taskHandler = new Handler(handlerThread.getLooper())`）串行执行**所有** `@PluginMethod`。而 `PixivApiPlugin.request()` 与 `prefetchImage()` 在方法体内**同步**执行 OkHttp `execute()` 网络调用（超时上限 connect 15s + read 30s，单请求最坏阻塞桥线程 45s）。

后果链：登录后 Feed 连发 API 请求与图片预取 → 桥线程被长期占用 → `switchClient` 的 `Preferences.set`（以及 settings registry 的 `hydrateAll` 全部 `get`）在原生队列排队 → JS 侧 5s 写入超时误判（`{ok:false, reason:"timeout"}`）→ pref 永不落盘、应用不重启。

**实弹证据**（2026-09-13，emulator-5556，失败轮同款 e2e 构建 APK）：

- CDP 直连调用 `Preferences.set`：16ms 落盘（桥本身健康）；
- 走 UI 路径（登录 → 设置页 → `/client-switch` → 钩子）首次调用：遮罩转 4s 后消失（5s 超时）、pref 30s 内持续为 null——复现失败；
- **失败现场原地重试同一钩子：1s 内落盘成功并重启进 LynxActivity**——证明是「调用时刻队列被占用」而非链路断裂。

该根因同时解释 #10 的两轮不一致：登录时刻的迁移播种能落盘（Feed 未启动、队列空），设置页内的 toggle 写入被排队（且 `hydrateAll` 被阻塞 → 写门槛恒冷 → 静默丢写）。

### 根因 2（测试缺陷，#1 及 #3/#5/#6/#7/#8 的共同前置）：首页 DOM 契约腐化

`a5e2c27c`（首页 C 框架 + L5 固定布局折入，ADR-0075）删除了 HomePage 上可点击的 `<h1>`（onClick → `/me`），换成 `SideNavShell` 的纯展示 Tab 标题。`switch-client-oneway` 仍按旧契约 `document.querySelector("h1").click()` 导航 → 点击无 handler、URL 停在 `/home`。与排行榜改动无关（pre-rank 旧构建同样复现），也与 SolidJS 2 运行时无关（登录 → `/home` 的 `navigate()` 同构建正常）。

### 根因 3（测试缺陷，#9）：用例跑错设备

`switch-client-roundtrip-low` 依赖 `ANDROID_E2E_AVD=pictelio_low` 环境变量，但 spec 本身无 AVD pin/guard；失败轮日志显示自动选择落在 `pictelio_ui`（WebView 113 ≥ 85）——**在该设备上不降级是 ADR-0153 的正确行为**。实测 `pictelio_low`（WebView 66）上「写 webview → 重启 → 自动降级进 LynxActivity」正常。

### 根因 4（测试基建，fab spec 连带跳过）：Lynx 侧登录盲操作链

`fab-hit-testing-regression` 的 beforeAll 以「固定 sleep 4s + uiautomator 定位失败静默回退固定坐标 + 单发无逐步校验」登录 Lynx；android-28 慢渲染（帧耗时 0.7~3s）下 4s 内登录页未就绪，全链失效且无报错，60s 登录超时。

## 决策

1. **网络 I/O 一律移出插件桥线程**：`PixivApiPlugin.request()` 与 `prefetchImage()` 的阻塞执行体改为提交到**插件自有的网络执行器**（cached thread pool），参数校验留在桥线程（快路径），`PluginCall.resolve/reject` 在工作线程回调（Capacitor 标准异步插件模式，`PluginCall` 线程安全）。并发语义与 Web 端 `fetch` 对齐（Web 端本就并发，native 串行是实现缺陷而非契约）；401 刷新已有 `synchronized` 锁，天然支持并发。卸载语义抽为可单测的小类（深模块），以 Robolectric 单测锁定「提交即返回、回调在工作线程、异常映射 reject」三性质。
2. **静默路径必须可观测（落实测试硬约束 3）**：settings registry 写门槛冷态丢弃写入时 `console.warn`（带 key 与 phase）；E2E 钩子调用后经 `document.title` 回传切换结果（`E2E-HOOK-CALLED` → `E2E-SWITCH-OK` / `E2E-SWITCH-BUSY|WRITE-FAILED|TIMEOUT|RESTART-FAILED`），产品 UI 行为（遮罩、toast）不变。
3. **E2E 用例绑定语义化 aria-label，不绑定标签结构**：`/home → /settings` 导航统一改点 SideNavShell 的 `[aria-label='设置']`（设置页可达不经过 `/me` 中转）；删除 `h1.click` 等位置性选择器。
4. **落盘断言一律轮询**：新增共享轮询工具（`pollPrefs`），所有 SharedPreferences 落盘断言（含 roundtrip 的单读点、settings-sync-contract 的 2.5s 单读点）改为带超时轮询；写入是 `editor.apply()` 异步链，单次直读天然竞态。
5. **设备条件用例必须 pin AVD**：`switch-client-roundtrip-low` 与 `fab-hit-testing-regression` 默认 AVD pin 为 `pictelio_low` 并在非目标设备上显式 skip（与 fab spec 既有做法一致）；README 补充 `ANDROID_E2E_BUILD_MODE=e2e` 与 AVD 选择说明。
6. **Lynx 侧登录必须等渲染就绪信号再操作**：`fab-hit-testing-regression` 登录前轮询 logcat `onPageChanged|OnPatchFinishForFiber`（与 `lynx-boot-renders` 同口径），逐步校验输入是否入框，去除裸 sleep 依赖。

## 被考虑的方案

- **switchClient 写超时从 5s 调大**：治标——写入本身最终也不会完成（队列以分钟计阻塞），且掩盖产品缺陷；否决。
- **`PixivApiCore` 改 OkHttp `enqueue` 全异步**：改动面覆盖全部调用方（含图片拦截链路），行为等价性验证成本高；本决策仅在插件边界卸载线程，核心保持同步签名；否决（可作为后续优化）。
- **E2E 全部走契约层、删除 UI 路径用例**：契约层绕过桥，永远测不出桥线程阻塞这类集成缺陷——正是本次 #2/#4 潜伏两个月的教训；否决。
- **把 oneway 导航改为 pushState 直跳**：绕过 UI 的导航验证价值为零，且 `history.pushState` 不触发真实用户可达性验证；用 aria-label 直达兼顾真实性与稳定性。
- **registry 冷态写入改为自动等待 warm 再落盘**：引入隐式排队语义，冷态写本应是异常路径（hydrate 未完成即写说明调用时序有误）；显式 warn + 上层修正调用时序更符合「禁止静默降级」；否决。
- **`switch-client-roundtrip-low` 保持环境变量约定**：已被证明必然被遗忘（失败轮即忘设）；pin + skip 落在代码里才可执行。

## 后果

**正面**：切换/设置写入不再被 Feed 流量饿死（#2/#4/#10 根治）；E2E 与真实用户路径重新对齐（#1/#3/#5–#8 前置解除）；设备条件用例不再静默跑错设备（#9）；失败可见性达标（硬约束 3）。

**负面 / 代价**：插件并发度上升——OkHttp 默认 dispatcher（每 host 5 并发）内部排队，峰值内存略增（响应体为 JSON 文本，量级可忽略）；`request` 响应顺序不再保证（JS 侧均以 Promise 消费，无顺序依赖）；Java 侧新增一个执行器生命周期管理点（随插件进程存活，无需关闭）；E2E spec 一次性大改，旧选择器知识作废。
