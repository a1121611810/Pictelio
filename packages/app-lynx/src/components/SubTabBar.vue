<script lang="ts">
/** 二级 tab 选项：公开数据契约（script-setup 禁 export，ADR-0116 —— 接口类型走独立 script 块） */
export interface SubTabItem<K extends string> {
  /** 受控枚举值：选中段 tap 后经 change 上抛的 key */
  key: K
  /** label = 已解析文案（调用方传 t() 结果；需随语言切换重算时用 computed 构建数组） */
  label: string
}
</script>

<script setup lang="ts" generic="K extends string">
// SubTabBar —— 二级 tab 切换条（公共层六组件之一，ADR-0194 / T1 #748；术语表「SubTabBar（二级
// tab 切换条）」）。一级 tab = NavigationBar / 放射 FAB，与本组件无关（勿混淆）。
//
// 接口（调用方需要知道的全部）：
//   :items        SubTabItem<K>[]：key = 受控枚举值；label = 已解析文案（调用方 i18n 传入）
//   :model-value  受控选中 key（受控组件：组件不持有选中态，写回由调用方决定）
//   @change       段 tap → 上抛选中 key（v-model 语义由页面自行组装，spec D3）
//
// 零行为变化红线（spec D3）：选中态指示条类串**逐字保留**——
//   选中 = 'text-primary border-b-[0.8vw] border-b-primary'，未选 = 'text-outline'。
//   这是 Bookmarks 页真机验证过的可靠写法（修复 web-core 下 flex-col 内容 + 独立指示器
//   横条导致的向上偏移），禁止在抽取中顺手改写；样式差异统一属行为变化，须另走视觉验收。
const props = defineProps<{
  /** tab 选项（key 受控枚举 + label 已解析文案） */
  items: SubTabItem<K>[]
  /** 受控选中 key */
  modelValue: K
}>()

const emit = defineEmits<{ (e: 'change', key: K): void }>()

/** 段选中：受控组件只上抛，不持有状态 */
function select(key: K): void {
  emit('change', key)
}
</script>

<template>
  <view class="flex flex-row border-b-[1px] border-b-outline-variant bg-surface-container-lowest">
    <view
      v-for="item in props.items"
      :key="item.key"
      class="flex-1 h-[12.8vw] flex items-center justify-center"
      :class="props.modelValue === item.key ? 'text-primary border-b-[0.8vw] border-b-primary' : 'text-outline'"
      @tap="select(item.key)"
    >
      <text class="text-title-small font-medium">{{ item.label }}</text>
    </view>
  </view>
</template>
