# ADR-0154: 小说多格式导出（共享纯逻辑包 + 原生编码器 + 复用下载队列）

- 状态：accepted
- 日期：2026-09
- 关联：
  - 术语：[docs/adr/glossary-novel-export.md](./glossary-novel-export.md)
  - 规格：[docs/specs/novel-export.md](../specs/novel-export.md)
  - 工单：[docs/specs/novel-export-tickets.md](../specs/novel-export-tickets.md)
  - 复用：[ADR-0146](./ADR-0146-download-queue-export.md)（下载队列 + 原生编码器所有权）、[ADR-0145](./ADR-0145-image-save-download.md)（GallerySaver / 文件名单一事实源）、[ADR-0037](./ADR-0037-pixiv-api-plugin-gateway.md)（字节零进 JS 堆）、[ADR-0143](./ADR-0143-imagehost-download-source-java-sink.md)（图床下载源 Java 侧）、[ADR-0103](./ADR-0103-account-scoped-settings.md)（跨引擎设置键契约）、[ADR-0098](./ADR-0098-cross-engine-consistency.md)（跨引擎一致性）、[ADR-0089](./ADR-0089-update-check-shared-package.md)（共享纯逻辑包形态）

## 背景

小说是 Pictelio 的两大内容类型之一，但「只能看不能存/带走」：全仓（含 feature-gap 调研 P1-4）确认**无任何文档导出**——既有的「导出」只有 ugoira 多格式（GIF/MP4/WebP/APNG/ZIP/TAR，ADR-0146），面向图片字节而非文本内容。用户需求：单本小说导出为 **TXT/HTML/MD/DOC/PDF/EPUB**（可兼容更多格式），**app 与 app-lynx 双端支持**，导出格式与内容开关**统一在设置页配置**。

需求以 grill-with-docs 交互确认（本轮用户已逐条应答，见 spec §11）。关键事实：两端正文数据形态不同（app 有 `parseNovelBlocks` 块 IR + images map；app-lynx 只有纯文本字符串，且缺 images 提取）；Android 端**没有任何 PDF/EPUB/DOCX 文档生成库**（jspdf/pdf-lib/docx/epubjs 全缺），新增 npm 依赖还需过 `minimumReleaseAge` 供应链门禁；PDF 的 CJK/RTL 在纯 JS 库上需要嵌入 5–16MB 字体或 300KB+ 的 fontkit，质量与体积都差；而 Android 原生 `android.graphics.pdf.PdfDocument` + `StaticLayout` 可直接用系统 CJK 字体、零字体载荷。

## 决策

### D1：共享纯逻辑包 `@pictelio/novel-export`（跨端单一事实源）

新建 workspace 包，承载双端共用的**零 DOM、零框架纯逻辑**：格式白名单/`NOVEL_EXPORT_FORMATS`/标签/扩展名/MIME、Pixiv 正文 HTML 提取（`extractNovelTextFromHtml`/`extractNovelDataFromHtml`）、正文块解析（`parseNovelBlocks`/`parseInlineRuns`）、导出文档模型构造 `buildNovelExportPayload`、任务草稿构造 `buildNovelExportTaskDraft`。app 的 `utils/novelBlocks.ts` 与 `api/novel.ts` 对应函数改为 **re-export**（消费方零改动），app-lynx 直接消费该包（顺带补齐其缺失的 images 提取）。理由：`parseNovelBlocks` 是带 Pixiv 标记语义的非平凡逻辑，双实现必然漂移；共享包是 `@pictelio/ugoira`/`update-check` 已确立的形态（ADR-0089），且格式白名单/标签同时被两端设置 UI 与契约测试消费。

**否决**：源复制（downloadQueueCore 式）——队列核心源复制尚可忍受，但把 130+ 行的标记解析器复制两份违背测试硬约束 #4 的重构无回归要求，且格式白名单漂移会直接导致「设置项存了一个本端不认的值」。

### D2：全部格式编码在原生 Java 深模块 `NovelExporter`（单一编码实现）

`src/main/java/io/pictelio/app/NovelExporter.java`（双引擎共享）实现 9 种格式：`txt/html/md/rtf/json/fb2` 为字符串序列化；`epub`/`docx` 用 `java.util.zip.ZipOutputStream` 组装容器；`pdf` 用 `android.graphics.pdf.PdfDocument` + `StaticLayout`（系统 CJK 字体、按行分页、插图缩放绘制）。封面与正文插图经 `PixivImageLoader` 在 Java 侧取字节（缓存优先 + 图床 + Referer/UA，ADR-0143 语义不复制），**字节零进 JS 堆**（ADR-0037）。JSON 保留原始 IR，是其余编码器的逻辑「源」。

**否决**：(a) 用 `docx`/`jspdf`/pdf-lib 等 npm 库——Lynx web-core/PrimJS 无 DOM/Blob，根本无法运行；Android 侧 CJK 需巨额字体载荷；且新增依赖需过供应链门禁。(b) 文本格式在 JS、二进制在原生——产生双实现，且 web-core 仍跑不了文本格式的原生落盘路径，收益仅「浏览器 dev 能看」，不值得。(c) WebView `createPrintDocumentAdapter` 打印为 PDF——保真度略高，但需主线程创建/加载 WebView + 异步 adapter，难以在后台执行器与 Robolectric 中稳定测试；`PdfDocument` 确定性更好。

**代价**：webview 浏览器 preview 与 lynx web-core **不生成任何格式**，任务显式失败 + `console.warn`（不伪造成功）；编码器覆盖面（9 格式）全部由 Java 单测承担。

### D3：复用下载队列（`kind = "novel"`），不新建执行通道

导出作为下载队列的一种任务类型：`DownloadKind += "novel"`，`DownloadTask` 增加可选 `payloadJson`（序列化的 `NovelExportPayload`，opaque 字符串，队列核心不解析其结构）。这样免费获得：持久化（`download_queue_v1`）、跨重启恢复、开始/暂停/停止/删除、进度、下载页统一管理与分享。任务创建即**快照** `targetFormat` 与内容开关（复用 ADR-0146 D2），之后改设置不影响已入队任务。

**否决**：新建独立导出通道/页面——重复持久化、进度、分享、UI，且与用户「复用下载队列」的确认相悖。

**payloadJson 体积**：小说正文通常 10KB–2MB，作为队列 JSON 的一部分持久化。相较图片/动图任务（只存 URL）更重，但队列本就以 JSON 持久化于 SharedPreferences，且这是「重启可恢复」的必要成本；spec §4.4 要求对其做 schema 校验 + 损坏丢弃 + warn。

### D4：默认格式 `txt`，导出面板可临时覆盖

设置键 `settings_novel_export_format`（跨端同一字面量）默认 `txt`：最通用、零图像管线、最快，对齐 feature-gap 调研「TXT first」与 ADR-0146「默认取无损/无风险项（zip）」的取向。导出面板预选该默认值并允许**本次临时覆盖**（不写回全局），满足用户「统一在设置页设置 + 单次灵活」的双重要求。

### D5：内容开关三项全局（默认全开），正文恒含

`settings_novel_export_include_metadata` / `_include_cover` / `_include_images`，默认均 `true`；正文恒导出。文本类格式（txt/md/rtf）无内嵌图像能力，封面/插图退化为元数据区/图片段落的**链接**（能力矩阵见 spec §5），不视为开关失效。开关在设置页，导出面板只读展示摘要（用户确认「设置页增加设置，可取消勾选」）。

### D6：输出落 `Downloads/Pictelio`，导出流程不弹分享

复用 `GallerySaver.saveDownloadFile`（API ≥ 29 `MediaStore.Downloads` + `RELATIVE_PATH=Downloads/Pictelio`，IS_PENDING 两段式；API 28 应用专属目录 + MediaScanner）。文件名单一事实源在 JS：`Pictelio_<novelId>.<ext>`（`buildNovelExportTaskDraft`），Java 仅 `sanitizeFileName` 防御。**需要**扩展 `GallerySaver`/`ShareHelper` 的 MIME 白名单以覆盖文档类型（当前白名单只有图片/视频/zip/tar，未知回退 `image/jpeg`——对文档是错的）。分享由下载页对已完成条目提供（既有能力），导出流程不自动弹。

### D7：设置与 UI 落位（两端各自贴合既有结构）

- **app**：新增 `components/settings/SettingsExport.tsx` 卡片（格式选择 + 三项开关），注册进 `SettingsSections`；详情页入口放 `NovelFooterNav` pill 行（与「显示设置」同级），弹 `ExportSheet`（底部面板，对齐 `ReaderSettingsSheet`）。
- **app-lynx**：`pages/Me.vue` 新增「导出」分组（M3 Tailwind chip/switch），入口放 `NovelDetail.vue` 操作行，弹覆盖层面板（复用既有弹层挂载契约）。

## 后果

- 正向：小说从「只能看」升级为 9 格式可带走；编码单实现、双端一致；导出复用队列的持久化/进度/取消/分享；格式白名单与正文解析跨端单源。
- 代价：队列 JSON 因 `payloadJson` 变重（长文）；9 个 Java 编码器的维护面；PDF/DOCX/EPUB 真机渲染保真度需设备批次验收；浏览器 dev 无法端到端验证导出产物（只能单测 IR/队列 + Java 编码器测试）。
- 明确不做：整系列/列表级批量导出、逐本格式、iOS、导出流程内分享、云端生成、浏览器端编码。

## 验证

- TS 纯函数（`@pictelio/novel-export`）：正文提取与块解析（真实 Pixiv HTML 样例，含 ruby/memo/样式/插图/jump）、payload 构造（开关组合）、格式白名单/扩展名/MIME、任务草稿（格式快照、文件名）。
- 队列核心（双端同规格）：`kind=novel` 入队、`payloadJson` 序列化往返、损坏丢弃 + warn、`downloading→paused` 恢复。
- Java 编码器：9 种格式各自从真实 payload 生成、容器结构断言（EPUB mimetype 首个且 stored、DOCX core 部件、PDF 页数/文本可提取）、CJK 文本不丢字、MIME 映射。
- 组件：`SettingsExport`（格式/开关读写）、`ExportSheet`（默认预选、临时覆盖、确认入队参数）。
- 门禁：`check:all` / `lint` / `test:app` / `test:app-lynx` / Java 单测 / `fmt:check`。
- 真机（设备批次）：四端×至少 txt/pdf/epub/docx 落盘可见、下载页可分享、长文 PDF 分页与 CJK 正确。
