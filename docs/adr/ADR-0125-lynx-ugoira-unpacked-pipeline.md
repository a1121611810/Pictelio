# ADR-0125: lynx 原生模式 ugoira 播放管线采用 Java 解压写盘（file:// 帧 URL）

> 状态：已接受（2026-08-31）
> 相关：issue #218（ugoira 详情页大图加载失败）、ADR-0037（图片二进制零进 JS 堆）、`docs/research/ugoira-playback-alternatives.md`（2026-08-11 调研，选型 A/B/C 备选）、`docs/research/ugoira-native-pipeline-proto.md`（2026-08-31 原型实测，本 ADR 的一手证据）

## 背景

app-lynx（vue-lynx 客户端）在**原生 LynxView 模式**下打开 ugoira（Pixiv 动图）详情页，大图区域报错：

```
NativeModule: In module 'LynxFetchModule' method 'fetch':
java.lang.IllegalArgumentException: Expected URL scheme 'http' or 'https'
but no scheme was found for /pixiv...
```

根因：`api/ugoira.ts` 经 `proxyImageUrl()` 把 zip 绝对 CDN URL 重写为相对路径 `/pixiv-img/...`，再交 `requestFetch()`（原生模式 = `LynxFetchModule.fetch`）。原生 fetch 要求 URL 带 scheme（与 WebView 的 `shouldInterceptRequest` 代理不同——那仅拦截 WebView 请求，LynxView 内部不经过它）。

## 决策

**lynx 原生模式（`isNativeMode() === true`）的 ugoira 播放管线采用「Java 解压写盘」：**

1. Java 侧新增 `PictelioApi.ugoiraExtract(zipUrl, framesJson, cb)`：
   - OkHttp 下载 zip（注入 `Referer: https://app-api.pixiv.net/`（OAuthConfig.REFERER）+ UA）
   - `ZipInputStream` 解压（天然兼容 store/deflate 两种压缩法）
   - 按 `meta.frames` 顺序逐帧写 `cache/ugoira/frame_N.{png|jpg}`
   - 回调「帧 file:// URL 列表」JSON
2. `PictelioImageService` 支持 `file://` 帧：
   - `canParseUrl()` 放行 `file://`（原仅 http(s) 与 `/pixiv-img/`）
   - `loadAndDeliver()` 增加 file:// 分支：直接 `Files.readAllBytes` 读盘→采样解码→交付 Bitmap（不走 OkHttp）
3. JS 侧 `UgoiraViewer` 在原生模式改走 `ugoiraExtract` 取 URL 列表，`<image>` 逐个 `file://` 帧按 `meta.delay` 调度播放。

**明确排除**：
- 方案 A2（JS fetch 绝对 URL + Referer → fflate → base64 data URL）：取帧成功但 **data URL 渲染不可用**——自研 `ILynxImageService` 架构下 `<image>` 把 data URL 路由到 `PictelioImageService`，OkHttp 拒绝 `data:` scheme（原型 F3 实测）。且需 btoa polyfill（lynx 无 btoa，F4）。
- 方案 B（Java 网关下载字节 → JS fflate）：同上，data URL 渲染卡死 + base64 编解码双倍 CPU + 字节进 JS 堆（违反 ADR-0037）。

## 证据（原型实测，2026-08-31，pictelio_ui / android-34，作品 148861562，52 帧）

| 方案 | 结果 |
|---|---|
| 基线（现状相对路径） | FAIL：复现 issue #218（LynxFetchModule 拒绝无 scheme） |
| A（绝对 URL 无 Referer） | FAIL：HTTP 403（CDN 防盗链，实测证实） |
| A2（绝对 URL + Referer） | 取帧 OK（`unzipFrames` 52 帧），但 data URL 渲染 FAIL（F3） |
| B（Java 下载 + JS 解压） | 取帧 OK，但 data URL 渲染 FAIL（F3）+ 无 btoa/atob（F4） |
| **C（Java 解压写盘）** | **✅ 完整闭环：52 帧写盘、`img: C onLoad` 首帧真实渲染（F5）** |

关键事实：
- **F2** Referer 是硬性要求（无 Referer 403）；原生 fetch 支持 headers 传 Referer（子代理查证 lynx 源码 `LynxFetchModule.java`/`LynxHttpService.kt`），但默认不带。
- **F3** data URL 在自研 ImageService 架构下原生模式不可用（推翻研究文档 §1.2「base64 data URL 官方支持格式」的适用前提——那是**无自研 ImageService** 的默认引擎行为）。
- **F5** file:// 帧渲染需 PictelioImageService 放行（canParseUrl + loadAndDeliver 分支），原型已验证落地。

## 后果

### 正面
- **安全性最优**：zip 下载/解压/写盘全在 Java，JS 只拿帧 URL 列表（KB 级），图片二进制零进 JS 堆——完全符合 ADR-0037 安全模型（本 ADR 三方案中唯一满足）。
- **内存最优**：JS 堆峰值 ≈0；帧二进制在磁盘。
- **渲染路最干净**：复用现有 `<image>` + ImageService，无新渲染层；唯一无需业务 Web API（btoa/atob）的方案。
- **二次播放零下载**：帧已落盘（研究文档 §8.5 同结论）。
- **deflate 兜底**：`ZipInputStream` 天然兼容非 store 压缩（研究文档 §8.4）。

### 负面/代价
- **双端管线分叉**：web 模式仍走 fflate/Range + base64（该端 data URL 可用）；原生走解压写盘。这是架构事实（F3），不是实现分歧——不强制收敛（避免过度设计；若未来 lynx 引擎原生支持 data URL 或文件直读，可再评估收敛）。
- **缓存清理策略待补**：`cache/ugoira/` 需 LRU / 过期清理（研究文档 §8.5 已指出，本次实现必须处理，避免无限增长）。
- **首次播放需全量下载**：首帧 ~8s（移动网络更久）；二次播放零成本缓解。

## 兼容性/边界

- `ugoiraMode` 设置项（fflate/range）在原生模式**无意义**（不适用），保留用于 web 模式；Me 页设置项文案不动。
- 移动端空间敏感：帧文件按需写盘、播放完毕后**不删除**（配合 LRU 上限清理）。
- `file://` 只放行 `cache/ugoira/` 路径（白名单校验，防任意文件读取）。

## 待办（实现规范引用）

1. `PictelioApiModule` 新增 `ugoiraExtract`（替代原型 `protoExtractUgoira`，带缓存清理）
2. `PictelioImageService` file:// 分支（原型已验证改造点）
3. `UgoiraViewer.vue` 原生模式分支
4. 单测：帧 URL 契约、file:// 白名单、写盘失败路径；模拟器 E2E（pictelio_ui）
