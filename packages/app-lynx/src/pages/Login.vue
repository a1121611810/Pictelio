<script setup lang="ts">
import { computed, ref } from 'vue'
import { navigate, markSessionEstablished } from '../router'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { LOGIN_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import { useTopInsetSpacer } from '../composables/useTopInsetSpacer'
import { presentError } from '../utils/errorPresentation'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'

/** 按压反馈载体（ADR-0211 决策 2）：颜色状态层走 transition-colors 工具类——`background-color` 在其 transition-property 覆盖内（已验证）。
 *  时长与曲线一律取自 composables/motion.ts（唯一入口），本组件不写时长/曲线字面量；
 *  R1 降级（prefers-reduced-motion）由 useMotion 统一处理，组件内不自行判断偏好。 */
const { pressColor } = useMotion()


const auth = useAuthStore()
const settings = useSettingsStore()
const tokenInput = ref('')
const submitting = ref(false)
const errorMsg = ref('')

// ─── M3 filled text field（ADR-0209 决策 1 形态 / 决策 2 label 浮动）───
/** 聚焦态：死的是 `:focus` 伪类（ADR-0207 决策 5），活的是 bindfocus/bindblur 事件
 *  （官方文档 Events 段，Android/iOS/Harmony since 3.4）⇒ 聚焦表现走事件驱动。 */
const focused = ref(false)

/** label 浮动态 = 聚焦中 **或** 值非空（MD3 官方语义）。派生而非事件直写：
 *  blur/input 乱序时不会出现「值已非空但 label 落回静止态」的自相矛盾态。
 *  本页的收益最直接：refresh_token 是一长串不透明字符，贴上后 placeholder 消失，
 *  浮动 label 是唯一还留在屏上的字段名（= 选 (a) 而非 (b) 的理由）。 */
const labelFloating = computed(() => focused.value || tokenInput.value.length > 0)

/** 竞态防护（AGENTS.md 硬约束 3）：失焦瞬间仍可能在途 input 事件（Android 收起输入法 / 快速点按）。
 *  闸门取「失焦瞬间的值快照」——blur 之后只有值真的变了才认定用户仍在编辑并恢复聚焦表现；
 *  真离开时值不变 ⇒ 不会留下假的 2px primary 指示条。 */
let valueAtBlur = ''

function onFocus(): void {
  focused.value = true
}

function onBlur(): void {
  valueAtBlur = tokenInput.value
  focused.value = false
}

/** 输入闸门：v-model 已先赋值（vue-lynx injectVModelEvent 保证顺序，SearchSheet 同约定） */
function onInput(): void {
  if (!focused.value && tokenInput.value !== valueAtBlur) focused.value = true
}

/** 输入框动态类：浮动态让位（顶部 padding 给 label）、聚焦态指示条 2px + primary。
 *  纵向偏移按 56dp 容器手算（1dp = 0.2667vw，glossary-lynx-units.md）：
 *  静止 top 16dp + body-large 行高 24dp + 下留白 16dp = 56dp；
 *  浮动态 top 4dp + body-small 行高 16dp = 底边 20dp，正好让位给 pt-[5.333vw]（20dp）。 */
const inputCls = computed(() =>
  [
    labelFloating.value ? 'pt-[5.333vw]' : '',
    focused.value ? 'border-b-[2px] border-b-primary' : '',
  ]
    .filter(Boolean)
    .join(' '),
)

const labelCls = computed(() =>
  labelFloating.value
    ? 'top-[1.067vw] text-body-small text-primary'
    : 'top-[4.267vw] text-body-large text-surface-on-variant',
)

async function submit() {
  if (submitting.value) return
  submitting.value = true
  errorMsg.value = ''
  try {
    await auth.loginWithToken(tokenInput.value)
    if (auth.isLoggedIn) {
      // ADR-0103：登录后 uid 已知 → 加载账号级 R18/R18G（跨 client 共享存储）
      await settings.loadSettings()
      // [lynx:fix] 登录成功 = 会话新起点（ADR-0049）：先清除会话标记（beginSession 语义，
      //  否则守卫会把随后的 replace 导航拦截回 /login）再 replace 导航入站
      markSessionEstablished()
      await navigate('/recommended', { replace: true })
    } else {
      errorMsg.value = auth.authError ?? t('login.error.failed') // i18n: 赋值时快照（瞬态）
    }
  } catch (err) {
    errorMsg.value = presentError(err, t('login.error.failed'))
  } finally {
    submitting.value = false
  }
}

// ─── 顶部安全区让位（#900 T1，数值唯一来源 utils/topInset.ts）───
// 本页**没有顶栏**，所以「页面自补偿」由根容器的第一个子节点承担（见模板注释）。
// 公共入口 = composables/useTopInsetSpacer（11 个页面共用一处，避免"改规则漏 N 处"）。
// 'bleed' 时恒 0 ⇒ 渲染 0 高，属正确行为，不特判。
const topInsetSpacer = useTopInsetSpacer()
</script>

<template>
  <view class="w-full h-full flex flex-col items-center bg-surface pt-[32vw]">
    <!-- 顶部安全区让位（#900 T1）：零内容 spacer + 显式 height，数值由 composables/useTopInsetSpacer
         统一裁决（理由全文见该 composable）。⚠️ **不要**改成给顶栏行加 paddingTop —— Lynx 的
         border-box UA 默认会让 padding 吃掉内容高度，而 web-core 预览不复刻该默认（App.vue
         转场包裹层 pb-18 已登记此坑）。'bleed' 模式恒 0 高，属正确行为，不要特判。 -->
    <view :style="{ height: topInsetSpacer + 'px' }" />
    <view class="flex flex-col items-center mb-10">
      <!-- [T07 白名单 · 有意保留 700] 本元素是**产品字标**（品牌标记），不是 MD3 内容文本：
           headline-large 官方字重为 regular(400)，MD3 的「emphasized」变体也只到 500，
           700 仅出现在 label-emphasized（chip/徽标）。字标刻意用 700 + 主色，承载品牌识别
           （AGENTS.md「有意偏离」第 1 条：保留品牌蓝、不跟随壁纸取色）。登录屏无同级 headline
           与之竞争 ⇒ 此处 700 是品牌语气，不是层级主张。
           失效条件：若日后引入真实 logo lockup 素材，本行随 logo 自身字重走，届时一并删除。
           逐处判定见 issue #855 验收第 4 条。
           机器可读的对侧在 `tests/typographyFontWeight.test.ts` 的 `WHITELIST`（file+marker+reason
           三元组，marker 就是本注释首句；删掉本注释 ⇒ 该门禁当场转红）。⚠️ 别去改
           `tests/md3-guard-whitelist.json`：那是**另一道门**（md3GuardScans）的台账，
           只覆盖 8 条形态规则、**不含字重**，往里加本行不会生效。 -->
      <text class="text-headline-large font-bold text-primary">Pictelio</text>
      <text class="text-body-medium text-surface-on-variant mt-2">Lynx Client</text>
    </view>

    <!-- [lynx:fix] Card 用 flex column：子元素靠 stretch 拉伸填充父宽，
         规避 web-core 下 input 百分比宽度相对根容器（而非父）导致的右溢出 -->
    <view class="w-[85%] bg-surface-container-lowest rounded-[var(--md-shape-medium)] p-6 flex flex-col">
      <!-- [lynx:fix] input 显式 border-box + 去 UA 边框：
           web-core 预览未复刻 Lynx 的 border-box 默认（UA 无 box-sizing 规则），
           content-box 下 width:100% + padding 会溢出；原生 LynxView 默认 border-box 无副作用 -->
      <!-- M3 filled text field（ADR-0209）：surface-container-highest 底 + extra-small(4dp) 顶圆角
           + 底部 1px 指示条；label 绝对定位叠在容器内（聚焦/有值时上移浮动态）。
           用 relative 包装层 + input 保持 self-stretch：不用 w-full —— web-core 下
           input 百分比宽度相对根容器（上方 [lynx:fix] 同款坑）。
           label 与 placeholder 同处容器中心会重影 ⇒ 静止态文案由 label 承担，
           placeholder 及其 placeholder-color 平台属性一并撤下。 -->
      <view class="relative self-stretch mb-3">
        <input
          v-model="tokenInput"
          class="self-stretch h-[14.933vw] box-border bg-surface-container-highest rounded-t-[var(--md-shape-extra-small)] rounded-b-none border-b-[1px] border-b-surface-on-variant text-body-large text-surface-on px-4"
          :class="inputCls"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="LOGIN_A11Y_LABELS.tokenInput"
          @focus="onFocus"
          @blur="onBlur"
          @input="onInput"
        />
        <!-- label 文案暂借 login.token.placeholder（新增 login.token.label 前不改 i18n 文件）：
             静止态读作「粘贴 Pixiv refresh_token」＝原 placeholder 文案（观感等价），
             聚焦后上移并转 primary，粘贴完成后仍留在屏上——这是选 (a) 的唯一新增收益。 -->
        <text class="absolute left-4" :class="labelCls">{{ t('login.token.placeholder') }}</text>
      </view>

      <text v-if="errorMsg" class="text-body-small text-error mb-2">{{ errorMsg }}</text>

      <!-- M3 filled button：primary 底 + 全圆角（pill） -->
      <view
        class="h-[10.667vw] bg-primary active:bg-layer-pressed-on-primary rounded-[var(--md-shape-full)] flex items-center justify-center"
        :class="pressColor.className"
        @tap="submit"
      >
        <text
          class="text-label-large font-medium text-primary-on"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="LOGIN_A11Y_LABELS.submit"
          >{{ submitting ? t('login.submitting') : t('login.submit') }}</text
        >
      </view>
    </view>

    <text class="text-label-medium text-surface-on-variant mt-6">{{ t('login.afterHint') }}</text>
  </view>
</template>
