# ADR-0127: app 侧 ugoira fflate 模式改为流式渐进播放（不依赖 Range）

> 状态：已接受（2026-08-31）
> 相关：ADR-0126（range 降级）、ADR-0125（lynx 原生解压写盘）、ADR-0098（双端共享数据层）、
> `docs/research/ugoira-stream-frames-proto.md`（原型取证，oracle 分支 `prototype/ugoira-stream-frames`）、
> `docs/research/ugoira-alternative-paths.md`（替代方案矩阵：A 流式 fflate 为第一优先）

## 背景

app（Android WebView）侧 ugoira 的 fflate 模式（默认）是「全量下载 zip → 全部解压 → 才开始播放」：
2.5MB/52 帧作品首帧等待 ≈ 全量下载时间；12.9MB/406 帧大作品约 8s 白等。
range 真流式在 Android 被 `shouldInterceptRequest` 拦截层破坏（ADR-0126 已证，206 透传损坏），
**不能依赖 Range**。替代方案矩阵（`ugoira-alternative-paths.md`）给出唯一无硬伤路径：
**流式 fflate 渐进播放**——用现有全量 200 通道（拦截器正常路径）边下载边解压边播。

## 决策

**app 侧 fflate 模式改为流式渐进播放，实现分两层：**

1. **共享包 `@pictelio/ugoira` 新增「流式取帧器」模块**（取帧数据层 seam 的深度扩展，双端可复用）：

   ```ts
   interface StreamFrameSource {
     push(chunk: Uint8Array, final?: boolean): void   // 同步；异常（zip 损坏）向上抛
     onFrame: ((name: string, bytes: Uint8Array) => void) | null  // 按 fileOrder 顺序回调（乱序内部缓冲）
   }
   function createStreamFrameSource(fileOrder: string[]): StreamFrameSource
   ```

   接口事实（caller 必须知道）：
   - 顺序不变量：`onFrame` 按 `fileOrder` 顺序触发；不在 `fileOrder` 的条目丢弃（防御非帧条目）。
   - 时序不变量：`onFrame` 在 `push` 调用栈内同步触发；`bytes` 为帧完整字节（fflate `ondata(final)` 语义）。
   - 错误模式：zip 损坏/无有效条目 → `push` 抛可读错误（`ugoira:` 前缀）→ 调用方回退现有全量路径。
   - 性能：`push` O(chunk)；store 条目零解压直通；乱序缓冲内存 ≤ 全帧（最坏与现状全量等价，无劣化）。
   - 生命周期：无持久化/网络/计时器。

2. **app 侧接线**（`illust.ts` + 详情页播放器）：
   - `illust.ts` 新增 `streamUgoiraFrames(illustId, onFrame, onProgress)`：fetch body reader 循环 `push`，
     每帧 `onFrame` → blob URL；**保留** `downloadAndExtractUgoira`（range 模式与兼容调用不变）。
   - 详情页（IllustDetail/UgoiraViewer）改为「渐进播放」：首帧就绪即 `ugoiraReady` 开始播放，
     后续帧就绪追加到播放帧列表；播放器到当前列表尾部时**等待新帧**（不停止，不报错）。
   - 进度环语义：显示下载字节 %（与现状 UI 一致）；帧就绪驱动播放（不阻塞 UI）。
   - 异常/损坏 zip：`push` 抛错 → 现有错误态（「加载动图失败」+ 返回按钮），与现状一致。

**明确排除**：
- 依赖 Range 的任何实现（拦截层 206 已证损坏，ADR-0126）。
- 原生桥批量取帧（替代方案 B：Capacitor 官方建议大字节不过桥，且收敛为 ADR-0125 移植，
  成本中高、收益与 A 重叠）——挂 backlog。
- 改变 `ugoiraMode` 语义：`fflate` 选项 = 渐进播放（改名不动，避免破坏用户设置与 UI 文案）；
  `range` 选项 = 维持 ADR-0126 降级语义。
- lynx 侧接线（原生模式走 Java 解压写盘；web 模式保持全量）——共享包接口先就位，不新增消费方。

## 证据（2026-08-31 原型实测，oracle 分支 `prototype/ugoira-stream-frames`）

真实作品 148861562（52 帧，2,532,936B），4 用例全绿（24/24）：

| 验证项 | 结果 |
|---|---|
| 帧0 就绪水位（ondata final） | **1.9%**（8KB 分片，49KB）；帧 0-8 就绪 @17.5% |
| 流式产出 vs unzipSync（全量路径） | 52/52 帧逐字节一致 |
| 乱序 zip（物理序倒置）防御 | 按名映射+缓冲后 52/52 帧字节一致 |
| 真实 zip 元数据 | 52 帧、条目序==数值序、无杂条目 |

**设备端 E2E（pictelio_ui，full debug，2026-08-31）**：点播放后**首帧就绪 51ms**（CDP 轮询
`img[src^="blob:"]` 出现时刻），同一次播放 zip 全量下载耗时 **5.25s**（resource timing）——
首帧领先全量完成 ~5.2s（≈100 倍）；6s 采样窗口帧切换 24 次（播放连续不中断）；无「加载失败」
错误态（uiautomator 断言）。

推论：首帧等待从「全量下载完」→「~2% 下载完」；大作品（12.9MB）首帧约 250KB 即出。

## 四维论证（A vs 现状，不可模糊）

| 维度 | 现状（全量） | A（流式渐进） |
|---|---|---|
| 高可维护性 | 基准 | **优**：逻辑收敛共享包单模块（单 seam+单测）；app 接线薄（reader→push、onFrame→append）；回退路径现成（字节一致已证，回退无缝） |
| 高性能 | 首帧=全量下载完 | **优**：首帧=2% 下载；总传输不变（一次全量 200，无额外请求）；push O(chunk)、store 零解压 |
| 高安全性 | 基准 | **优**：纯 JS 内存操作零新暴露面；无新网络端点；blob URL 按帧创建（与现状同） |
| 低内存 | 全量 zip+全帧 blob 常驻 | **优**：已 push 部分不保留；已播帧可逐帧 revoke（峰值<现状）；最坏（乱序缓冲）与现状等价 |

**结论：四维全部不劣于现状，高性能/低内存显著更优 → 采纳。**

## 后果

### 正面
- Android 端动图首帧大幅提前（2% vs 100%），大作品体验质变（8s→数百 ms 级）。
- 共享包深度扩展：`streamFrames` 语义可测（增量/乱序/损坏三路径）；lynx web 未来可复用。
- 不触碰拦截层/网络层/原生面，风险面最小。

### 负面/代价
- 播放器接线复杂度 +1（增量帧列表 + 尾部等待）；进度环语义需在 spec 中明确（下载字节 vs 就绪帧）。
- 下载中途取消（用户离开页面）需 AbortController 贯通 reader 循环（现有模式已有，接线保持）。

## 兼容性/边界

- `downloadAndExtractUgoira` 签名与行为（非流式）保留：range 模式、preloadedFrames 兼容调用不受影响。
- `UgoiraViewer` 的 `preloadedFrames` 静态路径保留；渐进路径为新增入口（spec 定义组件契约）。
- 双端术语：见 `packages/app/CONTEXT.md` / `packages/app-lynx/CONTEXT.md`「流式取帧/渐进播放/帧就绪」。

## 待办（实现规范引用）

1. `@pictelio/ugoira`：`createStreamFrameSource` + 单测（增量回调序、乱序缓冲、损坏抛错、与 unzipSync 一致性——原型用例升级）。
2. app `illust.ts`：`streamUgoiraFrames`（reader→push→onFrame→blob URL）+ 单测（分片喂入、取消、损坏回退）。
3. 详情页/播放器：渐进播放接线（首帧即播 + 增量追加 + 尾部等待）+ 组件测试。
4. 端到端：模拟器录屏验证「首帧快速出现 + 播放不中断」；Web dev 验证逻辑等价。
