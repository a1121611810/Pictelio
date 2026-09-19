<!-- ─── LLM endpoint 设置表单（spec docs/specs/app-lynx-novel-translation.md §6.1） ───
     3 个字段（base URL / API key / model）+ 校验 + 保存 + probe 反馈。
     ───────────────────────────────────────────────────────────────── -->
<script setup lang="ts">
import { computed, onMounted, ref } from "vue"
import { useNovelTranslateStore } from "../stores/novelTranslateStore"
import { t } from "../i18n"
import type { LlmEndpointPublic } from "../api/translate"

const store = useNovelTranslateStore()

// ── 表单 state（与 store 解耦：编辑中不入 store，提交时一次性写入） ──
const baseURL = ref<string>("")
const apiKey = ref<string>("")
const model = ref<string>("")
const showKey = ref<boolean>(false)

const saving = ref<boolean>(false)
const probing = ref<boolean>(false)
const lastProbeOk = ref<boolean | null>(null)
const lastProbeMessage = ref<string>("")
const savedAt = ref<number | null>(null)

const endpointSnapshot = ref<LlmEndpointPublic | null>(null)

/** 是否已配置（从 Keystore 读到 endpoint → hasKey=true） */
const hasConfig = computed<boolean>(() => endpointSnapshot.value !== null)

/** 表单是否合法（spec §6.1 校验规则） */
const urlValid = computed<boolean>(() => {
  const v = baseURL.value.trim()
  if (v.length === 0) return false
  try {
    const u = new URL(v)
    return u.protocol === "https:" || u.protocol === "http:"
  } catch {
    return false
  }
})
const keyValid = computed<boolean>(() => apiKey.value.length > 0)
const modelValid = computed<boolean>(() => model.value.trim().length > 0)
const formValid = computed<boolean>(() => urlValid.value && keyValid.value && modelValid.value)

/** 加载已有配置到表单（仅 baseURL/model；apiKey 由用户重输，因 JS 堆不持有明文） */
async function loadFromKeystore(): Promise<void> {
  try {
    const ep = await store.loadEndpointConfig()
    endpointSnapshot.value = ep
    if (ep !== null) {
      baseURL.value = ep.baseURL
      model.value = ep.model
      savedAt.value = ep.updatedAt
    }
  } catch (err) {
    console.warn("[SettingsEndpoint] loadEndpointConfig 失败", err)
  }
}

onMounted(() => {
  void loadFromKeystore()
})

/** 探测 endpoint（formValid 才允许） */
async function onProbe(): Promise<void> {
  if (!formValid.value || probing.value) return
  probing.value = true
  lastProbeOk.value = null
  lastProbeMessage.value = ""
  try {
    const ok = await store.probeEndpoint({
      baseURL: baseURL.value.trim(),
      apiKey: apiKey.value,
      model: model.value.trim(),
    })
    lastProbeOk.value = ok
    lastProbeMessage.value = ok
      ? t("novelTranslate.endpoint.probe.success")
      : t("novelTranslate.endpoint.probe.failed", { detail: "" })
  } catch (err) {
    lastProbeOk.value = false
    lastProbeMessage.value = err instanceof Error ? err.message : String(err)
  } finally {
    probing.value = false
  }
}

/** 保存（写 Keystore：先 setApiKey，再触发 reload） */
async function onSave(): Promise<void> {
  if (!formValid.value || saving.value) return
  saving.value = true
  try {
    await store.saveEndpointConfig({
      baseURL: baseURL.value.trim(),
      apiKey: apiKey.value,
      model: model.value.trim(),
    })
    savedAt.value = Date.now()
    // 保存后立即 reload（用于切换「已配置 / 未配置」标签）
    await loadFromKeystore()
    apiKey.value = "" // 清空输入框；下次再填（不持久化到 JS 堆）
  } catch (err) {
    console.warn("[SettingsEndpoint] saveEndpointConfig 失败", err)
  } finally {
    saving.value = false
  }
}

/** 清除 Keystore 中的 endpoint */
async function onClear(): Promise<void> {
  if (!hasConfig.value) return
  if (!confirm(t("novelTranslate.endpoint.deleteConfirm"))) return
  try {
    await store.clearEndpointConfig()
    endpointSnapshot.value = null
    savedAt.value = null
    baseURL.value = ""
    apiKey.value = ""
    model.value = ""
  } catch (err) {
    console.warn("[SettingsEndpoint] clearEndpointConfig 失败", err)
  }
}
</script>

<template>
  <view class="w-full p-4 flex flex-col gap-4">
    <text class="text-title-medium text-surface-on">{{
      t("novelTranslate.endpoint.title")
    }}</text>

    <!-- base URL -->
    <view class="flex flex-col gap-1">
      <text class="text-label-medium text-surface-on-variant">{{
        t("novelTranslate.endpoint.baseUrl.label")
      }}</text>
      <input
        v-model="baseURL"
        class="h-[12vw] px-4 bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)] text-body-medium text-surface-on"
        :placeholder="t('novelTranslate.endpoint.baseUrl.hint')"
        placeholder-class="text-outline"
      />
      <text v-if="!urlValid && baseURL.length > 0" class="text-label-small text-error">{{
        t("novelTranslate.endpoint.invalid.url")
      }}</text>
    </view>

    <!-- API key -->
    <view class="flex flex-col gap-1">
      <text class="text-label-medium text-surface-on-variant">{{
        t("novelTranslate.endpoint.apiKey.label")
      }}</text>
      <view class="flex flex-row items-center gap-2">
        <input
          v-model="apiKey"
          :type="showKey ? 'text' : 'password'"
          class="flex-1 h-[12vw] px-4 bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)] text-body-medium text-surface-on"
          :placeholder="t('novelTranslate.endpoint.apiKey.hint')"
          placeholder-class="text-outline"
        />
        <view class="h-[10.667vw] px-3 flex items-center justify-center" @tap="showKey = !showKey">
          <text class="text-label-large text-primary">{{
            showKey ? t("novelTranslate.action.viewOriginal") : t("novelTranslate.action.viewTranslation")
          }}</text>
        </view>
      </view>
      <text v-if="!keyValid && apiKey.length > 0" class="text-label-small text-error">{{
        t("novelTranslate.endpoint.invalid.key")
      }}</text>
    </view>

    <!-- model -->
    <view class="flex flex-col gap-1">
      <text class="text-label-medium text-surface-on-variant">{{
        t("novelTranslate.endpoint.model.label")
      }}</text>
      <input
        v-model="model"
        class="h-[12vw] px-4 bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)] text-body-medium text-surface-on"
        :placeholder="t('novelTranslate.endpoint.model.hint')"
        placeholder-class="text-outline"
      />
      <text v-if="!modelValid && model.length > 0" class="text-label-small text-error">{{
        t("novelTranslate.endpoint.invalid.model")
      }}</text>
    </view>

    <!-- 状态条：已配置 / 未配置 -->
    <view class="flex flex-row items-center gap-2">
      <view
        class="h-[2vw] w-[2vw] rounded-full"
        :class="hasConfig ? 'bg-primary' : 'bg-outline'"
      />
      <text class="text-body-small text-surface-on-variant">
        {{
          hasConfig
            ? t("novelTranslate.endpoint.saved")
            : t("novelTranslate.endpoint.notConfigured")
        }}
      </text>
    </view>

    <!-- probe 反馈 -->
    <view v-if="lastProbeMessage" class="flex flex-row items-center gap-1">
      <text
        class="text-label-medium"
        :class="lastProbeOk === true ? 'text-primary' : 'text-error'"
      >
        {{ lastProbeMessage }}
      </text>
    </view>

    <!-- 操作按钮 -->
    <view class="flex flex-row gap-2">
      <view
        class="flex-1 h-[12vw] flex items-center justify-center rounded-[var(--md-shape-full)] border border-outline active:bg-layer-pressed-on-surface"
        :class="probing ? 'opacity-50' : ''"
        @tap="onProbe"
      >
        <text class="text-label-large text-surface-on">{{
          probing ? t("novelTranslate.status.translating") : t("novelTranslate.endpoint.probe.success")
        }}</text>
      </view>
      <view
        class="flex-1 h-[12vw] flex items-center justify-center rounded-[var(--md-shape-full)] bg-primary active:bg-layer-pressed-on-primary"
        :class="!formValid || saving ? 'opacity-50' : ''"
        @tap="onSave"
      >
        <text class="text-label-large text-on-primary">{{
          saving ? t("novelTranslate.status.pending") : t("novelTranslate.endpoint.save")
        }}</text>
      </view>
    </view>

    <!-- 清除按钮（仅已配置时显示） -->
    <view
      v-if="hasConfig"
      class="h-[10.667vw] flex items-center justify-center"
      @tap="onClear"
    >
      <text class="text-label-large text-error">× {{ t("novelTranslate.endpoint.deleteConfirm") }}</text>
    </view>
  </view>
</template>