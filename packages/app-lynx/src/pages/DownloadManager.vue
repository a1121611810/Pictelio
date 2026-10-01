<script setup lang="ts">
// [lynx:fix] KeepAlive include 匹配需要组件 name（ADR-0049）
defineOptions({ name: 'downloads' })
import { computed, onMounted, ref, watch } from 'vue'
import { goBack } from '../router'
import { useDownloadStore } from '../stores/downloadStore'
import { useModalStack } from '../stores/modalStack'
import { proxyImageUrl } from '../utils/imageUrl'
import type { DeleteMode } from '../utils/downloadQueueCore'
import {
  allSelected,
  availabilityFor,
  availabilityForAll,
  groupByIllust,
  groupKindLabel,
  hasDeletableFiles,
  progressText,
  selectAll,
  summarize,
  toggleId,
} from '../utils/downloadsViewModel'
import { DOWNLOAD_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'
import AppIcon from '../components/AppIcon.vue'
import EmptyState from '../components/EmptyState.vue'
import { t } from '../i18n'
import { useMotion } from '../composables/motion'

// ─── 下载管理页（spec docs/specs/download-manager.md §7.2） ───
// 列表 + 单选/多选 + 对全部或选中项的开始/暂停/停止/删除；删除二次确认二分；已完成可系统分享。
// 数据与动作来自 downloadStore（深模块），派生逻辑来自 utils/downloadsViewModel（纯函数）。
const dl = useDownloadStore()

/** 列表项逐项铺开（ADR-0211 决策 5 / issue 879）：按作品分组的卡片逐组错峰入场，延迟来自预设。
 *  本页 scroll-view **非虚拟滚动**（全量渲染，任务数有限），但组数随下载历史增长 ⇒
 *  STAGGER_MAX_ITEMS 上限保证「下载越多、最后一组出现越晚」不会发生。 */
const { listItemStyle } = useMotion()

const selected = ref<ReadonlySet<string>>(new Set<string>())
const deleteTarget = ref<readonly string[] | null>(null)
const statusMsg = ref('')

const tasks = computed(() => dl.state.tasks)
const groups = computed(() => groupByIllust(tasks.value))
const allIds = computed(() => tasks.value.map((t) => t.id))
const effectiveIds = computed<readonly string[]>(() =>
  selected.value.size > 0 ? [...selected.value] : allIds.value,
)
const availability = computed(() =>
  selected.value.size > 0
    ? availabilityFor(tasks.value, [...selected.value])
    : availabilityForAll(tasks.value),
)
const scoped = computed(() => selected.value.size > 0)
const deletingFiles = computed(() => hasDeletableFiles(tasks.value, deleteTarget.value ?? []))
const summary = computed(() => summarize(tasks.value, effectiveIds.value))

function toggle(id: string) {
  selected.value = toggleId(selected.value, id)
}

function toggleAll() {
  selected.value = allSelected(tasks.value, selected.value)
    ? new Set<string>()
    : selectAll(tasks.value)
}

function report(e: unknown) {
  statusMsg.value = e instanceof Error ? e.message : String(e)
}

async function actShare() {
  try {
    await dl.share(effectiveIds.value)
    statusMsg.value = t('downloads.shared') // i18n: 赋值时快照（瞬态）
  } catch (e) {
    report(e)
  }
}

function askDelete() {
  deleteTarget.value = effectiveIds.value
}

function closeDelete() {
  deleteTarget.value = null
}

// vue-lynx 实测：@tap 绑定「方法引用 / 直接调用」可用，但内联逻辑表达式
// （如 `a && b()`）不触发——故统一包成方法（含可用性守卫）。
function runStart() {
  if (availability.value.start) dl.start(effectiveIds.value)
}
function runPause() {
  if (availability.value.pause) dl.pause(effectiveIds.value)
}
function runStop() {
  if (availability.value.stop) dl.stop(effectiveIds.value)
}
function runShare() {
  if (availability.value.share) void actShare()
}
function runDelete() {
  if (availability.value.delete) askDelete()
}

async function confirmDelete(mode: DeleteMode) {
  const target = deleteTarget.value
  if (!target) return
  try {
    await dl.deleteTasks(target, mode)
    statusMsg.value = mode === 'files' ? t('downloads.deletedFiles') : t('downloads.deletedRecords') // i18n: 赋值时快照（瞬态）
    selected.value = new Set<string>()
  } catch (e) {
    report(e)
  } finally {
    deleteTarget.value = null
  }
}

// 删除确认弹窗接入 modalStack：系统返回优先关弹窗（对齐 Watchlist 行为）
watch(deleteTarget, (target, _prev, onCleanup) => {
  if (!target) return
  const unregister = useModalStack().registerModal(() => {
    deleteTarget.value = null
  })
  onCleanup(unregister)
})

onMounted(() => {
  void dl.hydrate()
})
</script>

<template>
  <view class="w-full h-full flex flex-col bg-surface">
    <!-- M3 TopAppBar：次级页，返回箭头 + 标题 -->
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view
        class="py-1 pr-2"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="DOWNLOAD_A11Y_LABELS.back"
        @tap="goBack"
      >
        <!-- 返回箭头：T12 收口——`‹`（U+2039）已登记为 iconMap 的 arrow_back
             （ADR-0208 决策 3：凡在映射表内的一律算图标位），改走 <AppIcon>。
             尺寸/size 由 AppIcon 自带 leading-none + 默认 6.4vw 承担（ADR-0206 决策 3 装饰性例外） -->
        <AppIcon name="arrow_back" class="text-surface-on" />
      </view>
      <text
        class="flex-1 text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="DOWNLOAD_A11Y_LABELS.pageTitle"
        >{{ t('downloads.title') }}</text
      >
    </view>

    <text v-if="statusMsg" class="text-body-small text-primary px-4 pb-1">{{ statusMsg }}</text>

    <!-- 空态 -->
    <view
      v-if="tasks.length === 0"
      class="w-full flex-1 min-h-0 flex items-center justify-center"
    >
      <!-- T12 未收口：EmptyState 的 icon prop 契约是「裸文本字形」（组件内以默认字体渲染
           `text-[10.667vw]`，无字体族可切），换成 Material Symbols 私用区码点会渲染成空白 ——
           需 EmptyState 侧新增走 AppIcon 的入口（不属本票可改范围）。台账条目暂留。 -->
      <EmptyState icon="file_download" :title="t('downloads.empty.title')" :hint="t('downloads.empty.hint')" />
    </view>

    <template v-else>
      <!-- 工具栏：全选 + 计数 -->
      <view class="flex flex-row items-center justify-between px-4 py-2">
        <view
          class="h-[10.667vw] px-4 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)]"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="DOWNLOAD_A11Y_LABELS.toggleAll"
          @tap="toggleAll"
        >
          <text class="text-label-large text-primary">{{
            allSelected(tasks, selected) ? t('downloads.deselectAll') : t('downloads.selectAll')
          }}</text>
        </view>
        <text class="text-label-medium text-surface-on-variant">
          {{
            selected.size > 0
              ? t('downloads.countSelected', { selected: selected.size, total: tasks.length })
              : t('downloads.countAll', { total: tasks.length })
          }}
        </text>
      </view>

      <view class="w-full flex-1 min-h-0">
      <scroll-view scroll-orientation="vertical" class="w-full h-full">
        <view
          v-for="(group, i) in groups"
          :key="group.illustId"
          class="mx-3 my-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)] overflow-hidden"
          :style="listItemStyle(i)"
        >
          <view class="flex flex-row items-center p-3">
            <image
              class="w-[12vw] h-[12vw] rounded-[var(--md-shape-small)] bg-surface-container-high"
              :src="proxyImageUrl(group.thumbnailUrl)"
            />
            <view class="flex-1 flex flex-col ml-3">
              <text class="text-title-medium font-medium text-surface-on">{{
                group.title
              }}</text>
              <text class="text-label-medium text-surface-on-variant mt-0.5">{{
                groupKindLabel(group.kind, group.tasks.length)
              }}</text>
            </view>
          </view>
          <view
            v-for="task in group.tasks"
            :key="task.id"
            class="flex flex-row items-center px-3 py-2 border-t border-outline-variant"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="t('downloads.taskA11y', { name: task.fileName })"
            @tap="toggle(task.id)"
          >
            <view
              class="w-[5.333vw] h-[5.333vw] rounded-[var(--md-shape-extra-small)] border flex items-center justify-center mr-3"
              :class="
                selected.has(task.id)
                  ? 'bg-primary border-primary'
                  : 'bg-surface-container-lowest border-outline'
              "
            >
              <!-- T12/ADR-0208：✓ 裸字形 → Material Symbols `check`；选中态语义仍由外层行的
                   taskA11y 无障碍标签 + bg-primary 边框/底色表达，图标只画形状不承载语义。
                   :size=3.2vw = 原 text-[3.2vw]，保持勾选框内视觉尺寸不变 -->
              <AppIcon v-if="selected.has(task.id)" name="check" :size="3.2" class="text-primary-on" />
            </view>
            <view class="flex-1 flex flex-col">
              <text class="text-body-medium text-surface-on">{{ task.fileName }}</text>
              <view class="flex flex-row items-center mt-1">
                <view
                  v-if="task.status === 'downloading'"
                  class="h-[1.6vw] flex-1 bg-surface-container-highest rounded-full overflow-hidden mr-2"
                >
                  <view class="h-full bg-primary" :style="{ width: task.progress + '%' }" />
                </view>
                <text class="text-label-medium text-surface-on-variant">{{
                  progressText(task)
                }}</text>
              </view>
            </view>
          </view>
        </view>
      <view class="h-[30vw]" />
      </scroll-view>

      </view>

      <!-- 底部动作栏（全部 / 选中）——必须 in-flow（不覆盖 scroll-view）。
           [lynx:fix] 实测：覆盖在 <scroll-view> 之上的 absolute 动作栏在原生 LynxView
           收不到 tap（同一 @tap 在工具栏/列表行内有效，日志有 tap tag 但 handler 不触发）；
           改为正常文档流占位后 5 个动作与删除弹窗均正常（模拟器实证 2026-??）。 -->
      <view class="w-full flex flex-col items-center gap-1 py-2 bg-surface-container border-t border-outline-variant">
        <text class="text-label-medium text-surface-on-variant">
          {{
            t('downloads.summary', {
              count: summary.count,
              completed: summary.completed,
              active: summary.active,
            })
          }}
        </text>
        <view class="flex flex-row gap-1">
          <!-- MD3 disabled container = 「底色叠 on-surface 12%」。**必须作为独立覆盖层**：
               若与 `bg-surface-container-lowest` 写在同一元素上，两者都是 `background-color`，
               Tailwind 产物里后者声明更靠后 ⇒ 12% alpha 层被整条覆盖、静默不生效
               （真机取色实证：期望 (205,208,213) 实测 (163,197,220)；依据见 ADR-0209 引擎约束）。 -->
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest relative"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.start"
            @tap="runStart"
          >
            <view
              v-if="!availability.start"
              class="absolute inset-0 rounded-[var(--md-shape-full)] bg-state-disabled-container"
            />
            <text class="relative text-label-medium text-surface-on">{{
              scoped ? t('downloads.startSelected') : t('downloads.startAll')
            }}</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest relative"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.pause"
            @tap="runPause"
          >
            <view
              v-if="!availability.pause"
              class="absolute inset-0 rounded-[var(--md-shape-full)] bg-state-disabled-container"
            />
            <text class="relative text-label-medium text-surface-on">{{
              scoped ? t('downloads.pauseSelected') : t('downloads.pauseAll')
            }}</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest relative"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.stop"
            @tap="runStop"
          >
            <view
              v-if="!availability.stop"
              class="absolute inset-0 rounded-[var(--md-shape-full)] bg-state-disabled-container"
            />
            <text class="relative text-label-medium text-surface-on">{{
              scoped ? t('downloads.stopSelected') : t('downloads.stopAll')
            }}</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest relative"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.share"
            @tap="runShare"
          >
            <view
              v-if="!availability.share"
              class="absolute inset-0 rounded-[var(--md-shape-full)] bg-state-disabled-container"
            />
            <text class="relative text-label-medium text-surface-on">{{ t('downloads.share') }}</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest relative"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.remove"
            @tap="runDelete"
          >
            <view
              v-if="!availability.delete"
              class="absolute inset-0 rounded-[var(--md-shape-full)] bg-state-disabled-container"
            />
            <text class="relative text-label-medium text-error">{{
              scoped ? t('downloads.deleteSelected') : t('downloads.deleteAll')
            }}</text>
          </view>
        </view>
      </view>
    </template>

    <!-- 删除二次确认（文件 vs 记录二分） -->
    <!-- 删除二次确认——ADR-0123：Lynx 不识别 pointer-events，且 fixed 布局易错位；
         改用 absolute + 显式 vw 尺寸/坐标（scrim 覆盖全屏、卡片置于安全区居中）。 -->
    <view v-if="deleteTarget" class="absolute z-50 bg-scrim" style="left: 0; top: 0; width: 100vw; height: 220vw">
      <view
        class="absolute bg-surface-container-high rounded-[var(--md-shape-extra-large)] px-6 pt-5 pb-3 shadow-[var(--md-elevation-3)]"
        style="left: 12.667vw; top: 70vw; width: 74.667vw"
      >
        <text class="text-headline-small font-medium text-surface-on">{{ t('downloads.deleteTitle') }}</text>
        <!-- T10/ADR-0206 决策 3：删掉自选 leading-snug，行高由 text-body-medium 档位携带 -->
        <text class="text-body-medium text-surface-on-variant mt-4">
          {{ t('downloads.deleteBody', { count: deleteTarget.length }) }}
        </text>
        <view class="flex flex-row flex-wrap justify-end mt-6 gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.cancelDelete"
            @tap="closeDelete"
          >
            <text class="text-label-large font-medium text-primary">{{ t('downloads.cancel') }}</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.confirmDeleteRecords"
            @tap="confirmDelete('records')"
          >
            <text class="text-label-large font-medium text-primary">{{ t('downloads.deleteRecordsOnly') }}</text>
          </view>
          <view
            v-if="deletingFiles"
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.confirmDeleteFiles"
            @tap="confirmDelete('files')"
          >
            <text class="text-label-large font-medium text-error">{{ t('downloads.deleteFilesAndRecords') }}</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
