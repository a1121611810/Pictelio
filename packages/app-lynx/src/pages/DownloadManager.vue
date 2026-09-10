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
  hasDeletableFiles,
  progressText,
  selectAll,
  summarize,
  toggleId,
} from '../utils/downloadsViewModel'
import { DOWNLOAD_A11Y_LABELS, A11Y_ELEMENT_ENABLED } from '../utils/accessibility'

// ─── 下载管理页（spec docs/specs/download-manager.md §7.2） ───
// 列表 + 单选/多选 + 对全部或选中项的开始/暂停/停止/删除；删除二次确认二分；已完成可系统分享。
// 数据与动作来自 downloadStore（深模块），派生逻辑来自 utils/downloadsViewModel（纯函数）。
const dl = useDownloadStore()

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
    statusMsg.value = '已调起系统分享'
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
    statusMsg.value = mode === 'files' ? '已删除文件与记录' : '已清空记录'
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
        <text class="text-[6.4vw] leading-none text-surface-on">‹</text>
      </view>
      <text
        class="flex-1 text-title-large font-medium text-surface-on"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="DOWNLOAD_A11Y_LABELS.pageTitle"
        >下载管理</text
      >
    </view>

    <text v-if="statusMsg" class="text-body-small text-primary px-4 pb-1">{{ statusMsg }}</text>

    <!-- 空态 -->
    <view
      v-if="tasks.length === 0"
      class="w-full flex-1 min-h-0 flex items-center justify-center"
    >
      <view class="flex flex-col items-center">
        <text class="text-[10.667vw] leading-none text-outline-variant">↓</text>
        <text class="text-body-large text-surface-on mt-3">暂无下载任务</text>
        <text class="text-body-medium text-surface-on-variant mt-1.5"
          >在作品详情页点击保存即可加入下载队列</text
        >
      </view>
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
            allSelected(tasks, selected) ? '取消全选' : '全选'
          }}</text>
        </view>
        <text class="text-label-medium text-surface-on-variant">
          {{
            selected.size > 0
              ? '已选 ' + selected.size + ' / 共 ' + tasks.length
              : '全部 ' + tasks.length
          }}
        </text>
      </view>

      <view class="w-full flex-1 min-h-0">
      <scroll-view scroll-orientation="vertical" class="w-full h-full">
        <view
          v-for="group in groups"
          :key="group.illustId"
          class="mx-3 my-2 bg-surface-container-lowest rounded-[var(--md-shape-medium)] shadow-[var(--md-elevation-1)] overflow-hidden"
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
                group.kind === 'ugoira' ? '动图' : group.tasks.length + ' 张'
              }}</text>
            </view>
          </view>
          <view
            v-for="task in group.tasks"
            :key="task.id"
            class="flex flex-row items-center px-3 py-2 border-t border-outline-variant"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="'选择 ' + task.fileName"
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
              <text
                v-if="selected.has(task.id)"
                class="text-[3.2vw] leading-none text-primary-on"
                >✓</text
              >
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
          {{ summary.count }} 项 · 已完成 {{ summary.completed }} · 进行中 {{ summary.active }}
        </text>
        <view class="flex flex-row gap-1">
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest"
            :class="availability.start ? '' : 'opacity-40'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.start"
            @tap="runStart"
          >
            <text class="text-label-medium text-surface-on">{{ (scoped ? '选中' : '全部') + '开始' }}</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest"
            :class="availability.pause ? '' : 'opacity-40'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.pause"
            @tap="runPause"
          >
            <text class="text-label-medium text-surface-on">{{ (scoped ? '选中' : '全部') + '暂停' }}</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest"
            :class="availability.stop ? '' : 'opacity-40'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.stop"
            @tap="runStop"
          >
            <text class="text-label-medium text-surface-on">{{ (scoped ? '选中' : '全部') + '停止' }}</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest"
            :class="availability.share ? '' : 'opacity-40'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.share"
            @tap="runShare"
          >
            <text class="text-label-medium text-surface-on">分享</text>
          </view>
          <view
            class="h-[10.667vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)] bg-surface-container-lowest"
            :class="availability.delete ? '' : 'opacity-40'"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.remove"
            @tap="runDelete"
          >
            <text class="text-label-medium text-error">{{ (scoped ? '选中' : '全部') + '删除' }}</text>
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
        <text class="text-headline-small font-medium text-surface-on">删除下载</text>
        <text class="text-body-medium text-surface-on-variant mt-4 leading-snug">
          将移除 {{ deleteTarget.length }} 条下载记录。「删除文件与记录」会同时删除已下载文件；「仅清空记录」保留已下载文件。
        </text>
        <view class="flex flex-row flex-wrap justify-end mt-6 gap-2">
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.cancelDelete"
            @tap="closeDelete"
          >
            <text class="text-label-large font-medium text-primary">取消</text>
          </view>
          <view
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.confirmDeleteRecords"
            @tap="confirmDelete('records')"
          >
            <text class="text-label-large font-medium text-primary">仅清空记录</text>
          </view>
          <view
            v-if="deletingFiles"
            class="h-[10.667vw] px-4 flex items-center justify-center"
            :accessibility-element="A11Y_ELEMENT_ENABLED"
            :accessibility-label="DOWNLOAD_A11Y_LABELS.confirmDeleteFiles"
            @tap="confirmDelete('files')"
          >
            <text class="text-label-large font-medium text-error">删除文件与记录</text>
          </view>
        </view>
      </view>
    </view>
  </view>
</template>
