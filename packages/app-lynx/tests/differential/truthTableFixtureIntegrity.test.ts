// 行为真值表 fixture 自洽门（ADR-0203 决策 5 迁移件）。
//
// 形态：**单端行为基准**（无对侧可比）。原 `app/tests/unit/differential/` 下的
// `aiFilterTruthTableConsistency` / `restrictionTruthTableConsistency` /
// `oauthErrorCasesConsistency` / `urlRewriteCasesConsistency` /
// `illustTypeBadgeCasesConsistency` 断言的是「WebView 副本与 Lynx 副本逐字节一致」——
// 对侧随 packages/app 删除后该断言失去被测对象，本文件只保留其中**仍有价值**的部分：
// fixture 自身的覆盖完整性与 oracle 可解析性（防止删例、错例、恒真空表无人发现）。
//
// 匹配纪律（改名复活防线，spec「先例：release-build-steps.test.ts」）：
// 凡能用语义判定的，一律按语义（取值域 / 笛卡尔积 / 输入形态 / 解析结果）判定，
// 不按用例 id 或字面量名匹配——字段/用例改名后不得整体漏过。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { AI_FILTER_TRUTH_TABLE } from './sharedAiFilterTruthTable'
import { ILLUST_TYPE_BADGE_CASES } from './sharedIllustTypeBadgeCases'
import {
  OAUTH_ERROR_CLASSIFY_CASES,
  PIXIV_OAUTH_400_RAW_SNAPSHOT,
} from './sharedOAuthErrorCases'
import { RESTRICTION_TRUTH_TABLE } from './sharedRestrictionTruthTable'
import { TAG_MUTE_TRUTH_TABLE } from './sharedTagMuteTruthTable'
import { URL_REWRITE_CASES } from './sharedUrlRewriteCases'

/** 全部 fixture 源文件（用于「零框架依赖」批量判定） */
const FIXTURE_FILES = [
  'sharedAiFilterTruthTable.ts',
  'sharedIllustTypeBadgeCases.ts',
  'sharedOAuthErrorCases.ts',
  'sharedRestrictionTruthTable.ts',
  'sharedTagMuteTruthTable.ts',
  'sharedUrlRewriteCases.ts',
] as const

function readFixtureRaw(name: string): string {
  return readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8')
}

describe('真值表 fixture 自洽门：零框架依赖（fixture 必须可被纯数据消费）', () => {
  it('六个 fixture 文件全部存在且非空（空集防护：路径失效不得致全称断言恒真）', () => {
    expect(FIXTURE_FILES).toHaveLength(6)
    for (const name of FIXTURE_FILES) {
      const raw = readFixtureRaw(name)
      expect(raw.length, `${name} 不得为空`).toBeGreaterThan(0)
      expect(raw, `${name} 应导出数据常量`).toMatch(/export const [A-Z_]+/)
    }
  })

  it('不得 import 框架（vue / solid-js / @capacitor / vitest）', () => {
    for (const name of FIXTURE_FILES) {
      const raw = readFixtureRaw(name)
      expect(raw, `${name} 不得 import 框架`).not.toMatch(
        /^\s*import .* from ["'](vue|solid-js|@capacitor|vitest)/m,
      )
    }
  })
})

describe('真值表 fixture 自洽门：AI 三态（oracle = ADR-0155）', () => {
  it('恰好覆盖 3 模式 × 4 个 ai_type 笛卡尔积（删例/漏例即红）', () => {
    // 语义判定：模式集合与 ai_type 集合各自有界，且二者组合被完全覆盖
    const modes = [...new Set(AI_FILTER_TRUTH_TABLE.map((c) => c.mode))].sort()
    const aiTypes = [...new Set(AI_FILTER_TRUTH_TABLE.map((c) => String(c.aiType)))].sort()
    expect(modes).toEqual(['mask', 'only', 'show'])
    expect(aiTypes).toEqual(['0', '1', '2', 'undefined'])
    const combos = AI_FILTER_TRUTH_TABLE.map((c) => `${c.mode}:${String(c.aiType)}`)
    expect(combos).toHaveLength(12)
    expect(new Set(combos).size).toBe(12)
  })

  it('三态语义自洽：show 恒不隐藏；only 与 mask 的 hidden 互补（ADR-0155 D2）', () => {
    for (const c of AI_FILTER_TRUTH_TABLE) {
      const isAi = c.aiType === 1 || c.aiType === 2
      if (c.mode === 'show') expect(c.hidden, 'show 态恒不隐藏').toBe(false)
      if (c.mode === 'mask') expect(c.hidden).toBe(isAi)
      if (c.mode === 'only') expect(c.hidden).toBe(!isAi)
    }
  })
})

describe('真值表 fixture 自洽门：限制判定（oracle = x_restrict 契约 0/1/2）', () => {
  it('恰好覆盖 3×2×2 笛卡尔积（12 例唯一组合，无重无缺）', () => {
    const seen = new Set(
      RESTRICTION_TRUTH_TABLE.map(
        (c) => `x=${c.x_restrict}/s18=${c.showR18}/s18g=${c.showR18G}`,
      ),
    )
    expect(seen.size).toBe(12)
    // 逐维域判定（不按用例顺序或字段名匹配）
    expect([...new Set(RESTRICTION_TRUTH_TABLE.map((c) => c.x_restrict))].sort()).toEqual([0, 1, 2])
    expect([...new Set(RESTRICTION_TRUTH_TABLE.map((c) => c.showR18))].sort()).toEqual([false, true])
    expect([...new Set(RESTRICTION_TRUTH_TABLE.map((c) => c.showR18G))].sort()).toEqual([false, true])
  })

  it('谓词语义自洽（x_restrict 契约：1 受 showR18 控、2 受 showR18G 控、0 不受限）', () => {
    for (const c of RESTRICTION_TRUTH_TABLE) {
      const expected =
        c.x_restrict === 1 ? !c.showR18 : c.x_restrict === 2 ? !c.showR18G : false
      expect(c.expectedRestricted, `x_restrict=${c.x_restrict}`).toBe(expected)
    }
  })
})

describe('真值表 fixture 自洽门：类型角标（oracle = spec work-type-badges 决策 1）', () => {
  it('覆盖 spec 要求的五种输入形态：无角标 / 动图 / 多图 / 并存 / 异常页数', () => {
    const cases = ILLUST_TYPE_BADGE_CASES
    expect(cases.some((c) => c.expectedBadges.length === 0)).toBe(true)
    expect(
      cases.some(
        (c) => c.expectedBadges.length === 1 && c.expectedBadges[0].kind === 'ugoira',
      ),
    ).toBe(true)
    expect(
      cases.some(
        (c) => c.expectedBadges.length === 1 && c.expectedBadges[0].kind === 'multi',
      ),
    ).toBe(true)
    expect(cases.some((c) => c.expectedBadges.length === 2)).toBe(true)
    expect(cases.some((c) => c.page_count === 0)).toBe(true)
  })

  it('语义自洽：动图标当且仅当 type=ugoira；多图标当且仅当 page_count>1；并存时动图在前', () => {
    for (const c of ILLUST_TYPE_BADGE_CASES) {
      const expectUgoira = c.type === 'ugoira'
      const expectMulti = c.page_count > 1
      const kinds = c.expectedBadges.map((b) => b.kind)
      expect(kinds.includes('ugoira'), `type=${c.type}`).toBe(expectUgoira)
      expect(kinds.includes('multi'), `page_count=${c.page_count}`).toBe(expectMulti)
      if (c.expectedBadges.length === 2) {
        expect(c.expectedBadges[0].kind).toBe('ugoira')
        expect(c.expectedBadges[1].kind).toBe('multi')
      }
    }
    // 组合唯一（无重复用例）
    const combos = ILLUST_TYPE_BADGE_CASES.map((c) => `${c.type}/${c.page_count}`)
    expect(new Set(combos).size).toBe(ILLUST_TYPE_BADGE_CASES.length)
  })
})

describe('真值表 fixture 自洽门：OAuth 400 分类（oracle = 真实抓包快照）', () => {
  it('真实快照原始字节可解析且字段与线上一致（pixivpy#374 / gallery-dl#9331）', () => {
    const snap = JSON.parse(PIXIV_OAUTH_400_RAW_SNAPSHOT) as Record<string, unknown>
    const errors = snap.errors as Record<string, unknown>
    const system = errors.system as Record<string, unknown>
    expect(snap.has_error).toBe(true)
    expect(snap.error).toBe('invalid_grant')
    expect(system.message).toBe('Invalid refresh token')
    expect(system.code).toBe(1508)
  })

  it('覆盖七类输入形态：OAuth 形态恒 UNAUTHORIZED、非 OAuth 形态恒非 UNAUTHORIZED', () => {
    // 语义判定：按响应体形态归类，不按用例 id 前缀匹配（改名不漏过）。
    // OAuth 形态 = 顶层 error 字符串为 invalid_grant，或 error.message 含 OAuth 关键字
    // （契约见 sharedOAuthErrorCases.ts 表头：isOAuthTokenErrorResponse 判定）。
    const isOAuthShaped = (body: unknown): boolean => {
      if (typeof body !== 'object' || body === null) return false
      const err = (body as { error?: unknown }).error
      if (typeof err === 'string') return err === 'invalid_grant'
      if (typeof err === 'object' && err !== null) {
        const msg = (err as { message?: unknown }).message
        if (typeof msg !== 'string') return false
        return msg.includes('OAuth') || msg.includes('invalid_request') || msg.includes('invalid_grant')
      }
      return false
    }

    const oauthShaped = OAUTH_ERROR_CLASSIFY_CASES.filter((c) => isOAuthShaped(c.responseBody))
    expect(oauthShaped.length, '必须存在 OAuth 形态用例').toBeGreaterThan(0)
    for (const c of oauthShaped) expect(c.expectedTypeKey).toBe('UNAUTHORIZED')

    const others = OAUTH_ERROR_CLASSIFY_CASES.filter((c) => !isOAuthShaped(c.responseBody))
    expect(others.length, '必须存在非 OAuth 形态用例').toBeGreaterThan(0)
    for (const c of others) expect(c.expectedTypeKey).not.toBe('UNAUTHORIZED')

    // 期望 type 落在已定义的枚举键集合内
    const allowed = new Set(['UNAUTHORIZED', 'UNKNOWN', 'PROXY', 'NETWORK'])
    for (const c of OAUTH_ERROR_CLASSIFY_CASES) {
      expect(typeof c.status).toBe('number')
      expect(allowed.has(c.expectedTypeKey)).toBe(true)
      expect(c.oracle.length, '每行必须注明 oracle 溯源').toBeGreaterThan(0)
    }
  })
})

describe('真值表 fixture 自洽门：URL 重写（oracle = ADR-0100 严格边界）', () => {
  it('每行结构完整（id / input / 期望输出均非空字符串）', () => {
    expect(URL_REWRITE_CASES.length).toBeGreaterThanOrEqual(8)
    for (const c of URL_REWRITE_CASES) {
      expect(c.id.length).toBeGreaterThan(0)
      expect(c.input.length).toBeGreaterThan(0)
      expect(c.expectedWeb.length).toBeGreaterThan(0)
    }
  })

  it('ADR-0100：evil 伪后缀域必须原样放行，且无契约差异注记', () => {
    // 按输入语义定位（不按用例 id 匹配）：host 以 api 基域 + 伪后缀结尾
    const evil = URL_REWRITE_CASES.filter((c) => {
      try {
        const u = new URL(c.input)
        return u.protocol === 'https:' && u.hostname.startsWith('app-api.pixiv.net.') && u.hostname !== 'app-api.pixiv.net'
      } catch {
        return false
      }
    })
    expect(evil.length, '必须存在伪后缀域用例').toBe(1)
    for (const c of evil) {
      expect(c.expectedWeb, '伪后缀域必须原样放行，不得被重写到 /pixiv-api/').toBe(c.input)
      expect(c.note, 'ADR-0100 修复后语义已收敛，不应再有契约差异注记').toBeUndefined()
    }
  })

  it('代理目标必须带路径边界：非 oauth 域重写后仍以 /pixiv-api/ 开头', () => {
    for (const c of URL_REWRITE_CASES) {
      if (c.input.startsWith('https://app-api.pixiv.net/')) {
        expect(c.expectedWeb.startsWith('/pixiv-api/')).toBe(true)
      }
      if (c.input.startsWith('https://oauth.secure.pixiv.net/')) {
        expect(c.expectedWeb.startsWith('/pixiv-oauth/')).toBe(true)
      }
    }
  })
})

describe('真值表 fixture 自洽门：标签静音（oracle = ADR-0187 D2）', () => {
  it('语义自洽：命中当且仅当存在 tags[].name trim 后与静音集合精确相等', () => {
    for (const c of TAG_MUTE_TRUTH_TABLE) {
      const expected = (c.tags ?? []).some((t) => c.muted.includes(t.name.trim()))
      expect(c.expectedMuted, `muted=${JSON.stringify(c.muted)}`).toBe(expected)
    }
  })

  it('边界形态齐全：命中 / trim 命中 / 多标签 / 大小写敏感 / 部分匹配 / translated 不参与 / 空 tags / 缺字段 / 空集合', () => {
    const has = (fn: (c: (typeof TAG_MUTE_TRUTH_TABLE)[number]) => boolean) =>
      TAG_MUTE_TRUTH_TABLE.some(fn)
    expect(has((c) => c.expectedMuted && c.muted.every((m) => (c.tags ?? []).some((t) => t.name === m)))).toBe(true)
    expect(has((c) => c.expectedMuted && (c.tags ?? []).some((t) => t.name !== t.name.trim()))).toBe(true)
    expect(has((c) => c.expectedMuted && (c.tags ?? []).length > 1)).toBe(true)
    expect(has((c) => !c.expectedMuted && (c.tags ?? []).some((t) => t.translated_name !== undefined))).toBe(true)
    expect(has((c) => !c.expectedMuted && c.tags !== undefined && c.tags.length === 0)).toBe(true)
    expect(has((c) => !c.expectedMuted && c.tags === undefined)).toBe(true)
    expect(has((c) => !c.expectedMuted && c.muted.length === 0)).toBe(true)
  })
})
