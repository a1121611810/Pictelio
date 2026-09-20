<!-- ─── LLM endpoint 设置表单（spec docs/specs/app-lynx-novel-translation.md §6.1） ───
     3 个字段（base URL / API key / model）+ 校验 + 保存 + probe 反馈。
     ───────────────────────────────────────────────────────────────── -->
<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue"
import { useNovelTranslateStore } from "../stores/novelTranslateStore"
import { useSettingsStore } from "../stores/settingsStore"
import { A11Y_ELEMENT_ENABLED } from "../utils/accessibility"
import { t } from "../i18n"
import { extractHostname } from "../utils/safeParseUrl"
import type { LlmEndpointPublic } from "../api/translate"

const store = useNovelTranslateStore()
const settings = useSettingsStore()

// ── 表单 state（与 store 解耦：编辑中不入 store，提交时一次性写入） ──
const baseURL = ref<string>("")
const apiKey = ref<string>("")
const model = ref<string>("")
/**
 * 目标语言（BCP-47）。
 * 初始值 = 界面语言推导（与 `novelTranslateStore.webEndpointConfig()` 的
 * `settings.language ?? "zh-CN"` 同源）；`loadFromKeystore` 会用已存值覆盖。
 * code-review S5：此前注释称「默认 zh-CN，见 webEndpointConfig」，但 store 的默认是
 * **settings.language 优先** —— 非中文界面用户首存会把 zh-CN 固化，静默覆盖语言偏好推导。
 */
const targetLang = ref<string>(settings.language ?? "zh-CN")
/** 源语言（BCP-47；默认 ja，Pixiv 小说原文语言） */
const sourceLang = ref<string>("ja")
/** API Key 明文可见性（5s 后自动转回 password；ADR-0178 D3 同款交互） */
const apiKeyVisible = ref<boolean>(false)
let apiKeyVisibleTimer: ReturnType<typeof setTimeout> | null = null

const saving = ref<boolean>(false)
const testing = ref<boolean>(false)
/** 清除确认：lynx 无浏览器 confirm()（Web API 面不可用）→ 行内二次确认，不依赖平台弹窗 */
const clearConfirming = ref<boolean>(false)
/** 「测试连接」的内联结果（ADR-0173 D5：偏离 spec 的 Snackbar，用页内提示 + 4s 淡出） */
const testResultText = ref<string>("")
const testResultOk = ref<boolean | null>(null)
let testResultTimer: ReturnType<typeof setTimeout> | null = null


/**
 * 翻译授权确认（spec §9.7：首次开启任一开关前给风险确认）。
 * 复刻既有做法：lynx 无全局 modal/confirm，用行内面板承担二次确认。
 */
const consentFor = ref<"r18" | "r18g" | null>(null)

/** 是否已授权（settingsStore 是唯一事实源） */
const translateR18 = computed<boolean>(() => settings.translateR18)
const translateR18G = computed<boolean>(() => settings.translateR18G)

function requestTranslateConsent(kind: "r18" | "r18g"): void {
  const enabled = kind === "r18" ? translateR18.value : translateR18G.value
  // 关闭无需确认（收紧授权永远安全）
  if (enabled) {
    if (kind === "r18") settings.setTranslateR18(false)
    else settings.setTranslateR18G(false)
    return
  }
  consentFor.value = kind
}

function confirmTranslateConsent(): void {
  const kind = consentFor.value
  consentFor.value = null
  if (kind === "r18") settings.setTranslateR18(true)
  else if (kind === "r18g") settings.setTranslateR18G(true)
}

/** 兼容性探测的 debounce（spec §6.1：600ms）；重入即取消上一次 */
let compatTimer: ReturnType<typeof setTimeout> | null = null

/**
 * baseURL 变化 → debounce 600ms 后自动探测**端点兼容性**（地址层，ADR-0173 D1/D2）。
 * 探测只带 dummy key：不需要用户先填密钥，也就顺带让「已保存配置免密钥重测」成立。
 * 非法/空地址不发请求（避免半截输入打网络）。
 */
function scheduleCompatibilityProbe(): void {
  if (compatTimer !== null) clearTimeout(compatTimer)
  if (!urlValid.value) {
    store.compatibility = "idle"
    return
  }
  compatTimer = setTimeout(() => {
    compatTimer = null
    void store.probeCompatibility(baseURL.value)
  }, 600)
}

/** 兼容性 chip 文案（八态；store 是唯一事实源）。显式映射而非模板拼键——i18n 键是字面量联合类型 */
const COMPAT_KEYS = {
  idle: "novelTranslate.endpoint.compat.idle",
  ok: "novelTranslate.endpoint.compat.ok",
  azure: "novelTranslate.endpoint.compat.azure",
  deepseek: "novelTranslate.endpoint.compat.deepseek",
  vllm: "novelTranslate.endpoint.compat.vllm",
  partial: "novelTranslate.endpoint.compat.partial",
  incompatible: "novelTranslate.endpoint.compat.incompatible",
  unknown: "novelTranslate.endpoint.compat.unknown",
} as const

const compatText = computed<string>(() => t(COMPAT_KEYS[store.compatibility]))

/** 兼容性 chip 的语义色（复用 M3 语义 token，不硬编码色值） */
const compatClass = computed<string>(() => {
  switch (store.compatibility) {
    case "ok":
    case "azure":
    case "deepseek":
    case "vllm":
      return "text-primary"
    case "partial":
    case "unknown":
      return "text-outline"
    case "incompatible":
      return "text-error"
    default:
      return "text-outline"
  }
})

/** 凭据徽章文案（三态，ADR-0173 D1：密钥层，独立于兼容性） */
const credentialText = computed<string>(() => {
  const v = store.credential
  // 地址层与密钥层必须对同一条地址成立（ADR-0173 D4③）：用户改了输入框但没保存时，
  // 旧的「已验证」不得继续展示（ADR 点名的「最危险的假象」）
  if (v.baseUrl !== null && v.baseUrl !== baseURL.value.trim()) {
    return t("novelTranslate.endpoint.credential.unverified")
  }
  if (v.state === "verified") {
    const when = v.at === null ? "" : formatWhen(v.at)
    return t("novelTranslate.endpoint.credential.verified", { when })
  }
  if (v.state === "failed") return t("novelTranslate.endpoint.credential.failed")
  return t("novelTranslate.endpoint.credential.unverified")
})

function formatWhen(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
}

function showTestResult(ok: boolean, text: string): void {
  testResultOk.value = ok
  testResultText.value = text
  if (testResultTimer !== null) clearTimeout(testResultTimer)
  testResultTimer = setTimeout(() => {
    testResultTimer = null
    testResultText.value = ""
  }, 4000)
}

const endpointSnapshot = ref<LlmEndpointPublic | null>(null)

/** 是否已配置（从 Keystore 读到 endpoint → hasKey=true） */
const hasConfig = computed<boolean>(() => endpointSnapshot.value !== null)

/**
 * Base URL 是否合法（spec §6.1：https 绝对 URL + 合法 authority）。
 *
 * 经 safeParseUrl.extractHostname（lynx 侧 URL 解析唯一入口）——**禁用 URL 全局**：
 * lynx 运行时 URL polyfill 不抛错但 `.hostname` 为 undefined（ADR-0163 取证），
 * 用 `new URL` 判定会把合法地址判成非法。PlatformCheck 守卫测试锁死该边界。
 */
const urlValid = computed<boolean>(() => {
  const v = baseURL.value.trim()
  if (v.length === 0) return false
  if (!v.startsWith("https://")) return false
  return extractHostname(v) !== null
})
// 长度下限 20：与 Java 侧 setApiKey 校验一致（apiKey 长度过短 → cb("", "apiKey 长度过短（>= 20）")）
const keyValid = computed<boolean>(() => apiKey.value.trim().length >= 20)
const modelValid = computed<boolean>(() => model.value.trim().length > 0)
const formValid = computed<boolean>(() => urlValid.value && keyValid.value && modelValid.value)

/** 加载已有配置到表单（仅 baseURL/model/targetLang/sourceLang；apiKey 由用户重输，因 JS 堆不持有明文） */
async function loadFromKeystore(): Promise<void> {
  try {
    const ep = await store.loadEndpointConfig()
    endpointSnapshot.value = ep
    if (ep !== null) {
      baseURL.value = ep.baseURL
      model.value = ep.model
      // 偏好默认：目标 = store 端默认（settings.language ?? "zh-CN"）；源 = "ja"
      if (ep.targetLang) targetLang.value = ep.targetLang
      if (ep.sourceLang) sourceLang.value = ep.sourceLang
    }
  } catch (err) {
    console.warn("[SettingsEndpoint] loadEndpointConfig 失败", err)
  }
}

onMounted(() => {
  void loadFromKeystore()
})

// 定时器清理（仓库惯例：NovelDetail 的 exportNotice 同款）—— 防卸载后仍触发探测/改状态
onUnmounted(() => {
  if (compatTimer !== null) clearTimeout(compatTimer)
  if (testResultTimer !== null) clearTimeout(testResultTimer)
  if (apiKeyVisibleTimer !== null) clearTimeout(apiKeyVisibleTimer)
  if (saveErrorTimer !== null) clearTimeout(saveErrorTimer)
  if (cacheClearedTimer !== null) clearTimeout(cacheClearedTimer)
})

/**
 * 「测试连接」：用真实 key 验证**凭据**（密钥层，ADR-0173 D5）。
 * 结果写 store 的 credential（持久化），并在按钮下方给一行内联反馈。
 */
async function onTestConnection(): Promise<void> {
  if (!formValid.value || testing.value) return
  testing.value = true
  try {
    const result = await store.testConnection({
      baseURL: baseURL.value.trim(),
      apiKey: apiKey.value,
      model: model.value.trim(),
    })
    if (result.ok) {
      // #637 P3：显示往返延迟（此前原生未回传耗时）
      showTestResult(
        true,
        t("novelTranslate.endpoint.probe.success") + ` (${result.elapsedMs}ms)`,
      )
    } else {
      // 只显示结构化的原因，**不**回落显原生 detail（原生串是英文技术串，
      // 此前会拼出「无法连接：endpoint 存在（api key 校验失败 = endpoint 在）」这种自相矛盾的提示）
      const text =
        result.code === "invalid_key"
          ? t("novelTranslate.endpoint.credential.invalidKey")
          : t("novelTranslate.endpoint.credential.failed")
      showTestResult(false, text + ` (${result.elapsedMs}ms)`)
    }
  } catch (err) {
    showTestResult(false, err instanceof Error ? err.message : String(err))
  } finally {
    testing.value = false
  }
}

/** API Key 显示/隐藏切换（5s 后自动转回 password；离屏清理见 onUnmounted） */
function toggleApiKeyVisible(): void {
  apiKeyVisible.value = !apiKeyVisible.value
  if (apiKeyVisibleTimer !== null) clearTimeout(apiKeyVisibleTimer)
  if (apiKeyVisible.value) {
    apiKeyVisibleTimer = setTimeout(() => {
      apiKeyVisible.value = false
      apiKeyVisibleTimer = null
    }, 5000)
  }
}

/** 「清空」按钮：仅清 API Key 字段（保留 baseURL / model / targetLang / sourceLang） */
function onClearApiKey(): void {
  apiKey.value = ""
}

/** 用户是否已点过保存（用于空字段 inline error 的显示；#637 P1-4） */
const formSubmitted = ref<boolean>(false)
/** 清缓存内联反馈（#637 P3-7） */
const cacheClearedText = ref<string>("")
let cacheClearedTimer: ReturnType<typeof setTimeout> | null = null
/** 保存失败 inline 提示（#637 P1-3：此前失败只 console.warn，用户零反馈） */
const saveErrorText = ref<string>("")
let saveErrorTimer: ReturnType<typeof setTimeout> | null = null

/** 保存（写 Keystore：先 setApiKey，再触发 reload） */
async function onSave(): Promise<void> {
  formSubmitted.value = true
  if (!formValid.value || saving.value) return
  saving.value = true
  saveErrorText.value = ""
  try {
    await store.saveEndpointConfig({
      baseURL: baseURL.value.trim(),
      apiKey: apiKey.value,
      model: model.value.trim(),
      targetLang: targetLang.value,
      sourceLang: sourceLang.value,
    })
    // 失效规则由 store.saveEndpointConfig 统一负责（ADR-0173 D4①：任何保存都失效凭据层），
    // 组件不再写 store 状态（避免两处写入者）

    // 保存后立即 reload（用于切换「已配置 / 未配置」标签）
    await loadFromKeystore()
    apiKey.value = "" // 清空输入框；下次再填（不持久化到 JS 堆，ADR-0037）
  } catch (err) {
    // #637 P1-3：失败必须给用户反馈（此前只 console.warn，用户零反馈）
    console.warn("[SettingsEndpoint] saveEndpointConfig 失败", err)
    saveErrorText.value = t("novelTranslate.endpoint.save.failed")
    if (saveErrorTimer !== null) clearTimeout(saveErrorTimer)
    saveErrorTimer = setTimeout(() => {
      saveErrorText.value = ""
      saveErrorTimer = null
    }, 4000)
  } finally {
    saving.value = false
  }
}

/** 清除全部翻译缓存（#637 P3-7：之前 clearTranslationCache 零调用点） */
async function onClearTranslationCache(): Promise<void> {
  try {
    await store.clearAllTranslationCache()
    cacheClearedText.value = t("novelTranslate.endpoint.cache.cleared")
    if (cacheClearedTimer !== null) clearTimeout(cacheClearedTimer)
    cacheClearedTimer = setTimeout(() => {
      cacheClearedText.value = ""
      cacheClearedTimer = null
    }, 4000)
  } catch (err) {
    console.warn("[SettingsEndpoint] clearAllTranslationCache 失败", err)
  }
}

/** 清除 Keystore 中的 endpoint（先经行内二次确认，见 clearConfirming） */
async function onClear(): Promise<void> {
  if (!hasConfig.value || !clearConfirming.value) return
  clearConfirming.value = false
  try {
    await store.clearEndpointConfig()
    endpointSnapshot.value = null
    baseURL.value = ""
    apiKey.value = ""
    model.value = ""
    targetLang.value = "zh-CN"
    sourceLang.value = "ja"
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
        accessibility-element
        :accessibility-label="t('novelTranslate.endpoint.baseUrl.label')"
        @input="scheduleCompatibilityProbe"
      />
      <!-- 端点兼容性 chip（地址层；debounce 600ms 自动探测，ADR-0173 D2/D3） -->
      <text class="text-label-small" :class="compatClass">{{ compatText }}</text>
      <text v-if="!urlValid && baseURL.length > 0" class="text-label-small text-error">{{
        t("novelTranslate.endpoint.invalid.url")
      }}</text>
    </view>

    <!-- API key -->
    <view class="flex flex-col gap-1">
      <text class="text-label-medium text-surface-on-variant">{{
        t("novelTranslate.endpoint.apiKey.label")
      }}</text>
      <!-- 密码框 + show/hide toggle（5s 自动隐藏）+ 字段级清空（#637 P0-2）。
           v-if/v-else 两分支绕过 vue-lynx 的 _vModelDynamic 编译问题（同字段只能静态 type） -->
      <input
        v-if="!apiKeyVisible"
        v-model="apiKey"
        type="password"
        class="h-[12vw] px-4 bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)] text-body-medium text-surface-on"
        :placeholder="t('novelTranslate.endpoint.apiKey.hint')"
        placeholder-class="text-outline"
        accessibility-element
        :accessibility-label="t('novelTranslate.endpoint.apiKey.label')"
      />
      <input
        v-else
        v-model="apiKey"
        class="h-[12vw] px-4 bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)] text-body-medium text-surface-on"
        :placeholder="t('novelTranslate.endpoint.apiKey.hint')"
        placeholder-class="text-outline"
        accessibility-element
        :accessibility-label="t('novelTranslate.endpoint.apiKey.label')"
      />
      <view class="flex flex-row gap-2">
        <view
          class="h-[8vw] px-3 flex items-center justify-center rounded-[var(--md-shape-full)] border border-outline active:bg-layer-pressed-on-surface"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="
            apiKeyVisible
              ? t('novelTranslate.endpoint.apiKey.hide')
              : t('novelTranslate.endpoint.apiKey.show')
          "
          @tap="toggleApiKeyVisible"
        >
          <text class="text-label-medium text-surface-on">{{
            apiKeyVisible
              ? t("novelTranslate.endpoint.apiKey.hide")
              : t("novelTranslate.endpoint.apiKey.show")
          }}</text>
        </view>
        <view
          class="h-[8vw] px-3 flex items-center justify-center rounded-[var(--md-shape-full)] border border-outline active:bg-layer-pressed-on-surface"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelTranslate.endpoint.apiKey.clear')"
          @tap="onClearApiKey"
        >
          <text class="text-label-medium text-surface-on">{{
            t("novelTranslate.endpoint.apiKey.clear")
          }}</text>
        </view>
      </view>
      <text v-if="!keyValid && apiKey.length > 0" class="text-label-small text-error">{{
        t("novelTranslate.endpoint.invalid.key")
      }}</text>
      <!-- 空字段 inline error（#637 P1-4：此前 error 渲染带 length 守卫，空表单零反馈） -->
      <text
        v-if="apiKey.length === 0 && formSubmitted"
        class="text-label-small text-error"
        >{{ t("novelTranslate.endpoint.invalid.key") }}</text
      >
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
        accessibility-element
        :accessibility-label="t('novelTranslate.endpoint.model.label')"
      />
      <text v-if="!modelValid && model.length > 0" class="text-label-small text-error">{{
        t("novelTranslate.endpoint.invalid.model")
      }}</text>
    </view>

    <!-- target language（#637 P0-1：数据层已就绪，纯 UI 缺口） -->
    <view class="flex flex-col gap-1">
      <text class="text-label-medium text-surface-on-variant">{{
        t("novelTranslate.endpoint.targetLang.label")
      }}</text>
      <input
        v-model="targetLang"
        class="h-[12vw] px-4 bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)] text-body-medium text-surface-on"
        :placeholder="t('novelTranslate.endpoint.targetLang.hint')"
        placeholder-class="text-outline"
        accessibility-element
        :accessibility-label="t('novelTranslate.endpoint.targetLang.label')"
      />
    </view>

    <!-- source language -->
    <view class="flex flex-col gap-1">
      <text class="text-label-medium text-surface-on-variant">{{
        t("novelTranslate.endpoint.sourceLang.label")
      }}</text>
      <input
        v-model="sourceLang"
        class="h-[12vw] px-4 bg-surface-container-low border border-outline rounded-[var(--md-shape-medium)] text-body-medium text-surface-on"
        :placeholder="t('novelTranslate.endpoint.sourceLang.hint')"
        placeholder-class="text-outline"
        accessibility-element
        :accessibility-label="t('novelTranslate.endpoint.sourceLang.label')"
      />
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

    <!-- 凭据验证徽章（密钥层；独立于兼容性，ADR-0173 D1） -->
    <view class="flex flex-row items-center gap-2">
      <view
        class="h-[2vw] w-[2vw] rounded-full"
        :class="store.credential.state === 'verified' ? 'bg-primary' : store.credential.state === 'failed' ? 'bg-error' : 'bg-outline'"
      />
      <text class="text-body-small text-surface-on-variant">{{ credentialText }}</text>
    </view>

    <!-- 测试连接内联反馈（4s 淡出；ADR-0173 D5 记录了对 spec Snackbar 的偏离） -->
    <view v-if="testResultText" class="flex flex-row items-center gap-1">
      <text
        class="text-label-medium"
        :class="testResultOk === true ? 'text-primary' : 'text-error'"
      >
        {{ testResultText }}
      </text>
    </view>

    <!-- 保存失败内联反馈（#637 P1-3） -->
    <view v-if="saveErrorText" class="flex flex-row items-center gap-1">
      <text class="text-label-medium text-error">{{ saveErrorText }}</text>
    </view>

    <!-- 清缓存内联反馈（#637 P3-7） -->
    <view v-if="cacheClearedText" class="flex flex-row items-center gap-1">
      <text class="text-label-medium text-primary">{{ cacheClearedText }}</text>
    </view>

    <!-- 操作按钮 -->
    <view class="flex flex-row gap-2">
      <view
        class="flex-1 h-[12vw] flex items-center justify-center rounded-[var(--md-shape-full)] border border-outline active:bg-layer-pressed-on-surface"
        :class="!formValid || testing ? 'opacity-50' : ''"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="t('novelTranslate.endpoint.test.button')"
        @tap="onTestConnection"
      >
        <text class="text-label-large text-surface-on">{{
          testing
            ? t("novelTranslate.endpoint.test.running")
            : t("novelTranslate.endpoint.test.button")
        }}</text>
      </view>
      <view
        class="flex-1 h-[12vw] flex items-center justify-center rounded-[var(--md-shape-full)] bg-primary active:bg-layer-pressed-on-primary"
        :class="!formValid || saving ? 'opacity-50' : ''"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="t('novelTranslate.endpoint.save')"
        @tap="onSave"
      >
        <text class="text-label-large text-on-primary">{{
          saving ? t("novelTranslate.status.pending") : t("novelTranslate.endpoint.save")
        }}</text>
      </view>
    </view>

    <!-- 翻译授权（spec §9.7）：与内容显示开关独立 —— 看见 R18 ≠ 允许外发给 LLM -->
    <view class="flex flex-col gap-2 border-t border-t-outline pt-3">
      <view
        class="flex flex-row items-center justify-between"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="t('novelTranslate.endpoint.translateR18')"
        @tap="requestTranslateConsent('r18')"
      >
        <text class="text-body-medium text-surface-on">{{
          t("novelTranslate.endpoint.translateR18")
        }}</text>
        <view
          class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center"
          :class="translateR18 ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
        >
          <view
            class="rounded-full mx-[1.067vw]"
            :class="translateR18 ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'"
          />
        </view>
      </view>
      <view
        class="flex flex-row items-center justify-between"
        :accessibility-element="A11Y_ELEMENT_ENABLED"
        :accessibility-label="t('novelTranslate.endpoint.translateR18G')"
        @tap="requestTranslateConsent('r18g')"
      >
        <text class="text-body-medium text-surface-on">{{
          t("novelTranslate.endpoint.translateR18G")
        }}</text>
        <view
          class="w-[13.867vw] h-[8.533vw] rounded-full flex flex-row items-center"
          :class="translateR18G ? 'bg-primary justify-end' : 'bg-surface-container-highest justify-start border-[0.533vw] border-outline'"
        >
          <view
            class="rounded-full mx-[1.067vw]"
            :class="translateR18G ? 'w-[6.4vw] h-[6.4vw] bg-primary-on' : 'w-[4.267vw] h-[4.267vw] bg-outline'"
          />
        </view>
      </view>
    </view>

    <!-- 风险确认（首次开启；行内面板复刻既有确认模式） -->
    <view v-if="consentFor !== null" class="flex flex-col gap-2 bg-error-container rounded-[var(--md-shape-medium)] p-3">
      <text class="text-title-small text-on-error-container">{{
        consentFor === "r18g"
          ? t("novelTranslate.endpoint.consent.r18g.title")
          : t("novelTranslate.endpoint.consent.r18.title")
      }}</text>
      <text class="text-body-small text-on-error-container">{{
        consentFor === "r18g"
          ? t("novelTranslate.endpoint.consent.r18g.body")
          : t("novelTranslate.endpoint.consent.r18.body")
      }}</text>
      <view class="flex flex-row gap-2">
        <view
          class="flex-1 h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)] border border-outline"
          @tap="consentFor = null"
        >
          <text class="text-label-large text-surface-on">{{
            t("novelTranslate.endpoint.cancel")
          }}</text>
        </view>
        <view
          class="flex-1 h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)] bg-error"
          :accessibility-element="A11Y_ELEMENT_ENABLED"
          :accessibility-label="t('novelTranslate.endpoint.consent.enable')"
          @tap="confirmTranslateConsent"
        >
          <text class="text-label-large text-on-error">{{
            t("novelTranslate.endpoint.consent.enable")
          }}</text>
        </view>
      </view>
    </view>

    <!-- 清除入口（仅已配置时显示）：两步行内确认（lynx 无 confirm() 平台弹窗） -->
    <view v-if="hasConfig" class="flex flex-col gap-2">
      <view
        v-if="!clearConfirming"
        class="h-[10.667vw] flex items-center justify-center"
        @tap="clearConfirming = true"
      >
        <text class="text-label-large text-error">× {{ t("novelTranslate.endpoint.clear") }}</text>
      </view>
      <template v-else>
        <text class="text-label-medium text-surface-on-variant text-center">{{
          t("novelTranslate.endpoint.deleteConfirm")
        }}</text>
        <view class="flex flex-row gap-2">
          <view
            class="flex-1 h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)] border border-outline active:bg-layer-pressed-on-surface"
            @tap="clearConfirming = false"
          >
            <text class="text-label-large text-surface-on">{{
              t("novelTranslate.endpoint.cancel")
            }}</text>
          </view>
          <view
            class="flex-1 h-[10.667vw] flex items-center justify-center rounded-[var(--md-shape-full)] bg-error-container active:bg-layer-pressed-on-surface"
            @tap="onClear"
          >
            <text class="text-label-large text-on-error-container">{{
              t("novelTranslate.endpoint.confirmClear")
            }}</text>
          </view>
        </view>
      </template>
    </view>

    <!-- 清除翻译缓存（#637 P3-7）：不做二次确认（可重建，成本低）；
         与「清除配置」区分（那个会毁凭据，需确认） -->
    <view
      class="h-[10.667vw] flex items-center justify-center"
      :accessibility-element="A11Y_ELEMENT_ENABLED"
      :accessibility-label="t('novelTranslate.endpoint.cache.clear')"
      @tap="onClearTranslationCache"
    >
      <text class="text-label-large text-surface-on-variant">{{
        t("novelTranslate.endpoint.cache.clear")
      }}</text>
    </view>
  </view>
</template>