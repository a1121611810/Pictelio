/**
 * 翻译提示词模板集中管理（不散落组件）。
 *
 * 设计约束（决策 #21/#22 + KV 缓存红利）：
 * - 所有分块共享同一 system prompt 前缀，最大化 DeepSeek 上下文硬盘缓存命中
 *   （命中价 ¥0.02 vs 未命中 ¥1，见 docs/research/deepseek-api-docs-summary.md §5）
 * - 输出约束为「空行分隔段落 + 段落数 = 输入段落数」，供管线保序重组
 */

interface TranslationPromptOptions {
  /** 目标语言 code（默认 zh-Hans） */
  targetLang?: string;
  /** 检测到的源语言 code（ja / en / other，用于提示词措辞） */
  sourceLang?: string;
}

export const DEFAULT_TARGET_LANG = "zh-Hans";

const SOURCE_LANG_NAMES: Record<string, string> = {
  ja: "日语",
  en: "英语",
  ko: "韩语",
  zh: "中文",
};

/**
 * 构建翻译 system prompt。同一目标语言下输出恒定，保证分块间共享前缀。
 */
export function buildTranslationSystemPrompt(opts: TranslationPromptOptions = {}): string {
  const target = opts.targetLang ?? DEFAULT_TARGET_LANG;
  const sourceName = opts.sourceLang ? SOURCE_LANG_NAMES[opts.sourceLang] : "原文语言";
  const targetName = target === "zh-Hans" ? "简体中文" : target === "zh-Hant" ? "繁体中文" : target;
  return [
    `你是一位专业的轻小说翻译。请把下面的${sourceName}小说正文翻译成${targetName}。`,
    "翻译要求：",
    "1. 忠实原文，保留语气与细节，不添加任何解释、注释或原文没有的内容。",
    "2. 角色名、专有名词全书保持一致；不熟悉的人名按音译处理。",
    "3. 只输出译文本身，不要输出任何前缀、后缀或说明文字。",
    "4. 保持段落结构：每段译文用空行（\\n\\n）分隔，输出段落数必须与输入段落数完全一致。",
    "5. 原文中的【未翻译】标记保留原样。",
  ].join("\n");
}

/**
 * 构建单块翻译的 user prompt（原文段落以空行拼接）。
 */
export function buildTranslationUserPrompt(sourceText: string): string {
  return sourceText;
}
