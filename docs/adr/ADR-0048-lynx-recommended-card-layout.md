# ADR 0048: app-lynx 推荐列表卡片布局修复（w-full 百分比基准 + 间距）

## 状态

已采纳

## 分类

技术决策 / Bug 修复

## 日期

2026-08-01

## 背景

`packages/app-lynx` 推荐页（`Recommended.vue`）瀑布流卡片连续出现两个显示问题：

1. **图片显示不全**：卡片内 `<image>` 被横向拉伸、只显示左半部分（右半被 `overflow-hidden` 裁掉）。诊断链（CDP 实测 1393px 视口）：
   - `w-full`（`width: 100%`）在 web-core 下**相对视口而非父容器**（与 ADR-0044/glossary 中已记录的 `<input>` 属同一"百分比宽度基准异常"，本场景扩展到 `list-item` 与 `x-image`）——`list-item` 与 `x-image` 都被拉成 1393px（视口宽），而瀑布流列宽实际为 697px，超出部分被卡片 `overflow-hidden` 裁掉。
   - `widthFix` mode **在 lynx 中不存在**：web-core 源码（`web-core-main-chunk.js`）的 mode 仅映射 `aspectFit`（`object-fit: contain`）、`aspectFill`（`object-fit: cover`）、`center` 三种，`widthFix` 静默回退默认 `fill` → 图片被拉伸变形。
   - `auto-size` 在 web-core 下为 `display: contents`，不参与尺寸计算。
2. **卡片无间距**：去掉 `w-full` 后宽度恢复正常（697px 列宽），但暴露第二个问题——`list-item` 自身的 `m-1.5`（margin 22.3px @1393）**不参与瀑布流布局**（相邻卡片 y 间距 = 卡片高度 862px，零间隙；x/y/w/h 均不含 margin）。

## 决策

### 1. 禁用 `w-full`，宽度交给瀑布流引擎

`list-item` 与 `x-image` 均去掉 `w-full`。实测去掉后 `list-item` 宽度回落到瀑布流引擎约束的列宽（697px），`x-image` 跟随父容器。**禁止用百分比宽度控制瀑布流 `list-item`/`x-image`**（web-core 下相对视口）。

### 2. 方形缩略图用 `aspect-ratio` 方形容器

缩略图为 `square_medium`（360×360 方形）。在去掉 `w-full` 后容器宽度 = 列宽（697px），给 `x-image` 加 `aspect-[1/1]`（CSS `aspect-ratio: 1/1`）使容器成正方形，配合 `mode="aspectFill"`（`object-fit: cover`）→ 方形图完整显示、不裁剪、不变形。web-core 与原生 LynxView 均支持 `aspect-ratio`（lynx 官方 CSS API 文档确认；差异：`auto` 值不支持）。

`min-h-[40vw]` 保底**保留**：防 `aspect-ratio` 在图片加载前/不支持时高度塌陷（scrolltolower 无限加载回归，见 ADR-0045）。

**延伸应用——详情页大图**（`IllustDetail.vue`）：原用 `widthFix` mode（lynx 不存在 → 回退 fill → 高度 0 → 图片不可见）。改为 API 返回的 `illust.width / illust.height` 动态 `aspect-ratio` + `aspectFill`——容器按原图比例，竖图/横图均完整显示。与列表卡片同机制，仅比例来源不同（列表用方形固定 1/1，详情用真实宽高比）。

### 3. 卡片间距用 list 官方 gap 属性

`list-item` 的 margin/padding **不参与瀑布流布局**（行列间距均不生效），且 **list-item 内部任何 `view` 包裹会导致引擎定位计算崩**（全部 item 重叠在起点——margin、padding、内部 view 三个方向实测均失败）。间距改用 `<list>` 官方属性：

- `list-main-axis-gap`（行距）+ `list-cross-axis-gap`（列距），经 **vue-lynx `:style` 对象绑定**传入（`{ listMainAxisGap: '12px', listCrossAxisGap: '12px' }`）。实测 **attribute 形式（`list-main-axis-gap="12px"`）web-core 不响应**，style 对象绑定走 vue-lynx 样式管道生成 `--list-main-axis-gap` / `--list-cross-axis-gap` CSS 变量后才生效（引擎宽度 calc 也消费 `--list-cross-axis-gap`，列宽自动扣除 gap）。
- 间距值 12px（`--list-cross-axis-gap` 实测 12px、行距实测 13px）。原生 LynxView 官方文档确认支持这两个属性（单位 px/rpx），原生端行/列距行为待 #41 集成后验证。

## 核心动机

web-core 的百分比宽度基准异常与瀑布流 margin 忽略均属**渲染引擎行为，应用侧无法改变**，只能绕开：宽度依赖瀑布流引擎约束（而非百分比）、高度依赖 `aspect-ratio`（而非 mode/auto-size）、间距依赖 list 官方 gap 属性（而非 item margin/padding/内部 view）。选择的原则是**优先使用已在 web-core 实测生效、且原生 LynxView 官方支持的机制**。

## 风险与反面

- **`aspect-ratio` 与图片比例强绑定**：本决策假定缩略图恒为方形（`square_medium` 优先）。若 `thumbUrl` 回退到非方形源（如 `large`），`aspectFill` + 方形容器会裁剪——属可接受回退（原实现 `aspectFill` 同样裁剪）。
- **gap 间距为固定 px**：12px 不随屏宽缩放（vw 响应式间距不可用于 gap——官方单位仅 px/rpx，rpx 在 web-core 塌陷）。@375 手机 12px 间距在 Fluent 可接受范围。
- **`list-main-axis-gap` 原生待验证**：原生 LynxView 官方文档支持（px/rpx），但 web-core 下 attribute 形式不响应、须 style 对象绑定；#41 集成后验证原生端行为。
- **web-core 升级风险**：若 web-core 修复百分比基准/支持 gap attribute 形式，本决策的绕开方案可简化——升级后重新验证。

### 正面

- 图片完整显示（697×697 方形实测），不再裁剪/拉伸
- 卡片间距恢复（list gap 12px，行/列一致）
- 全机制双环境可查：`aspect-ratio` 与 `list-*-axis-gap` 均原生官方支持
- `min-h-[40vw]` 保底保留，无 scrolltolower 回归

### 反面

- 间距为固定 px（12px），非 vw 响应式；web-core 升级后需回归
- 部分依赖 web-core 缺陷绕开（gap attribute 形式不响应、内部 view 崩引擎），web-core 升级后需回归

## 相关

- ADR-0044（rpx 塌陷）、ADR-0045（scrolltolower 保底）、ADR-0046（Tailwind）、ADR-0047（自动化验证）
- `glossary-web-core-pitfalls.md`（百分比宽度基准异常扩展、list-item margin 失效、widthFix 不存在）
- `glossary-lynx-units.md`（auto-size 条目修正：推荐页封面已改用 aspect-ratio）
- 实施提交：`<待定>`
