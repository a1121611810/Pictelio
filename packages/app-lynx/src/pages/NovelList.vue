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
  height: 88px;
  padding: 0 16px;
  background-color: var(--colorNeutralBackground1);
  border-bottom-width: 1px;
  border-bottom-color: var(--colorNeutralStroke2);
}

.Back {
  font-size: 26px;
  color: var(--colorBrandForeground1);
  padding-right: 16px;
}

.AppBarTitle {
  flex: 1;
  font-size: 30px;
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
  margin: 6px 12px;
  padding: 14px;
  background-color: var(--colorNeutralBackground1);
  border-radius: var(--borderRadiusXLarge);
}

.Info {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.Title {
  font-size: 28px;
  font-weight: 600;
  color: var(--colorNeutralForeground1);
  max-line: 2;
}

.Author {
  font-size: 22px;
  color: var(--colorBrandForeground1);
  margin-top: 6px;
}

.MetaLine {
  display: flex;
  flex-direction: row;
  margin-top: 6px;
}

.Meta {
  font-size: 20px;
  color: var(--colorNeutralForeground3);
  margin-right: 16px;
}

.Tags {
  display: flex;
  flex-direction: row;
  flex-wrap: wrap;
  margin-top: 8px;
}

.Tag {
  font-size: 18px;
  color: var(--colorBrandForeground1);
  background-color: var(--colorNeutralBackground3);
  border-radius: var(--borderRadiusMedium);
  padding: 2px 8px;
  margin: 2px;
}

.Footer {
  width: 100%;
  height: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.FooterText {
  font-size: 24px;
  color: var(--colorNeutralForeground3);
}

.Error {
  font-size: 22px;
  color: var(--colorPaletteRedBackground3);
  padding: 16px;
}
</style>
