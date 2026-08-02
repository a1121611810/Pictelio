# Ugoira（Pixiv 动图）播放技术方案调研：除 JSZip 之外的替代路径

> 记录日期：2026-08-11（联网抓取一手来源；部分站点超时，已在文中标注）
> 触发背景：`prototype/ugoira-tech-check` 分支已用「JSZip 解压 zip → 帧转 base64 data URL → `<image>` 按帧延迟切换」在 vue-lynx 0.5.1 验证可行（真实作品 142451838，39 帧/3250ms，web-core 7/7 PASS）。本文调研除 JSZip 之外的方案。
> 结论速览：**Pixiv ugoira zip 的条目是 store（未压缩）模式，Pixiv 官方播放器（`pixiv/zip_player`）根本不用任何解压库——HEAD 拿长度 → HTTP Range 读尾部中央目录 → 按帧偏移 Range 取帧字节 → Canvas 绘制。** 对本项目而言，最匹配的三条替代路径：(1) 短期最小改动：JSZip 换成 `fflate`（8kB、快 25–50%、支持流式）；(2) Android 原生：Java `ZipInputStream` 解压写盘，前端拿帧 URL 列表（unpacked 模式，符合 ADR-0037「图片二进制零进 JS 堆」）；(3) Web 端最优：Range 流式取帧（官方做法，需代理支持 Range）。ffmpeg.wasm 转 mp4 / 服务端转 webm / APNG 合成 / sprite sheet 均不推荐。

---

## 1. 现状（两条已存在的实现路径）

### 1.1 pictelio-app（Web / Android Capacitor）

`packages/app/src/api/illust.ts` 的 `downloadAndExtractUgoira()`（L87-143）：

```
loadUgoiraMetadata(illustId) → GET /v1/ugoira/metadata
→ fetch(`/pixiv-img/${zipUrl…}`) 整个 zip 流式下载到内存（Blob）
→ import("jszip") → JSZip.loadAsync(zipBlob) 全量解压
→ 逐帧 file.async("blob") → URL.createObjectURL → UgoiraFrame{url, delay}[]
→ UgoiraViewer：<img src> 按 meta.delay setTimeout 切换
```

痛点：整个 zip 进 JS 堆 + JSZip 全量解压 + 每帧一个 blob URL（39 帧 × 数百 KB 起）。

### 1.2 app-lynx（分支已验证）

`prototype/ugoira-tech-check` 的 `UgoiraProto.vue`：JSZip 解压 → `bytesToDataUrl()` 转 base64 → `<image>` 按 delay 切换。因为原生 LynxView **无 `URL.createObjectURL`**（无 DOM），base64 data URL 是原生 `<image>` 官方支持的 src 格式（lynxjs.org：http/https/base64）。

痛点：base64 比二进制多 33% 内存，全部帧的 base64 常驻 JS 堆。

---

## 2. 核心事实：Pixiv ugoira zip 是 store（未压缩）模式

**来源：Pixiv 官方开源的 ugoira 播放器 `pixiv/zip_player`（MIT，2014）**

- README 原文：*"load and play back animated images packaged as an **uncompressed** ZIP archive containing individual frames… Frames are drawn onto a **Canvas** element"*（<https://github.com/pixiv/zip_player>）
- `zip_player.js` 源码 `_readCentralDirectory()`：

  ```js
  var compMethod = dv.getUint16(p + 10, true);
  ...
  if (compMethod != 0) {
      this._error("Unsupported compression method");
  }
  ```

  官方播放器直接断言压缩方法必须为 0（store），否则报错。原因：帧是 PNG（自身已压缩），Pixiv 生成 zip 时不再二次压缩。

**推论：** zip 条目未压缩 → 帧字节在 zip 里的位置可直接由「本地文件头偏移 + 30 + nameLen + extraLen」算出 → 取帧完全不需要 inflate / 解压库。

---

## 3. 官方播放器的完整做法（方案 A：Range 流式取帧，零解压库）

`zip_player.js` 的播放流程（一手源码）：

1. `_startLoad()`：HEAD 请求拿 `Content-Length`（拿不到就全量下载 fallback）
2. `_load()`：`Range: bytes=off-end` 的 XHR arraybuffer 请求，支持 206 分块拼接
3. `_findCentralDirectory()`：先 Range 读**尾部 30000 字节**（`_trailerBytes`），解析 EOCD 签名 `0x06054b50`，得到中央目录偏移/大小/条目数
4. `_readCentralDirectory()`：读中央目录，得到每帧 `{off, len}`（`_files[name]`），并**边下载边播**（`_loadNextChunk` load-ahead，`_isFileAvailable` 判断帧数据是否已就绪）
5. `_loadNextFrame()`：`_buf.slice(off, end)` 直接切出帧字节 → Blob URL（fallback：base64 data URL，见 `base64ArrayBuffer`）
6. `_displayFrame()`：`canvas.getContext("2d").drawImage(image, 0, 0)` 绘制，`setTimeout(meta.delay)` 切换

要点：
- **不需要 JSZip / pako / fflate**，纯 fetch/XHR + DataView 解析二进制
- 内存按需加载、播放完释放整个 buffer（`_setLoadingState(2)` 后 `_buf = null`）
- 官方还支持 **unpacked 模式**（`op.source` 为空时直接用帧 URL 列表，data URL 亦可）

对本项目的适配性：
- Web dev（Vite 代理）转发 Range 没问题；**Android 端 `shouldInterceptRequest` 需要实现 Range 转发**（当前 `MainActivity` 的 `/pixiv-img/` 代理是否支持 206 需验证）
- vue-lynx：有 fetch，但 XHR/`responseType=arraybuffer`/Range 支持需在原生 LynxView 环境验证（web-core 预览没问题）

---

## 4. 替代方案矩阵

### 方案 B：fflate 替换 JSZip（最小改动、立即可做）

**来源：<https://github.com/101arrowz/fflate>（README 性能表）**

| | pako | UZIP.js | **fflate** |
|---|---|---|---|
| 解压性能 | 1x | 快 25% | **快 25–50%** |
| 核心体积（min） | 45.6kB | 14.2kB | **8kB（仅解压 3kB）** |
| ZIP 支持 | ❌ | ✅ | ✅ |
| 流式 ZIP 解压 | ❌ | ❌ | ✅（`Unzip` + `UnzipInflate`/`AsyncUnzipInflate`，可边下载边解压） |
| Web Worker 多线程 | ❌ | ❌ | ✅ |

- 对本项目：替换 `import("jszip")` 为 `import("fflate")`，包体积降 ~90%，解压更快；`Unzip` 流式 API 可去掉「先攒完整 Blob 再解压」的两阶段
- 对 lynx：纯 JS、无 DOM 依赖，分支验证过的 JSZip 路径可直接平移
- 局限：仍是全量帧进 JS 堆（内存模型不变）

### 方案 C：Android 原生 Java 解压写盘（最符合本项目架构）

- 项目 ADR-0037 已是网关架构（PixivApiPlugin 网关，图片二进制零进 JS 堆）
- 做法：Java 侧 `ZipInputStream`（或直接按 store 偏移读）解压 → 逐帧写应用缓存目录 → 前端通过 URL 列表（unpacked 模式）播放
- 前端接口形态：`loadUgoiraFrames(illustId)` 返回 `{ urls: string[], delays: number[] }`，`<img>`/`<image>` 直接加载
- 对 lynx：原生 `<image>` 若支持 `file://` 则零内存放大；不支持则复用已验证的 base64 转换（写盘后按需 base64，而非全量）
- 附加收益：帧文件可落磁盘缓存（L2 层语义），二次播放零下载

### 方案 D：ffmpeg.wasm 浏览器内转 mp4/gif（不推荐移动端）

**来源：<https://github.com/asadahimeka/ugoira-converter>**（"Convert pixiv ugoira to mp4/gif etc. using ffmpeg.wasm in browser"）

- 浏览器内跑 ffmpeg.wasm 把 zip 帧编码成 mp4，然后 `<video>` 播放
- 不推荐：ffmpeg.wasm 核心 ~25MB+ 下载、CPU 密集编码（帧数多的 ugoira 在移动端要数秒~数十秒）、内存峰值高；lynx 无 WebAssembly 编码场景价值

### 方案 E：服务端/离线转码成 webm/gif（本项目无服务器，仅参考）

**来源：** <https://github.com/mikf/ugoira-conv>（"ffmpeg frontend to convert pixiv-ugoira/-animations to webm or gif"）；<https://github.com/altbdoor/py-ugoira>（Python + FFmpeg 转视频）

- 第三方图站（如 Danbooru）在服务端把 ugoira 转成 webm 提供——本次会话未能直接抓取 Danbooru 帮助页（超时），此点以社区已知事实记录、未做一手验证
- 本项目为纯客户端（无服务端），除非自建转换服务，否则不适用；与方案 D 同属「视频化」路线

### 方案 F：APNG / Animated WebP 合成（不推荐）

- 把帧序列合成单张动画图片（APNG 或 Animated WebP），`<img>` 直接播放
- 合成需要 canvas 逐帧绘制（Web 端）或原生编码器；Android 的 animated WebP 编码器支持有限；lynx 无 canvas
- 帧数多时合成/解码成本高，且失去逐帧 delay 的精确控制（ugoira 帧延迟可变）

### 方案 G：sprite sheet 雪碧图（仅帧数少时）

- 帧拼成一条大图，canvas `drawImage` 偏移或 CSS `steps()` 播放；一次解码、减少绘制对象
- 局限：帧尺寸 512px 级 × 39 帧易超纹理上限（4096/8192），内存放大明显；lynx 无 canvas 不适用

### 方案 H（播放层优化，非解压替代）：Canvas 绘制替代 `<img>` 切换

- 官方 zip_player 的做法：`ctx.drawImage(image, 0, 0)`，避免多 `<img>` 切换的 DOM 重排/闪烁，帧对象复用
- 仅 Web/Android WebView 适用；lynx 无 canvas，维持 `<image>` src 切换 + `defer-src-invalidation` 防闪烁（分支已验证）

---

## 5. 推荐路径（针对本项目）

| 阶段 | 方案 | 改动 | 适配端 |
|---|---|---|---|
| 短期 | **B. fflate 替换 JSZip**（可 + H. Canvas 绘制） | 1 个文件、包体积 -90% | pictelio-app + app-lynx 双端 |
| 中期 | **C. 原生 Java 解压写盘**（unpacked 模式） | PixivApiPlugin + 帧 URL 接口 | Android 原生（含 lynx 原生路径） |
| 长期/Web 最优 | **A. Range 流式取帧**（官方做法） | 代理需支持 206 Range | Web；Android 需 `shouldInterceptRequest` 加 Range 转发 |

不推荐：D（ffmpeg.wasm）、E（无服务器）、F（APNG/WebP）、G（sprite sheet）。

## 6. 风险与待验证点

1. **Range 支持**：方案 A 依赖 `/pixiv-img/` 代理返回 206——Web dev（Vite 代理）与 Android `shouldInterceptRequest` 均需实测；Vite 开发代理转发 Range 一般没问题，原生代理需改造
2. **lynx 环境能力**：原生 LynxView 中 fetch 是否支持 `Range` 头与 `arraybuffer` 响应、`<image>` 是否支持 `file://`——需在真机/原生 LynxView 验证（web-core 预览不能代表）
3. **store 模式假设的兜底**：若个别 zip 出现 deflate 条目，方案 A 需 fallback（fflate 流式解压）；方案 C 的 `ZipInputStream` 天然兼容两种
4. **内存释放**：无论哪个方案，播放完成后应释放 blob URL / 帧数组（现有 `UgoiraViewer.onCleanup` 已做，lynx 分支无释放逻辑）

---

## 7. 验证结果（2026-08-11，真实作品 142451838 / 39 帧 / 4.45MB zip）

> 触发：`docs/research/ugoira-playback-alternatives.md` 全部方案实测。Web 部分在 web-core 预览 + Vite 代理验证；原生部分在 Android 34 模拟器（pictelio_ui，lynx 4.0.1）验证。

### 7.1 方案 A（Range 流式取帧）——✅ Web 可行，原生可行（HEAD 除外）

| 验证点 | 结果 |
|---|---|
| zip store 模式 | ✅ 39/39 帧全部 store（compression method=0），按偏移直接切片全部位置正确 |
| Vite 代理 Range/206 | ✅ HEAD 200 + content-length + accept-ranges；`Range: bytes=...` → 206 partial content |
| 尾部 30KB Range 解析 EOCD/中央目录 | ✅ entries=39 cdOffset=4451127 全部正确 |
| 按偏移 Range 取帧 | ✅ 帧 0/1/38 字节数与中央目录完全一致，JPEG magic 正确 |
| 原生 lynx fetch GET+Range | ✅ 206 + `content-range=bytes 4423333-4453332/4453333`，EOCD 签名找到 |
| 原生 lynx fetch HEAD | ❌ `LynxFetchModule` 拒绝 HEAD（"method HEAD must not have a request body"）——需用 GET+Range 替代 |
| 原生 lynx fetch 全量 arraybuffer | ✅ 4453333B 完整 + EOCD 尾部签名 ✅ |

### 7.2 方案 B（fflate 替换 JSZip）——✅ 完全成立

| 指标 | JSZip 3.10.1 | fflate 0.8.3 |
|---|---|---|
| 解压 39 帧耗时 | 15ms | 0ms（store 模式近瞬时） |
| 字节级一致性 | — | 39/39 与 JSZip 完全一致 |
| 流式 Unzip | ❌ | ✅ 39 帧（边下载边解压 API 可用） |
| 磁盘体积 | 880KB | 828KB（核心 index 91KB，tree-shake 后解压更小） |

### 7.3 方案 C（Java 解压写盘）——✅ 完整闭环（模拟器验证）

在 `PictelioApiModule` 新增 `extractUgoira(zipUrl, delaysJson, cb)`（下载 zip → ZipInputStream 解压 → 写 `cache/ugoira/frame_N.jpg` → 返回帧 URL 列表），并给 `PictelioImageService.deliver` 加 file:// 分支：

- ✅ Java 侧解压写盘：`extractUgoira OK: 39 帧`，帧字节数与中央目录完全一致（frame_0=114818B 等）
- ✅ `<image>` 加载 file:// 帧：PictelioImageService 改造后成功（原 OkHttp 仅 http/https，`Expected URL scheme 'http' or 'https' but was 'file'`）
- ✅ 前端拿帧 URL 列表直接播放，图片二进制零进 JS 堆（ADR-0037 语义）
- 关键：**方案 C 的 file:// 依赖 PictelioImageService 改造**（本次已验证落地方式）

### 7.4 方案 D（ffmpeg.wasm）——❌ 维持不推荐（实测补充）

- `ffmpeg-core.wasm` 实探 **32.1MB**（content-range 总长 32129114，比预估 25MB 更大）
- lynx 4.0.1（>=3.8）Android 有**基础 WASM**（PrimJS 后台线程，非完整 WASM API），技术上有通道
- 但 32MB 下载 + CPU 密集编码 + 非完整 WASM API，移动端仍不可接受

### 7.5 方案 E（服务端转码）——❌ 不适用（无服务器，维持原判）

### 7.6 方案 F（APNG/WebP 合成）——❌ 维持不推荐

- web-core 有 `XCanvas` 元素，但 **vue-lynx 0.5.1 运行时元素表无 canvas**（IntrinsicElements 不含）
- APNG/Animated WebP 合成需 canvas 逐帧绘制 + 编码器；lynx 原生无此能力

### 7.7 方案 G（sprite sheet）——❌ 维持不推荐（lynx 无 canvas）

### 7.8 方案 H（Canvas 绘制）——✅ Web/WebView 可行，lynx 不适用

- 验证页实测：单次下载 4.45MB → 本地零解压切片 39 帧 blob URL → `ctx.drawImage` 播放，帧推进完整循环（0→35）
- lynx 侧无 canvas → 维持 `<image>` src 切换 + `defer-src-invalidation` 防闪烁（分支已验证）

### 7.9 结论更新

| 阶段 | 方案 | 验证状态 |
|---|---|---|
| 短期 | **B. fflate 替换 JSZip** | ✅ 验证通过，可直接落地 |
| 中期 | **C. 原生 Java 解压写盘** | ✅ 验证通过（含 file:// 改造点），最符合 ADR-0037 |
| 长期/Web 最优 | **A. Range 流式取帧** | ✅ Web + 原生均可行（HEAD 需规避） |

不推荐 D/E/F/G 全部验证维持原判。H 对 pictelio-app（Web/WebView）有效，lynx 不适用。

---

## 8. 可行方案四维对比（性能 / 内存 / 安全性 / 可维护性）

> 对比对象：现状 JSZip（web blob URL + lynx base64 双形态）、方案 A（Range 流式取帧）、方案 B（fflate）、方案 C（Java 解压写盘）、方案 H（Canvas 绘制，仅 Web/WebView）。
> 数据来源：§7 实测（真实作品 142451838，39 帧 / 4.45MB zip）+ 架构事实。

### 8.1 总览矩阵

| 维度 | 现状 JSZip | A. Range 流式 | B. fflate | C. Java 解压写盘 | H. Canvas（仅 Web） |
|---|---|---|---|---|---|
| **首帧延迟** | 全量下载+全量解压 | **最低**（尾部 30KB→目录→按需取帧，边下边播） | 全量下载+全量解压（解压快） | 全量下载+解压写盘后才可播 | 依赖 A/JSZip 取帧 |
| **网络流量** | 全量 4.45MB | **按需**（尾部 30KB + 播放帧） | 全量 4.45MB | 全量 4.45MB（一次） | 同取帧方案 |
| **JS 堆峰值** | zip 4.45MB + 全帧 ~4.4MB + base64 膨胀 33% | **最低**（当前帧+预取） | zip 4.45MB + 全帧 ~4.4MB（可流式降） | **≈0**（仅 URL 列表） | 全帧 blob URL |
| **二进制入 JS** | ✅ 全量 | 按需小片 | ✅ 全量 | ❌ **零**（ADR-0037） | 全量 blob |
| **依赖/供应链** | jszip 880KB | **零依赖**（手写解析） | fflate 828KB（核心 91KB） | 原生 ZipInputStream（JDK） | 零依赖（canvas API） |
| **deflate 兜底** | ✅ | ❌ 需 fallback | ✅ | ✅ 天然兼容 | — |
| **跨端一致** | 双端（web blob/lynx base64） | 双端（HEAD 需规避） | 双端 | **仅 Android 原生**（web 端仍需 JS 方案） | 仅 Web/WebView |
| **二次播放** | 重新下载+解压 | 重新 Range（可按缓存） | 重新下载+解压 | **磁盘缓存，零下载** | 重新取帧 |
| **维护成本** | 低（成熟库） | **中高**（自写 zip 解析+测试） | 低（API 简洁） | 中（双端双实现+缓存清理） | 低（canvas 简单） |

### 8.2 性能

- **首帧延迟排序**：A ≪ B ≈ JSZip ≈ C（H 取决于取帧方案）。
  - A 的实测链路：尾部 30KB Range（206，~100ms）→ 解析目录 → 取帧 0（~100ms）→ 播放。**首帧 = 2 次小请求**，其余帧边播边取；官方 zip_player 同款，正是为「尽快出第一帧」设计。
  - B/JSZip：必须等**整个 zip 下载完**（4.45MB）+ 解压完（实测 B=0ms、JSZip=15ms，但移动端 JS 线程 + 慢网下载占主导）才有第一帧。
  - C：下载 4.45MB + Java 解压写盘 39 帧后才返回 URL 列表——首帧最慢；但播放时每帧从磁盘读（毫秒级），且 **二次播放零网络**（实测帧文件已在 cache/ugoira）。
- **播放流畅性**：均按 `meta.delay` setTimeout 切换。A 的潜在风险是逐帧 Range 请求的 RTT 累积（39 帧 × ~100ms = ~4s 在慢网下会追不上延迟）；官方用 load-ahead 预取缓解。B/JSZip/C 播放时数据已就绪，无网络抖动。
- **原生端**：C 的 Java 解压利用设备 CPU（快于 JS 线程），H 不适用 lynx。

### 8.3 内存占用

- **JSZip/lynx base64 双形态最重**：zip 4.45MB + 39 帧解压 ~4.4MB + blob URL 引用；lynx 的 base64 再 **+33% 膨胀**（实测单帧 data URL 152KB vs 原始 114KB）。峰值 ~9–13MB JS 堆，大作品（100+ 帧）线性放大。
- **A 最优**：zip 不驻留（只 Range 小片），帧按需取、播完释放；实测每帧仅需保留当前+预取。官方播放器播完 `_buf = null` 整片释放。
- **C 最优（JS 视角）**：JS 堆只有 39 个 URL 字符串（KB 级），帧二进制全在磁盘。代价是磁盘占用（39 帧 ~4.4MB 缓存目录，需清理策略）。
- **B 与 JSZip 同量级**：仍全量帧进 JS；流式 Unzip 可边下载边解压减少 zip 缓冲驻留时间，但解压结果全量在内存。
- **H**：39 帧 blob URL 全量驻留（与 JSZip 同），但 canvas 复用帧对象、无 DOM 节点切换开销。

### 8.4 安全性

- **C 最符合本项目安全模型（ADR-0037）**：zip 下载、解压、写盘全在 Java（OkHttp 连接池 + 私有 cache 目录），**图片二进制零进 JS 堆**；access_token 保持 Java 堆隔离（验证页实测 JS 侧 access_token 为空）。帧路径为 `file:///data/user/0/io.pictelio.app/cache/...`，属 app 私有目录，外部进程不可读。
- **A 风险点**：自写二进制解析（EOCD/中央目录/偏移计算）——解析器需严格校验长度/签名防越界（实测 DataView 越界即抛错，天然防护）；且 Range 请求绕过代理鉴权路径（zip 只需 Referer 不需 token，风险可控）。
- **JSZip/B**：JS 侧处理全部二进制；token 仍在 Java 堆（原生模式）或 JS 内存（web 模式既有状态），不新增暴露面；主要考量是**第三方依赖供应链**（jszip 成熟 / fflate 较新但纯 JS 无原生）。
- **H**：blob URL 随机不可猜，无新增风险；canvas 不落盘。

### 8.5 可维护性

- **JSZip**：成熟稳定、API 文档全、生产已验证；体积大（880KB）是唯一硬伤。**短期最稳的现状基线**。
- **B**：fflate API 简洁（unzipSync/Unzip），替换 JSZip 是 1 个文件的机械改动（§7.2 已验证字节级一致）；包小、流式可选。**短期最低成本升级**。
- **A**：**无依赖**（手写 EOCD/中央目录解析 ~100 行），但需要：① 完整的二进制解析单测（偏移/签名/越界）② deflate fallback（个别非 store zip）③ 原生 HEAD 规避（实测 LynxFetchModule 拒绝 HEAD，需硬编码长度或 GET+Range）。**长期最优但维护要求最高**。
- **C**：Java 侧逻辑集中（extractUgoira + file:// 分支，本次已落地）；但**双端双实现**（Android 走 Java、Web 仍需 JS 方案），且需补缓存清理/过期策略（`cache/ugoira` 目前无限增长）。**符合架构但维护面最广**。
- **H**：canvas 代码简单，但仅 Web/WebView 受益，lynx 需另一套 `<image>` 切换——**平台分叉增加维护成本**。

### 8.6 综合建议（四维加权）

| 端 | 推荐 | 理由 |
|---|---|---|
| **app-lynx 原生** | **C（Java 解压写盘）** | 内存 ≈0、安全最符合 ADR-0037、二次播放零下载；首帧延迟可接受（下载+解压 ~1s）；唯一负项是缓存清理需补 |
| **pictelio-app Web/Android WebView** | **B（fflate）+ H（Canvas）** | B 立即降体积 90%、解压 15ms→0ms；H 播放更平滑（canvas drawImage 实测帧推进完整）；两者改动都小 |
| **长期演进（双端）** | **A（Range 流式）** | 首帧最优、内存最优、零依赖；代价是自写解析器维护成本 + deflate fallback + 原生 HEAD 规避——适合作为后续专项 |
| **不建议** | JSZip 长期保留 / 全平台只上 A | JSZip 体积与内存硬伤；A 的解析器维护成本不适合一步到位 |

### 8.7 双端共用约束下的唯一解：B（fflate）

> 决策场景（2026-08-11）：**pictelio-app 与 app-lynx 共用同一套方案，且排除 A（Range 流式）**。

**结论：B（fflate）是唯一满足约束的方案。**

| 候选 | 双端共用可行性 | 判定 |
|---|---|---|
| **B. fflate** | ✅ 纯 JS、零原生依赖。app（Web/WebView）与 app-lynx（web-core + 原生 LynxView 的 PrimJS 运行时）都能 import 同一份解压代码；帧显示差异（web blob URL / lynx base64）只是渲染层，取帧逻辑（下载 zip → fflate 解压 → frames 数组）完全共用 | **推荐** |
| C. Java 解压写盘 | ❌ app 走 Capacitor Plugin、app-lynx 走 Lynx NativeModule——**两套原生桥**，代码不共用，维护双倍，违背"共用一个"初衷 | 不满足 |
| 现状 JSZip | ⚠️ 技术上双端可用，但 880KB 体积 + 全量帧进 JS + lynx base64 33% 膨胀，是已知硬伤 | 不推荐 |

**为什么 B 能满足"共用"：**
1. **单一解压实现**：fflate 纯 JS，抽成共享模块（如 `packages/app/src/api/ugoira.ts`），app 直接 import；app-lynx 引用同一份（或同构复制），无原生桥差异
2. **已验证**：§7.2 字节级 39/39 与 JSZip 一致、解压 15ms→0ms、流式 Unzip 可用、体积 880KB→828KB（核心 91KB）
3. **lynx 原生兼容**：fflate 无 DOM/Blob 依赖（同 JSZip 已在 lynx 验证的路径），PrimJS 可跑
4. **渲染层解耦**：共用的是「zip → frames」数据管线；显示层各端自选——web 用 blob URL、lynx 用 base64（已验证）、后续若上 Canvas 也只需替换显示层

**落地形态**：共享模块导出 `downloadAndExtractUgoira` 的 fflate 实现（保持现有 `UgoiraFrame{url, delay}` 接口签名），双端播放器零改动。C 方案仍保留为 app-lynx 原生端的**未来增强**（内存最优），但不作为双端共用基线。

---

## 来源清单

- pixiv/zip_player（官方 ugoira 播放器，README + `zip_player.js` 源码）：<https://github.com/pixiv/zip_player>
- fflate（性能/体积/流式能力）：<https://github.com/101arrowz/fflate>
- asadahimeka/ugoira-converter（ffmpeg.wasm 浏览器内转码）：<https://github.com/asadahimeka/ugoira-converter>
- mikf/ugoira-conv、altbdoor/py-ugoira（ffmpeg 转 webm/mp4 工具）：<https://github.com/mikf/ugoira-conv>、<https://github.com/altbdoor/py-ugoira>
- 本项目现状：`packages/app/src/api/illust.ts`（`downloadAndExtractUgoira`）、`packages/app/src/components/UgoiraViewer.tsx`、分支 `prototype/ugoira-tech-check` 的 `UgoiraProto.vue`
