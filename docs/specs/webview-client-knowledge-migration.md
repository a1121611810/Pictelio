# WebView 客户端领域知识搬运（源码删除前的抢救）

> 决策：[ADR-0203](../../adr/ADR-0203-webview-client-source-removal.md)
> 术语：[glossary-webview-client-removal](../../adr/glossary-webview-client-removal.md)
> Issue：[#819](https://github.com/a1121611810/Pictelio/issues/819) 第 4 项 / #834
> 来源文件：`packages/app/CONTEXT.md`（444 行，随 `packages/app` 整包删除）
> 搬运执行日期：2026-09-29

## 为什么要写这份文档

`packages/app/src/**`（295 个被追踪文件）随 ADR-0203 客户端删除动作**整体消失**。
`packages/app/CONTEXT.md` 里若干领域结论**只在那一个文件里记录过**，删除即永久丢失——
这是整轮重构中**唯一有信息损失风险**的环节。

本文档做三件事：

1. **盘点**：逐节列出被删侧 `CONTEXT.md` 的全部章节，判定「搬 / 丢 / 他处已存在」并给出理由（§3）
2. **搬运**：把判定为「搬」的词条**逐字**迁到不会被删的位置（§4）
3. **留档**：记录判定为「丢」的章节各自的去处，避免后来者以为它从未存在（§3）

> **搬运纪律**：本轮搬运**不是改写**。不趁机「改进」措辞、优化排版、修正认为有误的判断。
> 每条迁出内容都标注**来源**（原文件 + 章节）与**原实测日期**。
> 已在 `docs/adr/**` 或 `docs/specs/**` 存活的结论**不重复搬运**，只在 §3 记录「已存在」。

## 落点分工

| 内容类型 | 落点 | 理由 |
| --- | --- | --- |
| app-lynx **正在执行**的跨端契约 | `packages/app-lynx/CONTEXT.md` | 词条属 Lynx 上下文的领域语言，且原指针会在删除后悬空 |
| **接受的缺口**的设计（无 Lynx 实现） | 本文档 §4 | 放 Lynx 上下文会暗示「Lynx 有此能力」，是失真 |
| 被删侧的**工程约定**（模式级，非领域语言） | 本文档 §4 | 同上；且原引用点全在被删源码内 |
| 测试约定 | `docs/testing/conventions.md` | 仓库级文档，不属任何单一客户端 |

## 已直接搬入 `packages/app-lynx/CONTEXT.md` 的两条

以下两条**不在本文档重复正文**，正文已在 Lynx 侧落地，此处只记来源与判定理由：

| 词条 | 搬运理由 | 落点 |
| --- | --- | --- |
| 搜索关键词的两个硬约束 | 不可再生的实测结论；ADR-0197 D11/D12 虽记录了同一结论，但那是**「标签近邻」功能的局部决策**，不是搜索领域的通用词条——Lynx 侧做搜索时不会去读 ADR-0197 | `packages/app-lynx/CONTEXT.md` §搜索 |
| 图床缓存键 / 源无关命中 / 下载源 | app-lynx 原生读端**正在执行**该契约（`PictelioImageService` + Java 下载层），文档却在被删目录；且原 `CONTEXT.md:266` 的指针会在删除后悬空 | `packages/app-lynx/CONTEXT.md` §图床缓存契约 |

## 搬运正文

### 1. 浏览历史设计（accepted gap，**只搬设计不实现**）

> 来源：`packages/app/CONTEXT.md` §浏览历史（Browsing History）
> 状态：[ADR-0203](../../adr/ADR-0203-webview-client-source-removal.md) §决策 6「接受的缺口」第 1 项——**接受，不补做**，另立票再议。
> **本节只保留设计决策，不构成任何实施授权。** WebView 侧实现依赖 TanStack DB，随源码删除；Lynx 侧零实现。

**浏览历史记录（HistoryEntry）**：
用户打开作品详情页时自动记录访问的条目。链路：详情页 data loaded → `collection.insert/update` → TanStack DB localStorage 持久化。

**历史时间线（History Timeline）**：
历史页面的展示形式——按日期分组的一维拍平数组，单实例 `Virtualizer`（`lanes: 1`）。数据源为 TanStack DB `localStorageCollectionOptions` collection 通过 `useLiveQuery` 获取。

**条目主键（Entry Key）**：
复合字符串 `"${userId}_${type}_${id}"`。`id` 不可单独做主键（illust 和 novel ID 空间不重叠但数值可撞），`type` 加上后保证跨类型唯一。

**用户隔离（User Isolation）**：
`userId` 字段嵌入每个 HistoryEntry，复合 key 天然隔离。登录/切换用户时对应刷新 L1 hot cache。登出不清空数据。

**1 个月过期（30-day Expiry）**：
浏览记录的自动淘汰窗口。写入时懒清除 `visitedAt < Date.now() - 30天` 的条目。不设条数硬上限。

**本地优先（Local-first）**：
浏览历史纯本地存储，不同步 Pixiv 服务端。使用 `@tanstack/solid-db` 的 `localStorageCollectionOptions` 持久化。

> **可复用的两条设计结论**（与 TanStack DB 无关，将来若另立票仍适用）：
> ① **条目主键必须含 `type` 段**——illust 与 novel 的 ID 空间不重叠但**数值可撞**，单用 `id` 会跨类型误命中；
> ② **淘汰用懒清除 + 时间窗，不用条数硬上限**——写入路径上顺带做 `visitedAt` 比对，不引入独立清扫任务。

### 2. 错误处理的 tuple 模式

> 来源：`packages/app/CONTEXT.md` §错误处理模式
> 状态：**约定随源码删除**（`src/utils/tryAsync.ts`、`unplugin-auto-import` 配置均在被删目录内）。此处只留模式定义，供将来决定是否在新客户端重建。

**错误元组模式（Error Tuple Pattern）**：
用 `[err, data]` 两元素元组替代 throw/try-catch 的错误传递方式。第一个元素为错误对象（成功时为 `null`），第二个元素为正常数据（失败时为 `undefined`）。优先于 try-catch 使用。

**tryAsync**：
`src/utils/tryAsync.ts` 导出的异步错误包装函数。接收 `Promise<T>`，返回 `Promise<[Error, undefined] | [null, T]>`。用于替代 `try { await ... } catch` 模式。与 try-catch 相比，不阻止 V8 对调用函数的全量优化，且无需 finally 清理。

**trySync**：
`src/utils/tryAsync.ts` 导出的同步错误包装函数。接收工厂函数 `() => T`，返回 `[Error, undefined] | [null, T]`。用于替代 `try { JSON.parse(...) } catch` 等同步操作的 try-catch。工厂函数形式确保可能抛出的同步代码惰性执行，不影响调用函数的 V8 优化。

**统一清理模式（Unified Cleanup Pattern）**：
配合 tryAsync 的 finally 替代方案。try-catch-finally 中的清理逻辑移至 tryAsync 调用之后、err 判断之前执行。`loading.set(false)`、`clearTimeout()` 等清理操作只写一次，不再因 try-catch 的 finally 块而拆分为两个分支。每个 tryAsync 调用对应一条清理线。

**自动导入（Auto-import）**：
通过 `unplugin-auto-import` 在构建期自动向所有源文件注入 `tryAsync` 和 `trySync` 的 import 语句，无需在源码中显式书写 `import { tryAsync, trySync } from '@/utils/tryAsync'`。自动生成的 `auto-imports.d.ts` 文件加入 `.gitignore`，由 `pnpm dev` 首次运行生成。

> ⚠️ 上列四条的**实现路径全部在被删目录**（`src/utils/tryAsync.ts`、Vite 构建配置）。
> app-lynx 侧当前**不使用**该模式（实测：全仓无 `Promise<[` 形态的返回标注）。
> 保留本节的理由是**模式本身**（元组约定 + 单一清理线）不依赖具体实现，可被将来的实现直接复用。

### 3. WebDAV 备份词条

> 来源：`packages/app/CONTEXT.md` §WebDAV 备份（wayfinder #455）
> **判定：已存在于 `docs/specs/webdav-backup.md` §3.1 / §3.2 / §6，不重复搬运。**
> 逐条对照：

| 词条 | 已存在于 |
| --- | --- |
| 备份域 / 排除域 | `docs/specs/webdav-backup.md` §3.1 |
| 账号级键过滤恢复 | `docs/specs/webdav-backup.md` §6 第 6 步 |
| 备份传输三层 | `docs/specs/webdav-backup.md` §4 |
| 备份快照格式 v1 | `docs/specs/webdav-backup.md` §3.2（含完整 JSON 样例） |
| 恢复语义 v1 | `docs/specs/webdav-backup.md` §6（9 步流程 + 拒绝边界） |
| 连接配置进备份 | `docs/specs/webdav-backup.md` §3.1 + §7 |

> 决策全文：[ADR-0156](../../adr/ADR-0156-webdav-backup-architecture.md)。
> 实现侧在 app-lynx 有真实消费方（`src/utils/backupCore.ts` / `backupService.ts`），该 spec 是其事实源。

### 4. 设置同步的存储落点

> 来源：`packages/app/CONTEXT.md` §设置同步
> 状态：实现侧（`PictelioPrefsModule`）随宿主迁移到 `packages/android-host`，**不随客户端删除**。
> 但**物理约定**在 Lynx 侧只有零散提及、无独立词条，故在此固化。

**账号级设置（Account-scoped setting）**：
跟随登录账号、不随设备或客户端漂移的设置。存储键含 userId（如 `show_r18_${uid}`），webview 与 lynx 两 client 读写同一 SharedPreferences "CapacitorStorage" 文件，切换引擎后读到同一份值。
_Avoid_: 设备级设置（键不含 userId 的旧模式）

**共享设置存储（Shared settings storage）**：
跨 client 设置契约的物理落点——SharedPreferences 文件 "CapacitorStorage"（@capacitor/preferences 默认 group）。webview 经 Capacitor 插件读写；lynx 原生经 `PictelioPrefsModule` 读写；lynx web-core dev 预览降级 IndexedDB（仅开发环境）。
_Avoid_: 本地存储（localStorage，web-core Worker 环境不存在）

> ⚠️ **单引擎化后的读法**：webview 侧消费方已随源码删除，「双端读写同一文件」如今是
> **存量数据格式约束**而非双端协同约束——`"CapacitorStorage"` 这个**文件名本身**一字不可改，
> 否则已安装用户读不到 `refresh_token` 与全部设置（[ADR-0050](../../adr/ADR-0050-lynx-login-persistence.md)，
> 术语「存量格式契约」见 [glossary-webview-client-removal](../../adr/glossary-webview-client-removal.md) §三）。
> 决策全文：[ADR-0103](../../adr/ADR-0103-account-scoped-content-settings.md)；
> 实施规格 `docs/specs/account-scoped-content-settings.md` §账号级设置 + 共享存储契约。

## 完整盘点表

`packages/app/CONTEXT.md` 全部章节逐节判定。**「他处已存在」= 不搬运**，理由列给出具体去处。

| # | 原章节 | 判定 | 理由 |
| --- | --- | --- | --- |
| 1 | 单引擎化订正横幅 | **丢** | 描述的是「webview 源码留存」这一即将消失的状态本身，随文件删除即自洽；其结论已由 `glossary-webview-client-removal.md` 取代 |
| 2 | WebDAV 备份 | **他处已存在** | `docs/specs/webdav-backup.md` §3.1/3.2/4/6/7 逐条覆盖（对照表见 §3） |
| 3 | 浏览导航 | **丢** | 逐条为 webview 侧 SolidJS 实现细节（TanStack Virtual / `createVirtualScrollRestore` / `scrollRestoreGlobal` / `<fluent-dialog>`）；app-lynx 有自己的「路由层」「列表操作」章节覆盖导航与回顶语义，判定条件与实现路径均不同，合并会产生错误映射 |
| 4 | 滚动驱动显隐 | **丢** | 同上；app-lynx 用 FAB 菜单 + 重建回顶，无 header 显隐机制。ADR-0012/0013 存续 |
| 5 | 作品标识 | **丢** | 动图/多图/类型徽章在 app-lynx §作品标识 已有；ugoira 播放管线的 lynx 侧形态在 §客户端 已有且更详细（原生解压写盘 vs web JS 解压是两套实现）。ADR-0125~0128 存续 |
| 6 | 界面控件 | **丢** | `fluent-dialog` slot 契约是 `@fluentui/web-components`（webview-only）；玻璃 Tab 视觉语言在 app-lynx 已是 M3 形态且自有章节。ADR-0087 存续 |
| 7 | 错误处理（分类 / OAuth 400 / ErrorDisplay） | **他处已存在** | OAuth 400 双形态 + 一手来源（pixivpy#374、gallery-dl#9331）在 `docs/adr/glossary-cross-engine.md` §证据节完整留存；`ApiErrorType` 枚举在 app-lynx `src/api/types.ts` 有一份等价定义；`ErrorDisplay` / 代理错误为 webview-only 组件与 Vite 代理机制 |
| 8 | 错误处理模式（tuple） | **搬** | 模式级约定不依赖被删实现 → §2 |
| 9 | 浏览历史 | **搬** | 属「接受的缺口」，设计本身可复用（主键含 type、懒清除淘汰） → §1 |
| 10 | 搜索 | **部分搬** | 两个硬约束 → app-lynx §搜索；其余词条 → `docs/adr/glossary-search-pagination.md`（搜索范围/目标/合流/热门排序）+ `docs/specs/app-lynx-global-search.md`（范围/排序对齐）+ `glossary-search-pagination.md` 已覆盖。**注意**：原「搜索历史最近 50 条」是 webview 侧上限，app-lynx 实测为 `HISTORY_LIMIT = 10`，不搬运以免造成错误对齐 |
| 11 | 发布上传（变体 APK / 逐包上传 / 上传面板） | **丢** | 描述的是 `full`/`webview` flavor 形态，随 #610 已下线；发布链归宿主包迁移范围。ADR-0065/0067 存续 |
| 12 | 发布文案 | **丢** | ADR-0166 决策全文 + `docs/release-checklist.md` 存续；实现 `scripts/lib/release-notes-ai.mjs` 随宿主迁移不删 |
| 13 | 更新分发（Web Bundle 等） | **丢** | ADR-0202 已下线该发布通道、ADR-0203 决策 4 明确清理其 API；`docs/specs/ota-web-bundle.md` 存续 |
| 14 | 设置同步 | **搬** | 物理落点约定在 Lynx 侧无独立词条 → §4 |
| 15 | 内容过滤（AI 三态） | **丢** | app-lynx §受限内容 已有 AI 条目 / AI 遮罩卡 / AI 模式三条，且 M3 形态为本端自有。ADR-0155 存续 |
| 16 | 引擎可用性与降级 | **丢** | 原文件已自标「机制随单引擎化失效」；ADR-0153/0164 + `glossary-single-engine-facade.md` 存续 |
| 17 | 网络直连（IP 直连 / IP 表） | **丢** | **⚠️ 见 §5 风险登记**：Java 实现未在 `packages/app/android/app/src` 中检出（`DirectAccess` 零命中，仅 `build.gradle` 注释提及 `#389 DirectAccessTransport`），本轮不搬运一个实现位置不明的契约 |
| 18 | 图床（缓存键 / 源无关命中 / 下载源） | **搬** | app-lynx 原生读端正在执行 → app-lynx §图床缓存契约 |
| 19 | 排行榜 | **丢** | app-lynx §排行榜 已有入口/榜单页/维度/日期/名次五条 |
| 20 | 引擎切换与双向降级 | **丢** | 原文件已自标失效；ADR-0153/0164 存续 |

## 风险登记：删除后会悬空的指针

搬运完成后，以下**指向被删文件**的引用仍然存在于**不会删除**的文档中。它们不在本轮文件所有权范围内（分属 `docs/adr/**`、`docs/specs/**` 他文与 `CONTEXT-MAP.md`），仅登记：

| 位置 | 指向 | 影响 |
| --- | --- | --- |
| `packages/app-lynx/CONTEXT.md:28` | `packages/app/CONTEXT.md` | AI 模式词条互镜像引用 |
| `packages/app-lynx/CONTEXT.md:47` | `packages/app/CONTEXT.md` | 动图/多图判定条件引用 |
| `packages/app-lynx/CONTEXT.md:260` | `packages/app/CONTEXT.md` | 流式取帧 vs Range 流式取帧语义引用 |
| `packages/app-lynx/CONTEXT.md:263` | `packages/app/CONTEXT.md`「网络直连」 | 直连模式术语引用 |
| `packages/app-lynx/docs/specs/tag-neighbors.md:6` | `packages/app/CONTEXT.md`「搜索关键词」 | 该引用所指的**两个硬约束已由本轮搬入 app-lynx §搜索**，可改指 |
| `CONTEXT-MAP.md:7` | `packages/app/CONTEXT.md` | 上下文地图的 `app` 行 |
| `docs/adr/ADR-0127-ugoira-streaming-playback.md:97` | `packages/app/CONTEXT.md` | 「流式取帧/渐进播放/帧就绪」双端术语 |
| `docs/adr/glossary-single-engine-facade.md:7,149` | `packages/app/CONTEXT.md` | 已阅读基线 / 保持不动表 |
| `docs/adr/glossary-android-lifecycle-restore.md:13` | `packages/app/CONTEXT.md` | 已阅读基线 |
| `docs/adr/glossary-cross-engine.md:13` | `packages/app/CONTEXT.md` | 已阅读基线 |
| `docs/adr/ADR-0103:82`、`ADR-0153:12`、`ADR-0155:51`、`ADR-0156:46`、`ADR-0065:26,31`、`ADR-0067:40`、`ADR-0098:34,64`、`ADR-0113:5`、`ADR-0197:6` | `packages/app/CONTEXT.md` | 各 ADR 的「关联 / 术语」元数据行，**记录的是决策当时的落点**，属历史索引，按 ADR 惯例不改写 |
| `docs/specs/account-scoped-content-settings.md:136`、`engine-availability-fallback.md:12,212`、`imagehost-native-fix.md:3`、`work-type-badges.md:4`、`webdav-backup.md:5,134` | `packages/app/CONTEXT.md` | 各 spec 的术语出处行，同上 |

> **判定口径**：ADR / spec 的「关联」「术语出处」是**决策当时的溯源元数据**，
> 按仓库 ADR 惯例（「保留原文以便追溯」）**不改写**；
> 真正会误导读者的是**运行时导航指针**（前 6 行），建议在删除动作的同一批次内改指。

## 复核

```bash
cd /Users/lilianda/develop/pixivizer
# 两条高优先词条已落 Lynx 侧
grep -c "关键词的两个硬约束" packages/app-lynx/CONTEXT.md   # 应 ≥1
grep -c "源无关命中" packages/app-lynx/CONTEXT.md            # 应 ≥1
# 承接文档存在
test -f docs/specs/webview-client-knowledge-migration.md && echo "OK"
test -f docs/testing/conventions.md && echo "OK"
```

## 参考

- [ADR-0203](../../adr/ADR-0203-webview-client-source-removal.md)（删除决策，§决策 6 = 接受的缺口）
- [glossary-webview-client-removal](../../adr/glossary-webview-client-removal.md)（术语）
- [ADR-0197](../../adr/ADR-0197-app-lynx-tag-neighbors.md)（D11/D12 记录了同一次搜索实测的局部结论）
- [ADR-0143](../../adr/ADR-0143-imagehost-download-source-java-sink.md)（§D2 缓存键恒官方 URL）
- [ADR-0103](../../adr/ADR-0103-account-scoped-content-settings.md) / [ADR-0050](../../adr/ADR-0050-lynx-login-persistence.md)（存储落点与存量格式）
- [ADR-0156](../../adr/ADR-0156-webdav-backup-architecture.md) / `docs/specs/webdav-backup.md`（备份词条的现存事实源）
