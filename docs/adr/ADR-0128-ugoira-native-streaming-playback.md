# ADR-0128: lynx 原生模式 ugoira 首次播放改为流式渐进（Java 边下边解压写盘 + 拉模式分批交付）

> 状态：已接受（2026-08-31）
> 相关：ADR-0125（原生解压写盘管线）、ADR-0127（app 侧 JS 流式渐进，共享包）、ADR-0037（图片二进制零进 JS 堆）、
> `docs/research/ugoira-native-streaming-proto.md`（原型取证，oracle 分支 `prototype/ugoira-native-streaming`）

## 背景

lynx 原生模式 ugoira 首次播放 = `ugoiraExtract` 全量路径：`downloadZip`（全量字节驻留 Java 堆）
→ `scanZip`（全帧 map 驻留）→ 逐帧写盘 → 一次性回调。首次打开大作品（12.9MB/406 帧）约 8s 白等；
且全量路径存在两次全量内存驻留（ADR-0125 已知代价，未优化）。app 侧已用 JS 流式渐进解决同类问题
（ADR-0127，首帧 51ms vs 全量 5.25s 设备实测）；lynx 原生模式因 LynxFetchModule 无流式 body +
渲染要求 file:// 落盘，**渐进必须落在 Java 侧**（原型分支已实测核心机制可行）。

## 决策

**lynx 原生模式首次播放改为「Java 流式渐进」：下载流边读边解压边写盘，按批交付帧 URL 列表。**

1. **可测核心（纯 JVM）`ugoiraStreamCore`**：输入 = zip 字节流（InputStream）+ framesJson + 输出目录 + 批大小；
   输出 = 批次事件序列（每批：帧 URL 列表 + 已读字节水位）。内部 `ZipInputStream` 顺序流式读取
   （local header 驱动，不依赖中央目录）、逐帧写盘、写满一批即交付。字节与全量路径逐字节一致
   （原型 200+52 帧实测）。沿用 `frameFileName`/清理/白名单既有规则。
2. **薄模块包装（Lynx 契约）**：Lynx `Callback` 为一次性语义 → **拉模式**状态机：
   - `ugoiraExtractStream(zipUrl, framesJson, illustId, batchSize, cb)`：启动流式下载解压写盘
     （API_EXECUTOR）；**缓存命中（帧完整）→ 一次 poll 全量交付**（复用 `ugoiraExtractCached`）；
     `cb(0, {started:true})`。
   - `ugoiraExtractStreamPoll(cb)`：`cb(0, {delivered, urls[], done, error})`——自上次以来新交付的帧
     URL；无新帧快速返回（不阻塞）；done=true 表示流结束；error 为可读错误（下载中断/zip 损坏）。
   - `ugoiraExtractStreamCancel(cb)`：取消活动流（释放连接；已写盘帧保留，下次缓存命中）。
   - 并发约束：模块实例一次一个活动流；新 start 自动取消旧流（并置 error）。
   - 状态机为纯 Java 字段（synchronized 读写），可 JVM 单测。
3. **JS 侧**：`ugoira.ts` 新增 `ugoiraExtractStreamFrames(illustId, onBatch, signal)` 封装
   （start → 循环 poll → done/error；signal 中止走 cancel）；`UgoiraViewer.vue` 原生分支接渐进：
   帧 URL 列表增量追加 + 播放器**尾部等待**（与 app 侧 UgoiraViewer streaming 同款语义：
   到尾部 50ms 轮询等待新帧，done 后循环）。
4. **保留**：现有 `ugoiraExtract` 全量路径（其他调用方/兜底）；缓存命中逻辑（`ugoiraExtractCached`）不变。

**明确排除**：
- 多次回调推送（Lynx Callback 一次性语义，不可依赖——拉模式规避）。
- 改 LynxFetchModule/渲染层（file:// 落盘是 ADR-0125 既定架构事实）。
- 用共享包 `createStreamFrameSource`（JS 侧拿不到原生流，见背景）。

## 证据（2026-08-31 原型实测，oracle 分支 `prototype/ugoira-native-streaming`）

| 验证项 | 结果 |
|---|---|
| ZipInputStream 流式顺序读（不依赖中央目录） | ✅ 首批交付时已读 4.5%（构造）/ 8.6%（真实） |
| 分批交付时间线（真实 zip 52 帧，批=5） | 批0 @8.6% → 批5 @55.5% → 批10 @99.9% |
| 流式写盘 vs 全量解压逐字节一致 | ✅ 200/200 + 52/52 帧 |
| 全量路径内存现状 | `downloadZip` 全量 + `scanZip` 全帧 map 两次驻留（流式消除） |

**设备端 E2E（pictelio_ui，full debug，2026-08-31，作品 149104861 12.9MB/234 帧）**：
- 首次打开：`ugoiraExtractStream` 启动（14:14:09.83）→ **首批 5 帧交付 @2.5s**（14:14:12.35，
  logcat `ugoiraStream 批次交付: frame=0-4 已读=297346B`）→ 批次连续交付（~0.5-1s/批）→
  全量下载完成 ~35s（模拟器网络 ~370KB/s）——**首帧提前 ~13 倍**（2.5s vs 35s）。
- 播放：首批交付即播（录屏内容出现 <0.51s；三连截图帧切换连续，无错误态）。
- 二次打开：`ugoiraStream 缓存命中: 234 帧` → 一次 poll 全量交付，快速播放（零下载）。

## 四维论证（流式 vs 现状全量，不可模糊）

| 维度 | 现状（全量） | 流式渐进 |
|---|---|---|
| 高可维护性 | 基准 | **优**：可测核心（批次逻辑纯 JVM，原型形态已证）+ 薄状态机包装（synchronized 字段，可单测）；JS 封装一处；与现有核心共享帧名/清理/白名单规则 |
| 高性能 | 首帧 = 全量下载完（~8s/12.9MB） | **优**：首批 5-10 帧 @4.5-8.6% 即交付；总传输不变（一次下载）；无额外请求 |
| 高安全性 | 基准 | **优**：下载仍 Java 侧（OkHttp + Referer/UA），帧二进制零进 JS 堆（ADR-0037 保持）；无新暴露面 |
| 低内存 | zip 全量 + 全帧 map 驻留 Java 堆 | **优**：流式读完即弃、帧写盘即弃；JS 堆仍 ≈0（仅 URL 列表）；最坏（网络极慢）无额外驻留 |

**结论：四维全部不劣于现状，高性能/低内存显著更优 → 采纳。**

## 后果

### 正面
- 原生模式首次播放从「全量下载完才播」→「首批帧（~1MB）即播」；与 app 侧 ADR-0127 收益对齐。
- 顺带消除全量路径的两次内存驻留（downloadZip 全量 + scanZip 全帧 map）。
- 拉模式状态机纯 Java 可测，契约清晰；缓存命中/清理/白名单全部复用。

### 负面/代价
- Java 侧新增状态机（start/poll/cancel + 并发约束）+ 契约测试；JS 封装 + 播放器尾部等待（与
  ADR-0127 同款逻辑，双端播放器语义统一）。
- 首次流式期间不可二次 start（活动流约束）——单详情页场景无实际影响。

## 兼容性/边界

- 现有 `ugoiraExtract` 全量路径与缓存命中不动（其他调用方/兜底）。
- 流式中途失败：error 可读（HTTP 码/zip 损坏/IO）；已写盘帧保留 → 下次缓存命中。
- 播放器尾部等待逻辑与 ADR-0127 统一（app 侧 streaming prop 语义的 lynx 版）。
- 术语：见 `packages/app-lynx/CONTEXT.md`「原生流式渐进」。

## 待办（实现规范引用）

1. Java：`ugoiraStreamCore`（可测核心，原型形态正式化）+ 拉模式状态机 + 测试（批次序列/命中/中断/取消/并发）。
2. JS：`ugoiraExtractStreamFrames` 封装 + `UgoiraViewer.vue` 原生分支渐进（增量 URL + 尾部等待）+ 测试。
3. E2E：设备验证首批帧时间 vs 全量基线（大作品 12.9MB）；契约测试全绿。
