// GlassCard.vue queryRect 的 SelectorQuery 链式契约守卫（ADR-0149 平台约束）。
// 期望值出处（Oracle 溯源）：ADR-0149 spike 双端实测——SelectorQuery 是队列式的，
// exec() 必须挂在 select().invoke() 的返回值（携带 task 的新 query）上；
// 对原始 query 调 exec() 执行的是空队列、success 永不回调（该 bug 在 web-core 实测复现，
// 表现为 /me 账户卡「液态弹性」触摸反馈静默失效）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./GlassCard.vue', import.meta.url)), 'utf8')
/** 去注释后的代码本文（负向断言的对象；约束说明本身会提到坏写法） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('GlassCard.vue queryRect 链式 exec 契约（ADR-0149）', () => {
  it('exec 挂在 invoke 的返回值上', () => {
    expect(code).toContain('const query = q.select(')
    expect(code).toContain('query.exec()')
  })

  it('禁止对原始 query 调 exec（空队列 → 回调永不触发）', () => {
    expect(code).not.toMatch(/^\s*q\.exec\(\)/m)
  })
})
