# 小说导出（TXT/HTML/MD/DOCX/PDF/EPUB + RTF/JSON/FB2）— 术语表

> 范围：`pictelio-app`（webview 客户端）与 `pictelio-app-lynx`（Lynx 客户端）双端共有的小说导出能力、共享纯逻辑包、原生编码器深模块、导出任务与队列契约。配套：[ADR-0154-novel-export.md](./ADR-0154-novel-export.md)、[spec novel-export](../specs/novel-export.md)。

## 核心术语

| 术语 | 定义 |
|------|------|
| **小说导出（Novel export）** | 把单本 Pixiv 小说的元数据与正文（含章节、行内样式、封面、正文内嵌插图）序列化为用户可脱离 App 阅读/存档的**文档文件**，落到系统「下载」目录。区别于「下载队列」里的图片/动图（那是把原始字节搬到用户空间）——导出是**内容重组 + 重新编码**。 |
| **导出文档模型（NovelExportPayload）** | 跨端、JSON 可序列化的内容中间表示（IR）：`{ schema, meta, blocks }`。`meta` = 标题/作者/标签/系列/发布日期/原文链接/简介/封面 URL；`blocks` = 由 `parseNovelBlocks` 产出的块序列（text/chapter/pageBreak/image/jump）。它是**所有格式编码器的唯一输入**，也是导出任务的载荷。 |
| **导出格式（NovelExportFormat）** | 9 种：`txt | html | md | docx | pdf | epub | rtf | json | fb2`。必需集 = 用户点名的 TXT/HTML/MD/DOC/PDF/EPUB（DOC 落为真 OOXML `.docx`）；兼容附加集 = RTF/JSON/FB2。白名单的单一事实源在共享包 `@pictelio/novel-export`。 |
| **内容开关（Export content options）** | 设置页三项全局布尔：`includeMetadata`（元数据，默认开）、`includeCover`（封面，默认开）、`includeInlineImages`（正文内嵌插图，默认开）。**正文恒含**，不可关。文本类格式（txt/md/rtf）对封面/插图无内嵌能力，退化为元数据中的链接（尽力而为，能力矩阵见 spec §5）。 |
| **默认导出格式（Default export format）** | 设置页选择的全局格式（键 `settings_novel_export_format`，默认 `txt`）。导出面板打开时以其为预选，允许**临时覆盖本次格式**（不写回全局）。 |
| **导出面板（Export sheet）** | 详情页点击「导出」后弹出的确认面板：格式选择（预选默认格式）+ 内容开关只读摘要 + 「导出」。确认后**入队**并提示「已加入下载队列」，可跳转下载页。 |
| **导出任务（Novel export task）** | 下载队列中的一种任务：`kind = "novel"`。除通用字段外携带 `payloadJson`（导出文档模型）与 `targetFormat`。任务创建即**快照**格式与内容开关；之后改设置不影响已入队任务（复用 ADR-0146 D2 语义）。 |
| **共享纯逻辑包（@pictelio/novel-export）** | 双端 `workspace:*` 依赖的纯函数包：格式白名单/标签/扩展名/MIME、Pixiv 正文 HTML 提取、正文块解析（`parseNovelBlocks`/`parseInlineRuns`）、导出文档模型构造 `buildNovelExportPayload`、任务草稿构造 `buildNovelExportTaskDraft`。零 DOM、零框架、node 可单测。app 的 `utils/novelBlocks.ts` 与 `api/novel.ts` 中的提取函数**改为从本包 re-export**（消除双实现漂移）。 |
| **原生编码器深模块（NovelExporter）** | Java 深模块 `src/main/java/io/pictelio/app/NovelExporter.java`，双引擎共享。输入 = `NovelExportPayload` JSON + 格式 + 文件名；输出 = 目标格式文件（cache，供 `GallerySaver.saveDownloadFile` 落盘）。**9 种格式的编码全部在此**（含 PDF 排版 / EPUB 容器 / OOXML），是格式正确性的单一事实源（ADR-0154 D2）。 |
| **导出桥（Novel export bridge）** | 复用既有 `PictelioDownloader` 薄壳：webview `PictelioDownloaderPlugin.start({..., kind:"novel", targetFormat, payloadJson})`；lynx `PictelioDownloaderModule.start(id, sourceUrl, fileName, kind, targetFormat, framesJson, payloadJson, cb)`。原生 `PictelioDownloader.downloadNovel()` 路由到 `NovelExporter`。 |
| **输出落点（Downloads/Pictelio）** | 导出文件统一落 `MediaStore.Downloads`（API ≥ 29，`RELATIVE_PATH = Downloads/Pictelio`）/ API 28 应用专属 `Downloads/Pictelio` + MediaScanner（复用 `GallerySaver.saveDownloadFile`）。用户在系统「文件」中可见；本功能**不自动弹分享面板**（分享在下载页对已完成条目提供，复用 `ShareHelper`）。 |
| **图片字节零进 JS 堆** | 承袭 ADR-0037/ADR-0146 D1：封面与正文插图由 `NovelExporter` 经 `PixivImageLoader`（缓存优先 + 图床 resolve + 防盗链注入）**在 Java 侧取字节**并直接嵌入目标文件；JS 只持有 URL。 |
| **降级可见（No silent degradation）** | 正文插图中某张下载失败 → 跳过该图并 `Log.w` 记录（导出仍成功，图片为补充内容）；解码/容器生成的硬失败 → 抛可读 `IOException` → 任务进入 `failed` 并显示原因。绝无静默成功。 |
| **web/dev 显式不支持（Web unsupported）** | webview 的浏览器 preview 与 lynx 的 web-core 无原生模块：导出任务显式失败并 `console.warn`（不伪造成功）。本功能不在浏览器端生成文档——编码只在原生侧（ADR-0154 D2）。 |

## 双端对称契约速查

| 能力 | webview 侧（pictelio-app） | lynx 侧（app-lynx） |
|------|---------------------------|---------------------|
| 共享纯逻辑 | `@pictelio/novel-export`（workspace:*） | 同左（workspace:*） |
| 原生薄壳 | `PictelioDownloaderPlugin`（Capacitor，双 MainActivity 注册，扩展 `kind=novel`） | `PictelioDownloaderModule`（LynxModule，扩展 `kind=novel`） |
| 编码器 | `NovelExporter.java`（main sourceSet，共享） | 同左 |
| 队列核心 | `utils/downloadQueueCore.ts`（`DownloadKind += "novel"`、`payloadJson`） | 同源同语义副本（同步改） |
| 设置 | `stores/settingsStore.ts` + `components/settings/SettingsExport.tsx` 卡片 | `stores/settingsStore.ts` Pinia + `pages/Me.vue`「导出」组 |
| 导出入口 | `NovelDetail` 底部导航栏「导出」pill → `ExportSheet`（FluentDialog） | `NovelDetail.vue` 操作行「导出」→ 覆盖层面板 |
| 产出 | `Downloads/Pictelio/` + 下载页可分享 | 同左 |

## 易混淆概念辨析

- **「导出」≠「下载队列」**：队列是承载与调度机制（持久化/进度/取消/分享），导出是**新增的任务类型**（`kind=novel`）与**内容编码能力**。图片/动图任务搬运既有字节；小说任务生成新字节。
- **「导出格式」≠「ugoira 下载格式」**：两者都是全局设置 + 入队快照，但格式集与编码器完全不同，键分别为 `settings_novel_export_format` 与 `settings_ugoira_download_format`，不可混用。
- **DOC 口径**：用户所说 DOC 落为 **真 OOXML `.docx`**（`docx` 扩展名 + `application/vnd.openxmlformats-officedocument.wordprocessingml.document`），不是 HTML 伪装 `.doc`——避免 Word「文件格式与扩展名不符」警告。
- **「默认格式」≠「本次格式」**：设置页只定默认；导出面板的临时选择只作用于本次任务，不改全局。
- **封面/插图开关**：开关控制**是否嵌入图像资产**（下载并编码），不影响元数据中原文链接的存在（元数据开关单独控制）。
