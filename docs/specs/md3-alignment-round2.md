# MD3 对齐整改 spec（2026-10-01）

> 上游依据：`docs/research/md3-conformance-audit-2026-10-01.md`（复核报告）
> 决策依据：`docs/adr/ADR-0209-md3-filled-text-field-alignment.md`（本轮新增）
> 上游决策：`docs/adr/ADR-0205-md3-baseline-and-scope.md` 决策 4（封闭豁免清单）/ 决策 6（三层证据）/ 决策 7（关闭需证据）
> 样本口径：生产 `.vue` = `src/` 下排除 `.test.` 与 `errorPrototype/`，共 **75 个文件**（实测）

## 0. 范围与已锁定决策

| # | 事项 | 决策 | 依据 |
|---|---|---|---|
| 1 | 表单输入框 | **17 处 `<input>` 全部整改为 M3 filled text field**（含 17 处的 label 浮动） | 用户拍板 |
| 2 | 搜索框药丸 | **不动** | ADR-0205 决策 4 第 2 条已豁免，封闭清单不得扩张 |
| 3 | disabled 令牌化 | **只改 6 处低风险**（BookmarkPanel:327 + DownloadManager×5），8 处视觉变更另开票登记为知情债 | 用户拍板 |
| 4 | a11y 语义 | **先做真机探针**验证引擎是否消费 role/state，拿到证据再决定开票 | 用户拍板（对标 ADR-0207 决策 5 先例） |
| 5 | M3Switch 组件 | **不动**（不推翻 ADR-0179 的「无 a11y 绑定」刻意设计） | 用户拍板 |
| 6 | 门禁盲区 | 修 `motionDurationTokens` 的扫描面 + 回退实参盲区 | 本 spec 范围 |

## 1. 关键事实纠正（本轮实测，覆盖此前所有口径）

### 1.1 MD3 filled text field 官方规格（回源核对，ADR-0205 决策 1）

| 项 | **官方真值** | 来源 |
|---|---|---|
| 容器高度 | 56dp | AndroidX `TextFieldDefaults.kt` `MinHeight = 56.dp` |
| 圆角 | 顶 4dp / **底 0dp** | `corner-extra-small-top: (4px 4px 0px 0px)` |
| 指示条位置 | **底部**（非顶部） | `field/internal/_filled-field.scss`：`.active-indicator { inset: auto 0 0 0 }` + `border-bottom` |
| 指示条厚度 | 未聚焦 **1px** / 聚焦 **2px** | `active-indicator-height: 1px` / `focus-active-indicator-height: 2px` |
| 指示条颜色 | `on-surface-variant` → 聚焦 `primary` | `_md-comp-filled-text-field.scss` |
| 容器色 | `surface-container-highest` | 同上 |
| label 字号 | 静止 `body-large` → 浮动态 `body-small` | 同上 |
| label 颜色 | `on-surface-variant` → 聚焦 `primary` | 同上 |

来源 URL 见 ADR-0209 决策 1（不在本表重复抄写，避免两处漂移）。

> ⚠️ **教训**：此前口径「顶 4dp/底 12dp + 顶部 4dp 色带」**两处错误**，与 `easing-standard` 误判同属「凭印象填 MD3 数值」。回源核对是硬要求。

### 1.2 范围实测纠正

| 项 | 此前口径 | **实测** |
|---|---|---|
| `<input>` 总数 | 6 处 | **17 处 / 6 个文件** |
| 分布 | 未知 | `Me.vue` ×7、`SettingsEndpoint.vue` ×6、`BookmarkPanel` ×1、`CommentInputBar` ×1、`Login.vue` ×1、`SearchSheet` ×1（豁免不动） |
| 形态 | 3 类 | `Me.vue` 7 处**完全同构**；`SettingsEndpoint` 5 处可见全同构（+1 待查）；`Login`/`CommentInputBar` 各 1 处同构；`BookmarkPanel` 1 处；`SearchSheet` 1 处豁免 |
| disabled 文件数 | 13 | 13 个文件匹配，但 `BookmarkButton.vue` 唯一命中是**注释** ⇒ **实际需改 12 文件** |
| a11y 语义属性 | 缺 | `accessibility-role/state/checked/disabled/selected/expanded/value` **全仓 0 命中**（确认） |

### 1.3 引擎能力前提（已核实）

- ✅ **Lynx `<input>` 支持 `bindfocus` / `bindblur`**（Android/iOS/Harmony，since 3.4；本项目 SDK 4.0.1）⇒ label 浮动**可实现**。
  来源：https://lynxjs.org/3.6/api/elements/built-in/input （Events 段）
- 与 ADR-0207 决策 5 **不冲突**：死的是 `:focus` **伪类**，活的是 focus **事件**。实现走事件驱动的响应式 class。
- ⚠️ `@lynx-js/types` 在 `node_modules` 中**不存在**（被 `skipLibCheck` 掩盖）⇒ **vue-tsc 对 Lynx 内建元素属性零校验**。写 `bindfocus` 不会报类型错，也**没有编译期保护** ⇒ 必须靠单测 + 真机验证兜底。
- ⚠️ `pointer-events-none` 在本项目是**死类名**（preset 白名单不含 `pointerEvents`，`tests/lynxUnsupportedTailwindClasses.test.ts:141` 是全仓硬门禁）⇒ disabled **必须**靠 handler 内部短路，**不能**依赖 CSS。

## 2. 任务 A：filled text field 对齐（17 处）

### A1 · 形态统一（`Me.vue` ×7 / `SettingsEndpoint.vue` ×5 / `BookmarkPanel` ×1）

目标 class 形态（官方规格逐项对应）：

```
h-[14.933vw]                                    ← 56dp
box-border
bg-surface-container-highest                    ← 官方 container-color
rounded-t-[var(--md-shape-extra-small)]         ← 顶 4dp
rounded-b-none                                  ← 底 0dp（官方 corner-extra-small-top）
border-b-[1px] border-b-surface-on-variant      ← 底部指示条 1px + on-surface-variant
text-body-large text-surface-on                 ← 输入文字 body-large + on-surface
```

已命中的（`Login.vue`、`CommentInputBar.vue`）：形态已对，仅缺**聚焦态**（指示条 2px + primary）与 **label 浮动**。
`Me.vue` 7 处**缺 `border-b`**（无底部指示条）——需补。
`BookmarkPanel` 1 处：42dp 药丸 → 全面改造。
`SettingsEndpoint` 5 处：45dp + 中圆角 + **全描边** → 改为底部指示条（去掉 `border border-outline`）。

### A2 · label 浮动（17 处）

- 新增 i18n key：各 input 需要独立 label 文案（当前 `Me.vue` 的 5 个 webdav 字段**只有 `*Placeholder`、无 label**）。
  需在 `src/i18n/locales/{zh-CN,en}/pages.ts` 补 key（**两语种必须同步**）。
- 浮动判定：`focused = bindfocus 触发 || v-model 非空`（官方语义：有值或聚焦即浮动态）。
- label 视觉：静止 `body-large` + `on-surface-variant`；浮动态 `body-small` + `primary`。
- 指示条：静止 1px `surface-on-variant`（= 官方 `active-indicator-color: on-surface-variant`）；
  聚焦 2px `primary`。⚠️ **不是 `outline-variant`** —— 那是 outlined 变体的色，
  本轮实现期由实施子代理回源纠出（ADR-0209 决策 1 的正文原本就对，是本 spec 与门禁初稿抄错）。

### A3 · 门禁（新建 `tests/md3FilledTextField.test.ts`）

- 断言：全仓生产 `<input>` 的高度类 ∈ {`h-[14.933vw]`}（豁免的 `SearchSheet` 走白名单登记）
- 断言：非豁免 input 必带 `rounded-t-[var(--md-shape-extra-small)]` + `rounded-b-none` + `border-b-`
- 断言：反事实——塞一个 42dp 药丸形态进去必须转红
- 断言：抽取器自身有效（扫描面非空 + 数量下界，防正则塌陷导致恒真）
- 门禁登记制：豁免项走 `tests/md3-guard-whitelist.json` 同款台账，且**死登记必须转红**

## 3. 任务 B：disabled 令牌化（6 处低风险）

改用 `bg-state-disabled-container`（= `var(--md-state-disabled-container)`）：

| 点位 | 现状 | 说明 |
|---|---|---|
| `BookmarkPanel.vue:327` | `opacity-*` + `bg-surface-container-high` | 有底色 ⇒ 叠加安全 |
| `DownloadManager.vue:266/277/288/299/308` | `opacity-*` + `bg-surface-container-lowest` | 同构 5 处，一票 |

- **必须保留 `@tap` 短路**（`pointer-events-none` 是死类名）——子代理核查确认 17 处全部已有短路 ✅
- 会撞的既有测试：`tests/unit.test.ts:2183`（硬编码 `"busy ? 'opacity-40'"`，属 `WatchlistPromptDialog`，本票不改）、`ActionButton.template.test.ts`（`opacity-50`，本票不改）——需确认不误伤
- 另登记（不改）：8 处视觉变更 + `CommentItem`（busy 非控件 disabled，MD3 无对应令牌）+ `M3SegmentedButton`（子段 bg 盖住容器底色 ⇒ 改了是**假整改**，须改段级，另开票）

## 4. 任务 C：a11y 真机探针（先探针，不直接改）

- 目标：验证原生 Lynx 4.0.1 是否消费 `accessibility-role` / `accessibility-state` / `accessibility-checked`
- 手法：对标 ADR-0207 决策 5 的阳性对照探针（写属性 → 真机 dump 树看是否出现）⇒ **必须带阳性对照**，否则「没变化」无法区分「引擎不支持」与「探针没生效」
- 产出：结论写进术语文档 + ADR；**未拿到证据前不开 a11y 实施票**
- 探针本身属真机动作，**CI 不进**（ADR-0084）

## 5. 任务 D：门禁盲区修复

见 ADR-0209 与 `motionDurationTokens.template.test.ts` 的整改要求：
1. `SOURCES` 从硬编码 3 文件 → **扫全仓生产 `.vue`**
2. `scanDurations` 第 123 行的整段 `var()` 摘除 → 改为**只摘变量名、保留回退实参参与判据**
3. `fab-ring-spin` 令牌化到 `var(--durationExtraLong4)` + 删除已失准的 `LITERAL_EXCEPTIONS` 登记
4. `--shimmer-motion` 给真实定义（走 `--durationExtraLong4`），消除 `App.vue` 的 `1.5s` 回退实参
5. 判别力：**反事实**（旧整段摘除判据对 `var(--x, 200ms)` 不红 / 现行判据红）+ **阳性对照 load-bearing**

## 6. 验收标准（ADR-0205 决策 6 三层证据）

| 层 | 本票交付 |
|---|---|
| ① 静态审计 | 新增/修改的门禁全绿；`pnpm test` 全量不回归（基线 3136 断言） |
| ② 真机截图 | **必须**：17 处输入框形态变更属观感类，需 `capture-md3-matrix.sh` 截图留档 |
| ③ e2e 断言 | 数值类（56dp 高度、指示条厚度）可断言；观感类不由 e2e 假装能判 |

**不满足即视为未关闭**（ADR-0205 决策 7）。

## 7. 明确不做（防范围蔓延）

- ❌ 动态色（ADR-0205 决策 4 第 1 条）
- ❌ 搜索框药丸改造（同上第 2 条）
- ❌ 二级 tab 48px（同上第 3 条）
- ❌ `hover:` 伪类（同上第 4 条）
- ❌ 推翻 ADR-0179（M3Switch 组件 a11y 绑定）
- ❌ 8 处 disabled 视觉变更（另开票）
- ❌ `M3SegmentedButton` 段级改造（另开票）
- ❌ 引擎妥协项（`on-primary` 预合成状态层、Expressive spring）
