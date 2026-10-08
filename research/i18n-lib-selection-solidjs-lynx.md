# i18n 库选型调研：主端 SolidJS 2.0 RC × 副端 vue-lynx

**研究问题**：Pictelio 双客户端的 i18n 实现路径——主端 `packages/app`（SolidJS 2.0.0-rc.6 + vite-plus/Rolldown + Capacitor，WebView ≥ 85）在 `@solid-primitives/i18n`、`i18next` + solid 适配器、自研轻量 message 模块三者间如何选；副端 `packages/app-lynx`（Vue 3.5.13 via vue-lynx 自定义渲染器，Lynx 运行时无 DOM）能否用 vue-i18n。
**研究日期**：2026-09-12。
**研究方法**：npm registry / GitHub API（gh CLI）/ bundlephobia + npm tarball 实测 / 官方文档（lynxjs.org、vue-i18n.intlify.dev）/ MDN BCD 兼容数据 / 本仓 `package.json`、`native/Ota.ts`、`ADR-0122` 一手读取。每条结论附来源 URL 或仓内文件路径。
**范围声明**：仅本文件为交付物，不修改仓库其他文件；翻译平台/工作流/Android per-app language 已由 `research/i18n-survey-non-similar-apps.md`（下称「前次调研」）覆盖，本文只引用不重复。

---

## 0. 结论矩阵（criteria × 主端 3 候选 + 副端推荐）

| 维度 | ① @solid-primitives/i18n | ② i18next + solid 适配器 | ③ 自研 message 模块 | 副端 vue-lynx 推荐 |
| --- | --- | --- | --- | --- |
| Solid 2.0 RC / Lynx 兼容 | ✅ `3.0.0-next.4` peer `solid-js ^2.0.0-rc.0`（[npm](https://registry.npmjs.org/@solid-primitives/i18n)） | ❌ solid-i18next 0.0.5 peer `solid-js ^1.9.11`，无 2.0（[npm](https://registry.npmjs.org/solid-i18next)）；i18next core 框架无关可用 | ✅ 纯 signal + 函数 | ✅ 手写 message-function 模块（零依赖） |
| 响应式即时切换（无重渲染风暴） | ✅ `translator(createMemo(async …))`，Solid 细粒度只更新文本节点（[README](https://github.com/solidjs-community/solid-primitives/tree/main/packages/i18n)） | ⚠️ i18next `changeLanguage()` 可用，但响应性完全依赖微项目适配器 | ✅ signal 驱动，与现有 store 风格一致 | ✅ Pinia store（副端现有 settingsStore 即手写 Pinia） |
| 包体积 | **1.09 kB** min+gzip（官方 badge）；tarball 实测 dist/index.js 7,850 B 原始 / 2,794 B gzip（未压缩混淆） | i18next 26.4.2：43,583 B min / 13,703 B gzip（[bundlephobia](https://bundlephobia.com/package/i18next)）+ 适配器 | < 1 kB | 0（若干 TS 函数） |
| 插值 | `resolveTemplate`（`{{ var }}`）+ 字典可为函数（README） | 完整（嵌套、上下文、格式化扩展） | 手写 ~20 行 | 手写 |
| 复数（Intl.PluralRules） | **无内置**（README 无 plural 字样）；需自组合——主端 WebView 85 有 PluralRules（Chrome 63+），可行 | i18next v24+ JSON v4 **硬依赖 `Intl.PluralRules`**（[Lynx 官方指南原话](https://lynxjs.org/guide/inclusion/internationalization.html)）；v26 core 本身无 peer 但 JSON v4 复数依赖它 | 手写 `plural(n, {one, other})`（zh/ja CLDR 仅 other，en 仅需两态） | **必须绕开 Intl**：Lynx 未实现任何 Intl（官方文档） |
| TypeScript key 安全 | `Flatten<RawDictionary>` + `import type`：key 类型由字典对象推导，无 codegen 步骤（README + tarball index.d.ts 13 KB 类型） | i18next-cli typegen（官方，[i18next.com](https://www.i18next.com/how-to/extracting-translations)） | `typeof dict` key union | `typeof dict` |
| 维护风险 | 低-中：solidjs-community monorepo 未归档、2026-09-05 仍在 push、1557 stars、周下载 16.5 万（gh api + npm downloads）；但 3.0 为 **next 预发布轨道**（stable 2.2.1 peer 仍是 solid 1.x） | 高：i18next core 极稳（周下载 1598 万、peer 支持 TS ^5\|\|^6\|\|^7），但 **solid 适配器 = solid-i18next 0.0.5、周下载 263、2 stars、2026-02-23 创建**；`i18next-solid` 包名在 npm 上 404 不存在 | 中：代码自有可测，但插值/fallback/复数语义全自担 | 中：自有代码；若选 vue-i18n 则风险更高（见 §2） |
| 按 locale 懒加载 | 官方 README 内置模式：`createMemo(async () => import(\`./i18n/${locale}.ts\`))` + `isPending` + `<Loading>`/Suspense | `i18next-resources-to-backend` + 动态 import（前次调研 §2.5） | Vite/Rspack 动态 import 天然分 chunk | rspeedy(Rspack) 动态 import 同理 |

---

## 1. 主端候选证据

### 1.1 @solid-primitives/i18n（倾向首选）

- **Solid 2.0 RC 兼容（关键证据）**：npm dist-tags `{"latest": "2.2.1", "next": "3.0.0-next.4"}`；`3.0.0-next.4`（发布于 2026-08-12）peerDependencies 为 `{"solid-js": "^2.0.0-rc.0", "@solidjs/web": "^2.0.0-rc.0"}`——与主端现用 `solid-js 2.0.0-rc.6` 精确匹配（[npm registry](https://registry.npmjs.org/@solid-primitives/i18n)）。本仓已在同一轨道消费该 monorepo：`@solid-primitives/intersection-observer 3.0.0-next.3`、`@solid-primitives/scroll 3.0.0-next.4`（`packages/app/package.json`），故「next 轨道」是项目既定常态而非新风险。
- **monorepo 健康**：`solidjs-community/solid-primitives` 未归档、pushed 2026-09-05、1557 stars（`gh api repos/solidjs-community/solid-primitives`）；issue/PR 流里大量 "for Solid 2.0" 升级条目（[issue search](https://api.github.com/search/issues?q=repo:solidjs-community/solid-primitives+%222.0%22+in:title)），i18n 包的 2.0 升级随 monorepo 系统性推进。
- **体积**：官方 README badge「size 1.09 kB」；npm tarball `@solid-primitives/i18n@3.0.0-next.4` 实测：`dist/index.js` 7,850 B（gzip 后 2,794 B，未混淆）、`dist/index.d.ts` 13,080 B（类型面即 TS 安全来源）。
- **API 与 TS 安全**：`translator()` + `flatten()`（嵌套→扁平点号 key，官方建议**预先扁平的 JSON 避免运行时 flatten 开销**）+ `resolveTemplate`（`{{ name }}`）+ `prefix()` + `chainedTranslator`；字典用 `type Dict = typeof en_dict` + `import type` 引类型不引值（README「Dynamic loading」示例）。（[README](https://github.com/solidjs-community/solid-primitives/tree/main/packages/i18n)）
- **复数**：README 全文无 plural/ICU API——库本身不管复数；需自行组合 `Intl.PluralRules` 或两分支函数。对 zh/ja/en 目标语言这是非短板（zh/ja CLDR 只有 other，en 只需 one/other；前次调研 §对 Pictelio 建议 1）。
- **懒加载**：官方模式 `createMemo(async () => fetchDictionary(locale()))` + `i18n.isPending(dict)` + `<Loading>`/Suspense，locale signal 变化→按需 import→translator 原地换字典（README）。
- **注意事项**：3.0.0-next 是预发布；锁 `3.0.0-next.4` 精确版本（项目对 next 包本来就精确锁版），Solid 2.0 正式发布后跟进 stable 3.0。

### 1.2 i18next + solid 适配器

- **i18next core 本体很稳**：26.4.2、零运行时依赖、peer `typescript ^5 || ^6 || ^7`（兼容本仓 TS 6.0.3）、周下载 15,981,102（[npm](https://registry.npmjs.org/i18next)、npm downloads API）。
- **但 Solid 侧没有事实标准适配器**：
  - `i18next-solid`：npm **404，包不存在**（registry 查询返回 404）。
  - `solid-i18next`：latest 0.0.5，peer `solid-js ^1.9.11`（**未适配 2.0**），repo `lkwr/solid-i18next` 创建于 **2026-02-23、2 stars、1 open issue**，周下载 **263**（npm registry + `gh api repos/lkwr/solid-i18next`）。前次调研曾记录「solid-i18next 已归档」，本次核实为**新生的微项目而非归档库**——结论不变：不能承载生产依赖。
- **复数陷阱**：i18next v24 起 JSON v4 格式硬依赖 `Intl.PluralRules`（Lynx 官方指南明言，见 §2）；主端 WebView 85 可用（Chrome 63+，§4），此条不阻塞主端，但会阻断「两端共用 i18next」的方案。
- **体积**：43,583 B min / 13,703 B gzip（[bundlephobia](https://bundlephobia.com/package/i18next)@26.4.2），约为主端候选①的 40 倍。
- **定位**：i18next 的价值在 fallback 链/插件生态/大量语言时的管理面（前次调研 §2.2）；对 3 语言小团队，这些增量换 40 kB 体积 + 弱适配器风险，性价比低。

### 1.3 自研轻量 message 模块

- 形态：模块顶层 `createSignal<Locale>` + `t(key, vars?)` 纯函数 + 每 locale 一个 `import()` chunk——与 AGENTS.md「createSignal/createStore 直接在 store 模块顶层定义并导出」的既定风格一致；可注册进 `unplugin-auto-import`（主端 devDependencies 已有 21.1.0），让 `t()` 像其他原语一样免 import。
- 需要自己实现：扁平 key 查找、`{{var}}` 插值、缺失 key fallback（数组链 + 回退源语言 + **`console.warn('[i18n]')` 禁静默降级**，对应仓库测试硬约束 3）、en 两态复数。总量约 1 kB、约百行。
- 代价：`@solid-primitives/i18n` 已把这些原语写好、测好、type 好且仅 1.09 kB——自研在主端几乎不省什么，只把维护责任移回小团队自身。**因此主端自研更适合作为①不可行时的 fallback，而非首选**。

---

## 2. 副端：vue-i18n 能否上 Lynx / vue-lynx

**结论：技术上存在 runtime-only 通路，但零社区先例 + `$d/$n` 直接踩 Lynx 无 Intl 的硬伤；推荐手写 message-function 模块 + Pinia，vue-i18n 仅作可选 fallback。**

- **vue-i18n 本体与 Vue 3.5 兼容**：11.4.10 peer `vue ^3.0.0`，副端用 vue 3.5.13（npm registry + `packages/app-lynx/package.json`）；`createI18n`/`useI18n` 基于 app context，渲染器无关。
- **runtime-only 构建存在且官方支持**：vue-i18n 包内含 `vue-i18n.runtime.esm-bundler.js`（jsdelivr 文件清单实测）；官方优化文档：「message compiler + runtime: vue-i18n.esm-bundler.js」vs「runtime only: vue-i18n.runtime.esm-bundler.js」，后者「all locale messages have to pre-compile to Message functions or AST」，且「If you do the production build, Vue I18n will automatically bundle the runtime only module」（[@intlify/unplugin-vue-i18n](https://vue-i18n.intlify.dev/guide/advanced/optimization)）。unplugin 系工具与 Rspack（rspeedy 内核）兼容，预编译管线理论可挂上。
- **体积**：full 构建 64,821 B min / 21,166 B gzip（bundlephobia@11.4.10）；`vue-i18n.runtime.esm-browser.prod.js` 实测 47,109 B 原始 / 14,074 B gzip。
- **硬伤一（Intl 依赖）**：grep `@intlify/core-base@11.4.10/dist/core-base.mjs`（66,239 B）：`Intl.DateTimeFormat` ×4、`Intl.NumberFormat` ×4、`Intl.PluralRules` **×0**。即：基础 `t()`（预编译消息 + choice 序数复数）不依赖 Intl，但 `$d`（datetime）/`$n`（number）**直接构建在 ECMA-402 上**，而 Lynx 官方 i18n 指南明言：「**Currently, the Intl API is not implemented in Lynx but will be supported in future versions**」，补救路径是接 `@formatjs/intl-datetimeformat` 等 polyfill（[lynxjs.org i18n 指南](https://lynxjs.org/guide/inclusion/internationalization.html)；前次调研 §2.3 同证）。
- **硬伤二（零先例）**：intlify/vue-i18n 全仓 issue 搜索 "lynx" 命中 **0**（GitHub issue search API 实测）；vue-lynx 官方文档无 i18n 章节；Lynx 官方 i18n 指南只演示 ReactLynx + i18next。没有任何「vue-i18n 跑在无 DOM 自定义渲染器」的公开实证可循。
- **引擎事实**：Lynx Android 主线程运行时为 **PrimJS**（Lynx 团队维护、基于 QuickJS fork），「Fully supporting ES2019」；后台线程 Android 默认同为 PrimJS、iOS 默认 JavaScriptCore（[lynxjs.org/guide/scripting-runtime](https://lynxjs.org/guide/scripting-runtime/)、[lynx-family/primjs README](https://github.com/lynx-family/primjs)）。PrimJS README 与 Lynx 文档均未声明 ECMA-402/Intl 支持，与上引「Intl 未实现」一致。
- **推荐形态（与副端现状对齐）**：每 locale 一个 TS 消息模块（或共用主端扁平 JSON，构建期转函数模块），Pinia store 持有 locale signal——副端 settingsStore 本就是手写 Pinia（idbKV / NativeModules.PictelioPrefs），不经过主端 settings registry，消息模块走同样路数最顺；复数用两分支纯函数，日期/数字在 Lynx 侧**避免 Intl 依赖**（或引 Lynx 官方推荐的 @formatjs polyfill 套件），格式化函数自带 zh/ja/en 数据。
- **若坚持 vue-i18n**：必须 runtime-only 构建 + unplugin 预编译 + 接受 `$d/$n` 需 polyfill，并在两端（web-core 预览与真机）双验证——把它当「自担风险的 fallback」而非默认。

---

## 3. 懒加载 × Capacitor × OTA web bundle

- **Capacitor 侧 ESM 动态 import 可用**：本仓 `capacitor.config.ts` 显式 `androidScheme: "https"`（同源 https://localhost，无 CORS/混合内容问题）；动态 `import()` 在 Android WebView 自 Chrome/WebView **63** 起支持（[MDN BCD: import operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import)），门槛 85 远在其上。Vite（主端）/rspeedy（副端）对 `import(\`./locales/${locale}.json\`)` 的模板字面量自动做 per-locale chunk（通行构建行为，Lynx 官方 i18n 示例亦演示，前次调研 §2.5）。
- **OTA 机制（本仓一手证据）**：`packages/app/src/native/Ota.ts`（#249，ADR-0122-ota-self-built-switching.md）：install = 下载 zip → Ed25519 验签 → minApkVersion 拒装 → checksum → **解压整个版本目录** → 写 pending「下次启动生效」；失败原因枚举中与文件相关的只有 `unzip-missing-index`（唯一硬性文件约束是 index.html 存在）；切换原语为 `setServerBasePath`/`setServerAssetPath`（ADR-0122）。
- **per-locale chunk 与 OTA 的交互 = 无阻塞问题**：locale chunk 是 `dist/assets/*.js` 中的普通哈希产物，随整包 zip 进入版本目录；运行时动态 import 以 index.html 所在目录为基准解析相对 URL，切换 OTA 版本即整目录一致切换，不存在「新 HTML 引旧 chunk」的窗口（同版本目录内自洽）。ADR-0122 明确 delta 更新不在范围（未来重评），故多语言 chunk 只是让整包 zip 略增（每 locale 约 20-60 kB 文本，gzip 后更小），无机制性障碍。
- **一个顺带收益**：默认语言（zh-CN）静态打包保首屏，符合「先渲染、后加载」硬约束；非默认 locale 走 `import()` 懒加载，与 OTA 分发解耦。

---

## 4. 平台 Intl 能力表（MDN BCD 实测数据，chrome_android/webview_android 同值）

| API | Chrome/WebView 最低版本 | WebView 85 可用？ | 说明 |
| --- | --- | --- | --- |
| `Intl.DateTimeFormat` | **24** | ✅ | formatToParts 57、dateStyle/timeStyle/formatRange 76、calendar/numberingSystem 80，均 ≤ 85（[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat)） |
| `Intl.NumberFormat` | **24** | ✅ | notation/unit 系 77+，均 ≤ 85（[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat)） |
| `Intl.PluralRules` | **63**（任务书所写 "78+" 有误，实测 63） | ✅ | （[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/PluralRules)） |
| `Intl.RelativeTimeFormat` | **71**（任务书 "71+" 证实） | ✅ | （[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/RelativeTimeFormat)） |
| `Intl.ListFormat` | **72** | ✅ | （[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/ListFormat)） |
| `Intl.Segmenter` | **87**（任务书 "87+" 证实） | ❌ **85 不可用** | 仅用于分词/搜索类特性，UI 文案 i18n 不需要；主端小说搜索已用自有字符索引（[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter)） |
| 动态 `import()` | **63** | ✅ | （[MDN](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/import)） |
| Lynx / PrimJS | — | ❌ **全部缺失** | 官方：「the Intl API is not implemented in Lynx」（§2 引文）；主端可直接用原生 `Intl.*` 做日期/数字/复数，副端必须 polyfill 或自写 |

---

## 5. 依赖盘点（Q5，本仓一手读取）

- **两个客户端都没有日期库**：`packages/app/package.json` 与 `packages/app-lynx/package.json` 均无 dayjs/date-fns/luxon/temporal-polyfill（全部 dependencies + devDependencies 逐行核对）。
- **现状的日期/数字格式化 = 组件内手写**：`toLocaleDateString("zh-CN")` 等散落在至少 8 个文件（`src/components/CommentList.tsx:19`、`NovelCard.tsx`、`SeriesSheet.tsx`、`SeriesSheetItem.tsx`、`NovelTextListCard.tsx`、`home/NovelRowCard.tsx`、`settings/SettingsWebdav.tsx`、`primitives/isPretextSupported.ts` 的 `Intl` 命中为其他用途）——locale 硬编码 zh-CN。**i18n 落地时必须同步把这些收敛成 locale 感知的格式化模块**（主端直接换 `Intl.DateTimeFormat(locale)`，副端自写或 polyfill），否则切语言后日期仍是中文格式。
- 相关既有设施：主端 settings registry（`define<T>` 加键便宜）适合挂 `locale` 设置键；副端 settingsStore 为手写 Pinia + idbKV/NativeModules.PictelioPrefs；API 层当前不发送任何语言信号（如需 `Accept-Language` 属于独立改造，不阻塞库选型）。

---

## 6. 同栈先例（Q6）

- **opencode（anomalyco/opencode）**：生产级 SolidJS 桌面端，`packages/desktop/package.json` 依赖 `@solid-primitives/i18n: "2.2.1"`，i18n 逻辑位于 `packages/desktop/src/renderer/i18n/index.ts` 等 4 处（gh API 实测 contents + code search）。证明该库在大型真实 SolidJS 应用中可维护（其 solid-js 版本在 workspace catalog 中，未逐一展开）。
- 概念性先例（前次调研已深挖，此处仅引结论）：Lynx 官方 i18n 指南的 ReactLynx + i18next（v23 + `compatibilityJSON: 'v3'` 绕开 PluralRules / v24 + polyfill）模式，对 vue-lynx 的「手写模块」路径同样适用的部分是：**静态 JSON + 按需动态 import + 构建期提取**。（[lynxjs.org i18n 指南](https://lynxjs.org/guide/inclusion/internationalization.html)）
- 未找到「Capacitor + Solid + @solid-primitives/i18n」三要素齐备的公开仓库作为直接对照；不构成阻塞（Capacitor 壳与 i18n 库无交集，§3 已证通路）。

---

## 7. 明确推荐

### 主端 packages/app：首选 `@solid-primitives/i18n`（锁 3.0.0-next.4），fallback 自研 message 模块

1. **首选理由**：(a) 它是三候选中唯一 peer 精确匹配 `solid-js ^2.0.0-rc.0` 的（npm registry 实测），且本仓已在同 monorepo 的 next 轨道上稳定消费另两个包——Solid 2.0 RC 风险与项目既有姿态一致；(b) 1.09 kB 换来 translator/插值/类型推导/懒加载/Suspense 集成的全套原语，solidjs-community 维护（未归档、活跃 push）；(c) 无内置复数对 zh/ja/en 是非短板，`Intl.PluralRules`（WebView 63+）兜底；(d) 官方懒加载模式与「先渲染后加载」及 OTA 整包机制无冲突（§3）。
2. **fallback（触发现成条件）**：若 3.0.0-next 与 `@solidjs/vite-plugin 3.0.0-next.39` / unplugin-auto-import 出现实际冲突，或团队拒绝在 i18n 这个「半基础设施」上依赖预发布轨道——退到**自研 message 模块**：`createSignal` + `t(key, vars?)` + 扁平 JSON + 动态 import，语义照抄①（含缺失 key `console.warn`），约百行、零依赖、与 store 风格同构。
3. **不选 i18next**：适配器（solid-i18next 0.0.5，263 周下载、2 stars）是单点风险，core 43.6 kB 对 3 语言无对应收益；`i18next-solid` 包名在 npm 不存在。语言数到两位数再重评 Lingui（前次调研 §2.1）。

### 副端 packages/app-lynx：首选手写 message-function 模块 + Pinia store；fallback 才是 vue-i18n runtime-only

1. **首选理由**：(a) Lynx 官方明言 Intl 未实现，任何依赖 ECMA-402 的方案都要 polyfill 或绕行——手写函数模块天然零依赖；(b) vue-i18n + Lynx 零公开先例（issue 搜索 0 命中）、零官方支持声明，而 $d/$n 直踩 Intl 缺失；(c) 副端 settingsStore 本就是手写 Pinia，消息模块 + Pinia 与既有形态同构，契约测试可比对两端扁平 key 集合防漂移（呼应仓库「契约测试用真实样例」约束）。
2. **fallback（触发现成条件）**：若后续需要 ICU 级表达力或与主端共用工具链，用 `vue-i18n` **runtime-only 构建 + unplugin 预编译 + @formatjs intl-datetimeformat/numberformat polyfill**，并接受「Lynx 真机无先例、需双端实测」的前提。
3. **两端共用约定**：扁平点号 key 的 JSON 作为跨端契约（主端 translator 直接消费，副端构建期转函数模块）；默认语言静态打包、其余 locale `import()` 懒加载、随 OTA 整包 zip 顺带分发（§3，无阻塞）。

### 一句话结论

> 主端：`@solid-primitives/i18n@3.0.0-next.4`（自研为 fallback）；副端：手写 message-function 模块 + Pinia（vue-i18n runtime-only + polyfill 为 fallback）；日期/数字主端直接原生 `Intl.*`（WebView 85 全绿，Segmenter 除外），副端在 Lynx 实现 Intl 前不依赖 Intl。

---

## 附：本次调研的工具路由自检

- 本任务 = 网页调研 + 轻量本地读取：文档查询遵循「官方文档优先」（lynxjs.org、vue-i18n.intlify.dev、MDN BCD 经 `mcp__mdn__get-compat` 直取一手兼容数据）；npm/GitHub 事实走 registry API 与 gh CLI（匿名 GitHub API 限流后切换 `gh` 认证通道）。
- 本地读取均为已知路径整读（package.json、capacitor.config.ts、Ota.ts、ADR-0122、前次调研），属允许降级；OTA 代码定位先 grep 已知关键词（非符号级探索），未动用 CodeGraph；未修改本文件以外的任何文件，未执行 git 提交。
- 前次调研（`research/i18n-survey-non-similar-apps.md`）一处事实修正：solid-i18next 现为 2026-02 新建微项目（lkwr/solid-i18next，2 stars）而非「已归档库」——不影响原结论。
