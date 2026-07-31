/**
 * 翻译状态层 —— S1 最小版。
 * - API key（BYOK）加密存储：@aparajita/capacitor-secure-storage（Android Keystore；
 *   Web 环境为 base64 明文，已知限制）。
 * - 详情页翻译显示状态：译文段落（key = TextBlock.index）/ 原文译文切换 / 翻译中 / 错误。
 * S6 扩展：默认档位 / 思考开关 / R18 开关 / 清除入口。
 */
import { createSignal } from "solid-js";
import { SecureStorage } from "@aparajita/capacitor-secure-storage";
import { Preferences } from "@capacitor/preferences";
import { tryAsync } from "@/utils/tryAsync";
import type { TranslateError } from "@/api/translate";

const DS_API_KEY = "ds_api_key";
const PREF_R18 = "translation_r18";
const PREF_R18G = "translation_r18g";
const PREF_R18_CONFIRMED = "translation_r18_confirmed";

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
export type RestrictPolicy = "allow" | "block";

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

const [translateR18, setTranslateR18State] = createSignal(false);
const [translateR18G, setTranslateR18GState] = createSignal(false);
/** 是否已确认过 R18 翻译风险（首次翻译 R18/R18G 时弹窗，确认后持久化不再打扰） */
const [r18Confirmed, setR18Confirmed] = createSignal(false);

export { translateR18, translateR18G };

/** 恢复 R18/R18G 开关与确认标记（Preferences 持久化） */
export async function loadTranslateRestrictSettings(): Promise<void> {
  const [r18Err, r18Val] = await tryAsync(Preferences.get({ key: PREF_R18 }));
  if (!r18Err && r18Val?.value !== undefined) {
    setTranslateR18State(r18Val.value === "true");
  }
  const [r18gErr, r18gVal] = await tryAsync(Preferences.get({ key: PREF_R18G }));
  if (!r18gErr && r18gVal?.value !== undefined) {
    setTranslateR18GState(r18gVal.value === "true");
  }
  const [cfErr, cfVal] = await tryAsync(Preferences.get({ key: PREF_R18_CONFIRMED }));
  if (!cfErr && cfVal?.value !== undefined) {
    setR18Confirmed(cfVal.value === "true");
  }
}

/** 设置「翻译 R18 内容」开关（失败仅 warn，不阻断） */
export async function setTranslateR18(on: boolean): Promise<void> {
  setTranslateR18State(on);
  const [err] = await tryAsync(Preferences.set({ key: PREF_R18, value: String(on) }));
  if (err) {
    console.warn("[translationStore] 保存 R18 翻译开关失败", err);
  }
}

/** 设置「翻译 R18G 内容」开关（失败仅 warn，不阻断） */
export async function setTranslateR18G(on: boolean): Promise<void> {
  setTranslateR18GState(on);
  const [err] = await tryAsync(Preferences.set({ key: PREF_R18G, value: String(on) }));
  if (err) {
    console.warn("[translationStore] 保存 R18G 翻译开关失败", err);
  }
}

/** 读取 R18 风险确认标记（true = 已确认过，翻译时不再弹窗） */
export function getR18Confirmed(): boolean {
  return r18Confirmed();
}

/** 标记 R18 风险已确认（持久化） */
export async function markR18Confirmed(): Promise<void> {
  setR18Confirmed(true);
  const [err] = await tryAsync(Preferences.set({ key: PREF_R18_CONFIRMED, value: "true" }));
  if (err) {
    console.warn("[translationStore] 保存 R18 确认标记失败", err);
  }
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
