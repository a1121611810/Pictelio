// ─── 搜索窗度量的判别力门禁（scripts/top_inset_metrics.py）───
//
// ## 为什么要有这个文件
//
// `verify-top-inset.mjs` 的窗内度量原先内嵌在 JS 字符串里的 python 中，
// 唯一验证路径是「连着真机跑一遍看输出对不对」。而**「它现在是对的」与
// 「它对所有输入都对」完全同形** —— 真机回归永远抓不到只在别的输入上发作的缺陷。
//
// 第一次就被抓到了：`median_unif`（逐行**横向**众数占比的中位数）对
// **平滑纵向渐变封面**恒为 1.000 —— 天空那种渐变每一行横向本就近乎同色。
// 于是渐变封面（Pixiv 推荐流里很常见）会**通过**「有没有平色顶栏」的前置条件，
// 接着在窗内把角色身上的深色像素当成标题，给出一个自信的 `fail`：
// 「页面自让位但让位没生效」。这正是那个前置条件要消灭的那句话。
//
// ## 为什么现画 fixture，不提交 PNG
//
// 沿用 `tests/findUiBand.test.ts` 的理由：提交的二进制 fixture 会陈旧 ——
// 改了阈值或几何，PNG 还在，断言已经对不上，门禁要么红得莫名其妙、
// 要么（更糟）有人把期望值改成「当前输出」那就彻底失去意义。
// 现画则每次运行都从**同一份几何定义**重新生成，期望值与几何写在同一处。
import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyTopInsetVerdict,
  MIN_FLAT_SURFACE_UNIFORMITY,
  MIN_CROSS_ROW_AGREEMENT,
} from '../scripts/topInsetVerdict.mjs'

const METRICS = fileURLToPath(new URL('../scripts/top_inset_metrics.py', import.meta.url))

// ── 几何（与 verify-top-inset.mjs 同源：emulator-5554 / 1080×2160）──
const W = 1080
const H = 2160
const INSET = 72
const BAR = (17.067 / 100) * W // 184.32 物理 px
const LO = INSET + 10 // 82
const HI = Math.round(INSET + BAR - 10) // 246

/** 画一张 1080×2160 的测试图；`shade(x, y) -> (r,g,b)` 决定每个像素。 */
function draw(name: string, shade: (x: number, y: number) => [number, number, number]): string {
  // PNG 由内联 zlib 写出，避免为一个 fixture 引入图像库依赖。
  const raw = Buffer.alloc((W * 3 + 1) * H)
  let o = 0
  for (let y = 0; y < H; y++) {
    raw[o++] = 0 // filter: none
    for (let x = 0; x < W; x++) {
      const [r, g, b] = shade(x, y)
      raw[o++] = r
      raw[o++] = g
      raw[o++] = b
    }
  }
  const dir = mkdtempSync(join(tmpdir(), 'topinset-metrics-'))
  const file = join(dir, `${name}.png`)
  // ⚠️ 必须 Buffer.concat，**不能**用 `+` 拼：`Buffer + Buffer` 会先各自
  // toString() 再按 UTF-8 拼接 ⇒ 每一个 ≥0x80 的字节都变成 U+FFFD（ef bf bd）。
  // 症状是文件存在、大小接近，但 PIL 报 UnidentifiedImageError ——
  // 首版就这么写，排查绕了一圈才定位到「字节被 UTF-8 吃掉了」。
  writeFileSync(
    file,
    Buffer.concat([
      PNG_SIG,
      pngChunk('IHDR', ihdr(W, H)),
      pngChunk('IDAT', zlibStore(raw)),
      pngChunk('IEND', Buffer.alloc(0)),
    ]),
  )
  return file
}

type Case = { file: string; median_unif: number; cross_agree: number }

// ── 极简 PNG 编码（只用到 filter:none 的真彩图）──
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
function ihdr(w: number, h: number): Buffer {
  const b = Buffer.alloc(13)
  b.writeUInt32BE(w, 0)
  b.writeUInt32BE(h, 4)
  b[8] = 8 // bit depth
  b[9] = 2 // color type: truecolor
  return b
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length, 0)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td) >>> 0, 0)
  return Buffer.concat([len, td, crc])
}
let CRC_TABLE: number[] | null = null
function crc32(buf: Buffer): number {
  if (!CRC_TABLE) {
    CRC_TABLE = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function zlibStore(raw: Buffer): Buffer {
  return execFileSync('python3', [
    '-c',
    'import sys,zlib;sys.stdout.buffer.write(zlib.compress(sys.stdin.buffer.read(),9))',
  ], { input: raw, maxBuffer: 1 << 28 })
}

function measure(file: string): Case {
  const out = execFileSync('python3', [METRICS, file, String(LO), String(HI)], {
    encoding: 'utf8',
  }).trim()
  const p = out.split(' ')
  return { file, median_unif: Number(p[p.length - 2]), cross_agree: Number(p[p.length - 1]) }
}

// ── 五个样本类别（几何与期望写在同一处，不可能对不上）──
const SURFACE: [number, number, number] = [248, 250, 255] // M3 light surface

const flatTopBar = () =>
  draw('flat-topbar', (_x, y) => (y >= LO && y < HI ? SURFACE : [255, 255, 255]))

const noise = () => {
  let s = 12345
  return draw('noise', () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return [(s >> 16) & 255, (s >> 8) & 255, s & 255]
  })
}

// 天空式**纵向**渐变：每行横向同色、逐行变色 —— median_unif 饱和而 cross_agree 低
const verticalGradient = () =>
  draw('vgradient', (_x, y) => {
    const v = 120 + Math.floor((100 * y) / H)
    return [v, 180, 255 - Math.floor(v / 3)]
  })

// 整屏浅纯色：与浅色顶栏在颜色统计上同形（已知残留失效面）
const flatFullscreen = () => draw('flat-fullscreen', () => [252, 248, 240])

// bleed 首页形态：窗内是高细节封面
const detailedCover = () => {
  let s = 999
  return draw('cover', (x, y) => {
    s = (s * 1103515245 + 12345) & 0x7fffffff
    return [200 + ((s >> 20) & 55), 180 + ((s >> 12) & 70), 220 + ((s >> 4) & 35)]
  })
}

const CASES: Array<[string, string, 'pass' | 'reject']> = [
  ['平色顶栏（应有顶栏）', 'flat', 'pass'],
  ['高细节封面（bleed 首页形态）', 'cover', 'reject'],
  ['平滑纵向渐变封面', 'vgradient', 'reject'],
  ['随机噪声图', 'noise', 'reject'],
]

const FILES: Record<string, string> = {
  flat: flatTopBar(),
  cover: detailedCover(),
  vgradient: verticalGradient(),
  flatfull: flatFullscreen(),
  noise: noise(),
}

describe('搜索窗度量必须把「有顶栏」与各类无顶栏样本分开', () => {
  it('度量脚本可执行，且五个样本都跑得出数（防空转）', () => {
    for (const [label, key] of CASES) {
      const m = measure(FILES[key]!)
      expect(Number.isFinite(m.median_unif), `${label} 的 median_unif 不是有限数`).toBe(true)
      expect(Number.isFinite(m.cross_agree), `${label} 的 cross_agree 不是有限数`).toBe(true)
    }
  })

  it('平色顶栏两项都远高于阈值（正向对照）', () => {
    const m = measure(FILES.flat!)
    expect(m.median_unif).toBeGreaterThanOrEqual(MIN_FLAT_SURFACE_UNIFORMITY)
    expect(m.cross_agree).toBeGreaterThanOrEqual(MIN_CROSS_ROW_AGREEMENT)
  })

  it.each(CASES)('%s ⇒ %s', (_label, key, expected) => {
    const m = measure(FILES[key]!)
    const v = classifyTopInsetVerdict({
      // 数值本身无关紧要：这里验的是**前置条件**放不放行。
      // 取一个「看起来像缺陷」的值，确保放行时得到的正是自信的 fail。
      impliedInset: 5.5,
      insetPhysical: INSET,
      tolerance: 12,
      medianUniformity: m.median_unif,
      crossRowAgreement: m.cross_agree,
    })
    if (expected === 'pass') {
      expect(v.branch, '平色顶栏应通过前置条件').not.toBe('not-flat-surface')
    } else {
      expect(v.branch, `${_label} 必须被前置条件拦下（实测 unif=${m.median_unif} agree=${m.cross_agree}）`)
        .toBe('not-flat-surface')
    }
  })

  it('**回归防线**：纵向渐变必须被 cross_agree 拦下，而 median_unif 拦不下', () => {
    // 这条是本文件存在的全部理由。若哪天有人把 cross_agree 判据删掉、
    // 只留 median_unif，本条会红 —— 因为渐变的 median_unif 仍 ≥ 阈值。
    const m = measure(FILES.vgradient!)
    expect(
      m.median_unif,
      '若渐变的逐行均匀度已低于阈值，本条的前提变了 —— cross_agree 判据可能已多余，需重新评估',
    ).toBeGreaterThanOrEqual(MIN_FLAT_SURFACE_UNIFORMITY)
    expect(m.cross_agree).toBeLessThan(MIN_CROSS_ROW_AGREEMENT)
  })

  it('**已知残留失效面**：整屏浅纯色底拦不住，且必须被登记在案', () => {
    // 这一族与浅色顶栏在**颜色统计上同形**（两个度量都是 1.000），
    // 本判据原理上就区分不了。命中时会放行、随后给出自信的 `too-small`。
    //
    // AGENTS.md「门禁冻结线」#5：已知的失效面**必须显式登记**，不得只记它抓到了什么。
    // ⇒ 这里把它钉成一条会红的断言：行为改了、而登记没同步时，门禁先响。
    const m = measure(FILES.flatfull!)
    expect(m.median_unif).toBeGreaterThanOrEqual(MIN_FLAT_SURFACE_UNIFORMITY)
    expect(m.cross_agree).toBeGreaterThanOrEqual(MIN_CROSS_ROW_AGREEMENT)

    const v = classifyTopInsetVerdict({
      impliedInset: 5.5,
      insetPhysical: INSET,
      tolerance: 12,
      medianUniformity: m.median_unif,
      crossRowAgreement: m.cross_agree,
    })
    expect(v.branch, '若这一族已能被拦下，残留失效面缩小了 —— 请同步更新登记文案').toBe('too-small')

    // 登记必须在**代码**里，不只在聊天里：确认失效面仍写在模块文档里。
    const src = readFileSync(
      fileURLToPath(new URL('../scripts/topInsetVerdict.mjs', import.meta.url)),
      'utf8',
    )
    expect(
      src.includes('整屏浅纯色底') && src.includes('残留失效面'),
      'topInsetVerdict.mjs 里对「整屏浅纯色底」这一残留失效面的登记被删了。\n' +
        '  门禁冻结线 #5 要求失效面显式留痕：若它已被真正修掉，请连同本测试一起改。',
    ).toBe(true)
  })

  it('清理临时 fixture', () => {
    for (const f of Object.values(FILES)) rmSync(f, { force: true })
    expect(Object.keys(FILES).length).toBeGreaterThan(0)
  })
})
