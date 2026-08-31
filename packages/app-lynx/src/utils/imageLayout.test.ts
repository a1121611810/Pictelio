// detailImageHeightVw 单测（spec：详情比例显示——正常比例 / 0 宽高 / NaN /
// 字段缺失 / 极端长图不封顶断言）
// pageHeightVw 单测（spec: app-lynx-detail-multi-image-list §2.3 / ADR-0129：
// 「load 后按比例修正」高度换算——oracle = detailImageHeightVw 同款换算（100×高/宽 vw）；
// 与占位函数的差异：load 尺寸非法时返回 null（调用方保持占位高度），而非回退默认值）
import { describe, expect, it } from 'vitest'
import { detailImageHeightVw, pageHeightVw } from './imageLayout'

describe('detailImageHeightVw（插画详情比例显示）', () => {
  it('正常比例：按 height / width 换算 vw', () => {
    expect(detailImageHeightVw(1000, 500)).toBe('50vw')
    expect(detailImageHeightVw(500, 1000)).toBe('200vw')
    expect(detailImageHeightVw(1200, 900)).toBe('75vw')
    expect(detailImageHeightVw(1920, 1080)).toBe('56.25vw')
  })

  it('0 / 负数 / 非有限值 → 回退默认 100vw', () => {
    expect(detailImageHeightVw(0, 500)).toBe('100vw')
    expect(detailImageHeightVw(1000, 0)).toBe('100vw')
    expect(detailImageHeightVw(-1000, 500)).toBe('100vw')
    expect(detailImageHeightVw(1000, -500)).toBe('100vw')
    expect(detailImageHeightVw(NaN, 500)).toBe('100vw')
    expect(detailImageHeightVw(1000, Infinity)).toBe('100vw')
    expect(detailImageHeightVw(1000, -Infinity)).toBe('100vw')
  })

  it('字段缺失（undefined / null）→ 回退默认 100vw', () => {
    expect(detailImageHeightVw(undefined, 500)).toBe('100vw')
    expect(detailImageHeightVw(1000, undefined)).toBe('100vw')
    expect(detailImageHeightVw(null, 500)).toBe('100vw')
    expect(detailImageHeightVw(1000, null)).toBe('100vw')
    expect(detailImageHeightVw(undefined, undefined)).toBe('100vw')
  })

  it('自定义 fallbackVw 生效', () => {
    expect(detailImageHeightVw(0, 0, 60)).toBe('60vw')
    expect(detailImageHeightVw(undefined, undefined, 120)).toBe('120vw')
  })

  it('极端长图不封顶（用户明确选择与 webview client 一致）', () => {
    expect(detailImageHeightVw(1000, 100_000)).toBe('10000vw')
    expect(detailImageHeightVw(1, 1000)).toBe('100000vw')
  })
})

describe('pageHeightVw（load 后按比例修正高度换算）', () => {
  it('正常比例：按 load 尺寸 height / width 换算 vw（与 detailImageHeightVw 同款公式）', () => {
    expect(pageHeightVw(1000, 500)).toBe('50vw')
    expect(pageHeightVw(500, 1000)).toBe('200vw')
    expect(pageHeightVw(1200, 900)).toBe('75vw')
    expect(pageHeightVw(1920, 1080)).toBe('56.25vw')
  })

  it('0 / 负数 / 非有限值 → null（修正不可用，调用方保持占位高度）', () => {
    expect(pageHeightVw(0, 500)).toBeNull()
    expect(pageHeightVw(1000, 0)).toBeNull()
    expect(pageHeightVw(-1000, 500)).toBeNull()
    expect(pageHeightVw(1000, -500)).toBeNull()
    expect(pageHeightVw(NaN, 500)).toBeNull()
    expect(pageHeightVw(1000, Infinity)).toBeNull()
    expect(pageHeightVw(1000, -Infinity)).toBeNull()
  })

  it('字段缺失（undefined / null）→ null', () => {
    expect(pageHeightVw(undefined, 500)).toBeNull()
    expect(pageHeightVw(1000, undefined)).toBeNull()
    expect(pageHeightVw(null, 500)).toBeNull()
    expect(pageHeightVw(1000, null)).toBeNull()
    expect(pageHeightVw(undefined, undefined)).toBeNull()
  })
})
