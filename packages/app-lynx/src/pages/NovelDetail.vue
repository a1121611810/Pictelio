<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { currentParams, goBack } from '../router'
import { loadNovelDetail, fetchNovelText } from '../api/novel'
import type { PixivNovel } from '../api/types'

const novel = ref<PixivNovel | null>(null)
const text = ref('')
const loading = ref(true)
const errorMsg = ref('')

const novelId = computed(() => Number(currentParams.value.id ?? 0))

// MVP：整段渲染，不做行级虚拟化（无 canvas/measureText，pretext 不可迁移）。
// 超长文本由 scroll-view 引擎滚动承接；后续原生集成阶段可换分段渲染。
const paragraphs = computed(() => {
  if (!text.value) return []
  return text.value
    .split(/\n+/u)
    .map((p) => p.trim())
    .filter(Boolean)
})

onMounted(async () => {
  try {
    const [detailRes, body] = await Promise.all([
      loadNovelDetail(novelId.value),
      fetchNovelText(novelId.value),
    ])
    novel.value = detailRes.novel
    text.value = body
  } catch (err) {
    errorMsg.value = (err as { message?: string }).message ?? '加载失败'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <view class="Page">
    <view class="AppBar">
      <text class="Back" @tap="goBack">‹ 返回</text>
      <text class="AppBarTitle">小说</text>
    </view>

    <view v-if="loading" class="Center">
      <text class="Loading">加载中…</text>
    </view>
    <view v-else-if="errorMsg" class="Center">
      <text class="Error">{{ errorMsg }}</text>
    </view>
    <scroll-view v-else class="Body" scroll-orientation="vertical">
      <view class="Header">
        <text class="Title">{{ novel?.title }}</text>
        <text class="Author">by {{ novel?.user.name }}</text>
        <text class="Meta">
          {{ novel?.text_length }} 字
          <template v-if="novel?.total_bookmarks != null">
             · ♥ {{ novel?.total_bookmarks }}
          </template>
        </text>
      </view>
      <view class="Content">
        <text v-for="(p, idx) in paragraphs" :key="idx" class="Paragraph">{{ p }}</text>
      </view>
      <view class="EndMark">
        <text class="EndText">— 完 —</text>
      </view>
    </scroll-view>
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

.Center {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.Loading {
  font-size: 26rpx;
  color: var(--colorNeutralForeground3);
}

.Error {
  font-size: 24rpx;
  color: var(--colorPaletteRedBackground3);
  padding: 4.267vw;
}

.Body {
  width: 100%;
  height: 100%;
}

.Header {
  padding: 5.333vw 4.267vw;
  background-color: var(--colorNeutralBackground1);
  margin-bottom: 3.200vw;
}

.Title {
  font-size: 36rpx;
  font-weight: 700;
  color: var(--colorNeutralForeground1);
}

.Author {
  font-size: 24rpx;
  color: var(--colorBrandForeground1);
  margin-top: 2.133vw;
}

.Meta {
  font-size: 20rpx;
  color: var(--colorNeutralForeground3);
  margin-top: 1.600vw;
}

.Content {
  padding: 4.267vw;
}

.Paragraph {
  font-size: 28rpx;
  line-height: 44rpx;
  color: var(--colorNeutralForeground1);
  margin-bottom: 4.267vw;
  display: block;
}

.EndMark {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6.400vw;
}

.EndText {
  font-size: 22rpx;
  color: var(--colorNeutralForeground3);
}
</style>