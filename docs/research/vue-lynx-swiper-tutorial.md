# 研究：vue-lynx 官方自研 swipe 轮播实现

> 目的：确认 vue-lynx 官方《商品详情页图片轮播》教程中"主线程滑动轮播"的正确写法，找出本地 `CarouselSwiper.vue` 与官方做法的差异，并对"在 Android 原生 LynxView 上加回 `main-thread-*` 属性后整个组件渲染空白"给出根因判断。
>
> 结论分级：`[已验证]` 有教程/源码原文可直接印证；`[推断]` 基于源码机制推断、需构建/真机验证；`[待确认]` 官方文档内部不一致或无法静态确认。

---

## 结论速览

1. **slide 宽度单位**：官方用的是 **px**（`SystemInfo.pixelWidth / SystemInfo.pixelRatio`，即 CSS 逻辑像素），不是 `100vw` 也不是 `100%`。每个 slide 宽度 = `itemWidth + 'px'`，吸附公式 `Math.round(offset/itemWidth) * itemWidth` 里的 `itemWidth` 同样是 **px**。我们本地把 `itemWidth` 定为"**vw 数值**"，slide 用 `${itemWidth}vw`，`translateX` 却写成 px——**单位不一致，是独立的几何 bug**（见差异 §4）。

2. **触摸事件如何绑主线程**：官方就是 `:main-thread-ref` + `:main-thread-bindtouchstart/touchmove/touchend`，与本地写法**一模一样**——所以**不是"绑定形式用错"**。`@touchstart` 跑在后台线程，`:main-thread-bindtouchstart` 跑在主线程。`main-thread-` 前缀是"事件绑定/ref 路由到主线程"的语法，必须带 `v-bind`（`:`，因为模板属性名不支持冒号）。

3. **布局**：官方是 `display: linear` + `linear-orientation: horizontal`，并在教程 info 里明确说它比 `display: flex` 在 Lynx 原生渲染引擎性能更好。本地代码（当前磁盘态）**已经是** `display: linear`（早期版本是 `flex`，已修正）。

4. **位移换算**：官方把 `clientX` 的 **px** 位移**直接**作为 offset 增量（不换算成 vw），offset 全程用 px；吸附/边界也是 px。换算是"0 换算"，即 `offset = touchStartOffset + (clientX - touchStartX)`。

5. **tap vs drag**：官方教程**没有**任何 `isTapGesture`/位移阈值逻辑（`swiperMath.ts` 里的 `isTapGesture`/`TAP_DISPLACEMENT_THRESHOLD` 是我们自己加的，官方没有）。官方靠 `touchstart`/`touchmove`/`touchend` 语义处理，点跳页用指示器 `@tap` + `runOnMainThread` 桥接。

6. **主线程函数访问/更新数据**：用 `'main thread'` 字符串指令标记函数体，用 `useMainThreadRef(...)` + `.current` 读写，`.value` 在后台线程只读。跨线程用 `runOnBackground`/`runOnMainThread`；传给 MT 的 BG 值必须可序列化（number/string/boolean/普通对象/数组），函数不能直接传（要么 `main-thread-` 前缀的 prop，要么经 `runOnBackground`/`runOnMainThread` 桥接）。

7. **渲染空白的根因（最可能）**：绑定形式正确，但**主线程函数体里引用的 `clampOffset` / `calcNearestPage` 是从外部模块 `../primitives/swiperMath` 导入的纯函数，且该模块没有任何 `'main thread'` 指令**。vue-lynx 的主线程打包器（`worklet-loader-mt`）对"没有 `'main thread'` 指令的模块"**只保留其 import/registration，剥离函数体**，因此这些函数在主线程运行时是 `undefined`。官方示例把每个会被主线程函数调用的 helper 都**内联并标 `'main thread'`**（`useOffset.ts` 里 `calcNearestPage`/`updateOffset`、`useAnimate.ts` 里 `animateInner`/缓动函数），从而被完整带进主线程包。我们这种"跨模块引纯函数"是官方没有的写法，是最可能导致原生主线程脚本报错、组件整块空白的差异。
   - 次要隐患：`setStyleProperties`（复数）不在 Lynx 类型定义里（`cross-thread.d.ts` 只文档化了单数 `setStyleProperty`）；官方示例内部也不一致（SwiperMTS 用单数，`useUpdateSwiperStyle` 用复数）。若原生元素只有单数，复数调用会被 `?.` 静默吞掉 → 拖不动（不是空白）。
   - 注意：**哪怕修好空白，`itemWidth` vw/px 混用仍会让滑动几何错乱**（见 §4）。

---

## 官方教程关键代码与解读

所有"教程原文"均出自 `https://vue.lynxjs.org/zh/guide/tutorial-swiper.md`（下称 *tutorial*；已抓取保存，行号对应该 md 原文）。示例源码出自 vue-lynx 仓库 `examples/swiper/src/`（见来源列表）。

### Q1 / Q3：布局与 slide 宽度单位

**静态布局用 `display: linear`（非 flex）。** *tutorial* L80–96：

```css title="swiper.css"
.swiper-wrapper {
  flex: 1;
  width: 100%;
}
.swiper-container {
  display: linear;
  linear-orientation: horizontal;   /* 关键：水平排布 */
  height: 100%;
}
```

> ::: info Lynx 的 display: linear
> 与 `display: flex` 相比，`linear` 布局在 Lynx 的原生渲染引擎中具有更好的性能。
> :::

**slide 宽度是 px，不是 vw，也不是 100%。** 源码 `examples/swiper/src/SwiperMTS/Swiper.vue`：

```ts
const props = withDefaults(defineProps<{
  data: string[];
  itemWidth?: number;
}>(), {
  // 默认 = 屏幕 CSS 逻辑像素宽（pixelWidth/pixelRatio）= px
  itemWidth: () => SystemInfo.pixelWidth / SystemInfo.pixelRatio,
});
```

`examples/swiper/src/Components/SwiperItem.vue`：

```vue
<view :style="{ width: itemWidth + 'px', height: '100%' }">  <!-- px -->
  <image mode="aspectFill" :src="pic" :style="{ width: '100%', height: '100%' }" />
</view>
```

**吸附用的 `itemWidth` 也是 px。** `examples/swiper/src/Swiper/useOffset.ts`：

```ts
function calcNearestPage(offset: number) {
  'main thread';
  const nearestPage = Math.round(offset / itemWidth);   // itemWidth 为 px
  return nearestPage * itemWidth;
}

function updateOffset(offset: number) {
  'main thread';
  const lowerBound = 0;
  const upperBound = -(dataLength - 1) * itemWidth;      // px 边界
  const realOffset = Math.min(lowerBound, Math.max(upperBound, offset));
  currentOffsetRef.current = realOffset;
  onOffsetUpdate(realOffset);                             // 透传 px offset
  ...
}
```

> **[已验证]** 官方 **slide/吸附/transform 全程用 px**（由 `SystemInfo.pixelWidth / pixelRatio` 量得），**不用 `100vw`，也不用 `100%`**。

### Q2：触摸事件如何绑到主线程

**绑定形式**。*tutorial* L244–270：

> **3. 在模板中使用 `main-thread-` 前缀**
> Vue Lynx 使用 `main-thread-` 前缀将事件绑定和 ref 路由到主线程：
>
> ```vue {3-6}
> <view
>   class="swiper-container"
>   :main-thread-ref="containerRef"
>   :main-thread-bindtouchstart="handleTouchStart"
>   :main-thread-bindtouchmove="handleTouchMove"
>   :main-thread-bindtouchend="handleTouchEnd"
> >
> ```
>
> ::: details 模板中的 main-thread- 前缀
> Vue 模板使用带有 `v-bind`（`:`）的 `main-thread-` 连字符前缀来将事件绑定和 ref 路由到主线程：
> `<view :main-thread-ref="containerRef" :main-thread-bindtouchstart="fn" />`
> 这是必要的，因为 Vue 模板属性名不支持冒号。
> :::

**`@touchstart` vs `:main-thread-bindtouchstart`**。*tutorial* L100–159（后台线程方案）用 `@touchstart`/`@touchmove` 绑在 `.swiper-container` 上，并明确说明：

> 在 Vue Lynx 中，事件处理器默认在**后台线程**上运行。（L110）
> 在后台线程上，我们**无法直接访问 DOM 节点**……需要通过 `lynx.createSelectorQuery()` 等 API 进行异步的**跨线程往返调用**。（L151）

随后 L177＋ 引出主线程方案："直接在主线程上运行事件处理器"，即用 `'main thread'` 指令 + `main-thread-` 前缀绑定，从而消除跨线程往返。

**`main-thread-ref` / `useMainThreadRef` 正确用法**（*tutorial* L185–213）：

```ts
import { useMainThreadRef } from 'vue-lynx';
const containerRef = useMainThreadRef<unknown>(null);
const currentOffsetRef = useMainThreadRef<number>(0);
```

> ::: info 如何访问 useMainThreadRef
> `useMainThreadRef` 返回的引用在主线程上通过 `.current` 属性访问——而不是 Vue 的 `.value`。……（L199–213）
> 主线程运行时的访问协议独立于 Vue 响应式系统。

运行时类型（`vue-lynx/runtime/dist/main-thread-ref.d.ts`）印证：`.current` 在主线程可读写，`.value` 在后台线程只读（触发 Vue 依赖追踪），`.current` 在后台线程只读。

> **[已验证]** 本地 `:main-thread-ref`/`:main-thread-bindtouch*` 绑定形式与官方**完全一致**，不属于"用错绑定形式"。

### Q3：布局模式（官方用 linear）

见 Q1：官方明确用 `display: linear` + `linear-orientation: horizontal`，并给出"优于 flex"的理由。本地当前磁盘态已是 `display: linear`。

### Q4：触摸位移换算

官方**不做 vw/px 换算**，`clientX` 位移直接累加为 px offset。`SwiperMTS/Swiper.vue`：

```ts
const handleTouchMove = (e: { touches: Array<{ clientX: number }> }) => {
  'main thread';
  const delta = e.touches[0].clientX - touchStartXRef.current;       // px delta
  const offset = touchStartOffsetRef.current + delta;                // offset 也是 px
  currentOffsetRef.current = offset;
  const el = containerRef as ...;
  el.current?.setStyleProperty('transform', `translateX(${offset}px)`);  // px
};
```

`useOffset.ts` 完整版同理，`updateOffset` 里 `index = Math.round(-realOffset / itemWidth)`（px / px = 页索引）。

> **[已验证]** 官方换算公式：`offset = touchStartOffset + (touch.clientX - touchStartX)`，**全程 px**，无 vw 换算。

### Q5：tap vs drag

官方教程**没有** `isTapGesture` / 位移阈值 / 原生 tap 语义的显式判定。tap→跳页走的是指示器组件：`Indicator` 用 `@tap` 触发 `item-click`（*tutorial* L556–558），再经 `handleItemClick` → `updateIndex` → `runOnMainThread(updateOffset)`（L576–579, L536–554）跳转到对应页。

> **[已验证]** 我们 `swiperMath.ts` 里的 `isTapGesture`（位移阈值 16px）与 `TAP_DISPLACEMENT_THRESHOLD` **官方没有**，是本地为区分"点卡进详情 vs 拖动"额外加的。它不影响官方轮播本身的正确性，但注意它与 offset 单位耦合——若 offset 单位改回 px，16px 阈值才有意义（vw 时代阈值语义会漂移）。

### Q6：主线程函数如何访问/更新数据

- **`'main thread'` 字符串指令**：函数体第一行写 `'main thread'`，SWC 编译器将其提取到主线程包（*tutorial* L215–217, L39）。*tutorial* L724–725：标记的函数体与框架无关，无论外层用 SFC 还是 JSX 都一样。
- **`.current` vs `.value`**：主线程用 `.current` 读写；`.value` 只是后台线程只读访问（*tutorial* L199–213）。
- **跨线程通信**：主线程↔后台线程函数**不能直接互相调用**，必须用桥接（*tutorial* L477–482）：`runOnBackground(fn)`（MT→BG，L484–518）、`runOnMainThread(fn)`（BG→MT，L536–554）。在 `'main thread'` 函数里直接调用后台线程函数会被 SWC 报错，需用 `runOnBackground(...)(...)` 包装（L520–534）。
- **可序列化限制**：被主线程函数捕获的后台线程值必须可序列化（number/string/boolean/普通对象/数组）；**函数和 Promise 不能直接传**（*tutorial* L627–631）。跨线程**函数**传主线程需用 `main-thread-` 前缀的 prop（L690–694），或在 BG 侧用 `runOnBackground` 包装传递。
- **`setStyleProperties`/`setStyleProperty`**：`SwiperMTS` 用单数 `setStyleProperty('transform', val)`；`useUpdateSwiperStyle`（组合式函数版）用复数 `setStyleProperties({ transform })`（*tutorial* L231–234 贴的 MT 示例也是复数）。但 vue-lynx 类型文档只文档化**单数**（`runtime/dist/cross-thread.d.ts` L16 `element.setStyleProperty('opacity', ...)`）。→ **[待确认]** 复数形式是否有运行时保障。

---

## 与本地 `CarouselSwiper.vue` 的差异

以当前磁盘态（`packages/app-lynx/src/components/CarouselSwiper.vue`，行号按当前文件）为准：

| 维度 | 官方 | 本地当前 | 差异 |
|---|---|---|---|
| 绑定形式 | `:main-thread-ref` + `:main-thread-bindtouch*` | 同（L157–160） | 一致 ✅ |
| 布局 | `display: linear` + `linear-orientation: horizontal`（swiper.css） | `display: linear` + `linear-orientation: horizontal`（L180–181） | 一致 ✅ |
| slide 宽度单位 | `itemWidth + 'px'`（px，SystemInfo.pixelWidth/pixelRatio） | `${itemWidth}vw` + 语义"vw 数值"（L21, L164） | **不一致 ⚠️** |
| 滑宽应用方式 | `<SwiperItem :item-width="itemWidth">`，item 内设 px 宽 | `<view class="swiper-slide" :style="{width: itemWidth+'vw'}">`（L164） | 单位不同；逻辑相近 |
| transform 单位 | `translateX(${offset}px)`（px） | `translateX(${offset}px)`（L81） | 但 offset 由 vw 数值算出 → **px/vw 混用 ⚠️** |
| helper 函数来源 | MT 函数直接调用**同模块内联、标 `'main thread'`** 的 `calcNearestPage`/`updateOffset` 等 | MT 函数调用**跨模块导入、无 `'main thread'`** 的 `clampOffset`/`calcNearestPage`（L15, L87, L121） | **最可疑差异 ⚠️** |
| tap 判定 | 无 | 新增 `isTapGesture`/阈值（swiperMath.ts L27–39） | 官方无，本地扩展 |
| 指示器 | 有（`Indicator` + `runOnMainThread`/`runOnBackground`） | 无（本组件只做滑动，指示器在别处/未接） | 功能范围不同 |
| 样式 API | SwiperMTS 用单数 `setStyleProperty`；组合式用复数 `setStyleProperties` | 用复数 `setStyleProperties`（L81） | 单复数不一致，官方内部也不一致 |

> 说明：我在研究期间观察到 `CarouselSwiper.vue` 被并发修改过——首次读取时装还没 `main-thread-*` 属性、`.swiper-container` 是 `display:flex`、slide 是 `width:100%`；二次读取时已加回 4 个 `main-thread-*` 属性、换成 `display:linear`、slide 是 `${itemWidth}vw`。本报告以**当前磁盘态**（二次读取）为基准，即"加回 `main-thread-*` 属性后渲染空白"的状态。

### 核心差异：跨模块引"非 `'main thread'` 纯函数"

本地 `updateOffset`（L85–104）和 `handleTouchEnd`（L119–123）在主线程函数体里调用：

```ts
import { calcNearestPage, clampOffset } from '../primitives/swiperMath'   // L15
...
function updateOffset(rawOffset) {
  'main thread'
  const bound = clampOffset(rawOffset, slideCountRef.current, itemWidthRef.current)  // L87
  ...
}
function handleTouchEnd() {
  'main thread'
  const target = calcNearestPage(currentOffsetRef.current, itemWidthRef.current)      // L121
  ...
}
```

`swiperMath.ts` 这两个函数**没有 `'main thread'` 指令**，是纯 TS「深模块」函数，还被父组件（tap 判定）和单测复用。

官方对于会被主线程函数调用的 helper，全部**内联在 `'main thread'` 所在模块并标 `'main thread'`**：

- `useOffset.ts`：`calcNearestPage`、`updateOffset` 都是 `'main thread'`；
- `useAnimate.ts`：`animateInner`、缓动函数 `easings.*` 都是 `'main thread'`；
- 纯函数没有"跨模块且不带 `'main thread'`"的用例。

---

## main-thread-* 渲染失败的根因判断（Q7）

### `[推断]` 最可能：主线程包里没有 `clampOffset` / `calcNearestPage` 的定义

vue-lynx 的主线程（MT）打包器是 `plugin/dist/loaders/worklet-loader-mt.js`。关键机制（可直接从源码读出，行号见来源列表）：

1. **MT 打包器会跟随相对 import**（`./foo`、`../bar`）以及解析到项目源码（不在 `node_modules`）的别名 import。`plugin/dist/index.d.ts` L135–140 明确："The worklet loader follows relative imports (`./foo`, `../bar`) and resolves non-relative imports: path aliases and tsconfig `paths` that point at project source (outside `node_modules`) are followed automatically." → 本地 `../primitives/swiperMath`（项目源码、相对 import）**会被跟随进 MT 图**。

2. **但"没有 `'main thread'` 指令的模块"，MT 打包器只保留其 import/registration，函数体被剥离。** `worklet-loader-mt.js` 的 `transformModule`：

   ```js
   // 对一个不含 'main thread' 的模块：
   if (!hasMainThreadDirective(source)) {
     const sharedImports = extractSharedImports(source);
     return [sharedImports, localImports, tplRegistrations].filter(Boolean).join('\n');
   }
   ```

   即：`swiperMath.ts` 在 MT 侧**只保留 import 语句，其导出的函数体不会出现在主线程 bundle 里**。

3. 于是 `CarouselSwiper.vue` 的 `'main thread'` 函数（`updateOffset`→`clampOffset`、`handleTouchEnd`→`calcNearestPage`）在**主线程运行时引用到 `undefined` 标识符** → 原生 LynxView 的主线程脚本报 ReferenceError。

官方示例之所以能跑，是因为它把所有被主线程函数调用的 helper 都放进了**带 `'main thread'` 指令的模块**（函数体被 LEPUS 变换并 `registerWorkletInternal` 注册到主线程）。

> **为什么不 blank 在 web 预览？** web-core 预览对 `main-thread-*` 绑定和 worklet 的处理与原生 LynxView 不同（可能按普通属性/事件降级），因此先在 web 上看不出；真机/原生运行时才会执行真正的主线程 worklet。
>
> **为什么这会影响"整体空白"而非"拖不动"？** 主线程脚本在 LynxView 初始化时会整体加载/执行，一旦主线程 bundle 内部引用到未定义符号（模块加载或 worklet 注册阶段），很可能导致主线程脚本异常，页面子树构建失败。这与现象"加回 4 个属性 → 整体空白"一致；我**未能**运行构建或拆开实际 `__main-thread` bundle 确认是"加载即抛错"还是"首次触摸才抛错"，故标为 `[推断]` 而非定论。

### `[待确认]` 次要隐患：`setStyleProperties`（复数）可能不存在

- `runtime/dist/cross-thread.d.ts` 只文档化**单数** `element.setStyleProperty('opacity', ...)`（L16）。
- 官方示例内部**不一致**：`SwiperMTS` 用单数，`useUpdateSwiperStyle` 用复数。
- 本地用**复数** `setStyleProperties`（L81），并用 `?.` 守卫。若原生元素只有单数，复数调用被静默吞掉 → 卡片不位移（"接不上滑动"）。
- 这不是渲染空白的原因，但若想稳妥，建议改成单数 `setStyleProperty('transform', ...)`（与 SwiperMTS 一致）。

### `[已验证]` 独立的几何 bug：`itemWidth` vw/px 混用

- slide 宽 `${itemWidth}vw`，offset 却写 `translateX(${offset}px)`；offset 由 `clampOffset(rawOffset, slideCount, itemWidth)` 算出（`itemWidth` 是 vw 数值）。若 `itemWidth=100`，页面边界为 `-(n-1)*100`，`translateX(-100px)` 只移动 100px，不是整屏 → 一页滑不满。
- 修复空白后必须一并处理：把 `itemWidth` 改为 **px**（如 `SystemInfo.pixelWidth / SystemInfo.pixelRatio`），slide 宽 `itemWidth + 'px'`，与官方一致。

---

## 建议修改方向

按优先级（先解空白，再修几何，最后收尾）：

1. **修主线程打包（解空白）**：让 `clampOffset`/`calcNearestPage` 进主线程包。推荐**在 `CarouselSwiper.vue` 内联这两个小函数并标 `'main thread'`**（严格对齐官方"helper 与 `'main thread'` 同模块、同标 `'main thread'`"的写法），同时**保留** `swiperMath.ts` 作为父组件 tap 判定/单测用的纯函数模块（避免改动其对外语义）。⚠️ 若直接给 `swiperMath.ts` 的函数加 `'main thread'`，会影响父组件与单测的调用方式，谨慎。
2. **滑动进度可先做最小基线**：在改 helper 前，可先确认主线程 bundle 是否因其它符号（如 `runOnBackground` 传给 MT 时对 `vue-lynx` 的处理）而失败——用 `includeWorkletPackages: ['vue-lynx']` 做一次 A/B 验证（`plugin/dist/index.d.ts` L131–159 说明 node_modules 包默认被 MT 打包器丢弃，需 allowlist 跟随）。
3. **统一为单位**：`itemWidth` 改用 px（`SystemInfo.pixelWidth / SystemInfo.pixelRatio`），slide 宽 `itemWidth + 'px'`，`translateX`/吸附/边界全部 px。
4. **样式 API**：`setStyleProperty('transform', \`translateX(${offset}px)\`)`（单数，对齐 `SwiperMTS`），或先确认原生元素确实有 `setStyleProperties`（复数）。
5. **真机验证**：`add` `main-thread-*` 后在原生 LynxView 看是否渲染出卡片 + 是否可拖动；web 预览结果仅供参考。

---

## 真机验证结论（2026-08-30，emulator-5556 / Android 14）

对报告 Q7 的 `[推断]` 做了真机验证，**结论敲定**：

1. **`main-thread-*` 绑定在原生 LynxView 上确认导致组件整块空白**。即使：
   - 内联 `clampOffset`/`calcNearestPage` 并标 `'main thread'`（规避跨模块 stripped helper 问题）；
   - 统一 px 单位（`SystemInfo.pixelWidth/pixelRatio`）；
   - `setStyleProperty` 单数；
   - 内容容器 `flex flex-col`（保证 `.swiper-wrapper{flex:1}` 拉满高度）；
   
   加回 `:main-thread-ref` + `:main-thread-bindtouchstart/move/end` 后推荐页**仍整块空白**。移除这四个绑定即刻恢复正常渲染 + 可滑动。

2. **空白其实有两个独立成因，且都不是 main-thread 专属**：
   - **内容容器（Recommended.vue 的 `v-else` 内容视图）须为 `flex flex-col`**，否则 `CarouselSwiper` 根 `.swiper-wrapper{flex:1}` 不拉伸 → 高度塌缩 0 → slides 0 高 → 空白。这是**修复后的关键**（对照 IllustList 用 `<list h-full>` 填满）。此前把空白归因于 main-thread 是被该变量混淆了的误判。
   - **`main-thread-*` 绑定本身也会使原生渲染失败**——即便加了 `flex flex-col`，main-thread 版仍空白。

3. **结论：main-thread 脚本在本项目原生 LynxView 上不可用**（ADR-0115「待验证项」判定为不通过）。**必须改用后台线程方案**：
   - 触摸：`@touchstart`/`@touchmove`/`@touchend`（后台线程）；
   - `translateX` 经 **Vue 响应式 `:style` 绑定**（`containerOffset` ref，而非 `setStyleProperty`）；
   - `itemWidth` 用 px（`SystemInfo.pixelWidth/pixelRatio`），slide 宽 `itemWidth+'px'`；
   - `calcNearestPage`/`clampOffset` 从 `swiperMath.ts` 直接 import（后台线程，无 MT 打包问题）。
   - 代价：拖拽非零延迟（主线程方案的本意），但仍可正常渲染与滑动（已真机验证）。

4. **真机已验证通过**（后台线程版 + `flex flex-col` 容器）：
   - 全 bleed 沉浸卡渲染（封面图/标题/作者/类型徽章/收藏数/scrim）✅
   - 左右滑动连续切换卡片 ✅
   - 点卡进 `/illust/:id` 详情 ✅
   - 单刷新 FAB（⟳）✅、顶部无 T0-DIAG 横幅 ✅

---

## 来源列表

### 官方教程
- `https://vue.lynxjs.org/zh/guide/tutorial-swiper.md`（已抓取保存，行号对应该 md）：
  - L80–96 `display: linear` + info（优于 flex）；L102–159 后台线程方案 + `@touchstart`；L151 后台无法访问 DOM/需跨线程；L185–242 `useMainThreadRef`/`'main thread'`/`setStyleProperties`；L244–270 `main-thread-` 前缀；L278–292 谨慎使用；L345–465 吸附动画 + `calcNearestPage`/`updateOffset` clamp；L471–554 `runOnBackground`/`runOnMainThread`；L595–694 跨线程值传递（可序列化、`main-thread-` 前缀 prop）。
- 英文版同一教程：`https://vue.lynxjs.org/guide/tutorial-swiper.md`（已抓取，内容对应）。

### 官方示例源码（`examples/swiper/src/`，raw.githubusercontent.com/Huxpro/vue-lynx/main/）
- `SwiperMTS/Swiper.vue`：`itemWidth` 默认 `SystemInfo.pixelWidth/SystemInfo.pixelRatio`；MT 触摸处理；用单数 `setStyleProperty`；模板 `:main-thread-ref` + `:main-thread-bindtouch*`。
- `Swiper/useOffset.ts`：`calcNearestPage`/`updateOffset` 同模块 `'main thread'`；`runOnBackground(onIndexUpdate)`。
- `Swiper/useUpdateSwiperStyle.ts`：`containerRef=useMainThreadRef(null)`；`updateSwiperStyle` `'main thread'` 用复数 `setStyleProperties`。
- `Components/SwiperItem.vue`：slide 宽 `itemWidth + 'px'`。
- `utils/useAnimate.ts`：`animateInner`/`easings.*` 均 `'main thread'`；RAF。
- `swiper.css`：`.swiper-container { display: linear; linear-orientation: horizontal; height:100% }`。

### vue-lynx 运行时/插件源码（`node_modules/.pnpm/vue-lynx@0.5.1_*/node_modules/vue-lynx`）
- `plugin/dist/index.d.ts`：L131–159 `includeWorkletPackages`（跟随相对/项目源码 import，node_modules 默认丢弃）；L95–130 IFR/enableElementTemplates。
- `plugin/dist/index.js`：L20617 `nodeModulesExcludeWithAllowlist`（默认排除所有 node_modules）；L20628 `vue:worklet`（BG loader）；L20648 `vue:worklet-mt`（MT loader，排除 node_modules + bootstrap）。
- `plugin/dist/loaders/worklet-loader-mt.js`：`transformModule`（无 `'main thread'` 的模块只保留 import/registration，剥离函数体）；`extractLocalImports`（跟随相对 import）。
- `plugin/dist/loaders/worklet-loader.js`：BG 侧，用 `@lynx-js/react/transform` `worklet.target:'JS'`。
- `runtime/dist/main-thread-ref.d.ts`：`MainThreadRef` `.current`（MT 读写）/`.value`（BG 只读）；`useMainThreadRef`。
- `runtime/dist/cross-thread.d.ts`：`runOnMainThread`；L16 `element.setStyleProperty(...)`（单数，官方文档化）。
- `main-thread/dist/__test__/raw-worklet-registrations.js`：L16 `refEntry.current.setStyleProperty('transform', ...)`（单数实测）。
- README.md L41：`main-thread-*` props 类型化。

### 本地文件
- `packages/app-lynx/src/components/CarouselSwiper.vue`（当前磁盘态，行号见上文）：L15 跨模块 import `swiperMath`；L87/L121 `'main thread'` 内调用 `clampOffset`/`calcNearestPage`；L81 复数 `setStyleProperties`；L157–160 `:main-thread-*` 绑定；L164 `${itemWidth}vw`；L180–181 `display: linear`。
- `packages/app-lynx/src/primitives/swiperMath.ts`：`calcNearestPage`（L10–13）、`clampOffset`（L19–25）、`isTapGesture`（L34–39）、`TAP_DISPLACEMENT_THRESHOLD=16`（L28）——均**无** `'main thread'` 指令。
- `packages/app-lynx/lynx.config.ts`：使用 `pluginVueLynx(...)`（未配置 `includeWorkletPackages`），即 MT 打包器走默认（node_modules 丢弃）。

### 未获取到 / 说明
- 官方教程**没有**`isTapGesture`/位移阈值语义；`swiperMath` 的两个阈值/判定是我们自加的，未在教程出现。
- web-core 预览与原生 LynxView 在 `main-thread-*` 处理上的差异未找到文档直接说明，属 `[推断]`。
- 未能运行 `rspeedy build` 或拆解 `__main-thread` bundle 输出，故 Q7 主因标 `[推断]`，并给出一组可执行的验证步骤。
