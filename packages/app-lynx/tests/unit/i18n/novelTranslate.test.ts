// ─── 小说翻译 i18n 字典契约测试（spec docs/specs/app-lynx-novel-translation.md §8） ───
// 测试组（来自 ADR-0169 D10 + AGENTS.md 测试硬约束）：
// - 子命名空间完备：endpoint / action / status / error 四个子域键全数存在
// - 50 键逐字一致：zh-CN 与 en 镜像 key 集合完全对齐（satisfies 编译期强制 + 运行时反射双校验）
// - 字典值非空：所有键值非空字符串（防遗漏）
// - 模板占位完备：含 {{xxx}} 占位符的键，zh-CN/en 双侧占位符集合一致
//
// Oracle 来源（AGENTS.md 测试硬约束 #2「真实样例」）：
// - 键名集合直接对照 spec §8（spec 是需求唯一事实源）
// - 占位符集合用正则从源码字符串中提取（与运行时 i18n 解析同源）
import { describe, it, expect } from "vitest"
import zh from "../../../src/i18n/locales/zh-CN/novelTranslate"
import en from "../../../src/i18n/locales/en/novelTranslate"

/**
 * 当前 74 键全集（顺序敏感度=无；用作键穷尽性校验）。
 * #1043 清理了 15 个生产侧无消费方的死键（endpoint.titleGroup、action.abort/cached/switchMode、
 * status.idle/translatingQueued/partial/failed/completed/aborted/progress.label/progress.remaining、
 * error.retrying/retryingFailed/retryHint）—— 本表此前把它们当活键钉住，等于给死键发免死金牌。
 * 现在死键由 `tests/noDeadKeys.test.ts`（全量 locale 字典扫描）负责，本表只声明「保留键的集合」。
 */
const EXPECTED_KEYS: readonly string[] = [
  // endpoint (48)
  "novelTranslate.endpoint.title",
  "novelTranslate.endpoint.baseUrl.label",
  "novelTranslate.endpoint.baseUrl.hint",
  "novelTranslate.endpoint.apiKey.label",
  "novelTranslate.endpoint.apiKey.hint",
  "novelTranslate.endpoint.apiKey.show",
  "novelTranslate.endpoint.apiKey.hide",
  "novelTranslate.endpoint.apiKey.clear",
  "novelTranslate.endpoint.model.label",
  "novelTranslate.endpoint.model.hint",
  "novelTranslate.endpoint.targetLang.label",
  "novelTranslate.endpoint.targetLang.hint",
  "novelTranslate.endpoint.sourceLang.label",
  "novelTranslate.endpoint.sourceLang.hint",
  "novelTranslate.endpoint.save",
  "novelTranslate.endpoint.saved",
  "novelTranslate.endpoint.save.failed",
  "novelTranslate.endpoint.invalid.url",
  "novelTranslate.endpoint.invalid.key",
  "novelTranslate.endpoint.invalid.model",
  "novelTranslate.endpoint.probe.success",
  "novelTranslate.endpoint.notConfigured",
  "novelTranslate.endpoint.deleteConfirm",
  // 清除流程行内二次确认（lynx 无浏览器 confirm()，见 SettingsEndpoint.vue）；
  // ADR-0173 同批新增（探测六态 + 凭据三态 + 动作键）
  // ADR-0173：动作按钮键（测试连接）+ 兼容性七态 + 凭据三态 + 动作二键
  "novelTranslate.endpoint.test.button",
  "novelTranslate.endpoint.test.running",
  "novelTranslate.endpoint.compat.idle",
  "novelTranslate.endpoint.compat.ok",
  "novelTranslate.endpoint.compat.azure",
  "novelTranslate.endpoint.compat.deepseek",
  "novelTranslate.endpoint.compat.partial",
  "novelTranslate.endpoint.compat.incompatible",
  "novelTranslate.endpoint.compat.unknown",
  "novelTranslate.endpoint.credential.unverified",
  "novelTranslate.endpoint.credential.verified",
  "novelTranslate.endpoint.credential.failed",
  "novelTranslate.endpoint.credential.invalidKey",
  // spec §9.7 翻译授权（ADR-0173 追加）：与内容显示开关独立
  "novelTranslate.endpoint.translateR18",
  "novelTranslate.endpoint.translateR18G",
  "novelTranslate.endpoint.consent.r18.title",
  "novelTranslate.endpoint.consent.r18.body",
  "novelTranslate.endpoint.consent.r18g.title",
  "novelTranslate.endpoint.consent.r18g.body",
  "novelTranslate.endpoint.consent.enable",
  "novelTranslate.endpoint.clear",
  "novelTranslate.endpoint.cache.clear",
  "novelTranslate.endpoint.cache.cleared",
  "novelTranslate.endpoint.cancel",
  "novelTranslate.endpoint.confirmClear",
  // action (6)
  "novelTranslate.action.start",
  "novelTranslate.action.retry",
  "novelTranslate.action.viewOriginal",
  "novelTranslate.action.viewTranslation",
  "novelTranslate.action.configure_translate",
  "novelTranslate.action.retranslate",
  // status (4)
  "novelTranslate.status.pending",
  "novelTranslate.status.translating",
  "novelTranslate.status.retrying",
  "novelTranslate.status.placeholder_untranslated",
  // error (16)
  "novelTranslate.error.network",
  "novelTranslate.error.unauthorized",
  "novelTranslate.error.rateLimit",
  "novelTranslate.error.server",
  "novelTranslate.error.unknown",
  "novelTranslate.error.insufficientBalance",
  "novelTranslate.error.modelNotFound",
  "novelTranslate.error.invalidRequest",
  "novelTranslate.error.contentFilter",
  "novelTranslate.error.incomplete",
  "novelTranslate.error.R18Blocked",
  "novelTranslate.error.r18gBlocked",
  "novelTranslate.error.timeout",
  "novelTranslate.error.canceled",
  "novelTranslate.error.notConfigured",
  "novelTranslate.error.partialFailed",
] as const

/** 从字符串中提取所有 {{xxx}} 占位符名（不区分语种；用于跨语种占位符集合一致性） */
function extractPlaceholders(s: string): string[] {
  const out: string[] = []
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) out.push(m[1])
  return out
}

describe('i18n: novelTranslate 字典结构（spec §8）', () => {
  it('zh-CN 与 en 键数与 EXPECTED_KEYS 一致（spec §8 键名实现态）', () => {
    // spec §8 用「示意键名」（endpoint.section.title / baseURL.probe.ok…）描述设计意图；
    // 实现按 4 子命名空间落为 74 键 —— 权威口径 = EXPECTED_KEYS（本表 + noDeadKeys 用量守卫）。
    // 历史：47 → 51 → 67（ADR-0173：探测/凭据状态 + 动作键）→ 75（翻译授权 + 同意面板）
    //       → 79（错误码分类补全：insufficient_balance / model_not_found / invalid_request / content_filter）
    //       → 89（#945：vllm 死状态清除，删 compat.vllm）
    //       → 74（#1043：删 15 个生产侧无消费方的死键，见 EXPECTED_KEYS 上方注释）。
    expect(Object.keys(zh).length).toBe(EXPECTED_KEYS.length)
    expect(Object.keys(en).length).toBe(EXPECTED_KEYS.length)
  })

  it('zh-CN 键集合 = spec §8 列出的全集（穷尽性）', () => {
    const zhKeys = new Set(Object.keys(zh))
    const expected = new Set(EXPECTED_KEYS)
    expect(zhKeys).toEqual(expected)
  })

  it('en 键集合 = spec §8 列出的全集（穷尽性）', () => {
    const enKeys = new Set(Object.keys(en))
    const expected = new Set(EXPECTED_KEYS)
    expect(enKeys).toEqual(expected)
  })

  it('zh-CN 与 en 键集合逐字对齐（per-domain satisfies 编译期强制的运行时镜像）', () => {
    const zhKeys = Object.keys(zh).sort()
    const enKeys = Object.keys(en).sort()
    expect(enKeys).toEqual(zhKeys)
  })

  it('所有键值非空字符串（防遗漏）', () => {
    for (const k of EXPECTED_KEYS) {
      const v = (zh as Record<string, string>)[k]
      expect(typeof v, `${k} 应为字符串`).toBe('string')
      expect(v.length, `${k} 不应为空`).toBeGreaterThan(0)
      const ev = (en as Record<string, string>)[k]
      expect(typeof ev, `en[${k}] 应为字符串`).toBe('string')
      expect(ev.length, `en[${k}] 不应为空`).toBeGreaterThan(0)
    }
  })

  it('含模板占位符的键 zh-CN 与 en 占位符集合对齐', () => {
    // #1043 清理后仅剩 1 个含占位符的键：endpoint.credential.verified（{{when}}）。
    // 被删的 status.progress.label / status.progress.remaining 本身也带占位符，一并消失。
    //
    // code-review S4：此前这里还列了 `endpoint.probe.failed`，但该键已随 #637 死键清理删除
    // → `extractPlaceholders(undefined)` 返回 []，两侧都空 → 断言恒真（占位符守护形同虚设）。
    // 现改为**从字典动态发现**含占位符的键，新增含占位符的键会自动纳入守护（不再硬编码清单）。
    const zhDict = zh as Record<string, string>
    const enDict = en as Record<string, string>
    const withPlaceholders = Object.keys(zhDict).filter(
      (k) => extractPlaceholders(zhDict[k]).length > 0,
    )
    // 防「过滤后为空 → 循环空转」的隐性恒真；下限 = 当前实际含占位符的键数（#1043 后为 1）
    expect(withPlaceholders.length).toBeGreaterThanOrEqual(1)
    for (const k of withPlaceholders) {
      const zhPh = extractPlaceholders(zhDict[k]).sort()
      const enPh = extractPlaceholders(enDict[k]).sort()
      expect(enPh, `en[${k}] 占位符应与 zh 对齐`).toEqual(zhPh)
    }
  })

  it('endpoint 48 键 + action 6 键 + status 4 键 + error 16 键 = 74', () => {
    const groups = {
      endpoint: EXPECTED_KEYS.filter((k) => k.startsWith('novelTranslate.endpoint.')),
      action: EXPECTED_KEYS.filter((k) => k.startsWith('novelTranslate.action.')),
      status: EXPECTED_KEYS.filter((k) => k.startsWith('novelTranslate.status.')),
      error: EXPECTED_KEYS.filter((k) => k.startsWith('novelTranslate.error.')),
    }
    expect(groups.endpoint.length).toBe(48)
    expect(groups.action.length).toBe(6)
    expect(groups.status.length).toBe(4)
    expect(groups.error.length).toBe(16)
  })
})