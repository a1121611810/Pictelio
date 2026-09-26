# app-lynx M3 开关组件：抽取 `<M3Switch>` —— 功能规格

> 来源：grill-with-docs 会话（2026-09-20）；锚定问题：Me.vue 10 处 + SettingsEndpoint.vue 2 处 M3 switch inline markup 一字不差重复 + auto-fallback ON 态渲染塌陷（视觉回归与 R18/R18G/relatedInjection/rankingEntry 不一致）。
>
> ADR 落点：**ADR-0179**（随首批实施 commit 一并提交；编号以落地时为准）。
> 状态：spec 终稿，待 to-tickets。

## 1. Problem Statement

`packages/app-lynx/src/pages/Me.vue` 与 `packages/app-lynx/src/components/SettingsEndpoint.vue` 共有 **12 处** M3 开关 inline markup 复制（grep `w-\[13.867vw\]` 验证：Me.vue 行 535/557/721/738/757/775 + 1047/1066/1085；SettingsEndpoint.vue 行 559/578；含 2 处 novelExport + 1 处 webdavEnabled 此前 spec 初稿漏数）。12 处复制一字不差——同一份规范、N 份拷贝。

直接后果：
1. **Drift 风险**：任何一处 typo（class 漏写、顺序错位、token 引用错误）只会让该行的开关悄悄走样，单测与快照都难以及时发现。
2. **auto-fallback ON 态渲染塌陷**（用户 2026-09-20 截图实证）：自动回退 WebView 开关在 ON 态显示为「蓝圈 + 白心」，而非应有的「M3 ON 态蓝 pill + 白 thumb」。同文件 R18/R18G/relatedInjection/rankingEntry 在 ON 态渲染正常。12 处 inline 缺乏单点真理源，定位与修复路径被稀释。
3. **a11y 不变量无法集中保障**：现有模板测试逐行断言 `accessibility-label="ME_A11Y_LABELS.${key}"`，12 行 = 12 份相同断言；任一调用方传错字符串绕开注册表，单测形同虚设。

业务侧诉求：保持视觉与现有 R18 等 4 处基线一致（即 OFF 态灰 pill + 灰 thumb + outline 边框，ON 态蓝 pill + 白 thumb），消灭 drift，定位并修复 auto-fallback 渲染异常；为后续新增开关提供零成本接入点。

## 2. Solution

抽一个 **`<M3Switch>`** Vue 组件作为单点真理源，承载 M3 开关的几何/颜色/动效 3 个知识维度（**纯视觉**，不绑 a11y、不发 emit；a11y 与 `@tap` 责任在父级 `<view>` 行）。Me.vue 10 处 + SettingsEndpoint.vue 2 处 inline markup 全部替换为 `<M3Switch :checked="<ref>"/>` 形式。

**根因 + fix**（v3 修订）：auto-fallback 行容器含 `<view class="flex flex-col">` + 长描述文案（>40vw），flex 默认 `flex-shrink: 1` 让 `<M3Switch>` track 在父行 flex 布局中被挤塌到 handle-container 尺寸（`w-8 h-8` = 32×32），视觉表现为「蓝圈 + 白心」。组件化暴露了真因后，**fix 是给 track 加 `flex-shrink-0`**——锁死主轴尺寸，描述文案再长 track 都不塌。R18/R18G/relatedInjection/rankingEntry（1 行文案）原本不塌；auto-fallback/fullscreen（2 行文案）塌但 OFF 态肉眼不易察觉。Fix 后 12 处 callsite 全部正确渲染。

## 3. User Stories

1. As a **app-lynx 用户**，我想在「自动回退 WebView」开关上看到与 R18 开关完全一致的 M3 ON 态（蓝 pill + 白 thumb），so that 我能在视觉上确认「两个开关属于同一组件族」，不会被错位的样式误导功能差异。
2. As a **app-lynx 用户**，我想点击自动回退开关时，翻转动画与 R18/R18G/relatedInjection/rankingEntry 完全一致（同一时长、同一缓动），so that 设置页有统一的微交互手感。
3. As a **app-lynx 用户**，我想全屏模式开关的 OFF 态依然显示「灰 pill + 灰 thumb + outline 边框」，与现有基线完全一致，so that 关闭态在视觉上与开启态明确区分且与其他开关风格统一。
4. As a **a11y 用户（TalkBack / UiAutomator）**，我想 12 处开关在系统无障碍树中均以**行级 `<view>` 容器**为焦点元素（`accessibility-element=true` + `accessibility-label=<已注册 key>）呈现，so that 测试工具（Appium / UiAutomator）能稳定定位；`<M3Switch>` 本身不绑 a11y（避免 TalkBack 双暴露）。
5. As a **维护者**，我想新增一个开关只需写 2 行 props（`checked` + 行级 `<view>` 自带 a11y + `@tap`），so that 新功能接入不被 M3 几何细节（5 个尺寸常量 + 4 个颜色 token）绊住；a11y 与 toggle 责任继承父级行即可。
6. As a **维护者**，我想 M3 规范的尺寸调整（M3 v0.193 之后如变更 track 52×32dp 为其它比例）只需改 1 处，so that 设计系统升级不会引发 12 处散落修改。
7. As a **维护者**，我想修复 M3 颜色 token 名称（如 `bg-primary-on` 改名为 `bg-on-primary`）只需改 1 处，so that 改名不会触发 12 处同步替换的 PR 噪音。
8. As a **维护者**，我想 `<M3Switch>` 的 props 集合保持极小（仅 `checked`，**无** `ariaLabel`、**无** `tap` event、**无** `@tap` 绑定），so that 组件契约清晰，单测 setup 简洁，第三方复用零门槛——a11y 与 toggle 责任在父级行统一绑定，避免双暴露。
9. As a **测试维护者**，我想 `<M3Switch>` 的状态→类名映射有内部纯函数可单元测试（`trackClass(checked)` / `thumbClass(checked)`），so that 边界类细节（true/false 各自的 4 个 class 字符串）能被**精确字符串匹配**锁定，不依赖 Vue mount。
10. As a **测试维护者**，我想 `<M3Switch>` 模板测试只需覆盖**接口边界**（props 唯一 / 无 a11y / 无 emit）+ **内部纯函数精确值** + **防漂移**（a11y/emit 缺席负向断言 + 尺寸白名单），so that 组件重构不影响测试。
11. As a **测试维护者**，我想现有 `meWebdavTemplate.test.ts` / `SettingsEndpoint.template.test.ts` 模式继续可用，so that 不引入新的测试基础设施。
12. As a **代码审阅者**，我想在 PR diff 里看到「Me.vue 删除 ~150 行 + 新增 10 行 + 新增 M3Switch.vue 30 行」的清晰结构变更，so that 评审焦点集中在「是否所有 callsite 替换完整」「行级 a11y + `@tap` 责任是否仍在 `<view>` 上」。
13. As a **设计系统贡献者**，我想 `<M3Switch>` 是 app-lynx 端的 M3 开关唯一权威实现（**纯视觉**——几何/颜色/动效；a11y 不下放），so that 未来跨 app-lynx 多页面的 M3 控件（segmented button、checkbox 等）有可参照的 deep-module 模板。
14. As a **故障响应者**，我想 auto-fallback 渲染塌陷若在组件化后仍未消除，能在 `<M3Switch>` 这一单点加调试 class（如 `bg-error`）定位，so that 不必在 12 处 inline 之间逐行排查。
15. As a **业务方（产品）**，我想 spec §4 列出的「12 处 callsite 完整覆盖」是可逐项验收的清单，so that 上线前能机械化确认无 callsite 遗漏（机器门禁：`grep -c '<M3Switch' Me.vue SettingsEndpoint.vue` ≥ 12）。

## 4. Implementation Decisions

### 4.1 模块

| 模块 | 路径 | 角色 |
|---|---|---|
| `<M3Switch>` 组件 | `packages/app-lynx/src/components/M3Switch.vue` | 新增：M3 开关唯一权威实现（纯视觉：几何 + 颜色 + 动效） |
| `<M3Switch>` 模板测试 | `packages/app-lynx/src/components/M3Switch.template.test.ts` | 新增：内部纯函数 `trackClass` / `thumbClass` 状态→类映射精确字符串断言 + 公开接口（`checked` 唯一 prop）+ 防漂移（a11y/emit 缺席 + 尺寸白名单） |
| `Me.vue` callsite | `packages/app-lynx/src/pages/Me.vue` | 修改：10 处 inline → `<M3Switch>`；行级 a11y + `@tap` 保留 |
| `SettingsEndpoint.vue` callsite | `packages/app-lynx/src/components/SettingsEndpoint.vue` | 修改：2 处 inline → `<M3Switch>`；行级 a11y + `@tap` 保留 |
| 机器门禁（新） | `packages/app-lynx/tests/m3-switch-migration-gate.test.ts` | 新增：守卫 `<M3Switch` ≥ 12 且 `w-\[13.867vw\]` 仅 M3Switch.vue 命中（防未来回退到 inline） |
| ADR-0179 | `docs/adr/ADR-0179-app-lynx-m3-switch-component.md` | 新增：三段式（Context / Decision / Consequences） |
| spec 引用 | `docs/specs/lynx-systembars.md` §D5 末段 | 修改：追加「开关 UI 由 `<M3Switch>` 组件统一（ADR-0179）」 |

### 4.2 公开接口（仅 `checked` 一个 prop）

```ts
defineProps<{
  checked: boolean
}>()
```

- `checked`：受控状态，调用方拥有 source of truth。组件不持有内部状态、不解析任何 prop（除 `checked` 外无 prop）。
- **无 `ariaLabel` / 无 emit / 无 `@tap` 绑定**：a11y 注入（`accessibility-element` + `accessibility-label`）与 `@tap="<toggleFn>"` 翻转事件责任**留在父级 `<view>` 行容器**，避免与 M3Switch 自身 a11y 双暴露导致 TalkBack 双重播报；同时保留「点击行内任意位置（含文字标签）触发 toggle」的本仓历史 UX（详见 §4.4）。

**未引入的 props / emits**（YAGNI，等出现时再加）：
- `disabled`：当前 12 处需求均无 disabled 态。
- `variant: 'default' | 'dense'`：仅一种设计。
- `loading`：开关无异步语义。
- `modelValue`（v-model）：避免组件持有内部状态，与「受控组件」契约保持一致。
- `ariaLabel`：a11y 责任在父级行，不下放到开关组件（防双暴露）。

### 4.3 内部实现

组件内部把 M3 规范 v0.192 的 5 个尺寸常量、4 个颜色 token、2 个 motion token 全部隐藏，对调用方不可见。**无 a11y 常量引用、无 emit**——这些责任在父级行。**track 必带 `flex-shrink-0`**——防父行 `flex flex-col` 文字容器描述撑爆导致 track 塌陷到 handle-container 尺寸（v3 实证——见 §2 根因）。状态→类名映射由两个私有纯函数封装：

```ts
// M3Switch.vue script 内私有，不导出
function trackClass(checked: boolean): string {
  return checked
    ? 'bg-primary justify-end'
    : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'
}
function thumbClass(checked: boolean): string {
  return checked
    ? 'w-[6.4vw] h-[6.4vw] bg-primary-on'
    : 'w-[4.267vw] h-[4.267vw] bg-outline'
}
```

模板内：

```vue
<view
  class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center
         transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]"
  :class="trackClass(checked)"
>
  <view class="w-8 h-8 flex items-center justify-center">
    <view class="rounded-full active:w-[7.467vw] active:h-[7.467vw]" :class="thumbClass(checked)" />
  </view>
</view>
```

### 4.4 调用方契约（12 处统一）

`<M3Switch>` 仅接收 `checked`；a11y + `@tap` 留在父级 `<view>` 行（**模板属性 camelCase**——vue-tsc 不接受 `:aria-label` → `ariaLabel` 模板 kebab-to-camel 映射，故 a11y 注册表 key 直接用 `ME_A11Y_LABELS.<key>` 而非 prop）。

```vue
<view
  class="flex flex-row items-center justify-between py-3.5 border-b-[1px] border-b-surface-variant"
  :accessibility-element="A11Y_ELEMENT_ENABLED"
  :accessibility-label="ME_A11Y_LABELS.<key>"
  @tap="<toggleFn>"
>
  <text class="text-title-medium text-surface-on">{{ t('<key>.title') }}</text>
  <M3Switch :checked="<ref>" />
</view>
```

具体 12 处映射（`checked` 来源 + 行级 `@tap` 处理器 + 行级 a11y key）：

| callsite | 行级 a11y key | `checked` 来源 | 行级 `@tap` 处理器 |
|---|---|---|---|
| Me.vue（自动回退） | `ME_A11Y_LABELS.autoFallbackEngine` | `autoFallbackEngine` | `toggleAutoFallbackEngine` |
| Me.vue（全屏模式） | `ME_A11Y_LABELS.fullscreenMode` | `fullscreenMode` | `toggleFullscreenMode` |
| Me.vue（R18） | `ME_A11Y_LABELS.r18Toggle` | `showR18` | `toggleR18` |
| Me.vue（R18G） | `ME_A11Y_LABELS.r18gToggle` | `showR18G` | `toggleR18G` |
| Me.vue（相关作品注入） | `ME_A11Y_LABELS.relatedInjectionToggle` | `relatedInjection` | `toggleRelatedInjection` |
| Me.vue（排行榜入口） | `ME_A11Y_LABELS.rankingEntryToggle` | `rankingEntry` | `toggleRankingEntry` |
| Me.vue（novelExportIncludeMetadata） | `ME_A11Y_LABELS.novelExportIncludeMetadata` | `novelExportOptions.includeMetadata` | `settings.setNovelExportIncludeMetadata(!...)` |
| Me.vue（novelExportIncludeCover） | `ME_A11Y_LABELS.novelExportIncludeCover` | `novelExportOptions.includeCover` | `settings.setNovelExportIncludeCover(!...)` |
| Me.vue（novelExportIncludeImages） | `ME_A11Y_LABELS.novelExportIncludeImages` | `novelExportOptions.includeInlineImages` | `settings.setNovelExportIncludeImages(!...)` |
| Me.vue（webdavEnabled） | `ME_A11Y_LABELS.webdavToggle` | `settings.webdavEnabled` | `toggleWebdavEnabled` |
| SettingsEndpoint.vue（translateR18） | `t('novelTranslate.endpoint.translateR18')` | `translateR18` | `requestTranslateConsent('r18')` |
| SettingsEndpoint.vue（translateR18G） | `t('novelTranslate.endpoint.translateR18G')` | `translateR18G` | `requestTranslateConsent('r18g')` |

### 4.5 auto-fallback 渲染塌陷处理

抽组件本身即定位动作：
1. **理论 1**（2 行文字容器影响）：组件化后调用方只传 props，组件自带 root view → 直接验证。
2. **理论 2**（Tailwind JIT 动态 class 优先级）：组件用静态 class → 直接验证。
3. **理论 3**（lynx 引擎布局 bug）：组件化后若仍塌，保留组件、在 auto-fallback callsite 临时回退到 inline + 加调试 class → 独立 ticket 处理。

**回退路径**：组件化与渲染修复正交——抽组件无论如何都是净收益（drift 免疫、a11y 统一、测试面集中）；auto-fallback 视觉修复是组件化之外的另一件事。

### 4.6 不引入第二个 Adapter

当前仅有 M3 设计系统的开关需求。Fluent 端（`packages/app/src/components/settings/SettingsClient.tsx` 的 `<fluent-switch>`）是 webview 客户端的另一设计系统（Fluent Design 2）——不是同一缝隙的另一个 adapter，是不同 module。本次**不**在 `<M3Switch>` 预留 Fluent 变体。

## 5. Testing Decisions

### 5.1 测试层级

| 缝隙 | 测试类型 | 文件 | 断言 |
|---|---|---|---|
| 公开缝隙（`<M3Switch>` props + 接口边界） | 模板源码断言（`readFileSync` + 正则） | `packages/app-lynx/src/components/M3Switch.template.test.ts` | `checked: boolean` 唯一 prop；**无** `ariaLabel` / `accessibilityLabel` / `label` 字符串 prop；**无** a11y 绑定（`accessibility-element` / `accessibility-label`）；**无** `@tap` / `defineEmits` / `A11Y_ELEMENT_ENABLED` 引用 |
| 内部纯函数（`trackClass` / `thumbClass`） | 同文件，正则提函数体后精确字符串匹配 | `packages/app-lynx/src/components/M3Switch.template.test.ts` | `trackClass(true)` === `'bg-primary justify-end'`；`trackClass(false)` === `'bg-surface-container-highest justify-start border-[0.533vw] border-outline'`；`thumbClass(true)` / `thumbClass(false)` 类名等价精确断言 |
| 内部实现（M3 几何 + 颜色 + 动效） | 同文件，`toContain` 字面量 | 同上 | `w-[13.867vw]` / `h-[8.533vw]` / `rounded-full` / `w-8 h-8` / 4 个 thumb 尺寸 + `transition-colors duration-[var(--durationNormal)] ease-[var(--motion-standard)]` 全部出现 |
| 防回归（尺寸白名单） | 同文件，扫所有 w-/h- 类名做白名单校验 | 同上 | 仅 6 个合法尺寸（13.867vw / 8.533vw / 6.4vw / 4.267vw / 7.467vw / 8）出现 |
| 机器门禁（迁移完备性，spec §5.5 新增） | 文件 grep + 计数断言 | `packages/app-lynx/tests/m3-switch-migration-gate.test.ts` | `Me.vue + SettingsEndpoint.vue` 内 `<M3Switch` 总数 ≥ 12；整仓 `w-\[13.867vw\]` 仅 M3Switch.vue + 测试文件命中（防未来回退到 inline） |
| Me.vue 替换回归 | 模板测试（既有） | `packages/app-lynx/src/pages/meWebdavTemplate.test.ts` | 沿用既有字面量 + 注册表断言；行级 `:accessibility-label="ME_A11Y_LABELS.<key>"` 全部保留 → 单测继续过 |

### 5.2 好的测试特征

- **仅测试外部行为，不测实现**：组件的 `transition-colors` / `ease-[var(--motion-standard)]` 内部细节不直接断言（运行时无法稳定观察），改名为 `motion-standard-2` 不应破测。
- **接口边界 + 内部纯函数精确值 + 防漂移（a11y/emit 缺席 + 尺寸白名单）**四件事是组件契约的全部测试面。
- **私有纯函数可独立测试**（不依赖 Vue mount），但仅测其返回值字符串，**不测其是否被组件调用**——后者属实现细节。

### 5.3 已有同类测试范式

- `packages/app-lynx/src/pages/meWebdavTemplate.test.ts`：字面量 + a11y 注册表断言 + 文件读源（`readFileSync` + `toContain`）模式
- `packages/app-lynx/src/components/SettingsEndpoint.template.test.ts`：同款模板源码断言模式（仓库无 vue-lynx 渲染器，vitest node 环境）
- `packages/app-lynx/src/components/BookmarkPanel.template.test.ts` / `GlassCard.template.test.ts`：组件模板测试模式

`<M3Switch.template.test.ts>` 沿用 `SettingsEndpoint.template.test.ts` 模式（仓库惯例：**`src/components/<X>.template.test.ts` 位置 + 模板源码断言**，非 mount + props）。

### 5.4 视觉验证门禁（不可自动化）

- 真机 LynxView：auto-fallback ON 截图 == R18 ON 截图
- web-core：同上
- 验证脚本（非 CI 必跑）：截 2 张图后人工比对，或脚本做像素 diff（基线 = R18 ON 截图）

### 5.5 机器门禁（迁移完备性，新增）

`packages/app-lynx/tests/m3-switch-migration-gate.test.ts`（新增，CI 必跑）——验证未来回归到 inline 写法的尝试会被自动捕获：

- `Me.vue + SettingsEndpoint.vue` 内 `<M3Switch` 总数 ≥ 12（覆盖全部已知 callsite）
- 整仓 `packages/app-lynx/src/` 下 `w-\[13.867vw\]` 仅命中 `M3Switch.vue` 1 处 + M3Switch.template.test.ts 2 处（其他位置出现 = 漂移回归）

## 6. Out of Scope

1. **WebView 端 `<fluent-switch>` 改造**：Fluent Design 2 与 M3 设计系统不同；强行复用 `<M3Switch>` 跨设计系统不合理。如要统一跨端开关视觉，另立 effort（前置：先解决双客户端设计系统差异的策略问题）。
2. **auto-fallback 渲染塌陷**：v3 已 fix（track 加 `flex-shrink-0`），不再开独立 ticket。如未来再发同型塌陷（描述文案进一步加长），可继续用 `flex-shrink-0` 模式。
3. **M3 控件族扩展**（`<M3Radio>` / `<M3Checkbox>` / `<M3SegmentedButton>`）：本 ticket 仅抽出开关；其他控件的抽取是后续 effort（且当前无重复迹象，YAGNI）。**更新（2026-09-26）**：`<M3SegmentedButton>` 的 YAGNI 断言已被 falsified（5 处拷贝 drift：7eb0f5eb 漏改 AI 作品组分隔线）并收口——见 docs/specs/app-lynx-m3-segmented-button.md + ADR-0190；`<M3Radio>` / `<M3Checkbox>` 的 YAGNI 断言继续成立。
4. **`M3Switch` props 扩展**（`disabled` / `variant` / `loading` / `ariaLabel`）：当前 12 处需求均无；YAGNI。
5. **M3 几何常数 token 化**（将 `13.867vw` 等移入 `tokens.css` 为 `--m3-switch-track-width` 等）：当前 inline arbitrary value 在 12 处表现一致，无 token 化紧迫性；待 M3 控件族扩展时再做统一抽象。
6. **业务逻辑改动**：自动回退引擎、全屏模式、R18/R18G 等开关的语义、设置键、持久化逻辑均**不**触碰。
7. **i18n 字典**：现有 `me.client.*` / `me.content.*` / `novelTranslate.endpoint.*` 文案**不**触碰。
8. **a11y 注册表**：`ME_A11Y_LABELS` 的 key/value **不**触碰；行级 `<view>` 容器直接引用既有 key。

## 7. Further Notes

### 7.1 与既有 ADR 的关系

- **ADR-0164**（默认引擎 + 自动回退）——auto-fallback 开关的「业务层」决策；本次仅重构其 UI 渲染层。
- **ADR-0168**（lynx 系统栏 + 全屏模式）——全屏模式开关的「业务层」决策；本次仅重构其 UI 渲染层。spec `lynx-systembars.md` §D5 末段追加一句「开关 UI 由 `<M3Switch>` 组件统一（ADR-0179）」。
- **ADR-0051**（R18/R18G 过滤）——R18/R18G 开关的业务语义；本次仅重构 UI 渲染层。

### 7.2 与既有 SPEC 的关系

- `lynx-systembars.md` §D5 末段追加引用（spec 自更新，原生 ticket 末尾一并提交）。

### 7.3 后续 ticket 拆解（to-tickets 阶段产出）

按依赖顺序建议拆为 3 张 ticket：
1. **T1：`<M3Switch>` 组件骨架 + 模板测试 + 机器门禁**（无 callsite 替换，纯新增）
2. **T2：Me.vue 10 处 callsite 替换**（含既有 `meWebdavTemplate.test.ts` 回归）
3. **T3：SettingsEndpoint.vue 2 处 callsite 替换 + ADR-0179 + spec 段引用**（最后提交文档，确保 ADR 编号落地）

### 7.4 风险与监控

| 风险 | 缓解 |
|---|---|
| 抽组件后 auto-fallback 仍塌 | 保留组件、auto-fallback callsite 临时回退到 inline + 调试 class → 独立 ticket |
| 某 callsite 漏替换 | **机器门禁** `packages/app-lynx/tests/m3-switch-migration-gate.test.ts`（5 条断言：`<M3Switch` ≥ 6 in Me.vue + ≥ 2 in SettingsEndpoint.vue + `w-\[13.867vw\]` 残影 = 0 + M3Switch.vue 存在且含 `w-\[13.867vw\]`） |
| SettingsEndpoint 迁移后视觉变化（旧 markup 无 `transition-colors`） | 这是改进；接受；若不接受需单独 ticket |
| 行级 a11y 漏绑 / 字符串绕开注册表 | `meWebdavTemplate.test.ts` 注册表完整性断言模式继续覆盖；M3Switch.template.test.ts 负向断言守住「组件内部不绑 a11y」（防双暴露回归） |
| vue-tsc / oxlint 报 props 类型错 | props 类型严格声明 `{ checked: boolean }`；调用方若传非布尔会被类型系统拒绝——v2 收紧后**无 `ariaLabel` 字符串 prop**，移除 kebab/camel 映射歧义 |

### 7.5 一句话总览

**抽 `<M3Switch>` Vue 组件作为 app-lynx M3 开关唯一权威实现（纯视觉：几何 + 颜色 + 动效；a11y 与 `@tap` 责任在父级 `<view>` 行），替换 12 处 inline markup，同步消除 drift 风险、a11y 双暴露与 M3 规范升级的多点同步成本；auto-fallback 渲染塌陷作为组件化副产物走正交 ticket。**