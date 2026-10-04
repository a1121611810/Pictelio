<script setup lang="ts">
// 收藏按钮（列表卡片 ♥ + 详情页 ♥ 复用）
// 配色（方案 E，spec docs/specs/bookmark-color.md §E「Dark Glass」）：
//  - chip 容器：M3 inverse-surface 实色（亮主题 = 深灰 #2e3136；暗主题自动 = 浅色），
//    跳过 rgba + backdrop-filter（lynx 原生 backdrop-filter 不可用，C8 platform fact）；
//    chip 与底图（亮 surface / 暗图 / scrim 黑底）都拉出反差，永远可读。
//  - 未收藏：心形 inverse-on-surface、计数 inverse-on-surface。视觉像一颗「暗背景嵌白心」胶囊。
//  - 已收藏：chip 切 tertiary 实色（#3b6470 / 暗主题亮色 accent），心形 on-tertiary、计数 tertiary-container
//    （比心形略弱、形成 chip 内部层次）。
//  - ring 颜色 = chip 内前景色（未收藏 = inverse-on-surface、已收藏 = on-tertiary）。
// ADR-0112：M3 动效（state-layer 环扩散/收拢 + Expressive spring 弹心）+ 乐观触发。
// T4 迁移（ADR-0141）：状态机从 primitives/createBookmarkToggle 改为 composable
// useBookmarkMutation（useMutation 替代 deps.add/remove；getter 形态保持不变 → 模板零变化）。
// T5 双轨收藏（spec docs/specs/bookmark-tags.md D3/D8 + ADR-0160 D4）：
//  - mutation 可选注入：详情页把页面持有的同一实例传进来（心形快速收藏与收藏面板保存
//    共用一份状态/计数，避免第二份状态漂移）；列表卡片缺省自建，行为不变。
//  - enableLongPress：详情页启用手势——按住 500ms 上抛 longPress（宿主开收藏面板），
//    同一次手势的 tap 被吞掉（不额外触发快速收藏）。列表卡片不开（列表不加入口，spec D3）。
//  - playBurst：面板保存成功后由宿主经模板 ref 调用（与单击收藏播同一动效资产）。
// @tap.stop：阻止冒泡到卡片 tap（进详情），需实测 vue-lynx 是否支持 .stop。
// init-only props（illustId/initialBookmarked/bookmarkCount/targetKind）：宿主必须按作品
// remount（:key），否则状态机冻结在首卡（ADR-0163；真实缺陷：轮播收藏数恒首卡值，commit 44ee6401）。
// targetKind 与 mutation 注入互斥：注入路径的端点语义随注入实例，props.targetKind 被忽略（warn）。
// 宿主矩阵契约测试：BookmarkButton.host-matrix.test.ts。
//
// disabled（#865）：输入闸门，**响应式**（刻意不进 init-only 集合——它不进状态机构造，
// 每次交互读一次；masked 由作品数据 + 设置 store 派生，运行中会变，冻结即失效）。
// 拦截落在本组件的输入边界，共三条通道，一并关：
//   1. tap 入口短路（不出网 / 不翻转 / 不 emit change）；
//   2. 长按通道不注册计时（否则置灰页面仍能长按弹出可写收藏的面板）；
//   3. burst 不播（否则「按了有动画却没写入」——state-layer 反馈与写入必须同生共死）。
// **注入路径同样生效**：闸门在本组件手势面而非状态机上。自建与注入共用同一段守卫，
// 故详情页（IllustDetail 注入页面级 mutation）传 disabled 一样拦得住；反之注入实例本身
// 不被冻结——面板 saveWith 是宿主的独立入口，不经本组件手势，不在本 prop 管辖范围内
// （要把闸门下沉到共享状态机会波及面板路径，属越界改动）。
// 视觉置灰由宿主负责（NovelIntro 的 wrap 已挂 opacity-50），组件内不再叠一层避免双重变暗。
// 拦截靠处理器守卫而非 CSS：pointer-events 在 Lynx 是死类名（preset 白名单裁掉 pointerEvents）。
import { onBeforeUnmount, ref } from 'vue'
import {
  BOOKMARK_ANIMATION_MS,
  useBookmarkMutation,
  type UseBookmarkMutationReturn,
} from '../composables/useBookmarkMutation'
import { useLongPress, type TouchLikeEvent } from '../composables/useLongPress'
import { useReducedMotion } from '../composables/useReducedMotion'
import AppIcon from './AppIcon.vue'

const props = defineProps<{
  illustId: number
  initialBookmarked: boolean
  /** 收藏数（可选，传入则显示计数） */
  bookmarkCount?: number
  /** 外部共享的状态机实例（详情页：心形 + 收藏面板共用；缺省自建——列表卡片路径）。
   * 注入时本组件的 change 事件不再上抛（onChange 归宿主，同一实例只有一份回调） */
  mutation?: UseBookmarkMutationReturn
  /** 启用长按唤出收藏面板（详情页专用；spec D3 列表卡片不加入口） */
  enableLongPress?: boolean
  /** 收藏目标类型（spec #585 / 票 #587）：默认插画；小说介绍页传 'novel'（端点分派） */
  targetKind?: 'illust' | 'novel'
  /** 禁用态（#865：宿主屏蔽态，如 NovelIntro 的 masked = R-18/R-18G/AI 屏蔽）。
   *  行为层拦截：tap / 长按 / 动效反馈三条通道全关，不出网、不翻转状态机、不 emit change。
   *  响应式（非 init-only，见文件头注）；视觉置灰由宿主负责，本组件不叠 opacity。 */
  disabled?: boolean
}>()

// change 事件：动画播完后上抛（动画完成态，ADR-0112 决策 4；供收藏列表等宿主移除已取消收藏的项）
const emit = defineEmits<{
  change: [bookmarked: boolean]
  /** 长按（500ms）触发：宿主打开收藏面板 */
  longPress: []
}>()

// useBookmarkMutation composable（替代 createBookmarkToggle）：
// - 内部 useMutation 调 apiClient.post → 401 重试走 apiClient seam
// - onMutate 立即翻转（乐观触发，状态机保持与原 primitive 等价）
// - onSuccess 350ms 后 emit('change')（动画完成态，ADR-0112 D5）
// - onError 静息回滚 + errorMsg
// - busy 锁由 composable 内部维护
// 注入路径不重复建实例（同一份 ref，面板 saveWith 与本组件 toggle 互斥共用 busy 锁）。
// targetKind 仅自建路径生效：注入端点语义随宿主实例，误传会被静默吞——显式 warn（禁静默）。
if (props.mutation && props.targetKind === 'novel') {
  console.warn('[BookmarkButton] mutation 注入路径忽略 targetKind（端点语义随注入实例）')
}
const bm =
  props.mutation ??
  useBookmarkMutation({
    illustId: props.illustId,
    initialBookmarked: props.initialBookmarked,
    initialCount: props.bookmarkCount ?? 0,
    onChange: (bookmarked) => emit('change', bookmarked),
    targetKind: props.targetKind,
  })

// 长按通道（enableLongPress = false 时 handler 直接返回，不注册计时）
const longPress = useLongPress({ onTrigger: () => emit('longPress') })

// 减弱动效偏好（T03 #851）：复用统一能力，规则见 composable 头注。
// 本组件 4 条动效（bookmark-pop-add/remove + bookmark-ring-out/in）全走 R2/R3：
// 偏好开启时 spring pop 与 state-layer 环**不发生**——只降时长无效（缩放/位移是前庭反应主因），
// 且色板/心形字形的终态切换保留，收藏结果仍然可读。
const { reducedMotion } = useReducedMotion()

/** 主心 pop 重播代（:key 重挂载触发动画重播） */
const animSeq = ref(0)
/** tap 时刻的目标态快照：pop 动画类绑定快照而非实时态——
 * 失败静息回滚时 bm.bookmarked 翻转回来也不会触发反向 pop（ADR-0112 决策 3） */
const lastTarget = ref(false)

interface Ring {
  id: number
  mode: 'out' | 'in'
}
const rings = ref<Ring[]>([])
let nextRingId = 1

/** 播放一次收藏动效（state-layer 环 + 主心 pop）；target=true 收藏向、false 取消向 */
function startBurst(target: boolean) {
  lastTarget.value = target
  animSeq.value++
  // R3 弹性动效不生成：偏好开启时环节点一条都不建（建了也只是 350ms 后自毁的空节点），
  // 清理计时随之跳过——主心 pop 类在模板侧同样按 reducedMotion 门控。
  if (reducedMotion.value) return
  const id = nextRingId++
  rings.value.push({ id, mode: target ? 'out' : 'in' })
  // 无 animationend（ADR-0111）：固定时长后清理环节点（仅节点清理，不驱动动画帧）
  setTimeout(() => {
    rings.value = rings.value.filter((r) => r.id !== id)
  }, BOOKMARK_ANIMATION_MS)
}

function onTap() {
  // disabled 闸门置最前（#865）：拦截在入口，不依赖任何 CSS；三条通道（tap/长按/动效）同源于此
  if (props.disabled) return
  // 长按已开面板：同一次手势的 tap 必须被吞掉（不额外走快速收藏，spec D3 双轨互斥）
  if (longPress.consumeLongPress()) return
  if (bm.busy.value) return
  const target = !bm.bookmarked.value
  startBurst(target)
  void bm.toggle()
}

// 触摸三件套：disabled 优先于 enableLongPress —— 屏蔽态连计时都不注册，
// 否则按住 500ms 仍会 emit longPress 打开可写收藏的面板（与 tap 闸门同一条 #865 契约）
function onTouchStart(e: TouchLikeEvent): void {
  if (props.disabled) return
  if (!props.enableLongPress) return
  longPress.onTouchStart(e)
}
function onTouchMove(e: TouchLikeEvent): void {
  if (props.disabled) return
  if (!props.enableLongPress) return
  longPress.onTouchMove(e)
}
function onTouchEnd(): void {
  if (props.disabled) return
  if (!props.enableLongPress) return
  longPress.onTouchEnd()
}

onBeforeUnmount(() => {
  longPress.cancel()
})

/**
 * 收藏爆发动效重播（T5 面板保存成功路径）：宿主（IllustDetail）在 saveWith 成功后经
 * 模板 ref 调用——与单击收藏播同一动效资产。
 */
function playBurst(): void {
  startBurst(true)
}

defineExpose({ playBurst })
</script>

<template>
  <view
    class="bookmark-chip flex flex-row items-center gap-1 rounded-full px-2.5 py-1.5 self-start"
    :class="bm.bookmarked.value ? 'is-bookmarked' : ''"
    @tap.stop="onTap"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <view class="relative flex items-center justify-center">
      <!-- state-layer 环层（主心下层）：chip 内部前景色边圈，收藏扩散 / 取消收拢 -->
      <view
        v-for="r in rings"
        :key="r.id"
        class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
      >
        <view
          class="rounded-full border-2 border-solid w-[5.6vw] h-[5.6vw]"
          :class="r.mode === 'out' ? 'bookmark-ring-out' : 'bookmark-ring-in'"
        />
      </view>
      <!-- 主心（transform 承载用 view 不用 text，ADR-0108 决策 2；:key 重挂载重播 pop）。
           减弱动效下不挂 pop 类（R2/R3：缩放 spring 整条不发生，:key 重挂载保留不产生副作用）。 -->
      <view
        :key="animSeq"
        :class="animSeq > 0 && !reducedMotion ? (lastTarget ? 'bookmark-pop-add' : 'bookmark-pop-remove') : ''"
      >
        <!-- 图标位经 AppIcon（ADR-0208 决策 3）：name="favorite_border"。
             选型理由：本按钮语义 =「收藏」，取心形族（heart / favorite）而非 star——
             Material Symbols 的 star 语义是「评分 / 要点 / 已加入列表」，与 Pixiv 收藏非同一语义。
             原字形带 U+FE0E 强制 text presentation（裸 U+2665 在 Lynx 原生被解析为彩色 emoji
             字形、固有色 #fa242f，CSS color 完全失效，真机实测 2026-08-25，ADR-0112）；
             改走图标字体后该 emoji 解析缺陷同源消失，U+FE0E 不再需要。
             收藏/未收藏不换字形：FILL=0 子集里 favorite 与 favorite_border 同码点（ADR-0208 决策 1），
             状态由配色（text-tertiary-on / text-inverse-on-surface）表达。 -->
        <AppIcon
          name="favorite_border"
          :class="bm.bookmarked.value ? 'text-tertiary-on' : 'text-inverse-on-surface'"
        />
      </view>
    </view>
    <text
      v-if="bookmarkCount !== undefined"
      class="text-label-medium ml-1"
      :class="bm.bookmarked.value ? 'text-tertiary-container' : 'text-inverse-on-surface'"
    >{{ bm.count.value }}</text>
    <text v-if="bm.errorMsg.value" class="text-label-medium text-error ml-1">{{ bm.errorMsg.value }}</text>
  </view>
</template>

<!-- 收藏动效样式（ADR-0112）：全局 <style>（scoped keyframes 未验证面，同 RefreshableList 约定）；
     类名 bookmark-pop-* / bookmark-ring-* 全仓唯一。
     红线：缓动/时长一律引用 M3 令牌变量，禁止 bezier/ms 字面量。 -->
<style>
/* Chip 容器（方案 E 实色版，避开 lynx backdrop-filter platform fact）：
   未收藏 = M3 inverse-surface 深色；已收藏 = M3 tertiary 深蓝青。
   反差与底图（surface / scrim / 亮暗图）解耦——背景颜色始终高于底图对比度。
   深主题下 .dark 块中 inverse-surface 派生为浅色、tertiary 派生为浅色 accent，
   使 chip 主线齿牙始终与背景拉反差（不需反色逻辑）。
   尺寸 hug content —— 靠 template 的 self-start（align-self: flex-start）。真因：Lynx 的
   view 默认 display:flex / flex-direction:column / align-items:normal(≈stretch)，chip 作为
   flex item 被横向 stretch 到父容器宽（web-core 实测 chip 1116px == 父 `mt-5` 宽 1116px）。
   禁用 display: inline-flex 兜底：flex item 的 display 会被 blockify（CSS Flexbox §4.1），
   实测 computed display 仍是 "flex"、宽度不变 —— 该声明对拉伸完全无效（前一轮误修即此坑）。
   先例：NovelIntro.vue AI 徽章同用 self-start 挡 scrim 内同款拉伸。 */
.bookmark-chip {
  background-color: var(--md-inverse-surface);
}
.bookmark-chip.is-bookmarked {
  background-color: var(--md-tertiary);
}

/* 环颜色跟随 chip 状态（未收藏 = inverse-on-surface；已收藏 = on-tertiary） */
.bookmark-chip .bookmark-ring-out,
.bookmark-chip .bookmark-ring-in {
  border-color: var(--md-inverse-on-surface);
}
.bookmark-chip.is-bookmarked .bookmark-ring-out,
.bookmark-chip.is-bookmarked .bookmark-ring-in {
  border-color: var(--md-on-tertiary);
}

/* 主心 spring pop（M3 Expressive spring 近似）：300ms = --durationGentle */
@keyframes bookmark-pop-add {
  0% { transform: scale(0.75); }
  55% { transform: scale(1.18); }
  80% { transform: scale(0.97); }
  100% { transform: scale(1); }
}
.bookmark-pop-add {
  animation: bookmark-pop-add var(--durationGentle) var(--motion-emphasized-decelerate) both;
}

/* 主心下沉回稳（取消）：200ms = --durationNormal */
@keyframes bookmark-pop-remove {
  0% { transform: scale(1); }
  50% { transform: scale(0.88); }
  100% { transform: scale(1); }
}
.bookmark-pop-remove {
  animation: bookmark-pop-remove var(--durationNormal) var(--motion-standard) both;
}

/* state-layer 环扩散（收藏）：350ms = --durationMedium3 */
@keyframes bookmark-ring-out {
  from { opacity: 0.4; transform: scale(0.6); }
  to { opacity: 0; transform: scale(2.1); }
}
.bookmark-ring-out {
  animation: bookmark-ring-out var(--durationMedium3) var(--motion-emphasized-decelerate) both;
}

/* state-layer 环收拢（取消，"收回"语义）：250ms = --durationMedium1 */
@keyframes bookmark-ring-in {
  from { opacity: 0.35; transform: scale(1.8); }
  to { opacity: 0; transform: scale(0.6); }
}
.bookmark-ring-in {
  animation: bookmark-ring-in var(--durationMedium1) var(--motion-emphasized-accelerate) both;
}
</style>
