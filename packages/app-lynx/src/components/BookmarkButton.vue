<script setup lang="ts">
// 收藏按钮（列表卡片 ♥ + 详情页 ♥ 复用）
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
// init-only props（illustId/initialBookmarked/bookmarkCount）：宿主必须按作品 remount（:key），
// 否则状态机冻结在首卡（ADR-0163；真实缺陷：轮播收藏数恒首卡值，commit 44ee6401）。
// 宿主矩阵契约测试：BookmarkButton.host-matrix.test.ts。
import { onBeforeUnmount, ref } from 'vue'
import {
  BOOKMARK_ANIMATION_MS,
  useBookmarkMutation,
  type UseBookmarkMutationReturn,
} from '../composables/useBookmarkMutation'
import { useLongPress, type TouchLikeEvent } from '../composables/useLongPress'

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
// 注入路径不重复建实例（同一份 ref，面板 saveWith 与本组件 toggle 互斥共用 busy 锁）
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
  const id = nextRingId++
  rings.value.push({ id, mode: target ? 'out' : 'in' })
  // 无 animationend（ADR-0111）：固定时长后清理环节点（仅节点清理，不驱动动画帧）
  setTimeout(() => {
    rings.value = rings.value.filter((r) => r.id !== id)
  }, BOOKMARK_ANIMATION_MS)
}

function onTap() {
  // 长按已开面板：同一次手势的 tap 必须被吞掉（不额外走快速收藏，spec D3 双轨互斥）
  if (longPress.consumeLongPress()) return
  if (bm.busy.value) return
  const target = !bm.bookmarked.value
  startBurst(target)
  void bm.toggle()
}

function onTouchStart(e: TouchLikeEvent): void {
  if (!props.enableLongPress) return
  longPress.onTouchStart(e)
}
function onTouchMove(e: TouchLikeEvent): void {
  if (!props.enableLongPress) return
  longPress.onTouchMove(e)
}
function onTouchEnd(): void {
  if (!props.enableLongPress) return
  longPress.onTouchEnd()
}

onBeforeUnmount(() => {
  longPress.cancel()
})

/**
 * 收藏爆发动效重播（T5 面板保存成功路径）：宿主（IllustDetail）在 saveWith 成功后经
 * 模板 ref 调用——与单击收藏播同一动效资产（webview handleBookmarkSaved 同语义）。
 */
function playBurst(): void {
  startBurst(true)
}

defineExpose({ playBurst })
</script>

<template>
  <view
    class="flex flex-row items-center"
    @tap.stop="onTap"
    @touchstart="onTouchStart"
    @touchmove="onTouchMove"
    @touchend="onTouchEnd"
  >
    <view class="relative flex items-center justify-center">
      <!-- state-layer 环层（主心下层）：收藏红环扩散 / 取消灰环收拢 -->
      <view
        v-for="r in rings"
        :key="r.id"
        class="absolute left-0 top-0 right-0 bottom-0 flex items-center justify-center"
      >
        <view
          class="rounded-full border-2 border-solid w-[5.6vw] h-[5.6vw]"
          :class="r.mode === 'out' ? 'border-error bookmark-ring-out' : 'border-outline bookmark-ring-in'"
        />
      </view>
      <!-- 主心（transform 承载用 view 不用 text，ADR-0108 决策 2；:key 重挂载重播 pop） -->
      <view :key="animSeq" :class="animSeq > 0 ? (lastTarget ? 'bookmark-pop-add' : 'bookmark-pop-remove') : ''">
        <!-- ♥\uFE0E：U+FE0E 强制 text presentation——裸 U+2665 在 Lynx 原生被解析为彩色 emoji
             字形（固有色 #fa242f），CSS color 完全失效（心形恒红，真机实测 2026-08-25，ADR-0112） -->
        <text class="text-[6.4vw] leading-none" :class="bm.bookmarked.value ? 'text-error' : 'text-outline'">♥︎</text>
      </view>
    </view>
    <text v-if="bookmarkCount !== undefined" class="text-label-medium text-outline ml-1">{{ bm.count.value }}</text>
    <text v-if="bm.errorMsg.value" class="text-label-medium text-error ml-1">{{ bm.errorMsg.value }}</text>
  </view>
</template>

<!-- 收藏动效样式（ADR-0112）：全局 <style>（scoped keyframes 未验证面，同 RefreshableList 约定）；
     类名 bookmark-pop-* / bookmark-ring-* 全仓唯一。
     红线：缓动/时长一律引用 M3 令牌变量，禁止 bezier/ms 字面量。 -->
<style>
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
