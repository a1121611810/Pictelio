# 全项目废弃项扫描（2026-10-18）

> 起因：webview 客户端已随 ADR-0203 整包删除，项目现为 **Lynx 单引擎**。维护者指出
> 「跨引擎问题已不存在，不要把存量代码默认当合理的——它可能就是废弃的」，要求对
> **全项目全部功能**做一次废弃项扫描。
>
> 先例：引擎回退子系统（`engineState` / `engineFallbackNotice` / `engineFallbackStore`）
> 因 Java 侧写方被删而整链失效——本次把它推广为全项目口径。

## 方法

10 个只读 agent 并行分片覆盖 10 个面（共享包 / android-host Java / 路由可达性 / i18n 死键 /
组件常量 / 契约键 / 依赖与 CI / 文档层 / 构建宏与环境变量 / 死测试）。

**核心判据：死代码 = 生产路径无消费方，且必须双向验证。**

- 只有读取方没有写入方 / 注册方 → 死（契约键只有 TS 读、没有 Java 写）
- 只有定义没有引用 → 死
- **单看「有 import / 有测试护着」不足以判活**——本次三个测试文件护着的模块实际是死的

**明确排除**（不是废弃项）：`web-core`（活的 dev 预览目标）、`loginPreview.ts` /
`errorPreview.ts`（`lynx.config.ts` 注册的真实预览入口）、`CapacitorStorage`（存量用户数据格式，
AGENTS.md 明令一字不改）、`docs/adr/**` 与 `docs/research/**` 的**历史正文**（ADR-0201 决策 4
「正文一字不改、只加存档横幅」）、`android-e2e`（ADR-0084 手动发布门，是活的）。

## 总览

共 **160 条**发现：

| 类别 | 条数 |
| --- | --- |
| 死代码 | 52 |
| 死文档 | 31 |
| 死配置 | 28 |
| 死测试 | 17 |
| 契约断链 | 15 |
| 覆盖缺口 | 14 |
| 待确认 | 3 |

## 七大主题

### 1. 契约断链：有读无写（15 条）—— 本次最系统的一类

TS 侧完整实现、测试齐备，Java 侧写方随 webview 删除。**同一个根因反复出现**，
说明缺的是一条门禁而不是逐个修复：

| 契约 | 读方 | 写方 | 状态 |
| --- | --- | --- | --- |
| `pictelio_engine_state` / `pictelio_engine_fallback_notice` | `engineState.ts` / `engineFallbackNotice.ts` | `EnginePrefs` / `EngineFallbackNotice` | **Java 类已删**，整链失效 |
| `CheckDescriptor.timeoutMs` / `TOTAL_BUDGET_MS` | `net-diagnostics/plan.ts` | `NetDiagProbe.java` 硬编码 4000/3000ms | plan 声明值与实现不符，且零读取方 |
| `exportDiagLog` | 无（`src/debug/` 已删） | `PictelioAppModule.java:316` 完整实现 | **原生方法悬空** |
| `setAccessToken` | 无 | `PictelioAuthModule.java:94` | 零调用点 |
| `getCacheDirPath` | 仅 Robolectric 单测 | `PictelioTranslateCacheModule.java:346` | 调试通道，无产品消费方 |
| `BuildConfig.CLIENT_KINDS` | `LynxRuntimeInitializer.java:125` → `isAvailable()`（零调用方） | `build.gradle:37` 恒为 `{"lynx"}` | 服务的 `io.pictelio.app.engine` 包（ADR-0164）已不存在 |
| `OTA_ED25519_PUBLIC_KEY_B64` | 无 | `build.gradle:29` | OTA 通道随 ADR-0203 下线 |
| `mainActivityFor` 的 `full`/`webview` 分支 | 仅 `unit/env.flavor.test.ts` | 无 | 返回的 Activity 类已删；**唯一让它看起来活着的就是那个单测** |

### 2. 假活锚点：门禁在给死代码发通行证

最需要警惕的一类——**它会让后续清理被自己的门禁挡住**：

- `android-host/tests/unit/webviewRemovalInvariants.test.ts:255` 把死方法 `exportDiagLog` 列为
  「通用原生方法必须保留」的**正面锚点**，而断言体只对 Java 文件自身做正则计数，从不扫 JS 侧
- `proguardRulesConsistency.test.ts:45` 断言两条 Room keep 规则字面存在，注释称「Room 仍随 app 使用」，
  而 build.gradle 根本没有 room 依赖
- `noDeadKeys.test.ts:32` 的扫描范围只含 `misc.ts`，漏掉 `pages.ts`——22 个 `engineFallback.reason.*` 死键一直绿灯
- `RankingEntryCard.template.test.ts:54` 只保证「孤儿页引用孤儿组件」，属自我循环的活

### 3. 死代码与死测试（52 + 17 条）

可删清单（已双向验证，生产引用数为 0）：

| 模块 | 备注 |
| --- | --- |
| `src/utils/engineState.ts` + `engineFallbackNotice.ts` + `stores/engineFallbackStore.ts` | 引擎回退子系统，约 21.3 KB |
| `src/primitives/createBookmarkToggle.ts` + 测试 | 被 `useBookmarkMutation` 取代（该文件第 3 行明写「替代」） |
| `src/utils/gallerySaver.ts` + 测试 | 保存链已改走 `buildImageTasks` + `lynxDownloadExecutor` |
| `src/utils/proxyRedact.ts` | WebView 期代理脱敏；⚠️ `safeParseUrl.test.ts:136` 把它硬编进一个**活**测试，删文件须同步摘行 |
| `src/utils/deliveryProbeReport.ts` | 探针特性本身活（`App.vue` 调 `initDeliveryProbeLifecycle`），这是活功能里的孤儿层 |
| `packages/ugoira/src/stream.ts` + 测试 | 流式取帧器，`CONTEXT.md:271` 自述「本端暂不消费」，唯二引用方是它自己的测试与 re-export |
| `packages/search-core/src/urlCodec.ts` / `cacheKey.ts` / `filters.ts:normalizeFilters` | 约 380 行源码 + 226 行测试，spec 与 ADR **已明文记为死代码**，只是没清理 |
| `SplashController.java` | 27 行类全仓零引用 |
| `LynxRuntimeInitializer.isAvailable()` | 零调用方，其单测连它都没测 |

> `search-core` 的 urlCodec / cacheKey / normalizeFilters / isDefaultFilters 已被
> `docs/specs/search-target-mode.md:162,165` 与 `ADR-0132:91` **明文记为死代码**。
> 这不是新发现，是「已记录但未清理」——是否删取决于对「前瞻性接线」的取舍。

### 4. 覆盖缺口（14 条）—— 比死代码更危险，因为它静默

- **`check:all` 漏包**：CI 的「Type check (all packages)」只跑 `check:all`，而
  `@pictelio/android-host`、`@pictelio/search-core`、`@pictelio/ranking-core` 三个包
  **都没有 `check:` 脚本**。宿主包的 TS 从不进类型门禁，但它的单测却进了 `test:all`（不对称，无文档说明）
- **三份现行 spec 把不存在的命令当验收门禁**：`app-lynx-recommended-carousel.md:107`、
  `app-lynx-detail-multi-image-list.md:95`、`lynx-night-mode-audit.md:100` 要求 `pnpm lint:app-lynx` 全绿，
  实测 `Command "lint:app-lynx" not found`（ADR-0185 改根单配置源后已删）。照着跑必红
- **`vp run --filter` 对不存在的 task 静默忽略**：`dev:all` / `build:all` / `preview:all` /
  `check:all` / `test:all` 里的 `:all` filter 共 8 个**一直空转而无人察觉**
- `/illusts`、`/novels` 的 transition-matrix 与 `verify-translation.sh` 在验证**生产用户走不到的路径**

### 5. 死文档与「现行规范指向空符号」（31 条）

- **`AGENTS.md:131` 把 `EngineRouting.resolve` 列为关键设计决策硬规则**——
  而 `EngineRouting` Java 类已随 #610 删净（`packages/android-host/**/*.java` 零命中）。
  违反这条「硬约束」在今天**无法执行也无法判定**：这是指向空符号的架构违规条款
- `docs/specs/engine-availability-fallback-tickets.md` 是唯一仍以 `to-tickets` 可执行票据格式
  呈现已下线引擎机制的文档，T5 状态还是 `todo（需真机）`；同族三份 spec 都已加存档横幅，唯独它没有
- `qa-defense-lines.md:37-38` 与 `release-checklist.md:218` 直接矛盾（前者要求 transition checklist 全过，
  后者称该清单不可执行）；同文件 :5 的「webview OTA」已随 ADR-0202 下线，而 T2 已按单引擎更新——
  **现行 spec 内部自相矛盾**，而它是 `NOTES.md` 指定的矩阵事实源
- 6 份已下线 spec 缺 ADR-0201 决策 4 要求的存档横幅
- `packages/app-lynx/CONTEXT.md` 有 5 处指向已删的 `packages/app/CONTEXT.md`，
  而同文件其余 6 处同类引用**都加了「原位置不再存在」旁注**——上一轮搬运时漏改

### 6. i18n 死键（54 行字典）

- 22 个 `engineFallback.reason.*` + `engineFallback.legacyBanner`（zh + en 各 12）
- 15 个 `novelTranslate.*`（zh + en 各 15）：`TranslateButton.vue` 的 `LABEL_KEYS` 只登记 5 键，
  spec §8 预留的其余无渲染点；而它们被 `novelTranslate.test.ts:16` 的自证式 `EXPECTED_KEYS` 清单护住，
  在扫描中**伪装成活键**

### 7. 死配置（28 条）

`scripts/lynx-device-check.sh:18` 往 `CapacitorStorage.xml` 写 `pictelio_client_kind=lynx`，
但写方 `EngineRouting.resolve` 已删、读方 `engineState.ts` 已死 ⇒ **该步骤是纯空操作**。
同族：`.husky/pre-push:5` 注释仍写已删的 `packages/app` 三域校验；
`check-app-lynx-anchors.mjs:9` 拿已删文件当「锚点模式参考」。

## 已实证存活、勿误报（负面结论同样重要）

- 7 个构建宏（`__DEV__` / `__APP_VERSION__` 等）**双向全部连通，无一死宏**
- `vitest.fallback.config.ts` 的 fallback 是**首页顶栏回退阀**（票 #906/#907、ADR-0216），
  与引擎回退子系统无关，逃生阀刻意要 CI 覆盖
- 52 个 `.vue` 组件 + 27 个页面**全部有生产引用，零死组件**
- Java 14 个模块约 60 个 `@LynxMethod` 逐个对 TS 调用点：**反向（TS 调 / Java 无实现）0 处**
- `pictelioBenchNav*` 24 个发射场景与 `router.ts` 路由表全数配平
- `/ranking` 页面是**活的**（`Updates.vue:79` 空态出口可点，且有门禁钉住）——
  死的只是其入口组件 `RankingEntryCard.vue` 与 `Me.vue:963` 的 `rankingEntry` 开关
- `BENCH_NAV=1` 经 `cleanEnv()` → `build:android` → rspeedy 全链路**真实生效**
- `searchHistoryStore` / `modalStack` / `watchlistStore` 等 store 均有真实消费方

## 建议处置顺序

1. **先补门禁再删代码**：①「凡 TS 侧读取的 `pictelio_*` 契约键，Java 侧必须有写入方」
   ②「`check:all` 补齐 android-host / search-core / ranking-core」
   ③ 修 `noDeadKeys` 扫描范围至 `pages.ts`
   —— 契约断链、覆盖缺口、假活锚点三类的**根因都是缺门禁**，不补就会复发
2. 删已验证的死代码与死测试（见主题 3 清单），连带清掉假活锚点
3. 修 `AGENTS.md:131` 的空符号硬规则；给缺横幅的 spec 补横幅
4. `/illusts`、`/novels` 可达性属**产品决策**（恢复入口 or 把取证改道到生产可达页）

## 覆盖度与局限

- **已覆盖**：10 个分片全跑完；Java 侧 `@LynxMethod` 与 TS 调用点是全量反查（非抽样）
- **未覆盖**：`.env`（gitignore 内的本机文件，未读取）；`docs/adr/**` 与 `docs/research/**` 的
  历史正文（按 ADR-0201 决策 4 豁免，只查了「有没有东西还把它当约束」）
- **`docs/specs/**` 的豁免口径是本次最大的判断点**：按「无入站引用 + 描述对象全删 ⇒ 死文档」判。
  若维护者认为 specs 也应按历史记录原样保留，这 31 条要降级为「补存档横幅」

## 完整清单（按分片）

以下为 10 个分片的原始产出。


---

## 分片 01-共享纯逻辑包

# 01 · 共享纯逻辑包（ugoira / update-check / novel-export / search-core / ranking-core / net-diagnostics）

判据：死代码 = 生产路径无消费方，双向验证（写方/读方 + 包内可达性）。测试引用不算消费方。
已确认非废弃项（不重复查）：web-core 开发预览、loginPreview/errorPreview、docs/adr + docs/research 历史存档、CapacitorStorage、android-e2e。

## 死代码

- [死代码] packages/ugoira/src/stream.ts:30 — ADR-0127「流式取帧器」createStreamFrameSource / StreamFrameSource — 全仓唯一引用方是 packages/ugoira/tests/stream.test.ts:45；生产侧零消费（app-lynx/src/api/ugoira.ts:6 的 import 列表不含它），曾消费它的 packages/app/src/api/illust.ts 随 ADR-0203 整包删除；packages/app-lynx/CONTEXT.md:271 白纸黑字写「共享包 createStreamFrameSource（ADR-0127）本端暂不消费」 — 可删：src/stream.ts 106 行 + tests/stream.test.ts 145 行 + src/index.ts:225 的 re-export ≈ 252 行
- [死代码] packages/ugoira/src/index.ts:184 — sliceFrames（store 模式按 fileOrder 切帧链的终点） — app-lynx/src/api/ugoira.ts:6 只导入 unzipFrames/parseZipEocd/parseZipCentralDir/computeFrameOffsetFromLocal/deflateInflate/UgoiraZipEntry；sliceFrames 零外部消费方，只被 tests/index.test.ts:197 引用，连带把 sliceStoreFrame(:168) 与 computeFrameOffset(:133) 一起拖成不可达（Range 路径走的是 computeFrameOffsetFromLocal:150） — 可删：src/index.ts:127-198 内 store 切片段 ≈ 72 行 + tests/index.test.ts 对应用例 ≈ 100 行
- [死代码] packages/search-core/src/urlCodec.ts:9 — 筛选状态 ↔ **webview** URL query 编解码（encodeFiltersQuery/decodeFiltersQuery） — 文件头 urlCodec.ts:2-3 自述「webview 搜索是全页路由，URL 是会话内保留的实际载体」，而 WebView 客户端与其路由已随 ADR-0203 删除；生产侧零消费，仅 tests/urlCodec.test.ts 引用，但 src/index.ts:8 仍把它挂在公共面上 — 可删：urlCodec.ts 42 行 + tests/urlCodec.test.ts 86 行 ≈ 128 行
- [死代码] packages/search-core/src/filters.ts:110 — normalizeFilters（不可信输入逐字段校验） — 唯一调用方是死代码 packages/search-core/src/urlCodec.ts:35，生产侧零消费；连带成为死代码的还有 filters.ts:83 isDefaultFilters（仅被死的 cacheKey.ts:20 调用） — 可删：filters.ts:110-170 约 61 行 + isDefaultFilters 10 行 + filters.test.ts 内 normalize/isDefault 用例 ≈ 50 行
- [死代码] packages/search-core/src/cacheKey.ts:13 — buildCacheKey（搜索结果 LRU 缓存键） — 头注释 cacheKey.ts:5 自证「⚠️ 这是前瞻性接线，不是当前正确性要求——本函数零生产消费方（webview 侧 inFlightSearchKey 随 ADR-0203 删除）」；app-lynx 侧确认搜索结果不做全局 LRU 缓存，但 src/index.ts:9 仍导出，且被 27 处测试引用形成假绿；docs/specs/search-target-mode.md:162 与 docs/adr/ADR-0132-app-lynx-global-search.md:91 均已把它记为死代码（维护者已知，代码仍在） — 可删：cacheKey.ts 37 行 + tests/cacheKey.test.ts 140 行 ≈ 177 行
- [死代码] packages/ranking-core/src/cacheKey.ts:14 — rankingCacheKey（榜单缓存/查询键） — 生产侧零消费（app-lynx 只导入 buildRankingRequest/RankingQuery/RANK_MODES/DEFAULT_RANK_MODE/jstToday/shiftDate/formatRankingDate，见 packages/app-lynx/src/api/ranking.ts:4 与 pages/Ranking.vue:18）；src/index.ts:9 仍导出，tests/cacheKey.test.ts 61 行全部只测它；docs/specs/ranking.md:190 仍把它列在「两端共用」API 表里当作现行契约 — 可删：cacheKey.ts 17 行 + tests/cacheKey.test.ts 61 行 ≈ 78 行
- [死代码] packages/novel-export/src/blocks.ts:214 — buildSearchText（导出块 → 纯文本，喂搜索） — 全仓（含测试）零引用，是唯一「连测试都没有」的裸导出；随它一起零消费的还有 blocks.ts:225 selectInlineImageUrl 与 blocks.ts:232 getImageBlocks（仅 tests/blocks.test.ts:146/151/159 引用） — 可删：src/blocks.ts:214-234 约 21 行 + tests/blocks.test.ts 对应用例 ≈ 20 行
- [死代码] packages/novel-export/src/formats.ts:73 — mimeForNovelExportFormat — 生产侧零消费：MIME 由 Java 侧 packages/android-host/android/app/src/main/java/io/pictelio/app/NovelExporter.java:567 自带处理，app-lynx 的入队执行器也不读它；仅 tests/formats.test.ts:69 引用，而 docs/specs/novel-export.md:43 仍把它列为包 API — 可删：1 个函数 + tests/formats.test.ts:69 附近 ≈ 3 行
- [死代码] packages/net-diagnostics/src/plan.ts:40 — getCheck（按 id 取检查项描述符） — 判定层 packages/net-diagnostics/src/judge.ts:50/97 用的是 `CHECK_PLAN.find(...)` 内联查找而非本函数；生产侧零消费，仅 tests/plan.test.ts:11/15 引用 — 可删：3 行 + tests/plan.test.ts:11/15 ≈ 4 行
- [死代码] packages/net-diagnostics/src/types.ts:5 — DiagEngine = "webview" | "lynx" 中的 "webview" 臂 — 双向验证：全部写方（app-lynx/src/utils/netDiagnostics.ts:21、:45，pages/NetworkCheck.vue:61）恒写 "lynx"，Java 侧 NetDiagProbe.java 不产出 engine 字段；"webview" 唯一出现处是 tests/judge.test.ts:8 的测试夹具 —— 单引擎后该枚举臂永远不可达，且 types.ts:2 的文件头仍宣称「两个客户端（WebView / Lynx）…都以此为准」 — 可删：1 个枚举臂 + 1 处测试夹具 + 头注释改写 ≈ 3 行
- [死代码] packages/net-diagnostics/src/types.ts:4 — DiagPlatform = "android" | "ios" | "web" 中的 "ios" 臂 — 全仓无 iOS 客户端，无任何写方产出 "ios"（写点只有 netDiagnostics.ts:20 "web" 与 :44 "android"） — 可删：1 个枚举臂 ≈ 1 行

## 契约断链

- [契约断链] packages/net-diagnostics/src/plan.ts:11 — CheckDescriptor.timeoutMs 与 :19 TOTAL_BUDGET_MS（诊断超时预算） — 声明侧完整、生产路径零读取：TS 侧从不下发这些超时，Java 侧 NetDiagProbe.java:271/272 硬编码 4000ms 与 3000ms，与 plan 声明的 1500/2000/2500/2000 既不逐项相等、合计也远超 TOTAL_BUDGET_MS=10000；唯一「守卫」是 tests/plan.test.ts:20 拿 CHECK_PLAN 自己跟自己声明的常量比对 —— 典型的「承诺的数据源从未被读取」：改 plan 的 timeoutMs 全绿、线上超时纹丝不动 — 可删（非删而是接线）：要么删 plan 的 timeoutMs/TOTAL_BUDGET_MS + 对应用例，要么让 Java 从 plan 取值；约 6 行 + 约 6 行测试

## 死配置

- [死配置] packages/net-diagnostics/src/plan.ts:23 — CHECK_PLAN 中的 route「网络直连路由」项（disabledReason: "网络直连功能已于 bf32620e 移除"） — 恒定 skipped：judge.ts:99-106 遇 disabledReason 直接返回 skipped，且 Java 从不写 "route" 探针（NetDiagProbe.java:197-254 只写 dns/tcp/tls/http/edge + device）—— 自检页面上永远是一行「已跳过」的装饰 — 可删：plan.ts 7 行 + judge.ts:237 的 probeView 调用 + tests/plan.test.ts:15 ≈ 9 行（注意：删除会改变用户可见的自检报告输出，需同步 spec docs/specs/network-self-check.md）

## 死文档

- [死文档] docs/adr/ADR-0127-ugoira-streaming-playback.md:27 — 状态仍为「已接受（2026-08-31）」，把「共享包 @pictelio/ugoira 必须提供 createStreamFrameSource」（:101 列为交付项）当作现行约束 — 判据是「有没有东西还在把它当约束」：ADR 自身未标存档/被取代，且 packages/ugoira/src/stream.ts 的实现正是照它写的，但该约束的唯一消费层（app 侧 streamUgoiraFrames）已随 ADR-0203 删除 ⇒ 一个已无消费方的规范仍在规定共享包形态 — 可删：改为「已随 ADR-0203 失去消费层（实现暂留待清理）」标注即可，无需改正文（ADR-0201 决策 4）
- [死文档] docs/specs/ranking.md:190 — 排行榜 spec 的共享 API 表仍把 rankingCacheKey 列为「两端共用以免键漂移」的现行契约 — 该函数零生产消费方（见上），spec 表格把它当活契约列出会让下一个读 spec 的人以为存在调用点 — 可删：1 行表格行 + 标注「前瞻性接线，当前零消费方」
- [死文档] packages/search-core/src/index.ts:2 — 包头仍写「@pictelio/search-core —— **双端**搜索共享核心」（ranking-core/src/index.ts:2「双端排行榜共享核心」同病，ugoira/src/index.ts:5「双端（pictelio-app / app-lynx）」、filters.ts:4「本包是双端单点事实源」同病） — WebView 客户端已整包删除，这批「双端单点事实源」的表述已不成立（单引擎下是「单端事实源」），持续留着会误导后来者去找不存在的第二端 — 可删：4 处注释改写，不涉代码

## 死测试

- [死测试] packages/ugoira/tests/stream.test.ts:7 — 145 行单测全部只测 createStreamFrameSource（死模块） — 这是典型的「有测试护着 ≠ 活」：绿灯只证明死代码自身自洽，对生产路径零覆盖价值 — 可删：145 行
- [死测试] packages/search-core/tests/cacheKey.test.ts:1 与 packages/search-core/tests/urlCodec.test.ts:1 — 226 行单测分别只测 buildCacheKey 与 encode/decodeFiltersQuery（两个死模块） — 同上；search-core 当前 54 个用例里有相当比例在给死模块背书，会稀释 mutation/覆盖率信号 — 可删：226 行
- [死测试] packages/ranking-core/tests/cacheKey.test.ts:1 — 61 行单测只测 rankingCacheKey（死模块） — 同上 — 可删：61 行
- [死测试] packages/novel-export/tests/blocks.test.ts:146 — buildSearchText / getImageBlocks / selectInlineImageUrl 三个零消费导出的用例块 — 其中 buildSearchText 全仓零引用却仍有测试，属测试反向固化了死 API 面 — 可删：约 20 行

## 待确认（证据不足，不下结论）

- [待确认] packages/novel-export/src/blocks.ts:138 parseJumpKind — 定义在 138 行、被同文件 parseNovelBlocks:193 内部调用，生产链可达；但作为 export 无外部消费方，可能是有意留作块解析契约的一部分，也可能是过度导出 — 需维护者确认是否属于「保留内部 API 面」
- [待确认] packages/update-check/src/index.ts:40 isNewer — 无外部消费方，但被同文件 checkForUpdate:131 内部调用，模块本身是活的（app-lynx/src/stores/updateStore.ts:12 在用 checkForUpdate）⇒ 只是导出面冗余，非死代码，未列入正式发现

---

## 分片 02-android-host-Java

# 分片 02 · android-host Java（packages/android-host/android/app/src/{main,lynx}/java + 其构建配置）

判定口径：生产路径无消费方 = 死。均已双向验证（有消费方/无消费方都查过）。
工具路由：本分片以「已知路径的完整文件读取 + 单文件/小范围定位」为主，属 AGENTS.md「工具触发协议」
允许的降级项（CodeGraph 未返回本分片新符号时降级 grep/read 并在此声明）。

- [死代码] packages/android-host/android/app/src/main/java/io/pictelio/app/SplashController.java:10 — 27 行 `SplashController`（keepVisible/dismiss/shouldKeepVisible 三个静态方法）— 全仓零引用：对 main/java + lynx/java + androidTest + test + testLynx + 全部 .xml/.gradle/.pro/.kt 搜类名，除自身文件外 0 命中；类 javadoc 自述的调用方「MainActivity」与「full 变体」均随 ADR-0203/ADR-0201 删除；private 构造 + 纯静态方法，不存在反射实例化路径（全仓无该名字符串） — 可删 27 行整文件
- [死代码] packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxRuntimeInitializer.java:105 — `public static boolean isAvailable(Application)` — 零调用方：grep `isAvailable` 全 java 源集只剩本方法、其 javadoc `:20` 的自引用、以及 `PictelioImageService.isAvailable()`（另一个类的同名方法，被 PictelioImageCacheModule 正常调用）；`testLynx/.../LynxRuntimeInitializerTest.java` 对 `isAvailable`/`CLIENT_KINDS` 零命中（连测试都没护）；唯一消费者是已删的引擎回退路由 — 可删约 28 行（连带 `:124 clientKindsContainLynx()`）
- [死代码] packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java:316 — `@LynxMethod exportDiagLog(String, Callback)` + 私有常量 `:38 DIAG_DIR` — app-lynx/src 全量标识符集合差集证明零 JS 消费方；配套的 `app-lynx/src/debug/` 探针目录已不存在（`t0Diag`/`t0Export` 全仓 0 命中），其来源 spec `docs/specs/app-lynx-feed-pagination-and-watchlist-prompt-fix.md:71` 明写「探针随 T3 收尾移除」——JS 侧已删、Java 侧漏删的半程清理 — 可删约 35 行
- [死测试] packages/android-host/tests/unit/webviewRemovalInvariants.test.ts:255 — `CLIENT_SWITCH_POSITIVE_ANCHORS` 把 `exportDiagLog` 列为「通用：诊断日志导出 · 必须保留」— 这是**假活锚点**：该数组只断言方法在 Java 源里 `minHits ≥ 1`（声明存在），不断言任何 JS 侧调用；因此上一条的死方法被这条「防糊弄」门禁钉住，删代码会先撞红测试、进而被误当成「不能删」 — 可删 1 行条目（随 exportDiagLog 一并处理）
- [死测试] packages/android-host/tests/unit/android/proguardRulesConsistency.test.ts:45 — `expect(keepRules).toContain("-keep class * extends androidx.room.RoomDatabase { <init>(); }")` 等两条断言 — 为下两条死 R8 规则发通行证；`:64` 注释明写「Room 仍随 app 使用」，而 build.gradle 无任何 androidx.room / androidx.work 依赖，2026-10-16 新构建的 merged manifest 只有 EmojiCompat/ProcessLifecycle/ProfileInstaller 三个 InitializationProvider meta-data、**没有 WorkManagerInitializer** — 断言前提已不成立 — 可删 2 条断言 + 约 20 行注释
- [死配置] packages/android-host/android/app/build.gradle:29 — `buildConfigField "String", "OTA_ED25519_PUBLIC_KEY_B64"`（含 `:6-8` 的 base64 常量与 32 字节长度守卫）— ADR-0202 已把 OTA web bundle 通道整体下线；全仓 grep 该字段只在生成的 `build/generated/source/buildConfig/{debug,release}/…/BuildConfig.java` 出现，**无任何 Java 读取方** — 可删约 10 行
- [死配置] packages/android-host/android/app/build.gradle:94 — `variant.packaging.resources.excludes.add('META-INF/versions/9/**')`（bcprov multi-release jar 排除，注释见 :92-93，指向 ADR-0122/#248）— bcprov 是 OTA Ed25519 验签的 provider，随 WebView/OTA 线一并离开依赖面；当前 dependencies 块无 bcprov、也无任何 AndroidX/Lynx 包传递引入它 — 可删 4 行
- [死配置] packages/android-host/android/app/proguard-rules.pro:11 — `-keep @com.getcapacitor.annotation.CapacitorPlugin class * { *; }` — Capacitor 整包随 ADR-0203 删除，注解类不在依赖面；2026-10-18 的 `outputs/mapping/release/configuration.txt` 全文只有这一条规则自身，**无任何 getcapacitor 匹配类** — 可删 1 行（+ :9-10 注释）
- [死配置] packages/android-host/android/app/proguard-rules.pro:52 — `-keep class * extends androidx.room.RoomDatabase { <init>(); }` 与 `:53 -keep class androidx.work.impl.WorkDatabase_Impl { <init>(); }` — 注释 `:44` 自述用途是「work-runtime 2.10（OTA 慢通道，ADR-0122）」；而 build.gradle 无 room/work 依赖、merged manifest 无 WorkManagerInitializer、R8 configuration.txt 只回显规则本身无匹配类 — 可删 2 行 + 约 14 行注释
- [死配置] packages/android-host/android/variables.gradle:5 — `androidxActivityVersion = '1.11.0'` — 零引用（app/build.gradle 不消费）；`LynxActivity.java:487` 注释已自认「variables 的 1.11.0 pin 未被引用，传递依赖决定」— 可删 1 行
- [死配置] packages/android-host/android/variables.gradle:7 — `androidxCoreVersion = '1.17.0'` — 零引用，app/build.gradle 未声明 androidx.core 依赖 — 可删 1 行
- [死配置] packages/android-host/android/variables.gradle:8 — `androidxFragmentVersion = '1.8.9'` — 零引用，app/build.gradle 未声明 androidx.fragment 依赖 — 可删 1 行
- [死配置] packages/android-host/android/variables.gradle:10 — `androidxWebkitVersion = '1.14.0'` — 零引用；androidx.webkit 是 WebView 专属支持库，随 WebView 线失效 — 可删 1 行
- [死配置] packages/android-host/android/app/src/main/res/xml/network_security_config.xml:1 — 「OTA bench 本地服务器（adb reverse http://127.0.0.1:8899）仅需回环 cleartext」— 唯一消费方 `debug/AndroidManifest.xml:4` 仍在引用它，故严格说不是零引用；但其自述存在理由（OTA bench 本地服务器 / `bench-ota.sh`）已被 ADR-0202 删除，release merged manifest 从不加载本文件。**待确认**：是否仍有非 OTA 场景需要 debug 回环 cleartext — 可删 1 文件 + debug manifest 1 行（若确认无需求）
- [死文档] packages/android-host/android/gradle.properties:24 — 注释「多模块（app + capacitor-android + cordova-plugins）的任务并行编译」— capacitor-android 与 cordova-plugins 两个 Gradle 模块随 ADR-0203 删除，`settings.gradle` 现只剩 `include ':app'`；注释描述的多模块并行已不存在 — 可改 1 行注释
- [死文档] packages/android-host/android/app/src/main/AndroidManifest.xml:32 — 注释「LAUNCHER Activity 按 flavor 注入（#116/#117）：full/webview → MainActivity 系，lynx → LynxActivity」— flavor 维度随 ADR-0203 下线，`build.gradle:36` 的 manifestPlaceholders 已写死 `[launcherActivity: ".LynxActivity", appClass: ".PictelioAppLynx"]`；MainActivity 与 full 变体均不存在 — 可改 2 行注释
- [死文档] packages/android-host/android/app/src/main/AndroidManifest.xml:30 — 注释「由 JS 层通过 @capacitor/app.toggleBackButtonHandler() 控制是否交由系统处理」— Capacitor 整包删除；现返回键由 LynxActivity:701 `handleOnBackPressed()` + Lynx SDK 的 OnBackPressedCallback 处理，与该插件无关 — 可改 1 行注释
- [死配置] packages/android-host/android/app/src/main/res/values/strings.xml:5 — `<string name="package_name">` — 零引用（全 android-host + app-lynx/src 搜 `package_name` 只命中自身声明）；Capacitor 构建期生成的标准串 — 可删 1 行
- [死配置] packages/android-host/android/app/src/main/res/values/strings.xml:6 — `<string name="custom_url_scheme">` — 零引用；Capacitor 构建期生成的标准串，且自定义 URL scheme 机制随 Capacitor 线删除 — 可删 1 行
- [死配置] packages/android-host/android/app/src/main/res/layout/activity_main.xml:1 — MainActivity 的布局 — 全仓零 `R.layout` 引用、零 inflate 引用、零 `setContentView(R.layout…)`；MainActivity 已随 ADR-0203 删除；`strings.xml:4 title_activity_main` 仍被 manifest `:37` 消费的是 **string** 同名项，与本 layout 无关 — 可删 535 字节整文件
- [死配置] packages/android-host/android/app/src/main/res/layout/activity_webview_error.xml:1 — WebView 错误页布局 — 全仓零引用；WebView 客户端已删，Lynx 侧错误页走 `LynxActivity.showErrorFallback` 代码构建（`:990`）不 inflate 布局 — 可删 438 字节整文件
- [死配置] packages/android-host/android/app/src/main/res/raw/upgrade.html:1 — 「需要升级 WebView」提示页（页面标题字面即 WebView）— 全仓零 `R.raw` 引用、零 `upgrade.html` 字符串引用（Java/TS/mjs 全查）；由已删的 WebView 客户端升级引导 — 可删 2909 字节整文件
- [死配置] packages/android-host/android/app/build.gradle:37 — `buildConfigField "String[]", "CLIENT_KINDS", '{"lynx"}'` — **待确认**：其唯一 Java 消费方是 `LynxRuntimeInitializer.java:124 clientKindsContainLynx()`，而该方法只被上面判死的 `:105 isAvailable()` 调用 ⇒ 连带成为死配置。但 `build.gradle:33-36` 注释有明确「机制与消费方一律保留，WebView 重写回归时原样可用」的书面决策，且 ADR-0062/ADR-0164 §7.1 仍把它当缺省引擎事实源 ⇒ 按「有意保留」处理，**不计入死配置**，仅随 `isAvailable()` 的删除提出待确认
- [覆盖缺口] packages/android-host/android/app/src/androidTest/java/io/pictelio/app/NovelExporterInstrumentedTest.java:34 — 129 行设备端编码器 instrumented 测试（补 Robolectric 跑不了 `PdfRenderer` 的缺口，自述有意义）— **不是死测试，但零接线**：`packages/android-host/package.json` 无 `connectedAndroidTest` 脚本、`.github/workflows/ci.yml` 无对应 job、全仓无文档化的手工入口 ⇒ 该缺口实际无人执行。**待确认**：是否需要补一条手工命令或删除 — 可删 129 行（若确认不再执行）

---

## 分片 03-路由与页面可达性

# 分片 03 — 路由与页面可达性

## 死路由（生产不可达，仅 debug/测试可达）

- [覆盖缺口] packages/app-lynx/src/router.ts:121 — `/illusts` 路由 + `IllustList.vue`（20KB 页面）在生产构建中无任何用户入口 — 全仓 `navigate('/illusts')` 零命中（唯一引用是本行路由声明与 router.ts:458 的 benchNav 表）；benchNav 被**双重门死**：JS 侧 `lynx.config.ts:117` 需 `BENCH_NAV=1`（生产恒 false），Java 侧 `LynxActivity.java:542` 需 `BuildConfig.DEBUG`；且路由注释自称的另两条理由经双向验证均为假——「深链」不存在（`utils/notificationTarget.ts:9` 把 `pixiv://illusts/{id}` 映射到**详情页** `/illust/{id}`，非列表页），「从二级页返回的回退目标」不存在（`goBack()` 栈空兜底落 `DISCOVER_PATH`，镜像栈仅由 push 填充，无人 push `/illusts`）— 可删规模：路由 1 行 + `IllustList.vue` 约 500 行 + `IllustList.template.test.ts` + 传递依赖 `RankingEntryCard.vue`/其测试 + `rankingEntry` 开关链，合计约 800 行；**须先确认 e2e 门禁是否仍需**（见下条）

- [覆盖缺口] packages/app-lynx/src/router.ts:123 — `/novels` 路由 + `NovelList.vue`（15KB 页面）在生产构建中无任何用户入口 — 与 `/illusts` 同因：`navigate('/novels')` 零命中，唯一通道 benchNav 双重门死；`Updates.vue:74` 反向佐证「⚠️ **刻意不放** `/illusts` / `/novels`」；`utils/notificationTarget.ts:10` 的 `pixiv://novels/{id}` 同样只落详情页 — 可删规模：路由 1 行 + `NovelList.vue` 约 380 行；⚠️ 与 e2e 冲突见下条

- [死文档] docs/specs/app-lynx-navigation-dimension-restructure.md:75 — 规格断言「`/illusts` `/novels` **保留**（深链/benchNav/回退）」，其中「深链」与「回退」两项已被验证不存在 — 该行是 router.ts:119-120 路由注释的直接依据，属**被当成现行约束引用**的死陈述（benchNav 一项为真但仅限 debug）；全仓仅此一处仍把两者当作需保留的理由 — 可删规模：1 行改写为「仅 benchNav 调试通道」

## 注释/规格与代码冲突（说反了）

- [死文档] packages/app-lynx/src/router.ts:158 — 注释称 `/platform-check`「不进任何导航入口——仅 benchNav 深链可达」 — 与代码直接矛盾：`AdvancedSettings.vue:292` 有 `@tap="navigate('/platform-check')"`，且 `/advanced` 是生产可达的顶层页（router.ts:118 + `Me.vue:449` 入口）；同一错误陈述在 `router.ts:491` 与 `src/pages/PlatformCheck.vue:16` 重复三处 — 可删规模：3 处注释改写（不删代码）

- [死文档] docs/specs/qa-defense-lines.md:91 — 规格第 3.T4 条称 PlatformCheck「**不进任何导航入口**，仅 benchNav 钩子可达」 — 该 spec 无存档横幅（仍是活文档），且被 router.ts:157 当作现行依据引用「spec docs/specs/qa-defense-lines.md §3.T4 / #550」；断言与 AdvancedSettings.vue:292 的生产入口矛盾 — 可删规模：1 行改写

## 契约断链

- [契约断链] packages/app-lynx/src/router.ts:155 — `/network-check` 声称「登录前可达：网络/登录失败时恰恰最需要它……不标 requiresAuth」，但生产中登录失败时恰恰进不去 — 不标 `requiresAuth` 的设计意图是登出/登录失败可达；然而维度重构后唯一生产入口搬到了 `/advanced`（`AdvancedSettings.vue:283`），而 `/advanced` 自身标了 `requiresAuth: true`（router.ts:118）；`Login.vue` 全文无任何指向 `/network-check` 的入口（唯一 `navigate` 调用是登录成功后落 `DISCOVER_PATH`）。结论：`meta` 少标不是 bug，但**可达性承诺已失效**——注释描述的场景无实现 — 可删规模：0 行代码（修注释或补 Login 入口二选一）；非删除项

## 门禁缺口（为什么上面两条能长期存活）

- [覆盖缺口] packages/app-lynx/tests/unit/routeLiteralDrift.test.ts:174 — 路由字面量门禁是**单向**的：只断言「每个 `navigate('<字面量>')` 都在路由表里」，从不断言反向的「每个路由都有生产入口」 — 这正是 `/illusts`、`/novels` 成为孤儿路由且 `check:all`/`lint:all`/`test:all` 全绿的原因；该门禁甚至已具备数据表形态的处理能力（:222-232 为 `/following`/`/ranking` 的数据表出口补了单独断言），却未对无出口路由设任何反向检查 — 可删规模：0 行（补一条反向断言即可，属新增门禁而非删除）

## 传递性死代码（随孤儿页下沉）

- [死测试] packages/app-lynx/src/components/RankingEntryCard.template.test.ts:54 — 断言 `IllustList.vue` 含 `RankingEntryCard` — 该断言只保证「孤儿页引用孤儿组件」，两个对象在生产中均不可达；测试护住的是死链而非活契约。注意：`/ranking` **页面本身是活的**，唯一活入口是 `Updates.vue:79` 空态出口（模板 `:314 @tap="navigate(a.to)"` 可点，`:232` 有门禁钉住），不可误判为死 — 可删规模：1 个测试文件约 54 行（随 RankingEntryCard 一并删）

- [死配置] packages/app-lynx/src/pages/Me.vue:963 — 「排行榜入口」设备级开关（`toggleRankingEntry` → `settingsStore.setRankingEntry`）在生产中无任何可观察效果 — 该开关唯一消费方是 `IllustList.vue:273` 的 `v-if="mode === 'recommend' && settings.rankingEntry"`，而 `/illusts` 生产不可达 ⇒ 用户在「我的」页拨动此开关看不到任何变化；开关状态仍会落盘（`settingsStore.ts:559` 跨端同键），是**读点存在、写点无回声**的悬空配置 — 可删规模：约 12 行模板 + `settingsStore` 内 rankingEntry 读写约 12 行 + 两语言案 2 行；⚠️ 若决定保留 `/illusts` 则本条自动作废

## 与活门禁的冲突（需维护者裁决，我不越界判定）

- [覆盖缺口] packages/android-host/tests/android-e2e/specs/transition-matrix.spec.ts:870 — e2e「转场矩阵」深链 `/illusts` 取证，与「`/illusts` 生产不可达」直接冲突 — 该 spec 标 `@release-gate`（ADR-0163），按 AGENTS.md 属**活的**手动发布门禁，不可删；但它验证的是一条生产用户永远走不到的路径。可删规模：0（e2e 本身不是废弃项）；**裁决点**：要么恢复 `/illusts` 的生产入口，要么把矩阵取证改道到生产可达页
- [覆盖缺口] packages/android-host/tests/android-e2e/tools/verify-translation.sh:60 — 翻译验收脚本 `--es benchNav novel` 深链 `/novels`，同样只验证生产不可达路径 — 同上；脚本另有 `benchNav novel-detail` 走详情页（`:69`）可替代 — 可删规模：0；**裁决点**同上

## 补充取证：门禁条件的精确范围（强化上述前两条）

- [覆盖缺口] packages/app-lynx/lynx.config.ts:117 — `__BENCH_NAV__: JSON.stringify(process.env.BENCH_NAV === '1')` 全仓**只有两处**设 `BENCH_NAV=1`，且都在 e2e 手工脚本里：`packages/android-host/tests/android-e2e/tools/verify-translation.sh:32` 与 `verify-abort.sh:57`（均配 `NODE_ENV=production`）；Gradle 构建脚本、`scripts/deploy.mjs`、CI workflow 均不设置 — 推论：`/illusts`、`/novels` **不是「debug 包可达」**，而是「仅当 e2e 脚本用 `BENCH_NAV=1` 重建 bundle 时可达」；普通 debug APK 虽然 `BuildConfig.DEBUG=true`，但 JS 侧 `registerBenchNavHandler()` 在 router.ts:450 `if (!__BENCH_NAV__) return` 整块消除，故这两页在**任何非 e2e 专用构建**（含开发自用 debug 包）中都进不去 — 可删规模：0 行（收敛证据，供删除决策用）

- 佐证（仓库自认）: packages/app-lynx/scripts/lynx-router-back-regression.sh:577 — 脚本注释自陈「当前产品代码无此通道（full 包 Intent 参数丢弃 + 默认 bundle 无 `__BENCH_NAV__`）」 — 该注释是对 benchNav 生产不可达性的独立确认，与本分片结论同向；仅引用，不单列为发现

---

## 分片 04-i18n死键

# 分片 04 — i18n 死键审计（Pictelio / packages/app-lynx）

## 审计方法（双向验证口径）

- 键集提取：`src/i18n/locales/{zh-CN,en}/{error,time,pages,misc,novelTranslate}.ts` 共 **734 键**，zh/en **完全对齐**（`en/index.ts:10` 的 `satisfies Dict` 编译期强制）⇒ 「缺键」不是问题。
- 消费方扫描：`t("...")` 直呼 648 命中 → 差集 88 候选 → 逐个排除**间接消费方**（`labelKey` / `t(m.labelKey)` / `STATUS_KEY[]` / `COMPAT_KEYS[]` / `HINT_KEYS[]` / `messageKey` 字面量 / computed 返回值），再排除 `*.test.ts`，再全仓验证 Java 侧与 `packages/ranking-core`。
- 反向验证：生产代码中**不存在动态键拼接** —— 所有 `t()` 首参均为字符串字面量或已逐个核对的常量表（已枚举全部 21 处非字面量 `t()` 调用点）。
- **反向假阳性 A 已排除**：`later.remove`（`src/pages/watchLaterPage.template.test.ts:89`）与 `novelDetail.charCount`（`src/pages/novelDetailTemplate.test.ts:40`）是 `expect(...).not.toContain(...)` 的**负向断言**，不是缺键。
- **反向假阳性 B 已排除**：`ranking.mode.{daily,weekly,monthly,newcomer,original,r18,r18g}` 看似无 `t()` 直呼，实为**活键** —— `src/pages/Ranking.vue:214` `v-for="m in RANK_MODES"` → `:217`/`:226` `t(m.labelKey)`，`labelKey` 定义在 `packages/ranking-core/src/modes.ts:37-43`。
- **反向假阳性 C 已排除**：`navTabs.*`、`searchSheet.*`、`networkCheck.status.*`、`illustDetail.a11y.*`、`seriesSheet.*`、`continue.clear.*`、`error.api.*`、`error.hint.*`、`useNovelWatchlistToggle.actionFailed` 共 67 键，全部经数据驱动表间接消费，是活键。

## 死代码（27 个 i18n 键，中英双份 = 54 行字典）

### A. engineFallback.* 共 11 键（单引擎化后永不可能为真）

- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:324 — `engineFallback.reason.preferred`「按首选引擎运行」 — 唯一消费方是 `src/utils/engineState.ts:48` 的 `REASON_KEYS` 表；该文件**零生产导入方**（仅 `engineState.test.ts:30` 自测），字典注释 `zh-CN/pages.ts:318-323` 已自认「文案与 engineState.ts 一并成为无消费方保留项」 — zh:324 + en:323 共 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:325 — `engineFallback.reason.lynx_unavailable`「Lynx 引擎在本机不可用，已改用 WebView」 — 同上；且「已改用 WebView」在 ADR-0203 删 WebView 客户端后永不可能为真 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:326 — `engineFallback.reason.lynx_known_bad` — 同上 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:327 — `engineFallback.reason.lynx_retry`「WebView 不可用，重试 Lynx」 — 同上 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:328 — `engineFallback.reason.webview_unavailable` — 同上 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:329 — `engineFallback.reason.a11y_webview`「已为无障碍服务启用 WebView」 — 同上 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:330 — `engineFallback.reason.a11y_lynx_last_resort` — 同上 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:331 — `engineFallback.reason.no_engine`「两个引擎均不可用」 — 同上；「两个引擎」前提已不存在 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:332 — `engineFallback.reason.forced_webview` — 同上 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:333 — `engineFallback.reason.runtime_failure` — 同上 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:334 — `engineFallback.reason.unknown` — 同上；该 map 于 `zh-CN/pages.ts:318` 被描述为「EngineRoute.Reason 全 10 码 + unknown 兜底」，全域已无渲染方 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:336 — `engineFallback.legacyBanner`「WebView 版本过低，本次已改用 Lynx 引擎运行；更新 WebView 后将自动恢复」 — 渲染点 `src/App.vue:303` 的 `v-if="engineFallback.notice"` 恒假：notice 唯一来源 `consumeEngineFallbackNotice()` 读原生键 `pictelio_engine_fallback_notice`（`src/utils/engineFallbackNotice.ts:14`），该键在 packages/android-host 内**零 Java 写方**（全仓仅 2 处命中：定义处 + `settingsStore.test.ts:1629`）；文案本身亦为纯 WebView 时代表述 — zh:336 + en:335 共 2 行（静态有引用、运行时不可达，判定强度弱于上 11 条）

### B. novelTranslate.* 共 15 键（spec §8 预留，UI 从未落地）

全部经三重排除确认：① 生产代码零引用；② 全仓无 `t(\`novelTranslate.…\${…}\`)` 式拼接；③ 唯一引用方是自证式键存在性测试。

- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:47 — `novelTranslate.endpoint.titleGroup`「翻译」 — 生产代码零引用；`src/components/SettingsEndpoint.vue` 只用 compat / credential / test 三组键表，无 titleGroup — zh:47 + en:49 共 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:51 — `novelTranslate.action.abort`「停止」 — 生产代码零引用；`src/components/TranslateButton.vue:100-106` 的 `LABEL_KEYS` 白名单只含 translating / retranslate / retry / configure / start 五键，未含 abort；`TranslateButton.vue:124-127` 的停止分支只 `emit('translate-abort')`，不出文案 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:53 — `novelTranslate.action.cached`「已缓存」 — 生产代码零引用；同上白名单未含 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:56 — `novelTranslate.action.switchMode`「切换显示」 — 生产代码零引用；同上白名单未含 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:61 — `novelTranslate.status.idle`「未翻译」 — 生产代码零引用；`TranslateButton.vue` 无 idle 态标签映射 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:64 — `novelTranslate.status.translatingQueued`「排队中」 — 生产代码零引用；store 无排队态文案渲染点 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:65 — `novelTranslate.status.partial`「部分译文」 — 生产代码零引用；失败文案走 `novelTranslateStore.ts:841` 的 `error.partialFailed`，非本键 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:66 — `novelTranslate.status.failed` — 生产代码零引用 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:67 — `novelTranslate.status.completed` — 生产代码零引用 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:68 — `novelTranslate.status.aborted`「已取消」 — 生产代码零引用；`TranslateButton.vue:94` 只消费 store 的**值** `"aborted"`，与本文案键不可混为一谈 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:71 — `novelTranslate.status.progress.label`「进度 {{done}}/{{total}}」 — 生产代码零引用；store 进度事件链无该文案渲染点 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:72 — `novelTranslate.status.progress.remaining`「剩余 {{remaining}}」 — 生产代码零引用 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:99 — `novelTranslate.error.retrying`「重试中…」 — 生产代码零引用；store 状态机无「重试中」文案渲染点 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:100 — `novelTranslate.error.retryingFailed`「重试仍失败」 — 生产代码零引用 — 2 行
- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/novelTranslate.ts:101 — `novelTranslate.error.retryHint`「请稍后重试或检查 endpoint」 — 生产代码零引用 — 2 行

### C. me.title 1 键（家族内孤例）

- [死代码] packages/app-lynx/src/i18n/locales/zh-CN/pages.ts:250 — `me.title`「我的」 — 全仓零引用（`grep '["\`]me\.title'` 在 packages/ 下 0 命中）；同段 `me.bookmarks / watchlist / mypixiv / downloads / notifications / fullscreenMode / fullscreenModeDesc` 七兄弟**各恰有 1 处引用**，唯独本键为孤例，判为遗留在删掉的「我的」页签标题 — zh:250 + en:248 共 2 行

## 死测试 / 覆盖缺口

- [覆盖缺口] packages/app-lynx/tests/unit/i18n/novelTranslate.test.ts:16 — `EXPECTED_KEYS` 硬编码 50 键清单，头注释 `:15` 自称用作「键穷尽性校验」 — **自证式契约**：oracle 是从 spec §8 抄下来的常量列表，断言只验「字典里有这些键 + zh/en 对齐 + 值非空 + 占位符一致」，**完全不验证任何消费方**。结果：上列 15 个死键被此测试「护住」，在排查中伪装成活键 —— 与本次「测试护着的模块其实死的」是同类陷阱 — 若确认 15 键废弃，须同步删本清单 15 项，否则测试立即红
- [覆盖缺口] packages/app-lynx/tests/unit/i18nInterpolationGuard.test.ts:19 — 插值守门**硬编码范围限定**为 `AdvancedSettings.vue` 单文件（头注释 `:17-22` 自陈「只覆盖 AdvancedSettings.vue，扩到全仓前须先跑误报率」） — 本次真正的问题类别「字典键无生产消费方」**全仓零门禁**：734 键目前纯靠人工比对，`me.title` 这类家族孤例能长期存活即由此而来 — 建议补「字典键 ↔ 生产引用」双向守卫，实现时须把 `labelKey` 类间接表计入，否则误报 67 键

## 待确认（证据不足，不下结论）

- [死文档] packages/app-lynx/src/components/SeriesSheet.vue:60 — 注释称「本期新增 i18n key …… 新 key 尚未在 zh-CN/en 字典中注册，统一走 tt() 包装做 unknown-as 旁路」 — **与现状不符**：该文件三处 `tt()` 调用（`:96` `seriesSheet.loadFailed`、`:117` `seriesSheet.loadMoreFailed`、`:243` `seriesSheet.current`）所用键**均已注册**在 zh-CN/en 的 `misc.ts`，「旁路 / 缺 key 回退」注释已过时。待确认 `tt()` 本身（`SeriesSheet.vue:66-68`）是否已是可省的类型逃逸口 —— 未下结论，因删除需连带改三处调用点与 `template.test.ts`

---

## 分片 05-组件与常量死引用

# 05 分片：组件与常量死引用

范围：`packages/app-lynx/src/{components,pages,composables,primitives,utils,stores,api,services}` 的组件引用与导出常量/符号，以及 JS↔Java 原生契约键。双向验证判据：有读方无写方 / 有定义无引用 / 有 import 但无生产消费方。

## 先记否定的结论（避免下轮重复排查）

- **零死组件**：`packages/app-lynx/src/components/*.vue` 共 52 个，逐个枚举 import 站点（`from '...'` 与 PascalCase 标签两种形态），**全部**有生产引用。计数为 1 的 20 个（CarouselSkeleton / CarouselSwiper / CommentInputBar / CommentItem / GlassCard / NotificationChildren / NovelCaptionSheet / PagePickerSheet / RankingEntryCard / RecommendedCover / SearchSheet / SeriesSheet / SettingsEndpoint / SkeletonNovel / TagChipRow / TextSelectionToolbar / TranslateButton / TranslateModeSwitch / UgoiraViewer / WatchlistPromptDialog）各只有 1 个引用方，但那个引用方都是真实页面/组件文件，不是测试。
- **零死页面**：`pages/*.vue` 共 27 个，`router.ts` 路由表对每个都有 `component:` 绑定（`FollowList` 被 `/following`+`/followers` 复用，故 import 28 条对应 27 组件）。
- **web-core / loginPreview / errorPreview 按任务书排除**（活的 dev 预览目标）。
- **排除的假阳性**：`fabGeometry.ts` 的 `SPACING_UNIT_VW` / `FAB_MENU_PILL_VW` / `FAB_MENU_PANEL_HEIGHT_VW` / `FAB_BAND_LEFT_VW` / `FAB_BAND_RIGHT_VW`，`appearanceClasses.ts` 的 `DARK_CLASS`，`themeColor.ts` 的 `THEME_COLOR_OPTIONS`，`translationCache.ts` 的 `buildTranslationCacheKey` / `fnv1a32` / `computeBaseURLHash`，`heroTransition.ts` 的 `heroTransitionValue` / `HERO_HOLD_MS`，以及约 150 个「只被 .test.ts 引用」的导出 —— 逐个查了**本文件内部命中数**，全部 ≥2（定义 + 内部消费），属**过度导出**而非死代码，**不报**。

## 发现

- [死代码] packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java:316 — `exportDiagLog(String, Callback)` 原生方法（Java 自带文件落盘 + Android 分享面板实现）—— 全仓 JS/Vue 侧 **0 个调用点**（`grep -rn exportDiagLog` 在 `packages/app-lynx/src` 零命中，仅命中 Java 自身 3 处 + 一条 spec + 一条门禁锚点）。有写方（Java `@LynxMethod`）无读方（JS），典型死代码 —— ~29 行（315–343，含 Javadoc 5 行）+ 若删则 `DIAG_DIR` 常量亦成孤儿
- [死代码] packages/app-lynx/src/api/id.ts:70 — `toChapterId(raw): ChapterId` 工厂函数 —— 与同族 `toIllustId`(17 处调用) / `toNovelId`(13) / `toUserId`(12) / `toSeriesId`(18) 不同，**全仓 0 调用**；连带 `ChapterId` 类型（:45）与 `ChapterIdBrand`（:37）也只在本文件内出现，`api/novel.ts:9-10` 的 import 只取 `NovelId, SeriesId, UserId` —— 3 行函数 + 2 行类型/symbol 声明
- [死代码] packages/app-lynx/src/api/queryKeys.ts:108 — `invalidateKeys` 常量对象（illust/novel/user/watchlist 四个前缀）—— 文件头 :4 与 :106 两处注释都把它写成「项目内 invalidate 集中收口」的唯一入口，但**生产代码 0 引用**；更严重的是全仓生产代码里 `useQueryClient` 与 `invalidateQueries` **一次都没出现**（只在注释里），即该文件承诺的失效收口策略从未接线 —— 6 行
- [死代码] packages/app-lynx/src/api/queryKeys.ts:69 — `queryKeys.watchlist` 命名空间（`all` + `novel(page)`）—— `grep 'queryKeys\.\(watchlist\|settings\)'` 在非测试代码中 0 命中；追更数据走 store 自管（`watchlistStore.ts`），不经 vue-query —— 4 行
- [死代码] packages/app-lynx/src/api/queryKeys.ts:82 — `queryKeys.settings` 命名空间（`all` + `updateCheck()`）—— 同上，0 命中；更新检查走 `stores/updateStore.ts` 直连 `httpGet` —— 4 行
- [死代码] packages/app-lynx/src/api/queryKeys.ts:97 — `mutationKeys` 的 `novelWatchlist` / `userFollow` / `illustComment` / `novelComment` 四个工厂 —— 逐个查非测试代码均为 0 命中，实际只有 `illustBookmark` 与 `novelBookmark` 被用（各 1 处）—— 4 行
- [死代码] packages/app-lynx/src/utils/webdavCredentials.ts:98 — `clearBackupPassword()`（备份加密密码清除）—— 同族 `saveBackupPassword`(2 处) / `loadBackupPassword`(4 处) 都在用，唯 `clear` 这一半 **0 引用**（连测试都没有）；`clearWebdavPassword`(:87) 同样 0 生产引用但有 2 处测试引用，属「功能未接线」同族 —— 3 行（+ :87 3 行）
- [死代码] packages/app-lynx/src/utils/deliveryProbeLifecycle.ts:145 — `isLifecycleSubscribed(): boolean` —— 0 引用（连测试都没有）；同文件 `disposeDeliveryProbeLifecycle`(:150) 也只有 `stores/deliveryProbeContract.test.ts:568` 一处注释提及、无实调用点 —— 3 行（+ :150 约 12 行）
- [死测试] packages/android-host/tests/unit/webviewRemovalInvariants.test.ts:255 — 配对正面锚点 `{ method: "exportDiagLog", minHits: 1, owner: "通用：诊断日志导出" }` —— 断言体（:773-782）只对 `moduleText`（即 `PictelioAppModule.java` 单文件）做正则计数，**从不扫 JS 侧**，因此给一个零调用方的死方法盖了「通用能力必须保留」的假活章：删掉它测试仍绿，删光 JS 接线测试也绿 —— 1 行锚点（连带 :250-256 整组锚点设计缺少读侧对偶）
- [死文档] docs/specs/app-lynx-feed-pagination-and-watchlist-prompt-fix.md:71 — 「「我的」页新增「导出诊断日志」入口 → 原生 `PictelioApp.exportDiagLog`」—— 用祈使句描述一个**不存在的入口**：`Me.vue` 全文 `grep '诊断日志|diagLog|diag/|DiagLog'` 零命中，TS 侧也无 `exportDiagLog` 声明（`rspeedy-env.d.ts` 的 `PictelioApp` 接口没有这个方法）—— 1 行（该 spec 把未落地的桥当已定方案引用）
- [契约断链] docs/adr/ADR-0182-branded-types-for-api-ids.md:31 — 「D2 · 工厂函数边界：5 个工厂函数 `toIllustId / toNovelId / toUserId / toSeriesId / toChapterId`」—— 该 ADR 是**现行规范**（`docs/specs/branded-types-for-api-ids.md:46` 同款），但第 5 个工厂无任何转换点：`api/novel.ts` 的章节接口 `loadNovelSeriesChapters`(:146) 收 `SeriesId` + raw `lastOrder`，`NovelSeriesDetailResponse` 的章节 id 也未布 `ChapterId`。判据是「ADR 仍被当作约束引用而源码不满足」—— 需补 `ChapterId` 接线或新开 ADR 缩减工厂数

## 判断困难 / 待确认

- `queryKeys.watchlist` / `queryKeys.settings` / 4 个 `mutationKeys` 成员：判死依据是「当前无调用方」。若仓库约定「key 工厂先备全、用时再加」，则应归为**过度预置**而非废弃项 —— 我按任务书判据（有定义无引用 → 死）计，但这一条的**性质**取决于维护者意图，建议人工裁决。`invalidateKeys` 不受此影响：它连「备全」都谈不上，因为配套的 `useQueryClient` 在整个生产代码里根本不存在。
- `exportDiagLog`：需确认它是「计划中未落地」还是「落地后被摘」。Java 实现完整（含分享面板与目录创建），spec 也写了入口，但 Me.vue 无入口、TS 类型也无声明。若维护者认为诊断通道只是暂时收起（`T0-DIAG 临时通道` 字样暗示临时），判活更合适 —— 我按「生产路径无消费方 = 死」计入，但这条**最可能有反例**。
- `webdavCredentials.ts` 的两个 `clear*`：成对模式（save/load/clear）容易让 `clear` 显得「对称完整」而其实是未接线功能。我只按引用数判，未推断产品意图（如「退出 WebDAV 账号时清密码」这个入口是否存在）。
- 未越界检查：`docs/adr/**` 与 `docs/research/**` 的正文我只对「仍被当作现行约束且源码不满足」的情况报了 1 条（ADR-0182 D2），其余按 ADR-0201 决策 4 视为历史存档处理；`CapacitorStorage` 相关（`darkModeJavaContract` / `safeAreaJavaContract` 两组契约测试）逐条查过 Java 侧锚点全部真实存在，未报。

---

## 分片 06-契约键双向验证

# 06 · 契约键双向验证（TS ↔ Java 原生模块 / 存储键 / 全局事件）

双向验证范围与结果（方法级全量反查，非抽样）：
- 模块注册面：Java 注册 13 个（LynxRuntimeInitializer.java:73-87）+ LynxActivity.java:521-528 per-view 补 2 个（PictelioTranslate / PictelioTranslateCache），逐个在 TS 侧有读取方 —— **无「注册无消费」模块**。
- 方法面：Java 侧 14 个模块共 ~60 个 `@LynxMethod` 全量反查 TS 调用点，命中 3 处断链（下列）。
- 反向（TS 调 / Java 无实现）全量核对：0 处，无运行时静默失败面。
- 存储键面：`settings_dark_mode` / `settings_fullscreen_mode` / `settings_language` 三键 TS 写、Java 读（LynxActivity.java:86,68 / PictelioApiModule.java:66）双向闭合；`settings_theme_color` 为 JS 自用键，无 Java 对端属预期。
- 全局事件面：`pictelioInsets` / `pictelioDarkMode` / `pictelioBack` / `pictelioNotificationTarget` / `pictelioAppForeground|Background` / `pictelioTranslateFrame` 双向闭合；`pictelioBenchNav*` 24 个发射场景与 router.ts:456-501 TARGETS(19) + DYNAMIC_TARGETS(2) + IllustList.vue:236 / NovelList.vue:182 子 tab 监听(2) + 两个 payload 详情通道 全数配平 —— **benchNav 无孤儿键**。

---

- [死代码] `packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAppModule.java:316` — `@LynxMethod exportDiagLog(String, Callback)`：写文件到 `files/diag/` + 拉起系统分享面板的原生方法 — 唯一消费通道 `src/debug/t0Diag.ts` 与「我的」页「导出诊断日志」入口已随 ADR-0115 删除（`docs/adr/ADR-0115-app-lynx-recommended-carousel.md:30,32`），`packages/app-lynx/src/debug/` 目录现已不存在；全仓 `.ts/.vue` 对 `exportDiagLog` 零命中（`rspeedy-env.d.ts:97-148` 的 PictelioApp 声明也已正确清理掉它，只剩 Java 实现悬空） — Java 侧 ~28 行（315-341）+ 类头 javadoc 1 行（第 23 行），删后 `PictelioAppModule` 剩 9 个 `@LynxMethod`
- [契约断链] `packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioAuthModule.java:94` — `@LynxMethod setAccessToken(String)`：把 access_token push 进 Java 堆的备用入口，**声明在 TS 类型里但全仓零调用** — TS 内联类型只声明了另两个方法（`packages/app-lynx/src/stores/authStore.ts:49-52` 与 `:170-172` 各只列 `loginWithRefreshToken`/`clearTokens`）；`authStore.ts:175` 的 `setAccessToken("")` 是 `api/client.ts:41` 的 JS 模块级变量 setter（只写 `let accessToken`，从不碰原生）；Java 注释自述用途「JS 直登录（web 模式 OAuth 结果）」，而 web 模式根本没有原生模块，该路径物理不可达 — Java 4 行（92-96）+ `packages/app-lynx/src/rspeedy-env.d.ts:151` 一行类型声明
- [契约断链] `packages/android-host/android/app/src/lynx/java/io/pictelio/app/PictelioTranslateCacheModule.java:346` — `@LynxMethod getCacheDirPath(Callback)`：暴露 cacheDir 绝对路径的调试通道，**TS 侧声明于接口却从不调用** — Java 类头 javadoc 第 51 行自述「调试用：暴露 cacheDir 绝对路径」；`packages/app-lynx/src/utils/filesystemTranslationCache.ts:24` 在 `PictelioTranslateCacheModule` 接口里声明了该方法（注释还标了 arity 契约）但文件内零调用点；全仓除该接口声明外仅 `PictelioTranslateCacheModuleTest.java:517-520` 这个 Robolectric 单测调用，JS 生产路径无消费方 — Java 3 行（345-348）+ TS 接口 2 行（23-24）+ Java 单测 1 个方法
- [覆盖缺口] `packages/android-host/tests/unit/webviewRemovalInvariants.test.ts:255` — 把 `exportDiagLog` 列为「配对正面锚点」minHits:1 的断言 —— 该断言只对 `PictelioAppModule.java` 自身做 `public void exportDiagLog(` 正则计数（`:775` `moduleText.match(...)`），1 处命中恰好是方法自己的声明，**从不校验 JS 侧存在调用方** ⇒ 上面那条死代码无论删不删 JS 都恒绿，正是「有测试护着 ≠ 活」的实例 — 锚点表 1 行；若采纳删除建议须同步移除该行，否则闸门会挡住正确清理

---

## 分片 07-依赖脚本与CI覆盖

# 07 · 依赖脚本与 CI 覆盖（只读审计）

- [覆盖缺口] package.json:26 — `check:all` 的 filter 列表漏了 `@pictelio/android-host`，而该包有可跑通的 `check`（`tsc --noEmit -p tsconfig.json`，include = `vitest.config.ts` + `tests/android-e2e`）且根 `check:android-host`（package.json:21）存在；`.github/workflows/ci.yml:41` 的「Type check (all packages)」只跑 `check:all` ⇒ 原生 E2E 的 TypeScript 从不进类型门禁 — 宿主包在 `test:all`（package.json:42）里有、在 `check:all` 里没有，这个不对称无任何文档说明（AGENTS.md「门禁边界」称 CI 覆盖全部包）— 非删代码，`:1` 处补 `--filter @pictelio/android-host`（**待确认**：是否有意排除）
- [契约断链] docs/specs/app-lynx-recommended-carousel.md:107 — 把 `pnpm lint:app-lynx` 列为验收门禁命令，但根 `package.json` 无该脚本，实测 `Command "lint:app-lynx" not found`；ADR-0185 改根单配置源后所有 `lint:*` / `fmt:*` 变体被删（现存仅 dev/build/preview/check/test/kill/sync 七个 `:app-lynx` 别名），spec 未同步 — 同病另见 docs/specs/app-lynx-detail-multi-image-list.md:95、docs/specs/lynx-night-mode-audit.md:100，共 3 行
- [契约断链] packages/app-lynx/scripts/lynx-device-check.sh:18 — 步骤 1 经 `adb run-as` 往 `CapacitorStorage.xml` 写 `pictelio_client_kind=lynx`，但该键的 Java 写方 `EngineRouting.resolve` 已删（`packages/android-host/android/**` 全仓无 `EngineRouting`/`pictelio_client_kind`，只剩 `LynxRuntimeInitializer.java:123` 读编译期常量 `BuildConfig.CLIENT_KINDS = {"lynx"}`），TS 侧唯一读者 `engineState.ts:2` 已确认死 ⇒ 写一个无人读的键；同文件 :10 另有 `ANALYZE="node -e ''"  # placeholder` 死占位 — 约 10 行
- [死配置] .husky/pre-push:5 — 注释仍写「三域触碰校验：`packages/app/(src|tests/agent-browser)` → E2E 锚点静态校验」，但承载全部逻辑的 scripts/check-push-refs.mjs:28-30 已在 ADR-0203 移除该域、`DOMAINS` 只剩 app-lynx 与 .agents 两项（check-push-refs.mjs:31-52），且 `packages/app` 目录已不存在（`ls` 确认）⇒ 注释描述的机制早于实现即已下线 — 1 行注释
- [死配置] packages/app-lynx/scripts/check-app-lynx-anchors.mjs:9 — 注释称「锚点模式参考 `packages/app/scripts/check-e2e-anchors.mjs`」，该文件随 ADR-0203 整包删除，参考对象已不存在；同文件 :34-36 是「未来扩展」占位段（`当前简化：仅 tests 失败时拦截`，注释自陈未实现 commit-message 校验）— 约 4 行
- [死配置] .husky/pre-commit:3 — 全文 4 行只有 shebang 与注释、无任何命令，是空钩子；其注释指向 `.github/workflows/openwiki-update.yml`，该 workflow 不存在（`.github/workflows/` 实际只有 ci.yml / deploy.yml / sysbars-acceptance.yml），所指通道已按 docs/specs/openwiki-retirement.md 下线 ⇒ 空壳钩子仍占一个 pre-commit 触发点 — 整个文件（4 行）
- [死配置] package.json:14 — `dev:all` 过滤 `@pictelio/ugoira` 与 `@pictelio/novel-export`，但两包只有 `test`/`check`（ugoira 另有 `mutation`），无 `dev`；实测 `vp run` 对缺脚本的 filter 静默跳过（单 filter 时报 `error: Task "check" not found`，多 filter 时被忽略）⇒ 这两个 filter 恒空转 — 3 行 × 2 个 filter
- [死配置] package.json:18 — `build:all` 同样过滤 ugoira 与 novel-export，二者无 `build` 脚本（纯逻辑库，`main` 直指 `src/index.ts`）⇒ 2 个 filter 恒空转 — 同上
- [死配置] package.json:30 — `preview:all` 同样过滤 ugoira 与 novel-export，二者无 `preview` 脚本 ⇒ 2 个 filter 恒空转；另该脚本漏了同为库包的 update-check / net-diagnostics / search-core / ranking-core（后三者本无 preview，属正常）— 同上
- [死配置] package.json:26 — `check:all` 过滤 `pictelio-website`，而 website 只有 `dev`/`build`/`preview`（`packages/website/package.json`），无 `check` ⇒ 该 filter 恒空转，CI 的「all packages」实际少一个包 — 1 个 filter
- [死配置] package.json:42 — `test:all` 同样过滤 `pictelio-website`，无 `test` 脚本 ⇒ 恒空转 — 1 个 filter
- [死配置] packages/app-lynx/package.json:13 — `lint` / `fmt` 两个 echo 豁免桩（`lint: 'echo 暂豁免…'`）无人调用：ADR-0185 后根 `lint`/`fmt`（package.json:43、45）是根单进程 `pnpm vp lint` / `pnpm vp fmt`，不再按包 fan-out；实际豁免由 vite.config.ts:63 与 :191 的 `packages/app-lynx/**` ignorePatterns 承担 ⇒ 桩已不承载任何行为（**待确认**：是否作为显式豁免留痕有意保留）— 2 行
- [覆盖缺口] scripts/test-consistency.mjs:1 — 全仓无 package.json 脚本、无 CI 引用，唯一提及方是 docs/research/test-consistency-measurement-2026-10.md；脚本自身 :13-14 声明「退出码恒 0 —— 这是度量不是门禁」「要接进 CI 做趋势，需要另开决策」⇒ 判为未接线的手工度量工具而非死代码，但无任何调用入口（**待确认**）— 不删，改加一条 `pnpm` 脚本入口即可

## 判断困难 / 已排除（避免误报）

- `packages/app-lynx/scripts/test-lynx-web.sh` + `test:lynx-web`：web-core 是活的 dev 预览目标（`rspeedy dev` 提供 `__web_preview`），脚本锁的是 TDZ 白屏回归，不报。
- `scripts/capture-readme-shots.sh`：全仓除自引用外无引用，但产物目标是 README.md:18-22 实际引用的 `packages/website/public/screenshots/*.png`，且面向 Lynx 客户端（脚本头引 `LynxActivity.java:503` / `router.ts:449`），属活的维护脚本，不报。
- `scripts/generate-adr-index.mjs`：docs/adr/README.md:3 有「本文件由该脚本确定性生成，勿手改」锚，无 package.json 入口但契约在，不报。
- `release:android-host:transition`（package.json:52）：`PICTELIO_RELEASE_BRANCH` 在 release.mjs:19/144/633 与 scripts/lib/release-branch.mjs:7-14 有完整消费方，docs/release-checklist.md:187 有对应章节（#816），不报。
- `verify-agent-skills.mjs` / `check-push-refs.mjs`：均被 .husky/pre-push 经 DOMAINS 接线（check-push-refs.mjs:35、:45），有真实触发路径，不报。
- `scripts/audit-real-interaction/**`：被 vite.config.ts:57/189 显式排除于 lint/fmt，并被 6 份 research/spec 引用，不报。
- `packages/app-lynx/vitest.fallback.config.ts` 与 `src/utils/homeHeaderMode.fallback.test.ts`：名字里的 "fallback" 是 `__HOME_BLEED_HEADER__` 构建宏的回退阀（票 #906/#907、ADR-0216），与已确认死亡的引擎回退子系统无关，是活的逃生阀 CI 覆盖，不报。
- `packages/android-host/vitest.config.ts:17` 的双 include 与 `passWithNoTests: false`：有回归防线测试 `tests/unit/e2eContractSuiteCollected.test.ts` 逐个钉住，是刻意的门禁配置，不报。
- 未审：docs/adr/** 与 docs/research/** 的历史正文（ADR-0201 决策 4 存档）、webview 字样的其他分片范围。

---

## 分片 08-文档层现行规范

# 08 · 文档层现行规范 — 全项目废弃项排查

判据：只有被「现行事实源 / 活代码 anchor / 工作流格式」当作约束的陈述才算废弃项。
`docs/adr/**` 与 `docs/research/**` 的历史正文按 ADR-0201 决策 4 不动，本表不列。

## 契约断链（现行规范指向已不存在的符号/文件）

- [契约断链] AGENTS.md:131 — 「引擎决策（ADR-0164）… 硬规则 = 预热与路由**必须**共用 `EngineRouting.resolve`，禁止各自读键」 — `EngineRouting` Java 类已随 #610「引擎机制全链删除」删净：`grep -rn "EngineRouting" packages/android-host --include=*.java` 零命中，`find packages/android-host -type d -name engine` 空；删除事实见 `docs/specs/lynx-only-sandbox.md:48`（engine 包 7 类含 `EngineRouting` 全列）。AGENTS.md 是全仓最高现行规范、该条被列为「关键设计决策 / 违反视为架构违规」，现指向空符号 — 1 行
- [契约断链] packages/android-host/CONTEXT.md:17 — 「`LynxRuntimeInitializer` / `PictelioAppLynx` … 预热与路由**必须**共用 `EngineRouting.resolve`（ADR-0164）」 — 与 AGENTS.md:131 同源断言。两个类本身仍在（`packages/android-host/android/app/src/lynx/java/io/pictelio/app/`），但「可用性回退 / 共用 resolve」这半句是死约束；本文件是 `CONTEXT-MAP.md:8` 指定的 android-host 词汇层活入口 — 1 行
- [契约断链] packages/app-lynx/CONTEXT.md:28,47,271,274,277 — 5 处词条写「详见 / 语义见 `packages/app/CONTEXT.md`」 — 该文件随 ADR-0203 整包删除（`ls packages/app` = No such file）；同文件 :680、:716-718、:753-754 的同类引用都加了「原位置不再存在」旁注，这 5 处**漏加**，是活词条里的死指针 — 5 处
- [契约断链] packages/app-lynx/CONTEXT.md:274,277 — 词条正文仍写「实现在**双引擎共享的** Java 传输层」/「决策收敛在**双引擎共享的** Java 下载层，lynx 静态图与 ugoira zip 自动继承 **webview 侧配置**的图床（lynx 无设置 UI）」 — 双引擎与 webview 侧配置入口均已下线，"自动继承" 的上游已不存在（:789 同一词条又写一次「双引擎共享」） — 3 行
- [契约断链] docs/style-guides/ui-copy.md:56 — 「原型字典 `packages/app/src/i18n/locales/en.ts` / `packages/app-lynx/src/i18n/locales/en.ts` 已按本基线校正…作为基线的参考实现」 — 两个路径都不存在（前者随包删除；后者实为目录 `locales/en/index.ts`）。本文件是 `docs/specs/i18n.md:6` 声明的「配套规范」且 ADR-0157:31 要求 AI 翻译 prompt 注入它 ⇒ 活的约束文档引用了不可读的「参考实现」 — 1 行

## 死文档（描述已删机制，且仍以现行/可执行口径呈现）

- [死文档] docs/specs/engine-availability-fallback-tickets.md:1-12 — 「规则：每个 ticket 声明前置依赖；blocker 未完成不得开工。状态：`todo`/`doing`/`done`」，T0-T5 全部指向已删链路（`MainActivity` 降级分支、`full`/`webview` flavor、`EngineFallbackNotice.java`、`packages/app/tests/**` 契约测试） — T5 状态仍是 **`todo（需真机）`**，是全仓唯一以 AGENTS.md「to-tickets」可执行票据格式呈现的已下线机制文档；同族的 `engine-availability-fallback.md` / `engine-default-lynx-bidirectional-fallback.md` / `engine-switch-e2e-recovery.md` 均已加存档横幅，唯独它没有。全文件零入站引用 — 25 行（整文件）
- [死文档] docs/specs/qa-defense-lines.md:5 — 「分发事实：**不经 Play**（GitHub Releases APK + **webview OTA**）」 — webview OTA 通道已随 ADR-0202 下线，`docs/specs/ota-web-bundle.md:3-12` 已明写「已整体下线」。同 spec 的 T2 已按单引擎更新（:50 R4 删除、:78 覆盖面收窄）而头部未同步 — 1 行
- [死文档] docs/specs/qa-defense-lines.md:37-38 — T1「`docs/agents/qa-transition-checklist.md`（新文件）：发版前**双引擎**转换清单…头部注明每行源自真实缺陷，**发版前必过**」+「`docs/release-checklist.md`：追加…引用 qa-transition-checklist **全过**」 — `docs/release-checklist.md:218` 已判定该清单「不可执行、待 #805 重新定义」，`NOTES.md:83` 也已登记；本 spec 仍写「必过」⇒ 同一事实在两处现行文档里互相矛盾。本文件被 `NOTES.md` 三.2 指定为 transition-matrix 的「矩阵事实源」而该门是活的（`packages/android-host/tests/android-e2e/specs/transition-matrix.spec.ts`，AGENTS.md 列为发版前门） — 2 行
- [死文档] docs/specs/ranking.md:1 — 标题「Spec: 排行榜（插画榜；**双端：app webview + app-lynx**）」 — 本文件是 `CONTEXT-MAP.md:13` 指定的 ranking-core 词汇层入口、且是活代码的 spec anchor（`packages/ranking-core/src/date.ts:2`、`package.json:4`、4 个测试的 oracle 注释），读者会按「双端」理解现行设计 — 1 行
- [死文档] docs/specs/ranking.md:195,219 — §6.2「webview（pictelio-app）」整节 + §「webview 数据层」以已删包为对象描述接入与差异 — 同上，anchor 链上的现行 spec 保留了单数引擎之外的实施章节 — 约 8 行
- [死文档] docs/specs/ranking.md:242 — 「正式实现落地时，原型文件（`packages/app/src/components/home/RankingPrototype.tsx`、`packages/app-lynx/src/components/RankingPrototype.vue`）…**应一并移除**」 — 两个文件都已不存在，这是一条永不收敛的待办 — 1 行
- [死文档] docs/specs/network-self-check.md:27,49,64 — 用户故事「我拥有与 **webview** 完全一致的检查项与结论」+「新增 `packages/app/android/app/src/main/java/…netdiag/`」+「webview：新增 **Capacitor 插件 NetDiagPlugin**，在 `MainActivity` 注册」 — 包与 `MainActivity` 均已删；本文件是 `CONTEXT-MAP.md:14` 的 net-diagnostics 词汇层入口，也是活代码 anchor（`packages/app-lynx/src/router.ts:155,487`、`pages/NetworkCheck.vue:91`、`packages/android-host/tests/android-e2e/specs/lynx-network-check.spec.ts:2`） — 3 行
- [死文档] docs/specs/search-advanced-filters.md:1 — 标题「Spec: 搜索高级筛选（**双端：app webview + app-lynx**）」+ :154「§6.3 URL query 键表（**webview**）」整节 — 本文件是 `CONTEXT-MAP.md:12` 的 search-core 词汇层入口与测试 oracle（`packages/search-core/tests/cacheKey.test.ts:2`、`urlCodec.test.ts:2`）。注意 :152/:167 已有 2026-10-17 的「webview 消费方随 ADR-0203 删除」订正 ⇒ 该文件被**部分**更新过，标题与 §6.3 小节标题漏同步 — 2 处标题 + §6.3 约 13 行
- [死文档] packages/app-lynx/CONTEXT.md:297-298 — 「**不与 webview 互通**——webview **按计划弃用**」/ _Avoid_「与 webview 的 `theme` 键做同步/迁移（**弃用计划**，零互通）」 — webview 已于 v6.3.0 下线，不是「按计划」；把已发生的事实写成待定计划，会误导后续实现者以为仍有迁移窗口 — 2 行
- [死文档] packages/app-lynx/CONTEXT.md:332 — 「app-lynx 端从零搭建的 BYOK 翻译栈…；**webview 端翻译栈保持现状不动**（map Q3 完全从零；spec §2 Out of scope #1）」 — 被对照的一端已不存在，"保持现状不动" 的外延为空 — 1 行
- [死文档] packages/app-lynx/CONTEXT.md:561 — 「滚动流畅度」词条：「**对照基准 = webview 客户端**在同设备、同内容下的同指标；验收双轨 = 量化基线（帧指标采集）+ 真机主观验收」 — 作为词条定义的**验收基准来源已不可取样**，该词条定义的判定口径因此无参照 — 1 行
- [死文档] docs/spec/routing-migration.md:1 — 「Spec: 路由层从 TanStack Router 迁移到 **@solidjs/router**」 — 迁移对象是被删的 SolidJS WebView 客户端；当前唯一客户端路由是 vue-router（`packages/app-lynx/src/router.ts` → `routerCore.ts`）。`docs/spec/`（单数目录）下仅此一文件，零入站引用 — 206 行（整文件）

## 死文档（缺存档横幅的已下线 spec；本仓对同类文档有明确横幅惯例）

同族已加横幅者：`docs/specs/engine-availability-fallback.md:3`、`engine-default-lynx-bidirectional-fallback.md:3`、`engine-switch-e2e-recovery.md:3`、`ota-web-bundle.md:3`、`webview-client-removal.md`、`docs/platform-compatibility.md:3`、`docs/image-loading-pipeline.md:3` 等。下列文件正文对象（`packages/app`、SolidJS 组件、CAP webview 引擎）**全部已删**，却无横幅、无状态标注为历史，入站引用为零（solidjs2 两份仅互引）。

- [死文档] docs/specs/webview-perf-round2.md:1 — 「webview 性能二轮 spec」+ :73 交付物指向 `packages/app/tests/**` — 79 行（整文件）
- [死文档] docs/specs/webview-perf-round4.md:1 — 「Spec：webview 性能四轮」+ 交付物 `packages/app/src/primitives/createProgressiveImage.ts` — 96 行（整文件）
- [死文档] docs/specs/webview-boot-freeze-722.md:1 — 「Spec: webview 引擎已登录启动冻结（#722）」，状态标 Fixed 但描述的是已删引擎的启动路径 — 119 行（整文件）
- [死文档] docs/specs/solidjs2-strict-warnings-cleanup.md:1 — 「SolidJS 2 严格模式警告清理（…**Capacitor** web 噪音）」，D1-D3 交付物全在 `packages/app/src/components/**` — 237 行（整文件）
- [死文档] docs/specs/solidjs2-strict-read-untracked-cleanup.md:1 — 「SolidJS 2 STRICT_READ_UNTRACKED 清零」，断言面为 `imageHostStore.ts` / `SideNavShell.tsx` / `AdaptiveTags.tsx` 等已删文件 — 202 行（整文件）
- [死文档] docs/specs/lynx-only-sandbox.md:1 — 「Lynx 单引擎沙盒规范（去 Capacitor 化）」，零入站引用；内容主要是 #610 删除清单 — 121 行（整文件） — **待确认**：它是 #609 丢失 spec 的重建版，是否按历史记录保留需维护者定

## 待确认（已登记跟踪，不建议重复计入）

- [待确认] docs/agents/qa-transition-checklist.md:1 — 标题「发版前 QA 转换清单（**双引擎转换矩阵** · 手工版）」、R4 整节以 webview 为基线 — 但 `NOTES.md:77,83` 与 `docs/release-checklist.md:218` 均已显式登记「整份待 #805 重新定义、重新定义前视为未设防」⇒ 属**已知跟踪中的未竟项**，不是未登记的废弃项。同理 `docs/release-checklist.md:218,221` 两条自述属主动标注，不计

---

## 分片 09-构建宏与环境变量

# 分片 09：构建宏与环境变量

> 只读审计。判定要求双向验证（写方+读方）。以下每条均已用 grep/read 实证。

- [契约断链] packages/android-host/android/app/build.gradle:37 — `buildConfigField "String[]", "CLIENT_KINDS", '{"lynx"}'`，注释（:35-36）声称「机制与消费方一律保留」，但消费方已随引擎回退子系统消失 — 唯一 Java 读点是 `LynxRuntimeInitializer.java:125` `for (String kind : BuildConfig.CLIENT_KINDS)`，只被同文件 `:105 isAvailable(Application)` 调用；而 `isAvailable` 在全包内**零生产调用方**（`PictelioImageService.java:265` 是同名无关方法，`:20` 只是 javadoc `{@link}`），单测 `LynxRuntimeInitializerTest` 只覆盖 `InitGate` 不覆盖它。它原本服务的 `io.pictelio.app.engine` 包（EngineRouting/EngineProbe/EnginePrefs/EngineRoute，ADR-0164）在源码树中已不存在（仅 `tests/android-e2e/prefs.ts:15-16` 注释确认「已不存在」）。build.gradle:34「CLIENT_KINDS[0] 是 Java 侧缺省引擎的单一事实来源」亦随之失效（全仓无 `[0]` 下标读点） — 可删规模：buildConfigField 1 行 + 注释 2 行 + Java 约 26 行（`isAvailable` 105-120 + `clientKindsContainLynx` 123-130）+ javadoc 92-104

- [契约断链] packages/android-host/android/app/build.gradle:29 — `buildConfigField "String", "OTA_ED25519_PUBLIC_KEY_B64"`，已生成进 BuildConfig.java（build/generated/.../BuildConfig.java:15 可实证），但**全仓零 Java 读点**（对 `app/src/` grep OTA_ED25519 返回空），且不存在任何 OTA/Ed25519 实现类 — 该字段服务的是「OTA web bundle 验签」，而 web bundle 只是已删 WebView 客户端的产物形态；ADR-0203 后该需求主体消失，仅余 build.gradle:3-9 的常量 + 长度校验与 :29 的字段注入。旁证：`app/src/main/java/io/pictelio/app/delivery/` 是**空且 git 未跟踪**的目录（OTA 代码删除后的残留，git 不跟踪空目录故非仓内文件） — 可删规模：约 9 行（build.gradle 3-9 + 29）

- [死配置] packages/android-host/scripts/lib/release-utils.mjs:59 — `PICTELIO_RELEASE_VARIANTS` 环境变量：**只有读方无写方**（无任何脚本设置它，`docs/` 全仓零提及，全仓仅命中本文件 :39 与 :59 两行）— 且结构上已失效：白名单 `RELEASE_BUILD_TYPES = ["release"]`（:35）是单元素集，`:71` 的白名单校验使唯一合法值恒等于缺省 `DEFAULT_VARIANTS`（:42），`--variants` CLI（:57）同理。多变体选择机制在 #610 删除 productFlavors 后塌缩为常量；:38-41 注释自陈是为「不破坏既有语义」而保留 — 可删规模：`resolveVariants` 约 22 行（:55-76）+ `DEFAULT_VARIANTS` 1 行（:42，`:35` 仍被 gradle task 拼法消费须留）

- [死代码] packages/android-host/tests/android-e2e/env.ts:83 — `mainActivityFor()` 的 `full`/`webview` 分支（:83-84，返回已随 WebView 客户端删除的 `MainActivity`/`MainActivityWebview`）生产不可达 — `env.ts:65-72` 在 `E2E_FLAVOR !== "single"` 时**直接 throw**，而 `MAIN_ACTIVITY = mainActivityFor(E2E_FLAVOR, ...)`（:93）在该 throw **之后**求值，故该函数生产只可能收到 `"single"`。同因死掉的还有 `ENTRY_ACTIVITIES`（:100-101）的 `[MAIN_ACTIVITY, LYNX_ACTIVITY]` 分支 — 可删规模：生产约 4 行（:83-84、:101 的 else 臂）

- [死测试] packages/android-host/tests/android-e2e/unit/env.flavor.test.ts:70 — `mainActivityFor` 的 `full`/`webview` 断言（:70-73）与 :77 的 full 对照，是**唯一**让上条死代码「看起来活着」的护栏（同 :50-57 的 `apkRelativePath` full/webview 断言仍有效，因 :69 报错文案会真实调用它） — 生产路径不可达的分支被单测钉住，属本次排查点名的「测试护着的模块其实是死的」形态 — 可删规模：约 8 行（:70-73、:77）

- [死文档] docs/release-checklist.md:191 — 非 main 分支发布命令写作 `PICTELIO_RELEASE_BRANCH=release/transition-6.2.0 pnpm run release` — 根 `package.json` **没有 `release` 脚本**（实测 `release -> ABSENT`，只有 `release:android-host` 与 `release:android-host:transition`），该命令一执行即 Missing script。发布 checklist 是被当作现行规范引用的操作文档（AGENTS.md「部署」节指向 docs/release-checklist.md） — 可删规模：1 行命令 + 建议改为 `pnpm release:android-host`

- [死文档] packages/app-lynx/CONTEXT.md:42 — benchNav 词条把生产消除门禁写成「前端 `if (__DEV__)`（生产构建死代码消除，同 auth.ts 凭证范式）」 — 实际代码是 `src/router.ts:450` `if (!__BENCH_NAV__) return`；且 `lynx.config.ts:114-116` 明确说明 `__BENCH_NAV__` 之所以独立存在，正因为 `__DEV__` 在 debug APK 上恒 false 会误杀钩子（`src/utils/debugBuild.ts:3-6` 同一论证）。CONTEXT.md 是 AGENTS.md「四层词」的地图层事实源且被当作现行导航依据，故此处指错宏会误导后续维护 — 可删规模：1 处括注改写（`if (__DEV__)` → `if (!__BENCH_NAV__)`）

- [死配置] package.json:52 — `release:android-host:transition` 固定 `PICTELIO_RELEASE_BRANCH=release/transition-6.2.0`【待确认】 — 在 main 上**永远无法成功**：`release-branch.mjs:22-30 assertOnReleaseBranch` 要求当前分支必须就是 `release/transition-6.2.0`，而一旦切到该分支，git 取回的是**该分支自己的 package.json**，用不到 main 这条脚本。但 `release/transition-6.2.0` 分支本地与 origin 均仍存在（`git branch -a` 实证），过渡分支发版路径可能是有意保留的，故不判死 — 可删规模：1 行（需先确认过渡分支是否仍需独立发版通道）

## 已实证存活，勿误报（本分片核对过）

- 七个构建宏**全部**有写方（`lynx.config.ts:108-131` + `src/rspeedy-env.d.ts:5-50` 类型声明）与活的生产读方：`__CREDENTIALS__`→`api/auth.ts:42`；`__PUBLIC_CONFIG__`→`api/userAgent.ts:2-6`；`__APP_VERSION__`→`stores/updateStore.ts:103`/`pages/UpdatePage.vue:24`/`services/backupWiring.ts` 的 `createLynxBackupDeps()` 内 `appVersion:`/`pages/NetworkCheck.vue:54`；`__DEV__`→`App.vue:52`/`api/auth.ts:39`；`__DISABLE_UPDATE_CHECK__`→`stores/updateStore.ts:23`；`__BENCH_NAV__`→`router.ts:450`、`IllustList.vue:232`、`NovelList.vue:178`；`__HOME_BLEED_HEADER__`→`router.ts:107`、`pages/Recommended.vue:59`。无一死宏。
- `homeBleedHeaderFlag.ts` 被 `lynx.config.ts:9` import，活。
- `vitest.fallback.config.ts` 名字有歧义但**活**：它属首页顶栏回退阀（#906/#907/ADR-0216），与已删的引擎回退子系统无关；`include: ['src/**/*.fallback.test.ts']` 实有 1 个文件 `src/utils/homeHeaderMode.fallback.test.ts`。
- `android-e2e/specs/lynx-network-check.spec.ts:22` 的 `process.env.BENCH_NAV = "1"` **有效**（易误判为死代码）：链路为 spec → `build-install.ts:38` `env: cleanEnv()`（`env.ts:157` 展开 process.env，继承 BENCH_NAV）→ `pnpm run build:android-host` → `packages/android-host/package.json` 的 `build:android` 内含 `NODE_ENV=production pnpm --dir ../app-lynx run build` → rspeedy 读 `lynx.config.ts:117`。`__BENCH_NAV__` 不依赖 NODE_ENV，故 debug APK 亦生效。
- `packages/app-lynx/.env` 被 gitignore（`.gitignore:49`）且 `git ls-files` 未跟踪 ⇒ 非仓内文件，不作废弃项。其 `PICTELIO_AI_{BASE_URL,API_KEY,MODEL,PROTOCOL}` 四键确有读方（`android-host/scripts/lib/release-notes-ai.mjs:34-37`，文档 `docs/release-checklist.md:177-180`），活。
- `PICTELIO_KEYSTORE_PASSWORD` / `PICTELIO_KEY_PASSWORD`：读于 `app/build.gradle:76,78,138,139` 与 `android-host/scripts/release.mjs:757-758`，活。
- `ANDROID_E2E_FLAVOR` 本身是**故意的毒丸守卫**（`env.ts:54-72` 显式设计为「配置写错就炸而非静默 skip」，:107-122 有反事实单测），故环境变量活；死的只是它派生的 full/webview 映射臂。

---

## 分片 10-死测试盘点

# 分片 10 — 死测试盘点

判定口径：生产路径无消费方，且双向验证（无写入方/注册方；有 import 或有测试护着不算判活）。
工具路由：CodeGraph（explore 符号调用链与 blast radius）+ Grep（契约键字面量跨语言比对）+ 自建索引脚本（366 个测试文件的相对 import 反向索引，已剔除 test helper / 包 barrel 假阳性）。

## 一、引擎回退子系统（Java 写方已删）——3 个测试文件

先例复核结论：`packages/android-host/` 内 `EngineRouting|EnginePrefs|EngineFallbackNotice|EngineRoute` 命中数为 0；两个契约键 `pictelio_engine_state` / `pictelio_engine_fallback_notice` 全仓只出现在 TS 侧定义与测试里，无任何 Java/TS 生产写入方。

- [死测试] packages/app-lynx/src/utils/engineState.test.ts:30 — 导入 `parseEngineState`/`readEngineState`/`REASON_I18N_KEYS` 等 210 行断言 — 被测模块 `engineState.ts` 的唯一引用方就是本测试（全仓 `from './engineState'` 命中仅此一处），生产侧无任何消费者；其契约注释声称的 Java 写方 `EngineRoute.snapshotLine` 已随 ADR-0203 下线 — 可删 210 行（测试）+ 138 行（模块，另计死代码分片）
- [死测试] packages/app-lynx/src/utils/engineFallbackNotice.test.ts:25 — 导入 `consumeEngineFallbackNotice`/`ENGINE_FALLBACK_NOTICE_KEY` 的 98 行断言 — 被测模块唯一消费方是 `engineFallbackStore.ts:8`，而该 store 只被 `App.vue:126/297` 调用去读一个**无人写入**的键；Java 侧 `EngineFallbackNotice.KEY` 写方已删，dev 路径 `idbGet` 无人播种 — 可删 98 行
- [死测试] packages/app-lynx/src/stores/settingsStore.test.ts:1622 — describe「settingsStore 引擎设备事实键备份域排除（ADR-0164）」共 3 个 it（1661/1667/1674，止于 1686） — 守卫 `ENGINE_FACT_KEYS` 五个键不进备份域，但其中 4 个（`pictelio_engine_state`/`pictelio_engine_lynx_failure_version`/`pictelio_debug_force_lynx_unavailable`/`pictelio_engine_fallback_notice`）**全仓唯一出现处就是本测试的常量数组**，无任何写入方，断言的是一个永不成立的不变量 — 可删 65 行（仅该 describe 块，同文件其余 2400 余行仍活）
- [契约断链] packages/app-lynx/src/stores/settingsStore.test.ts:1624 — `ENGINE_FACT_KEYS` 五键常量数组 — 只读方：备份域白名单断言；零写入方（全仓 grep 无 Java/TS 生产写入），ADR-0164 spec §3 所依据的 Java `EnginePrefs.KEY_*` 源已不存在，注释「键字面量 oracle = Java EnginePrefs.KEY_*（已核对引擎源码）」已失效 — 可删 5 个常量（随上条 describe 一并删）

## 二、ADR-0203 / ADR-0141 迁移后遗留的孤儿模块及其测试

- [死测试] packages/app-lynx/src/primitives/createBookmarkToggle.test.ts:4 — 导入 `createBookmarkToggle`/`BOOKMARK_ANIMATION_MS` 的 115 行断言 — 模块已被 `useBookmarkMutation` composable 取代：`components/BookmarkButton.vue:12` 自述「T4 迁移（ADR-0141）：状态机从 primitives/createBookmarkToggle 改为 composable」、`composables/useBookmarkMutation.ts:3` 自述「替代 createBookmarkToggle primitive」；`createBookmarkToggle.ts` 在全仓非测试代码中已无 import，仅余他人注释里的「同 createBookmarkToggle 风格」类比引用 — 可删 115 行（测试）+ 87 行（模块，另计）
- [死测试] packages/app-lynx/src/utils/gallerySaver.test.ts:6 — 导入 `gallerySaveAvailable`/`saveImageToGallery` 的 115 行断言 — 两个导出函数全仓非测试引用数为 0；保存链已改走 `buildImageTasks`/`buildUgoiraTask`（`pages/IllustDetail.vue:31`）+ `lynxDownloadExecutor` 原生下载队列，`galleryDownload.ts:291` 的 `saveOne` 形参从未被绑定到 `saveImageToGallery` — 可删 115 行（测试）+ 78 行（模块，另计）
- [死测试] packages/app-lynx/src/utils/deliveryProbeReport.test.ts:8 — 导入 `buildProbeReport`/`rateText` 的 198 行断言 — 两个导出全仓非测试引用数为 0；投递探测器**特性本身仍活**（`deliveryProbeLanding.ts` 挂在 `router.ts`、`deliveryProbeStore/Trigger/Lifecycle` 均在用），只是报告格式化器这一层从未接上 UI — 可删 198 行（测试）+ 105 行（模块，另计）
- [死测试] packages/app-lynx/tests/unit.test.ts:505 — describe「proxyRedact.redactProxyUrl（代理凭据脱敏）」（约 505-542 行，8 个断言 + 配套 import 于 :10） — 被测模块 `proxyRedact.ts` 导出 `redactProxyUrl` 非测试引用数为 0；解析能力已迁入 `utils/safeParseUrl.ts`（其 :6 注释自述「迁移前本函数的『唯一』指 lynx 新代码面」），该模块是 WebView 期代理配置面（带 user:pass 凭据）的遗留 — 可删约 38 行（该 describe 块）+ 31 行（模块，另计）；同文件其余 describe 仍活
- [死测试] packages/app-lynx/src/utils/galleryBridgeContract.test.ts:78 — 单个 it「TS 适配器：dir 缺省空串走 saveImage；非空走 saveImageTo 四参透传」（读 `gallerySaver.ts` 源文本做 4 条 `toContain`） — 它守卫的 TS 适配器本身无人调用（同上条），断言的是一个不会被执行的分派形态；同文件 ①/③/⑤ 段（57/86/98 行起）守卫的是活的 Java `PictelioGalleryModule`/`GallerySaver`/`PictelioDownloaderModule`，不可一并删 — 可删 7 行（仅 78-84 的 it）

## 三、门禁覆盖缺口

- [覆盖缺口] packages/app-lynx/tests/noDeadKeys.test.ts:32 — i18n 死键门禁 `MISC_FILES` 只列 `zh-CN/misc.ts` + `en/misc.ts` 两个文件 — 死键实际落在 `pages.ts`：`locales/zh-CN/pages.ts:324-334` 与 `locales/en/pages.ts` 各 11 个 `engineFallback.reason.*` 键，`.vue` 中零个 `t()` 读点（唯一活的同族键是 `App.vue:303` 读的 `engineFallback.legacyBanner`），其唯一「读者」是已死的 `engineState.ts:47-59` 映射表 —— 门禁扫不到这两个文件，死键因此长期绿灯通过 — 扩 `MISC_FILES` 至 `pages.ts` 后现有 11×2 键转红
- [覆盖缺口] packages/app-lynx/src/utils/safeParseUrl.test.ts:136 — 迁移守卫 `it.each` 里含 `['./proxyRedact.ts', 'redactProxyUrl']` 一行，以 `readFileSync` 读源文件断言无裸 `new URL(` — 该行把一个死模块路径硬编进一个**活**测试的 `it.each` 参数表：删除 `proxyRedact.ts` 会让本用例 ENOENT 抛错变红，即死模块与活门禁形成删除耦合；改造前需同步摘掉该行 — 1 行连带修改

## 未判死（已逐一排除，防误报）

- `packages/app-lynx/src/utils/homeHeaderMode.fallback.test.ts` — 文件名带 fallback，但验的是 ADR-0216 §2.1 的 `meta.topInset` 让位口径回退阀，顶部注释已自订正票 #920 的旧标题；`vitest.fallback.config.ts` 是活配置 → 活
- `packages/android-host/tests/unit/scripts/release-retired-flags.test.ts` — 守卫「已退役 CLI 参数必须显式拒绝」（ADR-0202 `--web-only`），是**否定式**守门，越是不该有 flag 越要留着 → 活
- `packages/android-host/tests/android-e2e/**` 全部 spec/unit — ADR-0084 手动发布门，不进 CI 仍是活门禁（题面已确认）→ 活
- `packages/app-lynx/tests/router-shim-integration.test.ts` / `vue-router-shim.test.ts` — 两者 import 的 `src/routerCore.ts` 有生产消费方（不在孤儿文件清单内）→ 活
- `packages/app-lynx/tests/unit.test.ts` 以外的全部 `*.test.ts` 中出现的「孤儿依赖」，经核为 `tests/helpers/*`、`tests/contract/shared*`、`android-e2e/prefs.ts|pixel.ts|helpers.ts` 等**测试基建**及 `src/index.ts` 等**包 barrel**（经 package name 消费）→ 假阳性，不计

## 判断困难（需人工拍板）

1. **`galleryBridgeContract.test.ts` 只切一个 it 还是整个文件**：② 段随 `gallerySaver.ts` 一起死，但同文件 ①/③/⑤ 段守卫的 Java 深模块仍在被原生下载队列调用。若只删 ②，需人工确认不会让「TS↔Java dir 透传一致性」失去最后一层防线（当前该层已是死对死）。
2. **`proxyRedact.ts` 是否属于 CapacitorStorage 例外范畴**：它是纯函数脱敏工具、不含存量用户数据格式，字面看不适用 AGENTS.md 的 `CapacitorStorage` 豁免；但它服务于「代理配置」这一 WebView 期特性，删除需确认 dev web 预览面（`rspeedy dev`，题面已确认是活目标）没有通过 `lynx.config.ts:74` 之外的路径间接依赖它。`lynx.config.ts:74` 只是注释里说「逻辑一致」，不是 import，已核实无引用。
3. **`engineState.ts` 的 11 个 `engineFallback.reason.*` i18n 键归属分片**：本分片按「死测试」报了门禁缺口（`noDeadKeys` 扫不到 pages.ts），但字典条目本身的删除属死配置，建议交由死配置分片处理，避免同一批文件被两个分片重复主张。
4. **`createBookmarkToggle.ts` / `gallerySaver.ts` / `deliveryProbeReport.ts` 三个模块本体**：按本分片纪律只主张其测试为死；模块本体删除请与死代码分片对齐边界（本次已核实三者非测试引用数均为 0，双向验证已完成，可直接采信）。
