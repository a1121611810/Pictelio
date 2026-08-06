// resolveSkeletonStyle 单测（issue #138 图片骨架屏修复 prefactor）
import { describe, expect, it } from 'vitest'
import { resolveSkeletonStyle } from './skeletonStyle'

describe('resolveSkeletonStyle', () => {
  it('height 有值 → 优先返回 { height }，忽略 aspectRatio / minH', () => {
    expect(resolveSkeletonStyle('48.4vw', '1 / 1', '40vw')).toEqual({ height: '48.4vw' })
  })

  it('height 为空字符串 → 走 fallback 分支（空字符串视为无值）', () => {
    expect(resolveSkeletonStyle('', '1 / 1', '40vw')).toEqual({
      aspectRatio: '1 / 1',
      minHeight: '40vw',
    })
  })

  it('height 为 undefined → fallback 返回 { aspectRatio, minHeight }', () => {
    expect(resolveSkeletonStyle(undefined, '3 / 2', '20vw')).toEqual({
      aspectRatio: '3 / 2',
      minHeight: '20vw',
    })
  })

  it('fallback 时 aspectRatio 缺失 → 结果不含 aspectRatio 键', () => {
    expect(resolveSkeletonStyle(undefined, undefined, '40vw')).toEqual({ minHeight: '40vw' })
  })

  it('fallback 时 minH 缺失 → 结果不含 minHeight 键', () => {
    expect(resolveSkeletonStyle(undefined, '1 / 1', undefined)).toEqual({ aspectRatio: '1 / 1' })
  })

  it('全部参数为空 → 返回空对象', () => {
    expect(resolveSkeletonStyle(undefined, undefined, undefined)).toEqual({})
  })

  it('fallback 时空字符串的 aspectRatio / minH 同样被过滤', () => {
    expect(resolveSkeletonStyle(undefined, '', '')).toEqual({})
  })
})
