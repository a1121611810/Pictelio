# ADR-0116: app-lynx `<script setup>` SFC 禁止 ES module `export`（build-fix）

- 状态：accepted
- 日期：2026-08-30
- 关联：ADR-0115（推荐轮播）、`packages/app-lynx/CONTEXT.md`（「自研轮播」词条）、`packages/app-lynx/src/components/CarouselSwiper.vue`
- 来源：T5 真机验证会话——`pnpm build`（rspeedy）在 `CarouselSwiper.vue` 上失败，定位为 `<script setup>` 内的 `export { ... }`。

## 背景

`packages/app-lynx/src/components/CarouselSwiper.vue`（新组件）在 `<script setup lang="ts">` 顶部写了一句：

```ts
export { isTapGesture, TAP_DISPLACEMENT_THRESHOLD }
```

注释意图是「导出 tap 阈值供父组件复用」。但构建产物 `rspeedy build` 失败：

```
TypeError: Cannot read properties of null (reading 'map')
  at selectBlock (rspack-vue-loader/dist/select.js:50:22)
Import traces: ./src/components/CarouselSwiper.vue → CarouselSwiper.vue.ts?vue&type=script&setup=true&lang=ts
```

即 `rspack-vue-loader` 的 `resolveScript` 对该 `<script setup>` 解析失败。

**为什么此前"测试全绿"没暴露**：`vitest` 直接 import `src/primitives/swiperMath.ts`（不经过 `.vue` 的 `<script setup>` 编译）；`pnpm check:app-lynx`（`tsc --noEmit`）只按纯 TS 检查 `<script setup>` 块内容——在 TS 里 `export {}` 是合法 ES module 语法。两者都不走 `rspack-vue-loader` 的 SFC 编译路径，故该构造的非法性一直未被发现，直到真正 `rspeedy build`。

## 决策

1. **`<script setup>` 中禁止使用 ES module `export`**（命名导出或 `export default`）。vue-lynx 的 `<script setup>` 编译器不识别该构造，会导致 `rspack-vue-loader` 的 `resolveScript` 返回 null，`rspeedy build`/`pnpm build` 失败。
2. **组件对外暴露子模块能力时，直接引用底层纯函数模块，不再经组件 re-export**。`CarouselSwiper.vue` 删掉 `export { isTapGesture, TAP_DISPLACEMENT_THRESHOLD }`，并把 `isTapGesture`/`TAP_DISPLACEMENT_THRESHOLD` 从 import 中移除——它们本就定义在 `src/primitives/swiperMath.ts`，父组件若要 tap 判定，直接从 `swiperMath` 导入即可（`swiperMath` 已有独立单测，`README`/`CONTEXT` 亦以其为单一事实源）。
3. 保留组件其余 main-thread 滑动设计与 ADR-0115 一致（本轮只修构建，不改轮播行为；主线程脚本在原生端的支持度验证属 T5/后续，见 ADR-0115「待验证项」）。

## 被考虑的方案

- **保留 export，改用普通 `<script>` 块**：`<script setup>` 只能有一个块，且与 `<script setup>` 混用会引入额外复杂度；为一次 re-export 不值得。
- **保留 export（视为漏网）**：构建失败，不可接受。
- **移出到独立 `.ts` 再 import**：`isTapGesture`/`TAP_DISPLACEMENT_THRESHOLD` 已在 `swiperMath.ts`，无需再建文件。采纳（即本决策做法）。

## 后果

**正面**：
- `rspeedy build` / `pnpm build` 恢复通过，app-lynx 可构建。
- 明确一条 vue-lynx SFC 硬约束，避免后续再踩「测试全绿但构建失败」。

**负面**：
- `CarouselSwiper.vue` 不再对外 re-export tap 阈值；父组件（推荐页）需从 `swiperMath` 直接导入（本次父组件未实际使用，故无调用方改动）。
- 该约束属 vue-lynx SFC 编译器的隐性限制，需靠本 ADR + 代码注释（`[build-fix]`）防止复发；`tsc`/`vitest` 不会自动拦截。
