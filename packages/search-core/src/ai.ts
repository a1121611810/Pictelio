/**
 * AI 覆盖 → 有效模式（spec §5.4，#479 裁决）。
 * 面板覆盖不写回账号级设置：effective mode 注入各端既有 ADR-0155 管线
 * （webview=filterSearchResultsByAiMode 的 mode 参数；lynx=settingsStore 判定谓词）。
 * 「隐藏 AI」注入 mask——各端 mask 既有语义保持（webview=数据层隐藏，lynx=遮罩卡，ADR-0155 D2）。
 */
export type AiFilterMode = "show" | "mask" | "only";
import type { AiOverride } from "./filters";

export function resolveAiMode(setting: AiFilterMode, override: AiOverride): AiFilterMode {
  if (override === "all") return "show";
  if (override === "hide") return "mask";
  return setting;
}
