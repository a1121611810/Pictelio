# Ugoira 播放闪烁 + app range 失败 原型取证报告（2026-08-31）

> 会话：用户报告「lynx 动图播放持续闪烁（无论哪种播放方案）+ app 选择 range 流式提示加载失败」。
> 按 codebase-design 深化 → prototype 自行验证 → 四维打分选型流程执行。
> **原型分支（throwaway，留档作 oracle）**：`prototype/ugoira-playback-fix`（commit `770de17`）。
> 环境：`pictelio_ui`（emulator-5556，android-34，WebView 113，Lynx 4.0.1，720x1280@320dpi）；
> 代理 `10.0.2.2:10808`；作品：148861562（52 帧 ugoira，lynx 侧）/ 149104861（12.9MB zip、406 帧，app 侧）。

## 一、P1：lynx 播放闪烁 —— 候选验证（呈现层，4 变体）

原型页 `ProtoUgoiraPlay.vue`（4 个变体按钮，`[PROTO]` 日志逐帧打点；页面背景纯绿 `#00ff00`
约定用于自动取证：**空白帧 = 图像区被清除时的全屏高占比绿色**，录屏逐帧统计 green ratio）。
日志（logcat `lynx_console`）：

- V1 基线（单 `<image>` 定时换 src，= 现状生产实现）
- V2 `defer-src-invalidation`（官方属性：新加载成功后才清除已展示图片）
- V3 双 `<image>` 层叠 + `@load` 门控可见性
- V4 `defer-src-invalidation` + `@load` 后才调度下一帧（防解码堆积）

### 1.1 录屏逐帧取证（`/tmp/recs/v*.mp4`，ffmpeg 抽帧 + numpy 统计）

| 变体 | 抽帧数 | 空白过渡帧（green>0.7） | 完全空白帧 | 帧间隔 | 异常 |
|---|---|---|---|---|---|
| V1 | 325 | **4** | **1（实拍证实：frame=24 全屏纯绿，见 §1.2）** | ~40ms（原时序） | 无 |
| V2 | 374 | **0** | 0 | ~40ms（原时序） | 无 |
| V3 | 300 | 0 | 0 | ~50ms（delay+解码） | **1×1.5s 停滞**：切换变体后首个隐藏层 `@load` 不触发（层从未被布局），1.5s 看门狗强制推进（logcat：`[PROTO] variant=3 load-timeout layer=B idx=1`） |
| V4 | 300 | 0 | 0 | ~47-50ms（delay+解码） | 无 |

green ratio 序列（V1 部分）：`...........+...........................+.................+...........` —— 4 个 `+`（>0.7）≈ 每 1.75s 一次空白过渡；
V2：`..........`（374 帧恒 0.593，零波动）。

### 1.2 空白帧实拍证据（V1）

`frame=24/52` 截图：**图像区完全空白（全屏纯绿）**——新帧解码期间旧帧已被清除。
（logcat 帧切换 40ms/帧 ↔ 解码耗时 > 帧间隔 → 图↔空白交替；慢速真机上该窗口放大为「持续闪烁」，与用户报告一致。）

### 1.3 结论

- **机制确认**：Lynx `<image>` 默认「新加载发起前清除已展示资源」→ 逐帧换 src 时存在空白窗口（V1 实测）。
- **V2 完全消除**（374/374 帧零空白，时序无损）；V3/V4 亦消除但引入额外代价：
  - V3：双节点状态机 + 隐藏层首载 `@load` 死锁（需看门狗）；帧间隔 +25%（40→50ms）。
  - V4：帧间隔 += 解码耗时（播放节奏与 `meta.delay` 产生漂移）。
- **选型：V2**（详见 ADR-0126 四维打分）。

## 二、P2：app range 加载失败 —— 候选验证

### 2.1 根因复现（生产代码，Android webview）

`extractRange` 第一步 HEAD：拦截器恒返全量 200 且 JS 读不到长度 →
`ugoira: HEAD 拿不到 zip 长度（Range 模式需要）`（logcat 实拍，12:48:48）。

### 2.2 P2-A（拦截器 Range/HEAD + 206）设备实测 —— **不可行**

实现 `PixivImageLoader.downloadRange/downloadHeadLength/sliceFile` + 双 flavor 拦截器
（原型分支）后，CDP（WebView 远程调试）逐请求核验：

| 实验（fetch Range 头） | 拦截器响应 | JS fetch 观察 |
|---|---|---|
| `bytes=0-0`（1B） | 206 + 1B（`range served len=1`） | ✅ `206, len=1` |
| `bytes=0-100`（101B） | 206 + 101B | ✅ `206, len=101` |
| `bytes=100-200`（101B，start>0） | 206 + 101B | ⚠️ **`206, len=1`（截断为 1 字节）** |
| `bytes=12902002-12902102`（101B） | 206 + 101B | ❌ **`Failed to fetch`（net::ERR_FAILED）** |
| `bytes=12902002-12932001`（30KB 尾部） | 206 + 30000B | ❌ **`Failed to fetch`（net::ERR_FAILED）** |
| 探测后二次任意 Range（现产 JS 序） | — | ❌ `Failed to fetch` |

**判定**：HEAD 的 Content-Length 头经拦截器对 fetch 不可见（§2.1）；GET+Range 经拦截器 206 时
Chromium 对 start>0 / 大体量响应透传损坏（截断 / ERR_FAILED）——**非应用层可修复**，
与研究文档 §6「原生代理是否支持 206 需验证」一致（现在已验证：不支持）。

### 2.3 P2-B（JS 失败降级 fflate + warn）

`extractRange` 任一失败 → `console.warn('[ugoira] range 取帧失败，降级 fflate: ...')` +
全量 fflate 路径（与 lynx 侧 `downloadUgoiraFrames` 既有降级语义对称）。
设备行为：range 尝试失败 → warn → **正常播放**（fflate 路径设备实测可播，零失败提示）。
Web dev：Vite 代理真 206 → range 保持全真流式（研究 §7.1 已验证）。

## 三、P3（顺带发现，ADR-0125 承诺偏差）

`ugoiraExtract` 每次挂载 **重新下载 zip + 重写 `cache/ugoira/frame_N`**（帧名无 illustId 命名空间）——
ADR-0125「二次播放零下载」未兑现（原型 logcat：每次进入原型页 `ugoiraExtract` 均触发下载，~8s 后才能播）。
修复（确定性，无需选型）：`cache/ugoira/<illustId>/` 目录化 + 帧数完整性校验命中 → 零下载。

## 四、四维打分与选型（不可模糊）

### P1（lynx 闪烁呈现方案）

| 维度 | V2 `defer-src-invalidation` | V3 双缓冲 | V4 defer+按加载调度 |
|---|---|---|---|
| 高可维护性 | **优**：+1 行属性；官方文档语义；零新状态机 | 差：双节点状态机 + 隐藏层首载死锁要绕 | 良：属性 + 事件回调，但播放语义改为「最小显示时长」 |
| 高性能 | **优**：帧间隔保持 40ms 原时序 | 中：帧间隔 +25%（40→50ms） | 中：帧间隔 += 解码耗时（漂移） |
| 高安全性 | **优**：零新增二进制/暴露面（框架属性） | 优：同 | 优：同 |
| 低内存 | **优**：单节点，无新增 | 中：双位图句柄常驻 | 优：单节点 |

**选 V2**：四维无劣项 + 三项显著优势；官方文档明示就是闪烁解法；研究文档 2026-08-11 既定结论。

### P2（app range 模式）

| 维度 | P2-A 拦截器 Range/206 | P2-B JS 降级 fflate+warn | P2-C 原生隐藏 range |
|---|---|---|---|
| 高可维护性 | **差**：设备实测不可行（§2.2）→ 死代码 + 核心加载器改造 | **优**：JS 单点 6 行；与 lynx 侧对称 | 中：设置层分叉 |
| 高性能 | 不可用 | **优**：Web 保持真流式；原生降级与默认 fflate 等性能，且不报失败 | 中：无 range 选项 |
| 高安全性 | 不可用 | **优**：无新暴露面（与 lynx 侧既有 fallback 同构） | 优 |
| 低内存 | 不可用 | **优**：原生降级与 fflate 等同；Web 保持 range 低内存 | 优 |

**选 P2-B + 设置项文案补充说明**（原生端自动降级，见 ADR/spec）；**P2-A 被设备实测否决**（否定性证据：CDP 截断/ERR_FAILED）；P2-C 取消用户诉求不选。

## 五、证据产物索引

- 原型分支 `prototype/ugoira-playback-fix`（`770de17`）：ProtoUgoiraPlay.vue（4 变体）、
  PixivImageLoader Range/HEAD、双 flavor 拦截器（含 `[PROTO]` 取证日志）、app `illust.ts` 探测改造（原型版）、单测。
- logcat 时间戳（本机会话）：`[PROTO] variant=* frame=*` 帧切换打点；`[PROTO] range served start/end/total/len`；
  `[IllustDetail] Ugoira load failed:` 错误打点；`lynx_console` `[PROTO]`。
- CDP 实验（`/tmp/cdp_range_test*.py`）：E1-E3 / A-E 边界矩阵（§2.2 表）。
- 录屏 `/tmp/recs/v1-v4.mp4` + 抽帧序列（本机取证；复现步骤见原型分支 README 注释）。
