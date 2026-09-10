// oracle：ADR-0150 决策 1（三态优先级）+ packages/app-lynx/CONTEXT.md「页级首载骨架 / 首载落定」。
// 期望值来自决策规则本身（独立来源），不由实现反推。
import { describe, expect, it } from 'vitest'
import { deriveFirstLoadView, type FirstLoadViewInput } from './firstLoadView'

describe('deriveFirstLoadView（页级首载三态判定）', () => {
  const cases: {
    name: string
    input: FirstLoadViewInput
    expected: ReturnType<typeof deriveFirstLoadView>
  }[] = [
    {
      name: '有数据 → 内容（优先于加载中 / 错误 / 空态）',
      input: { hasItems: true, loading: true, settled: false, hasError: true },
      expected: 'content',
    },
    {
      name: '有数据 + 无加载 + 有错误 → 内容',
      input: { hasItems: true, loading: false, settled: true, hasError: true },
      expected: 'content',
    },
    {
      name: '加载中 → 骨架（优先于错误与空态）',
      input: { hasItems: false, loading: true, settled: true, hasError: true },
      expected: 'skeleton',
    },
    {
      name: '加载中且未落定 → 骨架',
      input: { hasItems: false, loading: true, settled: false, hasError: false },
      expected: 'skeleton',
    },
    {
      name: '未加载 + 有错误 → 错误',
      input: { hasItems: false, loading: false, settled: false, hasError: true },
      expected: 'error',
    },
    {
      name: '未加载 + 无错误 + 未落定 → 骨架（冷启动 / IFR 首帧）',
      input: { hasItems: false, loading: false, settled: false, hasError: false },
      expected: 'skeleton',
    },
    {
      name: '未加载 + 无错误 + 已落定 → 空态（真·无数据）',
      input: { hasItems: false, loading: false, settled: true, hasError: false },
      expected: 'empty',
    },
    {
      name: '未加载 + 已落定 + 有错误 → 错误（失败覆盖空态）',
      input: { hasItems: false, loading: false, settled: true, hasError: true },
      expected: 'error',
    },
    {
      name: '有数据 + 加载中 + 已落定 + 有错误 → 内容（全组合）',
      input: { hasItems: true, loading: true, settled: true, hasError: true },
      expected: 'content',
    },
    {
      name: '有数据 + 加载中 + 已落定 + 无错误 → 内容（全组合）',
      input: { hasItems: true, loading: true, settled: true, hasError: false },
      expected: 'content',
    },
    {
      name: '有数据 + 加载中 + 未落定 + 无错误 → 内容（全组合）',
      input: { hasItems: true, loading: true, settled: false, hasError: false },
      expected: 'content',
    },
    {
      name: '有数据 + 未加载 + 已落定 + 无错误 → 内容（全组合）',
      input: { hasItems: true, loading: false, settled: true, hasError: false },
      expected: 'content',
    },
    {
      name: '有数据 + 未加载 + 未落定 + 有错误 → 内容（全组合）',
      input: { hasItems: true, loading: false, settled: false, hasError: true },
      expected: 'content',
    },
    {
      name: '有数据 + 未加载 + 未落定 + 无错误 → 内容（全组合）',
      input: { hasItems: true, loading: false, settled: false, hasError: false },
      expected: 'content',
    },
    {
      name: '未加载数据 + 加载中 + 已落定 + 无错误 → 骨架（全组合）',
      input: { hasItems: false, loading: true, settled: true, hasError: false },
      expected: 'skeleton',
    },
    {
      name: '未加载数据 + 加载中 + 未落定 + 有错误 → 骨架（全组合）',
      input: { hasItems: false, loading: true, settled: false, hasError: true },
      expected: 'skeleton',
    },
  ]

  for (const c of cases) {
    it(c.name, () => {
      expect(deriveFirstLoadView(c.input)).toBe(c.expected)
    })
  }
})
