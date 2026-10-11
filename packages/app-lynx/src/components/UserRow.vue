<script setup lang="ts">
// UserRow —— 用户行（公共层六组件之一，ADR-0194 / T1 #748；术语表「UserRow（用户行）」）。
//
// 头像 + 用户名 + @account + 关注/取关按钮的行卡。消费方：FollowList（关注/粉丝）与后续
// MyPixiv（好P友，ADR-0193）；共用 UserPreview.user 形状（PixivUser，spec D7）。
// **纯表现层**：关注/取关业务语义（端点、乐观更新、busy 锁）留调用方——组件只在 busy 期间
// 吞掉 toggle 点击（与调用方防重入同口径的组件侧兜底，无新增可见行为）。
//
// 接口（调用方需要知道的全部）：
//   :user            PixivUser（渲染消费 name / account / profile_image_urls 字段）
//   :is-followed     关注态（调用方归一化后的布尔——PixivUser.is_followed 可能缺省，
//                    FollowList 对 following 列表把 undefined 归一为 true 后传入）
//   :busy            操作进行中：true 期间忽略 toggle 点击（不改视觉）
//   :follow-label    未关注按钮文案（调用方 i18n 注入；组件零文案，noDeadKeys 面不变）
//   :followed-label  已关注按钮文案
//   @row-tap         行信息区（头像+名）tap → 上抛（进用户主页决策留调用方）
//   @toggle          关注按钮 tap（busy 期间不发射）
//
// 平台事实：@tap 绑在内层 view（行信息区 / 按钮 view）——text 根与 list-item 根级 @tap
// 原生无效（ADR-0055 家族）。
import { computed } from 'vue'
import AppIcon from './AppIcon.vue'
import SkeletonImage from './SkeletonImage.vue'
import { proxyImageUrl } from '../utils/imageUrl'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import type { PixivUser } from '../api/types'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()


const props = withDefaults(
  defineProps<{
    /** 用户对象（UserPreview.user 形状） */
    user: PixivUser
    /** 关注态（调用方归一化后的布尔） */
    isFollowed: boolean
    /** 操作进行中：忽略 toggle 点击（不改视觉，防重入口径与调用方一致） */
    busy?: boolean
    /** 未关注按钮文案 */
    followLabel: string
    /** 已关注按钮文案 */
    followedLabel: string
  }>(),
  { busy: false },
)

const emit = defineEmits<{ (e: 'row-tap'): void; (e: 'toggle'): void }>()

/** 头像源：medium 优先、px_170x170 兜底后走图片代理（与 FollowList 存量逐字同链） */
const avatarSrc = computed(() =>
  proxyImageUrl(props.user.profile_image_urls?.medium || props.user.profile_image_urls?.px_170x170 || ''),
)

/** 关注按钮 tap：busy 期间吞掉（真锁在调用方，此处组件侧同口径防抖） */
function onToggle(): void {
  if (props.busy) return
  emit('toggle')
}
</script>

<template>
  <view class="flex flex-row items-center m-1.5 mx-3 p-3.5 bg-surface-container-lowest rounded-[var(--md-shape-medium)]">
    <!-- 关注/取关按钮：**行首**圆形图标按钮（ADR-0221 决策 2 / 票 #950）。
         原位置在行尾，实测右缘 93.06vw，落在 GlobalFab 遮挡带 80.80–95.73vw 内 ⇒
         点它开的是搜索弹层而不是 toggle（失败形态是「点了没反应」，故 ADR-0221 §4 记为债务）。
         **状态怎么表达**：字体子集里没有 person_add / person_check（仅 person / check /
         favorite_border），故两态同用 `person`，靠**填充对比**区分 —— 未关注 = outline 边框 +
         透明底，已关注 = bg-primary 实心 + 反色，与原药丸同一套视觉语言，未新造语义。
         文字不再渲染 ⇒ 状态改由 accessibility-label 承载（图标自身无文字语义，
         不补这条就是读屏用户的净损失）。 -->
    <view
      class="self-center mr-1.5 w-[10.667vw] h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)]"
      :class="[pressColor.className, isFollowed ? 'border border-outline bg-transparent active:bg-layer-pressed-primary' : 'bg-primary active:bg-layer-pressed-on-primary']"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="isFollowed ? followedLabel : followLabel"
      @tap="onToggle"
    >
      <AppIcon name="person" :class="isFollowed ? 'text-primary' : 'text-primary-on'" />
    </view>
    <!-- 行信息区：tap 进用户主页（事件上抛；view 承载 @tap，ADR-0055 家族） -->
    <view class="flex-1 flex flex-row items-center" @tap="emit('row-tap')">
      <SkeletonImage
        :src="avatarSrc"
        aspect-ratio="1 / 1"
        min-h="11vw"
        class="w-[10.667vw] h-[10.667vw] rounded-full"
        lazy-load
      />
      <view class="flex flex-col ml-3.5 flex-1">
        <text class="text-title-small font-medium text-surface-on [max-line:1]">{{ user.name }}</text>
        <text class="text-label-medium text-outline mt-0.5">@{{ user.account }}</text>
      </view>
    </view>
  </view>
</template>
