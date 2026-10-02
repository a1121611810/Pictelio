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
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  classifyTopInsetVerdict,
  MIN_FLAT_SURFACE_UNIFORMITY,
  MIN_CROSS_ROW_AGREEMENT,
  KNOWN_BLIND_SPOTS,
} from '../scripts/topInsetVerdict.mjs'
import { Canvas, encodePng, W, H, type RGB } from './helpers/rasterCanvas'

const METRICS = fileURLToPath(new URL('../scripts/top_inset_metrics.py', import.meta.url))

// ── 几何（与 verify-top-inset.mjs 同源：emulator-5554 / 1080×2160）──
// 画布 W/H 取自共享 helper（真机同尺寸），不在此重复定义。
const INSET = 72
const BAR = (17.067 / 100) * W // 184.32 物理 px
const LO = INSET + 10 // 82
const HI = Math.round(INSET + BAR - 10) // 246

/** 用**共享**画布 helper 画一张 1080×2160 的图；`shade(x, y)` 决定每个像素。
 *
 *  ⚠️ 必须用 `tests/helpers/rasterCanvas.ts`，**不能**自己再写一份 PNG 编码器：
 *  该文件头明文写着「两个脚本门禁共用」，理由是「两份编码器一旦对 zlib/filter 的
 *  假设不同，同一张合成图会得到两个解码结果，症状是『判据时灵时不灵』」。
 *  首版就是自写了一份（手写 CRC32 查表 + `python3` 子进程跑 zlib）——既重复，
 *  又比共享实现弱（原生 `node:zlib` 的 `crc32`/`deflateSync`）。code-review 第 6 轮抓出。
 *  尺寸也用共享常量：判据阈值按**屏宽/屏高比例**标定，换尺寸就不是在验同一套判据。
 */
function draw(name: string, shade: (x: number, y: number) => RGB): string {
  const c = new Canvas([255, 255, 255])
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) c.set(x, y, shade(x, y))
  const dir = mkdtempSync(join(tmpdir(), 'topinset-metrics-'))
  const file = join(dir, `${name}.png`)
  writeFileSync(file, encodePng(c.px))
  return file
}

type Case = { file: string; median_unif: number; cross_agree: number }

function measure(file: string): Case {
  const out = execFileSync('python3', [METRICS, file, String(LO), String(HI)], {
    encoding: 'utf8',
  }).trim()
  const p = out.split(' ')
  return { file, median_unif: Number(p[p.length - 2]), cross_agree: Number(p[p.length - 1]) }
}

// ── 五个样本类别（几何与期望写在同一处，不可能对不上）──
const SURFACE: RGB = [248, 250, 255] // M3 light surface

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

  it('**已登记失效面**：整屏浅纯色底拦不住 —— 且必须一直与登记一致', () => {
    // ## 这条门禁在守什么
    //
    // AGENTS.md「门禁冻结线」#5：判据的**失效面**必须显式登记，不得只记它抓到了什么。
    // 「整屏浅纯色底」这一族与浅色顶栏在**颜色统计上同形**，两个颜色维度对它都没有
    // 判别力（实测都是 1.000）⇒ 命中时前置条件放行、随后给出自信的 `too-small`。
    //
    // 期望值**不写死**在这里，而是取自 `KNOWN_BLIND_SPOTS` 的登记 —— 于是本条比的是
    // 「实测分类结果」与「登记声称的命中形态」**是否仍相等**：
    //   ① 行为没变 ⇒ 绿（这一族仍是盲区，登记是准确的）；
    //   ② 哪天有人让判据真能分开了 ⇒ 两者不等 ⇒ **本条先红**，并要求同步更新登记。
    // 首版是反向的：断言只钉行为、登记另用子串在源码里找，于是「行为改好了」和
    // 「登记被人改了个措辞」两种情况都没人管。
    const spot = KNOWN_BLIND_SPOTS.find((s) => s.id === 'flat-fullscreen-light-cover')
    expect(
      spot,
      'topInsetVerdict.mjs 的 KNOWN_BLIND_SPOTS 里没有 flat-fullscreen-light-cover —— ' +
        '失效面登记被删了。门禁冻结线 #5 要求失效面显式留痕；若它已被真正修掉，' +
        '请连同本测试一起改。',
    ).toBeDefined()

    const m = measure(FILES.flatfull!)
    // 前提仍成立：两个颜色维度对它都无判别力（这正是它成为盲区的原因，也是不加
    // 第三个颜色信号的理由 —— 颜色维度上已经没有信号可用，见 ADR-0215 决策 3）
    expect(m.median_unif).toBeGreaterThanOrEqual(MIN_FLAT_SURFACE_UNIFORMITY)
    expect(m.cross_agree).toBeGreaterThanOrEqual(MIN_CROSS_ROW_AGREEMENT)

    const v = classifyTopInsetVerdict({
      // 规范探针：前置条件放行 + 反推值像缺陷 ⇒ 若这一族被测不出来，必然落到 fail
      impliedInset: 5.5,
      insetPhysical: INSET,
      tolerance: 12,
      medianUniformity: m.median_unif,
      crossRowAgreement: m.cross_agree,
    })
    expect(
      { kind: v.kind, branch: v.branch },
      '若这一族已能被拦下，残留失效面**缩小**了 —— 请同步更新 KNOWN_BLIND_SPOTS 的登记文案',
    ).toEqual(spot!.hits)
  })

  it('清理临时 fixture', () => {
    for (const f of Object.values(FILES)) rmSync(f, { force: true })
    expect(Object.keys(FILES).length).toBeGreaterThan(0)
  })
})
