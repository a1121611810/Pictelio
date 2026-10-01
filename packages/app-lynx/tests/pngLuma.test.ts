/**
 * `scripts/png-luma.py` 的**行为**门禁（第五轮新增，堵 N4 的缺口）。
 *
 * ## 为什么这个脚本以前没有门禁，而它比另外两支更该有
 *
 * 全仓 grep：本脚本此前只被 `readFileSync` 当**文本**读过，**从未被 spawn 过** ——
 * 而 `find-ui-band.py` / `find-palette-swatches.py` 各有两支门禁在 spawn 它们。
 * 偏偏本轮改的**就是它的判据语义**（`GATE_PRESET` 的 mean 区域：整幅 → 底部带 → 顶栏中段）。
 * 判据改了却没有行为测试，等于「改了但没人验」。
 *
 * ## 它自己声明的核心不变式，本文件把它当**被测行为**而不是注释
 *
 * 「两套实现（Pillow / 标准库）的**数字不对齐、判定一致才算数**」。这是全仓唯一一处
 * 双实现互为 oracle 的地方（审计二认可的那种差分测试），所以：
 * · 先用**构造出来的、期望值可算**的图钉住单条实现的区域/通道语义（oracle = BT.601 公式）；
 * · 再用 `--selfcheck` 跑它自己的双实现比对，钉住「判定一致」这条不变式。
 *
 * ## 最该盯的三类真实缺陷（每条都有反事实变异自证）
 *
 * | # | 缺陷形态 | 哪条用例挡 | 变异自证 |
 * |---|---|---|---|
 * | 1 | 区域参数被忽略/写反/差一 —— 上游整张表的口径就全错 | 区域真的过滤 | M1：`crop = rgb` 忽略 box ⇒ **3 条红** |
 * | 2 | 灰度按 RGB 取值**跨像素**：均值/标准差取错、饱和度恒不为 0，**且不报错** | 灰度四类 color type + **标准库路径** | M2：`gray = False` ⇒ **2 条红** |
 * | 3 | **「没检查却报通过」** —— fail-open | 5 条 CLI 守卫 | M5：缺清单时 `return 0` ⇒ **1 条红** |
 * | 4 | 自检**空转**：循环不执行 ⇒ 报告「0 处不一致」而实际一次都没比 | 自检真的逐条打印 | M4：`in []` ⇒ **2 条红** |
 * | 5 | 无 Pillow 时自检 **fail-open**（该拒绝时反而报绿） | 环境分支两条都钉 | M6：`return 1`→`return 0` ⇒ 无 Pillow 下 **2 条红**，有 Pillow 仍全绿（变异精准） |
 * | 6 | I/O 错误被宽 catch 误诊成「不是 PNG」 | I/O 错误**不得**被误诊 | M7：`except` 改回 `Exception` ⇒ **1 条红** |
 * | 7 | 两条实现的诊断**不一致**（原来只观测一路、靠推断） | 同一次运行里真的比较两路 | M8：标准库路措辞加后缀 ⇒ **1 条红** |
 *
 * ⚠️ **M2 先跑出了 0 条红**，暴露的是**门禁自己的漏洞**而不是脚本没问题：
 * CLI 的 `probe()` 在装了 Pillow 的机器上永远走 Pillow 路径，
 * `_stats_from_pixels()` 的灰度分支**一次都没执行过** ⇒ 那个潜伏缺陷在只跑 CLI 的
 * 门禁下**根本测不到**。补了直接 import 模块的**标准库路径**用例后才转红。
 * 这是「判据准 ≠ 门禁有效」的又一刻：判据必须跑在它**真会被调到**的那一刻。
 *
 * ### 环境依赖：Pillow 装不装得住（写完自己发现的可移植性缺陷）
 *
 * 本文件最初把 `--selfcheck` 一律断言成 rc 0，而脚本在**没有 Pillow** 时的契约是
 * **拒绝自检**（rc 1 + 「无 Pillow」）—— 于是一台没装 Pillow 的 CI 机器上**必然 3 条红**。
 * 修法**不是 skip**（skip 等于让「双实现不变式」在某些机器上永远无人验证），
 * 而是**两条分支都钉**：装了 Pillow ⇒ 跑差分并断言「判定不一致 0 处」；
 * 没装 ⇒ 断言脚本**拒绝**自检（rc 1 + 「无 Pillow」，且不得出现任何比对行）。
 * 两个环境的契约都被锁住，且**比原来更强**。
 * 实测：用 `PYTHONPATH` 指向一个 raise ImportError 的伪 PIL 包，两种环境各 26/26 全绿。
 *
 * ### 变异台自身的教训（本轮又踩了一次）
 *
 * 第一轮 4 个变异里有 2 个**根本没注入成功**（perl 正则没匹配上），跑出来是「全绿」——
 * 但那不是门禁通过，是**变异没生效**。此后每次变异都**先回读确认注入行数**再跑测试。
 * 「绿的变异结果」在没确认注入前**一律不作数**。
 *
 * 第 2 条是该脚本 docstring 自己记着的**潜伏**缺陷（「灰度分支原先没走到，因为
 * Android screencap 出的是 RGBA」）—— 潜伏缺陷一旦被合成 fixture 覆盖就不会再潜伏。
 *
 * ## fixture 溯源
 *
 * 颜色用**纯黑/纯白**为主：BT.601 下 `0.299*0+0.587*0+0.114*0 = 0`、`…255 = 255`，
 * 两条实现**逐位相同**、不混叠，于是「区域对不对」这件事可以被**精确**断言，
 * 不会被两路偏差（实测最大 5.07）搅浑。需要制造偏差时才用中间色。
 * 尺寸取 100×100：标准库路径是纯 Python 逐像素循环，1080×2160 要 ~25s。
 *
 * 复现命令：`cd packages/app-lynx && pnpm vitest run tests/pngLuma.test.ts`
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { encodePngOpts } from './helpers/rasterCanvas'

const SCRIPT_REL = 'scripts/png-luma.py'
const rootDir = resolve(__dirname, '..')
const PL = readFileSync(resolve(rootDir, 'scripts/png-luma.py'), 'utf8')

/** 找不到 python 就**硬失败**，不静默 skip（沿用另两支门禁的口径）。 */
function pythonBin(): string {
  for (const bin of ['python3', 'python']) {
    if (spawnSync(bin, ['-c', 'import sys; sys.exit(0)'], { encoding: 'utf8' }).status === 0) return bin
  }
  throw new Error('pngLuma 门禁需要 python3 —— 本门禁**故意不 skip**：skip 等于让判据回归永远绿灯。')
}

const S = 100 // 边长；小图是标准库路径可跑的前提

/** 纯色图，`vals` 是每像素的通道值序列。 */
function solid(ch: 0 | 2 | 4 | 6, vals: number[]): Uint8Array {
  const n = { 0: 1, 2: 3, 4: 2, 6: 4 }[ch]
  const px = new Uint8Array(S * S * n)
  for (let i = 0; i < S * S; i++) for (let c = 0; c < n; c++) px[i * n + c] = vals[c]
  return px
}

/** 上下两半不同色（color type 2）。 */
function halves(top: number[], bottom: number[]): Uint8Array {
  const px = new Uint8Array(S * S * 3)
  for (let y = 0; y < S; y++) {
    const c = y < S / 2 ? top : bottom
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 3
      px[i] = c[0]
      px[i + 1] = c[1]
      px[i + 2] = c[2]
    }
  }
  return px
}

const BLACK: number[] = [0, 0, 0]
const WHITE: number[] = [255, 255, 255]

let dir = ''
const files: Record<string, string> = {}

interface Run {
  rc: number
  stdout: string
  stderr: string
}

function run(...args: string[]): Run {
  const res = spawnSync(pythonBin(), [SCRIPT_REL, ...args], { cwd: rootDir, encoding: 'utf8' })
  return { rc: res.status ?? -1, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() }
}

/** 在 python 里执行一段表达式（模块已按 png-luma.py 的方式加载）。 */
function pyEval(expr: string): string {
  const code = [
    'import importlib.util',
    `spec = importlib.util.spec_from_file_location("pl", r"${SCRIPT_REL}")`,
    'pl = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(pl)',
    expr,
  ].join('\n')
  const res = spawnSync(pythonBin(), ['-c', code], { cwd: rootDir, encoding: 'utf8' })
  expect(res.status, `python 片段执行失败：${res.stderr}`).toBe(0)
  return (res.stdout ?? '').trim()
}

/** 本机是否装了 Pillow。**它决定本文件哪些断言适用**，不是可选信息。
 *
 * ⚠️ 这不是「有 Pillow 就测、没有就 skip」：两条分支**都要钉**。
 * 没有 Pillow 时只有**一条**实现，双路径差分**按设计不可做**，脚本的契约是
 * **拒绝自检**（rc 1 + 「无 Pillow」）而不是拿同一条实现比同一条实现、
 * 报「0 处不一致」冒充验过。所以无 Pillow 分支断言的是**那个拒绝**。
 */
let havePIL = false

/**
 * 无 Pillow 环境下的**前提契约断言**。
 *
 * ⚠️ 为什么需要它：有几条用例在无 Pillow 时**测不了本体不变式**（Pillow 路不存在）。
 *    但**裸 return 是事实上的 skip** —— 计入绿数却零断言，等于让绿数含虚高成分，
 *    也违反硬约束 #3「禁静默降级」。所以这类分支必须**至少断言这条前提本身**。
 *
 * ⚠️ 曾以「已由其它用例的环境分支覆盖」为由跳过（第八轮 Standards F-1 查实：**不成立**，
 *    那边覆盖的是脚本「拒绝自检」的性质，与本条的 __cause__ / 两路诊断无关）。
 *    现收进 helper 由两处共用，杜绝「改一处漏一处」。
 */
function expectNoPillowContract(): void {
  expect(
    pyEval('print(pl._HAVE_PIL)').trim(),
    '无 Pillow 时 _HAVE_PIL 必须是 False —— 这条用例不可做本体不变式的前提',
  ).toBe('False')
  // 承重性质是 **fail-closed**：不得静默退回标准库。
  // ⚠️ 刻意不钉具体异常类型（当前是 NameError，`Image` 未定义；加显式守卫后会变）。
  const raised = pyEval(
    [
      'try:',
      `    pl.avg_luma_pil(r"${files.white}")`,
      '    print("NO-RAISE")',
      'except Exception as e:',
      '    print(type(e).__name__)',
    ].join('\n'),
  ).trim()
  expect(raised, '无 Pillow 时 avg_luma_pil 必须**显式抛错**（fail-closed），不得静默退回标准库').not.toBe(
    'NO-RAISE',
  )
}

beforeAll(() => {
  havePIL = pyEval('print(pl._HAVE_PIL)') === 'True'
  dir = mkdtempSync(join(tmpdir(), 'pngluma-'))
  // 故意收 Buffer | string：非法输入（非 PNG 纯文本、0 字节）本身就是 fixture 的一部分。
  const put = (name: string, data: Buffer | string) => {
    const p = join(dir, name)
    writeFileSync(p, data)
    return p
  }
  // 上半黑、下半白
  files.halves = put('halves.png', encodePngOpts({ w: S, h: S, colorType: 2, px: halves(BLACK, WHITE) }))
  // 纯白（两路都应为 255）
  files.white = put('white.png', encodePngOpts({ w: S, h: S, colorType: 2, px: solid(2, WHITE) }))
  // 纯红：BT.601 = 0.299*255 = 76.245 ⇒ PIL 取整 76
  files.red = put('red.png', encodePngOpts({ w: S, h: S, colorType: 2, px: solid(2, [255, 0, 0]) }))
  // 灰度 color type 0，值 200
  files.gray = put('gray.png', encodePngOpts({ w: S, h: S, colorType: 0, px: solid(0, [200]) }))
  // 灰度+alpha color type 4，灰度 120、alpha 0
  files.grayAlpha = put('graya.png', encodePngOpts({ w: S, h: S, colorType: 4, px: solid(4, [120, 0]) }))
  // RGBA color type 6，RGB 白、alpha 0（必须**丢弃** alpha、不能合成）
  files.rgba = put('rgba.png', encodePngOpts({ w: S, h: S, colorType: 6, px: solid(6, [255, 255, 255, 0]) }))
  // 非法输入
  files.notPng = put('not.png', '这不是 PNG'.repeat(64))
  files.empty = put('empty.png', '')
  // 截断的合法 PNG：砍掉尾巴一半。magic 完整 ⇒ `Image.open` **成功**，失败发生在
  // 之后的 convert/crop ⇒ 与「不是图片」是**两类失败**，措辞不统一是有据的。
  files.truncated = put(
    'truncated.png',
    encodePngOpts({ w: S, h: S, colorType: 2, px: solid(2, WHITE) }).subarray(
      0,
      Math.floor(encodePngOpts({ w: S, h: S, colorType: 2, px: solid(2, WHITE) }).length / 2),
    ),
  )
}, 300_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

/** 解析 stdout 首行 `mean sd sat  path`（bash 的 `awk '$1'/'$2'/'$3'` 依赖这个格式）。 */
function parseHead(r: Run): [number, number, number] {
  const m = r.stdout.match(/^\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+/)
  expect(m, `stdout 首行格式应为「mean sd sat path」，实际 ${JSON.stringify(r.stdout)}`).not.toBeNull()
  return [Number(m![1]), Number(m![2]), Number(m![3])]
}

describe('png-luma.py · 区域真的过滤像素（口径错 = 上游整张表全错）', () => {
  it('上半黑 / 下半白：整幅 127.5，上半 0，下半 255', () => {
    const [all] = parseHead(run(files.halves))
    const [top] = parseHead(run('--region=0,0,1,0.5', files.halves))
    const [bot] = parseHead(run('--region=0,0.5,1,1', files.halves))
    expect(all, '整幅应是上下两半的平均').toBeCloseTo(127.5, 1)
    expect(top, '上半区域必须只取到黑').toBeCloseTo(0, 1)
    expect(bot, '下半区域必须只取到白').toBeCloseTo(255, 1)
  })

  it('区域写反 ⇒ 上下互换（钉住「参数顺序」而非只钉「有过滤」）', () => {
    const [a] = parseHead(run('--region=0,0,1,0.5', files.halves))
    const [b] = parseHead(run('--region=0,0.5,1,1', files.halves))
    expect(a, '两个区域的结果不能相同，否则说明 y0/y1 被忽略或写反了').not.toBe(b)
  })

  it('区域写错 ⇒ rc 2（不是静默取整幅）', () => {
    const r = run('--region=0,0,1', files.halves)
    expect(r.rc, `区域要 4 个比例值，实际 ${r.stderr}`).toBe(2)
  })
})

describe('png-luma.py · color type 与 alpha 语义（docstring 记着的潜伏缺陷）', () => {
  it('灰度（color type 0）：luma = 灰度值、饱和度 = 0、标准差 = 0', () => {
    // 潜伏缺陷形态：灰度只有 1 通道，按 RGB 取值会**读到下一个像素**，
    // 均值/标准差取错、饱和度恒不为 0，而且**不报错**。
    const [mean, sd, sat] = parseHead(run(files.gray))
    expect(mean, '灰度图的亮度必须等于灰度值本身').toBeCloseTo(200, 1)
    expect(sd, '纯色灰度图标准差应为 0').toBeCloseTo(0, 1)
    expect(sat, '灰度图饱和度必须为 0（恒不为 0 就是跨像素取值的症状）').toBeCloseTo(0, 1)
  })

  it('灰度+alpha（color type 4）：alpha 丢弃，luma 仍等于灰度值', () => {
    const [mean, , sat] = parseHead(run(files.grayAlpha))
    expect(mean, '灰度+alpha 的亮度应等于灰度值 120').toBeCloseTo(120, 1)
    expect(sat, '灰度+alpha 饱和度应为 0').toBeCloseTo(0, 1)
  })

  it('RGBA（color type 6）：alpha **丢弃**、不合成 ⇒ 与同色不透明图完全一致', () => {
    const [rgbaMean, , rgbaSat] = parseHead(run(files.rgba))
    const [rgbMean, , rgbSat] = parseHead(run(files.white))
    // 若把 alpha 参与统计或做合成，alpha=0 的白会被拉向黑 ⇒ 两者不等。
    expect(rgbaMean, 'alpha 必须被丢弃（合成会让 alpha=0 的白变成黑）').toBeCloseTo(rgbMean, 2)
    expect(rgbaSat, 'alpha 不参与饱和度').toBeCloseTo(rgbSat, 2)
  })

  it('真彩色的饱和度 = max−min（钉住通道取值顺序）', () => {
    const [, , sat] = parseHead(run(files.red))
    expect(sat, '纯红 (255,0,0) 的饱和度应为 255').toBeCloseTo(255, 1)
  })
})

describe('png-luma.py · 「没检查却报通过」的 fail-closed 守卫（本脚本要治的病）', () => {
  it('--selfcheck 缺门禁清单 ⇒ rc 2 且拒绝执行自检', () => {
    // 旧行为：打印「阈值判定不一致 0 处」并 exit 0 —— 没检查却报通过。
    const r = run('--selfcheck', files.white)
    expect(r.rc, `缺门禁清单必须拒绝自检，实际 stderr=${r.stderr}`).toBe(2)
    expect(r.stderr).toContain('缺门禁清单')
  })

  it('--preset 不配 --selfcheck ⇒ rc 2（门禁清单不是执行器）', () => {
    expect(run('--preset', files.white).rc).toBe(2)
  })

  it('--preset 与 --gates 同时给 ⇒ rc 2（别猜哪条会生效）', () => {
    expect(run('--selfcheck', '--preset', '--gates=mean:70:full', files.white).rc).toBe(2)
  })

  it('已废弃的 --thresholds ⇒ rc 2（裸数字会交叉组合出假证据）', () => {
    const r = run('--thresholds=70', files.white)
    expect(r.rc).toBe(2)
    expect(r.stderr).toContain('废弃')
  })

  it('GATE_PRESET 的四条阈值**字面量**钉死（第五轮 G4：阈值漂移曾零防线）', () => {
    // 为什么单独钉：差分测试只验「两路判定同侧」，**阈值与区域本身**无人钉。
    // 变异 `mean:70→5`、`sat:20→0`、以及把 sd/sat 区域改成整幅，都能绕过其它断言。
    //
    // ⚠️ **oracle 逐项分列，不要一句话打包**（六轮 review 更正，原注释越界了）：
    //   · `70 / 100` ⇒ **有独立依据**（第三十二轮按 37 张真实截图重标定）：
    //     顶栏中段实测 dark 上沿 **20.74** / light 下沿 **124.76** ⇒ 余量 49.26 / 24.76。
    //     ⚠️ `100` 不是「随手取整」：FAB 展开态的 scrim 把亮色**精确减半**
    //     （5.2.0 249.53→124.76、6.3.0 250.00→125.00，系数两版本各测一次都是 0.5000），
    //     原 `140` 高于下沿 15.24 ⇒ 必然误判那两张。
    //   · `20 / 20`（sd / sat）⇒ 阈值有依据（§4 余量表 12.91/20.88；登录页 7.00/25.02），
    //     且被 `captureScriptInvariants` ④ 的 `documented` 字面量钉住。
    //   · **两段区域坐标** ⇒ 均值/标准差/饱和度三段里，**mean 段这次有了独立来源**
    //     （顶栏中段 = app 自己的表面色，不随系统主题变；⚠️ 它**不是纯色**——含状态栏
    //     图标，32 张实测 sd 3.86~18.25，故「纯表面色」只能用于**均值**论证，不能用于 sd）；
    //     sd/sat 两段仍是从当前值抄下来的（characterization）。
    //     ⚠️ 不要把「采集脚本里也硬编码了同值」当防线：那是**又一份副本**，不是校验。
    //     跨文件等式在 `captureScriptInvariants` ④（第三/四份副本）与 ③（MODE_BAND）；
    //     本条只保证 `GATE_PRESET` 自己不被改。与 `sat` 区域那一份副本同构，仍未纳等式。
    //
    // ⚠️ 顺带更正一条**假断言**：原注释说「④ 是等式，两边同时漂移时照样绿」。**不成立** ——
    //    ④ 另有 `documented` 字面量（70/100/20/20），三处同时漂移时它**仍转红**
    //    （六轮 Spec 实测）。④ 从来就不是「只钉等式」。
    const spec = PL.match(/GATE_PRESET\s*=\s*\(([\s\S]*?)\n\)/)!
    const gates = [...spec[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('').split(';')
    expect(gates).toHaveLength(4)
    expect(gates, 'mean 70/100 ← DARK_MAX/LIGHT_MIN（顶栏中段口径，37 张真图实测）').toEqual([
      'mean:70:0.20,0.02,0.80,0.09',
      'mean:100:0.20,0.02,0.80,0.09',
      'sd:20:0.05,0.10,0.95,0.78',
      'sat:10:0.80,0.84,0.96,0.94', // 第二十六轮按 6.3.0 重标定（登录态 14.16 / 登录页 6.11）
    ])
  })

  it('未知开关 ⇒ rc 2（不认领的开关等于没开）', () => {
    const r = run('--no-such-flag', files.white)
    expect(r.rc).toBe(2)
    expect(r.stderr).toContain('未知开关')
  })

  it('不给文件 ⇒ rc 2', () => {
    expect(run().rc).toBe(2)
  })
})

describe('png-luma.py · 两套实现的「判定一致」不变式（差分测试）', () => {
  it('--selfcheck --preset：判定一致（双路在）/ 拒绝自检（单路无 Pillow）', () => {
    // 本脚本同时有 Pillow（C 实现）与标准库（纯 Python 逐像素 unfilter）两条路径，
    // 数字**必然**对不齐（实测最大 5.07），不变式是**判定落在阈值同一侧**。
    if (!havePIL) {
      // 只有一条实现 ⇒ 差分**按设计不可做**。此时契约是**拒绝**，不是「报 0 处不一致」。
      const r = run('--selfcheck', '--preset', files.halves)
      expect(r.rc, '无 Pillow 时自检必须拒绝（rc 1）').toBe(1)
      expect(r.stderr).toContain('无 Pillow')
      return
    }
    for (const f of [files.halves, files.white, files.red, files.gray, files.rgba]) {
      const r = run('--selfcheck', '--preset', f)
      expect(r.rc, `${f} 双路径判定不一致：${r.stderr}`).toBe(0)
      expect(r.stderr).toContain('判定不一致 0 处')
    }
  }, 120_000)

  it('自检真的逐条打印了门禁（不是空转 ⇒ 证明比对发生过）', () => {
    if (!havePIL) {
      // 无 Pillow 时它**必须**在比对之前就停，而不是打完 0 条再报绿。
      const r = run('--selfcheck', '--preset', files.halves)
      expect(r.stderr, '无 Pillow 时不得出现任何门禁比对行').not.toMatch(/PIL=.*stdlib=/)
      return
    }
    const r = run('--selfcheck', '--preset', files.halves)
    expect(r.stderr, '自检输出里应能看到它比了哪几条门禁、两边各是多少').toMatch(/mean\s+阈值/)
    expect(r.stderr).toMatch(/PIL=.*stdlib=.*Δ=/)
  }, 120_000)
})

describe('png-luma.py · 标准库路径（CLI 走不到的那条，必须单独钉）', () => {
  // ⚠️ 写完门禁跑变异才发现的**自己的漏洞**：CLI 的 `probe()` 在装了 Pillow 的机器上
  //   永远走 Pillow 路径，`_stats_from_pixels()` 里的灰度分支**一次都没执行过** ——
  //   也就是说「灰度按 RGB 取值会跨像素」这个 docstring 记着的潜伏缺陷，
  //   在只跑 CLI 的门禁下**根本测不到**（变异 `gray = False` 全绿）。
  //   判据准 ≠ 门禁有效：判据得在它**真正会被调到**的那一刻被跑。
  // 这里直接 import 模块调 `avg_luma`（标准库实现），不经过 probe/Pillow。

  it('标准库路径下灰度图同样是 luma=200 / sat=0 / sd=0', () => {
    const out = pyEval(`print(*[round(v, 3) for v in pl.avg_luma(r"${files.gray}")])`)
    const [mean, sd, sat] = out.split(' ').map(Number)
    // 若灰度按 RGB 取值：1 通道的缓冲被按 3 字节读 ⇒ 均值错、**饱和度恒不为 0**。
    expect(sat, '标准库路径的灰度饱和度必须为 0（恒不为 0 = 跨像素取值的症状）').toBeCloseTo(0, 3)
    expect(mean, '标准库路径的灰度亮度应等于 200').toBeCloseTo(200, 1)
    expect(sd, '标准库路径的纯色图标准差应为 0').toBeCloseTo(0, 3)
  })

  it('标准库路径的区域过滤与 Pillow 路径一致（差分）', () => {
    const out = pyEval(
      `a = pl.avg_luma(r"${files.halves}", (0.0, 0.0, 1.0, 0.5))[0]; b = pl.avg_luma(r"${files.halves}")[0]; print(round(a, 3), round(b, 3))`,
    )
    const [top, all] = out.split(' ').map(Number)
    expect(top, '标准库路径取上半（纯黑）应得 0').toBeCloseTo(0, 1)
    expect(all, '整幅应是 127.5').toBeCloseTo(127.5, 1)
  })

  it('两套实现在灰度图上**判定一致**（差异测试：Pillow vs 标准库）', () => {
    // ⚠️ 无 Pillow 时这条**按设计不可做**（只有一条实现）。此时断言的是脚本的拒绝，
    //    不是「跳过」—— skip 等于让「双实现不变式」在某些机器上永远无人验证。
    if (!havePIL) {
      const r = run('--selfcheck', '--preset', files.gray)
      expect(r.rc, '无 Pillow 时双路径自检必须拒绝').toBe(1)
      expect(r.stderr).toContain('无 Pillow')
      return
    }
    const out = pyEval(
      `print(*[round(a - b, 3) for a, b in zip(pl.avg_luma_pil(r"${files.gray}"), pl.avg_luma(r"${files.gray}"))])`,
    )
    const [dMean, dSd, dSat] = out.split(' ').map(Number)
    // 纯色图上两路应当**完全一致**（PIL 的 convert("L") 取整不改变常数色）。
    expect(dMean, `两路灰度亮度不一致 Δ=${dMean}`).toBeCloseTo(0, 1)
    expect(dSat, `两路灰度饱和度不一致 Δ=${dSat}`).toBeCloseTo(0, 3)
  })
})

describe('png-luma.py · 失败路径必须显式暴露（禁静默降级）', () => {
  it('非 PNG ⇒ rc 1，且**两路**给逐字相同的诊断（同一次运行里真的比较了两条实现）', () => {
    const r = run(files.notPng)
    expect(r.rc, `非法输入应非 0，实际 stdout=${r.stdout}`).toBe(1)
    expect(r.stderr).toContain('not.png')
    // ⚠️ 这条断言在写门禁时**先红了**，暴露了一个真缺陷：Pillow 路径抛的是它自己的
    //   UnidentifiedImageError（cannot identify image file），标准库路径给的是
    //   「<path> 不是 PNG」—— 装了 Pillow 的机器与没装的机器**诊断文案不同**，
    //   下游任何按整句 grep 的消费者会静默失配。
    expect(r.stderr, '两路解码失败必须给同一句诊断').toContain('不是 PNG')
    // ⚠️ 只 toContain('不是 PNG') 是**子串级**校验：第五轮指出第一版 PIL 路写的是
    //   「…不是 PNG 或无法解码（UnidentifiedImageError）」——那句也含「不是 PNG」，
    //   于是「统一」其实**根本没被这条断言证过**。改成断言整句：路径之后不得再有内容。
    const tail = r.stderr.slice(r.stderr.indexOf('不是 PNG') + '不是 PNG'.length).trim()
    expect(tail, 'Pillow 路措辞必须与标准库路**逐字相同**（不能只是含同一子串）').toBe('')
  })

  it('同一次运行里**真的比较**两条实现的诊断（不再只观测一路）', () => {
    // ⚠️ 六轮 Standards 指出：上一条说「两路给同一句」，但 `run()` 经 `probe()` 每次
    //    只观测**一路**（有 Pillow 测 Pillow、没有测标准库）——「两路相同」是**推断**
    //    出来的，不是在同一次运行里比出来的。
    // 这里直接 import 模块、分别调两条实现各拿一次 `str(exc)`，**真比较**。
    if (!havePIL) {
      // ⚠️ 这里**不能裸 return**（第七轮 Standards B-4）：裸 return 是事实上的 skip ——
      //    用例计入绿数却**零断言**，也违反硬约束 #3「禁静默降级」。
      //    真正的前置条件是 `_HAVE_PIL`（`avg_luma_pil` 是模块级 def，无 Pillow 时照样存在）。
      // ⚠️ 这一段此前是一份**逐字重复**的内联副本（第九轮 Spec 轴 F4 查实）：
      //    helper 的 docstring 声称「两处共用、杜绝改一处漏一处」，而当时**只有一个调用点** ——
      //    声明与实现不符，正是本轮在消灭的那类病。现已真的收敛到单一实现。
      expectNoPillowContract()
      return
    }
    const out = pyEval(
      [
        'def grab(fn):',
        '    try:',
        `        fn(r"${files.notPng}")`,
        '        return "NO-RAISE"',
        '    except Exception as e:',
        '        return str(e)',
        `a = grab(pl.avg_luma_pil); b = grab(pl.avg_luma)`,
        'print("SAME" if a == b else "DIFF\\nPIL:" + a + "\\nSTDLIB:" + b)',
      ].join('\n'),
    )
    expect(out, `两条实现的诊断必须逐字相同。实测：\n${out}`).toBe('SAME')
    // 且必须是「不是 PNG」这一类，不是某个偶然相同的 I/O 错误。
    const pilMsg = pyEval(
      [`try:`, `    pl.avg_luma_pil(r"${files.notPng}")`, `    print("NO-RAISE")`, `except Exception as e:`, `    print("不是 PNG" in str(e))`].join('\n'),
    )
    expect(pilMsg.trim(), 'Pillow 路必须把「非图片」判成「不是 PNG」').toBe('True')
  })

  it('I/O 错误**不得**被误诊成「不是 PNG」（六轮 Spec 阻塞项的回归防线）', () => {
    // ⚠️ 这一整类是被 `except Exception` 亲手制造出来的：宽 catch 会把「文件不存在 /
    //   是目录 / 无权限」一律报成「不是 PNG」。**误诊比崩溃更贵** —— 它把人引去查
    //   「图片格式对不对」，而真因是文件根本读不到（本脚本 :174-178 记的老病）。
    // 收窄成只 catch UnidentifiedImageError 之后，下面两条都必须**原样冒出去**。
    const missing = run(join(dir, 'definitely-missing-864.png'))
    expect(missing.rc).toBe(1)
    expect(missing.stderr, '缺失文件不得被说成「不是 PNG」').not.toContain('不是 PNG')
    expect(missing.stderr, '缺失文件应保留 I/O 语义').toMatch(/No such file|FileNotFoundError/)

    const isDir = run(dir)
    expect(isDir.rc).toBe(1)
    expect(isDir.stderr, '目录不得被说成「不是 PNG」').not.toContain('不是 PNG')
    expect(isDir.stderr, '目录应保留 I/O 语义').toMatch(/Is a directory|IsADirectoryError/)

    // 反过来：真正的「不是图片」仍必须走那条统一措辞，别把收窄做过头。
    expect(run(files.notPng).stderr, '非图片仍应说「不是 PNG」').toContain('不是 PNG')
  })

  it('异常链保留 __cause__（注释里那句话有人验）', () => {
    // 脚本注释写「异常类型挂在 __cause__ 上，traceback 仍能看到」（png-luma.py:235）。
    // 第七轮 Spec 轴 F5 指出**没有任何测试断言它** —— 注释自证未被验证。
    // 承重性质：窄化后抛出的 ValueError 必须**带着**底层异常，否则诊断信息断链。
    if (!havePIL) {
      // ⚠️ 曾是**裸 return**（第八轮 Standards F-1）：那正是我否掉前几处时用的同一句话，
      //    而那个理由不成立 —— 那边覆盖的是脚本「拒绝自检」，与本条的 __cause__ 无关。
      //    零断言却计入绿数，无 Pillow 环境下 0ms 空转。
      expectNoPillowContract()
      return
    }
    const out = pyEval(
      [
        'try:',
        `    pl.avg_luma_pil(r"${files.notPng}")`,
        '    print("NO-RAISE")',
        'except ValueError as e:',
        '    c = e.__cause__',
        '    ref = None',
        '    try:',
        `        pl.Image.open(r"${files.notPng}")`,
        '    except Exception as ex:',
        '        ref = ex',
        '    print(c is not None, c is not None and type(c) is type(ref))',
      ].join('\n'),
    ).trim()
    // ⚠️ **不钉具体异常类名**：那是第三方（Pillow）实现细节，改个类名就红不是回归。
    //    脚本注释的断言是「异常类型挂在 __cause__ 上」⇒ 承重性质就是 **cause 存在**。
    //    判别力靠变异保证：去掉 `raise … from exc` 的 from ⇒ 本条转红。
    expect(out, 'ValueError 必须带 __cause__，且它就是 Image.open 实抛的那个 —— 否则注释里那句话是假的').toBe(
      'True True',
    )
  })

  it('截断 PNG 不在「两路措辞相同」的承诺范围内（别过度声称）', () => {
    // `Image.open` 对截断 PNG **成功**（magic 完整），失败发生在之后的 convert/crop。
    // 两路消息本就不同（Pillow「image file is truncated」vs 标准库「zlib Error -5」），
    // 所以脚本注释只承诺「非图片」那一类统一 —— 这里把**实际行为**钉住，防止有人
    // 日后为了「统一」把截断也硬掰成同一句（那会丢掉真正的诊断信息）。
    const r = run(files.truncated)
    expect(r.rc, '截断必须是失败').toBe(1)
    expect(r.stderr, '截断不得被误诊成「不是 PNG」').not.toContain('不是 PNG')
  })

  it('0 字节文件 ⇒ rc 1（不是静默返回 0）', () => {
    const r = run(files.empty)
    expect(r.rc, '0 字节文件不能被当成「空统计」静默通过').toBe(1)
  })

  it('文件不存在 ⇒ rc 1 且 stderr 含路径', () => {
    const r = run(join(dir, 'definitely-missing.png'))
    expect(r.rc).toBe(1)
    expect(r.stderr).toContain('definitely-missing.png')
  })
})
