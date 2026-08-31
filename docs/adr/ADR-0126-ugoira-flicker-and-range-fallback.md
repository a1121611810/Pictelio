# ADR-0126: lynx 播放闪烁用 defer-src-invalidation 修复；app range 模式失败走降级（拦截器 206 被实测否决）

> 状态：已接受（2026-08-31）
> 相关：ADR-0125（lynx 解压写盘管线）、`docs/research/ugoira-playback-flicker-range-proto.md`（本 ADR 一手证据，原型分支 `prototype/ugoira-playback-fix`，commit `770de17`）、`docs/research/ugoira-playback-alternatives.md`（§4.8/§7.8/§6 预设结论）、issue #218

## 背景

用户报告两个问题：
1. **lynx**：动图能显示，但加载结束后播放**持续闪烁**，无论哪种播放方案（fflate/range、原生/web 管线都闪）。
2. **app（webview）**：选择 range 流式取帧方案 → **提示加载失败**。

## 根因（均有实证）

1. **Lynx 闪烁**：`UgoiraViewer.vue` 逐帧换 `<image :src>`，而 Lynx `<image>` 默认
   **在新一次加载发起前清除已展示的图片资源**。帧间隔（meta.delay 20~80ms）快于
   解码耗时 → 画面在「图 ↔ 空白」间高频交替。原型实测：基线 325 帧中 4 次空白过渡，
   1 次实拍证实完全空白（frame=24 全屏纯绿）。官方属性 `defer-src-invalidation`
   （新加载成功后才清除旧图）正是官方给出的闪烁解法（lynxjs.org `<image>` 文档原文；
   研究文档 2026-08-11 §4.8/§7.8 早已记录此结论，生产实现漏带该属性）。
2. **app range 失败**：`extractRange`（官方 zip_player 语义）第一步 HEAD 经
   `shouldInterceptRequest` 拦截后，**Content-Length 头对 fetch 不可见**（实测
   `ugoira: HEAD 拿不到 zip 长度`）；改为 GET+Range 探测后，进一步实测发现
   **Chromium 对拦截响应做 206 透传时损坏**：start>0 响应被截断为 1 字节或
   `net::ERR_FAILED`（CDP 逐请求核验，A-E 边界矩阵，见原型报告 §2.2）。
   研究文档 §6 风险 1「原生代理是否支持 206 需验证」——已验证：**不支持**。

## 决策

### P1：lynx 帧呈现层 —— 加 `defer-src-invalidation`（1 行）

`packages/app-lynx/src/components/UgoiraViewer.vue` 的 `<image>` 增加
`defer-src-invalidation` 布尔属性（仅在呈现层；调度器/数据层零改动）。

**明确排除**：
- V3 双 `<image>` 层叠 + `@load` 门控：实测引入「隐藏层首载 @load 死锁」（层从未布局时
  load 事件不触发，需 1.5s 看门狗兜底）+ 帧间隔膨胀 25%（40→50ms）——收益与 V2 相同，
  复杂度显著更高。
- V4 属性 + `@load` 调度：播放节奏变为「delay + 解码耗时」的漂移时序，与 `meta.delay`
  语义不再一致——V2 已消除闪烁，无必要引入节奏漂移。

### P2：app range 模式 —— 失败降级 fflate + warn（约 6 行）

`packages/app/src/api/illust.ts::extractRange` 失败（非 206 / 长度不符 / 网络错）时
`console.warn("[ugoira] range 取帧失败，降级 fflate:", ...)` 并走 `fflate` 全量路径
（与 lynx 侧 `downloadUgoiraFrames` 既有降级语义对称；禁止静默降级——warn 是契约）。
设置页（`SettingsImage.tsx`）模式说明文案补充「原生端（WebView）自动降级为全量」。

**明确排除**：
- 拦截器 Range/206 + HEAD 支持（P2-A）：设备实测不可行（见上），不做生产改动；
  原型分支中的 `PixivImageLoader`/双 flavor 拦截器改动仅作证据留档。
- 原生隐藏/禁用 range 设置（P2-C）：取消用户诉求；降级方案已保证「选 range 不再报失败」。

### P3：兑现 ADR-0125「二次播放零下载」

`ugoiraExtract` 帧文件目录改为 `cache/ugoira/<illustId>/frame_N.{png|jpg}`；
写盘前**完整性校验**（帧文件数与 `framesJson` 一致且非空）命中 → 跳过 zip 下载与解压，
直接回调帧 URL 列表；未命中/损坏 → 现有下载解压写盘路径。清理策略沿用
UGOIRA_MAX_COUNT / UGOIRA_MAX_BYTES（跨 illust LRU）。

## 证据（2026-08-31 原型实测）

| 项 | 结果 |
|---|---|
| V1 基线（现状） | 325 帧中 4 次空白过渡；1 次实拍证实完全空白 |
| V2 `defer-src-invalidation` | **374 帧 0 空白**，帧间隔 40ms 无损 |
| V3 双缓冲 | 300 帧 0 空白；帧间隔 50ms；1×1.5s 隐藏层首载停滞 |
| V4 defer+@load 调度 | 300 帧 0 空白；帧间隔 47-50ms（节奏漂移） |
| HEAD 经拦截器 | Content-Length 对 fetch 不可见（生产复现即此错误） |
| Range 206 经拦截器 | `bytes=100-200` → 截断为 1B；`bytes=12902002-…` → `ERR_FAILED`（CDP） |
| fflate 全量（降级目标） | 设备可正常播放（本次会话 + 前次会话实测） |

## 后果

### 正面
- lynx 闪烁根治：一个属性，官方语义，播放时序不变；双端渲染层各自独立（app 无此问题）。
- app range 模式不再报错：Web dev 保持全真流式；WebView 自动降级全量并 warn（可诊断）。
- 二次播放零下载兑现：下一次打开同作品跳过下载（~8s → 近零秒）。
- Java 核心加载器零改动（P2-A 否决），维护面最小。

### 负面/代价
- WebView 端 range 无真实流式收益（被 Chromium 拦截层限制，非本项目可修）；
  设置项文案如实说明「自动降级」。
- `cache/ugoira/` 目录结构变化：旧 `frame_N` 文件残留（新路径不引用；清理阈值逻辑
  按新目录统计，残留文件在超限时被 LRU 清除）。

## 兼容性/边界

- `ugoiraMode` 设置保持两个取值；语义细化：`range` =「优先流式，失败自动降级」。
- lynx 原生管线与 `ugoiraMode` 无关（既有语义不变）。
- `file://` 白名单（`isInUgoiraCacheDir`）需同步放行 `<illustId>/` 子目录（实现 ticket 校验）。
- 帧文件大小写/扩展名规则不变（.png 判定，其余 .jpg）。

## 待办（实现规范引用）

1. lynx `UgoiraViewer.vue` 加 `defer-src-invalidation` + 单测（模板属性存在性断言）+ 模拟器 E2E（录屏空白帧=0）。
2. app `extractRange` 降级 + warn + 单测（成功/失败/降级三条路径）+ 设置页文案。
3. Java `ugoiraExtract` 缓存命中 + per-illust 目录 + 白名单扩展 + 契约测试（命中/未命中/损坏）+ E2E（二次打开零下载）。
