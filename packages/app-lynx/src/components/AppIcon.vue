<script setup lang="ts">
// AppIcon —— 统一图标组件（ADR-0208 决策 3）。
//
// 存在的理由不是封装，是**可审计**：直接写字形等于把「用哪个图标」的决定权散落到
// 75 个 .vue，tests/iconMap.test.ts 的门禁无从判起（「模板里的图标是否都走了映射表」）。
// 所有图标位必须经本组件。
//
// 接口（调用方需要知道的全部）：
//   :name         必填，IconName 枚举值（utils/iconMap.ts ICON_CODEPOINTS 的键）
//   :label        无障碍名称，透传给 accessibility-label。**与图标并存不替代**
//                 （ADR-0208 决策 4）：unicode 字形时代 label 是唯一语义来源，
//                 换成规范图标后删 label 是读屏用户的净损失。
//   :size         字号（vw），缺省 6.4vw——与存量图标位主字号同口径
//   :class        附加类（配色/布局），缺省继承 currentColor
//
// 未知 name 直接抛错（utils/iconMap.ts iconChar），不静默渲染空白。
//
// @font-face **不在本组件**，改由 `src/styles/icon-font.css`（App.vue 顶部 @import）提供。
// 原因（真机实证的缺陷，非风格选择）：放在本组件 <style> 里的
// `src: url('../assets/fonts/xxx.ttf')` 会被打包器改写成 `webpack:///static/xxx.<hash>.ttf`，
// 而 Lynx 官方 @font-face 文档写明 url() 只支持**远程地址与 base64**，
// `webpack:///` 这个 scheme 原生端不解析 ⇒ 字体静默不加载 ⇒ 私用区码点回退默认字体
// ⇒ 全站图标渲染成豆腐块 ⊠（无报错、无崩溃，cmap 与族名断言全绿）。
// 声明与本组件同源同命的另一面是：族名字符串在 utils/iconMap.ts 的 ICON_FONT_FAMILY，
// 字体文件由 scripts/generate-icon-subset.py 从同一份 ICON_CODEPOINTS 生成，
// 三者由 tests/iconMap.test.ts 双向锁死。
import { computed } from 'vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { ICON_FONT_FAMILY, type IconName, iconChar } from '../utils/iconMap'

const props = withDefaults(
  defineProps<{
    /** 图标名（ICON_CODEPOINTS 的键） */
    name: IconName
    /** 无障碍名称（透传 accessibility-label）。缺省 = 该图标位不单独标注
     *  （须由外层可聚焦元素提供 label，与存量页面的标注方式一致）。 */
    label?: string
    /** 字号（vw）；缺省 6.4vw */
    size?: number
    /** 附加类（配色 / 布局），缺省继承 currentColor */
    class?: string
  }>(),
  { size: 6.4, class: '' },
)

// 查表得字符（未登记的 name 在此抛错 → 门禁 + 运行时双拦）
const glyph = computed(() => iconChar(props.name))
</script>

<template>
  <text
    class="leading-none"
    :class="props.class"
    :style="{ fontFamily: ICON_FONT_FAMILY, fontSize: `${props.size}vw` }"
    :accessibility-element="A11Y_ELEMENT_ENABLED && props.label !== undefined"
    :accessibility-label="props.label"
    >{{ glyph }}</text
  >
</template>

