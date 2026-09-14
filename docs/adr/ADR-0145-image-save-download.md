# ADR-0145: 作品图片保存（单图保存 / 多图选页 / 批量下载）

- 状态：accepted
- 日期：2026-09-10
- 关联：
  - 规格：[docs/specs/image-save-download.md](../specs/image-save-download.md)（含 §8 用户未应答下的假设记录）
  - 术语：[glossary-image-save](./glossary-image-save.md)（本文与 spec/tickets 的唯一术语口径）
  - 复用：[ADR-0037](./ADR-0037-pixiv-api-plugin-gateway.md)（PixivApiPlugin 网关姿态）、[ADR-0143](./ADR-0143-imagehost-download-source-java-sink.md)（图床下载源 Java 侧决策，保存链路经 `PixivImageLoader` 全量继承，不复制语义）
  - 不触碰：ADR-0125/0127/0128（ugoira 管线——动图保存明确排除）

## 背景

双端客户端此前只能「看」不能「存」：全仓无任何 MediaStore / 相册写入代码。目标为两端新增作品图片保存能力，功能族三件套：**单图保存**（单页一键保存 + 查看器保存当前页）、**多图选页**（缩略图多选面板）、**批量下载**（作品级全部页批量，队列 + 进度 + 失败汇报）。

需求以 `/goal` 形式下达，Grill 询问未获应答，按目标系统的自主模式指示以最佳判断推进；全部产品假设显式记录于 spec §8（A1 选页为保存服务、A2 批量=作品级、A3 保存到相册、A4 恒原图、A5 ugoira 不做、A6 入口在详情页），可推翻重排。

## 决策

### D1：深模块 + 两端薄壳（对齐 ADR-0143 深模块惯例）

保存落盘的全部决策集中在 `src/main` 的 `GallerySaver.java`（双 flavor 共享）：字节获取复用 `PixivImageLoader.loadFile`（缓存优先命中零下载；未命中经既有 download 核心——图床 resolve、镜像失败官方回退、Referer/UA 注入全量继承，**不复制不偏离**）；`GallerySaverPlugin`（webview）与 `PictelioGalleryModule`（lynx）只做参数校验、线程、结果映射。

**否决的替代**：在 JS 侧 fetch blob 再传字节过桥（字节进 JS 堆，违反「图片二进制零进 JS 堆」红线）；两端各自实现下载（镜像/Referer 语义必然漂移）。

### D2：落盘按 API 级别分流，权限零请求

- **API ≥ 29**：MediaStore（`Pictures/Pictelio`，`IS_PENDING` 两段式；写失败删除 pending 记录）。无权限要求。
- **API 28（minSdk）**：应用专属外部目录 + `MediaScannerConnection.scanFile` 尽力入库。

**否决的替代**：API 28 请求 `WRITE_EXTERNAL_STORAGE` 运行时权限——Capacitor 与 Lynx 两套宿主要各自实现权限管线（Capacitor 注解体系 vs Lynx 手动 `ActivityCompat`），复杂度远超该 API 段（Android 9，存量极小）的图库可见性收益。回退路径行为已在 spec 申报（图库可见性尽力而为）。

### D3：文件名单一事实源在 JS；Java 只防御

`Pictelio_<illustId>[_p<N>].<ext>`（N 为 0-based，对齐 Pixiv 原始 `_p0` 命名）由 JS `buildSaveFileName` 生成；Java `sanitizeFileName` 只做路径分隔符/控制字符清洗与空值可读失败（防路径穿越）。mime/ext 推断两端同规则（TS `extForUrl` ≡ Java `extFor`，测试锁字面契约防漂移）。同名重复保存不去重（MediaStore 29+ 自动 " (1)"；回退路径覆盖同名）——spec §2 申报。

### D4：队列在 JS 编排，不建原生队列

顺序逐张（1 并发）保存由双端同源复制的 `saveIllustPages` 纯函数编排（注入 `saveOne` IO seam，node 可测）：单张失败不中断批次、逐张进度回调、失败聚合 + `console.warn` 明细。

**否决的替代**：原生下载队列 + 进度事件推送——webview 侧要 Capacitor `notifyListeners`、lynx 侧 Callback 是一次性（须再造 ugoira 那样的 pull 状态机），两套机制成本高；且单图原生方法（`prefetchImage` 同款）+ JS 循环已是仓内验证过的范式。对 CDN 温和（原图可达数十 MB）。

### D5：UI 入口与反馈（两端对齐语义、各随设计系统）

入口在详情页（底部操作条 / 操作行）+ app 端查看器右上「保存当前页」；ugoira 不渲染入口。多页作品的保存弹出**选页面板**（打开默认全选 = 批量语义默认值）。反馈：app 用固定 message-bar（查看器内按钮内联 ✓/✗），lynx 用操作行下方内联状态文本（lynx 无全局 toast 通道）。lynx 符号用 `↓`（U+2193 纯文本，规避 ADR-0112 emoji 字形教训）；lynx 原生环境不可用时显式拒绝「当前环境不支持保存到相册」（无静默）；webview 浏览器环境回退 `<a download>`（开发便利）。

## 后果

- 正向：保存能力与图床/缓存/防盗链语义天然同步（单一下载核心）；测试面纯函数化（Java 14 例 + TS 43 例全为注入式可测）；权限面为零。
- 代价：API 28 段图库可见性尽力而为（可感知：`SaveResult.mediaStore=false` 区分回退路径）；批量保存期间无整批取消（页面可离开，逐张推进天然中止在当前张后——JS 编排循环随组件存活，导航离开后由 GC 终止，失败不计入 UI）。
- 明确不做（spec §2）：列表级跨作品批量、ugoira 导出、保存去重、非原图档位——均记录为潜在后续。

## 验证

- Java：`GallerySaverTest`（API 28 回退真实文件断言 + 纯函数契约 + 缓存命中零下载 + 下载失败）、`GallerySaverMediaStoreTest`（API 33 假 provider + shadow 输出流：insert values 契约、字节一致、pending 复位、写失败清 pending、insert null 失败）。全套 181/0 绿。
- TS：app 28 例 + lynx 15 例（文件名/原图列表字面契约、编排器行为、桥三态、组件交互契约）。
- 门禁：`check:all` / `lint:all` / `test:all`（2207）/ `fmt:check` 全绿；app-lynx 双 bundle 构建通过。
