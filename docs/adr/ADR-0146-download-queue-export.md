# ADR-0146: 下载队列与 ugoira 多格式导出

- 状态：accepted
- 日期：2026-09（创建）
- 关联：
  - 规格：[docs/specs/download-manager.md](../specs/download-manager.md)（含 §11 用户未逐条应答下的假设记录）
  - 工单：[docs/specs/download-manager-tickets.md](../specs/download-manager-tickets.md)
  - 承接：[ADR-0145](./ADR-0145-image-save-download.md)（图片保存；本 ADR 将其「JS 顺序编排、不建原生队列」D4 升级为可持久化队列 + 原生执行器）
  - 复用：[ADR-0037](./ADR-0037-pixiv-api-plugin-gateway.md)（字节零进 JS 堆）、[ADR-0143](./ADR-0143-imagehost-download-source-java-sink.md)（图床下载源 Java 侧）、[ADR-0125](./ADR-0125-lynx-ugoira-unpacked-pipeline.md)/ADR-0127/ADR-0128（ugoira 管线）、[ADR-0098](./ADR-0098-cross-engine-consistency.md)（跨引擎一致性）

## 背景

ADR-0145 交付的保存能力是同步编排、无队列、不可取消、ugoira 排除：详情页点击保存即顺序直存，离开页面即中止，失败只在当次 toast 汇报，无下载页、无分享、无法导出动图。目标系统提出 5 项升级：下载页 + 批量控制（开始/暂停/停止/删除，删除二分）+ 系统分享 + 原保存全部入队 + ugoira 六格式导出（GIF/MP4/WebP/APNG/ZIP/TAR，全局统一设置）。

需求以 /goal 自主模式下达，Grill 未逐条应答；产品假设显式记录于 spec §11（G1-G10），可推翻重排。

## 决策

### D1：队列状态机在 JS（纯函数），字节与编解码全在 Java

队列状态（任务列表、状态、进度、选择）由两端同源复制的 downloadQueueCore.ts 纯函数状态机管理（node 可测、可持久化、与 UI 同构）；实际下载 / 解码 / 编码 / 落盘 / 分享由 src/main 的深模块执行器完成，JS 只持有元数据与百分比。

否决的替代：把队列也放进 Java——WebView 与 Lynx 两套宿主要各自实现「状态 → UI」桥（Capacitor notifyListeners vs Lynx 拉模式），且队列状态无法与 UI 同构、离线不可测；ADR-0145 D4 的「JS 编排」精神保留，只是从「无状态循环」升级为「持久化状态机」。

### D2：队列条目 = 一个输出文件；任务创建即快照格式

多页静态作品入队 N 条、ugoira 导出入队 1 条；illustId 负责列表分组展示。targetFormat 在入队时写死，之后修改全局设置不影响已入队任务——避免半途换格式导致中间产物失效。格式只来自全局设置 settings_ugoira_download_format（默认 zip），不可逐图。

### D3：暂停 / 停止语义分离

- 暂停：请求执行器挂起，保留已完成字节，可续。
- 停止：取消并丢弃部分产物，进度归零，条目保留可重下。

否决的替代：两者等价——「停止」将退化为「暂停」的同义词，无法表达「放弃当前下载」的意图。

### D4：删除二分（文件 vs 记录）显式二次确认

删除弹窗提供「删除文件与记录」与「仅清空记录」两条路径：前者删除已落盘文件（MediaStore 项 / 应用目录文件）并移除记录，后者仅移除记录（相册文件保留）。未完成条目无可删文件，只显示「删除记录」。否决：删除即删文件（用户误删不可逆）、删除始终保留文件（列表清空但相册占满无处置入口）。

### D5：编码器分层，按格式选引擎（风险显式）

| 格式 | 引擎 | 理由 |
|------|------|------|
| ZIP / TAR | Java | 容器写入无需像素编解码；执行器为原生（D1 字节不进 JS 堆），随执行器实现 |
| APNG | Java | 帧本就是 PNG 字节，只需重组 chunk（IHDR/acTL/fcTL/fdAT）；同理须在原生侧（D1） |
| GIF | Java | 需解码为位图 + 调色板量化 + LZW，Android BitmapFactory 天然胜任；纯 TS 需自带 PNG/JPEG 解码器，成本高 |
| MP4 | Java | MediaCodec(H.264) + MediaMuxer 为 API 28+ 原生能力 |
| WebP | Java | 复用设备内置 libwebp（Bitmap.compress(WEBP) 逐帧编码，仅单帧 API）+ 纯 Java 组装 VP8X/ANIM/ANMF 动图容器；无需 NDK/.so（T12 落地） |

每个编码器为纯深模块（帧字节 + 延时 → 输出字节），Java/TS 侧单测覆盖。

### D6：原生执行器共享 + 两端薄壳

PictelioDownloader（main sourceSet 深模块）承担下载 / 转码 / 落盘；webview 侧 PictelioDownloaderPlugin（Capacitor，进度 notifyListeners）、lynx 侧 PictelioDownloaderModule（LynxModule，进度拉模式，对齐 UgoiraStreamEngine）只做参数校验、线程、结果映射。分享同理：ShareHelper.java（FileProvider + ACTION_SEND/ACTION_SEND_MULTIPLE）+ 两端薄壳。否决：在 JS 侧 fetch blob 再传字节过桥（违反字节零进 JS 堆、大文件 OOM 风险）。

## 后果

- 正向：下载可持久化、可取消、可后台跨页面存活；ugoira 从「不能存」升级为六格式导出；分享复用系统能力；两端语义由同源状态机锁死。
- 代价：引入首个跨进程重启的持久化队列（schema 版本 + 损坏降级要长期维护）；原生执行器需同时兼容 Capacitor 与 Lynx 两套调用面；WebP 存在技术不确定性（spike 可能得出「暂不支持」的结论）；后台续传（进程被杀）本期不做（spec §2），用户会感知「被杀后停在 paused」。
- 明确不做：列表级跨作品批量、逐图格式、iOS、多线程分段下载、WorkManager 后台续传。

## 验证

- T1 纯函数核心：状态机全迁移 / 非法迁移 no-op / 调度并发上限 / 删除两模式 / 序列化 + 损坏降级 / downloading→paused 恢复（两端同规格单测）。
- T2 store：持久化读写、防抖、损坏 warn；跨重启恢复。
- T3/T6 Java：下载取消、进度上报、FileProvider URI 构造（Robolectric/单测）。
- T8-T12 编码器：格式可播放 + 帧延时/时长契约。
- T14 E2E：agent-browser（详情保存 → 提示 → 下载页 → 暂停/停止/删除分支）+ android-e2e（原生落盘/分享冒烟）。
- 门禁：check:all / lint / test:app / test:app-lynx / Java 单测 / fmt:check。
