# ADR-0200：app-lynx 标签翻译语言头——Accept-Language 跟随 UI 语言，原生通道 Java 侧解析

- 状态：Accepted（已采纳）
- 日期：2026-09-28
- 关联：[glossary-lynx-accept-language.md](./glossary-lynx-accept-language.md)（术语表）、ADR-0197（D10 标签邻居用原名检索——本 ADR 修复其根因后可复验）、ADR-0103（设备级设置键 / `prefs()` seam）、ADR-0199（app-lynx 限流退避——同为 client 传输层 effort，通道边界口径同源）、spec `docs/specs/lynx-accept-language-header.md`
- 输入材料：竞品源码级调研（2026-09-28）：[pixez-flutter `api_client.dart`](https://github.com/Notsfsssf/pixez-flutter/blob/master/lib/network/api_client.dart)（全局 `Accept-Language: zh-CN` 默认头）、[Pixiv-Shaft `LanguageHelper.java`](https://github.com/CeuiLiSA/Pixiv-Shaft/blob/master/app/src/main/java/ceui/lisa/helper/LanguageHelper.java)（内容语言设置→头值映射）、[Pixeval.Extensions.Translators](https://github.com/Pixeval/Pixeval.Extensions.Translators)（扩展机器翻译）、[go-pixiv](https://pkg.go.dev/github.com/WOo0W/go-pixiv/pixiv)（文档明示 Accept-Language 决定 tag 翻译语言）、[pixiv Crowdin 众包翻译公告](https://www.pixiv.net/info.php?id=5577)

## 背景

app-lynx 的标签显示只透传 Pixiv API 返回的 `tags[].translated_name`，缺失即回落日文原名（`utils/tagChips.ts:38` 的 `translated_name || name` 显式契约）。而请求侧**全端从不携带任何语言请求头**：原生通道 Java `PixivApiCore.executeRequest` 只发 Authorization / Referer / User-Agent；web 通道 TS `execute()` 同样只有 UA / Referer / Authorization。App API 无语言头时按默认语言返回，`translated_name` 大面积为 `null`——代码注释自证（`collectTagNeighbors.ts:188`「实测大量为 null」），且已倒逼出下游妥协：ADR-0197 D10 标签邻居检索被迫用日文原名、静音标签不匹配译名（`settingsStore.ts:871`）。

竞品对照：Pixez 每个请求带 `Accept-Language: zh-CN` 静态默认头，pixiv Crowdin 众包翻译（2021 起）直接全部生效，热门标签中文覆盖率很高；Pixiv-Shaft 提供「内容语言」设置映射为同名头；Pixeval 在 API 译名之外做扩展机器翻译。三者共同点：**都把「激活官方译文」当作底线，而 Pictelio 缺的恰是这一步**——补语言头是改动最小、收益最大的一层。

## 决策

**D1 头与取值 = `Accept-Language`，值跟随 lynx UI 语言设置，解析为纯函数。**
头名选 `Accept-Language`（第三方生态主流实证：Pixez / Pixiv-Shaft / go-pixiv 均用之；`X-User-Lang` 是官方新版 App 头，生态验证面窄，不选）。解析规则（语言头解析，术语表口径）：

| `settings_language` 存储值 | 头值 | 依据 |
|---|---|---|
| `"en"` | `en` | 用户显式选英文 |
| `"zh-CN"` | `zh-CN` | 用户显式选中文 |
| `""`（跟随系统）/ null / 非法值 | `zh-CN` | 真机 LynxView 无 `navigator`，`detectSystemLocale()` 实际落 `zh-CN`——头值与**真机 UI 实际生效语言**保持一致（见 R1） |

lynx 支持语言仅 `zh-CN` / `en`（`i18n/index.ts` `SUPPORTED_LOCALES`），头值域随之收敛为两值，不做 Pixiv-Shaft 式六语言设置项（无 UI、无新设置键——语言已有设置，内容语言不另立）。

**D2 原生通道落点 = Java 侧解析，零桥签名变更。**
`PictelioApiModule.request`（lynx 专属，`src/lynx/java/`）在 worker 线程内读 `settings_language`（复用同包 `PictelioPrefsModule.get(ctx, key)` 静态纯核心），经解析函数得头值，传给 `PixivApiCore.executeRequest` 的新增**可空参重载**；`null` = 不加头。现有 5 参签名保留并委托新重载——webview 调用点（`PixivApiPlugin`）一字不动、行为零变化。

*为什么不从 JS 经桥传头值*：OTA 分发下 JS bundle 与 APK Java 代码存在版本偏斜。桥加参数 = 新 JS + 旧 APK 时 `@LynxMethod` 参数失配 → **全部 API 请求失败**（灾难面）；Java 读 prefs 则双向兼容（旧 JS + 新 APK / 新 JS + 旧 APK 均正常）。prefs 读在 `API_EXECUTOR` worker 线程内、每请求一次（SharedPreferences 首载后内存读，无主线程代价）。OAuth token 交换端点（`PictelioAuth`）不加——无标签/内容语言语义，不扩散。

**D3 web 通道落点 = TS headers 注入 `locale.value`。**
dev web-core 预览的 `execute()` / `executeRaw()` web 分支 headers 增加 `"Accept-Language": locale.value`（`"zh-CN" | "en"`，即合法 BCP-47 语言标签；i18n 模块 `locale` ref 是生效语言的唯一事实源——`settingsStore.setLanguage` 已单向同步它）。Vite 代理转发该头到 Pixiv。web 分支与原生分支行为对齐（双通道一致性，同 ADR-0199 D1 口径）。

**D4 范围边界 = 仅 app-lynx。**
webview（`packages/app`）不动——其 TS / Capacitor 插件 / `PixivApiPlugin` 调用点全部维持现状，双端行为不对称是有意结构边界（同 ADR-0199 D6）。标签机器翻译兜底（Pixeval 模式）与本地词典回落不做——官方译名覆盖见顶后另行立项。

**D5 失败语义 = 解析永不让请求失败；异常显式留痕。**
prefs 读失败 / Context 不可用 → 头值回落 `zh-CN` + `Log.w`（禁静默降级，测试硬约束 #3）；语言头不改变任何错误处理路径（429 退避 ADR-0199、401 刷新重放正交不受影响）。locale 运行时切换（web 通道）后**新请求**即带新值，在飞请求不受影响（headers 请求构造时快照）。

**D6 测试防线。**
Java：解析函数抽为包私有静态纯函数 `resolveAcceptLanguage(String stored)`，JVM 直测五分支（`en` / `zh-CN` / `""` / null / 非法值）；`PixivApiCore` 重载委托与头附加经 Robolectric + MockWebServer 断言请求头（延续 `TranslationSseParserTest` 的 JVM 测试姿态）。TS：`client.test.ts` 增 web 通道双函数（`execute` 经 `apiClient.get`、`executeRaw` 经 `apiClient.requestRaw`）头断言 + `setLocale("en")` 切换断言（延续既有 `expect.objectContaining` 范式）。契约测试口径（测试硬约束 #4）：头值映射表以本 ADR D1 为 oracle。

## 风险与边界

| # | 风险 | 处置 |
|---|------|------|
| R1 | 真机「跟随系统」在 TS 与 Java 两侧解析分歧（TS 无 `navigator` 落 zh-CN；Java 若读 `Locale.getDefault` 可能得 en） | 两侧统一以「真机 UI 实际生效语言」为准：都落 `zh-CN`。系统语言注入本就是未实施的 spec 项（`i18n/index.ts:17`），若未来落地，语言头解析同批复验 |
| R2 | 加语言头改变非标签端点行为（搜索排序 / 推荐 feed 语言等） | 有意收益的一部分（搜索词联想、榜单标题随内容语言本地化）；Pixez 全局头多年生产实证无负效应 |
| R3 | 双端行为分叉（lynx 中文标签、webview 日文标签） | 有意的结构边界（D4，同 ADR-0199 D6 先例）；webview 侧补齐留独立立项 |
| R4 | OTA 版本偏斜下桥契约破坏 | 结构性规避：零桥签名变更（D2），语言经 prefs 跨层，新旧版本任意组合可用 |
| R5 | 每请求 prefs 读开销 | SharedPreferences 首载后内存映射读，worker 线程内纳秒级；不作缓存（避免语言切换后的缓存失效问题） |

## Future work

- webview 端补同款语言头（独立立项）
- 标签本地词典回落 / LLM 批量机翻（复用 ADR-0169~0178 基建；官方译名覆盖见顶后再议）
- 系统语言经原生桥注入（`i18n` 既有 spec 项），落地时同步复验 D1 解析表
