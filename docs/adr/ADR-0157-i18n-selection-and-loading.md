# ADR-0157: 双端 i18n 选型与加载策略（简中源 + 英文，@solid-primitives/i18n + 副端手写模块）

- 状态：accepted
- 日期：2026-09
- 关联：spec docs/specs/i18n.md、风格基线 docs/style-guides/ui-copy.md、wayfinder #492（地图）/ #491-#498（决策票）、#500-#510（实施工单）、ADR-0103（跨引擎设置键契约先例）、ADR-0144（happy-dom 测试环境）

## 背景

双端 UI 全量硬编码简中（app 143 / lynx 178 文件字面量含中文，~4.3k/6k CJK 行），零 i18n 基建。目标：简中为源语言、新增英文，双端同步全量抽取，UI 语言切换即时生效（跟随系统 + 应用内手动覆盖）。

三个硬约束决定了选型形态：

1. **SolidJS 2.0 RC 生态**：solid 适配器事实缺位——`i18next-solid` 包名在 npm 不存在，`solid-i18next` 0.0.5 peer 仍是 solid 1.x（周下载 263，2026-02 新建微项目）；i18next core 43.6 kB min 对双语言目标无收益。
2. **Lynx 运行时无 Intl**：官方明言 "the Intl API is not implemented in Lynx"；vue-i18n 的 `$d/$n`（基于 `@intlify/core-base` → `Intl.DateTimeFormat/NumberFormat`）不可用，且 intlify 全仓 issue 搜 "lynx" 零先例。
3. **WebView locale 不可信**：Chromium 会异步重置应用 locale（Google Issue #37113860），且 Node ≥22 原生暴露 `navigator.language`（happy-dom 默认 en-US）——「跟随系统」必须经显式注入点，业务代码禁散读 navigator。

## 决策

**D1. 主端 `@solid-primitives/i18n@3.0.0-next.4`**：peer 精确匹配 `solid-js ^2.0.0-rc.0`（本仓已在同 monorepo next 轨道消费 intersection-observer / scroll，精确锁版是既定常态）；1.09 kB gzip；TS 键安全靠 `Flatten`/`satisfies` 类型推导无 codegen；opencode 桌面端生产先例。fallback（若 2.0 RC 期 broken）= 自研 message 模块（signal + 扁平 JSON，与 store 风格同构，约百行）。

**D2. 副端手写 message 模块**：module ref `locale` + 纯函数 `t(key, vars)` + `{{var}}` 插值（`packages/app-lynx/src/i18n/`）。零依赖、零 Intl 依赖；模板/computed 内调用即建立响应依赖，切换即时生效。vue-i18n 被 D2 约束 2 直接封死。

**D3. 加载策略 = 静态源语言 + 动态其余 + 回退链**：zh-CN 字典静态内联进主 bundle（首帧零闪烁、测试确定）；en 走 `import()` 独立 chunk，模块加载即后台预取；`t()` 契约**恒返回 string**——`rawT(key) ?? zhCN[key] ?? key`，且**回退链同样走插值**（字典未就绪窗口不得吐原始 `{{var}}` 模板，B1 实测教训）。不采用 README 的 async memo + `<Loading>` 悬念模式：现有组件树无 Loading 边界，Nullable 平滑降级更贴近现状。副端 bundle 小，双语言静态内联（Lynx 动态 import chunk 机制未验证，如需懒加载另立票）。

**D4. 键完备双防线**：zh 字典分域文件（`locales/<lang>/<domain>.ts`，支撑并行抽取）经聚合器合并；en 各域 `as const satisfies Record<Zh<Key>, string>`——缺 key/多 key/改 key = 构建失败。运行时缺 key 回退源语言 + `console.warn('[i18n]')`（禁静默降级）。

**D5. 语言判定链与设置键**：手动覆盖（`settings_language` ≠ ""）> 系统语言（**仅经显式注入点**：主端 `ClientInfo.getLocale()` 桥——Android per-app locale，启动后校正跟随系统态；测试经 vitest `setupFiles` 钉 zh-CN）> 兜底 `zh-CN`。设置键 `settings_language`（值域 `"" | "zh-CN" | "en"`，`""` = 跟随系统）跨引擎逐字一致，lynx 侧 settingsStore 持久化（load + applyRawKey 双白名单），契约差分测试 `i18nLanguageKeyConsistency` 防漂移（ADR-0103 模式）。

**D6. 错误文案 key 化**：`ApiError` 增 `messageKey` + `params`（B1）。`classifyError`/`toApiError` 在非响应式上下文同时产出 `message`（简中快照：日志、测试断言、兜底）与 `messageKey`（展示层 `apiErrorMessage()` 优先渲染）；`message` 保留使既有断言与日志零改动。`{{detail}}`（服务端错误详情）是数据不是文案，不翻译。

**D7. 翻译生产**：AI 批量翻译（prompt 注入风格基线 docs/style-guides/ui-copy.md + 术语表）+ 人工校对；英文按 Apple HIG 文案规范（sentence case / 动词 CTA / 按钮无句号 / 避 please），中文存量不动。回潮门禁 = 迁移批次完成后启用 AST 扫描测试（剥注释后标 CJK 字符串字面量，白名单收紧至零容忍）。

## 后果

- 正面：主端 +1.09 kB；副端零依赖；切换即时生效无重启；测试环境 locale 确定性；`settings_language` 入 WebDAV 备份自动收编（registry `rawValues`）。
- 代价：321 文件机械抽取的批次周期（#501-#508）；`next` 轨道依赖需在 SolidJS 2 stable 后跟进 stable 3.0；Lynx 端日期格式化手写（无 Intl）；英文文案比中文长 30-50% 带来布局回归面（每批 review 项）。
- 数字 `toLocaleString()` 不收敛：zh/en 分组行为一致（千分位逗号），无 locale 漂移；日期走集中 `dateFormat.ts`（主端 Intl，副端手写 `YYYY/M/D` ↔ `M/D/YYYY`）。
