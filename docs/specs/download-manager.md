# Spec: 下载管理器（下载队列 / 下载页 / 分享 / ugoira 多格式导出）

- 状态：implemented（2026-09；两端静态图 + ugoira 六格式；MP4/WebP 的 Bitmap 路径与真机下载/分享待设备批次冒烟）
- 日期：2026-09（创建）
- 关联：ADR-0145（图片保存，本 spec 的前身）、ADR-0037（字节零进 JS 堆）、ADR-0143（图床下载源 Java 侧）、ADR-0125/0127/0128（ugoira 管线）、ADR-0098（跨引擎一致性）、ADR-0103（账号级设置）
- 建议新增：ADR-0146「下载队列与导出架构」（队列所有权 / 原生执行器 / 编码器策略）

## 1. 背景与目标

现状（见 `docs/specs/image-save-download.md`，已 implemented）：两端「保存到相册」是**同步编排、无队列**——`saveIllustPages()` 顺序逐张调用原生 `GallerySaver`，UI 用内联状态/toast 汇报；**ugoira 被显式排除**（`type === "ugoira"` 不显示保存入口）。

本 spec 交付 5 项能力：

1. **下载页**：app（SolidJS / Fluent）与 app-lynx（Vue / M3）各新增一个下载页，入口位置按两端实际导航结构放置。
2. **下载列表与批量控制**：列表 + 单选/多选；对全部或选中项执行 开始 / 暂停 / 停止 / 删除；删除二次确认，且区分「删除已下载文件 + 记录」与「仅清空记录」。
3. **系统分享**：已下载完成的条目可调用系统分享（单条 / 多条）。
4. **原下载全部走队列**：原「保存到相册」入口改为「加入下载队列」，点击后提示「已加入下载队列，请到下载页查看」，并提供跳转。
5. **ugoira 下载（走队列，多格式）**：支持导出 GIF / MP4 / WebP / APNG / ZIP / TAR；格式**全局统一设置**，不可逐图设置。

## 2. 非目标（Out of Scope）

- **列表级跨作品批量下载**（Feed / 收藏多选多个作品直接入队）——仍属独立 Grill；本 spec 的批量 = 下载页内对已有任务批量操作。
- **逐图格式**：格式只来自全局设置，任务创建时快照落定。
- **iOS**（项目仅 Android）。
- **BT / 多线程分段下载**：单任务单连接，并发上限固定为 1（对 CDN 温和，与现状一致）；不做断点续传的分段合并（暂停＝保留已完成字节级别由执行器决定，见 §5）。
- **云端 / 后台服务下载**：App 进程被杀后的 WorkManager 级后台续传不在本期（列为后续 ticket）。

## 3. 领域模型

### 3.1 DownloadTask（队列条目 = 一个输出文件）

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 稳定唯一 id（`<illustId>_<kind>_<page|fmt>_<seq>`） |
| `illustId` | number | 作品 id（分组 / 去重 / 缩略图） |
| `title` | string | 作品标题（列表展示） |
| `thumbnailUrl` | string | 缩略图官方 URL（列表展示；经代理渲染） |
| `kind` | `"image" \| "ugoira"` | 静态页 / 动图导出 |
| `page` | number? | 静态多页的 0-based 页号；ugoira 为 `undefined` |
| `sourceUrl` | string | 官方原图 URL 或 ugoira zip URL |
| `targetFormat` | string | 静态：`jpg/png/...`（沿用 `extForUrl`）；ugoira：`gif/mp4/webp/apng/zip/tar` |
| `fileName` | string | 输出文件名（单一事实源在 JS，Java 侧仅防御清洗） |
| `status` | DownloadStatus | 见 §3.2 |
| `progress` | number | 0–100（ugoira 转码阶段含编码进度） |
| `bytesDone` / `bytesTotal` | number? | 可选：字节级进度（原生上报） |
| `outputUri` | string? | 完成后：`content://` 或 `file://` |
| `error` | string? | 失败原因（可读） |
| `createdAt` / `updatedAt` | number | 排序 / 持久化 |

### 3.2 状态机

```
                 enqueue
                    │
                    ▼
   ┌────────────► queued ──start──► downloading ──complete──► completed
   │                ▲   │              │  ▲                      │
   │       start    │   │ pause        │  │ resume               │ share / delete
   │                │   ▼              ▼  │                      ▼
   └──────────── paused ◄──────────────┘  failed
        start │  ▲
              │  │ stop（丢弃部分进度）
              ▼  │
           stopped ──start──► queued
```

- **start**：`queued | paused | stopped | failed → queued`（由调度器在并发额度内转 `downloading`）。`completed` 不可 start（需删除后重下）。
- **pause**：`downloading → paused`（请求执行器挂起；保留已下载部分）。
- **resume**：`paused → queued`（等同 start）。
- **stop**：`downloading | paused | queued → stopped`（请求执行器取消并**丢弃部分产物**，`progress` 归 0；条目保留在列表，可再次 start）。
- **delete**：任意状态移除条目；`mode="files"` 时同时对 `completed` 条目删除已落盘文件，`mode="records"` 只移除记录（文件保留在相册/目录）。
- **complete / fail**：仅执行器可置位。

### 3.3 删除二次确认

点击删除 → 弹二次确认，两个动作 + 取消：

- **删除文件与记录**（`mode="files"`）：删除已下载文件（MediaStore 项 / 应用目录文件）并移除记录。
- **仅清空记录**（`mode="records"`）：仅移除队列记录，已下载文件保留（分享仍可用历史文件）。

未完成 / 失败条目没有可删文件 → 确认弹窗只显示「删除记录」。

## 4. 架构

### 4.1 分层（深模块 + 薄适配器）

```
UI（下载页 / 详情页入口）
  │  actions
  ▼
downloadQueueCore.ts（纯函数状态机 + 选择器 + 调度）   ← 两端同源同语义，node 可单测
  │  effect 请求（start/pause/stop/delete）——注入式
  ▼
downloadStore（各端；持久化 + 订阅 + 与执行器接线）
  │  单任务执行 / 取消 / 进度
  ▼
原生执行器 PictelioDownloader（main sourceSet 深模块，双引擎共享）
  ├─ 下载：PixivImageLoader / OkHttp（Referer/UA、图床 resolve、缓存优先，ADR-0143）
  ├─ 静态：GallerySaver 落盘（MediaStore / app 目录）
  ├─ ugoira：ZIP → 帧 → 编码器（GIF/MP4/WebP/APNG/ZIP/TAR）→ 落盘
  └─ 分享：ShareHelper（FileProvider + ACTION_SEND / SEND_MULTIPLE）
```

**所有权决策**：队列状态机在 JS（可测、可持久化、与 UI 同构）；**字节与编解码全在 Java**（ADR-0037）。JS 只持有元数据与进度百分比。

### 4.2 调度与并发

- 并发上限 `MAX_CONCURRENT = 1`（常量，后续可设置化）。
- 调度为纯函数：`selectStartable(state, limit)` 返回应转 `downloading` 的 id 列表；`nextQueued` 按 `createdAt` 升序。
- 每个 task 的「运行代」（generation）：start/stop/pause 递增，防止旧异步回调覆盖新状态（竞态硬约束）。

### 4.3 原生执行器契约（PictelioDownloader）

- **webview 引擎**：Capacitor 插件 `PictelioDownloader`，`start({taskJson}, ...) → {uri}`，进度经 `notifyListeners("progress", {taskId, pct, bytesDone, bytesTotal})`；`cancel({taskId})`。
- **lynx 引擎**：LynxModule `PictelioDownloader`，`start(taskJson, cb)` + 拉模式进度 `pollProgress(cb)`（Lynx Callback 一次性，沿用 `UgoiraStreamEngine` 的 pull 模式）；`cancel(taskId, cb)`；`deleteFile(uri, cb)`；`share(uris, cb)`。
- 阻塞工作在线程池执行；取消用 `AtomicBoolean` + OkHttp `Call.cancel()`。

### 4.4 持久化

- 队列 JSON 存于各端持久层：
  - app：`@capacitor/preferences`（键 `download_queue_v1`），防抖写。
  - app-lynx：原生 `PictelioPrefs`（共享 SharedPreferences）/ web-core `idbKV`。
- 启动恢复：`downloading` 一律降级为 `paused`（进程重启中断语义），并 `console.warn` 记录；`queued` 保持。
- 反序列化校验：schema 版本 + 字段类型；损坏条目丢弃并 `console.warn`（禁止静默降级，测试硬约束 #3）。

## 5. 全局设置：ugoira 下载格式

- 键（两端共享）：`settings_ugoira_download_format`。
- 取值：`gif | mp4 | webp | apng | zip | tar`，默认 `zip`（无损、无像素编码风险）。
- app：`settingsStore.ts` 用 `settings.define` 声明 + Settings 页「下载」分组。
- app-lynx：`settingsStore.ts` 用 `idbKV`/原生 prefs + Me 页「下载」分组。
- **任务创建时快照**：入队即写死 `targetFormat`，之后改设置不影响已入队任务（避免半途换格式）。

## 6. ugoira 导出格式策略

ugoira 源 = Pixiv ZIP（PNG/JPG 帧 + `animation.json` 时序）。格式 → 编码器：

| 格式 | 容器 | 编码策略 | 引擎 | 风险 |
|------|------|----------|------|------|
| ZIP | zip | Java `ZipOutputStream` 原样拷贝源 ZIP（Pixiv 源本身即 ZIP） | Java | 低 |
| TAR | tar | Java ustar 写入（512B 头 + 数据 + 填充；`ZipFile` 读中央目录取 size） | Java | 低 |
| APNG | png | 帧 PNG 已是 PNG：取首帧 IHDR 建 `acTL`/`fcTL`，后续帧 IDAT 包 `fdAT`，重排 chunk | Java | 中（chunk 细节） |
| GIF | gif | Java：`BitmapFactory` 解码帧 → 调色板量化 → LZW + 帧延时 | Java | 中 |
| MP4 | mp4 | Java：`MediaCodec`(H.264) + `MediaMuxer` | Java | 中高（API 28 兼容/时长） |
| WebP | webp | 每帧 `Bitmap.compress(WEBP)`（复用设备内置 libwebp，**无需 NDK/.so**）→ 抽取 ALPH/VP8(L) chunk → 纯 Java 组装 `VP8X`/`ANIM`/`ANMF` 动图容器 | Java | 中（容器组装） |

编码器全在 Java（ADR-0146 D1：字节不进 JS 堆）——执行器为原生，纯 TS 编码需把帧字节过桥进 JS，违反红线，故放弃原「纯 TS」方案（T8 实现时修正）。

- 输出落盘：与静态保存同门（`GallerySaver` 的 MediaStore / app 目录）。
- 中间帧复用 `UgoiraStreamEngine` / `ugoiraExtract` 的 `cache/ugoira/<id>/`，编码完成后按需清理。
- 每个编码器是纯深模块（输入帧字节 + 延时 → 输出字节），Java 侧单测覆盖。

## 7. UI

### 7.1 app（SolidJS / Fluent）

- 路由 `/downloads` → `routes/DownloadManager.tsx`。
- 入口：Settings 页新增「下载」卡片（与「图片缓存 / 图片托管」同级 `SettingsImage.tsx` 模式）；详情页 toast 提供「查看」跳转。
- 列表：Fluent 卡片，缩略图 + 标题 + 状态 + 进度环/条；支持单选与多选模式。
- 操作栏：开始 / 暂停 / 停止 / 删除（多选可用）；删除 → `FluentDialog` 二次确认（两动作）。
- 已完成条目：分享按钮（多选 → 分享多条）。
- 交互状态齐全（hover / active `scale(0.98)` / `:focus-visible`）；触控目标 ≥ 40×40；仅用 Fluent 令牌与 4 条曲线 / 5 档时长。

### 7.2 app-lynx（Vue / M3 Tailwind）

- 路由 `/downloads` → `pages/DownloadManager.vue`。
- 入口：`Me.vue` 账户组新增「下载管理」行（复用既有菜单行样式与 `ME_A11Y_LABELS` 注册表）。
- 列表 / 多选 / 批量操作 / 二次确认删除（M3 Dialog，复用 `ugoiraConfirm` 的弹层形态）。
- 分享 / 删除在 web-core 无原生模块时**显式失败**（沿用 `gallerySaver` 的「显式拒绝 + warn」，不伪成功）。

## 8. 原下载改走队列

- `IllustDetail`（两端）保存入口语义改为：构造 `DownloadTask[]` → `enqueue` → toast/状态文本「已加入下载队列，请到下载页查看」+ 跳转。
- `PagePickerSheet`：多页选择后入队 N 条任务（不做即时保存）。
- `ImageViewer` 保存当前页 → 入队 1 条。
- ugoira 详情页新增「下载」入口（此前无）：按全局格式入队 1 条 ugoira 任务。
- 旧 `saveIllustPages` 保留为队列执行器内部的落盘原语（供静态任务复用），不再被 UI 直接调用。

## 9. 测试策略（硬约束映射）

| 层 | 用例 | oracle |
|----|------|--------|
| TS 纯函数（两端同规格） | 状态机全迁移、非法迁移 no-op、调度器并发上限、删除两种模式、序列化/反序列化、损坏降级、`downloading→paused` 恢复 | 本 spec §3.2/§4.2/§4.4 |
| TS 存储 | 持久化读写、防抖、损坏数据 warn | spec §4.4（注入 KV 假件） |
| TS 桥 | app web 回退 / lynx 无原生模块显式失败 | 桥契约 §4.3 |
| Java 纯函数 | 文件名/扩展名（沿用）、TAR 头、APNG chunk、GIF LZW、进度折算 | spec §6 字面规则 |
| Java IO | 落盘（MediaStore / app 目录）、取消、分享 FileProvider URI | 真实文件系统（Robolectric temp） |
| 组件 | app 下载页（渲染、多选、操作调用、二次确认两分支） | spec §7 |
| 组件 | lynx 下载页（同语义） | spec §7 |
| E2E | agent-browser：详情保存 → 提示 → 下载页可见任务 → 暂停/停止/删除分支；android-e2e：原生落盘/分享冒烟 | 用户可达路径原则 |

跨端契约测试锚定：队列 JSON schema、状态枚举、设置键 `settings_ugoira_download_format`（真实字面量，非自洽 mock）。

## 10. 验收清单

- [ ] 两端下载页可达（入口符合 §7），点击进入即列表。
- [ ] 列表支持单选/多选；开始/暂停/停止/删除对全部或选中项生效。
- [ ] 删除弹出二次确认，可分别选择「删除文件与记录」「仅清空记录」。
- [ ] 已完成条目可系统分享（单条 / 多条）。
- [ ] 详情页原保存入口改为入队 + 提示「到下载页查看」，并可跳转。
- [ ] ugoira 可按全局设置的 6 种格式之一下载并落盘（GIF/MP4/WebP/APNG/ZIP/TAR）。
- [ ] 队列跨重启恢复（`downloading` 降级 paused）；损坏数据可见 warn。
- [ ] 门禁全绿：`check:all` / `lint` / `test:app` / `test:app-lynx` / Java 单测 / `fmt:check`。

## 11. Grill 澄清与假设记录（用户未逐条应答，可推翻）

| # | 问题 | 决策（默认） | 备选 |
|---|------|--------------|------|
| G1 | 下载页入口放哪 | app：Settings「下载」卡；lynx：Me「下载管理」行 | 底部导航新增 tab（会破坏四 tab 契约，不取） |
| G2 | 「停止」与「暂停」区别 | 暂停=可续（保留部分）；停止=取消并丢弃部分、可重下 | 两者等价（语义弱，不取） |
| G3 | 删除「清空记录」文件是否保留 | 保留文件（仅移记录） | 一律删文件 |
| G4 | 队列条目粒度 | 一个输出文件 = 一条；多页/动图导出按作品分组展示 | 一个作品 = 一条（进度聚合复杂） |
| G5 | 并发数 | 固定 1 | 可设置（后续） |
| G6 | ugoira 默认格式 | zip | gif |
| G7 | 分享多条是否支持 | 支持（ACTION_SEND_MULTIPLE） | 仅单条 |
| G8 | 进程被杀后台续传 | 本期不做（前台队列 + 停后恢复列表） | WorkManager 后台（独立立项） |
| G9 | WebP 编码方案 | 复用设备内置 libwebp（`Bitmap.compress(WEBP)`）+ 纯 Java 组装动图容器——无需 NDK/.so（T12 已落地） | 预编译 `.so` / wasm |
| G10 | 队列状态存哪 | app：Preferences JSON；lynx：原生 prefs/idbKV | 引入 SQLite（过重） |
