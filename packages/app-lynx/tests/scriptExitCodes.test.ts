/**
 * 两个探针脚本的**退出码语义**门禁（review STD-3 / STD-5）。
 *
 * ## 为什么退出码需要单独一道门禁
 *
 * 缺陷形态是**三义同形**：`NOTFOUND`（legit 的「页面上没有这个东西」）、
 * PNG 截断（`screencap` 写到一半断连）、文件不存在（`adb` 拉失败留下 0 字节文件）
 * 三者的退出码**完全相同**。Python 的未捕获异常也是 1，而 `decode()` 的四种失败
 * 都走未捕获异常；上游 `capture-md3-matrix.sh` 的调用点全是 `2>/dev/null`，
 * traceback 被吞掉后只看 rc ⇒ **设备/线缆故障被报成「页面布局变了、找不到控件」**，
 * 人会去调判据阈值。违反测试硬约束 #3「禁止静默降级」。
 *
 * 契约（见两个脚本文件头的「退出码」表）：
 *
 * | 码 | 含义 |
 * | --- | --- |
 * | 0 | 找到 |
 * | 1 | **NOTFOUND** —— 图读得懂，画面里没有这个东西 |
 * | 2 | 用法错误（未知开关 / 没给路径） |
 * | 3 | **输入不可读** —— 文件不存在 / 不是 PNG / 截断；`--selected` 下「判据失效」也归这一档 |
 *
 * ⚠️ **断言必须分别钉住 1 与 3**：只断言「非 0」等于没测 —— 那正是本缺陷的形态
 * （缺陷存在时「非 0」照样绿）。同理 1 与 3 的 stderr 文案也必须可区分。
 *
 * ## fixture 溯源（oracle 纪律）
 *
 * * PNG 由 `tests/helpers/rasterCanvas.ts` 的 `encodePng` 现画 —— **不写第二份编码器**。
 *   两份编码器一旦对 zlib/filter 的假设不同，同一张合成图会给出两个解码结果。
 * * 几何取真机实测值（emulator-5556 / 1080×2160），出处逐条写在常量注释里。
 * * 色板 7 色 = app 真实的 7 套主题色，取自 `scripts/generate-theme-palettes.mjs`
 *   的 `THEMES[].lightPrimaryAnchor`（与 `tokens.css` 的 7 个 `.theme-X` `--md-primary`
 *   双向锁定，`tests/palettes-drift.test.ts` 断言）。
 * * 期望的 rc 来自**脚本的文档化契约**（文件头那张表），不是「当前输出」。
 *
 * ## 截断 fixture 为什么砍一半
 *
 * 砍「最后 N 字节」是**测不到**的：`IEND` 只有 12 字节，砍掉它 `zlib.decompress`
 * 仍然成功（解码在 IEND 之前就结束）⇒ rc 会是 0/1 而不是 3。必须砍进 IDAT 载荷内；
 * 1080×2160 合成图的 IDAT 占文件绝大部分，砍一半必然落在里面。
 *
 * 复现命令：`cd packages/app-lynx && pnpm vitest run tests/scriptExitCodes.test.ts`
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Canvas, encodePng, type RGB } from './helpers/rasterCanvas'

/** 退出码契约（= 两个脚本文件头「退出码」表的逐字对应，改脚本要连表一起改）。 */
const RC = { OK: 0, NOTFOUND: 1, UNREADABLE: 3 } as const

const rootDir = resolve(__dirname, '..')

/** 真机实测色（emulator-5556 / 1080×2160，采样坐标见 `tests/findUiBand.test.ts` 文件头）：
 *  页面外底 @ (20,300) / 卡片与未选中段 @ (500,1310) / 选中段填充 @ (240,1310) /
 *  控件描边 @ (388,1310) / 段内文字 @ (810,1310)。 */
const PAGE: RGB = [248, 250, 255]
const CARD: RGB = [255, 255, 255]
const FILLED: RGB = [211, 229, 245]
const OUTLINE: RGB = [113, 120, 126]
const TEXT: RGB = [25, 28, 32]

/** app 真实的 7 套主题色（= 外观卡上 7 个色板 swatch 的颜色）。
 *  来源 `scripts/generate-theme-palettes.mjs` 的 `THEMES[].lightPrimaryAnchor`
 *  （= `tokens.css` 里 7 个 `.theme-X` 的 `--md-primary`，ADR-0152 锁定）。
 *  7 个都过 `find-palette-swatches.py` 的 `SAT_MIN = 40`：
 *  天蓝 142 / 紫罗兰 58 / 樱花粉 65 / 苔绿 48 / 琥珀 110 / 青 109 / bilibili 粉 159。 */
const SWATCH_COLORS: RGB[] = [
  [26, 111, 168], // #1a6fa8 天蓝
  [101, 85, 143], // #65558f 紫罗兰
  [139, 74, 97], // #8b4a61 樱花粉
  [60, 105, 57], // #3c6939 苔绿
  [133, 83, 23], // #855317 琥珀
  [0, 105, 109], // #00696d 青
  [208, 49, 113], // #d03171 bilibili 粉
]

/** 真机实测（1080×2160 外观卡）：7 个圆心 x = 137/272/406/540/673/807/941，
 *  圆心行 y = 1542，圆点直径 ~110px（`find-palette-swatches.py` 文件头的实测表）。 */
const SW_CX = [137, 272, 406, 540, 673, 807, 941]
const SW_CY = 1542
const SW_R = 55

/** 真机实测：控件左缘 x=82、段宽 306、描边 3px、带顶 y=1250、带高 122px。 */
const CTRL_X0 = 82
const SEG_W = 306
const CTRL_W = SEG_W * 3
const OUTLINE_PX = 3
const BAND_Y = 1250
const BAND_H = 122

// ─────────────────────────────── fixture 画法 ───────────────────────────────

/** 一张三段分段控件（只有第 0 段被选中）—— `find-ui-band.py` 的目标结构。 */
function bandPage(): Canvas {
  const cv = new Canvas(PAGE)
  const o = OUTLINE_PX
  cv.rect(CTRL_X0, BAND_Y, CTRL_X0 + CTRL_W - 1, BAND_Y + BAND_H - 1, OUTLINE)
  cv.rect(CTRL_X0 + o, BAND_Y + o, CTRL_X0 + CTRL_W - 1 - o, BAND_Y + BAND_H - 1 - o, CARD)
  cv.roundRect(CTRL_X0 + o, BAND_Y + o, CTRL_X0 + SEG_W - 1 - o, BAND_Y + BAND_H - 1 - o, 16, FILLED)
  return cv
}

/** 一行 7 个等距色板圆点 —— `find-palette-swatches.py` 的目标结构。 */
function swatchPage(): Canvas {
  const cv = new Canvas(PAGE)
  SWATCH_COLORS.forEach((c, i) => cv.disc(SW_CX[i], SW_CY, SW_R, c))
  return cv
}

/** 合法 PNG 但**没有**分段控件：一张卡片 + 6 行细文字（每行 28px < 屏高 3.5%）
 *  ⇒ 候选带产生后被 `min_height_ratio` 拒，`--explain`/stderr 里有逐条拒因。
 *  ⚠️ 必须是「有候选被正确拒」而不是「一条候选都没有」：两者 stderr 都含 NOTFOUND，
 *  同形 ⇒ 这里用 `拒：带高` 把它钉住（与 `findUiBand.test.ts` 的 F4 同构）。 */
function textOnlyPage(): Canvas {
  const cv = new Canvas(PAGE)
  cv.rect(0, 300, 1079, 900, CARD)
  for (let k = 0; k < 6; k++) cv.rect(120, 300 + k * 120, 900, 327 + k * 120, TEXT)
  return cv
}

/** 合法 PNG 但**没有**色板行：整屏一个中性底色（sat = 7 < SAT_MIN 40）。 */
function blankPage(): Canvas {
  return new Canvas(PAGE)
}

/** 砍掉 PNG 尾巴的一半 —— 见文件头「截断 fixture 为什么砍一半」。 */
function truncatePng(png: Buffer): Buffer {
  return png.subarray(0, Math.floor(png.length / 2))
}

// ─────────────────────────────── 跑脚本 ───────────────────────────────

interface Run {
  rc: number
  stdout: string
  stderr: string
}

/** 找不到 python 就**硬失败**，不静默 skip —— skip 会让门禁变成永远绿的空壳
 *  （沿用 `findUiBand.test.ts` 的口径）。 */
function pythonBin(): string {
  for (const bin of ['python3', 'python']) {
    const probe = spawnSync(bin, ['-c', 'import sys; sys.exit(0)'], { encoding: 'utf8' })
    if (probe.status === 0) return bin
  }
  throw new Error(
    'scriptExitCodes 门禁需要 python3 —— 找不到可用的解释器。' +
      '本门禁**故意不 skip**：skip 等于让退出码回归永远绿灯。',
  )
}

interface Fixtures {
  /** 每个脚本的「找到了」图 */
  found: Record<string, string>
  /** 每个脚本的「图读得懂但没有目标结构」图 */
  notFound: Record<string, string>
  /** 非 PNG（纯文本冒充 .png） */
  notPng: string
  /** 截断的合法 PNG */
  truncated: Record<string, string>
}

const SCRIPTS = {
  'find-ui-band': {
    rel: 'scripts/find-ui-band.py',
    /** `--csv` 是 `capture-md3-matrix.sh` 的 detect_control 实际用的形态 */
    flags: ['--csv'],
    /** 命中时应落在「第 0 段」自己的外接框内（独立 oracle = 画出来的几何） */
    foundBox: { x0: CTRL_X0, x1: CTRL_X0 + SEG_W - 1, y0: BAND_Y, y1: BAND_Y + BAND_H - 1 },
    /** NOTFOUND 时 stderr 必须提到的拒因（钉「是哪条判据拒的」） */
    notFoundMustMention: '带高',
  },
  'find-palette-swatches': {
    rel: 'scripts/find-palette-swatches.py',
    flags: ['--csv'],
    /** 命中时应报出 7 个圆心，且第 0 个等于画出来的第 0 个圆心 */
    foundBox: null,
    notFoundMustMention: '饱和色块',
  },
} as const

type ScriptName = keyof typeof SCRIPTS

let dir = ''
let bin = ''
let fx: Fixtures
const cache = new Map<string, Run>()

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'exitcodes-'))
  bin = pythonBin()
  const write = (name: string, data: Buffer | string) => {
    const p = join(dir, name)
    writeFileSync(p, data)
    return p
  }
  const bandPng = encodePng(bandPage().px)
  const swatchPng = encodePng(swatchPage().px)
  fx = {
    found: {
      'find-ui-band': write('band-found.png', bandPng),
      'find-palette-swatches': write('swatches-found.png', swatchPng),
    },
    notFound: {
      'find-ui-band': write('band-missing.png', encodePng(textOnlyPage().px)),
      'find-palette-swatches': write('swatches-missing.png', encodePng(blankPage().px)),
    },
    // 纯文本冒充 PNG：`decode()` 的第一道就是 magic 比对 ⇒ ValueError
    notPng: write('not-a-png.png', '这不是 PNG，这是一段纯文本。'.repeat(64)),
    truncated: {
      'find-ui-band': write('band-truncated.png', truncatePng(bandPng)),
      'find-palette-swatches': write('swatches-truncated.png', truncatePng(swatchPng)),
    },
  }
}, 120_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

function run(name: ScriptName, file: string, extra: string[] = []): Run {
  const key = `${name}|${file}|${extra.join(' ')}`
  const hit = cache.get(key)
  if (hit) return hit
  const s = SCRIPTS[name]
  const res = spawnSync(bin, [s.rel, file, ...s.flags, ...extra], { cwd: rootDir, encoding: 'utf8' })
  const out: Run = { rc: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
  cache.set(key, out)
  return out
}

/** 三档 rc 的公共断言：rc 必须**恰好**等于契约值，且两档的 stderr 文案互不冒充。 */
function expectRc(r: Run, want: number, file: string, what: string): void {
  expect(r.rc, `${what}：退出码应为 ${want}，实际 ${r.rc}\n--- stderr ---\n${r.stderr}`).toBe(want)
  if (want === RC.NOTFOUND) {
    expect(r.stderr, `${what}：stderr 必须带 NOTFOUND 与拒因`).toContain('NOTFOUND')
    expect(r.stderr, `${what}：legit 的「没找到」不得自称「输入不可读」`).not.toContain('输入不可读')
    expect(r.stdout.trim(), `${what}：NOTFOUND 不得输出坐标`).toBe('')
  }
  if (want === RC.UNREADABLE) {
    expect(r.stderr, `${what}：stderr 必须自称「输入不可读」，以便与 NOTFOUND 区分`).toContain(
      '输入不可读',
    )
    expect(r.stderr, `${what}：不得自称 NOTFOUND`).not.toContain('NOTFOUND')
    // 诊断信息必须带**路径**：上游 `2>/dev/null` 吞掉的就是这部分
    expect(r.stderr, `${what}：诊断信息必须带出输入路径`).toContain(basename(file))
  }
}

const TIMEOUT = 60_000

for (const name of Object.keys(SCRIPTS) as ScriptName[]) {
  describe(`${SCRIPTS[name].rel} · 退出码语义`, () => {
    it('合法 PNG 且找到目标结构 ⇒ rc 0', () => {
      const r = run(name, fx.found[name])
      expectRc(r, RC.OK, fx.found[name], '找到')
      expect(r.stderr, 'rc 0 时不得出现任何失败文案').not.toMatch(/NOTFOUND|输入不可读/)
      if (SCRIPTS[name].foundBox) {
        // 独立 oracle = **画出来的几何**，不复刻脚本内部的取整/扩展规则
        const m = r.stdout.trim().match(/^(\d+),(\d+)$/m)
        expect(m, `rc 0 时 --csv 应输出 cx,cy，实际 ${JSON.stringify(r.stdout)}`).not.toBeNull()
        const [cx, cy] = [Number(m![1]), Number(m![2])]
        const b = SCRIPTS[name].foundBox!
        // 描边 3px 与圆角会被算进/削掉外接框，故按「段的外接框」而非「填充内接框」断言
        expect(cx, '命中中心 x 落在第 0 段之外').toBeGreaterThanOrEqual(b.x0)
        expect(cx, '命中中心 x 落在第 0 段之外').toBeLessThanOrEqual(b.x1)
        expect(cy, '命中中心 y 落在带之外').toBeGreaterThanOrEqual(b.y0)
        expect(cy, '命中中心 y 落在带之外').toBeLessThanOrEqual(b.y1)
      } else {
        // 色板：--csv 输出 `y,radius,c0..c6` = 2 + 7 = 9 列，圆心必须齐全且与画出来的一致
        const parts = r.stdout.trim().split(',')
        expect(parts.length, 'rc 0 时 --csv 应输出 y,radius + 7 个圆心').toBe(2 + SW_CX.length)
        expect(parts.slice(2).map(Number), '圆心应等于画出来的 7 个圆心').toEqual(SW_CX)
        expect(Number(parts[0]), '行中心 y 应等于画出来的圆心行').toBe(SW_CY)
        // ⚠️ `radius` **刻意不断言具体值**：它是「行带内各色块宽度的中位数的一半」，
        // 而 2px 抽样步长下测量宽度随圆心 x 的奇偶不同（偶数圆心取 cx±54、奇数取 cx±55），
        // 合成图上得 47、真机上得别的数都正常。钉它等于把宽度公式抄进测试
        // （影子实现，自检给假保障），与 F8 拒绝复刻 `0.45×peak` 同一个理由。
        // 这里只钉它是可用的正半径 —— 圆心断言已经承担几何校验。
        expect(Number(parts[1]), '半径必须是正数').toBeGreaterThan(0)
        expect(Number(parts[1]), '半径不得超过画出来的圆点半径').toBeLessThanOrEqual(SW_R)
      }
    }, TIMEOUT)

    it('合法 PNG 但画面里没有目标结构 ⇒ rc 1（legit 的 NOTFOUND），stderr 带拒因', () => {
      const file = fx.notFound[name]
      const r = run(name, file)
      expectRc(r, RC.NOTFOUND, file, 'NOTFOUND')
      expect(r.stderr, 'NOTFOUND 必须给出是哪条判据拒的').toContain(SCRIPTS[name].notFoundMustMention)
    }, TIMEOUT)

    it('不是 PNG（纯文本冒充 .png）⇒ rc 3', () => {
      const r = run(name, fx.notPng)
      expectRc(r, RC.UNREADABLE, fx.notPng, '非 PNG')
      expect(r.stderr, '原因必须具体到「不是 PNG」').toContain('不是 PNG')
    }, TIMEOUT)

    it('截断的 PNG ⇒ rc 3', () => {
      const file = fx.truncated[name]
      const r = run(name, file)
      expectRc(r, RC.UNREADABLE, file, '截断 PNG')
      // zlib 的报错措辞随 Python 版本略有差异，只钉关键词（不改判据含义）
      expect(r.stderr, '原因必须指向 zlib 解压失败').toMatch(/truncated|incomplete|Error -5/i)
    }, TIMEOUT)

    it('文件不存在 ⇒ rc 3', () => {
      const file = join(dir, `${name}-definitely-missing.png`)
      const r = run(name, file)
      expectRc(r, RC.UNREADABLE, file, '文件不存在')
      expect(r.stderr, '原因必须指明是文件读不到').toContain('FileNotFoundError')
    }, TIMEOUT)

    it('未知开关 ⇒ rc 2（用法错误，第四档）', () => {
      const res = spawnSync(bin, [SCRIPTS[name].rel, fx.found[name], '--no-such-flag'], {
        cwd: rootDir,
        encoding: 'utf8',
      })
      expect(res.status, '未知开关必须返 2').toBe(2)
    }, TIMEOUT)
  })
}

describe('退出码契约本身的形状', () => {
  it('三档必须互不相同（1 与 3 同形就是本缺陷的定义）', () => {
    expect(new Set([RC.OK, RC.NOTFOUND, RC.UNREADABLE]).size).toBe(3)
  })

  it('门禁确实跑了真实脚本（缓存里必须有结果，防止全被 skip 成空壳）', () => {
    expect(cache.size).toBeGreaterThanOrEqual(8)
  })
})

// 「没找到」与「判据失效」在 `selected_index` 里都「给不出下标」，但必须分属两档：
// 前者照常往下走，后者要停下来查判据（静默取第一个会让 4 个色板全拍成天蓝）。
// 同一张图加不加 `--selected` 就能把两档分出来 —— 复用上面已建好的 fixture，不另画。
describe('find-palette-swatches.py --selected · 「没找到」与「判据失效」不得同形', () => {
  it('色板行在、但认不出唯一选中态（命中 0 个）⇒ rc 3 且自称「判据失效」', () => {
    // `fx.found` 那张图有 7 个圆点，但**没有**任何一个带「环 + 白缝」⇒ 命中 0 个。
    // 同一张图不加 --selected 是 rc 0，加了就是 rc 3 —— 分档靠的是判据有没有生效。
    const r = run('find-palette-swatches', fx.found['find-palette-swatches'], ['--selected'])
    expect(r.rc, `判据失效应为 3\n--- stderr ---\n${r.stderr}`).toBe(RC.UNREADABLE)
    expect(r.stderr, '必须自称「判据失效」而不是 NOTFOUND').toContain('判据失效')
    expect(r.stderr, '原因必须点明命中数').toContain('命中 0 个')
    expect(r.stderr, '判据失效不得自称 NOTFOUND').not.toContain('NOTFOUND')
    expect(r.stdout.trim(), '判据失效不得输出下标').toBe('')
  }, TIMEOUT)

  it('本页根本没有色板行 ⇒ rc 1（legit 的 NOTFOUND），与上一条分属不同档', () => {
    const file = fx.notFound['find-palette-swatches']
    const r = run('find-palette-swatches', file, ['--selected'])
    expectRc(r, RC.NOTFOUND, file, '--selected NOTFOUND')
    expect(r.stderr, '拒因必须是「本页没有色板行」').toContain('本页没有色板行')
  }, TIMEOUT)
})
