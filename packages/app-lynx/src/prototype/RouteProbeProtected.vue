<script setup lang="ts">
// PROTOTYPE（throwaway，勿入生产）：守卫拦截目标页（meta.requiresAuth）——用于验证全局守卫鉴权。
import { useRoute } from 'vue-router'
import { probeNavigate } from './probeNav'

const route = useRoute()
</script>

<template>
  <view class="Root">
    <view class="list">
      <text class="title">PROBE-PROTECTED</text>
      <text class="line">fullPath={{ route.fullPath }}</text>
      <text class="btn" @tap="probeNavigate('/')">to-home</text>
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
