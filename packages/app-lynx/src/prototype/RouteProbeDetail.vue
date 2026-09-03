<script setup lang="ts">
// PROTOTYPE（throwaway，勿入生产）：探针详情页——验证 useRoute().params 段级参数 + 返回（页面内按钮经 probeBack，与系统返回同裁决链）。
import { useRoute } from 'vue-router'
import { probeBack } from './probeNav'

const route = useRoute()
</script>

<template>
  <view class="Root">
    <view class="list">
      <text class="title">PROBE-DETAIL</text>
      <text class="line">id={{ route.params.id }}</text>
      <text class="line">fullPath={{ route.fullPath }}</text>
      <text class="btn" @tap="probeBack()">back</text>
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
