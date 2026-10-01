<!-- 小说介绍页次级动作按钮基础组件（spec docs/specs/app-lynx-novel-intro-action-row §5.1）。
     - 视觉族：图标 + 短文字 chip，等宽四列，遮罩黑色背景上够清晰
     - 三态：default（white/85）、active（text-tertiary，M3 tertiary 实色）、disabled（opacity-50 + 不响应 tap）
     - i18n 不在此处处理：label 由父组件传入已翻译文本（spec 设计：组件本身无 i18n 依赖，纯展示）
     - **禁用态的拦截靠模板里的 `@tap` 处理器守卫（见下），不靠 CSS**。
       原先此处写的是 `opacity-50 pointer-events-none`，而 `pointer-events-none`
       在本项目**是死类名**：`@lynx-js/tailwind-preset@0.5.1` 用 `corePlugins: DEFAULT_CORE_PLUGINS`
       白名单（57 项）裁掉了 `pointerEvents`（`cursor` / `select` 同样被裁；`opacity` 在），
       实测产物里既无 `.pointer-events-none` 也无 `.pointer-events-auto`（同批 `opacity-50`、
       `bg-surface-tint` 均正常产出，作阳性对照），且 `dist/main.lynx.bundle` 里
       `pointer-events` 全文 0 命中。Lynx 不支持该 CSS 属性。
       保留一个「看起来在防护、实际不防护」的类名比不写更危险，故已删除。
       白名单条数以 `tests/lynxUnsupportedTailwindClasses.test.ts` 的快照判据实跑输出为准。
       ⚠️ **「不在白名单 ⇒ 死类名」不是本 preset 的通用判据**，另有两种相反情形，
       记在此处免得后人照搬本段去推断别的类名：
       ① `transition` 族（`transitionProperty` / `transitionDuration` /
          `transitionTimingFunction`）同样不在白名单，但 preset 用**自定义 plugin**
          （`createPlugin` + `matchUtilities`）把它**补了回来、绕开白名单** ⇒ 产物里
          `transition-colors` / `duration-[…]` / `ease-[…]` 都是真规则，且真机取样确认过渡
          **会插值**（时长令牌临时改 2000ms 后连拍得 6 帧连续不同的中间态、收敛 ≈2100ms）。
          ⇒ `transition-*` **不是**死类名（此前把 transition 列为「同样被裁」的记载已作废）。
       ② `transform` 族走同一条自定义 plugin 通道，工具类**能产出规则**；它失效的原因在别处：
          规则引用的 `--tw-*` 变量（`--tw-tx` / `--tw-rz` …）在本项目产物里**从未被定义**
          （Tailwind 默认的 `* { --tw-tx: 0; … }` 定义块不在产物中）⇒ `var()` 取不到值、
          **渲染为空**。所以「工具类能产规则」也不等于「在 Lynx 上有效」。
       判死类名的判据是**产物里有没有对应规则**，不是「名字在不在白名单里」。
     - ADR-0086：图标 / 间距一律 vw（具体值取自 spec §5.1），不写 rem -->
<script setup lang="ts">
import AppIcon from './AppIcon.vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import type { IconName } from '../utils/iconMap'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走工具类；透明度/尺寸类走 inline `:style`——`.transition-colors` 的 transition-property 不含 opacity，挂工具类是静默失效。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor, pressOpacity } = useMotion()


const props = defineProps<{
  /** 图标名（IconName；utils/iconMap.ts ICON_CODEPOINTS 的键）。
   *  **不是字形串**——ADR-0208 收口：私用区码点配默认字体会静默渲染成空白。 */
  icon: IconName
  /** 标签文字（如「收藏」「追更」「下载」「目录」，已翻译文本由父组件传入） */
  label: string
  /** 已激活态（如已追更 / 已下载）—— 文字切 text-tertiary */
  active: boolean
  /** 禁用态（如 masked R-18/R-18G/AI 屏蔽态）—— opacity-50 + @tap 处理器不 emit */
  disabled: boolean
}>()

const emit = defineEmits<{ tap: [] }>()
</script>

<template>
  <view
    class="flex-1 min-w-0 flex flex-col items-center justify-center py-2 rounded-[var(--md-shape-medium)]"
    :class="[
      pressColor.className,
      disabled ? 'opacity-50' : 'active:bg-white/10',
      active ? 'text-tertiary' : 'text-white/85',
    ]"
    :accessibility-element="A11Y_ELEMENT_ENABLED"
    :accessibility-label="props.label"
    @tap="props.disabled ? null : emit('tap')"
  >
    <AppIcon :name="props.icon" />
    <text class="text-label-small mt-1">{{ props.label }}</text>
  </view>
</template>
