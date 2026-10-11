import { describe, it, expect } from 'vitest'
import {
  formatBytes,
  hitRatePercent,
  parseClearResult,
  parseStats,
} from '../primitives/imageCache'

// 图片缓存展示口径（#984）——纯 node 单测，不碰 NativeModules / Pinia / i18n。
//
// 【oracle 溯源（测试硬约束 #6）】期望值全部来自独立来源：
//   · 字节换算的期望值取自**字节定义本身**（1024 = 1KB、1024×1024 = 1MB），
//     不是从被测实现的输出反推；
//   · 「分母为 0 ⇒ 无样本」的期望来自**票面写死的口径**，不是实现行为；
//   · JSON 样本按原生 PictelioImageCacheModule 的字段名逐字书写（跨端契约），
//     字段名写错会被 parseStats 判为 null 而失败——这正是契约测试想要的。

/** 原生 getStats 的成功载荷（字段名与 Java 侧 JSONObject 逐字一致） */
function statsJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    requests: 3,
    hits: 2,
    hitRate: 2 / 3,
    diskBytes: 1024 * 1024,
    diskEntries: 12,
    memoryBytes: 4096,
    memoryEntries: 2,
    available: true,
    ...overrides,
  })
}

describe('parseStats', () => {
  it('解析原生载荷为强类型快照', () => {
    const stats = parseStats(statsJson())
    expect(stats).not.toBeNull()
    expect(stats?.requests).toBe(3)
    expect(stats?.hits).toBe(2)
    expect(stats?.diskEntries).toBe(12)
    expect(stats?.available).toBe(true)
  })

  it('available=false（原生未初始化）原样透出，供界面显示「不可用」而非 0%', () => {
    const stats = parseStats(statsJson({ available: false }))
    expect(stats?.available).toBe(false)
    // 读数字段仍在（原生确实返回了它们），但界面据 available=false 显示「不可用」
    expect(stats?.diskBytes).toBe(1024 * 1024)
  })

  it('缺字段返回 null（不静默捏造读数）', () => {
    expect(parseStats(JSON.stringify({ requests: 3 }))).toBeNull()
  })

  it('字段类型不对返回 null', () => {
    expect(parseStats(statsJson({ diskBytes: 'lots' }))).toBeNull()
    expect(parseStats(statsJson({ hitRate: Number.NaN }))).toBeNull()
  })

  it('坏 JSON 返回 null', () => {
    expect(parseStats('{not json')).toBeNull()
    expect(parseStats('')).toBeNull()
  })

  it('非对象 JSON 返回 null', () => {
    expect(parseStats('42')).toBeNull()
    expect(parseStats('null')).toBeNull()
  })
})

describe('parseClearResult', () => {
  it('解析成功载荷', () => {
    const r = parseClearResult(JSON.stringify({ freedBytes: 2048, deletedEntries: 5, failed: false }))
    expect(r).toEqual({ freedBytes: 2048, deletedEntries: 5, failed: false })
  })

  it('部分失败必须透出 failed=true（界面据此告知用户，不得当作全成功）', () => {
    const r = parseClearResult(JSON.stringify({ freedBytes: 1024, deletedEntries: 3, failed: true }))
    expect(r?.failed).toBe(true)
  })

  it('坏载荷返回 null（调用方须显示失败）', () => {
    expect(parseClearResult('{oops')).toBeNull()
    expect(parseClearResult(JSON.stringify({ freedBytes: 1024 }))).toBeNull()
  })
})

describe('formatBytes', () => {
  // 期望值取自字节定义：1024B = 1KB，1024×1024B = 1MB
  it('小于 1KB 按字节显示', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
  })

  it('1KB 到 1MB 之间按 KB 显示（一位小数）', () => {
    expect(formatBytes(1024)).toBe('1.0 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
  })

  it('1MB 及以上按 MB 显示（一位小数）', () => {
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB')
    expect(formatBytes(1024 * 1024 * 2.5)).toBe('2.5 MB')
  })

  it('负数与非数一律按 0 显示，不显示 -1 B / NaN', () => {
    expect(formatBytes(-1)).toBe('0 B')
    expect(formatBytes(Number.NaN)).toBe('0 B')
  })
})

describe('hitRatePercent', () => {
  // 口径：分母为 0 是「无样本」，不是 0%——与 primitives/usageMetrics 同一纪律
  it('分母为 0 返回 null（界面据此显示「暂无数据」，不谎报 0%）', () => {
    expect(hitRatePercent(0, 0)).toBeNull()
  })

  it('有样本时返回百分比数值', () => {
    // 期望值 = 2/3 命中率 × 100（口径本身算出的精确值，非实现反推）
    expect(hitRatePercent(2 / 3, 3)).toBeCloseTo((2 / 3) * 100, 9)
    expect(hitRatePercent(1, 1)).toBe(100)
    expect(hitRatePercent(0, 5)).toBe(0)
  })

  it('命中率恒落在 0–100%：非数与越界输入不产生 >100% 的显示值', () => {
    expect(hitRatePercent(Number.NaN, 3)).toBeNull()
    expect(hitRatePercent(0.5, Number.NaN)).toBeNull()
    expect(hitRatePercent(0.5, -1)).toBeNull()
  })
})