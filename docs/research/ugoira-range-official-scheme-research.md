# Ugoira Range 流式取帧：Pixiv 官方 zip_player 方案 vs Pictelio Android WebView 拦截方案 对照调研

> 记录日期：2026-08-31（联网抓取一手来源；GitHub / Android Docs 均已实读源码与文档）
> 触发背景：用户疑问——「Pixiv 官方方案（`pixiv/zip_player`）就是 Range 流式取帧，若 Range 在浏览器里会坏，官方早就炸了。为什么官方没问题、我们的 Android 端坏？」
> 前置事实（本会话已实测，作为调研起点，可引用；详见仓库内 `docs/research/ugoira-playback-flicker-range-proto.md` §2.2）：
> - Pictelio app（Android WebView）的 ugoira range 流式取帧：JS `fetch('/pixiv-img/<zip>', {headers:{Range:...}})` → 请求被 `MainActivity.shouldInterceptRequest` 拦截 → Java OkHttp 向 `i.pximg.net` 发 Range 请求 → 以 `WebResourceResponse` 重建响应返回。
> - CDP 逐请求核验（2026-08-31）：拦截响应为 206 时，`bytes=0-0`（1B）✅、`bytes=0-100`（101B，start=0）✅、`bytes=100-200`（start=100，101B）→ JS 收到 206 但 body 只有 1 字节 ⚠️、`bytes=12902002-…` → `net::ERR_FAILED` ❌，且 Chromium 在拦截器返回 206 后会对同一 URL 再发一个**无 Range 头的二次请求**；HEAD 经拦截器 JS 读到 200 但 Content-Length 头不可见。
>
> 结论速览：**官方 zip_player 与我们的 range 实现「形似而神不似」。** 官方在普通浏览器上下文用 jQuery `HEAD` + XHR `GET Range` **直连** CDN（`op.source`），由浏览器原生网络栈逐字节透传真实 HTTP 206；我们的 Android 端把请求拦到 Java，再用 `WebResourceResponse` **重建**响应，206 语义在 `shouldInterceptRequest` + Chromium/WebView 的这条路径上被破坏。**zip_player 自己在 `_load()` 里对 206 做了「响应字节数必须恰好等于请求长度」的断言（`if (xhr.response.byteLength != length) this._error("Unexpected length")`）**——这条断言在普通浏览器里恒真（真实 206 返回恰好你请求的字节），但对着我们的拦截器返回的 206 必假（start>0 被截断为 1 字节、大体量 `net::ERR_FAILED`）。**所以：官方方案在官方环境（直连 CDN 的真实 HTTP 206）不炸；我们的方案在我们这里（拦截层重建 206）必炸。** 详见 §4。

---

## 一、Pixiv 官方 zip_player（一手源码）

来源（默认分支 `master`，均已实读）：
- README：<https://raw.githubusercontent.com/pixiv/zip_player/master/README>（仓库根 `README`，无 `.md` 后缀）
- 源码：<https://raw.githubusercontent.com/pixiv/zip_player/master/zip_player.js>（519 行，本节行号均指此文件）

### 1.1 README 关键事实

| README 原文/事实 | 出处 | 给我们的启示 |
|---|---|---|
| "zip_player is a JavaScript library to load and play back animated images packaged as an **uncompressed** ZIP archive containing individual frames." | Introduction | 官方明确 ugoira zip 是**未压缩（store）**归档 |
| "Frames are drawn onto a **Canvas** element..." | Introduction | 官方用 `canvas.drawImage` 绘制帧 |
| "It also supports an **unpacked mode** where the images are directly referenced as individual URLs (e.g. data: URLs for client-side preview purposes)." | Introduction | `op.source` 为空时的 unpacked 直链模式（含 data URL） |
| "Note that you need to serve it from a **web server with Range support** for zip mode to work (unpacked mode does not require Range support)." | Usage | **zip 模式依赖服务端 Range/206**；这是官方的硬前提 |
| "Any recent Chrome or Firefox, Safari 7+, IE 10+, iOS 5+ (6+ recommended...), Android browser 4.0+" | Browser compatibility | 官方支持的运行环境 = **普通浏览器**（含 Chrome/Firefox/Safari/IE/Android 浏览器，即原生网络栈上下文），不是 WebView 拦截上下文 |
| Dependencies: **jQuery** | Dependencies | 官方用 jQuery `$.ajax`（HEAD）与事件分发 |

### 1.2 zip_player.js 播放流程（逐函数 + 行号）

与任务描述一致，实测源码确认的调用链：

1. **`_startLoad()`（L172-214）**
   - 若 `!this.op.source` → **unpacked 模式**，直接 `this._loadNextFrame()`（L174-178）。
   - 否则 `$.ajax({url: this.op.source, type:"HEAD"})`（L179-181）拿长度：`var len = parseInt(xhr.getResponseHeader("Content-Length"))`（L189）。
   - 若拿不到长度（`!len`）→ **fallback 到全量下载**：`this._load(null, null, ...)`（L193）再 `_findCentralDirectory()`。
   - 拿到长度 → `this._buf = new this._ArrayBuffer(len)`（L202）分配整段 buffer，然后先拉**尾部 trailer**：`var off = len - this._trailerBytes`（`_trailerBytes = 30000`，L107 / L204-211）。**注意：这个 trailer 的 `off` 对大于 30KB 的 zip 一定是非 0 偏移**。

2. **`_load(offset, length, callback)`（L124-171）—— 核心 Range 请求**
   - `new XMLHttpRequest()`（L127），`xhr.responseType = "arraybuffer"`（L158），`xhr.open("GET", this.op.source)`（L157）。
   - 若有 offset/length：`xhr.setRequestHeader("Range", "bytes=" + offset + "-" + (end - 1))`（L161）。
   - **206 语义处理（L134-151）**：若 `status == 200` → 判定「Range disabled or unsupported, complete load」，整段读入（L134-140）；否则 `if (xhr.status != 206) this._error("Unexpected HTTP status " + xhr.status)`（L142-144）；**`if (xhr.response.byteLength != length) this._error("Unexpected length " + byteLength + " (expected " + length + ")")`（L145-149）**；`this._bytes.set(new Uint8Array(xhr.response), offset)`（L150）。
   - **这条 `byteLength != length` 断言是本调研的钥匙**（见 §4.3）。

3. **`_findCentralDirectory()`（L215-232）**：从尾部 22 字节读 EOCD，`dv.getUint32(0, true) != 0x06054b50` → error（L218）；取 cd_count（L221）、cd_size（L222）、cd_off（L223）。

4. **`_readCentralDirectory(offset, size, count)`（L233-270）**：遍历中央目录条目，`compMethod = dv.getUint16(p + 10, true)`（L240）；`if (compMethod != 0) this._error("Unsupported compression method")`（L246-248）——**要求压缩方法必须为 0（store）**；`off = dv.getUint32(p + 42, true)`（L245）；`this._files[name] = {off: off, len: uncompSize}`（L258）。随后 `_loadNextChunk()` × 2 load-ahead（L267-269）。

5. **`_loadNextFrame()`（L320-371）**：`var off = this._fileDataStart(this._files[meta.file].off); var end = off + this._files[meta.file].len`（L339-340）。有 Blob URL 支持 → `slice = this._buf.slice(off, end)` → `new Blob([slice], {type:mime_type})` → `url = this._URL.createObjectURL(blob)`（L343-364）；**否则走 base64 fallback**（L367-368，见 §1.3）。

6. **`_loadImage(frame, url, isBlob)`（L372-406）**：`new Image()`，`image.src = url`；on load 时 `revokeObjectURL`（L379），把 `image` 存入 `_frameImages[frame]`（L384）。

7. **`_displayFrame()`（L413-447）**：`ctx.clearRect(...)`（L437）+ **`this._context.drawImage(image, 0, 0)`**（L439），`setTimeout(meta.delay)` 切帧（L442-445）。

辅助函数：
- `_fileDataStart(offset)`（L304-309）：`offset + 30 + nameLen + extraLen`（本地文件头定长 + 名字 + 扩展）。
- `_isFileAvailable(name)`（L310-319）：判断 `pHead` 是否已覆盖到帧数据末尾（`_pHead >= _fileDataStart(...) + len`）。

### 1.3 `base64ArrayBuffer` fallback 的**真实语义**

- `base64ArrayBuffer(arrayBuffer, off, byteLength)`（L3-49）把 `off..off+byteLength` 的字节转成 base64 字符串。
- 它**只在** `_loadNextFrame()` 中**没有 `URL.createObjectURL` / Blob URL 支持**时被使用（L366-368）：`url = "data:" + mime_type + ";base64," + base64ArrayBuffer(this._buf, off, end - off); this._loadImage(frame, url, false)`。
- 文件头部注释明确其动机（L1-2）：`// Required for iOS <6, where Blob URLs are not available. This is slow...`。构造函数也设 `_maxLoadAhead = 10` 并打 `this._debugLog("No URL support! Will use slower data: URLs.")`（L67-71）。

**结论：`base64ArrayBuffer` 不是 Range 失败的回退，而是「无 Blob URL 环境（iOS <6）」的渲染层回退。** 在 Range 失败时官方走的是**另一条**回退——`_startLoad()` 里 HEAD 拿不到 `Content-Length` 时整段下载（L190-199），或 `_load()` 里遇到 `200` 时按「Range 不支持」整段读入（L134-140）。这澄清了「官方 fallback 语义」与「我们的降级」不是一回事。

### 1.4 运行上下文：普通浏览器

- README 的 Browser compatibility 列的是 Chrome/Firefox/Safari/IE/iOS/Android 浏览器（见 §1.1），即**普通浏览器环境**；依赖 jQuery。
- `_load()` 用原生 `XMLHttpRequest` + `responseType=arraybuffer`，直接 `GET op.source`（即 ugoira zip 的 CDN URL）。
- 没有任何 Service Worker、`shouldInterceptRequest`、`WebResourceResponse`、响应重建层；浏览器原生网络栈发射 Range、透传 206。

### 1.5 压缩方法必须为 store

- `_readCentralDirectory()` L246-248：`if (compMethod != 0) this._error("Unsupported compression method");`（非 0 直接报错）。
- README Introduction：archive 是 **uncompressed**。
- 推论：帧字节在 zip 内的位置可由「本地文件头偏移 + 30 + nameLen + extraLen」直接算出（`_fileDataStart`，L304-309），**取帧不需要任何 inflate/解压库**——这正是官方「零解压库 + Range 切片」能成立的前提。Pictelio `packages/ugoira/src/index.ts` 亦据此实现 store 切片。

---

## 二、Android WebView `shouldInterceptRequest` + `WebResourceResponse` 的 206/Partial Content 支持

### 2.1 官方 API 文档：**206 是被允许的状态码**

来源：`WebResourceResponse` 官方文档（<https://developer.android.com/reference/android/webkit/WebResourceResponse>）。

`WebResourceResponse(String mimeType, String encoding, int statusCode, String reasonPhrase, Map<String,String> responseHeaders, InputStream data)`（API 21+）与 `setStatusCodeAndReasonPhrase(int, String)` 的参数约束原文：

> `statusCode` int: **the status code needs to be in the ranges [100, 299], [400, 599]. Causing a redirect by specifying a 3xx code is not supported.**

**关键结论：`206` 落在 [100, 299] 区间内，官方 API 契约**允许**拦截器返回 206**。文档**没有**任何针对「206/Partial Content/Range/Content-Range」的限制或注意事项。唯一明确不支持的 3xx 重定向；并额外要求 `reasonPhrase` 非空，MIME/编码必须拆成两个参数（不能 `text/html; charset=utf-8`），`InputStream.read(byte[])` 必须实现、`InputStream.close()` 会被 WebView 在收尾后调用。

| 文档条目 | 内容 | 与本调研的关系 |
|---|---|---|
| statusCode 允许区间 | `[100, 299]` / `[400, 599]` | **206 在允许区间内**；不是文档明确禁用的状态码 |
| 3xx 重定向 | 不支持 | 与 206 无关 |
| MIME/编码 | 拆两个参数 | 拦截层响应重建的易错点 |
| InputStream | 必须实现 `read(byte[])`；close 由 WebView 调用 | 拦截层重建响应、逐字节可控 |
| **Range/206/Content-Range** | **无任何说明** | **官方未文档化该路径对 206 的正确性** |

`shouldInterceptRequest(WebView, WebResourceRequest)` 官方文档（<https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest)>）只写了一句「Notify the host application of a resource request and allow the application to return the data.」，**同样未提及 Range/206 的任何限制**。

> **因此：官方 API 契约并不禁止 206，问题不在「API 不支持 206」，而在「该路径运行时对 206 的透传行为」。**

### 2.2 已知局限性（文档层面确认的）

- 状态码区间限制（[100,299]/[400,599]，3xx 不支持）。
- `InputStream.read(byte[])` 必须实现、close 由 WebView 管理。
- MIME/编码拆分、`reasonPhrase` 非空。
- （无针对 206 的文档级限制。）

### 2.3 Chromium/AOSP 已知 issue 检索结果

针对「`shouldInterceptRequest` 返回 206 时拦截响应损坏/截断（start>0 截为 1 字节、大体量 `net::ERR_FAILED`、返回 206 后二次无 Range 请求）」这一**具体症状**，我做了多轮联网检索（`crbug` / `bugs.chromium.org` / `issuetracker.google.com` / `chromium.googlesource.com`，关键词 `shouldInterceptRequest 206` / `WebResourceResponse partial content` / `Content-Range` / `range request intercepted` / `byteLength`），**未找到一条被主流引用、能直接对应「拦截响应 206 截断」的权威 AOSP/Chromium issue**。检索命中的多为：

- 泛化的 WebView 拦截/重定向问题（如 <https://issuetracker.google.com/issues/119844519>、<https://stackoverflow.com/questions/59965544/how-to-pass-webresourceresponse-with-redirect-code-to-android-webview-in-webvi>）。
- Chromium 侧与**缓存/Service Worker range** 相关的 wpt 提交（<https://github.com/web-platform-tests/wpt/commit/5fc81f8eaa41bf9ea8ffb9a0869c426a02ff2f64>：“ResourceLoader cancels range request responses that were not initiated with range request headers causing them to error out”）——针对 preload cache 的 range 错误，**不是** `shouldInterceptRequest` 路径，只能作机制层面的类比，不能当作本症状的答案。
- 生态侧第三方报告（§2.4）。

**结论（按任务要求如实标注）：针对本症状，未找到公开权威 issue 记录，仍以本项目实测为准**（本仓库 `docs/research/ugoira-playback-flicker-range-proto.md` §2.2 的 CDP 逐请求核验是当前最可信证据）。

### 2.4 生态侧旁证（第三方报告，均证实「拦截路径处理 Range/206 不可靠」）

这些不是 AOSP/Chromium 权威源码，但都是第一手使用者对**同一条 `shouldInterceptRequest` 重建响应路径**踩坑的记录，方向与本项目实测一致：

1. **Capacitor / ionic-team issue #1343**「Files over HTTP do not support 206 Partial Content」（<https://github.com/ionic-team/capacitor/issues/1343>，Closed）：Android 下 Capacitor 的 `_capacitor_file_` 本地文件服务**走 `shouldInterceptRequest`**（响应头里明确有 `Client-Via: shouldInterceptRequest`），对 `Range: bytes=0-` 请求却返回 `200 OK` 全量 body——**拦截路径不识别 Range、不给 206**。这正是 Pictelio 用的 Capacitor 框架在 Android WebView 拦截路径上的已知坑面。
2. **flutter_inappwebview issue #1893**「WebResourceResponse calc wrong content-length」（<https://github.com/pichillilorenzo/flutter_inappwebview/issues/1893>，Closed as not planned）：用户在 `shouldInterceptRequest` 里拦截**带 Range 的 video 请求**，自己拿到的 `Content-Range` 是对的，但把 `content-range` 塞回 `WebResourceResponse` 后，WebView/Chrome 里看到的 `Content-Length` 是**错的**——「WebResourceResponse 不能设 content-length，它自己算但算错」。
3. **Obsidian 论坛**「Android: the local resource server ignores the end of a Range request, and its own headers say otherwise」（<https://forum.obsidian.md/t/bug-report-android-the-local-resource-server-ignores-the-end-of-a-range-request-and-its-own-headers-say-otherwise/117513>）：Android 本地资源服务器**忽略 Range 请求的 end**，返回的 body 与它自己声明的头部对不上。与「start>0 截断/长度不符」现象同向。
4. **CSDN 专栏**（<https://wenku.csdn.net/column/38b7jmvvat9s>）「shouldInterceptRequest 钩子失效的 3 大底层原因」——中文生态对拦截路径不稳定的经验总结（非正式权威，仅供参考）。

### 2.5 小结

- **文档层面**：206 合法（`[100,299]` 允许）；无 206/Range 专项限制。
- **机制层面**：`shouldInterceptRequest` 返回的 `WebResourceResponse` 是「重建的响应」，其 Content-Length 由 Chromium/WebView 自行计算（`WebResourceResponse` 没有 `setContentLength`，见 flutter #1893），对 Range/206 的透传语义未被文档承诺。
- **证据层面**：无权威 AOSP/Chromium issue 直指「拦截 206 截断」；以本项目 CDP 实测为准。

---

## 三、i.pximg.net Range 支持

### 3.1 架构性证据（官方性来源）

- zip_player 是 **Pixiv Inc.** 开源的 ugoira 播放器（README License 段：`zip_player is Copyright (c) 2014 Pixiv Inc.`，MIT），README 明确「zip 模式需服务端 Range/206」（§1.1）。Pixiv 网页端的 ugoira 播放依赖同一类「Range 流式取帧」能力才能及时出首帧、边下边播——这是其能在网页端长期稳定运行的架构前提（Pixiv 自己的 web ugoira 播放器即基于/等价于这类做法）。
- 本仓库 `docs/research/ugoira-playback-alternatives.md` §7.1 已在 **Web 端 Vite 代理**实测：`HEAD 200 + content-length + accept-ranges`、`Range: bytes=... → 206 partial content`、`content-range=bytes 4423333-4453332/4453333` 等，说明 **i.pximg.net 及其代理链路支持 206/Content-Range**。

### 3.2 本项目自测（host curl）

- 本会话 `i.pximg.net` 直接 `curl`（2026-08-31）实测：CDN 对 `Range` 请求返回 **206 + `Content-Range` + `access-control-allow-origin: *`**。（自测事实，可引用；未附长期权威出处。）

**结论：`i.pximg.net` 对 Range 的 206 支持是真实且官方的（至少在 zip 资源上）；问题不在 CDN，而在我们的 WebView 拦截层。**

---

## 四、结论对照：为什么官方不炸、我们的 WebView 拦截炸

### 4.1 差异点清单

| 维度 | Pixiv 官方 zip_player（网页端） | 我们的 range 实现（Pictelio Android WebView） |
|---|---|---|
| **运行上下文** | 普通浏览器（Chrome/Firefox/Safari/IE/Android 浏览器，README 明确，§1.4） | Android WebView，且被 `shouldInterceptRequest` 拦截 |
| **传输层** | 浏览器原生网络栈，`XHR` **直连 CDN**（`op.source`），真实 HTTP 206 | 请求被 Java OkHttp 代理到 `i.pximg.net`，再以 `WebResourceResponse` **重建**响应 |
| **206 来源** | CDN/server 返回的真实 206（字节完全按请求切片） | Java 截取字节后由 `WebResourceResponse` 重建 206，Content-Length 由 Chromium 重算（flutter #1893） |
| **响应重建** | 不重建；浏览器原生解析 206 | `new WebResourceResponse(mime, null, 206, "OK", headers, inputStream)` 手工重建 |
| **URL 路径代理** | 无（`op.source` 即 CDN URL） | `fetch('/pixiv-img/<zip>')` → 拦截器 `rewriteUrl` → `i.pximg.net`（存在 URL 重写+缓存层） |
| **Range 校验** | 官方断言：206 响应字节数**必须**恰好等于请求长度（L145-149） | 我们的 `fetchRange` 也校验 `bytes.length !== expected` throw（`illust.ts` L102-104、L176-178）——但与官方同样依赖「206 字节精确」，而拦截层提供了不精确的 206 |

### 4.2 论证

1. **官方不炸的原因**：官方在普通浏览器里用 `XHR` range 直接打 CDN。浏览器原生网络栈发出的 `Range: bytes=X-Y` 会收到 CDN 的真实 206，返回体字节数与请求完全一致。官方在 `_load()` 里对 206 校验 `byteLength != length`（L145-149）**恒真**，因为真实 206 只返回请求的精确切片。

2. **我们的必炸原因**：我们并没有「直连 CDN 拿到真实 206」，而是把请求**拦截到 Java**，Java 向 CDN 发 Range、拿字节、再用 `WebResourceResponse` 重建一个 206 给 Chromium。这一步引入了三个破坏点（均有生态旁证，§2.4）：
   - **a. 响应被「重建」而非「透传」**：`WebResourceResponse` 没有 `setContentLength`，Content-Length 由 Chromium 自行计算（flutter #1893）：对 start>0 的 Range，重建响应的 body 与 Chromium 期望的切片错位 → **被截断为 1 字节**（本项目实测 `bytes=100-200` → body=1B）。
   - **b. 大体量/尾部 Range 直接失败**：`bytes=12902002-…` → `net::ERR_FAILED`（本项目实测）。
   - **c. 二次请求**：拦截器返回 206 后，Chromium 对同一 URL 再发一个**无 Range 头的二次请求**（本项目实测）——说明 Chromium 并未把拦截响应当作完整的 range 结果，而是要走一次「不带 Range 的完整加载」。
   - **d. HEAD 头不透明**：HEAD 经拦截器，JS 读到 200 但 `Content-Length` 不可见（本项目实测）——官方 `_startLoad()` 依赖 `Content-Length`（L189）定总长，这正是头不透明直接卡死官方流程第一步的地方。

3. **官方方案与我们的 range 实现的本质差异**：官方是「**透传**真实 HTTP 交互」；我们是「**重建** HTTP 响应」。前者在浏览器原生栈里保留 206/Range/Content-Range 的精确语义；后者把这些语义交给 Chromium/WebView 对拦截响应的二次处理，而这一处理对 206 partial content 并不可靠（§2 结论）。

### 4.3 最直接、可独立验证的判据

**zip_player 的 206 字节断言（L145-149）**：

```js
if (xhr.status != 206) {
    this._error("Unexpected HTTP status " + xhr.status);
}
if (xhr.response.byteLength != length) {
    this._error("Unexpected length " + xhr.response.byteLength +
                " (expected " + length + ")");
}
```

- 官方**第一个 Range 请求**就是尾部 trailer：`_startLoad()` 里 `off = len - this._trailerBytes`（`_trailerBytes=30000`，L204-211）。对任何 >30KB 的 ugoira zip，`off > 0`——**这是一个非 0 偏移的 Range 请求**。
- 按本项目实测，**非 0 偏移的 206 拦截响应会被截断**（`bytes=100-200` → body=1B）或 **ERR_FAILED**（`bytes=12902002-…`）。
- 所以**即便把 zip_player 原封不动接入我们的 WebView 拦截路径，它也会在第一个 trailer Range 请求就命中 `byteLength != length` 断言而抛 `"Unexpected length"`**。

**换句话说：这不是「官方方案对、我们的方案错」的选型差异，而是「官方方案所依赖的『浏览器直连 CDN 的真实 206』在我们这套拦截层里根本不存在」。** 官方在普通浏览器里因此不炸；我们在拦截重建层里因此必炸。

---

## 五、对本项目既有决策的呼应

- `docs/research/ugoira-playback-alternatives.md` §6 曾提出风险「原生代理是否支持 206 需验证」；本调研 + `ugoira-playback-flicker-range-proto.md` §2.2 的 CDP 实测补充了答案：**Android WebView `shouldInterceptRequest` 拦截路径对 206/partial content 不可靠**（start>0 截断、大体量 ERR_FAILED、二次无 Range 请求、HEAD 头不透明）。
- 因此本项目对 **app 端 range 模式**的既定处理（`illust.ts` 的 `extractRange` 失败 → `console.warn('[ugoira] range 取帧失败，降级 fflate: ...')` → 全量 fflate，与 lynx 侧 `downloadUgoiraFrames` 降级语义对称；ADR-0126 / code-review S1 的 blob URL 释放）是**在当前 WebView 拦截架构下的正确工程处理**：range 仅在 Web dev（Vite 代理真 206）保留全真流式，原生端自动降级 fflate 且不报失败。
- 若要在 Android 原生端兑现「range 流式 / 零解压」的长期目标，按 `ugoira-playback-alternatives.md` §5/§8 的路径，更适配本项目 ADR-0037（图片二进制零进 JS 堆）的是 **原生 Java 解压写盘（unpacked 模式）**，而非在 `shouldInterceptRequest` 里硬做 Range 206。

---

## 来源清单

**Pixiv 官方 zip_player（一手源码）**
- README：<https://raw.githubusercontent.com/pixiv/zip_player/master/README>（仓库根 `README`）
- 源码：<https://raw.githubusercontent.com/pixiv/zip_player/master/zip_player.js>（`base64ArrayBuffer` L3-49 / `_startLoad` L172-214 / `_load` L124-171 / `_findCentralDirectory` L215-232 / `_readCentralDirectory` L233-270 / `_fileDataStart` L304-309 / `_isFileAvailable` L310-319 / `_loadNextFrame` L320-371 / `_loadImage` L372-406 / `_displayFrame` L413-447）
- 仓库主页：<https://github.com/pixiv/zip_player>

**Android WebView `shouldInterceptRequest` + `WebResourceResponse`**
- WebResourceResponse 文档：<https://developer.android.com/reference/android/webkit/WebResourceResponse>（statusCode 允许区间 [100,299]/[400,599]、3xx 不支持、InputStream 要求）
- WebViewClient.shouldInterceptRequest 文档：<https://developer.android.com/reference/android/webkit/WebViewClient#shouldInterceptRequest(android.webkit.WebView,%20android.webkit.WebResourceRequest)>
- Capacitor issue #1343（拦截路径不回 206/Range）：<https://github.com/ionic-team/capacitor/issues/1343>
- flutter_inappwebview issue #1893（WebResourceResponse Content-Length 计算错误）：<https://github.com/pichillilorenzo/flutter_inappwebview/issues/1893>
- Obsidian 论坛（Android 本地资源服务器忽略 Range end）：<https://forum.obsidian.md/t/bug-report-android-the-local-resource-server-ignores-the-end-of-a-range-request-and-its-own-headers-say-otherwise/117513>
- wpt commit（preload cache 中 range 响应被取消，机制类比非本症状）：<https://github.com/web-platform-tests/wpt/commit/5fc81f8eaa41bf9ea8ffb9a0869c426a02ff2f64>
- CSDN 专栏（shouldInterceptRequest 钩子失效原因，参考）：<https://wenku.csdn.net/column/38b7jmvvat9s>

**本项目自有证据（仓库内）**
- `docs/research/ugoira-playback-flicker-range-proto.md` §2.2（CDP 逐请求核验 206 截断/ERR_FAILED/二次请求/HEAD 头不透明）
- `docs/research/ugoira-playback-alternatives.md` §1-§8（官方做法、Vite 代理 Range/206 实测、方案 A/B/C/H 对比）
- `packages/app/src/api/illust.ts`（`fetchRange` L93-106 / `extractRange` L117-196，range 失败降级 fflate）
- `packages/app/android/app/src/full/java/io/pictelio/app/MainActivity.java`（`interceptImage` L198-228 当前恒返 `200`；`bytesResponse` L239-245）

**说明**：§2.3 结论「针对拦截响应 206 截断/ERR_FAILED，未找到公开 AOSP/Chromium 权威 issue 记录，仍以本项目实测为准」按任务要求如实标注，未编造。§3.2 的 `i.pximg.net` 206 + CORS 为自测事实（本会话 host curl，2026-08-31），未附长期权威出处。
