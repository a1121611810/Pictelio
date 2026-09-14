// ─── router benchNav 源级守卫（#542）───
// 原生→JS 的路由钩子无 node 可测面（GlobalEventEmitter 仅原生态存在），
// 沿用仓库「模板/源码断言」约定锚定不该被静默改掉的形状。
// oracle：事件名 = LynxActivity.java switch case（Java 侧同名字符串）；
// 缺载荷 warn = 仓库禁静默降级硬约束；数值门槛 = lynx 4.0.1 载荷仅数值存活。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./router.ts', import.meta.url)), 'utf8')

describe('benchNav 详情页直达（#542）', () => {
  it('事件名 pictelioBenchNavIllustDetail 有监听且载荷缺 id 时显式 warn（非静默）', () => {
    expect(src).toContain("addListener('pictelioBenchNavIllustDetail'")
    expect(src).toContain('载荷缺 illust_id')
    // 数值校验门槛（typeof number + isFinite + >0）
    expect(src).toContain("typeof id === 'number'")
  })
})
