<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { navigate } from '../router'
import { loadRecommended, loadNext } from '../api/illust'
import type { PixivIllust } from '../api/types'
import { thumbUrl } from '../utils/imageUrl'

const illusts = ref<PixivIllust[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')

async function fetchFirstPage() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await loadRecommended()
    illusts.value = res.illusts
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (!nextUrl.value || loadingMore.value) return
  loadingMore.value = true
  try {
    const res = await loadNext(nextUrl.value)
    const seen = new Set(illusts.value.map((i) => i.id))
    const fresh = res.illusts.filter((i) => !seen.has(i.id))
    illusts.value.push(...fresh)
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
  } finally {
    loadingMore.value = false
  }
}

function openDetail(id: number) {
  void navigate(`/illust/${id}`)
}
function openNovels() {
  void navigate('/novels')
}
function openMe() {
  void navigate('/me')
}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="Page">
    <view class="AppBar">
      <text class="AppBarTitle">推荐插画</text>
      <text class="AppBarNav" @tap="openNovels">小说</text>
      <text class="AppBarNav" @tap="openMe">我的</text>
    </view>

    <text v-if="errorMsg && !loading" class="Error">{{ errorMsg }}</text>

    <list
      v-if="!loading || illusts.length > 0"
      class="Feed"
      list-type="waterfall"
      scroll-orientation="vertical"
      span-count="2"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in illusts"
        :key="item.id"
        :item-key="item.id"
        class="Card"
        @tap="openDetail(item.id)"
      >
        <image
          class="CardImage"
          :src="thumbUrl(item.image_urls)"
          :mode="'aspectFill'"
          auto-size
        />
        <text class="CardTitle">{{ item.title }}</text>
        <text class="CardAuthor">{{ item.user.name }}</text>
        <text v-if="item.total_bookmarks > 0" class="CardMeta">♥ {{ item.total_bookmarks }}</text>
      </list-item>
      <list-item v-if="loadingMore" :key="'footer'" item-key="footer" class="Footer" full-span>
        <text class="FooterText">加载中…</text>
      </list-item>
    </list>
  </view>
</template>

<style scoped>
.Page {
  width: 100%;
  height: 100%;
  background-color: var(--colorNeutralBackground2);
}

.AppBar {
  display: flex;
  flex-direction: row;
  align-items: center;
  height: 11.733vw;
  padding: 0 4.267vw;
  background-color: var(--colorNeutralBackground1);
  border-bottom-width: 1px;
  border-bottom-color: var(--colorNeutralStroke2);
}

.AppBarTitle {
  flex: 1;
  font-size: 32rpx;
  font-weight: 700;
  color: var(--colorNeutralForeground1);
}

.AppBarNav {
  font-size: 26rpx;
  color: var(--colorBrandForeground1);
  margin-left: 6.400vw;
}

.Feed {
  width: 100%;
  height: 100%;
}

.Card {
  width: 100%;
  background-color: var(--colorNeutralBackground1);
  border-radius: var(--borderRadiusXLarge);
  margin: 1.600vw;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.CardImage {
  width: 100%;
  background-color: var(--colorNeutralBackground3);
}

.CardTitle {
  font-size: 26rpx;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
  margin: 2.133vw 2.667vw 0 2.667vw;
  max-line: 1;
}

.CardAuthor {
  font-size: 22rpx;
  color: var(--colorNeutralForeground2);
  margin: 1.067vw 2.667vw 0 2.667vw;
  max-line: 1;
}

.CardMeta {
  font-size: 20rpx;
  color: var(--colorNeutralForeground3);
  margin: 1.067vw 2.667vw 2.667vw 2.667vw;
}

.Footer {
  width: 100%;
  height: 10.667vw;
  display: flex;
  align-items: center;
  justify-content: center;
}

.FooterText {
  font-size: 24rpx;
  color: var(--colorNeutralForeground3);
}

.Error {
  font-size: 22rpx;
  color: var(--colorPaletteRedBackground3);
  padding: 4.267vw;
}
</style>