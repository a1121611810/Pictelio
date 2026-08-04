# Liquid Glass（iOS 玻璃材质）在 app-lynx 上的可行性报告

> 日期：2026-08-04
> 分析对象：[rdev/liquid-glass-react](https://github.com/rdev/liquid-glass-react)（commit: main, 612 行核心实现）
> 目标平台：`packages/app-lynx`（vue-lynx 0.5.1，双环境：Lynx 原生 LynxView + web-core 预览）

---

## 1. liquid-glass-react 实现机制拆解

通读全部源码（`src/index.tsx` + `src/shader-utils.ts` + `src/utils.ts`），视觉效果由 **5 层叠加** 构成：

### 1.1 折射位移层（核心差异化）

```
SVG <filter>
  ├─ feImage → 位移贴图（预烘焙 base64 JPEG/PNG，3 种模式：standard / polar / prominent）
  │            或 shader 模式：Canvas 2D 逐像素执行 roundedRectSDF → 生成 dataURL
  ├─ feDisplacementMap ×3（R/G/B 通道各自独立 scale，模拟色差）
  ├─ feBlend mode="screen" 合并通道
  ├─ feGaussianBlur 柔化色差边缘
  └─ feComposite 边缘遮罩（仅边缘位移，中心保持清晰）
```

关键：位移贴图是**预烘焙的静态图**（约 256×256），不是实时计算。shader 模式（最精确）用 Canvas `getContext("2d")` + `putImageData` 逐像素生成。

### 1.2 磨砂层

```css
backdrop-filter: blur(Npx) saturate(%);
```

作用在 `glass__warp` 绝对定位层上，是"玻璃通透感"的主体。

### 1.3 边缘高光层（双层）

两个 `mix-blend-mode: screen / overlay` 的渐变边框 `<span>`，渐变角度和透明度**跟随鼠标偏移**（`mouseOffset.x / y`）动态变化，模拟光照在玻璃边缘的反射。

### 1.4 液态弹性层

监听 `mousemove`，计算鼠标到元素边缘距离，在 200px 激活区内施加：
- `scaleX/scaleY` 方向性拉伸（`elasticity` 系数控制）
- 弹性 `translate` 位移

### 1.5 浏览器兼容性

README 明确注明：**Safari 和 Firefox 只能部分支持**（位移不可见）。方案深度绑定 Chromium 的完整 SVG 滤镜实现。

---

## 2. app-lynx 目标环境 CSS 能力清单

### 2.1 Lynx 原生端（Android LynxView）

来源：[Lynx 官方 CSS 属性文档](https://lynxjs.org/api/engine/element-api/__GetDataByKey.html) + [filter 属性文档](https://lynxjs.org/api/css/properties/filter.html)

| 能力 | 状态 | 备注 |
|------|------|------|
| `filter: blur()` | ✅ | 作用于元素自身，非背景 |
| `filter: brightness/contrast/saturate/grayscale` | ✅ (3.6+) | 同上 |
| `filter: url(#id)` SVG 引用 | ❌ | 未列出，不支持 |
| `backdrop-filter` | ❌ | **不在支持属性清单中** |
| `mix-blend-mode` | ❌ | 不在支持属性清单中 |
| `<svg>` 元素 | ⚠️ 有限 | 仅 `content`/`src` 渲染静态图，非 filter 宿主 |
| `mask-image` SVG 引用 | ❌ | 官方文档明确不支持 |
| Canvas 2D API | ❌ | 无 canvas（项目 README 已知限制） |
| `transform` / `transition` / `animation` | ✅ | 完整支持 |
| `linear-gradient` | ✅ | `background-image` 支持 |
| `box-shadow` | ✅ | 支持 |
| `border-radius` | ✅ | 支持 |
| `rgba()` 颜色 | ✅ | 支持 |

### 2.2 web-core 预览端（浏览器 iframe）

理论上是标准浏览器环境，但 Lynx 官方 filter 文档未列出 `backdrop-filter` 和 `filter: url()`，无兼容性承诺。且 **app-lynx 的目标平台是原生 LynxView**（参见 `docs/research/vue-lynx-benchmark-ifr.md` §6 的 IFR 实测否决先例——仅为预览端做的优化不进入生产）。

---

## 3. 逐层可行性矩阵

| liquid-glass-react 层 | 所需核心技术 | Lynx 原生 | web-core | 判定 |
|----------------------|-------------|-----------|----------|------|
| 折射位移（边缘弯曲） | `feDisplacementMap` + SVG filter | ❌ | ⚠️ 未承诺 | **不可移植** |
| 色差（RGB 分离） | 3× `feDisplacementMap` + `feBlend` | ❌ | ⚠️ 未承诺 | **不可移植** |
| 磨砂（背景模糊） | `backdrop-filter` | ❌ | ⚠️ 未承诺 | **不可移植** |
| 边缘高光 | `mix-blend-mode` + 渐变 + 鼠标跟踪 | ❌（`mix-blend-mode` 缺失） | ⚠️ | **不可移植** |
| 液态弹性 | `mousemove`/`touchmove` + `transform` | ✅ | ✅ | **可移植** |
| shader 位移贴图生成 | Canvas 2D `getContext` + `toDataURL` | ❌ | ✅ | **原生不可行** |

**结论：5 层中仅 1 层（液态弹性）可移植。核心视觉差异（折射 + 磨砂 + 高光）全部缺失。**

---

## 4. 替代方案评估

### 方案 A：伪玻璃（Frosted Card）—— 推荐，零依赖

**原理**：放弃折射和动态模糊，用纯 CSS 模拟"通透 + 亮边"观感。

```
┌─────────────────────────────────┐
│  渐变高光层（linear-gradient）    │  ← 顶部亮边，模拟光照
│  ┌───────────────────────────┐  │
│  │  半透明背景 rgba(255,255,  │  │
│  │  255, 0.08~0.15)          │  │  ← 通透感
│  │  + border-radius           │  │
│  │  + box-shadow 内发光       │  │  ← 边缘厚度感
│  │                           │  │
│  │    内容（text/image）      │  │
│  └───────────────────────────┘  │
└─────────────────────────────────┘
```

**Lynx 可用 CSS**：
- `background-color: rgba(255, 255, 255, 0.1)` — 半透明底
- `background-image: linear-gradient(...)` — 顶部高光条
- `box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 8px 32px rgba(0,0,0,0.12)` — 内发光 + 外阴影
- `border-radius` — 圆角
- `border: 1px solid rgba(255,255,255,0.15)` — 边缘描边

**弹性交互**：可完整移植 liquid-glass-react 的 `calculateDirectionalScale` + `calculateElasticTranslation` 逻辑（touch 事件替代 mouse 事件），保留"液态"手感。

**优点**：零依赖、两端可用、性能开销极小
**缺点**：无真实背景模糊，通透感依赖下方内容自然透出；无折射

### 方案 B：原生 BlurView 扩展 —— 高成本，真模糊

**原理**：Android 侧自研 Lynx 自定义 element，底层用 `BlurView`（或 API 31+ `WindowManager.LayoutParams.blurBehindRadius`）实现真背景模糊。

```
JS 侧                    Native 侧
<glass-card>    →    Android: BlurView / RealtimeBlurView
  blurRadius={12}       iOS: UIVisualEffectView（如需）
  saturation={1.4}
```

**工程量**：
- 需创建 Lynx Native Module + 自定义 element（参考 `docs/research/lynx-pure-engine-analysis.md` 的 brownfield 集成模式）
- Android：`com.github.mmin18:realtime-blur-view` 或自研 `RenderScript`/`Toolkit` 模糊
- iOS：`UIVisualEffectView` 桥接（如果未来支持 iOS）
- JS 侧按平台分支渲染（原生用 `<glass-card>`，web-core 降级为方案 A）

**优点**：真动态模糊，最接近 iOS 效果
**缺点**：工程量远超 MVP 范围；维护双端原生代码；vue-lynx 仍是 Pre-Alpha，自定义 element API 不稳定

### 方案 C：等 Lynx 官方支持 —— 零成本，被动

Lynx 3.6 刚扩展 filter 家族（`contrast/brightness/saturate`），`backdrop-filter` 是未来可能加入的能力。关注 [lynx-family/lynx](https://github.com/lynx-family/lynx) 的 CSS 支持更新。

**优点**：零成本
**缺点**：无时间表，被动等待

---

## 5. 推荐路径

```
Phase 1（现在）    方案 A：伪玻璃组件
                   ├─ 纯 CSS 半透明 + 渐变高光 + 内发光
                   ├─ 移植液态弹性交互（touch 版）
                   └─ 遵守 Fluent Design 2 令牌（tokens.css overlay/elevation）

Phase 2（可选）    方案 B：原生 BlurView
                   ├─ 前提：app-lynx 通过 MVP 验证，进入生产阶段
                   ├─ 前提：vue-lynx 自定义 element API 稳定
                   └─ 仅在「详情页头部」「底部操作栏」等 1-2 个高曝光位置使用

Phase 3（长期）    方案 C：等 Lynx 官方 backdrop-filter
                   └─ 若官方支持，Phase 1 的伪玻璃可无缝升级
```

### Phase 1 实施要点

1. **新建 `components/GlassCard.vue`**：封装伪玻璃样式 + 弹性交互
2. **令牌映射**（Fluent Design 2 合规）：
   - `rgba(255,255,255,0.1)` → `var(--colorOverlayLight, rgba(255,255,255,0.1))`
   - `rgba(0,0,0,0.12)` → `var(--colorOverlayDark, rgba(0,0,0,0.12))`
   - 内阴影 → `var(--elevation2)` 或自定义玻璃令牌
3. **弹性交互**：touch 事件 → `transform: scaleX() scaleY() translate()`，`transition` 用 Fluent 曲线 `cubic-bezier(0.33,0,0.67,1)` + `200ms`
4. **使用位置建议**：Me 页头部卡片、IllustDetail 底部操作栏——这两个位置下方有图片内容，半透明效果最好

---

## 6. 风险与注意事项

| 风险 | 说明 |
|------|------|
| **web-core ≠ 原生** | 任何在 web-core 预览端验证的效果，必须在真机 LynxView 上复验（IFR 先例） |
| **vue-lynx Pre-Alpha** | 自定义 element / Native Module API 可能变动，方案 B 的 API 面不稳定 |
| **Fluent 合规** | 禁止照抄 liquid-glass-react 的硬编码 `rgba()`/`px`，必须走 tokens.css 令牌 |
| **性能** | 半透明 + 渐变 + 阴影的组合在低端 Android 上可能触发离屏渲染，需实测帧率 |
| **暗色模式** | 伪玻璃在暗色背景下通透感会大幅降低，需为暗色主题调不同的 overlay 透明度 |

---

## 7. 参考来源

- liquid-glass-react 源码：`/tmp/liquid-glass-react/src/index.tsx`（本地 clone，commit: main）
- Lynx CSS 支持清单：Context7 `/websites/lynxjs` — `__GetDataByKey` + `filter` 属性文档
- Lynx SVG 元素：Context7 `/lynx-family/lynx-website` — AGENTS.md + `mask` 属性文档
- app-lynx 项目状态：`packages/app-lynx/README.md`
- vue-lynx 生产就绪评估：`docs/research/vue-lynx-production-readiness.md`
- IFR 实测否决先例：`docs/research/vue-lynx-benchmark-ifr.md` §6
