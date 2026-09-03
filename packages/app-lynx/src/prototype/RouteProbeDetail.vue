<script setup lang="ts">
// PROTOTYPE（throwaway，勿入生产）：探针详情页——验证 useRoute().params 段级参数 + router.back() 回退。
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
</script>

<template>
  <view class="Root">
    <view class="list">
      <text class="title">PROBE-DETAIL</text>
      <text class="line">id={{ route.params.id }}</text>
      <text class="line">fullPath={{ route.fullPath }}</text>
      <text class="btn" @tap="router.back()">back</text>
    </view>
  </view>
</template>

<style>
.Root {
  width: 100%;
  height: 100%;
}
.list {
  padding: 20px;
}
.title {
  font-size: 24px;
  font-weight: bold;
}
.line {
  font-size: 16px;
  margin-top: 8px;
}
.btn {
  font-size: 16px;
  margin-top: 12px;
  padding: 8px;
  background-color: #eeeeee;
}
</style>
