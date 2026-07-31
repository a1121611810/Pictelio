/**
 * 小说源语言检测（MVP 仅需区分 ja / en / zh / other）。
 * 依据评估文档 6.3：假名占比 >1% → ja；拉丁占比 >10% → en；CJK 汉字占比 >30% → zh。
 * 用于：翻译入口显示（zh 源不显示）、prompt 措辞、目标语言预选。
 */
export type DetectedLang = "ja" | "en" | "zh" | "other";

/** 检测文本语言（取前 500 字符样本，防长文开销） */
export function detectNovelLanguage(text: string): DetectedLang {
  const sample = text.slice(0, 500);
  const kana = (sample.match(/[\u3040-\u30ff]/gu) ?? []).length;
  const hangul = (sample.match(/[\uac00-\ud7af]/gu) ?? []).length;
  const latin = (sample.match(/[a-zA-Z]/gu) ?? []).length;
  const cjk = (sample.match(/[\u4e00-\u9fff]/gu) ?? []).length;
  const total = sample.replace(/\s/gu, "").length;
  if (total === 0) {
    return "other";
  }
  if (kana / total > 0.01) {
    return "ja";
  }
  if (hangul / total > 0.01) {
    // MVP 翻译目标仅日/英 → 中文；韩文识别为 other（不进入翻译流，prompts 的 ko 词条为 Phase 2 预留）
    return "other";
  }
  if (latin / total > 0.1) {
    return "en";
  }
  if (cjk / total > 0.3) {
    return "zh";
  }
  return "other";
}
