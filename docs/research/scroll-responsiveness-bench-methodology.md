# 双端滚动跟手性基准方法学（Lynx vs webview 同机同内容测量）

> 调研日期：2026-09-01（Lynx 4.0.1 / vue-lynx 0.5.1；Lynx 源码 lynx-family/lynx@develop；AOSP frameworks/base@main 源码核实）
> 关联：wayfinder 地图 #304 / 研究票 #305；术语对齐 `packages/app-lynx/CONTEXT.md`「滚动跟手性」（2026-09-01）
> 结论速览：**LynxView 与 WebView 都走 Android HWUI 窗口渲染管线，`adb shell dumpsys gfxinfo <pkg> framestats` 对双端同源有效，可作为双端同法测量的底座（零代码改动、零侵入）；「触摸 → 首帧响应」时延需要 UiAutomation 注入（自带 eventTime）与 framestats 做同时钟域（`SYSTEM_TIME_MONOTONIC`）对齐，`adb shell input swipe` 单独不足以支撑毫秒级时延测量；webview 侧 CDP 复用 `bench-cdp.mjs` 的连接/注入/logcat 骨架做页面内插桩与归因；240fps 慢动作录屏作为 ground-truth 校验兜底。推荐三层组合：T0 = gfxinfo+input swipe 快速基线，T1 = UiAutomation+framestats 精确时延（主指标），T2 = Perfetto / 慢动作校验 + CDP/Lynx Trace 归因。**

---

## 1. 问题与结论摘要

主指标 = **触摸响应延迟**（手指位移 → 内容位移时延）；辅指标 = 帧跟随一致性（jank 帧比例 / 帧时长分布）、惯性滚动曲线自然度。决策范围（按 CONTEXT.md 术语条）：RefreshableList 系列表（插画/小说 tab）与小说详情正文滚动。

| # | 问题 | 结论 |
|---|------|------|
| 1 | `gfxinfo framestats` 是否覆盖 LynxView？ | **覆盖。** Lynx Android 渲染管线是原生 View 体系：`LynxView extends UIBodyView`（ViewGroup），`<scroll-view>` 映射 `NestedScrollView`/`AndroidScrollView`，`<list>` 是原生回收列表 ViewGroup（`UIList`/`ListLayoutManager`）。自绘渲染器（custom renderer）官方尚未开源交付（"are yet to come"），当前 4.0.1 移动端走平台原生渲染。所有帧经 ViewRootImpl/Choreographer/HWUI → framestats 完整记录 |
| 1b | 是否需要 Java 侧 FrameMetrics 桥？ | **非必需，可选增强。** framestats 已含逐帧全部时间戳；桥（`Window.addOnFrameMetricsAvailableListener`，API 24+）价值仅在突破 dumpsys 的 ~120 帧窗口与实时性。**越界判定：属只读观察者 tooling，不构成「原生介入滚动链路」**（不触碰滚动/渲染路径），但必须 `BuildConfig.DEBUG` 门控、不进 release，本报告显式标注该例外 |
| 1c | logcat 帧标记方案？ | **可行但非首选。** 双端 JS 日志都可达 logcat（webview 经 chromium console 转发；lynx 经已集成的 `lynx-service-log`），适合回传「页面内插桩」结果；不适合做帧级时间戳源（logcat 自身时延不可控） |
| 2 | webview 对照采集？ | gfxinfo 同法适用（WebView 硬件加速绘制挂在 app 窗口 HWUI 帧内）；**注意 chromium 合成器 caveat**（见 §3.2）→ 补充页面内插桩（touchmove `timeStamp` + rAF），复用 `bench-cdp.mjs` 的 CDP 骨架注入与回收 |
| 3 | 触摸注入时间戳精度？ | `input swipe` 事件时间不可知、shell 进程注入有抖动 → **不能单独支撑时延测量**，只用于「双端同手势」驱动与 jank 基线；精确时延用 `UiAutomation.injectInputEvent()`（自建 MotionEvent，eventTime 已知，与 framestats 同 `CLOCK_MONOTONIC` 域）；240fps 慢动作录屏兜底（±4.2ms 分辨率，配合开发者选项「显示点按」做帧计数判读） |
| 4 | bench 流程？ | fixture（推荐接口快照 + 双端 mock 注入 + 磁盘图片缓存预热）→ 预热 2 往返丢弃 → 每端每路径 30 手势（3×10，ABBA 交替消漂移）→ 中位数 + P90 对比。详见 §5 |

---

## 2. LynxView 帧指标可采集性

### 2.1 渲染管线事实（决定 gfxinfo 是否有效）

上游源码核实（lynx-family/lynx@develop，`platform/android/`）：

- `LynxView.java`：`public class LynxView extends UIBodyView …`，类 doc 自述 "Similar to WebView in native developing"。重写 `onMeasure`/`onLayout`/`dispatchDraw`/`dispatchTouchEvent`，是标准 Android ViewGroup 容器。渲染委托 `ILynxUIRenderer`，**默认路径建真实 Android View**（`findViewByName` 返回 `android.view.View`）；自绘的 PlatformRenderer/fragment-layer 模式存在但非默认。
- `behavior/ui/scroll/`：`<scroll-view>` → `LynxUIScrollView`（内含 `NestedScrollView` / `AndroidScrollView` 原生滚动容器）。
- `behavior/ui/list/`：`<list>` → `UIList` + `ListLayoutManager` + `ListViewHolder`，原生回收列表 ViewGroup。app-lynx 的 `RefreshableList.vue` 确认包的是 `<list>`，且源码注释明言「`<list>` 不派发 per-frame scroll」「无 JS 可触发的滚动属性」——**滚动完全在原生侧，JS 不在滚动链路上**，这正是 gfxinfo 能完整观测的原因。
- 官方 llms.txt 自述："A unified element abstraction **maps to native views** or custom web elements on different hosts"（`view` → Android `ViewGroup`）；custom renderer 官方博客原话 "are yet to come"（未开源未交付，见 `docs/research/lynx-pure-engine-analysis.md` §6.2）。

**结论：Lynx 4.0.1 在 Android 上的每一帧都经 ViewRootImpl → Choreographer → HWUI/RenderThread → SurfaceFlinger，`dumpsys gfxinfo io.pictelio.app framestats` 与纯原生应用同等覆盖 LynxView 渲染面。**

### 2.2 framestats 数据语义与时钟域（AOSP 源码核实）

`dumpsys gfxinfo <pkg> framestats` 输出最近 ~120 帧的逐帧 CSV。列集随版本演进：**Android 12+ 为 `Flags,FrameTimelineVsyncId,IntendedVsync,Vsync,InputEventId,HandleInputStart,AnimationStart,PerformTraversalsStart,DrawStart,FrameDeadline,FrameInterval,SyncQueued,SyncStart,IssueDrawCommandsStart,SwapBuffers,FrameCompleted,DequeueBufferDuration,QueueBufferDuration,GpuCompleted,SwapBuffersCompleted,DisplayPresentTime`**（AOSP `core/java/android/view/FrameMetrics.java` 的 `Index` 接口 + `libs/hwui/FrameInfo.h` 枚举核实）。

关键性质（`FrameInfo.h` / `FrameMetrics.java` javadoc）：

- **时钟域**：所有时间戳为 `systemTime(SYSTEM_TIME_MONOTONIC)`（纳秒），与 `System.nanoTime()`、`MotionEvent.getEventTimeNanos()`（uptime）**同一时钟**——这是「注入事件时间 ↔ 帧时间戳」直接对齐的依据，无时钟换算误差。
- **输入排队延迟可见**：`HandleInputStart − IntendedVsync`（即 FrameMetrics 公开指标 `UNKNOWN_DELAY_DURATION`）捕获「vsync 到期但 UI 线程忙、输入排队」的延迟——恰是「手指动了内容慢半拍」的 app 侧主嫌疑段。
- **帧健康**：`TOTAL_DURATION`（FrameCompleted−起始） vs `DEADLINE`（FrameMetrics javadoc："`TOTAL_DURATION < DEADLINE` 则无可见 jank"）→ jank 判定有官方语义，DEADLINE 随刷新率自适应（OPPO 90/120Hz 下为 11.1/8.3ms 量级）。
- **端到端上屏**：`FrameCompleted`（app 侧完成）→ `GpuCompleted` → `DisplayPresentTime`（SurfaceFlinger 实际上屏，可得性随 HAL 版本，拿不到时退到 GpuCompleted）。
- **聚合摘要**：`dumpsys gfxinfo <pkg>`（不带 framestats）自带 "Janky frames: X (Y%)" 与 50/90/95/99 分位直方图——快速对比够用。
- **限制**：ring buffer 只留 ~120 帧（120Hz 下 ≈1 秒）→ 单次手势须短（≤0.8s）或滚动结束立即 dump；输出按窗口分段，app 多窗口时须按窗口名过滤（bench 时保证只有目标 Activity 一个前台窗口）。

### 2.3 Java 侧 FrameMetrics 桥（可选 tooling，含越界判定）

`Window.addOnFrameMetricsAvailableListener(OnFrameMetricsAvailableListener, Handler)`（API 24+，`FrameMetrics` API 核实：`TOTAL_DURATION`/`DEADLINE`/`UNKNOWN_DELAY_DURATION`/`INPUT_HANDLING_DURATION` 等 duration 指标 + 全部时间戳）逐帧回调，数据语义与 dumpsys framestats 同源同构。

- **价值**：突破 120 帧窗口；长手势/惯性滚动全程逐帧不落；免解析 CSV。
- **形态**：放 `android/app/src/main/java/io/pictelio/app/`（shared sourceSet，webview/lynx/full 三 flavor 同源生效），Activity 挂载，`BuildConfig.DEBUG` 门控，结果打 logcat tag（如 `PictelioBench`），bench 脚本 `logcat -s PictelioBench` 回收。
- **越界判定（显式标注）**：该桥是**只读观察者**——`FrameMetrics` 回调不读写滚动/渲染路径任何状态，不构成 wayfinder #304 所禁的「原生介入滚动链路」（产品滚动本就全原生，见 §2.1）；但它是原生代码新增，属于**测量 tooling 例外**，约束：debug-only、不进 release 产物、PR 描述中标注 tooling 属性。
- **结论**：T1 层先用「UiAutomation 注入 + dumpsys framestats」零改动方案；只有当惯性滚动全程采集（>120 帧）被证明必需时才加桥。

### 2.4 logcat 帧标记方案

- **可达性**：webview 侧 `console.log` 经 chromium 转发 logcat（tag `chromium`）；lynx 侧已集成 `lynx-service-log`（`org.lynxsdk.lynx:lynx-service-log:4.0.1`，见 openwiki android-native 页 Lynx SDK 依赖节），JS console 直达 logcat。`bench-cdp.mjs` 的 logcat 观察模式（`logcat -d -s <tag>` + 轮询）可直接复用。
- **适用**：回传页面内插桩的聚合结果（如「本次手势 in-page 时延中位数」）。
- **不适用**：逐帧时间戳源——logcat 写盘/读取时延不可控，精度不满足毫秒级测量。

### 2.5 Lynx 自带性能能力的定位（不适用主指标）

- `lynx.performance` / `PerformanceObserver`（官方 Performance API 文档核实）：entry 类型仅 `init`（InitContainer/InitLynxview/InitBackgroundRuntime）、`metric`（FCP/ActualFMP）、`pipeline`（PipelineEntry/LoadBundleEntry）、`resource`（LazyBundle）——**全是启动/渲染管线指标，无滚动逐帧指标**。用途：bench 预热完成判定（等 FCP 后再开测）。
- Lynx Trace（DevTool record trace，官方 Trace 文档核实）：渲染管线/任务调度/事件链/卡顿火焰图——**归因工具**，需 DevTool 桌面端连线，非无头采集。定位：#306 发现 Lynx 侧落后时用它归因。

---

## 3. webview 侧对照采集

### 3.1 gfxinfo 同法适用

Capacitor WebView 硬件加速绘制（chromium 的 software-draw 已废弃，`android_webview/docs/software_draw_deprecated.md` 存在即佐证 HW 是唯一路径），其绘制经 draw functor 挂在 app 窗口的 HWUI 帧内 → **framestats 对 webview flavor 同法有效**，且与 lynx flavor 是同一 `applicationId io.pictelio.app`、同一测量脚本，天然满足「同设备同路径」。

### 3.2 chromium 合成器 caveat（必须显式声明）

framestats 记录的是 **app 进程 UI 线程**视角的帧。WebView 的触摸事件先经 app 侧 `dispatchTouchEvent` 再转发 chromium compositor，**chromium 内部「输入 → 合成器滚动」段对 framestats 不完全可见**——webview 若吃亏在浏览器进程内部排队，framestats 可能低估。缓解：

- 双端对比时把 framestats 作为**共同下限**（同一盲点对两端解释对称——lynx 侧原生滚动没有这一段，所以若 webview framestats 已更差，结论稳健；若 framestats 打平但体感差，需 §3.3 补盲）。
- 补盲手段 = 页面内插桩（§3.3），覆盖「JS 收到 touchmove → 首个反映 scrollTop 变化的 rAF」段。

### 3.3 CDP 复用面（`packages/app/scripts/bench-cdp.mjs`）

现成可复用（源码核实）：adb forward `localabstract:webview_devtools_remote_<pid>` 连接、`/json` target 发现、裸 WebSocket 最小 CDP client、`Runtime.evaluate` 注入、`pm clear`+重启干净基线、logcat 标记轮询。新增能力需求与选型：

| 需求 | 选型 | 说明 |
|------|------|------|
| 页面内触摸→首帧时延 | **Runtime.evaluate 注入插桩**（推荐） | 单行脚本挂 `touchmove` 监听记录 `e.timeStamp`（Chrome 中为事件 monotonic 时刻）+ rAF 轮询 scrollTop 首变帧的 rAF 时间戳（同 DOMHighResTimeStamp 时原点）→ 差值即 in-page 时延；结果 `console.log` 聚合 → logcat 回收（`logcat -s chromium`） |
| chromium 输入管线分解 | CDP `Tracing.start`（categories `input,latencyInfo,benchmark`） | 拿 EventLatency/InputLatency 分解（browser→renderer→present）；重，仅归因用 |
| 手势注入 | **不用 CDP `Input.dispatchTouchEvent`** | 双端一致性硬约束：注入路径必须同源（adb/uiautomator 系统级注入），CDP 注入只在 webview 存在，会破坏「同路径」 |

**注意**：`bench-cdp.mjs` 的 `mock fetch` 模式（注入固定 version.json 响应）可直接移植为 **feed fixture 注入**——webview 侧把推荐接口响应 mock 成固定快照，与 lynx 侧 fixture 对齐内容（见 §5.1）。

---

## 4. 触摸注入与时间对齐

### 4.1 注入方案分级

| 方案 | 事件时间可知性 | 精度 | 双端一致性 | 结论 |
|------|---------------|------|-----------|------|
| `adb shell input swipe x1 y1 x2 y2 duration` | ❌ 事件时间由 shell 进程注入时生成，外部不可知；shell 调度抖动数 ms~十几 ms | 不足以做时延测量 | ✅ 两端同一命令 | **T0**：只用于驱动「双端同手势」+ framestats jank 基线（jank 不依赖外部事件时间） |
| **UiAutomation `injectInputEvent()`**（uiautomator2 / instrumentation runner） | ✅ 自建 `MotionEvent.obtain(downTime, eventTime, …)`，eventTime 自主设定并记录 | 事件时间精确到注入点（ms 级），与 framestats 同 `CLOCK_MONOTONIC` 域 | ✅ 系统级注入，两端同路径 | **T1 主方案**：逐事件 `eventTime → framestats DisplayPresentTime/GpuCompleted` 直接得「触摸→上屏」时延 |
| 真手指 + `getevent` | ✅ 内核 evdev 时间戳 | 最高但需 root 读 /dev/input | — | 不做（设备未 root） |

T1 注入器形态：轻量 androidx.test/uiautomator 测试工程（或 uiautomator2 shell），脚本化「按下 → N 个 move（固定步距/步频）→ 抬起」，每事件记录 eventTime 序列写文件/logcat；bench 脚本事后用 `InputEventId`/时间窗与 framestats 行对齐。framestats 的 `InputEventId` 列可与注入事件 id 关联（FrameInfo.h 核实该列存在），时间窗对齐为兜底。

### 4.2 「adb input swipe / uiautomator 能否支撑触摸→首帧时延」——直接回答

- `adb shell input swipe`：**不能单独支撑**（事件时间不可知）。配合 framestats 可测「输入开始处理 → 上屏」（HandleInputStart→DisplayPresentTime）与排队段（UNKNOWN_DELAY），缺「手指实际动 → app 开始处理」的前段。
- uiautomator（`UiAutomation.injectInputEvent`）：**能**。eventTime 已知 + framestats 同时钟域 → 全链路时延可算；残余盲点是「injectInputEvent 调用点 → InputFlinger 派发」的系统内段（通常 <5ms），由 §4.3 兜底校验。
- Perfetto（补充选项）：`android.input` + `android.surfaceflinger.frametimeline` 数据源给出系统级 input→present 时间线，**零 app 改动、对 input swipe 也有效**；需 Android 12+（frametimeline），OPPO 真机须先确认版本；trace 解析成本中等。定位为 T1 的交叉验证而非主力。

### 4.3 240fps 慢动作录屏兜底（ground truth）

- **方法**：另一部手机的 240fps 慢动作模式拍摄被测机屏幕；被测机开开发者选项「显示点按（Show taps）」——触摸位置出现白点圆斑，**触摸时刻在画面内自标记**，无需外部同步信号。
- **判读**：逐帧数「白点/手指位移可见帧」→「内容位移首帧」的帧数差 × 4.17ms（240fps）；同理可数 fling 后内容静止帧判定惯性时长。人眼判读 + 剪辑软件逐帧步进即可。
- **精度与成本**：±4.2ms 分辨率，人工判读每个场景 10 次取中位；适合作为 T1 管线的**抽样校验**（每端每路径 3~5 次）与方法学可信度锚点，不适合做全量采集。
- **注意**：拍摄环境避免屏幕 PWM/刷新摩尔纹干扰判读（提高快门、锁定被测机亮度）；OPPO 高刷（90/120Hz）下内容位移粒度本身受 vsync 限制，240fps 仍有 2× 过采样余量。

---

## 5. bench 流程设计

### 5.1 内容 fixture（同内容）

真实推荐 feed 不可复现，必须 fixture 化：

1. **数据快照**：同一账号同一时刻抓推荐接口（插画 + 小说）JSON 存为 fixture 文件（bench 资产，不入 git 则放 `/tmp` 或 CI artifact；入 git 需注意 Pixiv 数据合规，建议只存 ID/标题/尺寸元数据，图片 URL 保留）。
2. **webview 侧注入**：复用 bench-cdp 的 mock fetch 模式，把对应 API path 的响应替换为 fixture。
3. **lynx 侧注入**：lynx 无 fetch（走 `NativeModules.PictelioApi`），fixture 注入点 = JS 层 API 包装（debug 开关下返回 fixture）——改 app-lynx debug 代码，属测量 tooling。
4. **图片对齐**：两端共享同一磁盘图片缓存（`PixivImageLoader` 单源，双端同目录同命名，openwiki 已核实）→ 预热阶段全量滚一遍让图片落盘，正式测量时无网络变量；进一步可在 fixture 模式下断网（飞行模式）彻底消除网络。
5. **小说正文**：选一部固定长篇小说，正文经同一 API 快照；webview 侧 novelCache（LRU）预热，lynx 侧等价路径。

### 5.2 流程骨架（每端每路径）

```
安装对应 flavor（同 applicationId → 串行装/卸，或先 webview 全套再 lynx 全套）
→ 冷启动 → 登录态恢复 → 等 FCP/首屏稳定（lynx 侧可用 PerformanceObserver FCP 判定）
→ fixture 模式开启 + 图片预热（全量往返滚 2 次，丢弃）
→ 环境快照（dumpsys battery / 温度 / 刷新率 / gfxinfo reset）
→ 正式采样：3 组 × 10 次手势（drag 800px/600ms + fling 200ms 快甩各半；组间回顶——
   注意 lynx <list> 无 JS 滚动属性，回顶 = 重建或注入滚动，须双端语义对齐）
→ 每次手势后立即 dumpsys gfxinfo framestats（或 T1 用 UiAutomation+事件序列）
→ 结果解析：jank 率、TOTAL/DEADLINE 分布、UNKNOWN_DELAY/INPUT_HANDLING、时延中位数+P90
→ ABBA 交替（webview→lynx→lynx→webview 轮换组）消除设备温升/状态漂移
```

### 5.3 环境控制（同设备）

- **模拟器**：仅用于流程验证与相对趋势；绝对值以 OPPO 真机为准（GPU/合成路径不同）。本调研时无设备在线（`adb devices` 空），探针步骤移交 #306。
- **真机**：锁定刷新率（设置里固定 60 或 120Hz，双端同档）；不插电、电量 >50%、固定亮度；关闭后台同步；记录电池温度（热节流是最大组间干扰源）。
- **采样量**：每端每路径 30 次手势为下限（P90 有意义）；报中位数 + P90 + jank 率三件套。

### 5.4 双端路径等价表

| 场景 | webview 端 | lynx 端 | 等价性说明 |
|------|-----------|---------|-----------|
| 插画 feed 滚动 | `/home` 推荐 tab（L5 单列虚拟滚动） | Recommended.vue 插画 tab（RefreshableList `<list>`） | 语义等价（同 fixture 数据集、同卡片高度量级） |
| 小说 feed 滚动 | `/home` 小说 tab | 小说 tab | 同上 |
| 小说正文滚动 | `/novel/$id`（pretext 虚拟布局） | NovelDetail.vue | 同 fixture 正文、同字号档位 |

---

## 6. 方案对比总表

| 手段 | 测什么 | 精度 | 侵入性 | 双端一致性 | 成本 | 定位 |
|------|--------|------|--------|-----------|------|------|
| `input swipe` + `gfxinfo`（含 framestats） | jank 率、帧时长分布、app 侧输入处理→上屏 | 帧级（~8/16ms 粒度） | 零 | ✅ 天然同源 | 低 | **T0 快速基线** |
| UiAutomation 注入 + framestats 对齐 | 触摸→上屏全链路时延（主指标） | ms 级 | 零 app 改动（注入器为独立测试工程） | ✅ | 中 | **T1 主方案** |
| Java FrameMetrics 桥（debug-only） | 逐帧 duration 连续采集（>120 帧窗口） | ms 级 | 低（只读，DEBUG 门控；**tooling 例外，已显式标注**） | ✅（shared sourceSet 双端同源） | 中 | T1 增强（惯性全程采集必需时才加） |
| webview 页面内插桩（CDP 复用 bench-cdp） | JS 视角 touch→rAF 时延，补 chromium 合成器盲点 | ms 级 | 低（运行时注入，无代码改动） | 仅 webview（补盲用，非对比用） | 低 | T1 webview 补盲 |
| Perfetto（input + frametimeline） | 系统级 input→present，交叉验证 | sub-ms | 零 | ✅ | 中（解析成本） | T2 交叉验证 |
| 240fps 慢动作 + Show taps | ground truth | ±4.2ms | 零 | ✅ | 高（人工判读） | T2 抽样校验/可信度锚 |
| Lynx Trace / CDP Tracing | 卡顿归因分解 | — | 低 | 各自侧 | 高 | T3 归因（发现差异后） |
| logcat 标记 | 结果回传通道 | 不可做时间源 | 零 | ✅ | 低 | 辅助通道 |

## 7. 给 #306 的执行清单（探针优先）

1. **探针 0（先行验证假设）**：真机/模拟器装 lynx flavor → `input swipe` → `dumpsys gfxinfo io.pictelio.app framestats`，确认 Lynx 滚动帧出现在输出中（验证 §2.1）；同法验证 webview flavor；确认输出窗口分段只有目标 Activity。
2. T0 脚本：手势脚本 + gfxinfo reset/dump + CSV 解析（jank 率、分位数），双端跑通。
3. T1 注入器：uiautomator 工程注入固定手势 + 事件时间序列落盘 + 对齐解析。
4. fixture：推荐/小说接口快照 + 双端注入点 + 图片预热流程。
5. T2 校验：Perfetto 采一轮 + 慢动作抽 3~5 次对 T1 结果做偏差校验（|T1−video| 应 <10ms，否则查对齐逻辑）。
6. 产出首份基线报告（中位/P90/jank 率，双端四路径矩阵）。

---

## 附录：信息来源

- Lynx 渲染管线：`lynx-family/lynx@develop` 源码（`platform/android/lynx_android/.../LynxView.java`、`behavior/ui/scroll/`（AndroidScrollView/NestedScrollView/LynxUIScrollView）、`behavior/ui/list/`（UIList/ListLayoutManager））；lynxjs.org `llms.txt`（"maps to native views"）；custom renderer "are yet to come"（lynxjs.org 博客，经 `docs/research/lynx-pure-engine-analysis.md` §6.2 转引核实）
- framestats 列与时钟域：AOSP `frameworks/base@main` `core/java/android/view/FrameMetrics.java`（Index 接口、TOTAL_DURATION/DEADLINE/UNKNOWN_DELAY_DURATION/INPUT_HANDLING_DURATION javadoc）、`libs/hwui/FrameInfo.h`（`systemTime(SYSTEM_TIME_MONOTONIC)` 打戳、`InputEventId`、`DisplayPresentTime`）
- gfxinfo 命令形态：developer.android.com `dumpsys` 文档（`gfxinfo <pkg> framestats`）
- Lynx 性能能力：lynxjs.org `/guide/performance/monitor-performance/performance-api.md`（entry 类型仅 init/metric/pipeline/resource）、`/guide/devtool/trace.md`（Trace 定位）
- WebView 渲染：chromium `android_webview/docs/`（architecture.md、software_draw_deprecated.md）
- 仓库侧：openwiki `integrations/android-native.md`（flavor 架构、lynx-service-log、PixivImageLoader 双端共享缓存）；`packages/app/scripts/bench-cdp.mjs`（CDP 骨架）；`packages/app/android/app/build.gradle`（三 flavor 同 applicationId io.pictelio.app）；`packages/app-lynx/src/components/RefreshableList.vue`（`<list>` 无 per-frame scroll 事件、无 JS 滚动属性）；`packages/app-lynx/CONTEXT.md`「滚动跟手性」术语条
- 设备状态：调研时 `adb devices` 无在线设备，真机探针移交 #306（§7 探针 0）
