# ADR-0192：app-lynx 下载命名模板与按作者建目录（Download File Template / Author Directory）

- 状态：Accepted（已采纳）
- 日期：2026-09-27
- 关联：`docs/adr/glossary-lynx-four-features.md`（术语表——命名模板/作者目录/相对目录/文件名单一事实源）、`docs/specs/lynx-download-naming.md`（规格，随 /to-spec 产出）、ADR-0145（图片保存/下载——`buildSaveFileName` JS 单一事实源）、ADR-0146（下载队列——任务载荷与执行器契约）、ADR-0143（图床下载 Java sink——原生落盘链参照）、[glossary-image-save.md](./glossary-image-save.md)（保存 vs 下载链路辨析）

## 背景

现状（file:line 实证）：

- **文件名恒定**：保存与下载的图片文件名由 `packages/app-lynx/src/utils/galleryDownload.ts` 的 `buildSaveFileName`（L28）生成，恒为 `Pictelio_<id>.<ext>` / `Pictelio_<id>_p<page>.<ext>`（0-based 页号）；这是 ADR-0145 确立的**JS 单一事实源**（Java 侧只做防御性清洗）。
- **目录恒定**：相册链基座 = `GallerySaver.java` 的 `RELATIVE_PATH = "Pictures/Pictelio"` 常量（L43）；下载队列图片任务同走 `GallerySaver.saveFile` → MediaStore.Images 同基座；ugoira/小说导出产物走 `saveDownloadFile` → `Downloads/Pictelio`（`DOWNLOAD_DIR_NAME`，L47）。
- **用户痛点**：批量下载多作品后相册/文件管理器里全是 `Pictelio_12345678` 式不可读名，无法按作者归类；竞品均已支持自定义——Pixeval 的 `@{macro}` 条件命名模板、gallery-dl 的 `directory_fmt` / `filename_fmt`、PixivBatchDownloader 的 `{user}-{user_id}/{id}-{title}` 目录模板。差距明确且用户可感。

## 调研结论

1. 三家先例的共同形态 = **占位符模板**（文件名）+ **可选目录段模板**（gallery-dl / PBD 把目录也表达进模板；Pixeval 用条件宏）。目录进模板的表达力最强，但把"路径语义"压给用户手拼（分隔符、非法字符、平台差异全暴露给用户）。
2. 本仓的既有架构边界（ADR-0145）是硬前提：模板解析必须留在 JS；Java 只认最终文件名/目录段字符串并做防御性净化（`sanitizeFileName`：`[/\]` 与 `\x00-\x1f` → `_`，trim，清洗后为空可读失败）。
3. 双链落盘点：保存链 `gallerySaver.ts` → `PictelioGalleryModule.saveImage(url, fileName, cb)`；下载链 `DownloadTask`（`fileName` 字段）→ `PictelioDownloaderModule.start(id, sourceUrl, fileName, kind, targetFormat, framesJson, payloadJson, cb)`。两链桥签名都只认 `fileName`，目录段需要新增可选参数透传。
4. 冲突面：MediaStore 对重名的原生行为是自动改名（` (1)` 后缀族），本仓未做也不必做自增序号管理（ADR-0145 起未变）。

## 决策

**D1 两个设备级设置键——模板与目录开关分离。**
`download_file_template`（字符串，默认 `Pictelio_{id}`）与 `download_by_author_dir`（布尔，默认 `false`），均为**设备级**键（无 uid 后缀；不带跨引擎/账号同步语义——文件命名偏好属设备习惯，与 ugoiraMode/detailQuality 同类），经 settingsStore 既有设备级键通道读写。
否决 **"单模板内嵌 `/` 分隔符表达目录"**（gallery-dl / PBD 形态）：用户手拼路径易错（多余/缺失分隔符、非法字符全暴露）、转义与校验复杂度陡增，而实际需求只有"按作者归类"一个场景——一个布尔开关即可覆盖，表达力换易错性不值；否决 **Java 侧模板解析**：破坏 ADR-0145 JS 单一事实源，双端逻辑漂移 + Java 可测性差。

**D2 占位符集合——`{id}` `{title}` `{author}` `{p}`；未知占位符原样保留 + 开发期 warn。**
`{id}` = 作品 id；`{title}` = 作品标题（净化 + 截断后替换）；`{author}` = 作者名（同前）；`{p}` = 多页 0-based 页号，**仅 `page_count > 1` 时出现**（单页作品的模板中 `{p}` 展开为空串，不注入页号；若模板写法因空占位符残留尾随连接符——如 `{id}_{p}` 单页得 `123_`——由展开器在净化后剥离纯连接符残段，spec 给出用例矩阵钉住推荐写法 `{id}_p{p}` 等场景）。模板中出现集合外占位符（如 `{date}`）→ **原样保留**（用户输错不吞内容）并在开发期 `console.warn`（禁静默吞，对齐测试硬约束 #3；生产期不重复告警噪音，spec 定阈值）。

**D3 净化与截断——按段净化，纯函数落 galleryDownload.ts 并单测。**
每个替换值独立净化：路径分隔符（`/` `\`）与控制字符（`\x00-\x1f`）→ `_`，trim；规则**镜像 Java `GallerySaver.sanitizeFileName`**（双端对同一字符串得出同一结果，differential 用例钉住）。截断：`title` / `author` 单段 ≤ **64** 字符；展开 + 扩展名拼装后的最终文件名 ≤ **120** 字符（超限按段截断回退，保证 `.ext` 完整）。净化/截断/展开全部为**纯函数**，落 `packages/app-lynx/src/utils/galleryDownload.ts`（与 `buildSaveFileName` 同文件——事实源不分散），成功/非法输入双路径单测（测试硬约束 #1）。Java 侧 `sanitizeFileName` 保持不动（第二道防御仍在）。

**D4 原生透传——subPath 追加到基座之后，两条桥各加可选参数；webview UI 不接线。**
Java：`GallerySaver.save` / `saveFile` 增加可选 `subPath` 参数，追加到基座常量之后（图片链 `Pictures/Pictelio` @ MediaStore.Images `RELATIVE_PATH`；下载队列非图片导出链 `Downloads/Pictelio` @ MediaStore.Downloads 同理追加；API 28 app-specific 目录回退同理拼子目录）；`subPath` 为空串 = 现行为**字节不变**（默认参数，老调用点零改动）。桥：
- **下载队列链**：`DownloadTask` 增加可选 `dir` 字段（由 `buildImageTasks` / `buildUgoiraTask` 载荷填入——JS 侧已展开好的目录段，非模板），经 `PictelioDownloaderModule.start` 透传（新增可选参数）至落盘。
- **单存相册链**：`utils/gallerySaver.ts` → `PictelioGalleryModule.saveImage` 增加可选 `dir` 参数（空缺省 = 现行为）。
- **Capacitor 侧** `GallerySaverPlugin.saveImage` 同步增加可选参数（保持双 flavor 桥契约同形），但 **webview UI 不接线**——本批 lynx-only，webview 零行为变化（契约先行，接线挂账）。
否决"JS 只传模板、Java 展开"：同 D1，模板语义不过桥；否决"下载队列不加 dir、复用 fileName 携带路径"：`fileName` 语义污染 + Java 侧等于隐式做目录解析，违背单一事实源。

**D5 冲突策略不变——MediaStore 原生重名处理，不引入自增序号。**
重名时由 MediaStore 原生改名（` (1)` 族），维持 ADR-0145 以来的既有语义。自增序号需要读目录状态（MediaStore 查询 + 并发竞态面），与"模板是纯函数展开"的模型冲突；用户按作者归目录后重名概率本身大幅下降。

**D6 设置 UI——Me 页下载卡新增两行，输入带净化回显预览。**
Me 页下载卡（`me.download.*` 区，现含动图导出格式组）新增：① 命名模板文本输入行（默认值 `Pictelio_{id}` 可恢复）；② 「按作者建目录」开关行（`M3Switch`，ADR-0179 范式）。模板输入在**失焦/保存时**用净化后的占位符示例回显预览（如 `Pictelio_{id}` → `Pictelio_12345678.jpg`；`{author}_{title}` → `作者名_作品标题_p0.jpg`），非法输入（空串/全净化为空）回落默认值 + 可见提示（禁静默回落）。

## 备选与否决理由（汇总）

| 备选 | 否决理由 |
| --- | --- |
| 单模板内嵌 `/` 表达目录 | 路径语义暴露给用户手拼，易错 + 转义复杂；实际需求单场景，布尔开关足够 |
| Java 侧解析模板 | 破坏 ADR-0145 JS 单一事实源；双端漂移 + Java 不可测 |
| fileName 携带相对路径 | 污染 fileName 语义；Java 隐式目录解析 |
| 自增序号防重名 | 需目录状态查询 + 并发竞态面；MediaStore 原生改名已覆盖 |
| 模板值不截断 | 极长标题撑爆文件系统名长限制（Android NAME_MAX ≈ 255 字节，多字节标题更早触顶） |
| 未知占位符剔除 | 吞用户内容；原样保留 + warn 可回溯 |
| webview 同批接线 | 本批 lynx-only 范围；桥契约先行、webview 零行为变化 |

## 后果

- 正面：文件名/目录从"不可读 id 串"升级为可配置；保存与下载两条链同享一套模板/净化语义（单源 JS）；Java 改动收敛为"可选参数 + 空串字节不变"，回归面极小；webview 桥契约同步为将来接线零成本。
- 取舍（已接受）：模板能力刻意最小（4 占位符、无日期/条件宏——需求未出现，YAGNI）；作者目录段固定为"基座 + 一段"，不支持任意嵌套；单页作品模板含 `{p}` 会得尾随空段（净化规则清理，用例矩阵钉住）；`dir` 字段入队即快照，事后改设置不影响已入队任务。
- 风险：API 28 回退目录拼子目录后，`MediaScannerConnection` 扫描路径随之变化（沿用既有 scanFile 调用，参数化验证）；净化双端一致性靠 differential 用例维持（镜像规则若 Java 侧未来改动须同步）。
- 后续候选（不在本期）：webview UI 接线（桥已就绪）、日期占位符、按作品类型建目录段、模板预设管理（多套模板切换）、下载队列 `dir` 字段的备份域评估。
