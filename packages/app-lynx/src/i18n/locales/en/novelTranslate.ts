// ─── 小说翻译域（English mirror；spec docs/specs/app-lynx-novel-translation.md §8） ───
// key 集合与 zh-CN/novelTranslate.ts 完全一致（satisfies 编译期强制）。
// 文案按 docs/style-guides/ui-copy.md（Apple HIG 基线）产出。
import type { NovelTranslateKey } from "../zh-CN/novelTranslate";

const enNovelTranslate = {
  // endpoint subdomain
  "novelTranslate.endpoint.title": "LLM Translation Settings",
  "novelTranslate.endpoint.baseUrl.label": "API Base URL",
  "novelTranslate.endpoint.baseUrl.hint": "e.g. https://api.openai.com/v1",
  "novelTranslate.endpoint.apiKey.label": "API Key",
  "novelTranslate.endpoint.apiKey.hint": "Stored end-to-end encrypted in Keystore",
  "novelTranslate.endpoint.model.label": "Model",
  "novelTranslate.endpoint.model.hint": "e.g. gpt-5, deepseek-v4-pro, or any /v1/responses-compatible model",
  "novelTranslate.endpoint.save": "Save",
  "novelTranslate.endpoint.saved": "Saved",
  "novelTranslate.endpoint.invalid.url": "Invalid base URL format",
  "novelTranslate.endpoint.invalid.key": "API key is required",
  "novelTranslate.endpoint.invalid.model": "Model name is required",
  "novelTranslate.endpoint.probe.success": "Connection successful",
  "novelTranslate.endpoint.probe.failed": "Cannot connect: {{detail}}",
  "novelTranslate.endpoint.probe.timeout": "Probe timed out",
  "novelTranslate.endpoint.notConfigured": "LLM endpoint not configured",
  "novelTranslate.endpoint.deleteConfirm": "Clear saved endpoint configuration?",

  // action subdomain
  "novelTranslate.action.start": "Translate chapter",
  "novelTranslate.action.abort": "Stop",
  "novelTranslate.action.retry": "Retry",
  "novelTranslate.action.cached": "Cached",
  "novelTranslate.action.viewOriginal": "Original",
  "novelTranslate.action.viewTranslation": "Translation",
  "novelTranslate.action.switchMode": "Switch display",

  // status subdomain
  "novelTranslate.status.idle": "Not translated",
  "novelTranslate.status.pending": "Preparing",
  "novelTranslate.status.translating": "Translating",
  "novelTranslate.status.translatingQueued": "Queued",
  "novelTranslate.status.partial": "Partial translation",
  "novelTranslate.status.failed": "Translation failed",
  "novelTranslate.status.completed": "Completed",
  "novelTranslate.status.aborted": "Cancelled",
  "novelTranslate.status.progress.label": "Progress {{done}}/{{total}}",
  "novelTranslate.status.progress.remaining": "{{remaining}} chapters remaining",

  // error subdomain
  "novelTranslate.error.network": "Network unavailable",
  "novelTranslate.error.unauthorized": "Invalid API key (401)",
  "novelTranslate.error.rateLimit": "Too many requests (429)",
  "novelTranslate.error.server": "LLM service temporarily unavailable",
  "novelTranslate.error.unknown": "Unknown error",
  "novelTranslate.error.R18Blocked": "This chapter is restricted and cannot be translated",
  "novelTranslate.error.timeout": "Request timed out",
  "novelTranslate.error.canceled": "Cancelled",
  "novelTranslate.error.notConfigured": "Please configure the LLM endpoint in Settings first",
  "novelTranslate.error.partialFailed": "Some paragraphs failed; original text used as fallback",
  "novelTranslate.error.retrying": "Retrying…",
  "novelTranslate.error.retryingFailed": "Retry failed",
  "novelTranslate.error.retryHint": "Try again later or check your endpoint configuration",
} as const satisfies Record<NovelTranslateKey, string>;

export default enNovelTranslate;