# FT-2 冷启动分段诊断（#365 / 地图 #361）

- 分支：`fix/ri-365-coldstart`；日期 2026-09-05；环境 emulator-5554（pictelio_ui，Android 14，WebView 113.0.5672.136），debug APK versionName 4.32.0
- 方法：force-stop → logcat -c → screenrecord（VFR，`analyze_rec.py` 逐帧）→ `am start -W -n io.pictelio.app/.MainActivityWebview` → logcat -d；录屏 t≈1.2s 处发出 am start，与 logcat 时刻线性对齐
- 证据：`ri-365-evidence/diag/`（ft2_diag.mp4/json、logcat.txt、amstart.txt）

## 双口径结论（重要）

| 口径 | WaitTime | 静止 splash 段 | 说明 |
|---|---|---|---|
| **暖缓存冷启**（force-stop，OS 页缓存热） | **1782ms** | **~1.65s**（录屏 1421→3072ms） | 本轮实测 1 rep |
| **冷缓存冷启**（重装/更新后，OS 页缓存冷） | **6098ms** | **~6.0s** | 体检 #362 场景 1 口径 |

「6 秒静止」是**最坏情况口径**（重装/更新后 dex 与页缓存全冷）；常规 force-stop 冷启 ~1.8s。两种口径共享同一**结构性问题**：启动窗口 splash 从头静止到 WebView 首帧，全程零进度反馈，然后内容突现。

## 分段时间线（暖缓存口径，相对 am start）

| 段 | 时刻 | 内容 | 可优化性 |
|---|---|---|---|
| S1 进程+WebView 引擎初始化 | +0 → ~+0.40s | `Start proc` → `WebViewFactory: Loading com.google.android.webview 113`（nativeloader/dex） | 原生硬地板，基本不可压缩 |
| S2 Bridge+插件注册 | ~+0.40 → +0.46s | `Capacitor: Starting BridgeActivity` → 13 个插件注册 | 极小 |
| S3 **JS bootstrap（主控段）** | ~+0.52 → ~+1.87s（**~1.35s**） | JS 开始执行（首个 Console +0.52s）→ **134 条 Capacitor/Console 日志**（settings/Preferences 逐项读取 `{"value":null}`，Line 333/349）→ auth 恢复/数据预取，全部藏在静止 splash 后 | **可压缩**：日志每条都是桥 IPC；启动编排若串行 await 可并行/延后 |
| S4 首帧（chrome 突现） | ~+1.87s | 录屏 diff 3→50 突发（侧导航/标题/搜索首现），随后首图 +2.04s | chrome→首图 ~180ms 空白（体检口径），骨架 shimmer 未可辨 |

冷缓存口径下 S1+S3 等比放大（dex 冷读/页缓存缺失主导）到 ~6s。

## 结构性发现

1. **SplashScreen 插件未配置**：`capacitor.config.ts` 无 `plugins.SplashScreen`，logcat 注册插件清单中亦无 SplashScreen——当前静止画面是系统启动窗口（`Theme.SplashScreen`：白底+静态 launcher 图标，styles.xml:19-22），持续到 Activity 首帧（=WebView 首帧内容）才消失，中途无任何动画/进度。
2. **启动期日志刷屏**：134 条 `Capacitor/Console`（Line 349 `[object Object]` / Line 333 `{"value":null}`）横跨整个 S3——既是 P6 日志卫生问题（体检报告已记 logcat 明文 token 风险），每条又是一次桥 IPC，直接拖慢 bootstrap。
3. **safe area 注入报错**：首个 Console 即 `Error injecting safe area CSS: TypeError: Cannot read properties of null (reading 'style')`（Line 6）——启动路径上的现存 bug（降级无害但属启动噪音）。
4. 首屏 chrome 出现时内容区空白（~180ms 后首图），Feed 骨架 shimmer 在冷启动路径不可辨（体检场景 1 与本轮录屏一致）。

## 修复方向（交实现会话）

- **P-1 给 splash 期可见进展**：接入 `@capacitor/splash-screen`（或验证包已在依赖中）配置 `showSpinner`（spinnerColor 用品牌色、深浅色适配）；或原生启动主题加 indeterminate 进度。目标：静止段最长 <1s（判定线）。
- **P-2 压缩 S3**：启动路径 console 日志 DEV-gate 化（兼顾 P6）；审查 `main.tsx`/`__root.tsx` 启动编排中可延后至首帧之后的串行步骤（不得破坏年龄确认/登录恢复语义）。
- **P-3 修 safe area 注入报错**（Line 6 null style）。
- **P-4 补首屏骨架 shimmer 可见性**（chrome→首图空白段）。
- 验收判定线：录屏最长完全静止段 **<1s**（基线 1.65s 暖 / 6.0s 冷）；`am start -W` WaitTime 不劣化（暖基线 1782ms ±10%）；debug 口径标注。
