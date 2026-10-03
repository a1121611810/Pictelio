# Spike：原生 `<list>` 末尾追加 list-item 是否安全

- 日期：2026-10-03
- 设备：Android 模拟器 `emulator-5554`，Android 14（API 34），1080×2160，density 480
- 决策背景：[ADR-0217](../ADR-0217-bottom-occlusion-allowance-scoped-to-scroll-content.md) §3
- 状态：**通过**（PASS，附限制条件）

## 1. 为什么要 spike

ADR-0162 记录瀑布流 `list-item` **插入=静默丢弃 / 移除=留空位 / 替换=错位**，
但它真机验的是「**中途**插入」。底部遮挡让位需要「**末尾追加**」——
其安全性此前只有 ADR-0162 备选方案里一句「追加是已证明安全的 patch 路径」的**转述**，
没有任何一手实测。**不拿转述当承重墙**，故先 spike。

## 2. 做法

在 `IllustList.vue` 的 `<list>` 内**末尾**临时注入：

```vue
<list-item :key="'spike-allowance'" item-key="spike-allowance" class="w-full" full-span>
  <view class="h-[19.2vw] w-full" />
</list-item>
```

走完整构建链（`pnpm build` → `pnpm build:android-host` → `adb install`）后真机取证。

## 3. 结果

| 场景 | 观察 | 判定 |
|---|---|---|
| 冷挂载 | 瀑布流两列布局正常，卡片按 `listCrossAxisGap=12px` 排列，无错位 | ✅ |
| 连续滚动（8+ 次 fling） | 卡片持续正常渲染，无空白位、无丢弃、无重叠 | ✅ |
| 分页追加（滚到底触发 `loadMore`） | 追加后既有卡片位置不变，新卡正常入列 | ✅ |
| tab 切换（推荐 ⇄ 关注） | 列表重建后布局正常 | ✅ |

**结论：末尾追加不在 ADR-0162 的三种失效形态之内，真机行为安全。**
本记录取代 ADR-0162 中「追加是安全路径」那句转述，成为一手证据。

## 4. 限制条件（code-review Spec B4 要求登记）

⚠️ **本 spike 未覆盖的路径**（它们会**替换整个渲染流**，属 ADR-0162 的「移除/替换」类风险，
与末尾追加不同源，故不阻塞本决策，但**未取证**）：

- **标签静音过滤**：`useTagMuteVisible(useAiOnlyVisible(illusts))` 改变列表长度；
- **R18 过滤**：`visibleIllusts` 随设置变化而变短；
- **相关作品行注入/收起**：ADR-0162 的原始事故场景。

⇒ 这三条的渲染流替换行为由既有机制（`:key` 重建 / `refreshEpoch`）承担，
新增的末尾占位随之重建；**尚未单独 spike**。若后续这些路径出现列表结构异常，
应优先怀疑此处。留作后续票。

## 5. 复现方式

```bash
# 1. 注入上述 list-item 到 IllustList.vue 的 </list> 之前
pnpm build && pnpm build:android-host
adb install -r packages/android-host/android/app/build/outputs/apk/debug/app-debug.apk
# 2. 进入插画页，滚动 / 翻 tab / 到底触发分页，观察瀑布流是否错位
```

## 6. 与本 spike 配套的机器门禁

`packages/app-lynx/tests/bottomOcclusionAllowance.test.ts` 的「占位是 `<list>` 的最后一个子节点」
与「不得被带条件的 `<template>` 包裹」两条判据，锁住本 spike 验证的形态
（末尾追加 + 恒常驻），使该形态的回归在**装机前**即被拦下。
