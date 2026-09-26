# app-lynx M3 分段控件：抽取 `<M3SegmentedButton>` —— 功能规格

> 来源：grill-with-docs + prototype 会话（2026-09-26）；锚定问题：设置页「AI 作品」模块操作按钮丑、与同类型模块不一致（用户实证）。
>
> 原型验证：`packages/app-lynx/prototype/prototype-m3-segmented-button.html`（变体 B 定稿，C 滑动指示器备选被否决，A 为现状对照）。
>
> ADR 落点：**ADR-0190**（随首批实施 commit 一并提交；编号以落地时为准）。
> 状态：spec 终稿；已拆票（#740 T1 / #741 T2 / #742 T3 / #743 T4）并实施落地。

## 1. Problem Statement

`packages/app-lynx/src/pages/Me.vue` 设置页中，「AI 作品」模块（L850-882，ADR-0155 三态过滤：显示/遮罩/仅看）的 M3 segmented button 呈现"一根描边条里漂一个胶囊"的破碎感：三段融成一条连续白边条，只有外框 outline 和选中段可见。

**直接根因（git 实证）**：commit `7eb0f5eb`「fix(app-lynx): 系统性对齐 M3 官方组件规范(15 项)」（2026-08-11）明确修了 segmented button 的「段间 border-l-outline 分隔线」，给 Me.vue 加了 3 处 `border-l`（ugoira 段 2、quality 段 2/3），**唯独漏了 AI 作品组段 2/3**。未选段底色 `bg-surface-container-lowest`（#fff）与所在卡片底色完全相同，段间又无分隔线 → 三段边界不可读。`git log -L` 证实 AI 组自始无分隔线，确属漏改而非有意设计。

**系统性病灶**：同一 segmented 模式（容器 outline 全圆角 + N 段 + 选中段 secondary-container）在 app-lynx 有 **5 处一字不差的拷贝**，无共享组件：

| # | 位置 | 段数 | 当前分隔线状态 |
|---|---|---|---|
| 1 | Me.vue L624（外观模式 亮/暗/跟随系统） | 3 | ✅ 有（7eb0f5eb 修的正是这类） |
| 2 | Me.vue L853（**AI 作品 显示/遮罩/仅看**） | 3 | ❌ **无（本 bug）** |
| 3 | Me.vue L901（动图播放 fflate/Range） | 2 | ✅ 有 |
| 4 | Me.vue L931（详情画质 标准/高清/原图） | 3 | ✅ 有 |
| 5 | TranslateModeSwitch.vue L29（小说翻译 原文/译文） | 2 | ✅ 有（组件壳内仍 inline） |

复制粘贴结构必然 drift——本次"修 2 漏 1"就是 drift 已实际发生的证据。**ADR-0179 Out of Scope 曾断言"`<M3SegmentedButton>` 当前无重复迹象，YAGNI"——该断言已被现实 falsified（5 处拷贝 + 真实漏改 bug），本 spec 即收口。**

**排除项（调查实证，非问题域）**：非 scoped CSS 违规（Me.vue 全文无 `<style>` 块）；非硬编码色值（全部 M3 token）；非尺寸/圆角/字号问题（与参照组逐 class 一致）；非交互行为问题。

业务侧诉求：消除"AI 作品"模块的视觉破碎感，与同页其他 segmented 组一致；同时根治"N 份拷贝、修 1 漏 N"的结构性 drift 温床，为后续新增分段控件提供零成本接入点。

## 2. Solution

抽一个 **`<M3SegmentedButton>`** Vue 组件作为 app-lynx M3 分段控件唯一权威实现。**关键设计：段间分隔线由段 index 自动生成**（index > 0 的段恒带 `border-l border-l-outline`）——"修 2 漏 1"这类 bug 从结构上不可能再发生（新增/删除段时分隔线数量自动跟随 N-1）。

与 `<M3Switch>`（ADR-0179）的哲学对照：**M3Switch 是纯视觉、a11y 与 `@tap` 责任上推父级行**（整行一个焦点）；分段控件**无法照搬**——每段是独立可聚焦元素、label 各不相同、点击目标在段内，a11y 与选择事件只能由组件自持。本组件因此携带段级 a11y（`accessibility-element` + 每段静态 label）与选择 emit，这是按交互粒度推导的接口责任划分，非随意增厚。

视觉基线 = 迁移前参照组（动图/画质）的现有写法，**零视觉创新**：迁移后 5 处与迁移前逐 class 一致（bug 修复即"AI 组达到其他组早已有的状态"）。原型已验证该方向（变体 B 定稿）。

## 3. User Stories

1. As a **app-lynx 用户**，我想「AI 作品」三态控件与「动图播放」「详情画质」读得出同样的分段结构（段间 outline 分隔线），so that 我在设置页能一眼认出"这是同一族控件"，不会被破碎的视觉误导功能差异。
2. As a **app-lynx 用户**，我想三态（显示/遮罩/仅看）切换的按压反馈、选中底色、文字色与其余 segmented 组完全一致，so that 设置页微交互手感统一。
3. As a **a11y 用户（TalkBack）**，我想每个分段在无障碍树中都是独立焦点、带各自的静态 label（显示/遮罩/仅看……），so that 测试工具能稳定定位任意一段；行为与迁移前完全一致。
4. As a **维护者**，我想新增一个分段控件只需构造 options 数组 + v-model 绑定，so that 不被 M3 细节（容器 4 个 class、段 5 个 class、分隔线规则、选中/未选双套色 token）绊住。
5. As a **维护者**，我想未来 M3 规范调整（如选中段颜色 token 改名、高度 40dp 变更）只需改 1 处，so that 不会出现"改 4 处漏 1 处"的 PR。
6. As a **维护者**，我想段间分隔线规则由组件按 index 生成，so that 增删段、新增调用方时再也不用手动维护"哪段该有 border-l"。
7. As a **测试维护者**，我想组件的状态→类名映射有内部纯函数可单元测试（`segmentClass`），分隔线数量有机械断言（N 段 = N-1 条），so that 不依赖 Vue mount 也能锁定契约。
8. As a **代码审阅者**，我想 PR diff 呈"Me.vue 删 ~120 行 inline + 新增 4 行组件调用 + 新增组件 ~60 行 + 门禁测试"的清晰结构，so that 评审焦点集中在"5 处 callsite 是否全部替换、a11y label 是否原样保留"。
9. As a **故障响应者**，我想未来任何 segmented 视觉异常只需排查 `M3SegmentedButton.vue` 单点，so that 不必在 5 处拷贝间逐行比对 class。

## 4. Implementation Decisions

### 4.1 模块

| 模块 | 路径 | 角色 |
|---|---|---|
| `<M3SegmentedButton>` 组件 | `packages/app-lynx/src/components/M3SegmentedButton.vue` | 新增：M3 分段控件唯一权威实现（容器 + 段视觉 + 段级 a11y + 选择 emit） |
| 组件模板测试 | `packages/app-lynx/src/components/M3SegmentedButton.template.test.ts` | 新增：接口边界 + 内部纯函数精确值 + 分隔线 N-1 规则 + 尺寸/颜色白名单 |
| Me.vue callsite | `packages/app-lynx/src/pages/Me.vue` | 修改：4 处 inline（L624/L853/L901/L931）→ 组件调用；**AI 组 bug 修复随此生效** |
| TranslateModeSwitch.vue | `packages/app-lynx/src/components/TranslateModeSwitch.vue` | 修改：壳内 inline markup → 组件调用（disabled 语义由组件接管） |
| 机器门禁（新） | `packages/app-lynx/tests/m3-segmented-button-migration-gate.test.ts` | 新增：inline 容器特征串全仓清零 + 组件调用数 ≥ 5 + 组件存在性 |
| ADR-0190 | `docs/adr/ADR-0190-app-lynx-m3-segmented-button-component.md` | 新增：三段式（Context / Decision / Consequences） |
| 术语登记 | `packages/app-lynx/CONTEXT.md` 外观/主题色节 | 修改：新增「分段控件（segmented button）」词条 |

### 4.2 公开接口

```ts
export interface M3SegmentOption<T extends string> {
  /** 枚举值：选中即 v-model 的值 */
  value: T
  /** 已解析文案（调用方传 t() 的结果；options 须用 computed 构建以随语言切换重算） */
  label: string
  /** 静态 a11y label（Me.vue 侧继续引用 ME_A11Y_LABELS 注册表 key，注册表完整性测试继续生效） */
  a11yLabel: string
}
```

```vue
<script setup lang="ts" generic="T extends string">
const modelValue = defineModel<T>({ required: true })
defineProps<{
  options: M3SegmentOption<T>[]
  /** 禁用：容器置灰 + 段 tap 忽略（TranslateModeSwitch 需求） */
  disabled?: boolean
}>()
const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>()
</script>
```

- `v-model` 受控：调用方持有 source of truth（settingsStore / storeToRefs / computed 派生）。带副作用的调用方（`pickAppearanceMode` 等包装函数）可用 `:model-value` + `@update:modelValue` 分解写法接回包装函数。
- **段级 a11y 组件自持**（与 M3Switch 相反，见 §2）：每段渲染 `:accessibility-element="A11Y_ELEMENT_ENABLED"` + `:accessibility-label="option.a11yLabel"`；容器不绑 a11y（避免整组双曝光）。
- `disabled`：容器 `opacity-50`（对齐 TranslateModeSwitch 现状），段 `@tap` 短路。

**未引入的 props / emits**（YAGNI）：
- `icon` 段（M3 segmented 支持 icon+label 段）：5 处 callsite 均为纯文本 → 等真出现再加。
- `size` / `variant`：全仓仅 40dp 一种形态。
- `ariaLabel`（容器级）：容器不聚焦，无此需求。
- slot 式段内容：数据驱动组件，slot 是错误缝隙。

### 4.3 内部实现

组件内部隐藏的知识（对调用方不可见）：

- **容器**（1 份）：`flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline overflow-hidden`
- **段 i**（由 `segmentClass` 私有纯函数生成）：
  - 基础：`flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface`
  - 分隔线（**index > 0 自动附加**）：`border-l border-l-outline`
  - 选中：`bg-secondary-container`；未选：`bg-surface-container-lowest`
- **段文字**：`text-label-large` + 选中 `text-secondary-on-container` / 未选 `text-surface-on`

```ts
// M3SegmentedButton.vue script 内私有，不导出（组件自测专用缝隙）
function segmentClass(selected: boolean, index: number): string {
  const base =
    'flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface'
  const divider = index > 0 ? ' border-l border-l-outline' : ''
  const tone = selected ? 'bg-secondary-container' : 'bg-surface-container-lowest'
  return base + divider + ' ' + tone
}
```

### 4.4 调用方契约（5 处统一）

```vue
<script setup>
// options 必须 computed 构建：t() 语言切换时 label 自动重算
const aiOptions = computed<M3SegmentOption<AiFilterMode>[]>(() => [
  { value: 'show', label: t('me.content.aiShow'), a11yLabel: ME_A11Y_LABELS.aiFilterShow },
  { value: 'mask', label: t('me.content.aiMask'), a11yLabel: ME_A11Y_LABELS.aiFilterMask },
  { value: 'only', label: t('me.content.aiOnly'), a11yLabel: ME_A11Y_LABELS.aiFilterOnly },
])
</script>

<template>
  <!-- 整宽组（外观/动图/画质三形态） -->
  <M3SegmentedButton v-model="aiFilterMode" :options="aiOptions" />
  <!-- 或带副作用的调用方（外观模式等）：分解写法 -->
  <M3SegmentedButton :model-value="darkMode" :options="appearanceOptions"
                     @update:modelValue="pickAppearanceMode" />
</template>
```

具体 5 处映射：

| callsite | 段数 | modelValue 源 | update 处理器 | 特殊 |
|---|---|---|---|---|
| Me.vue L624 外观模式 | 3 | `darkMode`（storeToRefs） | `pickAppearanceMode`（含主题应用副作用 → 分解写法） | 容器外 `mb-4` 保留在父级 |
| Me.vue L853 AI 作品 | 3 | `aiFilterMode`（storeToRefs） | `settings.setAiFilterMode`（可直接 v-model 桥接或保留分解写法） | **本 bug 主角**；同行窄布局的行容器（label + 控件）原样保留 |
| Me.vue L901 动图播放 | 2 | `ugoiraMode` | `pickUgoiraMode` | 组标题/hint/尾注文案原样保留 |
| Me.vue L931 详情画质 | 3 | `detailQuality` | `pickDetailQuality` | 同上 |
| TranslateModeSwitch.vue | 2 | `showTranslation` 派生（`'original' | 'translation'`） | `pick`（disabled 门控 + `store.toggleMode`） | `disabled` prop 接 `!props.enabled`；壳注释 spec 引用更新 |

**行为零变化承诺**：5 处的选中值、持久化键、副作用逻辑、a11y label 字符串、行容器布局全部原样保留；唯一变化是 markup 收进组件 + AI 组获得分隔线。

### 4.5 不引入第二个 Adapter

与 ADR-0179 §4.6 同理：WebView 端（`packages/app` 的 `SettingsContent.tsx`）有自己的 segmented 先例（spec `docs/specs/ai-artwork-three-state-filter.md` L97 记录的 `role=group + aria-pressed` 形态），属 Fluent Design 2 上下文的不同 module，本次不为 `<M3SegmentedButton>` 预留跨端复用。

## 5. Testing Decisions

### 5.1 测试层级

| 缝隙 | 测试类型 | 文件 | 断言 |
|---|---|---|---|
| 公开缝隙（props + 接口边界） | 模板源码断言（`readFileSync` + 正则） | `M3SegmentedButton.template.test.ts` | `options` / `modelValue`（defineModel）/ `disabled` 三件套齐全；无 `icon` / `size` / `variant` 等未声明 prop |
| 内部纯函数（`segmentClass`） | 正则提函数体后精确字符串匹配 | 同上 | 段 0 无 `border-l`；段 1/2 有 `border-l border-l-outline`；选中/未选 tone 精确值 |
| 分隔线 N-1 规则 | 同上（逻辑断言） | 同上 | N 段渲染 N-1 条分隔线（n ∈ {2,3} 代表例） |
| 内部实现（视觉基线） | `toContain` 字面量 | 同上 | 容器 4 class + 段高 `h-[10.667vw]` + `text-label-large` + 4 个色 token 全部出现 |
| 段级 a11y 自持 | 正向断言 | 同上 | 模板含 `accessibility-element` + `a11yLabel` 绑定（与 M3Switch 的"a11y 缺席负向断言"方向相反，spec §4.2 为依据） |
| 防漂移（尺寸/颜色白名单） | 扫 w-/h- 与 bg- 类名白名单 | 同上 | 仅合法尺寸（`10.667vw`）与 4 个色 token 出现 |
| 机器门禁（迁移完备性） | 文件 grep + 计数 | `tests/m3-segmented-button-migration-gate.test.ts` | ① 全仓 `src/` 内 `rounded-[var(--md-shape-full)] border border-outline overflow-hidden` 仅 `M3SegmentedButton.vue` 命中（inline 残影 = 0）；② `<M3SegmentedButton` 调用总数 ≥ 5（Me.vue 4 + TranslateModeSwitch 1）；③ 组件存在且含容器特征串 |
| Me.vue 替换回归 | 模板测试（既有） | `packages/app-lynx/src/pages/meWebdavTemplate.test.ts` 等既有文件 | a11y 注册表断言继续过（labels 原样保留）；既有字面量断言不回归 |

### 5.2 好的测试特征

- **仅测外部行为与契约字面量**：segmentClass 测返回值字符串，不测"是否被调用"。
- **机器门禁是主要防线**：仓库无 vue-lynx 渲染器，CI 运行时验证不可行——file grep + count 是 M3Switch 已验证有效的范式（ADR-0097 机器防线要求）。
- **白名单防 characterization**：尺寸/颜色类名枚举合法集，新增未申报值即红。

### 5.3 已有同类测试范式

- `packages/app-lynx/src/components/M3Switch.template.test.ts`：接口边界 + 纯函数精确值 + 尺寸白名单（本组件测试直接对齐其结构）
- `packages/app-lynx/tests/m3-switch-migration-gate.test.ts`：file grep + count 门禁（本组件门禁对齐其结构）
- `packages/app-lynx/src/pages/meWebdavTemplate.test.ts`：a11y 注册表完整性断言（迁移后须继续绿）

### 5.4 视觉验证门禁（不可自动化）

- 真机 LynxView + web-core 预览：设置页 4 组 segmented 截图，段间分隔线可见、三态/亮暗/动态主题（6 色板）正常。
- 基线 = 本 spec 落地前「动图播放」组的视觉（参照组），AI 组与其逐 class 一致即通过。
- 原型（`prototype-m3-segmented-button.html` 变体 B）已预先验证视觉方向，实施时仅需真机确认无平台差异。

### 5.5 机器门禁（迁移完备性，新增）

`packages/app-lynx/tests/m3-segmented-button-migration-gate.test.ts`（CI 必跑，随 T2/T3 迁移完成而转绿）：

- 整仓 `packages/app-lynx/src/` 下 `rounded-[var(--md-shape-full)] border border-outline overflow-hidden` 仅 `M3SegmentedButton.vue` 命中（其他出现 = inline 回潮）
- `<M3SegmentedButton` 调用总数 ≥ 5
- `M3SegmentedButton.vue` 存在且含容器特征串（防组件被误删）

## 6. Out of Scope

1. **WebView 端分段控件改造**：`packages/app` 的 `SettingsContent.tsx` 有独立先例（Fluent Design 2 上下文），另属不同 module；跨端统一另立 effort。
2. **AI 作品组布局变更**：保持"label 同行、控件占行宽余量"的窄布局（与页内 M3Switch 行同构）。"丑"的成因是分隔线缺失，宽度差异不是缺陷（Grill 阶段用户已确认）。
3. **滑动指示器变体（C 案）**：原型对比后否决——分段线填充式（B 案）与全仓 M3 基线一致，C 案作为原型产物留存 throwaway 分支，不进入实现。
4. **登录/下载等 primary 圆角按钮**：`bg-primary` 实心按钮非 segmented 模式，不在本 spec。
5. **`<M3Radio>` / `<M3Checkbox>` 等控件族扩展**：仍无重复迹象（ADR-0179 的 YAGNI 断言对它们继续成立）；待 falsified 时再立项。
6. **props 扩展**（`icon` 段 / `size` / `variant`）：当前 5 处需求均无，YAGNI。
7. **业务语义改动**：AI 三态过滤（ADR-0155）、外观模式（ADR-0180）、动图帧提取模式、详情画质的设置键与持久化逻辑均**不**触碰。
8. **i18n 字典 / a11y 注册表 value**：现有 `me.content.*` / `me.appearance.*` / `me.ugoira.*` / `me.quality.*` 文案与 `ME_A11Y_LABELS` key/value **不**触碰；调用方原样引用。
9. **M3 几何常数 token 化**（`10.667vw` 入 `tokens.css`）：沿用 ADR-0179 §6.5 的既有裁定，待控件族扩展时统一抽象。

## 7. Further Notes

### 7.1 与既有 ADR 的关系

- **ADR-0179**（`<M3Switch>` 组件）：同范式先驱（组件 + template test + migration gate 三件套）；其 Out of Scope 中"`<M3SegmentedButton>` 无重复迹象 YAGNI"的断言被本 spec 正式 falsified 并收口。
- **ADR-0155**（AI 作品三态过滤）：AI 组的业务语义决策；本次仅重构 UI 渲染层。
- **ADR-0180**（外观模式）：外观组 segmented 的业务语义；本次仅重构 UI 渲染层。
- **ADR-0097**（机器防线）：migration gate 测试的锚定依据。

### 7.2 与既有 SPEC 的关系

- `docs/specs/ai-artwork-three-state-filter.md` L97 记录 webview 端分段控件先例（未规定 lynx 段间分隔线样式）——本 spec 补齐 lynx 侧并收敛为组件单点。
- `docs/specs/app-lynx-m3-switch.md` §6.3 的"`<M3SegmentedButton>` YAGNI"条目随本 spec 立项而失效（实施时在该 spec 加一行指向本 spec 的注记，可选）。

### 7.3 原型处置

`packages/app-lynx/prototype/prototype-m3-segmented-button.html`（变体 A=现状对照 / B=定稿 / C=否决备选）随实现 commit 提至 throwaway 分支留存（主源证据），不进 main；定稿结论记录于本 spec §2。

### 7.4 后续 ticket 拆解（to-tickets 阶段产出）

按依赖顺序建议拆为 4 张 ticket：
1. **T1：`<M3SegmentedButton>` 组件 + template test**（纯新增，无 callsite 替换）
2. **T2：Me.vue 4 处 callsite 替换**（AI 组 bug 修复随此生效；含既有模板测试回归）
3. **T3：TranslateModeSwitch.vue 迁移**（disabled 语义接管）
4. **T4：migration gate + ADR-0190 + CONTEXT.md 术语**（最后提交文档，确保 ADR 编号落地）

### 7.5 风险与监控

| 风险 | 缓解 |
|---|---|
| 某 callsite 漏替换 / inline 回潮 | **机器门禁**（§5.5）：容器特征串全仓清零 + 调用数 ≥ 5 |
| 语言切换时 label 不重算 | options 强制 computed 构建（§4.2），template test 断言调用方示例 |
| a11y label 字符串被改写绕开注册表 | 注册表完整性测试（既有）继续覆盖；labels 原样保留、仅搬运位置 |
| TranslateModeSwitch disabled 语义漂移 | 迁移后 `disabled` prop 行为由组件 template test 断言（容器 opacity + tap 短路） |
| 迁移引入视觉差异（非 AI 组） | 白名单 + 字面量断言锁死段 class；视觉基线 = 迁移前参照组截图（§5.4） |
| vue-tsc 泛型 SFC 兼容 | `generic="T extends string"` 为 Vue 3.5 官方 SFC 特性；T1 先行落地验证 `pnpm check:app-lynx` |

### 7.6 一句话总览

**抽 `<M3SegmentedButton>` 作为 app-lynx M3 分段控件唯一权威实现：段间分隔线按 index 自动生成从结构上根治"修 2 漏 1"，5 处 inline 拷贝收口为组件调用，「AI 作品」视觉破碎感随迁移自动修复；行为、a11y、文案零变化，机器门禁防回潮。**
