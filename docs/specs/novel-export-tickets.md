# Tickets: 小说多格式导出（spec: docs/specs/novel-export.md）

规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo` / `doing` / `done`。
每个 ticket 完成后走 `code-review` → `tdd` 修复闭环（AGENTS.md 工作流硬约束）。

| # | 标题 | 依赖 | 交付物 | 验收 | 状态 |
|---|------|------|--------|------|------|
| T0 | 术语表 + ADR-0154 | — | `docs/adr/glossary-novel-export.md`、`docs/adr/ADR-0154-novel-export.md`、`docs/specs/novel-export.md`、本 tickets | 记录决策（共享包 / 原生编码 / 复用队列 / 设置落位）与 grill 记录 | done |
| T1 | 共享包 `@pictelio/novel-export` | T0 | `packages/novel-export/{package.json,tsconfig.json,src/index.ts,...}`；app `novelBlocks.ts`/`api/novel.ts` re-export 重构；app-lynx 接入 | 提取/块解析/payload/任务草稿/格式表纯函数测试绿；app `test:app` 绿（重构无回归） | done |
| T2 | 队列核心扩展 `kind=novel` + `payloadJson` | T1 | 双端 `utils/downloadQueueCore.ts` | `kind=novel` 入队、payloadJson 往返、损坏丢弃+warn、恢复；双端 test 绿 | done |
| T3 | 设置（双端） | T1 | app `settingsStore` + `SettingsExport.tsx` + `SettingsSections`；lynx `settingsStore` + `Me.vue`「导出」组 + a11y | 4 键读写、默认值、非法值 warn；组件/存储测试 | done |
| T4 | 文档 MIME 扩展 | T0 | `GallerySaver.mimeForName`/`mimeFor`、`ShareHelper.mimeForName` | 9 文档扩展名映射正确；Java 单测 | done |
| T5 | NovelExporter 文本/结构化格式 | T0 | `NovelExporter.java`（txt/html/md/rtf/json/fb2） | 6 格式从真实 payload 生成；BOM/转义/容器结构断言 | done |
| T6 | NovelExporter EPUB | T5 | EPUB3 编码 | mimetype 首个且 stored、opf/nav/ncx 结构、well-formed、插页/封面 | done |
| T7 | NovelExporter DOCX | T5 | OOXML 编码 | zip 部件齐全、document.xml 可解析、CJK 文本存在 | done |
| T8 | NovelExporter PDF | T5 | PdfDocument+StaticLayout 编码 | 页数>0、CJK 文本存在、插图绘制不崩；分页正确 | done（Robolectric 无法执行 PdfDocument，经 PdfBackend seam + 纯 Paginator 测试；真机保真度待设备批次） |
| T9 | 执行器 + 桥 + TS executor | T1,T2 | `PictelioDownloader.downloadNovel`、webview 插件、lynx module、`capacitorDownloadExecutor`/`lynxDownloadExecutor` 增加 payloadJson | kind=novel 桥契约、参数校验、取消、进度；单测 | done |
| T10 | app 导出 UI | T2,T3,T9 | `NovelFooterNav` 新 prop、`ExportSheet.tsx`、`NovelDetail` 接线 | 默认预选/临时覆盖/确认入队/无正文禁用；组件测试 | done |
| T11 | app-lynx 导出 UI | T2,T3,T9 | `NovelDetail.vue` 入口 + 覆盖层面板 | 同 T10 语义；web-core 显式失败 | done |
| T12 | E2E + 跨端契约 + 门禁 | T10,T11 | agent-browser spec + 契约测试 | 设置→导出→入队→下载页可见；键/白名单/id 双端一致；`check:all`/`lint`/`test:all`/`fmt:check` 绿 | done（agent-browser 2 用例真机跑通；settings 键一致性 + 桥契约测试绿；Java 256 测试绿；`check:all`/`test:all` 绿。PDF 真机保真度与 Java 侧 PDF 运行时留待设备批次） |

## 关键路径

`T0 → T1 → T2 → {T3, T4, T9}`（主链）
`T5 → {T6, T7, T8}`（编码器，可与 T2/T3/T9 并行；仅依赖 T0 的格式契约）
`{T2,T3,T9} → {T10, T11} → T12`（UI 与收口）

## 备注

- T1 是唯一涉及既有代码搬迁（`novelBlocks` / `api/novel` 提取函数）的 ticket，必须遵守「重构行为不变 + 原处 re-export」；消费方不迁移 import。
- T5-T8 可并行分派给子代理（各自独立文件/编码器）。PDF 风险最高，先 spike 最小 A4 单段 CJK，再扩分页与插图。
- T9 会修改既有 `PictelioDownloaderPlugin`/`Module` 的 `start` 签名——**调用点完备性审计**（code-review 审计一）：`capacitorDownloadExecutor.ts`、`lynxDownloadExecutor.ts` 及所有调用者必须同步。
- T4 修改 MIME 映射是**输出契约变化**（无损影响分享/落盘），必须全调用点核对 + 测试。
- 浏览器 dev 无编码：T12 的 agent-browser 用 mock 执行器验证 UI/队列链路，不验证产物字节。
