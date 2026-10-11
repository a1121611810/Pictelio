// i18n 插值参数守门（#988 真机走查产出）
//
// **防的具体回归**：2026-10-11 走查高级设置页时发现，「缓存条目」一行的**值**渲染成了
// 「缓存条目」四个字，条目数从未显示过。根因是标签与值共用同一个 key
// `advanced.cache.entries`，而该 key 的文案里**没有 `{{count}}` 占位符**
// ⇒ 值那侧 `t(key, { count })` 传进来的 count 被**静默丢弃**，不报错、不告警、门禁全绿。
//
// 这类缺陷是**结构性不可见**的：类型检查看不见、lint 看不见、单测看不见
// （zh/en 键清单一致 ⇒ 现有的双语同步守卫也放行），只有真机/浏览器渲染才暴露。
// 故本守卫从「模板传参」一侧反向核对「文案消费」：
//
//   对 AdvancedSettings.vue 里每一处 `t('key', { a, b })`，
//   断言 zh 文案同时含 `{{a}}` 与 `{{b}}`。
//
// **范围限定**：只覆盖 AdvancedSettings.vue。扩到全仓前须先跑一遍真实语料统计误报率——
// 有些调用点会传多余参数（模板共用变量、或参数名与占位符不完全同名），
// 全仓一刀切会立刻变红。这与「检查规则的命中率要先在真实语料上量」同源。
//
// oracle：i18n 字典自身的文案（zh-CN/pages.ts）；期望值「每个传入参数都必须被消费」
// 是模板与字典之间的契约，不是从实现反推。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import zhPages from '../../src/i18n/locales/zh-CN/pages'

const vueSrc = readFileSync(fileURLToPath(new URL('../../src/pages/AdvancedSettings.vue', import.meta.url)), 'utf8')

interface CallSite {
  key: string
  args: string[]
  index: number
}

/** 抽出 `t('key', { a, b })` 形式的调用点（单参与模板字符串形式不在本守卫范围内） */
function extractInterpolatedCalls(source: string): CallSite[] {
  const out: CallSite[] = []
  const re = /\bt\(\s*'([^']+)'\s*,\s*\{([^}]*)\}\s*\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(source)) !== null) {
    out.push({ key: m[1], args: extractArgNames(m[2]), index: m.index })
  }
  return out
}

/**
 * 取对象字面量里的**参数名**，两种形态：
 *   `{ count: x.length }` → `count`（只取键，值表达式里的标识符不是参数）
 *   `{ count }`          → `count`（简写）
 * 其余（嵌套对象 / 展开 / 非标识符键）一律跳过，不猜。
 *
 * ⚠️ 曾经的 bug：用 `/\b(\w+)\s*(?::|,|$)/g` 扫内容，`$` 会把**值表达式末尾**的标识符
 * 也算成参数（`{ count: a.length }` → 多出 `length`，`{ reason: payload }` → 多出
 * `payload`），于是三个真调用点全被误报。教训同「抽取器自身有效」：全称断言的可信度
 * 完全取决于抽取器，抽错了不是假绿而是**假红**，同样会让人不信任守卫。
 */
function extractArgNames(objBody: string): string[] {
  return objBody
    .split(',')
    .map((part) => part.match(/^\s*([A-Za-z_$][\w$]*)\s*:/) ?? part.match(/^\s*([A-Za-z_$][\w$]*)\s*$/))
    .filter((x): x is RegExpMatchArray => x !== null)
    .map((x) => x[1])
}

const calls = extractInterpolatedCalls(vueSrc)

describe('高级设置页 i18n 插值契约（#988）', () => {
  it('抽取器自身有效：至少抽到若干带参调用（防正则失效导致全称断言恒真）', () => {
    // ArchUnit failOnEmptyShould 教训：抽取器必须断言扫描面非空 + 命中数下界
    expect(calls.length, '未抽到任何 t(key, {…}) 调用——抽取器失效或模板改了写法').toBeGreaterThanOrEqual(3)
  })

  it('每个传入的插值参数都必须在 zh 文案里有对应占位符（防 count 被静默丢弃）', () => {
    const violations: string[] = []
    for (const call of calls) {
      const template = zhPages[call.key as keyof typeof zhPages]
      if (typeof template !== 'string') {
        violations.push(`${call.key}：字典里查不到该键`)
        continue
      }
      for (const arg of call.args) {
        if (!template.includes(`{{${arg}}}`)) {
          violations.push(`${call.key} 传入了 ${arg}，但文案「${template}」里没有 {{${arg}}} 占位符（参数被静默丢弃）`)
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([])
  })

  it('标签与值不得共用同一个 key（回归本体：条目数曾与标签共用 advanced.cache.entries）', () => {
    // 断言：作为「值」使用的 key 必须是独立的 *Value / *Count 形态，不能是标签 key
    const valueSideKeys = ['advanced.cache.entriesValue']
    for (const key of valueSideKeys) {
      expect(vueSrc, `${key} 应作为值侧 key 被使用`).toContain(`t('${key}'`)
    }
    // 反向：标签 key 不得带参调用（带参说明它其实是想当值用）
    expect(vueSrc).not.toMatch(/t\(\s*'advanced\.cache\.entries'\s*,\s*\{/)
  })
})