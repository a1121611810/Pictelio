# Ugoira 原生播放管线原型实测报告（prototype/ugoira-native-pipeline）

> 日期：2026-08-31（pictelio_ui / android-34 模拟器，Lynx 4.0.1，作品 148861562，52 帧）
> 触发：issue #218（ugoira 详情页大图加载失败）+ 用户「lynx 动图显示异常」报告。
> 原型分支：`prototype/ugoira-native-pipeline`（throwaway，验证后删除）。
> 本报告是原型阶段的一手证据留档；最终选型结论见 ADR-XXXX 与 to-spec。

## 一、测试环境

| 项 | 值 |
|---|---|
| 模拟器 | `pictelio_ui`（emulator-5556，android-34，WebView 113） |
| APK | full flavor debug（`assembleFullDebug`，含 lynx bundle 296KB） |
| 网络 | 模拟器 `settings put global http_proxy 10.0.2.2:10808`（宿主代理） |
| 作品 | 148861562（issue #218 复现作品，ugoira，52 帧） |
| 登录 | `PIXIV_REFRESH_TOKEN`（本机 zshrc）adp input 注入 |

## 二、各方案实测结果（运行全部按钮，一轮内完成）

| 方案 | 现象 | 结果 | 用时 |
|---|---|---|---|
| 基线（现状：`/pixiv-img` 相对路径 fetch） | `IllegalArgumentException: Expected URL scheme 'http' or 'https' but no scheme was found for /pixiv...` | ❌ FAIL（issue #218 复现确认） | ~300ms |
| A：原生 fetch 绝对 URL（无 Referer） | `HTTP 403`（CDN 防盗链校验 Referer，实测证实） | ❌ FAIL | ~1.4-2s |
| A2：原生 fetch 绝对 URL + `Referer: https://app-api.pixiv.net/` | 下载成功 + fflate 取帧成功（`unzipFrames` 正常） | ⚠️ 取帧 OK,但 data URL 渲染失败 | ~9-11s |
| B：Java 网关下载（protoDownloadFile 回传 base64）→ JS fflate 取帧 | 下载 + 取帧成功（atob/btoa 需 polyfill，lynx 无全局） | ⚠️ 取帧 OK,但 data URL 渲染失败 | ~8-12s |
| C：Java 解压写盘（protoExtractUgoira → file:// 帧 URL）→ `<image>` 直接播放 | 52 帧写盘 `cache/ugoira-proto/`，`img: C onLoad` 首帧真实渲染 | ✅ 完整闭环成功 | ~8.3s |

## 三、关键事实（原型实测发现，均超预期）

### F1. 基线复现：issue #218 根因确认
`LynxFetchModule`（原生 fetch）拒绝无 scheme 相对路径。stack trace 见 logcat（`okhttp3.HttpUrl... no scheme was found for /pixiv...`）。
**修复方向：原生模式下必须使用绝对 CDN URL。**

### F2. Referer 是硬性要求（推翻研究文档 §7.1 的侥幸结论）
A（无 Referer）→ 403；A2（带 Referer）→ 取帧成功。子代理查证（lynx 源码 `LynxFetchModule.java`/`LynxHttpService.kt`）确认：
- 原生 fetch **支持** init.headers 传自定义头（Referer 非 forbidden header，可信度 ~90%）
- 原生 fetch **默认不带** Referer（OkHttp 无拦截器，可信度 ~90%）
- 研究文档 §7.1 的「无 Referer 206」很可能是 CDN 缓存预热放行（cache-miss 才校验，可信度中低）
- **Referer 值必须是 `https://app-api.pixiv.net/`（OAuthConfig.REFERER），不是 www.pixiv.net**

### F3. data URL 在自研 ImageService 架构下不能渲染（重大发现）
A2/B 取帧成功 + 生成 `data:image/png;base64,...` 后，`<image>` 把 data URL 交给了 `PictelioImageService`，OkHttp 拒绝：`Expected URL scheme 'http' or 'https' but was 'data'`。
**这推翻研究文档 §1.2「base64 data URL 是原生 <image> 官方支持格式」——在注册了自研 `ILynxImageService` 的架构下，data URL 不走引擎默认通道，全部路由到 ImageService → OkHttp → 拒绝。**
**生产 `UgoiraViewer.vue` 的 base64 播放方案在原生模式下即使修好下载也会卡在渲染。**（注：web-core 预览下 data URL 可能仍可用——引擎差异待验证，但原生模式已确认不可用。）

### F4. lynx 原生环境无 btoa/atob（B 方案额外代价）
原型页 A2/B 均报 `btoa/atob is not defined`，需内联 polyfill（原型已实现了 `bytesToDataUrlProto`/`atobProto`）。生产代码 `api/ugoira.ts::bytesToDataUrl` 依赖 `btoa`——**在原生模式下该函数本身就不可用**，即使数据管线通了也会失败。

### F5. file:// 帧渲染需要 PictelioImageService 支持（方案 C 的改造点）
原生 `<image>` 的 src 为 `file:///data/user/0/io.pictelio.app/cache/ugoira-proto/frame_0.jpg` 时：
- 需要 `PictelioImageService.canParseUrl()` 放行 `file://`（原本只放行 http(s) 与 /pixiv-img/）
- 需要 `loadAndDeliver()` 增加 file:// 分支（直接 `Files.readAllBytes`，不走 OkHttp）
- 研究文档 §7.3 已预判此改造点，本次原型落地验证 ✅

### F6. vue-lynx 响应式：对象属性变更不触发模板更新（原型开发中发现）
`cResult.value = r` 后修改 `r.status` 等属性，UI 不刷新；改为整体替换 ref 值（`cResult.value = {...r, status: 'ok'}`）后立即生效。
（仅原型页用到的坑，生产 UgoiraViewer 的 ref 用法需留意。）

## 四、方案四维对比（基于实测数据 + 架构事实）

> 打分标准：优/良/中/差。所有「不可模糊」结论均有实测或源码证据支撑。

| 维度 | A2：JS fetch 绝对 URL + Referer | B：Java 网关下载字节 | C：Java 解压写盘 file:// |
|---|---|---|---|
| **高可维护性** | 中：改 `ugoira.ts` 3 处 + data URL 渲染需重做（F3 推翻现有 base64 方案，需新增 canvas/其它渲染路径）；必须处理 btoa polyfill（F4） | 差：Java 新增下载方法 + JS base64 编解码 polyfill + 渲染路仍被 F3 卡住，**三面改动** | 良：Java 一个方法（下载+解压+写盘）+ ImageService 两个 if 分支（F5）；渲染直接用现有 `<image>` 组件，无需新渲染层 |
| **高性能** | 良：首帧需全量 zip 下载 + fflate 取帧（~9s 含 base64 编码；去 base64 后 ~2-3s）；慢网下全量下载 | 中：同上，但 base64 编码/解码双倍 CPU（F4） | 良：Java 侧 OkHttp + ZipInputStream（CPU 快于 JS 线程）~8s 全量；**二次播放零下载**（帧已落盘，实测研究文档 §7.3 同结论） |
| **高安全性** | 差：zip 二进制进 JS 堆 + 全帧 base64 常驻（研究文档 §8.3 峰值 9-13MB）；token 仍在 Java 堆（API 路径不变），但文件下载绕过 Java 网关 | 差：zip 经 base64 回传 JS 堆（4.45MB → ~6MB base64），违反 ADR-0037「图片二进制零进 JS 堆」 | **优：zip 下载/解压/写盘全在 Java，JS 只拿 52 个 URL 字符串（KB 级）；符合 ADR-0037 安全模型最彻底** |
| **低内存** | 差：zip 4.45MB + 帧 ~4.4MB + base64 33% 膨胀 | 差：同左 | **优：JS 堆 ≈0（仅 URL 列表）；帧二进制全在磁盘** |

### 四维汇总

| 方案 | 可维护性 | 性能 | 安全性 | 内存 | 总分 |
|---|---|---|---|---|---|
| A2（JS fetch） | 中 | 良 | 差 | 差 | **良-** |
| B（Java 下载字节） | 差 | 中 | 差 | 差 | **差** |
| C（Java 解压写盘） | **良** | 良 | **优** | **优** | **优** |

## 五、结论（不可模糊）

**选型：方案 C —— Java 解压写盘（file:// 帧 URL 列表播放），作为 lynx 原生模式的 ugoira 播放管线。**

依据（全部有实测/源码证据）：
1. **唯一完整闭环方案**（实测 ✅，F5 改造点已验证）。
2. **唯一符合 ADR-0037「图片二进制零进 JS 堆」安全模型的方案**（F3/F4 证明 A2/B 的数据必须进 JS 且渲染还失败）。
3. **渲染路最干净**：复用现有 `<image>` + `PictelioImageService`，无新渲染层（A2/B 被 F3 卡死需重做渲染）。
4. **性能最优**：二次播放零下载（帧已落盘）；首帧 ~8s 在移动端可接受（研究文档 §8.2 同结论）。
5. **唯一不需要 btoa/atob polyfill 的方案**（F4，A2/B 都需要）。

**明确排除**：A2/B（data URL 渲染在原生模式不可用 = F3，投入产出比归零）。

**遗留问题（不在本原型范围，跟踪用）**：
- 缓存清理策略：`cache/ugoira-proto/` 当前无限增长（研究文档 §8.5 已指出），正式实现需给 `cache/ugoira/` 加 LRU/过期清理；
- 双端差异：web/webview 端仍走现有 fflate + base64（该端 data URL 可用）；lynx 原生走方案 C。是否收敛为单实现由 ADR 决策（初步：双端管线差异是既有架构事实，不强求收敛，避免过度设计）；
- zip 非 store 模式兜底：`ZipInputStream` 天然兼容 deflate（研究文档 §8.4 优点），无需额外处理。

## 六、原型改动清单（留档，正式实现后删除）

- `packages/app-lynx/src/pages/ProtoUgoira.vue` — 原型页（throwaway）
- `packages/app-lynx/src/router.ts` — 注册 `/proto-ugoira` 路由 + 临时首路由（第 234 行 `[PROTOTYPE]`）
- `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioApiModule.java` — `protoExtractUgoira` / `protoDownloadFile`（@LynxMethod，原型专用）
- `packages/app/android/app/src/lynx/java/io/pictelio/app/PictelioImageService.java` — `loadAndDeliver` file:// 分支 + `canParseUrl` 放行 file://（改造点 F5，正式实现应保留此改造语义）

## 九、app（webview 客户端）侧回归验证（2026-08-31 追加）

**疑问**：app 与 lynx 共用 ugoira（`@pictelio/ugoira` 共享包），lynx 改动是否影响 app？

**静态结论（diff 证据）**：本次改动（a60ad1e..2c970c1）仅触及：
- `packages/app-lynx/`（api/ugoira.ts、UgoiraViewer.vue、tests）
- `packages/app/android/app/src/lynx/java/`（PictelioApiModule、PictelioImageService）
`packages/app/src/`、`packages/ugoira/`、`packages/app/android/app/src/main/`、`packages/app/android/app/src/webview/` **零改动**。

**模拟器实测（pictelio_ui，webview 客户端模式）**：
1. 切回 `pictelio_client_kind=webview`，启动 app → 推荐页正常
2. 搜索「ugoira」→ 点开带「▶ 动图」角标的作品详情
3. 点播放按钮 → **三次截图哈希全部不同（e73c... → 1fc1... → 2ab3...）→ 动图持续播放** ✓
4. 详情页元数据（标题/作者/标签/收藏数/角标）渲染正常，无异常文本

**结论**：共享的是「取帧数据层」（纯函数 zip 解析），渲染层（app=blob URL + `<img>`；lynx=file:// + `<image>`）与播放调度独立。app 侧零风险，与 ADR-0125 的「双端管线分叉是架构事实」一致。
