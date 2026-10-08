# 领域外应用 i18n 实践调研（为 Pictelio 国际化立项提供参照）

**研究问题**：Pixiv 客户端领域之外的应用（桌面/移动/混合封装、独立团队 OSS 项目）是如何实现国际化的？有哪些可直接借鉴到 Pictelio（SolidJS SPA + Capacitor Android + vue-lynx 双引擎）的结论？

**研究日期**：2026-09
**研究方法**：仅网页调研，优先一手来源（官方文档、项目仓库、平台配置），其次社区一手讨论；每条结论附引用 URL。
**范围声明**：不包含任何第三方 Pixiv 客户端；不修改仓库任何其他文件。

---

## TL;DR 推荐表

| 决策点 | 推荐方案 | 主要依据 |
| --- | --- | --- |
| 主端 i18n 库（SolidJS） | **自建轻量层 / `@solid-primitives/i18n`**（扁平 JSON + `{{var}}` 插值 + 复数自建函数），必要时引入 Lingui 语义 | solid-primitives 与 Lingui 均官方支持 Solid；solid-i18next 已归档 |
| 双端统一消息格式 | 两端共用 **扁平命名空间 JSON**（key 约定一致），格式为普通 JSON 而非 .po/.ftl | Weblate/Crowdin 对 JSON 支持完善；.ftl/.po 对 3 语言小团队是过度工程 |
| vue-lynx 端 | **普通 message-function 模块（手写 TS 函数）优先**；vue-i18n runtime-only 构建可用但 `$d/$n` 依赖 Intl，Lynx 未实现 Intl | Lynx 官方明确"Intl API 尚未实现"；官方推荐 i18next + polyfill 模式 |
| Android 原生层 | `localeConfig` + `LocaleManager`（Android 13+）/ AppCompat 1.6 backport；或社区插件 `@capawesome/capacitor-app-language` | 官方 per-app language 文档；Capawesome 插件文档 |
| JS 与原生 locale 同步 | JS 侧手动传入有效 locale（bridge/settingsStore），不信任 `navigator.language` | Android WebView 会异步重置 app Locale（Google Issue Tracker #37113860） |
| 翻译工作流 | 先"手写 2-3 个 locale + PR"；若开放社区翻译，选 **hosted Weblate**（FOSS 免费托管先例多） | Tusky/NewPipe/Mihon/Thunderbird Android 均用 Weblate |
| AI 辅助翻译 | LLM 批量翻译 + 人工审校（Lingo.dev 或 Crowdin AI Pipeline 模式，或自写脚本） | 2025-2026 主流做法 |
| 语言切换 UX | 默认跟随系统，设置页提供手动覆盖；**Web 端即时切换**，原生侧切语言需接受 Activity/WebView 重建 | per-app language 文档 + Capawesome 插件行为说明 |
| 日期/数字 | 主端直接用 **原生 `Intl.*`**（WebView ≥ 85 完整支持）；lynx 端在 Intl 可用前避免依赖或接 polyfill | MDN Intl 文档 + Lynx 官方文档 |
| 复数 | 目标语言仅 zh/ja/en：zh/ja 只需 "other"，en 需 one/other 两态；手写复数函数即可，不必上 ICU | CLDR 复数规则；i18next v24 强依赖 `Intl.PluralRules`（Lynx 缺失） |

---

## 1. Android 平台层：per-app language 与混合封装

### 1.1 Android 13+ per-app 语言与 backport

- Android 13（API 33）引入系统级"每应用语言"：用户在系统设置中选择某 app 的语言，app 通过 `LocaleManager.setApplicationLocales()` / `getApplicationLocales()` 读写，**应用内选择器与系统设置自动双向同步**。([developer.android.com/guide/topics/resources/app-languages](https://developer.android.com/guide/topics/resources/app-languages))
- 声明支持语言有两种方式：AGP 8.1+ 的 `androidResources { generateLocaleConfig = true }` 自动从 `res/values-*` 目录生成 `LocaleConfig`；或手写 `res/xml/locales_config.xml` 并在 manifest 上声明 `android:localeConfig`。([同上](https://developer.android.com/guide/topics/resources/app-languages))
- Android 12 及以下通过 **appcompat 1.6.0+ 的 `AppCompatDelegate.setApplicationLocales()`** 回迁；自动持久化需注册 `AppLocalesMetadataHolderService`（`autoStoreLocales=true`，主线程有阻塞读的 StrictMode 告警）。注意低版本上它作用于 `AppCompatActivity` 的 context 而非 application context。([同上](https://developer.android.com/guide/topics/resources/app-languages))
- 设置 locale 会触发配置变更，**Activity 会重建**（除非自行处理 locale config change）。([同上](https://developer.android.com/guide/topics/resources/app-languages))
- 传统资源限定符（`values-ja/strings.xml`）与 `<plurals>` 依然是原生侧的基础设施；`resourceConfigurations` 可裁掉依赖库带入的多余语言资源。([string-resource](https://developer.android.com/guide/topics/resources/string-resource)、[app-languages](https://developer.android.com/guide/topics/resources/app-languages))

### 1.2 Capacitor / WebView 混合封装的协调实践

- 社区事实标准插件 **`@capawesome/capacitor-app-language`**：`getLanguage()` / `setLanguage({languageTag})`（仅 Android）/ `resetLanguage()` / `openSettings()`。Android 实现依赖 appcompat + `AppLocalesMetadataHolderService`，要求声明 `locales_config.xml`；文档明确警告"**切换语言会重建当前 Activity，从而重载 WebView**"。iOS 无法编程设置语言，只能 `openSettings()` 跳系统设置。([capawesome.io/docs/sdks/capacitor/app-language](https://capawesome.io/docs/sdks/capacitor/app-language/))
- Capacitor 官方 `@capacitor/app` 插件提供 `App.getLanguageCode()` 读取应用语言。([capacitorjs.com/docs/apis/app](https://capacitorjs.com/docs/apis/app))
- 核心坑：**创建 WebView 会异步重置 app Locale**（Chromium 长期 bug，Android 7+ 明显），导致 `navigator.language` 与原生设置不一致；社区通行解法是 WebView 加载后重新 apply locale，并把有效 locale 通过 bridge 显式传给 JS，而不是依赖 `navigator.language`。([Google Issue Tracker #37113860](https://issuetracker.google.com/issues/37113860)、[StackOverflow 40398528](https://stackoverflow.com/questions/40398528/android-webview-language-changes-abruptly-on-android-7-0-and-above))
- Ionic 社区对 per-app language 的共识：自写小插件（targetSdk 33 + AppCompat 1.6）即可，无需重型方案。([Ionic Forum: per-app language preferences](https://forum.ionicframework.com/t/change-application-language-in-android-per-app-language-preferences/226523))
- 结论：**原生侧只影响权限弹窗、通知等原生渲染字符串；WebView 内 UI 的语言是 JS i18n 库的职责**，两侧需要显式同步。([capawesome 插件文档的 scope 说明](https://capawesome.io/docs/sdks/capacitor/app-language/))

## 2. 技术栈库选型（SolidJS / i18next / vue-i18n / ICU / 时间日期）

### 2.1 SolidJS

- **`@solid-primitives/i18n`**（solidjs-community 官方 primitives，solidjs.com 本站在用）：`translator()` + `flatten()`（嵌套→扁平点号 key，类型安全）+ `resolveTemplate()`（`{{ name }}` 插值）+ `prefix()`（命名空间）+ `chainedTranslator()`；**没有内置复数/ICU**，哲学是"小而可组合的原语"；推荐扁平 JSON、避免客户端 flatten。([GitHub README](https://github.com/solidjs-community/solid-primitives/tree/main/packages/i18n)、[npm](https://www.npmjs.com/package/@solid-primitives/i18n))
- 社区现状：有用户抱怨该包"一段时间没更新"，且 **`solid-i18next` 已归档（archived）**——生态里没有事实标准全功能库。([Reddit r/solidjs](https://www.reddit.com/r/solidjs/comments/1bmzwa0/what_do_you_use_for_i18n/))
- **Lingui**（`@lingui/solid`）是唯一有官方 Solid 绑定的全功能方案：ICU MessageFormat、`lingui extract` 生成 `.po` 目录、`lingui compile` 产运行时 catalog、`@lingui/vite-plugin` 动态加载、复数基于 `Intl.PluralRules`；`@lingui/core` 框架无关。([lingui.dev/tutorials/solid](https://lingui.dev/tutorials/solid))
- 其他可选：rosetta（极小）、Intlayer（2026 年新贵，带 benchmark 营销页面）。([how-to.dev rosetta](https://how-to.dev/how-to-start-internationalization-in-solidjs-with-rosetta)、[intlayer.org benchmark](https://intlayer.org/en-GB/doc/benchmark/solid))

### 2.2 i18next 生态

- fallback 机制最完备：`fallbackLng`（单一/有序数组/按语言映射/函数）、**key fallback 链** `t(['error.404','error.unspecific'])`、`fallbackNS`（命名空间兜底）、`returnEmptyString: false` 让空串视为缺失、`saveMissing` + 后端在开发期收集缺失 key。([i18next fallback 原则](https://www.i18next.com/principles/fallback))
- 提取工具：**i18next-parser 已标记 DEPRECATED**，官方继任者为 `i18next-cli`（提取、同步、lint、类型生成、翻译状态检查）。([i18next 官方提取指南](https://www.i18next.com/how-to/extracting-translations)、[i18next/i18next-parser](https://github.com/i18next/i18next-parser)、[locize 公告](https://www.locize.com/blog/i18next-cli))
- Lynx 官方把 i18next 列为推荐方案（简单 API、按需加载、缓存、插件生态、热更新），并给出 Lynx 特有约束（见 2.4）。([lynxjs.org i18n 指南](https://lynxjs.org/3.8/guide/inclusion/internationalization.html))

### 2.3 vue-i18n 与 Lynx 的兼容性

- vue-i18n 提供 **runtime-only 构建**（`vue-i18n.runtime.esm-bundler.js`），要求消息预编译为 message function，运行时不带编译器——这是非 DOM 自定义渲染器环境更合适的形态。([vue-i18n 优化指南](https://vue-i18n.intlify.dev/guide/advanced/optimization)、[Yarn 包页对 .runtime 变体的说明](https://classic.yarnpkg.com/en/package/vue-i18n))
- **没有找到任何 vue-i18n + Lynx 的官方支持声明或实证案例**（vue-lynx 官方文档未提及 i18n；Lynx 官方 i18n 指南只演示 ReactLynx + i18next）。
- 关键风险：vue-i18n 的 `$d`（datetime）/`$n`（number）**直接构建在 ECMA-402 Intl API 之上**，而 Lynx 运行时目前没有实现 Intl——在 Lynx 上这两类功能需要 polyfill 或绕开。([vue-i18n datetime 指南](https://vue-i18n.intlify.dev/guide/essentials/datetime.html)、[Lynx i18n 指南](https://lynxjs.org/3.8/guide/inclusion/internationalization.html))
- Lynx 官方替代路径（对 vue-lynx 同样适用的部分）：i18next v23 + `compatibilityJSON: 'v3'`（绕开对 `Intl.PluralRules` 的依赖）或 v24 + `intl-pluralrules` polyfill；静态 JSON 导入或 `i18next-resources-to-backend` + 动态 `import()` 懒加载；`rsbuild-plugin-i18next-extractor` 提取、`@lynx-js/i18next-translation-dedupe` 把翻译写入 bundle customSections 避免重复打包。([Lynx i18n 指南](https://lynxjs.org/3.8/guide/inclusion/internationalization.html))

### 2.4 ICU MessageFormat / FormatJS 与时间日期库

- ICU MessageFormat 生态：FormatJS 的 CLI 提供 `formatjs extract`，并有面向 CI 的完整性校验（检查某 locale 缺失/多余 key 的 flag）。([FormatJS CLI 文档](https://formatjs.github.io/docs/tooling/cli/))
- FormatJS 的 `@formatjs/intl-numberformat`、`@formatjs/intl-datetimeformat`、`intl-pluralrules` 正是 Lynx 官方推荐的 polyfill 套件。([Lynx i18n 指南](https://lynxjs.org/3.8/guide/inclusion/internationalization.html))
- **dayjs**：locale 完全按需 opt-in（`import 'dayjs/locale/ja'` + `dayjs.locale('ja')`），不打包未用 locale；locale 对象含月份/星期/相对时间/日历串；支持全局与实例级 locale。([day.js i18n 文档](https://day.js.org/docs/en/i18n/i18n))
- date-fns 采用"每 locale 一个模块"的纯 JS 方案（不依赖 Intl），i18n 指南见 [date-fns.org/docs/I18n](https://date-fns.org/docs/I18n)。
- **原生 Intl** 是 WebView 内的零依赖方案：`Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.PluralRules` / `Intl.RelativeTimeFormat` 均为标准 API（WebView ≥ 85 完整可用）。([MDN Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat))

### 2.5 per-locale chunk 懒加载实践

- 通行模式：`import(`./locales/${locale}.json`)` 动态导入 + Vite/Rspack 自动按 locale 分 chunk；i18next 侧配套 `i18next-resources-to-backend`；静态打包的默认语言不产生额外 chunk（Lynx 官方示例明确演示了该行为）。([Lynx i18n 指南](https://lynxjs.org/3.8/guide/inclusion/internationalization.html))
- Lingui 侧对应 `@lingui/vite-plugin` / `@lingui/loader` 动态加载 catalog。([lingui.dev/tutorials/solid](https://lingui.dev/tutorials/solid))

## 3. 字符串资源管理

### 3.1 key 命名与结构

- 两派主流：**嵌套对象树（namespaced）**——i18next 默认 `keySeparator: '.'`，支持 `fallbackNS` 命名空间兜底与 key 数组 fallback 链；**扁平点号 key**——`@solid-primitives/i18n` 官方建议（避免客户端 flatten 的运行时开销，且 TypeScript 可精确推导 key 类型）。([i18next fallback](https://www.i18next.com/principles/fallback)、[solid-primitives README](https://github.com/solidjs-community/solid-primitives/tree/main/packages/i18n))
- 反模式（有官方文档背书的警告）：i18next 明确不推荐"用整句英文原文当 key"（`keySeparator: false` 模式）——难管理、易漂移。([i18next fallback](https://www.i18next.com/principles/fallback))
- LocalSend 的做法值得抄：JSON 中带 `@` 前缀的字段是给译者的上下文说明，不进 UI。([localsend/localsend README](https://github.com/localsend/localsend))

### 3.2 格式对比（JSON / .po / .ftl / XLIFF）

| 格式 | 优点 | 缺点 | 适合谁 |
| --- | --- | --- | --- |
| 扁平 JSON | 零依赖、TS 类型友好、双端共用、构建即用 | 无内置复数/选择器语义 | 3-5 语言的小团队（Bitwarden、LocalSend 均为 JSON） |
| gettext .po | 老牌双语格式、译者熟悉、Lingui 默认 | 需要 extract/compile 工具链 | 使用 Lingui 或 gettext 生态的项目 |
| Mozilla Fluent (.ftl) | 复数/性别/语法选择器表达力最强（CLDR 类别、`[one]/[few]/[other]`、term 复用），"翻译者自主权"设计 | 引入新运行时与学习成本 | 大型多语言项目（Firefox 系） |
| XLIFF | 行业交换标准，平台间迁移友好 | 人不直接读 | 作为 TMS 中转格式 |

来源：[projectfluent.org](https://projectfluent.org/)、[Weblate 格式文档](https://docs.weblate.org/en/latest/formats.html)（Weblate 同时支持 PO/XLIFF/JSON 族/Android strings/Fluent 等，并区分双语格式 vs 以 ID 为键的单语格式）、[lingui.dev/tutorials/solid](https://lingui.dev/tutorials/solid)、[Bitwarden clients](https://github.com/bitwarden/clients)。

### 3.3 提取与 CI 校验

- i18next 系：`i18next-cli`（i18next-parser 已弃用）支持提取 + lint + 翻译状态检查。([官方指南](https://www.i18next.com/how-to/extracting-translations) 与 [i18next-parser 仓库 DEPRECATED 标记](https://github.com/i18next/i18next-parser))
- FormatJS 系：`formatjs extract` + CI 校验 flag（缺失/废弃 key）。([FormatJS CLI](https://formatjs.github.io/docs/tooling/cli/))
- 通用做法：CI 里"提取 → 与现有目录 diff → 不一致即失败"；社区工具（next-intl 讨论）也围绕"找未使用 key / 找代码里没有 key 的 `t()` 调用"展开。([next-intl discussion #503](https://github.com/amannn/next-intl/discussions/503))
- 硬编码字符串检查：JSON/代码 lint 规则只能覆盖字面量形态；**Android 伪 locale 是官方推荐的兜底检测手段**（见 3.5）。

### 3.4 缺失 key 的 fallback 链

i18next 的完整机制可直接映射到自建方案：区域变体缺失 → 回退基础语言（`en-GB`→`en`）→ `fallbackLng` 最终语言；t() 支持数组 key 链 `t(['error.404','error.unspecific'])`；`fallbackNS` 跨命名空间兜底；缺失时默认返回 key 本身（UI 出现裸 key = 缺翻译，一眼可查）；`returnEmptyString: false` 让空串也算缺失。([i18next fallback 原则](https://www.i18next.com/principles/fallback))

### 3.5 伪本地化（pseudo-localization）测试

- Android 官方提供两个伪 locale：**en-XA**（加变音符 + 拉长文本 + 括号包住每个消息单元）与 **ar-XB**（强制 RTL）。能暴露：硬编码字符串（伪 locale 下显示为原样未加工文本）、文本拉长导致的布局破坏、字符串拼接（一句话被拆进多个括号）、BIDI/RTL 镜像问题。开启方式：debug buildType `pseudoLocalesEnabled true` + 设备开发者选项选择伪 locale。([developer.android.com/guide/topics/resources/pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales))
- VS Code 以 **qps-ploc 伪语言包** 的形式把伪本地化纳入 14 个官方语言之列。([microsoft/vscode-loc](https://github.com/microsoft/vscode-loc))
- Web 侧轻量等价物：`pseudo-localization`（npm）等库可在运行时变换文案做冒烟测试。

## 4. 小团队 / 独立团队的翻译工作流

### 4.1 真实 OSS 应用的平台选择（一手证据）

| 应用 | 平台 | 形态 | 备注 |
| --- | --- | --- | --- |
| Tusky | **自建 Weblate** | [weblate.tusky.app](https://weblate.tusky.app/projects/tusky/tusky/es/) | 65 种语言，纯社区志愿翻译 |
| NewPipe | **hosted Weblate** | [hosted.weblate.org/engage/newpipe](https://hosted.weblate.org/engage/newpipe/) | 111 种语言，注册即可翻译 |
| Thunderbird Android / K-9 | **hosted Weblate** | [hosted.weblate.org/projects/tb-android](https://hosted.weblate.org/projects/tb-android/) | 74 种语言，含术语表 |
| Mihon（Tachiyomi 后继） | **hosted Weblate** | [hosted.weblate.org/engage/mihon](https://hosted.weblate.org/engage/mihon/)（见仓库 README badge） | 英文原串在仓库 `i18n` 模块（moko-resources），翻译在 Weblate，"Translations are done externally via Weblate" |
| LocalSend | **hosted Weblate** | [hosted.weblate.org/projects/localsend/app](https://hosted.weblate.org/projects/localsend/app) | 也可 fork 手改 JSON PR，双轨制 |
| Obsidian | **Crowdin** | [obsidianmd/obsidian-translations](https://github.com/obsidianmd/obsidian-translations) | 语言表 + Crowdin 项目提交/投票，随版本打包 |
| Bitwarden | **Crowdin** | [contributing.bitwarden.com](https://contributing.bitwarden.com/contributing/) | JSON `messages.json`；**不接受直改翻译文件的 PR**，全部走 Crowdin GitHub 集成回写 |
| Element Web | **Localazy** | [element-web docs/translating.md](https://github.com/element-hq/element-web/blob/develop/docs/translating.md) | "自动从 Localazy 拉取，每周 3 次"；`%(count)s` 兼做复数判定；协调靠 Matrix 房间且"几乎不需要协调" |
| Signal Android | **Transifex** | [signal.org/translate](https://signal.org/translate) | 官方渠道，志愿者翻译 |
| Telegram Android | **自建平台** | [translations.telegram.org](https://translations.telegram.org/) | 自研众包平台，非通用 TMS |
| VLC | **Transifex** | [explore.transifex.com/yaron/vlc-trans](https://explore.transifex.com/yaron/vlc-trans/) | 老项目，仅保留既有翻译，活跃度低 |
| VS Code | **微软内部本地化平台** | [microsoft/vscode-loc](https://github.com/microsoft/vscode-loc) | 仓库只是镜像产物；**翻译 PR 一律不收** |

**规律**：志愿社区驱动的 Android/跨端应用压倒性地选 Weblate（尤其 hosted.weblate.org）；商业公司项目多用 Crowdin/Transifex/内部平台；Element 是 Localazy 少数派样本。共同点是 **源语言（英文/中文）字符串在代码仓库维护，翻译由平台双向同步回仓库（PR 或自动提交）**。

### 4.2 AI 辅助翻译（2025-2026 实践）

- **Lingo.dev**（开源）：定位"把本地化当基础设施"，LLM 按任务/目标语言选模型（Anthropic、OpenAI 等），CI/CD 集成后 PR 中自动翻译变更串；平台侧再叠加母语者 proofread。([lingo.dev](https://lingo.dev/en)、[lingodotdev/lingo.dev](https://github.com/lingodotdev/lingo.dev)、[v1.0 公告](https://lingo.dev/en/blog/introducing-lingodotdev-v1))
- **Crowdin AI**：2025 年 11 月推出 **AI Pipeline**——多步工作流（术语映射 → 翻译 → 自检 → 质量检查），AI 先翻、人再审；AI 预翻译按 OpenAI 直连价计费无加价；支持用 TM/术语表微调模型。([What's New at Crowdin: Nov 2025](https://crowdin.com/blog/whats-new-at-crowdin-november-2025)、[AI localization 博文](https://crowdin.com/blog/ai-localization))
- 对比结论（第三方评测口径）：Crowdin 适合要"人机协作 TMS"的团队，Lingo.dev 适合"工程主导、翻译在流水线里自动发生"的小团队。([AIToolIndex 对比](https://aitoolindex.io/compare/crowdin-vs-lingo-dev))
- 自写脚本流派：对 2-3 个目标语言，用 LLM 批量翻译 JSON + 人工 review 是当下小团队的常见做法（r/IndieDev 讨论中普遍反映 Crowdin 对小项目成本偏高）。([Reddit r/IndieDev](https://www.reddit.com/r/IndieDev/comments/1rdvrgo/what_tools_are_you_using_for_ai_localization/))

### 4.3 "手写 2-3 个 locale" 选项

对目标语言（zh/en/ja）极少、维护者即译者的项目，社区存在完全绕开 TMS 的先例：LocalSend 明确允许"fork 后手动加翻译"作为 Weblate 之外的合法通道；Element 的翻译协调文档自述"几乎不需要协调"。Obsidian 早期也是论坛志愿帖（megathread）起步，成熟后才迁到 Crowdin。([LocalSend README](https://github.com/localsend/localsend)、[element-web translating.md](https://github.com/element-hq/element-web/blob/develop/docs/translating.md)、[Obsidian 论坛 megathread](https://forum.obsidian.md/t/app-interface-and-documentation-translation-volunteer-megathread/3628))

## 5. 样本深挖（与 Pictelio 架构相近的独立项目）

| 项目 | 技术形态 | i18n 库/格式 | 文件布局 | 切换 UX | 谁来翻 |
| --- | --- | --- | --- | --- | --- |
| **Obsidian** | Electron 桌面（闭源） | 自研 JSON 加载 | `obsidianmd/obsidian-translations` 仓库按语言表组织，Crowdin 管提交/投票 | Settings → About → Language 直接切换 | 社区志愿（Crowdin），approved 后进版本 |
| **Bitwarden** | TS 多端 clients（web/桌面/浏览器扩展） | 自研 i18nService + JSON（Chrome `_locales` 格式） | `apps/browser/src/_locales/<lang>/messages.json` 等 | 客户端设置内选择语言 | Crowdin 社区，禁止直改翻译 PR |
| **LocalSend** | Flutter 全平台（独立小团队） | Flutter slang 风格 JSON | `app/assets/i18n/strings_<locale>.i18n.json` + `_missing_translations_*.json` | 应用内切换（Flutter rebuild 即时生效） | Weblate 社区为主 + 手动 PR 双轨 |
| **Mihon** | Android 原生（KMP，Tachiyomi 后继） | moko-resources（KMP 资源抽象） | 仓库 `i18n/` Gradle 模块，英文在 `src/commonMain/moko-resources/base/` | 系统设置 per-app language + 应用内 | Weblate 社区（外部），同步回仓库 |
| **Element Web** | React SPA（Matrix 生态） | 自研 + `%(count)s` 复数约定 | 仓库内 JSON（`src/i18n/strings/`），Localazy 双向同步（每周 3 次） | 应用内设置即时切换 | Localazy 社区 + Matrix 房间协调 |
| **VS Code** | Electron | 内部 xliff 管线 → 语言包扩展 | `microsoft/vscode-loc` 镜像产物；语言包以 Marketplace 扩展分发 | Configure Display Language 命令 / `--locale`，**需重启生效** | 微软本地化平台，翻译 PR 不收 |

来源：[obsidian-translations](https://github.com/obsidianmd/obsidian-translations)、[bitwarden/clients](https://github.com/bitwarden/clients) + [Bitwarden contributing](https://contributing.bitwarden.com/contributing/)、[localsend/localsend](https://github.com/localsend/localsend)、[mihonapp/mihon i18n](https://github.com/mihonapp/mihon/tree/main/i18n)、[element-web translating.md](https://github.com/element-hq/element-web/blob/develop/docs/translating.md)、[vscode-loc](https://github.com/microsoft/vscode-loc) + [VS Code locales 文档](https://code.visualstudio.com/docs/configure/locales)。

**共性观察**：
1. 没有"从单语言长成多语言"的标准路径——Electron/TS 项目（Obsidian、Bitwarden、VS Code）都落在 **JSON 目录 + 外部翻译平台回写** 上。
2. 大团队（微软、Signal、Telegram）把字符串源码与翻译平台解耦并禁止直接 PR；小团队（LocalSend、Mihon）允许双轨。
3. 桌面/重应用接受"切语言要重启"（VS Code），移动/SPA 侧则普遍即时切换（React/Vue/Solid/Flutter 的响应式 locale 重渲染）。

## 6. UX 惯例

- **默认跟随系统 + 手动覆盖**：Android 13 把这一决策上移到系统设置（per-app language），应用内选择器与系统自动同步——即"应用内切换"与"系统级切换"应当是同一个状态的两面。([app-languages](https://developer.android.com/guide/topics/resources/app-languages))
- **切换是否即时**：
  - Web/SPA（Solid/Vue/React）：locale 是响应式状态（Solid 中为 `createMemo`/signal 驱动 translator，i18next 用 `changeLanguage()`，Lingui 用 `i18n.activate()`）→ **即时生效，无重启**。([solid-primitives README](https://github.com/solidjs-community/solid-primitives/tree/main/packages/i18n)、[Lynx i18n 示例](https://lynxjs.org/3.8/guide/inclusion/internationalization.html)、[Lingui Solid](https://lingui.dev/tutorials/solid))
  - Android 原生：`setApplicationLocales` 触发配置变更、Activity 重建——Capacitor 场景下意味着 WebView 重载，**即时性受平台限制**。([app-languages](https://developer.android.com/guide/topics/resources/app-languages)、[Capawesome 插件](https://capawesome.io/docs/sdks/capacitor/app-language/))
  - 桌面重应用（VS Code）：明确要求重启。([VS Code locales](https://code.visualstudio.com/docs/configure/locales))
- **复数与插值**：CLDR 定义语言相关的复数类别（en 有 one/other，zh/ja 只有 other）；各方案殊途同归——Android `<plurals>`、Fluent 的 `[one]/[few]/[other]` selector、Lingui/i18next v24 依赖 `Intl.PluralRules`、i18next v23 + `compatibilityJSON: 'v3'` 用 JSON v3 复数后缀绕开 Intl。([CLDR 语言复数规则](https://www.unicode.org/cldr/charts/47/supplemental/language_plural_rules.html)、[projectfluent.org](https://projectfluent.org/)、[Lingui Solid](https://lingui.dev/tutorials/solid)、[Lynx i18n](https://lynxjs.org/3.8/guide/inclusion/internationalization.html))
- **RTL**：对目标语言 ja/en/zh 无意义，可明确出范围；但 en-XA/ar-XB 伪 locale 与 `<plurals>` 同属一套 Android 调试设施，未来扩语种时再启用。([pseudolocales](https://developer.android.com/guide/topics/resources/pseudolocales))
- **locale 感知的日期/数字**：WebView 内直接用 `Intl.DateTimeFormat` / `Intl.NumberFormat` / `Intl.RelativeTimeFormat`（标准 API，MDN 有完整兼容表）；dayjs/date-fns 这类库在已有 Intl 的环境里主要价值是统一 token 格式而非补齐 locale。([MDN Intl.DateTimeFormat](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)、[day.js i18n](https://day.js.org/docs/en/i18n/i18n))

---

## 对 Pictelio 的适配建议

映射关系：**主端 = pictelio-app（SolidJS SPA，现 UI 为简中）**；**副端 = pictelio-app-lynx（Vue 3 自定义渲染器，无 DOM，Lynx 运行时）**；**壳 = Capacitor Android（minSdk 28，WebView ≥ 85）**。

1. **消息格式与 key 约定（两端共用，最高优先）**
   - 采用**扁平点号 key 的 JSON**（如 `settings.appearance.title`），主端与 lynx 端共用同一套 key 命名，作为跨端契约（符合本仓库"契约测试必须用真实样例"的约束：可写一致性测试比对两端 key 集合，防漂移）。
   - 源语言建议仍以中文为源（现状）或增加英文中间层；无论哪种，key 用英文语义命名而非整句原文（i18next 官方警告过整句当 key 的反模式）。
   - 复数仅 en 需要 one/other 两态（zh/ja CLDR 只有 other）——**自建 `plural(count, {one, other})` 纯函数即可，不必引入 ICU 运行时**。

2. **主端（SolidJS）库选型**
   - 首选 **`@solid-primitives/i18n`**：`translator()` + 预先 flatten 的扁平 JSON + `resolveTemplate()`，locale 存入现有 `settingsStore`/`uiStore`，切换即 signal 重渲染、即时生效。它的"无复数/无 ICU"在 zh/ja/en 三语场景下不构成短板。
   - 不建议 `solid-i18next`（已归档）；若未来语言数膨胀到两位数再评估 Lingui（ICU + .po + extract 工具链）。
   - 懒加载：`import(`@/locales/${locale}.json`)` 动态导入按 locale 分 chunk；默认语言静态打包保首屏（Lynx 官方示例与通行 Vite 实践同构）。
   - 缺失 key fallback 链自己实现（数组 key 链 + 回退源语言 + 渲染 key 本身），并遵守仓库"禁止静默降级"约束：缺失时 `console.warn('[i18n]')`。
   - 日期/数字：直接用原生 `Intl.*`（WebView ≥ 85 完整支持），不动 dayjs locale 机制（若已在用）。

3. **vue-lynx 端**
   - **先走"普通 message-function 模块"**：每语言一个 TS 模块导出 `(t: Key, vars?) => string`，与主端共享同一扁平 JSON（构建期由脚本把 JSON 转成函数模块或直接 JSON import）。理由：Lynx 运行时**未实现 Intl**，vue-i18n 的 `$d/$n` 与 v24 的 `Intl.PluralRules` 依赖会踩坑，且没有 vue-i18n + Lynx 的公开实证案例。
   - 若坚持 vue-i18n：必须用 **runtime-only 构建 + 预编译消息**，并在 Lynx 侧接入 `intl-pluralrules` / `@formatjs/intl-*` polyfill（Lynx 官方推荐套件），同时放弃或 polyfill `$d/$n`。
   - 可参考 Lynx 官方的 i18next 懒加载/提取模式（`rsbuild-plugin-i18next-extractor` 思路：按模块图裁剪未用翻译），与 Rspack/Lynx 构建链契合。

4. **Android 壳（Capacitor）**
   - 原生侧引入 `androidx.appcompat:appcompat ≥ 1.6`；manifest 加 `android:localeConfig`（列 zh/en/ja），让系统设置里的 per-app language 生效；Android 12 及以下（minSdk 28 覆盖到的区间）注册 `AppLocalesMetadataHolderService(autoStoreLocales)` 持久化。
   - 自建 30 行小桥（参考 `@capawesome/capacitor-app-language` 的 API：`getLanguage/setLanguage/resetLanguage/openSettings`）或直接装该插件；写入现有 `PixivApiPlugin` 同款注册流程。
   - **同步契约**：WebView 加载完成后把"有效 locale"（应用设置 > 原生 per-app > 系统默认）通过 bridge 显式传给 JS 初始化 i18n，不信任 `navigator.language`（Chromium WebView 重置 Locale bug）。两端语言选择状态统一落到 `settingsStore`（mirrored backend 已具备）。
   - 接受物理限制：在原生层切语言会重建 Activity/重载 WebView（应用内 JS 层切换则即时）；因此**语言切换器应做成"改 JS locale + 异步同步到原生"**，避免原生重建路径。

5. **翻译工作流（小团队 + AI 辅助）**
   - 阶段一（现在）：**手写 zh/en/ja 三个 locale JSON 直接进仓库 + PR review**，CI 加"提取/diff 校验"（自定义脚本或 i18next-cli 的 lint/状态检查能力），并用 Android en-XA 伪 locale + 主端简易 pseudo 函数在 E2E 里冒烟查硬编码字符串。
   - 阶段二（若开放社区翻译）：优先 **hosted Weblate**（Tusky/NewPipe/Mihon/Thunderbird Android 同款路径，志愿翻译生态匹配），JSON 格式 Weblate 原生支持；源语言文件在仓库，译文由 Weblate 集成自动 PR 回写。
   - AI 辅助：自写 LLM 批量翻译脚本（对 3 个语言最省）或 Lingo.dev CI 集成；规则沿用本仓库约束——AI 产出视为"待审样本"，进 PR 由人审（对应"期望值出处可追溯"的翻译版）。

6. **明确出范围**：RTL（目标语言无 RTL，Android 侧也不启用 ar-XB）、`%count`s 类富文本标签协议（Element 的做法）、XLIFF/.ftl 迁移（语言数超过 ~10 再考虑 Fluent 语法或平台托管）。

---

## 附：本次调研的工具路由自检

- 本任务为纯网页调研（无代码库理解需求），故未使用 CodeGraph/OpenWiki；文档查询遵循"官方文档优先"原则，未使用 Context7（无第三方库 API 细节需验证的部分均直接抓取官方文档/仓库一手页面）。
- 检索通道：WebSearch（发现）+ WebFetch（一手来源验证）。个别一手页面（`date-fns/docs/I18n`、Element `src/i18n/strings/` 路径）未逐一抓取，已在文中标注为低风险常识性引用。
