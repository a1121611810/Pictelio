// IllustList.vue 首载三态接线 源级防线（ADR-0150 / spec T1 #432）。
// 期望值出处（Oracle 溯源）：ADR-0150 决策 1/4（骨架 / 错误 / 空态 / 内容单链；
// 判定不依赖 loading 标志）+ docs/specs/app-lynx-page-level-first-load-skeleton.md:103（T1 验收）。
// 防线性质：源级守卫——防「改回 loading && 渲染流为空 的旧骨架条件 / 去掉 deriveFirstLoadView 消费」回归。
// 语义级匹配（不锁局部变量名，review F2）；行为正确性由 web-core + 模拟器 / 真机闭环（spec T5）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./IllustList.vue', import.meta.url)), 'utf8')
/** 去注释后的代码本文（负向断言对象；说明本身会提到旧写法——含 HTML / 块 / 行注释） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
/** 模板条件行：v-if / v-else-if */
const conditionLines = code.split('\n').filter((l) => /v-(if|else-if)=/.test(l))

describe('IllustList.vue 首载三态接线（ADR-0150 / T1 #432）', () => {
  it('消费 deriveFirstLoadView 作为唯一三态判定源', () => {
    expect(code).toContain("import { deriveFirstLoadView } from '../utils/firstLoadView'")
    expect(code).toContain('deriveFirstLoadView({')
  })

  it('骨架不再依赖 loading 标志（禁止任何条件同时门控 loading 与渲染流为空）', () => {
    expect(conditionLines.filter((l) => l.includes('loading') && l.includes('illusts.length'))).toEqual([])
  })

  it('三态为互斥单链（skeleton / error / empty 依次 v-if / v-else-if，不锁变量名）', () => {
    expect(code).toMatch(/v-if="[^"]*'skeleton'/)
    expect(code).toMatch(/v-else-if="[^"]*'error'/)
    expect(code).toMatch(/v-else-if="[^"]*'empty'/)
  })
})
