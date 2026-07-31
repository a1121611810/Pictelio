/**
 * 翻译状态层 —— S1 最小版。
 * - API key（BYOK）加密存储：@aparajita/capacitor-secure-storage（Android Keystore；
 *   Web 环境为 base64 明文，已知限制）。
 * - 详情页翻译显示状态：译文段落（key = TextBlock.index）/ 原文译文切换 / 翻译中 / 错误。
 * S6 扩展：默认档位 / 思考开关 / R18 开关 / 清除入口。
 */
import { createSignal } from "solid-js";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
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
export interface TranslationProgress {
  done: number;
  total: number;
}
export const [translationProgress, setTranslationProgress] =
  createSignal<TranslationProgress | null>(null);

/** 切换章节 / 离开详情页时重置翻译状态（防串章污染） */
export function resetTranslationState(): void {
  setTranslatedParagraphs({});
  setShowTranslation(false);
  setTranslationError(null);
  setTranslationProgress(null);
}
