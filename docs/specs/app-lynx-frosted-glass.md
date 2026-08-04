# app-lynx 伪玻璃组件（Frosted Card + 液态弹性）—— 功能规格

> 来源：研究报告 `docs/research/liquid-glass-app-lynx-feasibility.md`（liquid-glass-react 源码拆解 + Lynx CSS 能力矩阵）；Grill 确认范围 = 报告 Phase 1 完整版
> 状态：ready-for-agent

## Problem Statement

R18 遮罩第一版用 `backdrop-filter` 实现玻璃材质，但 web-core（Lynx CSS 子集）不支持声明式 backdrop-filter（源码核验：仅内部元素 blur-radius 属性），原生 LynxView 也不在官方支持清单——遮罩在两个目标环境都退化为实心盖。用户要的是「玻璃材质」观感。研究报告结论：liquid-glass-react 的 5 层视觉中仅「液态弹性」可移植，折射/磨砂/高光的核心技术（feDisplacementMap、backdrop-filter、mix-blend-mode）Lynx 全部缺失；正解是**伪玻璃（Frosted Card）**——用 Lynx 确认支持的 CSS（linear-gradient / box-shadow / border-radius / rgba）拼出「通透 + 亮边 + 厚度」观感，并移植液态弹性交互保留「液态」手感。

## Solution

1. **伪玻璃样式**：`RestrictOverlay` 遮罩升级为伪玻璃三件套（半透底 + 顶部 linear-gradient 高光 + inset 内发光/外阴影），全部走 tokens.css 令牌，web-core 与原生 LynxView 双端一致呈现，不依赖 backdrop-filter。
2. **通用组件 `GlassCard.vue`**：封装伪玻璃样式 + touch 液态弹性交互（按下/滑近时方向性拉伸 + 弹性位移，松手回弹），供 Me 页头部卡片、详情页底部操作栏等「下方有内容」的高曝光位置使用。
3. **弹性交互**：移植 liquid-glass-react 的 `calculateDirectionalScale` / `calculateElasticTranslation` 算法，mouse 事件改 touch 事件，元素布局用 `lynx.createSelectorQuery` 获取。

## User Stories

1. 作为用户，我在 R18 遮罩上看到通透+亮边的玻璃观感（而非实心盖），以便明确感知这是「材质遮挡」而非「内容缺失」
2. 作为用户，我在真机 LynxView 上看到与 web-core 预览一致的遮罩观感，以便双端体验统一
3. 作为用户，我触摸玻璃卡片时感受到轻微的方向性拉伸与回弹，以便获得「液态」的物理手感
4. 作为用户，我在 Me 页头部等下方有内容的位置看到玻璃卡片的通透效果，以便界面更有层次
5. 作为开发者，我希望玻璃样式全部走 tokens.css 令牌，以便 Fluent Design 2 合规与后续暗色主题调整
6. 作为开发者，我希望弹性交互是可复用组件能力（GlassCard props 控制开关与强度），以便不同位置按需启用

## Implementation Decisions

### 模块划分

| 模块 | 职责 |
|---|---|
| `components/RestrictOverlay.vue`（改） | 遮罩升级伪玻璃三件套；删除 `@supports`/backdrop-filter 路线 |
| `styles/tokens.css`（改） | 新增 `--glassHighlight`（顶部高光渐变）、`--glassEdge`（内发光+外阴影组）；删除 `--glassBg`/`--glassBlur`/`--glassSaturate`（backdrop-filter 路线废弃），保留 `--glassBgMuted`（半透底）、`--glassBorder` |
| `components/GlassCard.vue`（新） | 通用伪玻璃卡片：slot 内容 + 伪玻璃样式 + 弹性交互；props：`elastic?: boolean`（默认 true）、`elasticity?: number`（默认 0.15，对齐源库）、`radius?: string`（圆角 token 覆盖） |
| `primitives/createLiquidElastic.ts`（新） | 弹性算法纯函数：输入触点坐标/元素矩形/elasticity，输出 transform 字符串；无 DOM 依赖，可单测 |
| Me 页头部卡片（改） | 首个 GlassCard 消费方（报告建议位置；详情页操作栏后续按需接入） |

### 弹性算法（移植自 liquid-glass-react index.tsx L360-428，原型编码决策）

- **激活区**：触点距元素边缘 ≤200px 才生效；`fadeInFactor = 1 - edgeDistance / 200`
- **方向性拉伸**：`stretchIntensity = min(centerDistance / 300, 1) * elasticity * fadeInFactor`；
  `scaleX = 1 + |nx|*s*0.3 - |ny|*s*0.15`，`scaleY` 对称；下限 clamp 0.8
- **弹性位移**：`translate = (触点 - 元素中心) * elasticity * 0.1 * fadeInFactor`
- **回弹**：touch 结束/取消 → transform 归零，`transition: transform 200ms cubic-bezier(0.33,0,0.67,1)`（Fluent standard 曲线）
- **touch 事件**：`bindtouchstart`/`bindtouchmove`/`bindtouchend`（vue-lynx 语法）；元素矩形经 `lynx.createSelectorQuery().select(...).boundingClientRect()` 获取并缓存，touchmove 期间不重复查询

### 性能约束

- touchmove 高频触发 → transform 更新走 `requestAnimationFrame` 节流（或等价帧对齐）；弹性计算为纯算术，无布局读写
- 禁用场景：`elastic=false` 时零监听零开销
- 报告风险项：半透明+渐变+阴影组合在低端 Android 可能触发离屏渲染，真机实测帧率列入手动验证

## Testing Decisions

### 测试接缝

**接缝：`createLiquidElastic` 纯函数**（算法全部收敛于此，GlassCard 只做事件接线与 transform 绑定）。组件层不做单测（与包内现状一致）。

### 测试清单

- 新增 `src/primitives/createLiquidElastic.test.ts`（就近测试，沿用 T1 先例）
- 用例：激活区外返回 `scale(1)`；边缘触点 fadeInFactor=1；200px 边界 fadeInFactor=0；scaleX/scaleY 对称性与 0.8 下限 clamp；elasticity=0 时无效果；translate 方向与量级
- 契约断言追加：`--glassHighlight`/`--glassEdge` token 存在；RestrictOverlay 不再含 `backdrop-filter`/`@supports`

### 验证命令

```bash
pnpm check:app-lynx && pnpm test:app-lynx
pnpm dev:app-lynx   # web-core 预览：遮罩伪玻璃观感 + GlassCard 弹性手感
```

真机 LynxView 验证（双端观感一致性 + 低端机帧率）列入手动验证项。

## Out of Scope

- 真背景模糊（方案 B 原生 BlurView）：工程量大、vue-lynx 自定义 element API 不稳定，报告列为 Phase 2 可选
- 折射位移/色差/动态高光（mix-blend-mode 缺失，不可移植）
- 详情页底部操作栏接入 GlassCard（后续按需）
- 主包 packages/app 的玻璃样式
- 遮罩以外的既有组件玻璃化改造

## Further Notes

- 暗色主题：app-lynx tokens.css 当前单一亮色主题，伪玻璃在暗色背景下通透感降低的问题（报告 §6）留待暗色主题引入时统一调 token
- liquid-glass-react 本地 clone：`/tmp/liquid-glass-react`（算法参照源）
- 弹性交互的「液态」是锦上添花：若真机实测帧率不达标，`elastic=false` 一键关闭即可退化回纯伪玻璃
