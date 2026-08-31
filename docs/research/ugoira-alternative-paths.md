# Ugoira Android 端出图慢/非流式的替代路径调研（第二弹）

> 记录日期：2026-08-31（联网抓取一手来源；一并核对仓库内既有研究文档与源码；后台调研代理同主题深度产出已并入 §1/§2/§4）
> 触发背景：用户追问「range 是官方方案为何失效——那**还有别的方案**吗？联网深入找找」。
> 前置文档：`docs/research/ugoira-range-official-scheme-research.md`（官方 zip_player vs 我们拦截层）、
> `docs/research/ugoira-playback-flicker-range-proto.md`（CDP 实测）、`docs/adr/ADR-0126`（已采纳降级方案）。

> **结论速览（矩阵见 §6，推荐试验顺序见 §7）**：
> 1. **流式 fflate（「边下边播」，不依赖 Range）**——**第一优先**。核心依据（已源码核对，§1）：fflate 的 `Unzip` 是真流式（`push(chunk, final?)` 逐块喂入 + `onfile` 逐条目回调），**只扫描 local file header、不读中央目录/文件尾，能在不读完全量字节的情况下按 wire 顺序吐条目**；store 帧零解压直通（Pixiv ugoira zip 为 store，官方 zip_player L246–248 断言）。保守设计：**播放序由 `meta.frames[]` 驱动、按 `file.name` 映射帧索引**（官方 zip_player 与本库均如此，对 zip 物理序不敏感）；仓库对 148861562/149104861 观察到条目序==帧序，但**无公开权威来源断言**。落地：用现有 `fetch` 全量 200 通道（拦截器正常路径，已验证可用）边读边 `Unzip.push`，第 N 帧字节到达即可播第 N 帧——**无需 Range、无需等全量**。
> 2. **Capacitor 原生桥批量 Range**——**备选，需原型（且形态须修正）**。Capacitor 官方对"大载荷二进制"的建议是**不要**把字节搬过桥（base64 +33% + JSON 序列化 + WebView call 成本，正是官方「Large File Support」警告场景），而是**Java 解到缓存 + 返回 `file://`/`convertFileSrc` URL**（§2）。故它**收敛到 lynx 已落地的 ADR-0125 管线**（Java 解压写盘）——技术上可行（Java 已有共享 OkHttp + Referer/UA 注入），价值是「帧字节零进 JS 堆 + 二次播放零下载 + deflate 兜底」，**不是**省流量流式。边际价值低于方案①，需**独立的**移植改动。
> 3. **WebView 版本演进**——**不可依赖**。模拟器 WebView **113.0.5672.136**（2023），Play 商店当前稳定版约 **141+**（2026）。未查到"某版本起 `shouldInterceptRequest` 的 206 截断被修复"的权威记录；Capacitor 侧确有 206/Range 修复（#8368，8.2.0 起）但针对**其自身本地文件服务**，不是本项目自定义 `MainActivity.interceptImage`。版本门槛不可作为产品依赖（大量设备卡旧 WebView）。
> 4. **Pixiv 视频化作品**——**确定不可行**。多份一手 API 类型/规范确认：**Pixiv App-API 的 `illust.type` 是封闭联合 `"illust" | "manga" | "ugoira"`，无 `video` 类型、无 `video_urls` 字段**（book000/pixivts `Illust.d.ts`、hanshsieh api.yaml IllustType enum 等）。「Video [動画]」是 ugoira 的作者自述（Pixiv 官方帮助：ugoira=PNG/JPEG 帧动画，非视频文件）；动图作品在 API 层**全为 ugoira**（覆盖率 0），故 `<video>` 方案**无适用对象**。
> 5. **冷门路径**（§5）：Service Worker 拦截、`WebViewAssetLoader` Range、`<img>/<video>` 元素级 Range、PWA/系统播放器 intent、服务端转码——均判定**不可行或低价值**。

---

## 0. 已被实验排除的路径（不复述细节，引用证据）

| 路径 | 排除依据 |
|---|---|
| 直连 CDN 绕过拦截器（fetch 绝对 URL） | i.pximg.net 防盗链严格：无 Referer→403、`Referer: https://localhost/`→403、`Referer: https://app-api.pixiv.net/`→206（host curl 实测 2026-08-31）；且 fetch 规范中 Referer 是 forbidden header name，JS 无法伪造 → **不可行** |
| 拦截器实现 Range/206 | CDP 实测：start>0 拦截 206 截断为 1B / `net::ERR_FAILED`（原型报告 §2.2） |
| 原生端隐藏 range 设置 | 妥协方案，用户否决（取消诉求） |

---

## 1. 方案 A：流式 fflate 渐进播放（「边下边播」，不依赖 Range）——**推荐第一优先**

### 1.1 一手证据：fflate `Unzip` 是真正的流式 ZIP 解压器（源码行号已核对）

仓库依赖 fflate 0.8.3（`packages/ugoira/package.json` → `"fflate": "^0.8.3"`）。行号均指 <https://raw.githubusercontent.com/101arrowz/fflate/v0.8.3/src/index.ts>（3854 行；`Unzip` 区段 3400–3730 与 master 逐字节一致）。

**fflate 有两条本质不同的 ZIP 解压路径**：
- **(A) 流式类 `Unzip` + 解码器** —— 前向、local-header 驱动、**边发现边吐条目**。`src/index.ts`：
  - `class Unzip` **L3592 起**：`constructor(cb?)` **L3609** 存 `this.onfile`；`push(chunk, final?)` **L3623–3708**（流式解析核心）；`register(decoder)` **L3715–3717** → `this.o[decoder.compression] = decoder`；`onfile` **L3722**。默认注册表只含 `{0: UnzipPassThrough}`（**L3612–3615**），即 store（未压缩）默认支持；deflate 需另行 `register`。
  - 解码器（`UnzipDecoder` 契约 **L3402–3420**）：`UnzipPassThrough` **L3528–3535**（`compression=0`，`push` 直通 `ondata(null, chunk, final)`——**零解压**）；`UnzipInflate` **L3541–3562**（deflate，同步）；`AsyncUnzipInflate` **L3567–3593**（deflate，仅 `sz>=320000` 时才开 worker，L3577）。
- **(B) 聚合函数 `unzip`/`unzipSync`** —— 中央目录驱动、需整文件。`unzip` **L3743–3811**、`unzipSync` **L3820–3854**：从**文件尾**回扫 EOCD 签名 `0x6054B50`（`unzip` **L3755–3756** / `unzipSync` **L3822–3824**），读条目数 `b2(data, e+8)`（**L3762/L3826**）与中央目录偏移 `b4(data, e+16)`（**L3765/L3828**），再按条目数迭代中央目录（**L3777/L3840**）构建 name→bytes 映射（`files[fn]` **L3784/L3848**）。**必须先拿到文件尾 + 中央目录才能解出任何条目。**

> ⚠️ 注意 `filter`/`UnzipFileFilter`/`UnzipFileInfo` **属于 `unzip`/`unzipSync`**（`UnzipOptions` 字段 **L2510–2514**、`UnzipFileInfo` **L3445–3468**、`UnzipFileFilter` **L3475**）；**`onfile` 才是流式 `Unzip` 的吐条目回调**，它收到一个完整 `UnzipFile`（`UnzipFile` 接口 **L3480–3523**）：`{name, compression, size?, originalSize?, ondata, start(), terminate()}`——需先设 `file.ondata` 再调 `file.start()` 才真正流式吐数据（README L337–377）。

### 1.2 决定性结论：`Unzip` 能在**不读完全量字节、不依赖中央目录**的情况下按序吐条目（源码证明）

**[PROVEN]** `Unzip` 只扫描 **local file header 签名 `0x04034b50`**：
```ts
3643  for (; i < l - 4; ++i) {
3644    const sig = b4(buf, i);
3645    if (sig == 0x4034B50) {          // ← local file header
3646      f = 1, is = i; ...
3649      const bf = b2(buf, i + 6), cmp = b2(buf, i + 8), ... fnl = b2(buf, i + 26), es = b2(buf, i + 28);
3650      if (l > i + 30 + fnl + es) {     // ← 只要本地头(签名+名+extra)到齐即进
...
3682      this.onfile(file);               // ← 本地头解析完就吐该条目 handle
```
- **`onfile` 在本地头（签名+名字+extra 字段）到齐时就触发**，即只需 `i+30+fnl+es` 字节到达，**不等条目尾、不等中央目录**。
- 条目大小**来自本地头自身**（**L3654**）：`let lsc = b4(buf,i+18), lsu = b4(buf,i+22)`；若通用标志位 bit3 清零（`dd = bf & 8`），`this.c = sc` 被设为**精确压缩大小**（**L3659**），`Unzip` 据此知道该条目占多少字节并可精确流式喂给解码器（**L3626–3633**：`if (this.c > 0) { ... this.d.push(toAdd, !this.c); }`——**该条目字节耗尽即 `final=true`**）。
- **不需要总文件大小**：`push` 只收 `(chunk, final?)`（**L3623**），纯增量。需要的唯一"大小"是每个条目在本地头里记录的大小。
- 中央目录签名 `0x02014b50`（**L3689**）与 data descriptor `0x08074b50`（**L3686**）**只在** `else if (oc)` 分支匹配（`oc`=上一条目未消化的压缩大小，**L3642**）；条目之间（`oc==0`）唯一起始签名就是 `0x04034b50`。⇒ **`Unzip` 从不读取也不依赖中央目录/文件尾**。

**[PROVEN]** `Unzip` 发出顺序 == **wire 顺序（local header 出现顺序）**：因为只有碰到下一个 `0x04034b50` 才开始新条目（**L3645**），文件按它们在字节流中出现的顺序被逐条吐出来。这与 `unzip`/`unzipSync` 的**中央目录/map 顺序**不同。

**[PROVEN 旁证]** fflate **discussion #199**（<https://github.com/101arrowz/fflate/discussions/199>，`zipSync can get order of ZIP entries wrong, due to how objects work`）指出**对象型返回值（`unzipSync`）的 ZIP 条目顺序不可靠**（JS 对象键序问题）——**支持**改用流式 `Unzip`（按 `onfile` 依 wire 顺序回调、不依赖对象键序）来对「第 N 个条目」做确定性处理。

### 1.3 帧序关键判据：**设计上做成"按名映射、帧序由 `meta.frames[]` 驱动"，对 wire 顺序不敏感**

**[PROVEN]** 官方 `pixiv/zip_player` 与本仓库 `@pictelio/ugoira` **都按名（中央目录）取帧、由 `metadata.frames[]` 驱动播放序**，即**都对 zip 内部物理顺序不敏感**：
- `zip_player.js`：读 EOCD+中央目录建 name→offset 映射（`_readCentralDirectory` **L233–258**，`this._files[name] = {off, len}` **L258**）；播放序来自 `metadata.frames[]`（**L91** `this._frameCount = this.op.metadata.frames.length`；**L328** `var meta = this.op.metadata.frames[frame]`；**L339** `this._fileDataStart(this._files[meta.file].off)` 按名取 **L310–311**）。
- `zip_player.js` **仅支持 store**：`if (compMethod != 0) this._error("Unsupported compression method")`（**L246–248**）——旁证 Pixiv ugoira zip 为 store。
- `.file` 名是**零填充数字**（`000001.jpg`，原始 Pixiv "ugoku player" 作者 marcan 文档：<https://marcan.st/talks/2014_pixiv_ugoku_player/>，`frames: [{file:"000001.jpg", delay:40}, ...]`）。

**[repo 内实测观察]** 本仓库对真实作品 **148861562（52 帧）** zip 中央目录做过解析：条目 `000000.jpg`…`000051.jpg`，**条目顺序==数值序、无杂条目**，与 `meta.frames[]` 同序；佐证样本 **149104861（406 帧）**（`ugoira-playback-flicker-range-proto.md` 同批）。⚠️ **此为 repo 内样本观察，非公开权威声明**——**未找到任何权威来源**明确写出「Pixiv ugoira zip 条目物理序 == `meta.frames[]` 序」。

**[INFERRED / 保守设计]** 零填充数字名 + 生产端按时间序打包 ⇒ "物理序==帧序" 大概率成立；但**不应依赖它**。稳妥设计（也是官方与现库已采用的）：**播放序由 `meta.frames[]` 驱动，`Unzip` 的 `onfile` 吐出的条目按 `file.name` 映射到帧索引**；若 wire 序==帧序则边下边播；若不一致则缓冲乱序帧直到可顺序播放——**仍避免全量下载**（仅可能需等个别迟到帧）。

**推论（落地形态）**：用现有 `fetch` 全量 200 通道（拦截器正常路径，已验证可用，非 Range）读 body，`reader.read()` 的 chunk 直接 `unzip.push(chunk, false)`，`onfile` 里 `file.start()` 流式取帧；最后一个 chunk `unzip.push(last, true)`（**L3704–3707**）。store 帧零解压直通（**L3528–3535**），第 N 帧在其字节到达后即可播，无需等全量。

### 1.4 收益与成本

| 维度 | 现状（降级 fflate 全量） | 方案 A（流式渐进） |
|---|---|---|
| 首帧延迟 | 全量下载完（~8s @12.9MB） | 前几帧到达即播（帧均几十 KB，预计 **1-3s**，依赖网速） |
| 内存峰值 | 全量 zip 驻留 JS + 全帧 blob | fflate 不保留已处理部分；已播帧 blob 可逐帧 revoke（峰值更低） |
| 传输 | 全量 200（不变） | 全量 200（**不变**，不碰拦截层） |
| 代码面 | — | `illust.ts`：fetch reader → `Unzip.push` 循环 + `onfile` 里 `file.start()` 接播放器；防御：按 `file.name` 映射帧索引；首条目名异常/乱序 → 回退现有 `unzipSync` 全量路径（自愈） |
| 可测试性 | — | `Unzip` 是纯函数库；可用构造 zip 字节流分片 push 单测（增量帧回调断言） |

### 1.5 风险与边界（含 fflate 用法注意事项 [PROVEN]）

- **必须调 `file.start()`**：`onfile` 里不调 `file.start()` 则该帧数据只缓冲在内存（L3651–3652/L3631/L3672–3674），`ondata` 永不触发——**须先 `file.ondata = ...` 再 `file.start()`**（README L349–367）。
- **deflate 需 `register`**：store（comp 0）默认 `UnzipPassThrough` 即可；deflate（comp 8）需 `register(UnzipInflate)` 或 `register(AsyncUnzipInflate)`（`start()` 对未注册的压缩法抛错，L3668–3669）。Pixiv ugoira zip 为 store（zip_player L246–248），默认即够；`AsyncUnzipInflate` 仅在 `sz>=320000` 才开 worker（L3577），小帧同步解压。
- **收尾 `final=true`**：最后一个 chunk 要 `push(last, true)`（L3704–3707），否则可能不关闭/报错。
- **清理**：`Unzip` 无全局 `terminate()`；`AsyncUnzipInflate` 才需每文件 `file.terminate()`；`UnzipPassThrough` 无 worker，store 帧零清理负担。
- **每 chunk 条目数建议**：README 建议每 chunk 不超过 ~5000 文件（L371–373）。
- **顺序假设基于实测样本（2 个作品）+ 按名映射防御**：播放序由 `meta.frames[]` 驱动，`Unzip` 吐出的帧按 `file.name` 映射到帧索引，乱序则缓冲——**无正确性风险，只有收益损失**（可能需等个别迟到帧）。
- 进度语义：现有进度环（0-100%）改为「已出帧数/总帧数」或保留下载字节进度均可。
- 该方案**不解决**「只取需要的帧省流量」（那需要 Range，被拦截层否决）——它解决「更快出图、更低峰值内存」。若未来要**省流量**，再看方案 B。

### 1.6 一手源码引用（已核对，非待核）

- `Unzip` 类：`src/index.ts` **L3592**（`class Unzip`）/ **L3609**（constructor）/ **L3623–3708**（`push`）/ **L3715–3717**（`register`）/ **L3722**（`onfile`）；local-header 扫描与吐条目：**L3643–3645 / L3650 / L3682**；条目大小取本地头：**L3654 / L3659**；增量喂给解码器：**L3626–3633**；收尾 `final`：**L3704–3707**；`onfile` 载荷 `UnzipFile`：**L3480–3523**。
- 解码器：`UnzipPassThrough`（store 直通）**L3528–3535**、`UnzipInflate`（deflate 同步）**L3541–3562**、`AsyncUnzipInflate`（worker 阈值 320000）**L3567–3593**。
- 聚合函数（中央目录驱动）：`unzip` **L3743–3811**、`unzipSync` **L3820–3854**（EOCD 回扫 **L3755–3756 / L3822–3824**、中央目录迭代 **L3777 / L3840**）。
- `filter`/`UnzipFileInfo`/`UnzipFileFilter`：**L2510–2514 / L3445–3468 / L3475**（属 `unzip`/`unzipSync`，非 `Unzip.onfile`）。
- 源码：<https://raw.githubusercontent.com/101arrowz/fflate/v0.8.3/src/index.ts>（与 master 3400–3730 逐字节一致）；README 流式用法 <https://raw.githubusercontent.com/101arrowz/fflate/master/README.md#L337-L377>；API 文档 `docs/classes/Unzip.md`、`docs/interfaces/UnzipFile.md`、`docs/functions/unzip.md`、`docs/functions/unzipSync.md`。

---

## 2. 方案 B：Capacitor 原生桥批量 Range（绕开拦截层的真 Range）——备选，需原型

> ⚠️ 重要修正：**Capacitor 桥对"大载荷二进制"的官方建议是**不要**把字节搬过桥（base64），而是写缓存文件 + 返回文件路径**。故方案 B 的**推荐形态**不是「Range 取帧 → base64 过桥」，而是 **Java 把帧解到缓存 + 返回 `file://`/`convertFileSrc` URL**——这恰好**收敛到 lynx 已落地的 ADR-0125 管线**（Java 解压写盘）。«Range 逐帧 + base64 过桥» 这一名义形态被官方文档否决。

### 2.1 Capacitor 桥契约（一手，已核对）

**[PROVEN] 桥只支持 JSON 可序列化类型**（官方「Data Types」）：
> "Data moving between the web runtime and native environments in Capacitor have to be serialized and deserialized … The supported data types are those that can be represented in JSON such as numbers, strings, booleans, arrays, and objects."
> "Data moving from native code to the web view will be serialized as JSON."
> — <https://capacitorjs.com/docs/core-apis/data-types>

- **`PluginCall.resolve()` 只收 `JSObject`**：`resolve(JSObject data)` / `resolve()` 是唯一签名，**没有 `resolve(byte[])`**（`PluginCall.java`：<https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java>）。`JSObject extends org.json.JSONObject`、`JSArray extends org.json.JSONArray`（<https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/JSObject.java>、`.../JSArray.java`）。
- **`byte[]` 不是合法桥类型**：`@capacitor/filesystem` 与 `@capacitor/http` 都要求二进制要么 **base64 字符串**、要么**写盘给文件路径**（见下）。
- **`registerPlugin` TS 类型**：`RegisterPlugin = <T>(pluginName, implementations?) => T`（`@capacitor/core` `definitions.ts`）；运行时 `registerPlugin` 建 `Proxy`，按方法签名分发到 `nativePromise`（value 法）/ `nativeCallback`（callback 法）/ `addListenerNative`（`runtime.ts`）——**无 byte[]/ArrayBuffer 特例**，全是 JSON options 进 / JSON result 出。

### 2.2 大载荷与高频回调（官方性能指导 [PROVEN]）

- **官方「Large File Support」警告**（`@capacitor/http`）：
  > "Due to the nature of the bridge, **parsing and transferring large amount of data from native to the web can cause issues**. Support for downloading and uploading files has been added to the @capacitor/file-transfer plugin. In many cases, you may also need @capacitor/filesystem to generate a valid file URI."
  > — <https://capacitorjs.com/docs/apis/http>
- **官方的替代方案就是"写盘 + 文件 URI"**：`@capacitor/filesystem` 提供 `readFileInChunks`（8.1.0 起）+ native 专用 `offset`/`length`（部分读取）；`convertFileSrc` 把设备 `file://` 重写为 Capacitor 本地 web 服务器 URL：
  > "on Android, `file:///path/to/device/file` must be rewritten as `http://localhost/_capacitor_file_/path/to/device/file` before being used in the Web View."
  > — <https://capacitorjs.com/docs/basics/utilities>
- **高频回调节流**（`@capacitor/filesystem` / `file-transfer`）：进度事件「**Chunks are throttled to every 100ms on Android/iOS to avoid slowdowns**」——对高频桥回调的官方节流先例（<https://capacitorjs.com/docs/apis/filesystem>、<https://capacitorjs.com/docs/apis/file-transfer>）。
- **硬字节上限：未找到**（NOT FOUND）——官方只有定性「large … can cause issues」，并给出磁盘/文件 URI 而非按字节过桥。

### 2.3 对本项目的落点

- **名义形态否决**：`ugoiraRange(zipUrl, rangesJson)` → Java Range → base64 过桥 → JS 解析：**不建议**。base64 +33% + JSON 序列化 + WebView call 成本，正是官方「Large File Support」警告的场景（大 zip 每帧数百 KB × 数十帧）。
- **推荐形态（收敛到 ADR-0125）**：Java 下载 zip（OkHttp，Referer/UA 注入现成，`PixivApiCore.getSharedClient()`）→ (若要做 Range 省流量，Java 侧按 store 偏移切片；否则 `ZipInputStream` 全量) → **逐帧写盘** `cache/ugoira/<illustId>/frame_N` → 回调帧 `file://` URL 列表（或 `convertFileSrc` → `http://localhost/_capacitor_file_/...`）。JS 只拿 URL 列表，字节零过桥。这与 lynx `ugoiraExtract`（ADR-0125）**同构**。
- **重要性**：`MainActivity.interceptImage` 只短路 `/pixiv-img/`，其余委托给 Capacitor 原生 WebViewClient（`MainActivity.java` L144–153）——所以 `_capacitor_file_`/`convertFileSrc` 的 URL **不经过损坏的图片拦截器**，可正常走 Capacitor 本地文件服务（其 Range 头大小写 bug 已在 8.2.0 修复，见 §3.3；但**完整 Range/206 支持仍未完成**，见 #1343/#7789——本场景只用 200 全量渲染帧，不依赖它）。
- **再缓存/二次播放**：帧已落盘（ADR-0125/ADR-0126 P3 的 ugoira 缓存命中语义），二次打开零下载。

### 2.4 代价与结论

- **代价**：新 Java 方法（webview 侧 `PixivApiPlugin` 加 `ugoiraExtract` 之类）+ JS 契约 + 测试 + 缓存清理 + `file://` 白名单放行（`isInUgoiraCacheDir`）+ 双端（app/lynx）各一套原生面——**高于方案 A**。
- **结论**：方案 B 的**收益**是「帧字节零进 JS 堆（符合 ADR-0037 精神）+ 二次播放零下载 + deflate 兜底」，**不是**省流量流式（Range 若省流量也须 Java 切片→写盘，非 bridge）；其价值取决于"是否要帧字节零进 JS 堆 + 二次缓存"。若方案 A 已满足「快出图 + 低内存」，B 仅在**确有"字节零进 JS/二次缓存"硬需求**时再上（且那其实就把 lynx 的 ADR-0125 管线移植到 app-webview 插件，是个**独立的、明确的**改动）。

---

## 3. 方案 C：WebView 版本演进（无证据，不可依赖）

### 3.1 本机版本（2026-08-31 adb 实测）

```
$ adb -s emulator-5556 shell dumpsys webviewupdate
  Current WebView package (name, version): (com.google.android.webview, 113.0.5672.136)
  Valid package com.google.android.webview (versionName: 113.0.5672.136, targetSdkVersion: 34) is installed/enabled
```

→ 模拟器 WebView **113.0.5672.136**（对应 Chrome/WebView ~2023 中期）。

### 3.2 当前稳定版对照（联网）

- Play 商店/APKMirror 当前 Android System WebView 已到 **~141.x**（如 <https://nexus2.apkmirror.com/apk/google-inc/android-system-webview/.../141.0.7390.124-release/>，以及 apkpure 138/139/140 等）：<https://apkpure.com/cn/android-system-webview-app/com.google.android.webview/download/138.0.7204.179>、<https://apkpure.com/jp/android-system-webview-app/com.google.android.webview/download/139.0.7258.159>。
- 差距：模拟器 113 → 当前稳定 ~141，**落后约 28 个版本**。

### 3.3 是否已有修复版本（检索结论）

- 针对「`shouldInterceptRequest` 重建 206 截断 / ERR_FAILED / HEAD 头不透明」这一**具体症状**，本轮用新关键词（`shouldInterceptRequest` + `Content-Range`、`WebResourceResponse` + `partial content`、stackoverflow 高赞帖）多轮检索，**仍未找到**一条被主流引用、能直接对应「拦截响应 206 截断」的权威 AOSP/Chromium issue。「某版本起可用」的证据**不存在**。
- 命中的相关事实（**均为 Capacitor/生态侧，非 WebView 级修复**）：
  - **Capacitor PR #8368**（<https://github.com/ionic-team/capacitor/pull/8368>，commit <https://github.com/ionic-team/capacitor/commit/ae0e2ddccb2904ee4b3d47d4be1f7556ac7000a1>）`fix(android): handle lowercase range header`——**已合入 Capacitor 8.2.0**（<https://newreleases.io/project/github/ionic-team/capacitor/release/8.2.0>）。本项目 `@capacitor/core ^8.5.0` 已包含。⚠️ 但该修复针对 **Capacitor 自身本地文件服务（`_capacitor_file_`/asset 路径）的 Range 头大小写 bug**，**不是**本项目自定义 `MainActivity.interceptImage` 的 `/pixiv-img/` 路径（后者恒返 200 全量）。
  - **Capacitor issue #1343**（<https://github.com/ionic-team/capacitor/issues/1343>）：Capacitor 本地文件服务对 `Range: bytes=0-` 返回 200 全量（拦截路径不识别 Range）——旁证拦截路径 Range 处理不可靠。
  - **Capacitor issue #7789**（<https://github.com/ionic-team/capacitor/issues/7789>）：`[Feature]: Add PMTiles Byte Range Request Support`——Capacitor 的 Range 支持仍是**未完成的功能请求**。
  - **cordova-android issue #1494**（<https://github.com/apache/cordova-android/issues/1494>）：`Videos are not seekable (WebViewAssetLoader needs to support range requests)`——WebViewAssetLoader 不支持 Range（§5）。
  - **flutter_inappwebview issue #1893**（<https://github.com/pichillilorenzo/flutter_inappwebview/issues/1893>）：`WebResourceResponse calc wrong content-length`——重建响应后 Content-Length 由 WebView 自算、算错（§0 同向）。

### 3.4 判定

**版本门槛不可作为产品依赖**：即使某新版修复了拦截 206，用户设备 WebView 更新不可控（minSdk 28 老设备尤甚），且本项目现有 WebView≥85 检查仍是「升级提示」而非兼容保证。**不作为备选路径**；仅当知道某版本修复时可作**一次性重测**（优先级低）。若用户仍想验证，可把模拟器 WebView 升到 141（`adb` 侧装 `com.google.android.webview` 新包）重跑原型报告 §2.2 的 CDP 逐请求核验。

---

## 4. 方案 D：Pixiv 视频化作品（API 无 video 类型，**确定不可行**）

### 4.1 [PROVEN] Pixiv App-API **没有 `video` 内容类型**

- **`illust.type` 是封闭联合类型**：`"illust" | "manga" | "ugoira"`。
  - `book000/pixivts`（App-API TypeScript 类型，REST 权威）`lib/types/Illust.d.ts`：`type: "illust" | "manga" | "ugoira";`（另有 `illust_ai_type`、`seasonal_effect_animation_urls{apng,webp}` 等较新字段，**仍无 video**）：<https://github.com/book000/pixivts>
  - `hanshsieh/pixiv-api-doc` OpenAPI `api.yaml`：`IllustType enum = [illust, ugoira, manga]`，整份 spec **无 "video" 字符串**：<https://raw.githubusercontent.com/hanshsieh/pixiv-api-doc/master/api.yaml>
  - 旁证（均无 video）：`pixivpy`（`_TYPE = Literal["illust","manga",""]`，`ugoira_metadata()` 只返回 zip+frames）、`DowneyRem/PixivSource` web API 文档（<https://github.com/DowneyRem/PixivSource/blob/main/doc/PixivWebApi.md>）、`daydreamer-json/pixiv-ajax-api-docs`（<https://github.com/daydreamer-json/pixiv-ajax-api-docs>）。
- **没有任何 `video` / `video_urls` / `profile_video_urls` 字段**；`ugoira_metadata`（`UgoiraMetadata.d.ts`）只有 `zip_urls{medium}` + `frames[]{file, delay}`。用户对象只有 `profile_image_urls`/`background_image_url`，无 `profile_video_urls`。

### 4.2 [INFERRED + 官方] 「Video [動画]」是 ugoira 的作者自述，非独立视频作品

- Pixiv 官方帮助「What are Ugoira?」（<https://www.pixiv.help/hc/en-us/articles/235584628-What-are-Ugoira->）明确：**ugoira = 由动画 PNG/JPEG 帧组成**（animated-GIF 上传、16MB/500 帧上限、"a little bit of animation"），**不是视频文件**。
- 本会话实测 2026-08-31 新作品 caption「2:32 min Video [動画]」但 `type:"ugoira"`、`ugoira_metadata` 仅 `zip_urls+frames`——**正是 ugoira 的形态**。
- 两个子情形（作者把较长 ugoira 标成"video" / caption 外链真实视频但作品本身是 ugoira 循环）**无法从数据区分**（NOT FOUND）；且 2026 语境下无法核实 2025 年后的 API 变更（NOT FOUND）。

### 4.3 [PROVEN] 社区 ugoira→mp4 全是客户端转换，无官方直链

- `gallery-dl` 只对 `work["type"]=="ugoira"` 特判（`pixiv.py` L145/L170、`_extract_ugoira` 读 `zip_urls/frames`）；视频是**客户端转换**（issue #6909：<https://github.com/mikf/gallery-dl/issues/6909>）：<https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/pixiv.py>
- 社区教程（<https://memotut.com/en/efe6eda433b09ec34203/>）「Convert pixiv to mp4…用 pixivpy」同样**客户端转码**，非官方直链。
- 全覆盖判断：**动图作品皆为 ugoira（占比未知，勿引用具体百分比）**；无 video-type 群体、无迁移/mp4 证据。

### 4.4 判定

**Pixiv App-API 无 `video` 类型、无 `video_urls` ⇒ `<video>` 方案不可行**（没有可直连的兜底视频文件）。「Video [動画]」按作者自述处理（数据仍为 ugoira/illust），维持 ugoira zip 管线为准。

- **覆盖率=0**（动图作品在 API 层全是 ugoira），**非**"少量转视频作品"——因此 `<video>` 原生媒体管线（WebView 流式、无逐帧解码）**无适用对象**。
- 若未来 pixiv 真在 App-API 新增 `type:"video"`/`video_urls`，届时 `<video>` 元素加载同样走 `shouldInterceptRequest`（200 全量可播、Chromium 原生渐进缓冲），天然绕开 ugoira zip 取帧——但**需另起专项核验 API**，现阶段不做。
- 即便出现视频直链：app（WebView）受益（原生媒体管线、流式、无逐帧解码）；**lynx 无 `<video>` 元素，仅 app 侧受益**。

---

## 5. 方案 E：其他冷门路径快速扫一遍

| 冷门路径 | 判定 | 依据 |
|---|---|---|
| **Service Worker 拦截**（webview localhost + SW） | **不可行/低价值** | Capacitor `server.androidScheme: "https"` → app 在 `https://localhost`（安全上下文，SW 可注册）；但 SW 拦截 `/pixiv-img/` 同样要**重建响应**（`new Response(..., {status:206})`），与 `shouldInterceptRequest` 的「重建 206」同源问题，且 SW 与原生 `shouldInterceptRequest` 的命中顺序在 WebView 中未文档化（可能被原生层抢先/绕过）；CDN 跨域 + Range 重建不可靠。需原型，优先级低 |
| **androidx `WebViewAssetLoader` Range** | **不可行** | 官方 `WebViewAssetLoader` 只做 `http(s)://` 等 scheme → assets 的映射，**不支持 Range/206**；cordova-android #1494 明确「WebViewAssetLoader needs to support range requests」为开放缺陷。不能用于对 i.pximg.net 的 Range 代理 |
| **`<img>`/`<video>` 元素级 Range** | **同样坏** | 元素级子资源请求**同样**走 `shouldInterceptRequest`（本项目图片流水线即依赖此路径）；`<img>` 不经 JS 但同样被拦截重建。`<video>` 媒体管线会发起它自己的 Range 序列，且（顺带）媒体请求在部分 WebView 中被媒体资源加载器另行处理，但仍与拦截层交互 → 无一能绕过该损坏路径 |
| **PWA / 系统播放器 intent** | **不适用** | ugoira 是 zip 帧序列，**无单一可播放媒体文件**，系统播放器/共享 intent 无法播放；仅当变为视频直链（§4）才有意义，且需绕过登录鉴权/R18 上下文 |
| **服务端转码** | **不适用** | 本项目无服务器（静态 GitHub Pages + 纯客户端）；ffmpeg.wasm 32MB+ 移动端不可接受（研究文档 §7.4）。一句话：无基础设施，排除 |

---

## 6. 方案矩阵表

> 架构事实基准：
> - **ADR-0037「图片二进制零进 JS 堆」只约束 lynx 原生管线**；app WebView 端现状本来就是 zip 全量进 JS 堆（fflate 模式），故**把帧字节留在 JS 堆的方案（方案 A 流式）在 app WebView 端不受 ADR-0037 约束**。方案 B 的推荐形态（Java 解到缓存 + 返回文件 URL）则进一步**把字节留在 Java/磁盘**（符合 ADR-0037 精神）。
> - app-lynx 原生管线已走 Java 解压写盘（ADR-0125，`ugoiraExtract` → `file://` 帧），**该端不适用**本调研的 app 侧替代路径。
> - 收益纵轴基准：Android WebView 端 **range 模式当前必然降级 fflate 全量**（`extractRange` 失败 → warn → 全量下载+解压）。故任何替代方案的收益要对比的对象是「**全量下载 zip + fflate 全量解压**」（现状实际行为），而非理论理想 range。
> - 具体符号：`packages/app/src/api/illust.ts` 的 `downloadAndExtractUgoira` / `extractRange` / `fetchRange`（range 失败降级 fflate）；`packages/app-lynx/src/api/ugoira.ts` 的 `downloadUgoiraFrames` / `ugoiraExtractFrames`；`packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java` 的 `interceptImage`（恒返 200）；`PixivApiCore`（共享 OkHttp+Referer/UA）；`PixivImageLoader`（全量下载，无 Range）。

| 方案 | 可行性 | 首帧/性能收益预测 | 成本（代码面 + 维护） | 是否符合架构事实 |
|---|---|---|---|---|
| **A. 流式 fflate 渐进（无 Range）** | ✅ **可行**（依赖已存在，库 `^0.8.3`；`Unzip` 源码已核对，见 §1.2） | 首帧 **~8s → 1-3s**（估，依赖网速）；峰值内存下降（边播边 revoke） | **低**（`illust.ts` + 播放器接线 + `file.name`→帧索引映射 + 乱序/异常回退 `unzipSync`） | **符合**（纯 JS、零新原生面、app 与 lynx web 模式可共用取帧逻辑；字节进 JS 堆在 webview 端允许） |
| **B. Capacitor 原生桥批量 Range** | ⚠️ **需原型**（Java OkHttp 原生 206 可行；但**桥 base64 形态被官方否决**，须改走"Java 解到缓存 + 返回 file URL"） | 字节零进 JS 堆 + 二次播放零下载 + deflate 兜底；**非省流量流式** | **中高**（webview 侧新原生方法 + JS 契约 + 测试 + 缓存清理 + file 白名单 + 双端分叉） | **webview 端**符合 ADR-0037 精神（字节留在 Java/磁盘）；但**双端二分叉**、维护面更大；与 lynx ADR-0125 收敛 |
| **C. WebView 版本演进** | ❌ **不可行/不可依赖**（未找到针对拦截 206 的修复证据） | 若有修复才有收益；否则零收益 | 零（纯升级） | **不符合**（不可控、不普适，设备 WebView 更新不可依赖） |
| **D. Pixiv 视频化作品（`<video>`）** | ❌ **不可行**（App-API `type` 为封闭联合 `illust/manga/ugoira`，无 `video`/`video_urls` 字段，见 §4） | 无（API 无视频直链；动图作品全为 ugoira，覆盖率 0） | 无 | lynx 无 `<video>`；即使出现视频直链也**仅 app 侧受益** |
| **E. 冷门路径（SW/AssetLoader/元素级 Range/PWA intent/服务端）** | 均**不可行或低价值**（详见 §5） | 无 | 无 | — |

---

## 7. 推荐试验顺序

1. **方案 A（流式 fflate 渐进）——优先级 1，先做原型**：
   - 改动最小、收益确定、复用既有依赖。**Web dev 即可验证核心逻辑**（构造 zip 字节流分片 `Unzip.push`，断言 `onfile` 增量吐帧）+ 真机验证首帧收益。
   - 设计要点：`Unzip` 流式吐条目按 `file.name` 映射到帧索引，播放序由 `meta.frames[]` 驱动（对 zip 物理序不敏感）；`onfile` 里先设 `file.ondata` 再 `file.start()`；末 chunk `push(last, true)`；乱序/异常 → 回退现有 `unzipSync` 全量路径（自愈）。
   - 若 A 落地后仍**只关心「省流量」**（大 zip 只看前几秒），需走 Range（被拦截层否决）；或接受「字节零进 JS + 二次缓存」→ 走方案 B（Java 解缓存）。
2. **方案 B（Capacitor 原生桥批量 Range）——优先级 2**：作为 A 的补充，**形态已修正**——不是 base64 过桥，而是**把 lynx 的 ADR-0125 管线移植到 webview 的 `PixivApiPlugin`**（Java 下载 zip → 解压/切片 → 写盘 `cache/ugoira/<illustId>` → 回调 `file://`/`convertFileSrc` URL）。字节零进 JS、二次播放零下载；**不是**省流量流式。需先原型验证 Java 侧取帧 + 写盘 + file URL 渲染的可行性与性能；确认 A 不满足「字节零进 JS / 二次缓存」诉求时才投入（这是独立的、明确的移植改动）。
3. **方案 C（WebView 版本重测）——低优先级一次性**：仅当知悉某版本修复了拦截 206 截断，可在新 WebView 模拟器上重跑原型报告 §2.2 的 CDP 核验；否则不做。
4. **方案 D（视频直链）——不做**：App-API 无 `video` 类型/`video_urls`（§4，PROVEN），当前无适用对象。仅当未来 pixiv 真新增 `type:"video"`/`video_urls` 才另起专项。
5. **方案 E（冷门路径）——不做**。

---

## 8. 来源清单

**Pixiv 官方 zip_player（一手源码）**
- 仓库 <https://github.com/pixiv/zip_player>；`zip_player.js`：`_readCentralDirectory` 按名建映射（**L233–258**，`this._files[name]` L258）、仅支持 store（`if (compMethod != 0) error` **L246–248**）、播放序由 `metadata.frames[]` 驱动且按名取（**L91/L310–311/L328–339**）
- 原始 Pixiv "ugoku player" 作者 marcan 文档（帧名零填充数字 `000001.jpg`、`metadata.frames` 提供 delay）：<https://marcan.st/talks/2014_pixiv_ugoku_player/>

**fflate（一手，行号已核对）**
- fflate 源码（与本仓库 `^0.8.3` 一致）：<https://raw.githubusercontent.com/101arrowz/fflate/v0.8.3/src/index.ts>（3854 行；`Unzip` L3592、push L3623–3708、register L3715–3717、onfile L3722、local-header 扫描 L3643–3645/3650/3682、条目大小 L3654/3659、增量喂解码器 L3626–3633、收尾 L3704–3707、UnzipFile L3480–3523、解码器 L3528–3593、聚合 unzip/unzipSync L3743–3854、filter L2510–2514/3445–3468/3475）
- README 流式用法：<https://raw.githubusercontent.com/101arrowz/fflate/master/README.md#L337-L377>
- 生成 API 文档：`<https://github.com/101arrowz/fflate/blob/master/docs/classes/Unzip.md>`、`docs/interfaces/UnzipFile.md`、`docs/functions/unzip.md`、`docs/functions/unzipSync.md`
- fflate discussion #199（`zipSync` 条目顺序不可靠）：<https://github.com/101arrowz/fflate/discussions/199>

**Capacitor 桥契约（一手，已核对）**
- **Data Types（桥只支持 JSON 可序列化类型 + 原生→web 按 JSON 序列化）**：<https://capacitorjs.com/docs/core-apis/data-types>
- **Android 插件指南（`resolve(JSObject)` 只收 JSON 可序列化、`notifyListeners`）**：<https://capacitorjs.com/docs/plugins/android>、iOS 插件指南 <https://capacitorjs.com/docs/plugins/ios>
- **Method Types（void/value/callback 三型 + TS 签名）**：<https://capacitorjs.com/docs/plugins/method-types>；Saving Calls（`saveCall`/`keepAlive` 多次 `resolve()`）：<https://capacitorjs.com/docs/core-apis/saving-calls>
- **`@capacitor/http`（base64 注 + 「Large File Support」大载荷警告）**：<https://capacitorjs.com/docs/apis/http>
- **`@capacitor/filesystem`（二进制 base64 编码、`readFileInChunks`、native `offset`/`length`、100ms 节流）**：<https://capacitorjs.com/docs/apis/filesystem>；`@capacitor/file-transfer`（100ms 节流）：<https://capacitorjs.com/docs/apis/file-transfer>
- **`convertFileSrc`（`file://` → `http://localhost/_capacitor_file_/...`）**：<https://capacitorjs.com/docs/basics/utilities>
- **`@capacitor/core` 源码**：`definitions.ts`（`RegisterPlugin<T>`、`convertFileSrc`）：<https://github.com/ionic-team/capacitor/blob/main/core/src/definitions.ts>；`runtime.ts`（`registerPlugin` Proxy → `nativePromise`/`nativeCallback`）：<https://github.com/ionic-team/capacitor/blob/main/core/src/runtime.ts>；`PluginCall.java`（`resolve(JSObject)` only）：<https://github.com/ionic-team/capacitor/blob/main/android/capacitor/src/main/java/com/getcapacitor/PluginCall.java>
- Capacitor PR #8368（lowercase range header，8.2.0 起，针对 Capacitor 本地文件服务）：<https://github.com/ionic-team/capacitor/pull/8368>、commit <https://github.com/ionic-team/capacitor/commit/ae0e2ddccb2904ee4b3d47d4be1f7556ac7000a1>、release 8.2.0：<https://newreleases.io/project/github/ionic-team/capacitor/release/8.2.0>
- Capacitor issue #1343（对 Range 回 200 全量）：<https://github.com/ionic-team/capacitor/issues/1343>
- Capacitor issue #7789（PMTiles Byte Range 功能请求，Range 支持未完成）：<https://github.com/ionic-team/capacitor/issues/7789>

**Android WebView / WebViewAssetLoader**
- `WebResourceResponse` 文档（statusCode 允许区间 [100,299]/[400,599]、3xx 不支持）：<https://developer.android.com/reference/android/webkit/WebResourceResponse>
- `shouldInterceptRequest` 文档：<https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest)>
- cordova-android #1494（WebViewAssetLoader 不支持 Range）：<https://github.com/apache/cordova-android/issues/1494>
- flutter_inappwebview #1893（`WebResourceResponse` Content-Length 算错）：<https://github.com/pichillilorenzo/flutter_inappwebview/issues/1893>

**WebView 版本**
- 本机实测（2026-08-31，`adb -s emulator-5556 shell dumpsys webviewupdate`）：com.google.android.webview 113.0.5672.136
- 当前稳定版对照：APKMirror WebView 141.0.7390.124：<https://nexus2.apkmirror.com/apk/google-inc/android-system-webview/.../141.0.7390.124-release/>；apkpure 138/139：<https://apkpure.com/cn/android-system-webview-app/com.google.android.webview/download/138.0.7204.179>、<https://apkpure.com/jp/android-system-webview-app/com.google.android.webview/download/139.0.7258.159>

**Pixiv 视频化作品（App-API 类型，一手）**
- **book000/pixivts**（App-API TS 类型；`Illust.type` 封闭联合 `"illust"|"manga"|"ugoira"`，无 video）：<https://github.com/book000/pixivts>
- **hanshsieh/pixiv-api-doc** OpenAPI `api.yaml`（`IllustType enum=[illust,ugoira,manga]`，全 spec 无 "video"）：<https://raw.githubusercontent.com/hanshsieh/pixiv-api-doc/master/api.yaml>
- **gallery-dl** `pixiv.py`（仅 `type=="ugoira"` 特判，视频为客户端转换）：<https://github.com/mikf/gallery-dl/blob/master/gallery_dl/extractor/pixiv.py>；issue #6909：<https://github.com/mikf/gallery-dl/issues/6909>
- Pixiv 官方帮助「What are Ugoira?」（ugoira=PNG/JPEG 帧动画，非视频文件；16MB/500 帧）：<https://www.pixiv.help/hc/en-us/articles/235584628-What-are-Ugoira->
- 其他（无 video）：pixivpy（`_TYPE=Literal["illust","manga",""]`）、`DowneyRem/PixivSource` web API 文档 <https://github.com/DowneyRem/PixivSource/blob/main/doc/PixivWebApi.md>、`daydreamer-json/pixiv-ajax-api-docs` <https://github.com/daydreamer-json/pixiv-ajax-api-docs>
- 本会话实测（2026-08-31）：新作品 caption「2:32 min Video [動画]」但 `type:"ugoira"`、`ugoira_metadata` 仅 `zip_urls+frames`、无 `video`/`video_urls`。
- 社区 ugoira→mp4 转码（非官方直链）：<https://memotut.com/en/efe6eda433b09ec34203/>

**本项目自有证据（仓库内）**
- `docs/research/ugoira-range-official-scheme-research.md`（官方 zip_player + Android WebView 206 对照）
- `docs/research/ugoira-playback-flicker-range-proto.md` §2.2（CDP 逐请求核验 206 截断/ERR_FAILED/HEAD 头不透明）+ 作品 148861562/149104861
- `docs/research/ugoira-playback-alternatives.md` §3/§7/§8（fflate / Java 解压写盘 / Range 实测）；§7.4（ffmpeg.wasm 32MB+）
- `docs/research/ugoira-native-pipeline-proto.md`（ADR-0125 一手证据，作品 148861562 / 52 帧）
- `docs/adr/ADR-0125-lynx-ugoira-unpacked-pipeline.md`、`docs/adr/ADR-0126-ugoira-flicker-and-range-fallback.md`
- `packages/ugoira/src/index.ts`（fflate `unzipSync`/`inflateSync`、store 切片、中央目录解析）
- `packages/app/src/api/illust.ts`（`downloadAndExtractUgoira` / `extractRange` / `fetchRange`，range 失败降级 fflate）
- `packages/app-lynx/src/api/ugoira.ts`（`downloadUgoiraFrames` / `ugoiraExtractFrames`）
- `packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java`（`interceptImage` 恒返 200）
- `packages/app/android/app/src/main/java/io/pictelio/app/PixivApiCore.java`（共享 OkHttp，注入 Referer/UA）
- `packages/app/android/app/src/main/java/io/pictelio/app/PixivImageLoader.java`（全量下载，无 Range）
- `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioApiModule.java`（lynx `ugoiraExtract`，Java 解压写盘）
- `packages/app/capacitor.config.ts`（`server.androidScheme:"https"`、`allowNavigation`、`CapacitorHttp.enabled`）、`package.json`（`@capacitor/core ^8.5.0`）
- `packages/app/src/components/settings/SettingsImage.tsx`（ugoira 播放方案 T3 二次确认文案）
