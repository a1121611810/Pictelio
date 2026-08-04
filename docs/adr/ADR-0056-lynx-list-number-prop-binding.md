# ADR 0056: lynx list number 类型属性必须 v-bind 数字绑定（列数契约）

## 状态

已采纳（真机 OPPO R11s 两列验证通过）

## 分类

技术决策 / Bug 修复 / 跨端契约

## 日期

2026-08-02

## 背景

`packages/app-lynx` 推荐页（`Recommended.vue`）瀑布流出现**端差异**：web-core 预览（dev server）一行两列，打包到 Android 原生 LynxView 后变成单列。按"web 正常 → 原生异常"直觉排查，实际根因相反——**web-core 是宽容方，原生是严格方**：

1. `<list list-type="waterfall" span-count="2">`（字符串 attribute）在 web-core 正常两列，Android 单列。
2. 尝试 `column-count="2"`（字符串）仍单列；`:column-count="2"`（数字）仍单列。
3. 最终 `:span-count="2"`（**数字绑定 + span-count 属性名**）原生两列。

### 根因链

| 层 | 行为 | 证据 |
|---|---|---|
| vue-lynx 编译器 | 静态 attribute 一律编码为**字符串**（`"span-count": "2"`）；v-bind 数字保留数字（`:span-count="2"` → `"span-count": 2`） | `dist/main.lynx.bundle` 产物对比 |
| web-core | `parseFloat(getAttribute("span-count") \|\| getAttribute("column-count") \|\| "") \|\| 1` 宽松解析，字符串/数字都工作 | `@lynx-js/web-core` `web-elements.js` 源码 |
| Android 原生（fiber/内部 list） | vue-lynx 走 `__CreateList` + `__SetAttribute`，number 类型属性**只接受数字值**，字符串被拒绝 → 列数回退默认 1 | vue-lynx 官方 plan（`plans/0304-1-native-list-element-support.md`）明示字符串为 WRONG |
| Android `@LynxProp(name="column-count")` | **radon 旧路径**的列数 setter（`AbsLynxList.setColumnCount(int)`），内部 list（fiber）下不消费——`column-count` 是误导选项 | lynx 源码 `AbsLynxList.java`、`UIList.java` |

> 注：fiber `ListElement::SetAttributeInternal` 对 `span-count`/`column-count` 均映射到 starlight 布局 `kColumnCount`（`list_element.cc`），但布局引擎对字符串值不解析——**类型错误在布局层静默回退**，无日志、无报错，是本次排查耗时的主因。

## 决策

### 1. list number 类型属性一律 v-bind 数字绑定

`span-count`、`column-count`、`estimated-main-axis-size-px`、`preload-buffer-count`、`lower-threshold-item-count`、`upper-threshold-item-count` 等 number 类型属性**必须** `:attr="数字"` 形式传入（vue-lynx 官方要求，官方示例 `ListWaterfall` 亦为 `:span-count="2"`）。**禁止静态字符串 attribute**。

### 2. 列数属性名用 `span-count`（官方语义）

列数用 `span-count`（官方文档/示例统一名称）。`column-count` 虽在 fiber 层同映射，但它是 radon 平台属性名，语义混乱且无必要——**统一 `span-count`**。

### 3. 保留 web-core 兼容性

web-core 对 `span-count`（含数字绑定渲染为 attribute 字符串后）宽松解析，数字绑定在双端均有效，无需条件分支。

## 验证

- 四版本真机对比（OPPO R11s）：`span-count="2"` 单列 → `column-count="2"` 单列 → `:column-count="2"` 单列 → **`:span-count="2"` 两列 ✅**
- 两列判定法（截图分析）：瀑布流**中缝（x≈520-560）彩色密度 ≈ 0.00**（纯背景分隔）为两列黄金标准；单列全宽图（版本 C）中缝密度 ≈ 1.00
- `lynx-device-check.sh` 全流程 PASS + `pnpm check` 通过

## 风险与反面

- **静默回退**：原生端 number 属性类型错误**无任何日志/报错**（布局层静默单列）——只能靠视觉验证兜底。已纳入术语表与 ADR，防再踩。
- **web-core 掩盖缺陷**：web-core 宽松解析使此类 bug 在开发预览期不可见，必须真机回归多列布局（见 ADR-0047 自动化验证扩展方向）。

## 相关

- ADR-0048（推荐卡片布局：gap 属性 style 绑定契约——同族"属性绑定形式"坑）
- ADR-0055（原生渲染兼容策略：item-key String 契约——属性**类型**契约的另一面）
- 术语：`glossary-app-lynx-native.md`（number 属性绑定契约）、`glossary-web-core-pitfalls.md`（web-core 宽松解析对照）
- 实施提交：`fix(app-lynx): 推荐页瀑布流 span-count 改数字绑定修复安卓单列`
