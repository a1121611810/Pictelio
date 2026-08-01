<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { navigate, goBack } from '../router'
import { loadRecommendedNovels, loadNovelNext } from '../api/novel'
import type { PixivNovel } from '../api/types'

const novels = ref<PixivNovel[]>([])
const nextUrl = ref<string | null>(null)
const loading = ref(false)
const loadingMore = ref(false)
const errorMsg = ref('')

async function fetchFirstPage() {
  loading.value = true
  errorMsg.value = ''
  try {
    const res = await loadRecommendedNovels()
    novels.value = res.novels
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
    const res = await loadNovelNext(nextUrl.value)
    const seen = new Set(novels.value.map((n) => n.id))
    const fresh = res.novels.filter((n) => !seen.has(n.id))
    novels.value.push(...fresh)
    nextUrl.value = res.next_url
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载更多失败'
  } finally {
    loadingMore.value = false
  }
}

function openDetail(id: number) {
  void navigate(`/novel/${id}`)
}

onMounted(fetchFirstPage)
</script>

<template>
  <view class="Page">
    <view class="AppBar">
      <text class="Back" @tap="goBack">‹ 返回</text>
      <text class="AppBarTitle">推荐小说</text>
    </view>

    <text v-if="errorMsg && !loading" class="Error">{{ errorMsg }}</text>

    <list
      v-if="!loading || novels.length > 0"
      class="Feed"
      list-type="single"
      scroll-orientation="vertical"
      :lower-threshold-item-count="5"
      @scrolltolower="loadMore"
    >
      <list-item
        v-for="item in novels"
        :key="item.id"
        :item-key="item.id"
        class="Row"
        @tap="openDetail(item.id)"
      >
        <view class="RowInner">
          <view class="Info">
            <text class="Title">{{ item.title }}</text>
            <text class="Author">by {{ item.user.name }}</text>
            <view class="MetaLine">
              <text class="Meta">{{ item.text_length }} 字</text>
              <text v-if="item.total_bookmarks > 0" class="Meta">♥ {{ item.total_bookmarks }}</text>
            </view>
            <view class="Tags">
              <text v-for="tag in item.tags.slice(0, 3)" :key="tag.name" class="Tag">
                #{{ tag.translated_name || tag.name }}
              </text>
            </view>
          </view>
        </view>
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

.Back {
  font-size: 26rpx;
  color: var(--colorBrandForeground1);
  padding-right: 4.267vw;
}

.AppBarTitle {
  flex: 1;
  font-size: 30rpx;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
}

.Feed {
  width: 100%;
  height: 100%;
}

.Row {
  width: 100%;
}

.RowInner {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  margin: 1.600vw 3.200vw;
  padding: 3.733vw;
  background-color: var(--colorNeutralBackground1);
  border-radius: var(--borderRadiusXLarge);
}

.Info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.Title {
  font-size: 28rpx;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
  max-line: 2;
}

.Author {
  font-size: 22rpx;
  color: var(--colorBrandForeground1);
  margin-top: 1.600vw;
}

.MetaLine {
  display: flex;
  flex-direction: row;
  margin-top: 1.600vw;
}

.Meta {
  font-size: 20rpx;
  color: var(--colorNeutralForeground3);
  margin-right: 4.267vw;
}

.Tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 2.133vw;
}

.Tag {
  font-size: 18rpx;
  color: var(--colorBrandForeground1);
  background-color: var(--colorNeutralBackground3);
  border-radius: var(--borderRadiusMedium);
  padding: 0.533vw 2.133vw;
  margin: 0.533vw;
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