/**
 * `scripts/find-palette-swatches.py` 的判据门禁。
 *
 * ## 为什么这个脚本必须有门禁（而不只是「真机跑一次绿了就算」）
 *
 * 它是本轮**新增的承重件**，`capture-md3-matrix.sh` 的两处判定都建立在它之上：
 *
 * 1. `goto_appearance` 用它认「外观卡」——设置页上至少三张卡的 x 几何完全相同
 *    （1080 下 AI 作品 / 外观模式 / 界面语言的段中心都是 234 / 540 / 846），
 *    只靠 `find_filled_band` 分不出认到了哪张卡。
 * 2. `set_palette` 用它的 `selected_index` 当**唯一 oracle**——点完色板回读选中下标，
 *    对不上重试 3 次后 `exit 1`。
 *
 * 缺了第 2 条，点空色板**不报错**：4 个色板 × 2 明暗共 8 张截图会全部拍成天蓝，
 * 而矩阵脚本照样报「产出 32/32」。这是一条**只产出假绿**的缺陷。
 *
 * 复现命令：
 *   cd packages/app-lynx && pnpm vitest run tests/findPaletteSwatches.test.ts
 *
 * ## 真机实测数据（本文件所有色值 / 几何的来源）
 *
 * 来源：`emulator-5556` / `io.pictelio.app` / 设置 → 外观 → 选择主题色 /
 * 1080×2160 / 亮色。截图 `/tmp/m864/sw-1080x2160.png`（天蓝选中）与
 * `/tmp/m864/palette-sakura.png`（樱花粉选中）。
 *
 * 圆心 x —— `--csv` 实测输出，两图**逐值相同**：
 *     137, 272, 406, 540, 673, 807, 941
 * 相邻间距 135/134/134/133/134/134 ⇒ 中位 134，最大偏差 1px（0.7%，
 * 远小于 `EVEN_TOL = 12%`）。
 *
 * 7 个 swatch 的本体色（横扫行带中心 y 取圆心像素）：
 *     [0] 天蓝   (26,111,168)  sat=142      [4]         (133, 83, 23)  sat=110
 *     [1] 紫罗兰 (101, 85,143)  sat= 58      [5] 深青    (  0,105,109)  sat=109
 *     [2] 樱花粉 (139, 74, 97)  sat= 65      [6]         (208, 49,113)  sat=159
 *     [3]        ( 60,105, 57)  sat= 48
 *     卡片底 / 选中态「白缝」 (255,255,255)  sat=0（就是卡片本身透出来）
 *
 * ⚠️ 最低饱和度是 [3] 的 **48**，离 `SAT_MIN = 40` 只有 8（20% 余量）。
 *    这是真机数据本身贴着阈值，不是 fixture 造出来的边缘——记在这里，
 *    免得日后有人把 `SAT_MIN` 调到 50 却以为「反正实测都过了」。
 *
 * 几何（由 y=1520 / 1530 / 1554 / 1542 四条横扫剖面反解，cx=137 为原点）：
 *     本体圆盘半径   R  = 46      （y=1542 未选 swatch 实测 x=226..317，宽 92）
 *     选中态白缝环   半径 46..52  （≈6px，就是卡片底色透出）
 *     选中态外环     半径 52..58  （≈6px，**与本体同色**）
 *     行带 y=1498..1587（高 90），行内饱和段数为 7（76 行）或 8（14 行）
 *
 * `selected_index` 的判据是「横向饱和**连续段数** ≥ 2」：选中态多出来的那一圈
 * 环 + 白缝把圆心横切成 3 段，未选中只有 1 段。真机 `runs` 实测：
 * 选中 5、未选中 1（4 / 5 段是抗锯齿与对勾图标造成的额外切分，不承重）。
 *
 * ## 已知简化：fixture 不画选中态的**对勾图标**
 *
 * 真机选中圆点正中有一个浅色对勾，它在行带中心行制造额外切分（真机中心行 8 段）。
 * 本文件**不画**它 —— 因为判据在**不含对勾**的行上就已经成立
 * （真机 y=1520 / 1530 / 1554 都恰好是 3 段），对勾不是承重项。
 * 不画的理由是：画它就得**编**对勾的笔画几何，而「fixture 的几何同样是输入」
 * ——编出来的几何会在真机上不存在，凭空造出并列/边缘形态。
 * 真实对勾像素已记在 `selected_index` 的 docstring 里。
 *
 * ## 判别力：每条阴性用例都断言**是哪条判据拒的**
 *
 * 只断言 `NOTFOUND` 的用例没有判别力 —— 它与「脚本坏了」完全同形。
 * 所以每条阴性用例都断言 stderr 含该判据的名字：删掉那条判据，用例会转红。
 *
 * 每条修复/新增判据都跑了**变异自证**（改 `/tmp` 里的脚本副本，不动仓库）。
 * 结果表（`detected` = 该 fixture 被检出，即对应断言会转红）：
 *
 * | 变异                                 | sel-first | feed-uneven | too-few | too-many | too-thin |
 * | ------------------------------------ | --------- | ----------- | ------- | -------- | -------- |
 * | baseline（未变异）                   | detected  | NOTFOUND    | NOTFOUND | NOTFOUND | NOTFOUND |
 * | 等距判据 `EVEN_TOL` 0.12 → 10.0      | detected  | **detected**| NOTFOUND | NOTFOUND | NOTFOUND |
 * | 块数下界 `MIN_BLOBS` 5 → 3           | detected  | NOTFOUND    | **detected** | NOTFOUND | NOTFOUND |
 * | 块数上界 `MAX_BLOBS` 9 → 99          | detected  | NOTFOUND    | NOTFOUND | **detected** | NOTFOUND |
 * | 行带厚度 `rb-ra+1 < 10` → `< 0`      | detected  | NOTFOUND    | NOTFOUND | NOTFOUND | **detected** |
 * | 选中判据 `runs >= 2` → `>= 1`        | detected¹ | NOTFOUND    | NOTFOUND | NOTFOUND | NOTFOUND |
 *
 * ¹ 检出不受影响，但 `selected_index` 由「返回 0」变成「命中 7 个 [0..6]」⇒
 *   抛错 ⇒ 阳性断言 `toBe('0')` 转红。承重的是 `selected_index` 那几条。
 *
 * 两点读法：
 * - **阳性用例在所有变异下保持绿**，说明变异是精准的、不是把脚本整体打烂；
 *   若某条变异连阳性都打红，说明它顺带改了别的东西（变异不够精准）。
 * - 变异块数下界时用 `MIN_BLOBS = 3` 而不是 `0`。用 `0` 会让**空行也进候选带**，
 *   众数圆心退化成空元组、脚本直接 `IndexError` 崩溃 —— 崩溃与「干净地 NOTFOUND」
 *   在只看 stdout 时**完全同形**，会让人误以为「MIN_BLOBS 无关紧要」。
 *   （第一版变异台就踩了这个坑，结论是错的。）
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Canvas, encodePng, type RGB } from './helpers/rasterCanvas'

const SCRIPT_REL = 'scripts/find-palette-swatches.py'
const rootDir = resolve(__dirname, '..')

/** 真机实测圆心（见文件头）。间距中位 134px。 */
const CX = [137, 272, 406, 540, 673, 807, 941] as const
/** 真机实测行带中心 y。 */
const ROW_Y = 1542
/** 真机实测本体半径。 */
const R_BODY = 46
/** 选中态：白缝环 46..52，外环 52..58（与本体同色）。 */
const R_GAP_OUT = 52
const RING_OUT = 58

const CARD: RGB = [255, 255, 255]
/** 7 套主题色的真实本体色，顺序同 `CX`。 */
const SWATCH: readonly RGB[] = [
  [26, 111, 168],
  [101, 85, 143],
  [139, 74, 97],
  [60, 105, 57],
  [133, 83, 23],
  [0, 105, 109],
  [208, 49, 113],
]

/** Feed 负样本的实测色（1080 底部深色缩略图 / 其上浅色文字）。 */
const FEED_DARK: RGB = [46, 49, 54]
const FEED_TEXT: RGB = [239, 241, 247]

/**
 * 画一行 7 个真实色板圆点，`selected` 是被选中的下标（-1 = 都不选）。
 * 选中态 = 本体 + 白缝环 + 与本体同色的外环，见文件头几何说明。
 */
function paletteRow(sel: number): Canvas {
  const cv = new Canvas(CARD)
  for (let i = 0; i < CX.length; i++) {
    const c = SWATCH[i]
    cv.disc(CX[i], ROW_Y, R_BODY, c)
    if (i === sel) cv.ring(CX[i], ROW_Y, RING_OUT, R_GAP_OUT, c)
  }
  return cv
}

/** Feed 式**不等距**色块行：7 块、间距 88/300/162/174/40/50（实测 04-feed-scrolled.png）。 */
function feedUnevenRow(): Canvas {
  const cv = new Canvas(CARD)
  // 每块 30px 宽、60px 高；块间白缝按实测间距摆放
  const gaps = [88, 300, 162, 174, 40, 50]
  const width = 30
  let x = 28
  for (let i = 0; i < 7; i++) {
    cv.rect(x, 1510, x + width - 1, 1569, SWATCH[i])
    x += width + (gaps[i] ?? 0)
  }
  return cv
}

/** Feed 页本体（无 ≥5 个饱和块的行）—— 真机 `g.png` 实测 NOTFOUND 的那种画面。 */
function feedPage(): Canvas {
  const cv = new Canvas(CARD)
  cv.rect(0, 400, 1079, 1900, FEED_DARK)
  for (let k = 0; k < 8; k++) cv.rect(60, 420 + k * 190, 900, 470 + k * 190, FEED_TEXT)
  return cv
}

/** 等距但**块数越界**的行：`count` 块，间距恒 60px。 */
function blobRow(count: number, y0: number, y1: number): Canvas {
  const cv = new Canvas(CARD)
  for (let i = 0; i < count; i++) {
    const x0 = 60 + i * 90
    cv.rect(x0, y0, x0 + 59, y1, SWATCH[i % SWATCH.length])
  }
  return cv
}

interface Run {
  rc: number
  stdout: string
  stderr: string
}

const FIXTURES: Record<string, Canvas> = {
  // ── 阳性：真实色板行，选中态分别落在最左 / 中间 / 最右 ──
  'sel-first': paletteRow(0),
  'sel-middle': paletteRow(3),
  'sel-last': paletteRow(6),
  // ── 阳性：无选中态（7 块都在，但都没选中）──
  'sel-none': paletteRow(-1),
  // ── 阳性：两个同时选中（判据必须**失败**，不能静默取第一个）──
  'sel-two': (() => {
    const cv = paletteRow(0)
    cv.ring(CX[5], ROW_Y, RING_OUT, R_GAP_OUT, SWATCH[5])
    return cv
  })(),
  // ── 阴性：Feed 式不等距（等距判据承重）──
  'feed-uneven': feedUnevenRow(),
  // ── 阴性：块数低于 MIN_BLOBS ──
  'too-few': blobRow(3, 1510, 1569),
  // ── 阴性：块数高于 MAX_BLOBS ──
  'too-many': blobRow(11, 1510, 1569),
  // ── 阴性：整页无饱和块（空扫描面 ≠ 零违规）──
  'feed-plain': feedPage(),
  // ── 阴性：色块行只有 5px 高（太薄）──
  'too-thin': blobRow(7, 1540, 1544),
}

/** 需要 `--selected` 形态的 fixture —— 只有这 6 张的断言跑在 `selected_index` 上。
 *  其余 4 张（feed-uneven / too-few / too-many / too-thin）的断言只吃 `--csv` 形态，
 *  不必多跑一遍。 */
const SELECTED_FIXTURES = ['sel-first', 'sel-middle', 'sel-last', 'sel-none', 'sel-two', 'feed-plain']

const runs = new Map<string, Run>()
const selectedRuns = new Map<string, Run>()
let dir = ''

/** 找不到 python 就**硬失败**，不静默 skip —— skip 会让门禁变成永远绿的空壳。 */
function pythonBin(): string {
  for (const bin of ['python3', 'python']) {
    const probe = spawnSync(bin, ['-c', 'import sys; sys.exit(0)'], { encoding: 'utf8' })
    if (probe.status === 0) return bin
  }
  throw new Error(
    'findPaletteSwatches 门禁需要 python3 —— 找不到可用的解释器。' +
      '本门禁**故意不 skip**：skip 等于让判据回归永远绿灯。',
  )
}

function run(png: string, ...args: string[]): Run {
  const bin = pythonBin()
  const res = spawnSync(bin, [SCRIPT_REL, png, ...args], { cwd: rootDir, encoding: 'utf8' })
  return { rc: res.status ?? -1, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() }
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'palswatch-'))
  for (const [name, cv] of Object.entries(FIXTURES)) {
    const png = join(dir, `${name}.png`)
    writeFileSync(png, encodePng(cv.px))
    runs.set(name, run(png, '--csv', '--explain'))
  }
  // ⚠️ `--selected` **同样**在 beforeAll 里批量跑，理由与 findUiBand / findWideSolid 同口径
  // （「重活在 beforeAll，`it` 只做断言」）：每张要 spawn 一次 python 做全幅 1080×2160
  // 解码 + 全图饱和块扫描，实测 **~0.45s/张**。
  // 放进 `it` 里时，「选中最左 / 中间 / 最右」那一条要连 spawn 3 次 ⇒ 单条实测 **1338ms**，
  // 而 vitest 默认 `testTimeout` 只有 **5000ms**。`test:all` 是 4 路并发、单条耗时随 CPU
  // 争抢上飘 ⇒ 这正是「CI 间歇性假红」的形状。
  for (const name of SELECTED_FIXTURES) {
    selectedRuns.set(name, run(png(name), '--selected', '--explain'))
  }
}, 300_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** 解析 `--csv` 输出：`y,radius,cx0..cx6`。 */
function parseCsv(stdout: string): { y: number; radius: number; centers: number[] } {
  const parts = stdout.split(',')
  return { y: Number(parts[0]), radius: Number(parts[1]), centers: parts.slice(2).map(Number) }
}

const png = (name: string) => join(dir, `${name}.png`)

describe('find_swatches：定位「选择主题色」那一行', () => {
  // 三个选中位置各测一次。**只测最左**是不够的：本轮同族缺陷里，
  // 「argmax 并列取最左再向两侧扩张」曾把 3px 竖描边锁死、带宽塌成 2px，
  // 而它在真机上「碰巧」是对的 —— 边缘实例与中央实例必须分别钉。
  for (const [name, want] of [
    ['sel-first', 0],
    ['sel-middle', 3],
    ['sel-last', 6],
  ] as const) {
    it(`${name}：检出 7 个圆心且 y 精确`, () => {
      const r = runs.get(name)
      expect(r, `fixture ${name} 未跑`).toBeDefined()
      const got = parseCsv(r!.stdout)
      // 圆心是**逐值**比对：判据必须真量，不能像第一版 find_wide_solid 那样编造
      expect(got.centers).toEqual([...CX])
      // 行带中心 y：真机 1542，合成模型同样给 1542（不靠容差掩盖偏差）
      expect(got.y).toBe(ROW_Y)
    })
  }

  it('半径下界：`selected_index` 的扫描窗必须盖住外环', () => {
    // 推导而不是抄当前输出：`selected_index` 扫 `cx ± (radius + 24)`，
    // 外环在半径 58 ⇒ 必须 `radius >= 34`，否则选中态的环被扫窗外切掉、
    // 段数掉回 1、oracle 恒失败。真机实测 37。
    const got = parseCsv(runs.get('sel-first')!.stdout)
    expect(got.radius).toBeGreaterThanOrEqual(RING_OUT - 24)
    expect(got.radius).toBeLessThanOrEqual(R_BODY)
  })
})

describe('find_swatches：阴性用例各自指名拒因（判别力自证）', () => {
  const cases: [string, string][] = [
    // 等距判据是 `feed-uneven` 的**唯一**承重判据 ⇒ 删掉它这张就会转红
    ['feed-uneven', '不等距'],
    // 块数上下界
    ['too-few', '5–9 个饱和色块'],
    ['too-many', '5–9 个饱和色块'],
    // 空扫描面：与「零违规」不得同形
    ['feed-plain', '5–9 个饱和色块'],
    // 行带厚度下界
    ['too-thin', '太薄'],
  ]
  for (const [name, mustMention] of cases) {
    it(`${name}：被拒且拒因指向「${mustMention}」`, () => {
      const r = runs.get(name)
      expect(r, `fixture ${name} 未跑`).toBeDefined()
      expect(r!.stdout, 'NOTFOUND 时 stdout 必须为空，否则调用方会解析到垃圾').toBe('')
      expect(r!.stderr).toContain('NOTFOUND')
      expect(r!.stderr).toContain(mustMention)
    })
  }
})

describe('selected_index：set_palette 的唯一 oracle', () => {
  /** 取 `beforeAll` 预先跑好的 `--selected` 结果。
   *  缺了就**硬失败**并指名「beforeAll 漏了哪张」——静默 fallback 到现跑会把
   *  ~0.45s/张的开销偷偷搬回 `it` 里，正是本条要根治的东西。 */
  const selected = (name: string): Run => {
    const r = selectedRuns.get(name)
    expect(r, `fixture ${name} 没有 --selected 结果（beforeAll 漏跑？）`).toBeDefined()
    return r!
  }

  const expectIndex = (name: string, want: number) => {
    const r = selected(name)
    expect(r.stdout, `${name} 应检出选中下标 ${want}；stderr=${r.stderr}`).toBe(String(want))
    expect(r.stderr).toContain('选中 swatch 下标')
  }

  it('选中最左 / 中间 / 最右都能读对', () => {
    expectIndex('sel-first', 0)
    expectIndex('sel-middle', 3)
    expectIndex('sel-last', 6)
  })

  it('一个都没选中 ⇒ 显式失败（证明「≥2 段」不是恒真）', () => {
    const r = selected('sel-none')
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('命中 0 个')
  })

  it('两个同时选中 ⇒ 显式失败，**不静默取第一个**', () => {
    // 这是最关键的一条：set_palette 靠它重试 3 次后 exit 1。
    // 若这里改成「取第一个」，8 张截图会安静地全拍成同一个色板。
    const r = selected('sel-two')
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('命中 2 个')
  })

  it('本页没有色板行 ⇒ 报 NOTFOUND（不是崩溃）', () => {
    const r = selected('feed-plain')
    expect(r.stdout).toBe('')
    expect(r.stderr).toContain('本页没有色板行')
  })
})
