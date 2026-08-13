/**
 * 翻译状态层 —— S1 最小版。
 * - API key（BYOK）加密存储：@aparajita/capacitor-secure-storage（Android Keystore；
 *   Web 环境为 base64 明文，已知限制）。
 * - 详情页翻译显示状态：译文段落（key = TextBlock.index）/ 原文译文切换 / 翻译中 / 错误。
 * S6 扩展：默认档位 / 思考开关 / R18 开关 / 清除入口。
 */
import { createSignal } from "solid-js";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { settings } from "@/settings";
import { tryAsync } from "@/utils/tryAsync";
import type { TranslateError } from "@/api/translate";

const DS_API_KEY = "ds_api_key";

// ── API key（BYOK）──

const [dsApiKey, setDsApiKey] = createSignal<string | null>(null);

export { dsApiKey };

/** 启动 / 进入设置页时恢复 API key（存储异常 → null + warn，不阻断流程） */
export async function loadDsApiKey(): Promise<void> {
  const [err, value] = await tryAsync(SecureStorage.get(DS_API_KEY));
  if (err) {
    console.warn("[translationStore] 读取 API key 失败", err);
    setDsApiKey(null);
    return;
  }
  setDsApiKey(typeof value === "string" && value.length > 0 ? value : null);
}

/** 保存 API key（空字符串 = 清除）；持久化失败向上抛，由 UI 提示 */
export async function saveDsApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  if (!trimmed) {
    await clearDsApiKey();
    return;
  }
  const [err] = await tryAsync(SecureStorage.set(DS_API_KEY, trimmed));
  if (err) {
    console.warn("[translationStore] 保存 API key 失败", err);
    throw err;
  }
  setDsApiKey(trimmed);
}

/** 清除 API key（决策 #24：清除 key 不影响已缓存译文） */
export async function clearDsApiKey(): Promise<void> {
  const [err] = await tryAsync(SecureStorage.remove(DS_API_KEY));
  if (err) {
    console.warn("[translationStore] 清除 API key 失败", err);
  }
  setDsApiKey(null);
}

// ── 敏感内容分级（决策 #23）──

/**
 * x_restrict 分级决策函数（纯函数可单测）：
 * - 0（全年龄）→ allow 直通
 * - 1（R18）→ 需「翻译 R18 内容」开关
 * - 2（R18G）→ 需「翻译 R18G 内容」开关（客户端拦截，不发送任何内容）
 */
type RestrictPolicy = "allow" | "block";

export function decideTranslatePolicy(
  xRestrict: number,
  r18On: boolean,
  r18gOn: boolean,
): RestrictPolicy {
  if (xRestrict === 1) {
    return r18On ? "allow" : "block";
  }
  if (xRestrict === 2) {
    return r18gOn ? "allow" : "block";
  }
  return "allow"; // 0 及未知等级直通（防御性放行）
}

// ── R18/R18G 开关与确认标记（统一 settings registry 管理）──
// 旧存储 key 与格式（bool 存 "true"/"false"）兼容；set 为乐观更新，
// 持久化失败由 registry 内部 onError 兜底 warn。

const r18Handle = settings.define<boolean>({
  key: "translation_r18",
  default: false,
});
const r18gHandle = settings.define<boolean>({
  key: "translation_r18g",
  default: false,
});
/** 是否已确认过 R18 翻译风险（首次翻译 R18/R18G 时弹窗，确认后持久化不再打扰） */
const r18ConfirmedHandle = settings.define<boolean>({
  key: "translation_r18_confirmed",
  default: false,
});

export const translateR18 = (): boolean => r18Handle.value();
export const translateR18G = (): boolean => r18gHandle.value();

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
export async function loadTranslateRestrictSettings(): Promise<void> {}

/** 设置「翻译 R18 内容」开关（乐观更新，持久化失败由 registry warn） */
export async function setTranslateR18(on: boolean): Promise<void> {
  r18Handle.set(on);
}

/** 设置「翻译 R18G 内容」开关（乐观更新，持久化失败由 registry warn） */
export async function setTranslateR18G(on: boolean): Promise<void> {
  r18gHandle.set(on);
}

/** 读取 R18 风险确认标记（true = 已确认过，翻译时不再弹窗） */
export function getR18Confirmed(): boolean {
  return r18ConfirmedHandle.value();
}

/** 标记 R18 风险已确认（乐观更新，持久化失败由 registry warn） */
export async function markR18Confirmed(): Promise<void> {
  r18ConfirmedHandle.set(true);
}

// ── 翻译质量档位与思考开关（决策 #22，S6）──

/** 翻译档位：标准 = deepseek-v4-flash / 高质量 = deepseek-v4-pro */
export type TranslateTier = "flash" | "pro";

export const TIER_MODELS = {
  flash: "deepseek-v4-flash",
  pro: "deepseek-v4-pro",
} as const;

/** 思考模式：默认关（更快/无 reasoning token 计费/temperature 生效），可开（S6） */
const tierHandle = settings.define<TranslateTier>({
  key: "translation_default_tier",
  default: "flash",
  validate: (v): v is TranslateTier => v === "flash" || v === "pro",
});
const thinkingHandle = settings.define<boolean>({
  key: "translation_thinking",
  default: false,
});

export const defaultTier = (): TranslateTier => tierHandle.value();
export const thinkingEnabled = (): boolean => thinkingHandle.value();

/** 兼容存根：registry hydrateAll 已加载，Phase 4 移除 */
export async function loadTierAndThinking(): Promise<void> {}

/** 设置默认档位（乐观更新，持久化失败由 registry warn） */
export async function setDefaultTier(tier: TranslateTier): Promise<void> {
  tierHandle.set(tier);
}

/** 设置思考模式开关（乐观更新，持久化失败由 registry warn） */
export async function setThinkingEnabled(on: boolean): Promise<void> {
  thinkingHandle.set(on);
}

// ── 详情页翻译显示状态 ──

/** 译文段落映射（key = TextBlock.index，S1 整章单块翻译后全量写入） */
export const [translatedParagraphs, setTranslatedParagraphs] = createSignal<Record<number, string>>(
  {},
);

/** 原文 / 译文切换（段落索引不变，布局缓存按译文维度区分） */
export const [showTranslation, setShowTranslation] = createSignal(false);

/** 翻译进行中（面板进度展示，S2 扩展进度字段） */
export const [translating, setTranslating] = createSignal(false);

/** 翻译错误（面板展示；S4 扩展失败块集合） */
export const [translationError, setTranslationError] = createSignal<TranslateError | null>(null);

/** 翻译进度（分块管线 S2：done/total；未翻译为 null） */
interface TranslationProgress {
  done: number;
  total: number;
}
export const [translationProgress, setTranslationProgress] =
  createSignal<TranslationProgress | null>(null);

/** 失败段落 index 集合（S4：「未翻译」标记 + 断点续翻；段落索引 = TextBlock.index） */
export const [failedParagraphs, setFailedParagraphs] = createSignal<ReadonlySet<number>>(new Set());

/** 本章是否发生过思考模式翻译（S4 review：思考译文不得固化进非思考缓存） */
const [translationUsedThinking, setTranslationUsedThinking] = createSignal(false);

export { translationUsedThinking, setTranslationUsedThinking };

/** 切换章节 / 离开详情页时重置翻译状态（防串章污染） */
export function resetTranslationState(): void {
  setTranslatedParagraphs({});
  setShowTranslation(false);
  setTranslationError(null);
  setTranslationProgress(null);
  setFailedParagraphs(new Set<number>());
  setTranslationUsedThinking(false);
}
