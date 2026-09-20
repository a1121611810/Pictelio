# ADR-0179: app-lynx `<M3Switch>` 组件抽取——10+2 处 inline markup 收口

- 状态: Accepted（2026-09-20）
- 日期: 2026-09-20
- 关联: spec [docs/specs/app-lynx-m3-switch.md](../specs/app-lynx-m3-switch.md)；父 issue [#677](https://github.com/a1121611810/Pictelio/issues/677)；实施 [#678](https://github.com/a1121611810/Pictelio/issues/678) / [#679](https://github.com/a1121611810/Pictelio/issues/679) / [#680](https://github.com/a1121611810/Pictelio/issues/680)；关联 ADR-0164（auto-fallback 业务）/ ADR-0168（全屏模式业务）/ ADR-0051（R18/R18G 业务）

## 背景

`packages/app-lynx/src/pages/Me.vue` + `packages/app-lynx/src/components/SettingsEndpoint.vue` 共有 **12 处** M3 开关 inline markup 复制（spec 估 10 处，实测 12——含 2 处 novelExport 开关 + 1 处 webdavEnabled 开关也是一字不差的 M3 markup，初稿漏数）。所有 callsite 都是同一份 M3 spec v0.192：track 52×32dp、thumb 24/16/28dp ON/OFF/press、handle-container 32×32、`bg-primary` / `bg-primary-on` / `bg-surface-container-highest` / `bg-outline` 4 个颜色 token、`var(--durationNormal)` + `var(--motion-standard)` 2 个 motion token。

直接后果：
1. **Drift 风险**：任何一处 typo（class 漏写、顺序错位、token 引用错误）只会让该行悄悄走样，单测与快照都难以及时发现。
2. **auto-fallback ON 态渲染塌陷**（用户 2026-09-20 截图实证）：自动回退 WebView 开关在 ON 态显示为「蓝圈 + 白心」，而非应有的「M3 ON 态蓝 pill + 白 thumb」。同文件 R18/R18G/relatedInjection/rankingEntry 在 ON 态渲染正常。12 处 inline 缺乏单点真理源，定位与修复路径被稀释。
3. **a11y 不变量无法集中保障**：现有模板测试逐行断言 `accessibility-label="ME_A11Y_LABELS.${key}"`，12 行 = 12 份相同断言；任一调用方传错字符串绕开注册表，单测形同虚设。
4. **业务改动易污染 UI 层**：未来 M3 规范升级（M3 v0.193+ 调整 thumb 比例）、设计系统改名（`bg-primary-on` → `bg-on-primary`）、motion token 重命名等修改，需在 12 处散落同步替换。

业务侧诉求：保持视觉与现有 R18 等 4 处基线一致，消灭 drift，定位并修复 auto-fallback 渲染异常；为后续新增开关提供零成本接入点。

## 决策

抽取一个 `<M3Switch>` Vue 组件作为 app-lynx M3 开关单点真理源，承载 M3 规范 v0.192 的 5 个尺寸常量、4 个颜色 token、2 个 motion token——共 **3 个知识维度**藏在公开接口后（**纯视觉开关控件**）。

### 公开接口（仅 `checked` 一个 prop）

```ts
defineProps<{
  checked: boolean      // 受控状态：调用方拥有 source of truth
}>()
```

**无 a11y 绑定、无 `@tap` 绑定、无 `defineEmits`**：a11y 注入（`accessibility-element` + `accessibility-label`）与 `@tap="<toggleFn>"` 翻转事件责任**留在父级 `<view>` 行容器**。

### 内部实现（隐藏在接口后）

- M3 规范 v0.192 几何（13.867/8.533/6.4/4.267/7.467 vw）
- 4 个颜色 token（`bg-primary` / `bg-primary-on` / `bg-surface-container-highest` / `bg-outline`）
- 2 个 motion token（`--durationNormal` / `--motion-standard`）
- 状态→类名映射逻辑（私有纯函数 `trackClass(checked)` / `thumbClass(checked)`）

私有纯函数（`trackClass` / `thumbClass`）作为组件的内部测试缝隙——不进公开接口，仅组件自身单测可独立验证状态→类映射（**精确字符串匹配**，非 substring 防 characterization）。

私有纯函数（`trackClass` / `thumbClass`）作为组件的内部测试缝隙——不进公开接口，仅组件自身单测可独立验证状态→类映射。

### 行为约束（保留现有 UX）

调用方形态（12 处统一）：
```vue
<view
  :accessibility-element="A11Y_ELEMENT_ENABLED"
  :accessibility-label="ME_A11Y_LABELS.<key>"
  @tap="<toggleFn>"
>
  <text>{{ t('<key>.title') }}</text>
  <M3Switch :checked="<ref>" />
</view>
```

行级 `@tap` 保留「点击行内任意位置（含文字标签）触发 toggle」的本仓历史 UX；行级 a11y 标签对应 a11y 注册表 key，**避免与 M3Switch 自身 a11y 双暴露导致 TalkBack 双重播报**。

### 调用方改造清单（实测 12 处；spec 初稿估 10 处漏数 2）

| 文件 | callsite 数 | 关键 |
|---|---|---|
| `Me.vue` | 10 | autoFallbackEngine / fullscreenMode / r18Toggle / r18gToggle / relatedInjectionToggle / rankingEntryToggle / novelExportIncludeMetadata / novelExportIncludeCover / novelExportIncludeImages / webdavToggle |
| `SettingsEndpoint.vue` | 2 | translateR18 / translateR18G |
| **合计** | **12** | |

迁移后 `grep -rn 'w-\[13.867vw\]' packages/app-lynx/src/` 仅命中 `M3Switch.vue` 1 处 + 测试文件 2 处（断言字面量），所有 callsite 已迁出 inline。

## 否决的替代方案

- **v-model 自管状态（`defineModel` / `modelValue`）**：增加内部状态 → 接口变厚 → 单测需双倍 setup；caller 已用 settingsStore 拥有真理源，没必要再来一份。
- **`disabled` / `variant` / `loading` props**：当前 12 处需求均无 → YAGNI，等真出现再加。
- **slot 注入 label**：开关本身不带文案（左标题是 caller 行的内容），slot 是错误缝隙。
- **composable `useM3Switch()`**：不符 vue-lynx 习惯；组件是 Vue 原语。
- **预设 Fluent 变体**：webview 端是另一套设计系统（Fluent Design 2），不是同一缝隙的另一个 adapter——那是不同 module，不要硬塞进 M3Switch。本次**不**在 `<M3Switch>` 预留 Fluent 变体。
- **M3 几何常数 token 化**（将 `13.867vw` 等移入 `tokens.css`）：当前 inline arbitrary value 在 12 处表现一致，无 token 化紧迫性；待 M3 控件族扩展（`<M3Radio>` / `<M3Checkbox>` / `<M3SegmentedButton>`）时再做统一抽象。当前 YAGNI。

## 后果

### 正面
- **Drift 免疫**：未来 M3 规范升级、颜色 token 改名、motion token 重命名——改 1 处即生效 12 处 callsite。
- **A11y 责任清晰**：行级 `<view>` 容器统一绑 `A11Y_ELEMENT_ENABLED` + 注册表 key，a11y 双暴露问题（行 + M3Switch 各自绑同一字符串）被消除——TalkBack 不再重复播报。
- **测试面集中**：公开缝隙（`checked` 唯一 prop）+ 内部纯函数精确字符串匹配双层测试。组件自测覆盖**接口边界**（仅 `checked`，无 `ariaLabel` / `label` / a11y / `@tap` / emit，2 条）+ **M3 spec 几何/颜色/动效**（9 条）+ **a11y/emit 缺席负向**（5 条）+ **私有纯函数精确值**（4 条）+ **尺寸白名单防漂移**（1 条）= 21 条单测（test strength 防 characterization）。额外 5 条**机器门禁**（`m3-switch-migration-gate.test.ts`：Me.vue / SettingsEndpoint.vue `<M3Switch` ≥ 6 + ≥ 2；`w-[13.867vw]` 残影 = 0；M3Switch.vue 存在）防未来回退到 inline。
- **auto-fallback 渲染塌陷真因 + 同步 fix**：v2 决策时假设组件化可绕过父行 layout 副作用，v3 真因是「父行 `flex flex-col` 长描述（>40vw）+ flex 默认 `flex-shrink: 1` 导致 track 被挤塌到 `w-8 h-8` = 32×32 蓝圈 + 居中 24×24 白圆」。Fix：**track 静态 class 加 `flex-shrink-0`**——锁死主轴尺寸，描述文案再长 track 不塌。R18/R18G/relatedInjection/rankingEntry（1 行文案）原本不塌；auto-fallback/fullscreen（2 行文案）实际都塌但 OFF 态肉眼不易察觉。Fix 后 12 处 callsite 全部正确渲染。
- **回归基线锚点**：用户提供的「正确显示应该是这样的」截图（R18/R18G/relatedInjection/rankingEntry ON 态 4 枚）成为未来所有 M3 switch 渲染的视觉 oracle。
- **机器门禁防回退**：新增 `packages/app-lynx/tests/m3-switch-migration-gate.test.ts`（CI 必跑）——`grep '<M3Switch' Me.vue SettingsEndpoint.vue` ≥ 12 + 整仓 `w-\[13.867vw\]` 仅 M3Switch.vue 命中（防未来回归到 inline）。

### 代价 / 风险
- **新增 2 个文件**：`packages/app-lynx/src/components/M3Switch.vue`（~30 行）+ 测试文件 ~180 行 + 机器门禁 ~50 行。
- **a11y 责任上移**：组件不再绑 a11y，全部责任在调用方 `<view>` 行。若未来某个调用方忘记绑 a11y，TalkBack 看不到该开关——靠行级 `meWebdavTemplate.test.ts` 注册表断言兜底（已存在，覆盖 webdav*）。
- **模板属性映射差异**：vue-tsc 不接受 kebab-case 模板属性映射到 camelCase prop（`:aria-label` → `ariaLabel` 类型不匹配），调用方如需传 prop 必须用 `:ariaLabel` camelCase 模板属性。本仓库既有 lynx 平台属性 `:accessibility-label` 不受影响（那是 lynx 原生属性，不是 Vue prop）——本决策下完全消除该问题（`<M3Switch>` 无字符串 prop）。
- **novelExport/webdavEnabled 三处 UX 升级**：原本 novelExport 开关缺按压态（无 `active:` class）+ 28dp pressed size；webdavEnabled 开关简化版（无 handle-container + `flex items-center px-[1.067vw]` thumb），迁移到 `<M3Switch>` 后一律升级到完整版（M3 spec 严格符合），UX 统一。**SettingsEndpoint 两处 translateR18/R18G 也获得 transition + handle-container + pressed state**（此前缺失），同步升级到完整 M3 spec。
- **未来若加 `disabled` / `loading` 等 props**：API 扩 surface 是约定，但需重新审视 single-source-of-truth 与 caller 行为契约。

### 排除面
- **WebView 端 `<fluent-switch>` 改造**：Fluent Design 2 与 M3 设计系统不同；强行复用 `<M3Switch>` 跨设计系统不合理。如要统一跨端开关视觉，另立 effort（前置：先解决双客户端设计系统差异的策略问题）。
- **auto-fallback 渲染塌陷**：v3 已 fix（track 加 `flex-shrink-0`），不再开独立 ticket。
- **M3 控件族扩展**（`<M3Radio>` / `<M3Checkbox>` / `<M3SegmentedButton>`）：本 ticket 仅抽出开关；其他控件的抽取是后续 effort（且当前无重复迹象，YAGNI）。
- **业务逻辑改动**：自动回退引擎、全屏模式、R18/R18G 等开关的语义、设置键、持久化逻辑均**不**触碰。
- **i18n 字典 / a11y 注册表 value**：均**不**触碰；组件只引用既有 key。