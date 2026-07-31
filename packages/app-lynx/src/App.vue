<script setup lang="ts">
import { onMounted } from 'vue'
import { currentComponent, initRouter } from './router'

onMounted(() => {
  void initRouter()
})
</script>

<template>
  <page class="Root">
    <component :is="currentComponent" />
  </page>
</template>

<style>
@import './styles/tokens.css';

.Root {
  width: 100%;
  height: 100%;
  background-color: var(--colorNeutralBackground2);
}
</style>
