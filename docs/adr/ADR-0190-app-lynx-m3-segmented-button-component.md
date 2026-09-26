# ADR-0190: app-lynx `<M3SegmentedButton>` 组件抽取——5 处 inline 分段控件收口

- 状态: Accepted（2026-09-26）
- 日期: 2026-09-26
- 关联: spec [docs/specs/app-lynx-m3-segmented-button.md](../specs/app-lynx-m3-segmented-button.md)；术语 [packages/app-lynx/CONTEXT.md](../../packages/app-lynx/CONTEXT.md)「分段控件」；原型 `packages/app-lynx/prototype/prototype-m3-segmented-button.html`（B 案定稿）；关联 ADR-0179（`<M3Switch>` 同范式先驱）/ ADR-0155（AI 作品三态业务）/ ADR-0180（外观模式业务）/ ADR-0097（机器防线）

## 背景

用户实证：设置页「AI 作品」模块（Me.vue L850-882，ADR-0155 三态过滤）的操作按钮"很丑、与同类型不一样"。调查（git 实证）：

1. **直接根因**：commit `7eb0f5eb`「系统性对齐 M3 官方组件规范(15 项)」（2026-08-11）给 segmented button 补「段间 `border-l-outline` 分隔线」时，改了 ugoira 段 2 / quality 段 2+3 共 3 处，**唯独漏改 AI 作品组段 2/3**。未选段底色 `bg-surface-container-lowest`（#fff）= 卡片底色，段间又无分隔线 → 三段融成一条白边条，只剩外框和选中段可见。
2. **系统性病灶**：同一 segmented 模式在 app-lynx 有 **5 处一字不差的拷贝**——Me.vue L624（外观模式）/ L853（AI 作品）/ L901（动图播放）/ L931（详情画质）+ TranslateModeSwitch.vue L29（小说翻译模式）。无共享组件，"修 2 漏 1"是必然复发的 drift。
3. **ADR-0179 的 YAGNI 断言失效**：其 Out of Scope 曾写「`<M3SegmentedButton>` 当前无重复迹象，YAGNI」——现已被 5 处拷贝 + 真实漏改 bug falsified，本 ADR 即收口。

已排除项（调查实证）：非 scoped CSS、非硬编码色值、非尺寸问题；非交互行为问题。

## 决策

抽取 `<M3SegmentedButton>` Vue 组件作为 app-lynx M3 分段控件唯一权威实现。**关键机制：段间分隔线由段 index 自动生成**（index > 0 恒带 `border-l border-l-outline`，N 段 = N-1 条）——"修 2 漏 1"从结构上不可能再发生。

### 公开接口（options + v-model + disabled）

```ts
interface M3SegmentOption<T extends string> {
  value: T          // 枚举值：选中即 v-model 的值
  label: string     // 已解析文案（t() 结果；options 用 computed 构建随语言切换重算）
  a11yLabel: string // 静态 a11y label（调用方继续引用 ME_A11Y_LABELS 注册表 key）
}
// props: { options: M3SegmentOption<T>[]; disabled?: boolean }
// defineModel<T>()（v-model 受控；带副作用调用方可 :model-value + @update:modelValue 分解）
```

**段级 a11y 组件自持**（每段 `accessibility-element` + `:accessibility-label="option.a11yLabel"`）；`disabled` = 容器 `opacity-50` + 段 tap 短路。

### 与 ADR-0179 `<M3Switch>` 的哲学对照（为何接口更厚）

M3Switch 是**纯视觉**（a11y 与 `@tap` 上推父级行——整行一个焦点）。分段控件**无法照搬**：每段是独立可聚焦元素、label 各不相同、点击目标在段内——a11y 与选择事件只能组件自持。接口厚度由交互粒度决定，非随意增厚。

### 内部实现（隐藏在接口后）

- 容器：`flex flex-row gap-0 rounded-[var(--md-shape-full)] border border-outline overflow-hidden`
- 段（私有纯函数 `segmentClass(selected, index)` 生成完整类串）：`flex-1 h-[10.667vw] flex items-center justify-center active:bg-layer-pressed-on-surface` + index 分隔线 + 选中 `bg-secondary-container` / 未选 `bg-surface-container-lowest`
- 段文字：`text-label-large` + 选中 `text-secondary-on-container` / 未选 `text-surface-on`
- `segmentClass` 作为内部测试缝隙（组件自测正则提取函数体做精确字符串匹配，不进公开接口）

### 调用方改造清单（5 处）

| 文件 | callsite | 段数 | 特殊 |
|---|---|---|---|
| Me.vue | 外观模式 / AI 作品 / 动图播放 / 详情画质 | 3/3/2/3 | AI 组 = 本 bug 主角，修复随迁移生效；外观模式用分解写法接 `pickAppearanceMode` 副作用 |
| TranslateModeSwitch.vue | 小说翻译 原文/译文 | 2 | `disabled` prop 接 `!enabled`；store 派生 modelValue |

迁移后行为零变化：选中值、持久化键、副作用、a11y label 字符串、行容器布局全部原样保留；唯一变化是 markup 收进组件 + AI 组获得分隔线。

## 否决的替代方案

- **最小修复（只给 AI 组补 2 个 class）**：修复表象但复制粘贴结构仍在——已实际 drift 一次（7eb0f5eb），未来必然复发。用户明确拍板"抽取公共，再复用"。
- **滑动指示器变体（iOS 风 pill，原型 C 案）**：结构不同（需动效 + 段宽测量），超出"对齐"范畴；原型对比后否决，仅留存 throwaway 分支。
- **a11y 责任上推父行（照搬 M3Switch）**：分段每段独立焦点、label 各异，上推意味着调用方手写 v-for——组件失去存在意义。
- **slot 式段内容**：数据驱动控件，slot 是错误缝隙。
- **`icon` 段 / `size` / `variant` props**：5 处 callsite 均为纯文本 40dp 单形态 → YAGNI。
- **WebView 端复用**：`packages/app`（Fluent Design 2）是不同 module 的不同设计系统，不预留跨端 adapter。

## 后果

### 正面
- **Drift 免疫**：分隔线按 index 生成 + 视觉 token 单点——M3 规范升级、增删段、新增调用方均不再产生"N 处同步修改"。
- **AI 组视觉自动修复**：迁移即修复，与参照组逐 class 一致。
- **a11y 不变量集中**：段级 label 经 options 静态传入，注册表完整性测试继续生效；组件 template test 正向断言 a11y 绑定。
- **测试面集中**：组件 template test（接口边界 + 纯函数精确值 + 分隔线 N-1 + 白名单）+ migration gate（inline 容器特征串全仓清零 + 调用数 ≥ 5，CI 必跑，ADR-0097）。
- **零成本接入点**：新增分段控件 = options 数组 + v-model。

### 代价 / 风险
- **接口比 M3Switch 厚**（a11y + emit 自持）：由交互粒度决定（见「哲学对照」），非缺陷。
- **options 须 computed 构建**：t() 语言切换重算依赖响应式；契约已写入 spec §4.2，template test 锁示例。
- **泛型 SFC**：`generic="T extends string"` 依赖 Vue 3.5 SFC 特性（当前 vue 3.5.40 满足）；T1 落地即过 `pnpm check:app-lynx` 验证。
- **TranslateModeSwitch UX 微变化风险**：disabled 语义由组件统一（容器 opacity-50），与原 inline 写法等价——由 template test 断言锁死。

### 排除面
- WebView 端分段控件（SettingsContent.tsx 独立先例）；AI 组布局变更（保持同行窄布局）；登录/下载等 primary 圆角按钮；`<M3Radio>` / `<M3Checkbox>`（仍无重复迹象，YAGNI 断言对它们继续成立）；业务语义与 i18n / a11y 注册表 value。
