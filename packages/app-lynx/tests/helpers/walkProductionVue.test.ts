// ─── 共享目录遍历的扫描面（#1006）───
//
// 本文件验的是**扫描面本身**：哪些文件会被交给判据、哪些不会。
// 这是一份隐含的范围承诺——它一旦在两道门禁之间漂移，其中一道会静默扫到
// 另一道扫不到的文件，而两边的测试都不会响。因此单独下针，不寄生在任一
// 门禁的用例里。
//
// 期望值出处：策略四条由 #1006 票面逐字给出（非自证）。
// 「errorPrototype 排除」的事实依据是 AGENTS.md 把它登记为 MD3 规则的非约束对象。
import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { walkProductionVue } from './walkProductionVue'

/** 建一棵合成源码树，返回其根目录。 */
function makeTree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'walk-production-vue-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(root, rel)
    mkdirSync(join(abs, '..'), { recursive: true })
    writeFileSync(abs, content, 'utf-8')
  }
  return root
}

/** 遍历结果归一为「相对根目录的正斜杠路径」，断言时才读得出差异。 */
function keys(root: string): string[] {
  return [...walkProductionVue(root, '[testGate]')]
    .map((p) => p.slice(root.length + 1).split('\\').join('/'))
    .sort()
}

describe('共享目录遍历的扫描面', () => {
  it('只收生产 .vue：排 .ts、排测试文件、排 errorPrototype 原型页', () => {
    const root = makeTree({
      'pages/Real.vue': '<template><view /></template>',
      'pages/Fixture.ts': '// 含 .vue 内容但不是组件\n',
      'pages/Real.test.vue': '<template><view /></template>',
      'errorPrototype/ErrorPagePreview.vue': '<template><view /></template>',
      'components/Nested.vue': '<template><view /></template>',
    })

    expect(keys(root)).toEqual(['components/Nested.vue', 'pages/Real.vue'])
  })

  it('目录不可读时出声告警，不静默返回空集合', () => {
    // 路径不存在 → 与 readdirSync 抛错走同一条 catch 分支。
    // ⚠️ 必测这一条：「扫到 0 个文件」与「仓里真的没有」在输出上完全同形，
    //    静默降级会让门禁伪装成通过（本仓测试硬约束明令禁止静默降级）。
    const root = makeTree({ 'pages/Real.vue': '<template><view /></template>' })
    const warned: string[] = []
    const original = console.warn
    console.warn = (...args: unknown[]) => {
      warned.push(args.map(String).join(' '))
    }
    try {
      const missing = join(root, 'no-such-dir')
      expect([...walkProductionVue(missing, '[testGate]')]).toEqual([])
    } finally {
      console.warn = original
    }

    expect(warned, '目录不可读必须告警，不能默默返回空').toHaveLength(1)
    expect(warned[0]).toContain('[testGate]')
    expect(basename(warned[0]!)).toContain('no-such-dir')
  })
})