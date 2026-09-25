# 术语表：工具链回归战役（ADR-0185 / ADR-0186）

> 本表统一 vite-plus 升级回归战役中的术语，防跨文档漂移。权威源 = ADR-0185/0186。

## 加载门槛（isLoading Gate）

`packages/app/src/routes/__root.tsx` 中 `<Show when={!isLoading()}>` 包裹的全屏 LoadingSpinner 层。`isLoading` 在「initializeAuth + hydrated（settings 水合 + 屏蔽/举报/图片源偏好）+ loadAccountR18」全部完成后释放。该门槛悬挂时路由内容永不渲染，且 Splash 因 `markContentReady` 永不触发而永挂。

## Splash 永挂（Splash Hang）

原生 Splash 永不退出的表象。两种成因在本战役中均实证：
1. **加载门槛悬挂**（P1，存量）：isLoading 不释放 → HomePage.onMount 不执行 → markContentReady 不触发；
2. **设备代理缺失**（P3，环境）：启动链上网络请求黑洞化 → 同上。

判别：CDP 读 `location.pathname`——若已到达 /home 而画面仍 Splash/加载层，即门槛悬挂；若停在 /login 且桥零流量，查代理与点击事件。

## 桥级登录管线（Bridge-level Login Pipeline）

`handleSubmit` 触发后的 androidBridge 流量序列（成功判据）：
`AuthPlugin.refreshToken → PixivApi.setAccessToken → PixivApi.addListener → App.addListener → SecureStorage.internalSetItem → PixivApi.syncToken → Preferences.get×4 → Preferences.remove×2`。
最后两项 remove 为 `loadAccountR18` 的孤儿键清理（age_confirmed / is_adult）——它们的出现在即证明 `loadAccountR18` 已跑完，其后只有 `navigate("/home")`。

## bundle A/B 对照法（Bundle A/B Swap）

把「升级回归」与「存量/环境」切干净的标准实验：
1. `git worktree add /tmp/xx <旧基线>` → pnpm install → 旧链构建 dist；
2. 整目录替换 `packages/app/android/app/src/main/assets/public` → `gradlew assembleDebug`（增量 <1min）→ `adb install -r -d`；
3. 同设备、同 token 状态、同交互协议逐场景对比；完毕恢复新 bundle 产物。
判据：新旧症状一致 = 存量/环境；不一致 = 升级回归。

## CDP 取证通道（CDP Forensics Channel）

WebView 引擎的运行时取证：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` 后经 DevTools 协议 `Runtime.evaluate` 直调桥方法计时、`Page.addScriptToEvaluateOnNewDocument` 启动插桩。
坑：`Capacitor.Plugins.X` 每次访问返回新包装对象，替换其方法不可靠；必须 hook `window.androidBridge.postMessage` 本体（消息字段为 `data.pluginId`）。`fluent-*` 自定义元素上 `document.querySelectorAll` 大小写不敏感，但元素可能位于 shadow root 内需逐层下探。

## 设备代理（Device Proxy）

模拟器 E2E 的前置条件：`adb shell settings put global http_proxy 10.0.2.2:7897`（10.0.2.2 = 宿主回环别名）。缺失时 OAuth（oauth.secure.pixiv.net）与 GitHub（raw.githubusercontent.com）直连黑洞，表象含 Splash 永挂 / 登录超时。宿主 10808 已死，7897 为当前活跃代理。

## token 轮换互踩（Refresh Token Rotation War）

Pixiv 的 refresh_token 在每次成功 refresh 后轮换。多套件/多进程并发消费同一份 `.env` token 时，先成功者使后者 400（invalid_grant）→ 登录 gate 大面积 skip。判据：host 直调 OAuth 实测 200 而套件内 400。缓解：串行跑登录类套件；发现轮换立即回填 `.env`。

## Flight 持有 → 事务停摆（机制仍成立；#722 的早期归因已被取代）

**机制（仍成立，供 #722 第二必要项引用）**：在路由 transition 的 flush 作用域内创建的
promise 会被该 transition 作为 flight 持有；promise 永不 settle（或长期悬挂）时 transition
park，同事务内的信号写入不提交。

**#722 归因（已被取代）**：排查期曾把根因定位为「原生图片回调缺席导致 flight 永挂」；
最终确证的第一必要项是 pending 查询异步读 park（见「NotReadyError park」节），第二必要项
正是本节机制（`useFeedActivation` 的 ensure 延迟到宏任务，隔离实测见 spec §4.4）。
`withNativeImageTimeout` 作为独立防御保留（消除「桥调用永不 settle」类威胁）。

已知边界（withNativeImageTimeout 的唯一限制）：超时拒绝后调用方重试时，Java 侧同 URL 的
在途下载无取消通道（JS→native 无取消契约，ADR-0143 未覆盖）——弱网下可能出现同 URL 并发
重复下载，仅浪费带宽不影响正确性；图片下载本体在 Java 侧有独立 connect/call 超时兜底。


## e2e-start 打点与 __pictelioDebug 探针

- `__root.tsx` 启动链逐级 `[e2e-start]` 标记（E2E_ON 门控）：IIFE / registerBackGesture / hydrateAll / initializeAuth / loadAccountR18 / navigate / setIsLoading——缺失的标记即悬挂点。
- `window.__pictelioDebug`（e2e 构建专属）：`isLoading()` / `isLoggedIn()` 读写探针、`selfTest()` Solid 信号写读自检、`release()` / `flushNow()` 手动干预。
- 用法：CDP `Runtime.evaluate` 读取；生产构建 `__E2E__` define 替换为 false 后整块 DCE 消除。

## NotReadyError park（#722 最终根因）

Solid 2.0-rc.9 + solid-query v6：pending 查询的 `data` 是异步访问器，渲染期读取抛
`NotReadyError` 并把所在路由 transition 置入 park 等待该 flight；fetch 在弱网下悬挂/失败时
rc.9 的 park 唤醒路径不覆盖该形态 → transition 永久 park → 同事务内全局信号写入（含
isLoading 门槛）永不提交（探针：`latest`=目标值 / `isPending`=true / committed 恒旧值）。
修复 = 查询注册 `placeholderData`（空页占位）使 data 首读即定义。判别：冻结态
`__pictelioDebug.latestIsLoading()` 与 `isLoading()` 不一致 + NotReadyError 调用栈在
solid-query chunk。
