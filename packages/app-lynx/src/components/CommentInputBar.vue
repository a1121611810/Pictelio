<script setup lang="ts">
// ─── 评论输入栏（app-lynx，issue #163 / spec #161） ───
// 原生 input（Login.vue 同款：显式 box-border + 去 UA 边框 + placeholder-color）。
// 发送约束：空输入 / 超 2000 字 / 发送中 均禁用；emit('submit', text) 后清空自身输入，
// 回复态由父层（CommentOverlay）在提交成功后清除。
import { ref, computed } from 'vue'
import type { PixivComment } from '../api/types'
import { t } from '../i18n'
import { MAX_COMMENT_LENGTH } from '../api/comment'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()


const props = defineProps<{
  /** 发表中：发送按钮禁用并显示「发送中…」 */
  posting: boolean
  /** 操作类错误（发送/删除/楼层失败），展示在输入栏区域 */
  error: string | null
  /** 回复态：非空时显示「回复 xxx」提示条 + 取消 */
  replyingTo: PixivComment | null
}>()

const emit = defineEmits<{
  submit: [text: string]
  cancelReply: []
}>()

const text = ref('')

// ─── M3 filled text field（ADR-0209 决策 1 形态 / 决策 2 label 浮动）───
/** 聚焦态：Lynx 上 `:focus` / `:focus-visible` **伪类**不生效（ADR-0207 决策 5 真机实证），
 *  死的是伪类不是事件——input 元素的 bindfocus / bindblur 官方支持（Android/iOS/Harmony，since 3.4），
 *  故聚焦表现一律由事件驱动（官方文档 Events 段：bindblur / bindconfirm / bindfocus / bindinput / bindselection）。 */
const focused = ref(false)

/** label 浮动态 = 聚焦中 **或** 值非空（MD3 官方语义）。用 computed 派生而非在事件里直写：
 *  blur/input 乱序时不会出现「值已非空但 label 落回静止态」的自相矛盾态。 */
const labelFloating = computed(() => focused.value || text.value.length > 0)

/** 竞态防护（AGENTS.md 硬约束 3）：失焦瞬间仍可能在途 input 事件（Android 收起输入法 / 快速点按切换焦点）。
 *  闸门取「失焦瞬间的值快照」——blur 之后只有值真的变了才认定用户仍在编辑并恢复聚焦表现；
 *  真离开时值不变 ⇒ 不会留下假的 2px primary 指示条。 */
let valueAtBlur = ''

function onFocus(): void {
  focused.value = true
}

function onBlur(): void {
  valueAtBlur = text.value
  focused.value = false
}

/** 输入闸门：v-model 已先赋值（vue-lynx injectVModelEvent 保证顺序，SearchSheet 同约定），
 *  故此处读 text.value 拿到的是本拍的新值。 */
function onInput(): void {
  if (!focused.value && text.value !== valueAtBlur) focused.value = true
}

/** 输入框的动态类：浮动态让位（顶部 padding 给 label）、聚焦态指示条加粗转 primary。
 *  ⚠️ 静态 class 必须写在模板里 :class 之前：形态门禁 tests/md3FilledTextField.test.ts
 *  读的是 input 标签上的**静态** class 属性值（正则取第一个 class=" 命中）。
 *  同理：**注释里不要写 input 标签的字面量**——门禁的正则会把它当成一处空属性的 input 判红。 */
const inputCls = computed(() =>
  [
    labelFloating.value ? 'pt-[5.333vw]' : '',
    focused.value ? 'border-b-[2px] border-b-primary' : '',
  ]
    .filter(Boolean)
    .join(' '),
)

/** label 类：静止 body-large + on-surface-variant（容器内垂直居中）/ 浮动态 body-small + primary（贴顶）。
 *  纵向偏移按 56dp 容器手算（1dp = 0.2667vw，glossary-lynx-units.md）：
 *  静止 top 16dp + body-large 行高 24dp + 下留白 16dp = 56dp；
 *  浮动态 top 4dp + body-small 行高 16dp = 底边 20dp，正好让位给 pt-[5.333vw]（20dp）的输入文字。 */
const labelCls = computed(() =>
  labelFloating.value
    ? 'top-[1.067vw] text-body-small text-primary'
    : 'top-[4.267vw] text-body-large text-surface-on-variant',
)

// 可发送：非空、未超 2000 字、未发送中
const canSend = computed(() => {
  const t = text.value.trim()
  return t.length > 0 && t.length <= MAX_COMMENT_LENGTH && !props.posting
})

function send() {
  if (!canSend.value) return
  emit('submit', text.value)
  // 发送后清空输入（prototype 同款）；回复态由父层按 post 结果清除
  text.value = ''
}
</script>

<template>
  <view class="w-full bg-surface-container-lowest border-t border-t-outline-variant px-3 py-2">
    <!-- 回复态提示条：回复 xxx + 取消 -->
    <view v-if="replyingTo" class="flex flex-row items-center justify-between mb-2">
      <text class="text-label-medium text-primary [max-line:1] flex-1">{{ t('commentInputBar.replyingTo', { name: replyingTo.user.name }) }}</text>
      <text class="text-label-medium text-outline underline ml-2" @tap="emit('cancelReply')">{{ t('commentInputBar.cancel') }}</text>
    </view>

    <!-- 操作类错误（发表失败等）：输入栏区域展示 -->
    <text v-if="error" class="text-label-medium text-error mb-2">{{ error }}</text>

    <view class="flex flex-row items-center gap-2">
      <!-- M3 filled text field（ADR-0209）：label 绝对定位叠在输入框**容器内**，不参与 flex 流，
           ⇒ 「输入 + 发送」横向排布与 56dp 容器高度都不变（本票硬约束）。
           包装层用 flex-1 + flex-row + relative：input 保持 flex-1（撑满包装层），
           不用 w-full —— web-core 预览下 input 百分比宽度相对根容器（Login.vue 同款 [lynx:fix]）。 -->
      <view class="flex-1 flex flex-row relative">
        <!-- [lynx:fix] input 显式 border-box + 去 UA 边框（Login.vue 同款，ADR-0055） -->
        <!-- label 与 placeholder 同处容器中心会重影 ⇒ 改用 label 承担静止态文案，
             a11y 播报文本由 accessibility-label 承接（Login.vue 输入框同款写法） -->
        <input
          v-model="text"
          class="flex-1 h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-3"
          :class="inputCls"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('commentInputBar.placeholder')"
          @focus="onFocus"
          @blur="onBlur"
          @input="onInput"
        />
        <text class="absolute left-3" :class="labelCls">{{ t('commentInputBar.placeholder') }}</text>
      </view>
      <!-- 发送按钮：空输入 / 超长 / 发送中禁用 -->
      <view
        class="h-[10.667vw] px-5 flex items-center justify-center rounded-[var(--md-shape-full)] flex-shrink-0"
        :class="[pressColor.className, canSend ? 'bg-primary active:bg-layer-pressed-on-primary' : 'bg-surface-container-highest']"
        @tap="send"
      >
        <text class="text-label-large font-medium" :class="canSend ? 'text-primary-on' : 'text-outline'">
          {{ posting ? t('commentInputBar.posting') : t('commentInputBar.send') }}
        </text>
      </view>
    </view>
  </view>
</template>
