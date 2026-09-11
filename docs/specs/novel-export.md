# Spec: 小说多格式导出（TXT/HTML/MD/DOCX/PDF/EPUB + RTF/JSON/FB2）

- 状态：ready-for-implementation（2026-09；配套 ADR-0154 / glossary-novel-export）
- 日期：2026-09
- 关联：ADR-0154（本 spec 的决策记录）、glossary-novel-export、ADR-0146（下载队列 + 原生编码器所有权）、ADR-0145（GallerySaver / 文件名单一事实源）、ADR-0037（字节零进 JS 堆）、ADR-0143（图床下载源 Java 侧）、ADR-0103（跨引擎设置键）、ADR-0098（跨引擎一致性）
- 工单：docs/specs/novel-export-tickets.md

## 1. 背景与目标

两端小说详情页目前「只能看不能带走」：全仓无任何文档导出（feature-gap 调研 P1-4 已记录），既有「导出」仅 ugoira 动图。本 spec 交付**单本小说**导出为 9 种格式，双端一致，格式与内容开关统一在设置页配置：

1. **必需格式**：TXT / HTML / MD / DOCX / PDF / EPUB（DOC 落为真 OOXML `.docx`）。
2. **兼容附加格式**：RTF / JSON / FB2。
3. **内容**：正文（恒含）+ 元数据 + 封面 + 正文内嵌插图（后三者由设置页开关控制，默认全开）。
4. **落点**：`Downloads/Pictelio`（系统「文件」可见）；导出流程不弹分享。
5. **执行**：复用下载队列（`kind="novel"`），获得持久化/进度/取消/删除/下载页分享。
6. **设置**：全局默认格式（默认 `txt`）+ 三项内容开关；导出面板可临时覆盖本次格式。

## 2. 非目标（Out of Scope）

- **整系列 / 列表级批量导出**（多章节或多本）——UI 与逐章抓取复杂度高，需独立立项。
- **逐本内容/格式设置**——格式与开关只来自全局设置 + 本次临时覆盖。
- **iOS**（项目仅 Android）。
- **导出流程内分享**（分享在下载页对已完成条目提供，复用既有 `ShareHelper`）。
- **浏览器端编码**（webview preview / lynx web-core 无原生模块——显式失败 + warn）。
- **译文导出**、**阅读进度/书签导出**、**云/服务端生成**。
- **导出内容再导入**（JSON 虽为无损 IR，但无回导 UI）。

## 3. 领域模型

### 3.1 NovelExportFormat（共享包单一事实源）

```ts
export type NovelExportFormat =
  | "txt" | "html" | "md" | "docx" | "pdf" | "epub" | "rtf" | "json" | "fb2";
export const NOVEL_EXPORT_FORMATS = ["txt","html","md","docx","pdf","epub","rtf","json","fb2"] as const;
export const DEFAULT_NOVEL_EXPORT_FORMAT: NovelExportFormat = "txt";
export const NOVEL_EXPORT_FORMAT_LABELS: Record<NovelExportFormat, string> = {
  txt: "TXT", html: "HTML", md: "Markdown", docx: "Word (.docx)",
  pdf: "PDF", epub: "EPUB", rtf: "RTF", json: "JSON", fb2: "FB2",
};
export function extForNovelExportFormat(f: NovelExportFormat): string;
export function mimeForNovelExportFormat(f: NovelExportFormat): string;
```

### 3.2 NovelExportOptions（内容开关）

```ts
export interface NovelExportOptions {
  includeMetadata: boolean;   // 默认 true
  includeCover: boolean;      // 默认 true
  includeInlineImages: boolean; // 默认 true
}
export const DEFAULT_NOVEL_EXPORT_OPTIONS: NovelExportOptions = { includeMetadata: true, includeCover: true, includeInlineImages: true };
```

### 3.3 NovelExportPayload（导出文档模型 / IR）

```ts
export interface NovelExportMeta {
  id: number;
  title: string;
  authorId: number;
  authorName: string;
  tags: string[];
  seriesId?: number;
  seriesTitle?: string;
  createDate: string;
  sourceUrl: string;      // https://www.pixiv.net/novel/show.php?id=<id>
  description?: string;   // caption 去标记后的纯文本
  xRestrict: number;
  coverUrl?: string;      // image_urls.large ?? medium ?? square_medium
}
export type NovelExportBlock =
  | { type: "text"; index: number; text: string; inlineRuns?: InlineRun[] }
  | { type: "image"; imageId: string; url: string }   // 已解析为可下载的单 URL
  | { type: "pageBreak" }
  | { type: "chapter"; title: string }
  | { type: "jump"; kind: "illust"|"novel"|"user"|"external"|"unknown"; target: string; url: string };
export interface NovelExportPayload {
  schema: 1;
  meta: NovelExportMeta;
  options: NovelExportOptions;
  blocks: NovelExportBlock[];
}
```

- `InlineRun` 沿用 `parseNovelBlocks` 的 `{ start, end, tag: "bold"|"italic"|"strike"|"underline" }`。
- 图片 URL 解析顺序：`urls["1200x1200"] ?? urls["original"] ?? urls["480mw"] ?? urls["240mw"]`（缺失则丢块并 `console.warn`）。
- jump URL：`illust/123`→`https://www.pixiv.net/artworks/123`；`novel/123`→`https://www.pixiv.net/novel/show.php?id=123`；`user/123`→`https://www.pixiv.net/users/123`；external 原样；unknown 原样。

### 3.4 构造器（共享包）

```ts
buildNovelExportPayload(input: {
  novel: PixivNovelLike;               // 结构化最小字段（id/title/user/image_urls/tags/series/create_date/caption/x_restrict）
  text: string;                         // 正文原文
  images: NovelImagesMapLike | null;    // [pixivimage:id] 映射
  options: NovelExportOptions;
}): NovelExportPayload;

buildNovelExportTaskDraft(input: {
  payload: NovelExportPayload;
  format: NovelExportFormat;
  title: string;
  thumbnailUrl: string;
}): NovelExportTaskDraft;               // kind:"novel" + payloadJson + targetFormat + fileName
```

任务 id：`novel_<id>_<format>_<sig>`，`sig = [m,c,i].map(on=>on?"1":"0").join("")`（内容开关签名，保证改开关后可另存一条；同格式同开关重复导出按 id 去重）。文件名：`Pictelio_<id>.<ext>`。

## 4. 架构

```
详情页（两端）
  │ 导出动作（格式预选全局默认 / 可临时覆盖）
  ▼
@pictelio/novel-export（共享纯逻辑包：提取 + 块解析 + payload + 任务草稿）
  │ enqueue(DownloadTaskDraft)  ← 复用下载队列
  ▼
downloadQueueCore.ts（双端；kind="novel" + payloadJson 快照）
  │ schedule → executor.start({kind:"novel", targetFormat, payloadJson, fileName})
  ▼
PictelioDownloaderPlugin / PictelioDownloaderModule（薄壳）
  ▼
PictelioDownloader.downloadNovel(...)（main sourceSet 深模块）
  ▼
NovelExporter.export(payloadJson, format, id) → File
  ├─ 封面/插图：PixivImageLoader（缓存优先 + 图床 + Referer/UA；字节零进 JS 堆）
  └─ 9 格式编码
  ▼
GallerySaver.saveDownloadFile(file, fileName) → content:// | file://
```

### D1 共享包 `@pictelio/novel-export`（跨端单源）
app 的 `utils/novelBlocks.ts` 与 `api/novel.ts` 的 `parseNovelBlocks`/`parseInlineRuns`/`extractNovelTextFromHtml`/`extractNovelDataFromHtml` **移入本包，原处 re-export**（消费方零改动）；app-lynx 直接消费本包（补齐其缺失的 images 提取）。包形态对齐 `@pictelio/update-check`（`main/types/exports → ./src/index.ts`，零依赖，自带 vitest）。

### D2 原生编码器 `NovelExporter.java`（main sourceSet，双引擎共享）
见 §5。全部同步阻塞、可取消（轮询 `AtomicBoolean`）；失败抛可读 `IOException`（无静默降级）。

### D3 队列集成
- `DownloadKind += "novel"`；`DownloadTask.payloadJson?: string`（opaque）。
- `newTask` 复制 `payloadJson`；`normalizeTask` 接受 `kind==="novel"` 与字符串 `payloadJson`。
- 桥契约：`kind==="novel"` 时 `targetFormat` 与 `payloadJson` 必填，缺失即 reject/err。
- 快照语义：入队即写死 `targetFormat` 与 `payloadJson`（内容开关已内嵌），改设置不影响已入队任务。

### D4 落盘与 MIME
`GallerySaver.saveDownloadFile` 落 `Downloads/Pictelio`。**必须扩展** `GallerySaver.mimeForName`/`mimeFor` 与 `ShareHelper.mimeForName` 的文档 MIME 映射（当前未知回退 `image/jpeg`）：
`txt→text/plain, html→text/html, md→text/markdown, docx→application/vnd.openxmlformats-officedocument.wordprocessingml.document, pdf→application/pdf, epub→application/epub+zip, rtf→application/rtf, json→application/json, fb2→application/x-fictionbook+xml`。

## 5. 格式能力矩阵（NovelExporter）

| 格式 | 元数据 | 封面 | 正文插图 | 容器/要点 |
|------|--------|------|----------|-----------|
| txt | 头部段落 | 链接行 | 图片 URL 行 | UTF-8 **BOM**；段落间空行；`[chapter:]`→`## `；`[newpage]`→分隔行 |
| html | `<header>` | `<img src="data:...">` | `<img src="data:...">` | 单文件自包含 + 内联 CSS；`<ruby>` 保注音；`<h2>` 章节；转义 5 字符 |
| md | YAML front matter（可选）或首段 | `![封面](url)` | `![图](url)` | CommonMark；`**/**``/`~~`/内联 `<u>`；ruby 用内联 HTML；链接为原始 URL |
| docx | 标题段落 | 内嵌 | 内嵌 | OOXML zip：`[Content_Types].xml`、`_rels/.rels`、`word/document.xml`、`word/styles.xml`、`word/_rels/document.xml.rels`、`word/media/*`；CJK 用字体名不嵌入 |
| pdf | 首页标题块 | 内嵌 | 内嵌 | `PdfDocument` + `StaticLayout`（A4 595×842pt、边距 16mm）；系统 CJK 字体；按页高切块；插图等比缩放绘制 |
| epub | OPF metadata + 标题页 | 内嵌 cover | 内嵌 | EPUB 3 zip：`mimetype` **首个且 stored（level 0）**、`META-INF/container.xml`、`OEBPS/content.opf`、`OEBPS/nav.xhtml`、`OEBPS/toc.ncx`、章节 XHTML（well-formed XML）；`page-progression-direction`；`xml:lang` |
| rtf | 头部 | 链接 | 链接 | `{\rtf1\ansi\deff0 ...}`；CJK `\uN?` 转义 |
| json | 全量 meta | URL | URL | `JSON.stringify(payload, null, 2)`（无损 IR，供二次加工/差分测试） |
| fb2 | `<description>` | base64 `<binary>` | base64 `<binary>` | FictionBook 2 XML；XHTML-ish `<body>` |

- 文本类无内嵌能力的格式（txt/md/rtf）对封面/插图退化为链接：**开关不失效**，只是资产不以二进制嵌入。
- 单张插图下载失败 → 跳过 + `Log.w`（导出成功）；作为硬契约的「元数据/正文」失败 → 抛 `IOException`。

## 6. 设置

| 键（跨端同一字面量） | 类型 | 默认 | app 位置 | app-lynx 位置 |
|----------------------|------|------|----------|----------------|
| `settings_novel_export_format` | enum(9) | `txt` | `stores/settingsStore.ts` `settings.define` + `SettingsExport.tsx` | `stores/settingsStore.ts` ref + setter + `Me.vue`「导出」组 |
| `settings_novel_export_include_metadata` | bool | `true` | 同上卡片 | 同组 |
| `settings_novel_export_include_cover` | bool | `true` | 同上 | 同组 |
| `settings_novel_export_include_images` | bool | `true` | 同上 | 同组 |

- app 在 `resetSettingsStore()` 中一并复位；app-lynx 走 `prefs()` seam（native SharedPreferences「CapacitorStorage」/ dev idbKV）。
- 非法值：app `validate` 拒绝 → 默认；app-lynx 加载时白名单校验 + `console.warn`（无静默降级）。
- 跨端契约测试：键字面量与格式白名单来自共享包/字面量，两端各自断言（ADR-0103 / ADR-0098 模式）。

## 7. UI

### 7.1 app（SolidJS / Fluent）

- **设置页**：新卡片 `SettingsExport.tsx`（注册进 `SettingsSections`，置于「下载」之后）：格式 chip 组（9 项，复用 `SettingsDownload` 的 segmented 视觉）+ 三项 `<fluent-switch>` 开关行。
- **详情页入口**：`NovelFooterNav` pill 行新增「导出」（新 prop `onExport`；有正文时才渲染）。
- **导出面板 `ExportSheet.tsx`**（底部面板，对齐 `ReaderSettingsSheet` 的 Sheet 契约）：格式 chip（预选全局默认）、内容开关只读摘要（「元数据 ✓ / 封面 ✓ / 插图 ✓」，提示在设置页修改）、「导出」按钮。确认 → 构造 payload → `enqueue` → 关闭 + 固定 message bar「已加入下载队列」+「查看」跳 `/downloads`。
- **不可用态**：无正文（受限/未加载）时入口禁用并提示原因。
- 交互硬约束：Fluent 令牌、4 曲线 / 5 时长、hover/active/focus-visible、触控 ≥40×40。

### 7.2 app-lynx（Vue / M3 Tailwind）

- **Me 页**：新增「导出」分组（格式 chip 组 + 3 个 switch），注册 `ME_A11Y_LABELS`。
- **详情页入口**：`NovelDetail.vue` 操作行「导出」；覆盖层面板（CommentOverlay 同款挂载契约，DOM 在 scroll-view 之后）：格式 chip + 开关摘要 + 确认。
- 反馈内联在面板/操作行（lynx 无全局 toast）；web-core 确认后触发显式失败提示（原生模块缺失）。

## 8. 队列集成契约

```
start（webview）: { id, sourceUrl, kind:"novel", targetFormat, payloadJson, fileName } → { uri }
start（lynx）   : start(id, sourceUrl, fileName, "novel", targetFormat, framesJson, payloadJson, cb) ; cb(uri,"")/cb("","err")
```
- `sourceUrl` = Pixiv 原文展示链接（仅列表展示/元数据，不参与下载）。
- 进度：导出执行器在关键阶段回调百分比（编码前 5% / 落盘前 90%，完成由队列置 100%）——粗粒度（单次编码不可中断分片）。
- 取消：`PictelioDownloader.cancel(id)` 置位 `AtomicBoolean`，取图循环与编码阶段轮询中止。
- 恢复：`downloading→paused`（进程重启），payloadJson 从队列 JSON 恢复，可重新 start。

## 9. 测试策略（硬约束映射）

| 层 | 用例 | oracle |
|----|------|--------|
| 共享包纯函数 | 提取（真实 Pixiv HTML 样例：text/seriesNavigation/images）、块解析（ruby/memo/行内样式/插图/jump/newpage/chapter）、payload 构造（开关组合、URL 解析顺序、jump URL 映射）、格式表（9 项、ext/mime）、任务草稿（id 签名、文件名、快照） | 本 spec §3/§5 + 真实响应样例（测试硬约束 #1/#2） |
| 队列核心（双端同规格） | `kind=novel` 入队、`payloadJson` 序列化往返、非法 payloadJson 丢弃 + warn、恢复 | spec §4/§8 |
| Java 编码器 | 9 格式从真实 payload 生成；EPUB `mimetype` 首条且 stored、DOCX 部件、PDF 页数/文本、CJK 不丢字、MIME 映射 | spec §5 字面规则 |
| Java IO | 取图缓存命中/未命中（注入 loader 假件）、取消 | spec §4/§8 |
| 组件 | app `SettingsExport` / `ExportSheet`（默认预选、临时覆盖、确认参数）；lynx 同语义 | spec §7 |
| 跨端契约 | 设置键字面量、格式白名单、任务 id 签名 双端一致 | spec §3.1/§6 |
| E2E | agent-browser：设置页切换 → 详情导出 → 入队提示 → 下载页可见（执行器 mock，浏览器无编码） | 用户可达路径原则 |

## 10. 验收清单

- [ ] 设置页（两端）可见导出格式 + 三项内容开关，读写持久化、非法值回默认 + warn。
- [ ] 详情页（两端）有导出入口；无正文时禁用并说明。
- [ ] 导出面板预选全局默认格式，可临时覆盖本次格式；确认后入队并提示 + 可跳下载页。
- [ ] 9 种格式均能生成并落到 `Downloads/Pictelio`（真机批次验收渲染/可读性）。
- [ ] 内容开关生效（关元数据/封面/插图后产物对应缺失；文本格式退化为链接）。
- [ ] EPUB 通过 EPUBCheck（或等价的「mimetype 首条 stored + well-formed XML」结构断言）；DOCX 可被 Word/WPS 打开；PDF CJK 不丢字且可选中。
- [ ] 队列：进度、暂停/停止/删除、跨重启恢复、下载页分享对导出文件可用。
- [ ] 门禁全绿：`check:all` / `lint` / `test:app` / `test:app-lynx` / Java 单测 / `fmt:check`。

## 11. Grill 澄清记录（用户逐条应答，2026-09）

| # | 问题 | 用户决策 |
|---|------|----------|
| G1 | 导出范围 | **仅单本**（系列/列表批量列为非目标） |
| G2 | 导出内容 | 按推荐组合（正文 + 元数据 + 封面 + 内嵌插图），**但设置页增加开关可取消勾选**，默认勾上推荐项 |
| G3 | 格式设置方式 | 设置页默认 + **导出面板可临时覆盖**本次格式 |
| G4 | 输出目标 | **仅保存到 Downloads/Pictelio**（导出流程不弹分享） |
| G5 | 执行方式 | **复用下载队列** |
| G6 | DOC 口味 | **真 OOXML `.docx`** |
| G7 | 额外格式 | **RTF / JSON / FB2** |

## 12. 假设记录（用户未直接应答，可推翻）

| # | 假设 | 备选 |
|---|------|------|
| A1 | 默认格式 `txt`（通用/无风险） | `epub`（阅读体验更好但更重） |
| A2 | 编码全部在原生 Java（单实现） | 文本格式 TS 实现（可浏览器 dev，但双实现 + 漂移） |
| A3 | 导出流程不弹分享 | 导出后弹分享（与 G4 相悖） |
| A4 | 译文不导出（恒原文） | 跟随当前阅读态导出译文（语义复杂） |
| A5 | 任务 id 含内容开关签名 | 仅 `novel_<id>_<format>`（改开关需先删旧条目） |
| A6 | 受限/无正文不可导出 | 仅元数据导出（价值低） |
