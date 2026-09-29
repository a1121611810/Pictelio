// AI 三态设置键与取值域：**Lynx 单端行为基准**（ADR-0203 决策 5 迁移件）。
//
// 形态说明：合并迁移自 `app/tests/unit/differential/` 的
// `aiBadgeGuardConsistency` 与 `aiFilterKeyConsistency`——两者断言的都是
// 「WebView settingsStore/aiFilter ↔ Lynx settingsStore」。对侧删除后改为单端基准。
//
// oracle 溯源（禁自洽反推）：
//   - 账号级键 `ai_filter_mode_${uid}` 与三态取值 `show | mask | only`、默认 `show`
//     = ADR-0155 D2
//   - 键必须带 uid 后缀（跨账号隔离）= ADR-0103 账号级设置契约
//   - 三态的判定语义（show 永不处理 / mask 遮罩 / only 移除）= ADR-0155 D2 表
//
// 匹配纪律：键按「模板串」提取，不锁死 `aiFilterModeKey` 这个函数名；
// 三态取值按集合提取，改名/增删任一态都红。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repoRoot = resolve(pkgRoot, '..')

const ADR = readFileSync(
  resolve(repoRoot, 'docs/adr/ADR-0155-ai-artwork-three-state-filter.md'),
  'utf-8',
)
const LYNX_STORE = readFileSync(resolve(pkgRoot, 'app-lynx/src/stores/settingsStore.ts'), 'utf-8')

describe('AI 三态设置：Lynx 单端行为基准（ADR-0155 D2）', () => {
  it('键为账号级：必须带 uid 后缀（ADR-0103 跨账号隔离契约）', () => {
    // 语义提取：找出构造 ai_filter_mode 键的模板串，要求其含 uid 占位
    const keyTemplate = LYNX_STORE.match(/`ai_filter_mode_\$\{[^}]+\}`/)?.[0]
    expect(keyTemplate, '必须存在带 uid 后缀的 ai_filter_mode 键模板').toBeTruthy()
    // ADR 侧出处（不是从实现反推的巧合）
    expect(ADR).toContain('ai_filter_mode_${uid}')
  })

  it('三态取值 = ADR-0155 D2 的 show | mask | only（集合比对）', () => {
    expect(ADR).toMatch(/`?show\s*\|\s*mask\s*\|\s*only`?/)
    const typeDecl = LYNX_STORE.match(/type\s+AiFilterMode\s*=\s*([^;\n]+)/)?.[1]
    expect(typeDecl, 'AiFilterMode 必须声明（抽取器下界自检）').toBeTruthy()
    const modes = [...(typeDecl ?? '').matchAll(/["']([a-z]+)["']/g)].map((m) => m[1])
    expect(new Set(modes)).toEqual(new Set(['show', 'mask', 'only']))
  })

  it('默认态 = show（语义提取 ref 初值，不锁死书写形态）', () => {
    const initial = LYNX_STORE.match(
      /const\s+_aiFilterMode\s*=\s*ref(?:<[^>]*>)?\(\s*["']([a-z]+)["']/,
    )?.[1]
    expect(initial, 'AI 过滤模式初值必须存在（抽取器下界自检）').toBe('show')
  })

  it('三态语义落地：mask 走遮罩谓词、only 走仅看谓词、统一谓词覆盖两态', () => {
    // ADR-0155 D2：mask = 过滤隐藏 AI 作品；only = 完全移除非 AI 作品
    const aiWork = LYNX_STORE.match(/isAiRestricted[\s\S]{0,120}/)?.[0] ?? ''
    expect(aiWork).toMatch(/=== "mask"/)
    const only = LYNX_STORE.match(/isAiOnlyFiltered[\s\S]{0,120}/)?.[0] ?? ''
    expect(only).toMatch(/=== "only"/)
    // 统一过滤谓词：show 态恒不隐藏
    const shouldHide = LYNX_STORE.match(/shouldHideByAi[\s\S]{0,200}/)?.[0] ?? ''
    expect(shouldHide).toMatch(/===\s*"mask"\s*\?/)
  })

  it('未登录 / 账号不匹配时回落默认 show（不得把上一账号的偏好带入）', () => {
    // 载入路径的每个失败分支都必须显式回到 "show"，禁止保留上一个 uid 的值
    const load = LYNX_STORE.match(/const rawAi = await storage\.get\(([\s\S]{0,320})/)?.[1] ?? ''
    expect(load, '必须存在账号级 AI 偏好载入路径（抽取器下界自检）').not.toBe('')
    const fallbacks = [...load.matchAll(/_aiFilterMode\.value\s*=\s*"([a-z]+)"/g)].map((m) => m[1])
    expect(fallbacks.length).toBeGreaterThan(0)
    for (const v of fallbacks) expect(v).toBe('show')
  })

  it('账号级键进备份域（ADR-0103：切换设备后 AI 偏好随备份恢复）', () => {
    // backupCore 的账号级前缀必须含 ai_filter_mode_
    const CORE = readFileSync(resolve(pkgRoot, 'app-lynx/src/utils/backupCore.ts'), 'utf-8')
    expect(CORE).toContain('"ai_filter_mode_"')
  })
})
