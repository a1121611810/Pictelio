<script setup lang="ts">
// 【设备验收探针 · PROBE-ONLY（验收后删除；证据归档到 probe/text-selection-559 分支）】
// 挂**真实实现**：composables/useTextSelection + components/TextSelectionToolbar（同一份代码，非复刻），
// 只是把「段落源」换成页面内造的样本（无需登录 / 联网即可验完引擎侧行为）。
// 另外放一个 input 用于验证「复制真的进了系统剪贴板」（adb keyevent 279 粘贴）。
import { ref, computed } from 'vue'
import { useTextSelection } from '../composables/useTextSelection'
import TextSelectionToolbar from '../components/TextSelectionToolbar.vue'
import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

const SAMPLE = [
  '这是一段用于验收的正文，长按可以选中它。',
  '第二段：用来观察选区手柄与菜单定位是否落在正确位置。',
  '第三段带 emoji 🌸 与英文混合，用来验证索引切片不劈开代理对。',
  '第四段：滚动收起、空白收起、返回键收起都在这一段附近验证。',
  '第五段：继续加内容，保证列表可滚动（虚拟化回收路径也走到）。',
  '第六段：复制成功后可以用下面的输入框粘贴核对。',
  '第七段：搜索应当打开搜索弹层并预填选中的文字。',
  '第八段：这一段的文字比较长，用来观察在窄屏上选区跨越两行时菜单的定位。',
  '第九段：收尾。',
  '第十段：再多一段，确保滚动空间充足。',
]
const EXTRA = Array.from({ length: 16 }, (_, i) => `追加第 ${i + 1} 段：为了验证滚动收起与虚拟化回收路径，列表内容需要足够长。`)
const paragraphs = ref<readonly string[]>([...SAMPLE, ...EXTRA])
const selection = useTextSelection({ paragraphs })
const pasteBox = ref('')
/** 屏幕日志（JS console 不进 logcat：把引擎载荷直接上屏取证） */
const lastEvent = ref('(无选中事件)')
function onProbeSelection(e: unknown): void {
  const ev = e as { target?: { id?: string }; detail?: { start?: number; end?: number } }
  const nodeId = ev?.target?.id ?? '?'
  const start = ev?.detail?.start ?? -999
  const end = ev?.detail?.end ?? -999
  const chars = nodeId === '?' ? [] : Array.from((paragraphs.value[Number(nodeId.slice(2))] ?? ''))
  const slice = start >= 0 && end > start ? chars.slice(start, end).join('') : ''
  lastEvent.value = `node=${nodeId} start=${start} end=${end} len=${chars.length} slice=«${slice}»`
  selection.onSelectionChange(e as never)
}

function onSelectionAction(key: 'copy' | 'search'): void {
  if (key === 'copy') {
    selection.copy()
    return
  }
  selection.search()
}
</script>

<template>
  <view
    :id="selection.rootId"
    class="w-full h-full flex flex-col relative bg-surface"
    @tap="selection.onTapAway"
    @longpress="selection.notifyLongPress"
  >
    <view class="px-3 pt-2 pb-1 bg-surface-container">
      <text class="text-[26rpx] text-surface-on">设备验收探针 · 真实会话 + 真实工具栏</text>
      <text class="text-[24rpx] text-surface-on">visible={{ selection.view.visible }} · state={{ selection.view.copyState }}</text>
      <text class="text-[24rpx] text-on-surface-variant">{{ lastEvent }}</text>
      <!-- 粘贴核对框：adb input keyevent 279 把剪贴板内容粘进来（复制通道的真机证据） -->
      <input
        v-model="pasteBox"
        class="mt-1 h-[9vw] bg-surface-container-highest text-[26rpx] text-surface-on px-2"
        placeholder="粘贴核对框"
      />
    </view>

    <list
      class="w-full flex-1 min-h-0"
      list-type="single"
      scroll-orientation="vertical"
      :scroll-event-throttle="0"
      @scroll="selection.onScroll"
    >
      <!-- 取证锚点（洋红条）：adb 侧据此定位正文 -->
      <list-item :item-key="'anchor'" :estimated-main-axis-size-px="8" class="w-full">
        <view class="w-full h-[2vw] bg-[#ff00ff]" />
      </list-item>
      <list-item
        v-for="(p, idx) in paragraphs"
        :key="selection.paragraphId(idx)"
        :item-key="selection.paragraphId(idx)"
        :estimated-main-axis-size-px="120"
        class="w-full px-4 mb-4"
      >
        <text
          :id="selection.paragraphId(idx)"
          class="text-body-large leading-[44rpx] text-surface-on"
          text-selection="true"
          flatten="false"
          custom-context-menu="true"
          :bindselectionchange="onProbeSelection"
          >{{ p }}</text
        >
      </list-item>
    </list>

    <TextSelectionToolbar :view="selection.view" @action="onSelectionAction" />
  </view>
</template>
