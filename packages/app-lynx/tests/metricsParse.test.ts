// ─── Python 度量 ↔ JS 判定的**接缝**门禁（parseMetricsOutput）───
//
// ## 这道门禁为什么存在
//
// 首版把解析内联在 `verify-top-inset.mjs` 里，三个测试文件分别验 Python 输出、
// 验分类器、验脚本行为，**没有一条把两者接起来**。于是接缝整段零覆盖，而它恰好
// 有一个不会被任何一侧发现的错（code-review 第 6 轮 Spec 轴实测抓出）：
//
//   python 输出契约：`OK <center> <start> <end> <peak> <median_unif> <cross_agree>`
//   首版 JS 解析  ：`p[1] / p[2]` 当成两个度量
//   ⇒ 取到的是 **center(167.5) 与 start(139)** —— 都远大于阈值
//   ⇒ 「平色 surface」两道闸门被**无条件旁路** ⇒ 渐变封面在脚本路径上照样放行
//   ⇒ 而当时全量 **3568 条测试全绿**。
//
// `NONE` / `BG` 两行只有 3 个字段，`p[1]/p[2]` 当时**恰好是对的** ——
// 唯独 `OK` 错，而 `OK` 是唯一进入分类器的分支。
// ⇒ 「三个测试文件都绿」与「接缝是断的」完全同形，这正是门禁冻结线 #1 说的那种空转。
//
// 期望值来源：**本机 python 的真实输出**（逐 kind 实跑，见下方 `REAL_OUTPUT`），
// 不是手写的理想串 —— 手写理想串会与契约一起漂移，那就验不到接缝了。
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMetricsOutput } from '../scripts/topInsetVerdict.mjs'
import {
  Canvas,
  encodePng,
  W,
  H,
  type RGB,
} from './helpers/rasterCanvas'

const METRICS = fileURLToPath(new URL('../scripts/top_inset_metrics.py', import.meta.url))
const INSET = 72
const BAR = (17.067 / 100) * W
const LO = INSET + 10
const HI = Math.round(INSET + BAR - 10)
const SURFACE: RGB = [248, 250, 255]

/** 合成一张图并**实跑** python，返回它的原始 stdout。 */
function runMetrics(shade: (x: number, y: number) => RGB): string {
  const c = new Canvas([255, 255, 255])
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c.set(x, y, shade(x, y))
  const dir = mkdtempSync(join(tmpdir(), 'metrics-parse-'))
  const file = join(dir, 'a.png')
  writeFileSync(file, encodePng(c.px))
  try {
    return execFileSync('python3', [METRICS, file, String(LO), String(HI)], {
      encoding: 'utf8',
    }).trim()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('parseMetricsOutput ↔ python 实跑输出', () => {
  it('OK 行：两个度量取自**末尾**两字段，不是前两个', () => {
    // 平色顶栏 + 标题带（合成）⇒ python 走 OK 分支
    const raw = runMetrics((x, y) => {
      if (y < LO || y >= HI) return [255, 255, 255]
      // ⚠️ 文字带必须**横向稀疏**：python 的采样窗是 x ∈ [0.15W, 0.85W]，
      // 行内暗占比 > 0.6 会被判成「连续背景」（BG 分支）而不是文字。
      // 首版把暗块画成通栏 ⇒ 拿到 BG，测试自己就走了另一条分支却还以为是 OK。
      if (y >= 139 && y <= 196 && x >= 162 && x <= 520) return [40, 40, 40]
      return SURFACE
    })
    expect(raw.startsWith('OK'), `期望 OK 分支，实得：${raw}`).toBe(true)

    const r = parseMetricsOutput(raw)
    expect(r.kind).toBe('ok')
    if (r.kind !== 'ok') return
    // 几何字段
    expect(r.center).toBeCloseTo(167.5, 1)
    expect(r.start).toBe(139)
    expect(r.end).toBe(196)
    // ⚠️ 真正的度量：平色 surface ⇒ 两者都应接近 1.000。
    //    首版在这里拿到的是 center(167.5)/start(139) —— 远大于阈值 ⇒ 闸门恒真放行。
    expect(r.medianUniformity).toBeCloseTo(1.0, 2)
    expect(r.crossRowAgreement).toBeCloseTo(1.0, 2)
  })

  it('度量必须落在 [0,1]（越界即解析错位）', () => {
    // 这条把「字段序」从约定变成**不变量**：center/start 是像素坐标，可以是 167，
    // 但比率度量不可能 >1。首版在 OK 分支上这一条当场就会红。
    for (const raw of [
      runMetrics((_x, y) => (y < LO || y >= HI ? [255, 255, 255] : SURFACE)),
      runMetrics((x, y) => {
        if (y < LO || y >= HI) return [255, 255, 255]
        if (y >= 139 && y <= 196 && x >= 162 && x <= 520) return [40, 40, 40]
        return SURFACE
      }),
    ]) {
      const r = parseMetricsOutput(raw)
      expect(r.medianUniformity, `medianUniformity 越界：${raw}`).toBeLessThanOrEqual(1)
      expect(r.crossRowAgreement, `crossRowAgreement 越界：${raw}`).toBeLessThanOrEqual(1)
      expect(r.medianUniformity).toBeGreaterThanOrEqual(0)
      expect(r.crossRowAgreement).toBeGreaterThanOrEqual(0)
    }
  })

  it('NONE / BG 分支：字段序与 OK 不同，各 3 字段', () => {
    const noise = runMetrics((x, y) => {
      if (y < LO || y >= HI) return [255, 255, 255]
      return [((y * 37) % 256) as number, ((y * 91) % 256) as number, ((y * 53) % 256) as number]
    })
    // 连续暗背景 ⇒ BG；无稀疏文字 ⇒ NONE。两者都不是 OK。
    for (const raw of [noise]) {
      expect(['BG', 'NONE']).toContain(raw.split(/\s+/)[0])
      const r = parseMetricsOutput(raw)
      expect(['none', 'background']).toContain(r.kind)
      if (r.kind !== 'ok') {
        expect(r.medianUniformity).toBeLessThanOrEqual(1)
        expect(r.crossRowAgreement).toBeLessThanOrEqual(1)
      }
    }
  })

  it('不认识的输出显式判 malformed，不静默当成通过', () => {
    const r = parseMetricsOutput('GARBAGE 1 2 3')
    expect(r.kind).toBe('malformed')
  })

  it('**回归防线**：把 OK 分支的度量改回取 p[1]/p[2] ⇒ 本文件转红', () => {
    // 自证：这不是「对着实现写期望」，而是把首版那个真实缺陷重新种回去。
    // 若哪天真有人把字段序改错，前两条当场转红。
    const raw = 'OK 167.50 139 196 0.103 1.000 0.555'
    const wrong = (() => {
      const p = raw.split(/\s+/)
      return { medianUniformity: Number(p[1]), crossRowAgreement: Number(p[2]) }
    })()
    expect(wrong.medianUniformity).toBeGreaterThan(1) // 越界 = 错位
    expect(parseMetricsOutput(raw).medianUniformity).toBeLessThanOrEqual(1)
  })
})
