<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, navigate, goBack } from '../router'
import { loadDetail, loadUgoiraMetadata } from '../api/illust'
import { followUser, unfollowUser } from '../api/user'
import { useAuthStore } from '../stores/authStore'
import type { PixivIllust } from '../api/types'
import { proxyImageUrl } from '../utils/imageUrl'
import { resolvePageSrcs } from '../utils/imageQuality'
import { detailImageHeightVw } from '../utils/imageLayout'
import { presentError } from '../utils/errorPresentation'
import { useSettingsStore } from '../stores/settingsStore'
import BookmarkButton from '../components/BookmarkButton.vue'
import CommentOverlay from '../components/CommentOverlay.vue'
import PagePickerSheet from '../components/PagePickerSheet.vue'
import SkeletonImage from '../components/SkeletonImage.vue'
import UgoiraViewer from '../components/UgoiraViewer.vue'
import { useSearchSheetStore } from '../stores/searchSheetStore'
import { buildImageTasks, buildUgoiraTask } from '../utils/galleryDownload'
import { useDownloadStore } from '../stores/downloadStore'
import { t } from '../i18n'

const detailQuality = useSettingsStore().detailQuality
const settings = useSettingsStore()

const illust = ref<PixivIllust | null>(null)
const loading = ref(true)
const errorMsg = ref('')

// ─── 评论弹层（issue #164）：入口在收藏操作行；弹层挂根 view 内、scroll-view 之后 ───
const showComments = ref(false)

// ─── 关注作者（P0-T3） ───
const following = ref(false)
const followBusy = ref(false)
const followError = ref('') // 独立于 errorMsg——避免关注失败击穿已加载的详情页

const isSelfAuthor = computed(() => useAuthStore().currentUser?.id === illust.value?.user.id)

async function toggleFollowAuthor() {
  if (followBusy.value || !illust.value) return
  followBusy.value = true
  followError.value = ''
  try {
    if (following.value) {
      await unfollowUser(illust.value.user.id)
      following.value = false
    } else {
      await followUser(illust.value.user.id)
      following.value = true
    }
  } catch {
    followError.value = t('illustDetail.actionFailed') // i18n: 赋值时快照（瞬态）
  } finally {
    followBusy.value = false
  }
}

const illustId = computed(() => Number(currentParams.value.id ?? 0))

// ─── 保存到相册（spec docs/specs/image-save-download.md）：入口在收藏操作行；───
// ─── 单页直存；多页开选页面板；ugoira 不提供。状态内联在操作行下方（lynx 无全局 toast）───
const showPicker = ref(false)
const saveStatus = ref('')
const queuedNotice = ref(false)
let saveStatusTimer: ReturnType<typeof setTimeout> | undefined
const dl = useDownloadStore()

/**
 * 保存入口改为入队（spec docs/specs/download-manager.md §8）：构造任务交给 downloadStore
 * （下载页统一开始/暂停/停止/删除）。返回入队条数（0 = 无可用原图）。
 */
function enqueuePages(selectedPages: number[]): number {
  const i = illust.value
  if (!i || i.type === 'ugoira' || !selectedPages.length) return 0
  const drafts = buildImageTasks(i, selectedPages)
  if (drafts.length === 0) {
    saveStatus.value = t('illustDetail.save.noOriginal') // i18n: 赋值时快照（瞬态）
    queuedNotice.value = false
    return 0
  }
  dl.enqueue(drafts)
  saveStatus.value = t('illustDetail.save.queued', { count: drafts.length }) // i18n: 赋值时快照（瞬态）
  queuedNotice.value = true
  clearTimeout(saveStatusTimer)
  saveStatusTimer = setTimeout(() => {
    saveStatus.value = ''
    queuedNotice.value = false
  }, 4000)
  return drafts.length
}

/** ugoira 入队：先取元数据（官方 ZIP URL），再按全局格式（T13）入队（spec §5/§8）。 */
async function enqueueUgoira() {
  const i = illust.value
  if (!i || i.type !== 'ugoira') return
  try {
    const meta = await loadUgoiraMetadata(i.id)
    const draft = buildUgoiraTask(i, meta.zip_urls.medium, settings.ugoiraDownloadFormat, meta.frames)
    dl.enqueue([draft])
    saveStatus.value = t('illustDetail.save.queued', { count: 1 }) // i18n: 赋值时快照（瞬态）
    queuedNotice.value = true
    clearTimeout(saveStatusTimer)
    saveStatusTimer = setTimeout(() => {
      saveStatus.value = ''
      queuedNotice.value = false
    }, 4000)
  } catch (e) {
    console.warn('[IllustDetail] ugoira 元数据获取失败', e)
    saveStatus.value = t('illustDetail.save.ugoiraInfoFailed') // i18n: 赋值时快照（瞬态）
    queuedNotice.value = false
  }
}

function onSaveEntry() {
  const i = illust.value
  if (!i) return
  if (i.type === 'ugoira') {
    void enqueueUgoira()
    return
  }
  if (i.page_count > 1) {
    showPicker.value = true
    return
  }
  enqueuePages([0])
}

function onConfirmPicker(selectedPages: number[]) {
  showPicker.value = false
  enqueuePages(selectedPages)
}

// 多页作品：meta_pages 或单页
// [fix] 单页作品直接返回完整 image_urls（medium/large 正常档位）——
// 此前把 original_image_url 塞进 large 导致 medium 档 fallback 到原图
// （下载体积大 + 易超时，模拟器实测 img-original timeout）。original 档
// 由 resolvePageSrcs 的 singleOriginalUrl 参数单独兜底（单页场景）。
const pages = computed(() => {
  if (!illust.value) return []
  if (illust.value.meta_pages?.length) {
    return illust.value.meta_pages.map((p) => p.image_urls)
  }
  return [illust.value.image_urls]
})

// [spec] 详情比例显示：容器高度按原图宽高比换算的显式 vw（不封顶）；
// 容器 / ugoira 占位 / 图片骨架三处共用同一高度，避免重复计算。
// 多图列表（ADR-0129）：该高度仅作**占位**（首图比例），各图 @load 后按自身比例修正（CoverImage correctHeightOnLoad）。
const detailImageHeight = computed(() =>
  detailImageHeightVw(illust.value?.width, illust.value?.height),
)

// ─── 多图列表（ADR-0129 / spec §3 数据流）：逐页按档位解析 + 代理 ───
// 替换旧「详情翻页」的 currentImage（单页）语义：整体解析为数组，页面 v-for 渲染；
// 单图作品（meta_pages 空）走 [illust.image_urls] 单元素（现状语义不变）。
// 解析组合下移为纯函数 resolvePageSrcs（深模块可测，oracle = resolveQualityUrl + proxyImageUrl 各自语义）。
const slideSrcs = computed(() =>
  resolvePageSrcs(pages.value, detailQuality.value, illust.value?.meta_single_page?.original_image_url),
)

function openAuthor() {
  void navigate(`/user/${illust.value.user.id}`)
}

onMounted(async () => {
  try {
    const res = await loadDetail(illustId.value)
    illust.value = res.illust
    // P0-T3：同步作者关注状态（详情 API 可能不返回 is_followed，缺省 false）
    following.value = !!res.illust.user.is_followed
  } catch (err) {
    errorMsg.value = presentError(err, t('error.fallback.loadFailed'))
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <!-- [lynx:fix] 顶栏 tap 修复（issue #139）：外层显式 flex flex-col，scroll-view flex-1 min-h-0 约束在顶栏下方，
       避免 w-full h-full 溢出覆盖顶栏触摸层（与 issue #129 同型） -->
  <!-- relative：为根 view 内 absolute 的评论弹层提供定位上下文（不改 flex 布局） -->
  <view class="w-full h-full flex flex-col relative bg-surface">
    <view class="flex flex-row items-center h-[17.067vw] px-4 bg-surface">
      <view class="py-1 pr-2" @tap="goBack"><text class="text-[6.4vw] leading-none text-surface-on">‹</text></view>
      <text class="flex-1 text-title-large font-medium text-surface-on">{{ t('illustDetail.title') }}</text>
    </view>

    <!-- [lynx:fix] 骨架屏：加载中显示 shimmer 占位（图片区 1:1 + 文字条），数据就绪后切换 scroll-view -->
    <view v-if="loading" class="w-full flex-1 min-h-0 bg-surface">
      <view class="shimmer aspect-[1/1] w-full" />
      <view class="p-4">
        <view class="shimmer h-[32rpx] rounded-[var(--md-shape-extra-small)] w-[75%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-2 w-[40%]" />
        <view class="shimmer h-[24rpx] rounded-[var(--md-shape-extra-small)] mt-1.5 w-[60%]" />
      </view>
    </view>
    <view v-else-if="errorMsg" class="w-full flex-1 min-h-0 flex items-center justify-center">
      <text class="text-body-medium text-error p-4">{{ errorMsg }}</text>
    </view>
    <scroll-view v-else-if="illust" class="w-full flex-1 min-h-0" scroll-orientation="vertical">
      <!-- [spec] 详情大图：按原图宽高比撑开高度（显式 vw，不封顶，与 webview client 一致），
           原生 LynxView 不支持动态 aspect-ratio style（ADR-0055 §2），显式高度已验证（issue #138）。
           图片级骨架屏（SkeletonImage）：@load 前 shimmer、@error 显示「图片加载失败」。
           ADR-0129 多图列表：多页作品改**通栏连续大图列表**（全量渲染 + 首图 eager/其余 lazy-load），
           每图宽度盛满、高度按自身比例（占位=首图比例 detailImageHeight，@load 后 CoverImage correctHeightOnLoad 修正），
           右上角「n / N」页角标（对齐 webview LazyDetailImage）；单页/ugoira 分支保持现状。 -->
      <!-- ugoira 动图：播放器分支（多图列表不适用，page_count=1 语义保持） -->
      <view
        v-if="illust.type === 'ugoira'"
        class="relative w-full bg-surface-container-highest overflow-hidden"
        :style="{ height: detailImageHeight }"
      >
        <UgoiraViewer :illust-id="illust.id" :height-vw="detailImageHeight" />
      </view>
      <!-- 多图列表：每页一张，通栏连续大图（页间留间距）。
           外层**不定高**（占位高度由 SkeletonImage 的 height prop 承担；correctHeightOnLoad 修正的是内层
           CoverImage 容器高度——外层定高会裁掉修正后更高的图）；外层仅作 relative 定位上下文（角标）。 -->
      <template v-else-if="slideSrcs.length > 1">
        <view
          v-for="(src, i) in slideSrcs"
          :key="i"
          class="relative w-full bg-surface-container-highest overflow-hidden mb-2"
        >
          <SkeletonImage :src="src" :height="detailImageHeight" :lazy-load="i > 0" correct-height-on-load />
          <!-- 「n / N」页角标：absolute 悬浮右上角。
               [定位锚点约定（ADR-0123）] 原生 LynxView 把最近 view 祖先当 absolute 锚点，非全屏父盒内
               禁止 right/bottom（按父盒边缘解析→跑出屏幕）。故角标用「left:0 + w-full + flex 右对齐」：
               只依赖 left/top 正向解析，右侧位置由 flex 布局得出，规避 right/bottom 的锚点语义。 -->
          <view class="absolute top-2 left-0 w-full flex flex-row justify-end pr-2">
            <view
              class="px-2 h-[6.4vw] min-w-[9.6vw] rounded-[var(--md-shape-small)] bg-scrim flex items-center justify-center"
            >
              <text class="text-label-medium text-white">{{ i + 1 }} / {{ slideSrcs.length }}</text>
            </view>
          </view>
        </view>
      </template>
      <!-- 单图作品：现状语义（无角标、无 correctHeightOnLoad、不带 lazy-load） -->
      <view
        v-else
        class="relative w-full bg-surface-container-highest overflow-hidden"
        :style="{ height: detailImageHeight }"
      >
        <SkeletonImage v-if="slideSrcs[0]" :src="slideSrcs[0]" :height="detailImageHeight" />
      </view>
      <view class="p-4 bg-surface-container-lowest">
        <text class="text-headline-small font-bold text-surface-on">{{ illust.title }}</text>
        <view class="flex flex-row items-center mt-2" @tap="openAuthor">
          <SkeletonImage
            v-if="illust.user.profile_image_urls"
            :src="proxyImageUrl(illust.user.profile_image_urls.medium || illust.user.profile_image_urls.px_170x170 || '')"
            aspect-ratio="1 / 1"
            min-h="9vw"
            class="w-[10.667vw] h-[10.667vw] rounded-full"
          />
          <text class="text-body-medium text-surface-on-variant ml-2 flex-1">by {{ illust.user.name }}</text>
          <!-- P0-T3：关注作者（非本人时显示） -->
          <view
            v-if="!isSelfAuthor"
            class="px-4 h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)]"
            :class="following ? 'border border-outline bg-transparent active:bg-layer-pressed-primary' : 'bg-primary active:bg-state-pressed-primary'"
            @tap.stop="toggleFollowAuthor"
          >
            <text class="text-body-medium" :class="following ? 'text-primary' : 'text-primary-on'">
              {{ following ? t('illustDetail.follow.following') : t('illustDetail.follow.follow') }}
            </text>
          </view>
        </view>
        <text v-if="followError" class="text-label-medium text-error mt-1">{{ followError }}</text>
        <text class="text-body-small text-outline mt-1.5">{{ illust.width }} × {{ illust.height }}</text>
        <view class="mt-2 flex flex-row items-center">
          <BookmarkButton
            :illust-id="illust.id"
            :initial-bookmarked="illust.is_bookmarked"
            :bookmark-count="illust.total_bookmarks"
          />
          <!-- 保存（spec download-manager §8）：↓ 为 U+2193 纯文本符号（规避 emoji 字形，
               ADR-0112 教训）；静态图直接入队，ugoira 取元数据后按全局格式入队 -->
          <view class="ml-4 flex flex-row items-center" @tap="onSaveEntry">
            <text class="text-[5.6vw] leading-none text-outline">↓</text>
            <text class="text-label-medium text-outline ml-1">{{ t('illustDetail.save.action') }}</text>
          </view>
          <!-- 评论入口（issue #164）：样式对齐 webview 版（💬 + total_comments，字段缺失时不显示） -->
          <view
            v-if="illust.total_comments !== undefined"
            class="ml-4 flex flex-row items-center"
            @tap="showComments = true"
          >
            <text class="text-[6.4vw] leading-none">💬</text>
            <text class="text-label-medium text-outline ml-1">{{ illust.total_comments }}</text>
          </view>
        </view>
        <!-- 保存状态（内联，无全局 toast 通道）：入队后附「查看下载」跳转 -->
        <view v-if="saveStatus" class="flex flex-row items-center mt-1">
          <text class="text-label-medium text-primary">{{ saveStatus }}</text>
          <view
            v-if="queuedNotice"
            class="ml-3 h-[8vw] px-3 flex items-center justify-center border border-outline rounded-[var(--md-shape-full)]"
            @tap="navigate('/downloads')"
          >
            <text class="text-label-medium text-primary">{{ t('illustDetail.save.viewDownloads') }}</text>
          </view>
        </view>
        <view class="flex flex-row flex-wrap mt-3">
          <!-- 标签行（ADR-0133 可点化）：点击 → 全局搜索弹层预填该标签（原始 tag.name，
               显示仍 translated_name 优先）——与 webview SearchableTag 语义一致。
               @tap.stop 统一防冒泡（详情页父级暂无 tap，为嵌套安全保留）。
               [居中修复] 布局（固定高/flex 居中/边框/圆角）由 view 承载——lynx 的 text
               是纯文本节点，flex 对 text 无效（此前 items-center 不生效导致文案偏上，
               实测放大切片确认）；text 内层**不得**加 leading-none——lynx text 的
               line-height:1 会把字形顶到行框顶（flex 居中行框而非字形，反而更偏上，
               实测对比确认），默认行高 + view items-center 即对称居中。 -->
          <view
            v-for="tag in illust.tags.slice(0, 8)"
            :key="tag.name"
            class="h-[8.533vw] px-2 m-1 border border-outline rounded-[var(--md-shape-small)] flex items-center justify-center bg-surface"
            @tap.stop="useSearchSheetStore().openSearch(tag.name)"
          >
            <text class="text-label-large text-surface-on-variant">
              #{{ tag.translated_name || tag.name }}
            </text>
          </view>
        </view>
      </view>
    </scroll-view>

    <!-- 评论弹层（issue #164）：absolute 脱离 flex 流全屏覆盖；DOM 顺序在 scroll-view 之后
         且不动其结构（issue #139/#129 修复保持）。覆盖层形态 → 弹层打开时页面滚动位置不丢失 -->
    <view v-if="showComments" class="absolute inset-0">
      <CommentOverlay type="illust" :target-id="illustId" @close="showComments = false" />
    </view>

    <!-- 选页面板（spec image-save-download）：挂载契约对齐评论弹层——absolute inset-0 宿主包裹
         （issue #139：本页根是 flex-col + flex-1 scroll-view，文档流内 w-full h-full 子元素有溢出
         覆盖顶栏触摸层前科，必须脱离文档流） -->
    <view v-if="showPicker" class="absolute inset-0">
      <PagePickerSheet
        :page-urls="slideSrcs"
        :busy="false"
        @close="showPicker = false"
        @confirm="onConfirmPicker"
      />
    </view>
  </view>
</template>
