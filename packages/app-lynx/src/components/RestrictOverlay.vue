<script setup lang="ts">
// R18/R18G 受限条目遮罩（issue #91：过滤 → 遮罩；M3 化改造）。
//
// 两种用法：
// - overlay（默认 true）：绝对定位铺满父容器（调用方需给父容器加 relative），
//   用于详情页正文等「内容仍渲染、遮罩覆盖其上」的场景（NovelDetail）。
// - overlay=false：纯流内徽章块（无 absolute、无背景），调用方用 bg-scrim 卡包裹
//   并控制尺寸——列表卡（single list / waterfall）必须用此模式：真机 LynxView 下
//   absolute 子元素会被 list item 高度测量算进内容高度，导致受限条目卡被撑满
//   整个内容区（实测 2026-08-11，小说推荐页满屏遮罩）。
// 无任何交互——不跳设置、无按钮、无提示，点击遮罩不响应也不应穿透到下层卡片的 tap。
// M3 形态：scrim 半透明黑遮罩 + 中央徽章（R-18=error-container / R-18G=error）。
const props = defineProps<{
  level: 1 | 2
  /** false = 纯流内徽章块（列表卡用，调用方自备 bg-scrim 背景与尺寸）；默认 true = 绝对定位覆盖 */
  overlay?: boolean
}>()

const badge = props.level === 2 ? 'R-18G' : 'R-18'

// 空处理器：阻止 tap 穿透触发下层卡片的 openDetail（web-core 实测若仍穿透，改 .stop）
function swallow() {}
</script>

<template>
  <view
    class="restrict-overlay"
    :class="overlay === false ? 'restrict-overlay-inline' : ''"
    @tap="overlay === false ? undefined : swallow"
  >
    <view class="flex flex-col items-center">
      <text
        class="text-label-medium font-semibold px-2 py-0.5 rounded-[var(--md-shape-extra-small)]"
        :class="level === 2 ? 'bg-error text-error-on' : 'bg-error-container text-error-on-container'"
      >{{ badge }}</text>
      <text class="text-label-medium text-white mt-2" style="opacity: 0.8">受浏览限制，不予显示</text>
    </view>
  </view>
</template>

<style scoped>
.restrict-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  /* [lynx:fix] 显式 width/height 100%：真机 LynxView 下仅靠 top/right/bottom/left
     四边推算尺寸不可靠（列表 item 高度测量异常，实测 2026-08-11）。 */
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* M3 scrim：半透明黑遮罩（Lynx 确认支持纯色 + 透明度），替代原伪玻璃 */
  background-color: var(--md-scrim);
  border-radius: var(--md-shape-medium);
}

/* 列表卡流内模式：无定位、无背景——背景与尺寸由调用方 bg-scrim 卡提供 */
.restrict-overlay-inline {
  position: static;
  width: auto;
  height: auto;
  background: none;
  border-radius: 0;
}
</style>
