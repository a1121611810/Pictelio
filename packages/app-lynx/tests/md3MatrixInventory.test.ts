/**
 * scripts/md3-matrix-inventory.py 的**行为**门禁（第五轮新增，堵 N4 的第二半）。
 *
 * ## 为什么它也缺门禁
 *
 * 全仓 grep：它此前**从未被任何测试 spawn 过**（零程序化调用方、零测试）。而它正是
 * §4「机器证据」那张表的**唯一生成者** —— 文档里那张表现在能被逐字节复算，靠的是
 * 没人改它；一旦有人改，它会静默产出另一张表，而**没有任何门禁会响**。本轮把它的
 * 明暗判据换过两次（整幅 → 底部带 → **顶栏中段**），若没有行为测试，这条判据的正确性完全依赖
 * 「我刚跑过一次」。
 *
 * ## 它要挡的四类缺陷（都对应真实发生过的形态）
 *
 * | # | 缺陷形态 | 真实来源 |
 * |---|---|---|
 * | 1 | **把点开头的过程产物收进证据表** | 采集脚本把中间态写在同一目录（.login.png / .nav.png / .probe.png），glob("*.png") 会一并收进来，让「共 N 张」虚高 |
 * | 2 | 「合法非空」列**承诺了却没做** | 原实现漏了，读者以为表里有、实际没有 |
 * | 3 | 模式段解析**匹配不上** ⇒ 明暗列整列为空 | 屏宽轴文件名里模式前面隔着尺寸，正则写成 ^w- 就一张都匹配不上（上一轮 S-2） |
 * | 4 | 不一致时**退出码为 0** | 门禁只看输出不看 rc ⇒ 假绿 |
 *
 * ## 判别力自证（反事实）
 *
 * 静态断言最容易同义反复；本文件每条都做了变异（**先回读确认注入行数**再跑测试，
 * 变异没生效的「绿」一律不作数）。下表 11 个变异全部被抓住：
 *
 * | 变异 | 手法 | 结果 |
 * |---|---|---|
 * | N1 | 点开头过滤改成永匹配不到的前缀（过程产物进表） | **1 条红** |
 * | N2 | `MODE_RE` 退回 `^w-`（屏宽轴模式段匹配不上 = 上一轮 S-2） | **2 条红** |
 * | N3 | 「合法非空」恒为 ✅（承诺了不做） | **1 条红** |
 * | N4 | 退出码恒 0（有不一致也报成功） | **5 条红** |
 * | N5 | 去掉 try/except 兜底（回到「一张坏图打断整表」） | **2 条红** |
 * | W4 | `has = csd >= MIN_CONTENT_SD` → `has = True` | **1 条红** |
 * | W2 | **一致地**删掉「有内容」整列（表头+数据行+分隔行） | **2 条红**（`cell()` 找不到该列 + 表头断言） |
 * | W2b | 只删表头、数据行留着（列数对不上） | **9 条红**（`cells.length` 守卫） |
 * | Z3 | `cell()` 的 `有内容` 索引指向别的列 | **1 条红** |
 * | R1 | 表头把「顶栏亮度」与「内容区标准差」两个**标签对调**（数据行不动） | **1 条红**（实测） |
 * | R1b | 表头与数据行**一致**地对调两个测量列 | **0 条红，且不该红**（实测） |
 *
 * ⚠️ **R1b 是无效变异**（第三十二轮实测复算，此前这里写「2 条红」是**没量就写**）：
 * 表头与数据行**一致**对调之后，两列仍**各归其位** —— 按列**名**读到的仍是
 * 「顶栏亮度≈19 / 内容区标准差≈127」，数据正确性没有破坏。真正被破坏的只有**列序**，
 * 而「列序是契约」目前**没有独立的列序断言**（R1 抓的是「名与值错位」，
 * 与「两列整体换位」是两件事）。
 * ⇒ 若要让列序也成为契约，需要一条独立的断言（例如钉住 COLS 的**逐项次序**，
 *   而不只是「列名齐全」的集合语义）。**已登记，未做** —— 补它要先决定
 *   「换序算不算缺陷」，那是口径问题不是实现问题。
 *
 * ⚠️ **第一版这张表把 N1/N2 写成「10 条红」，是错的**（第五轮 finding G2）——
 * 当时的变异**太钝**：N1 把生成器里的条件换成 `if False`，于是 `files` 恒为空，
 * 整支脚本对任何输入都输出「没有 PNG」，于是**全部**用例转红。
 * 「红得多」在这里**不是**「钉得牢」的证据 —— 钝变异只会证明脚本坏了。
 * 上表是换成**精准变异**（只让点开头文件被收进来 / 只让屏宽轴匹配不上）后重测的实测值，
 * 与审查方独立复现的数字一致（N1=1、N2=2）。
 * ⚠️ 同一条纪律的后遗症（本轮又中一次）：**N5 只有在精准变异下才是 2 条红**。
 * 第一版把 try 块换成 if True（留下悬空 except）⇒ Python SyntaxError ⇒ 全支红，
 * 那是**钝变异**。改成 except Exception → except ZeroDivisionError（语法合法、
 * 只让真异常逃逸）才精确得到 2 条红。**照字面复现本表任何一行之前，先确认变异是精准的。**
 *
 * ## 写门禁时**发现并修掉的真缺陷**（不是补测试，是补脚本）
 *
 * 1. **一张坏图打断整张表**：旧实现直接 `probe()`，遇到非 PNG/截断就抛 traceback 退出，
 *    输出是**半张表** —— 而「合法非空」列的存在意义恰恰是**报出**坏图。
 *    截断 PNG 最阴险：magic 齐全 ⇒ 那一列还是 ✅，只有真正解码才暴露。
 *    已改成逐张兜住、坏图照印一行（测量列留 `—`）并计入不一致。
 * 2. 顺带：两处 fixture 自身的设计错 —— ① 整张纯色 ⇒ `sd=0 < MIN_CONTENT_SD`，
 *    全表被判「无内容」，看起来像脚本坏了（判定区与内容纹理必须**分别构造**）；
 *    ② 表格列索引按「8 列在 1..8」数，写成 3/6/7 全是 off-by-one。
 *    两次都是**先红后查**才发现的，不是靠推理。
 *
 * ## 第五轮 finding G1：「有内容」整列**零断言**（已补）
 *
 * cell() 声明了「有内容」档位与索引 8，但**全文件没有一处调用它** ⇒
 * 把 has = csd >= MIN_CONTENT_SD 改成 has = True、或把该列从表头与数据行整个删掉，
 * 整支仍绿。而这条判据正是「防**合法 PNG 的空白页**冒充视觉证据」，
 * 属 §4 表格的**三条主判据之一**。已补：纯色图 ⇒「有内容」= ❌ 且 rc 1，
 * 并让表头**八个列名**逐个被断言（W2 从此转红）。
 * N3 当初能被抓**纯属侥幸** —— 只因「合法非空」那列恰好被断言了。
 *
 * ## fixture 溯源
 *
 * 图片在测试里现画（helpers/rasterCanvas），不提交二进制 PNG。颜色**取自真机实测**
 * 而不是随手编的黑白 —— 编色值会让症状指向错误的根因（曾发生过：编的灰度与实测差
 * 38 < 阈值，阳性 fixture 以「宽度 0」被拒，看起来像脚本被我改坏了）。
 * 真机像素（emulator-5554 / 6.3.0 / 720×1280）：暗色表面 (16,20,24)、亮色 (248,250,255)，
 * 顶栏中段实测 dark 19.00 / light 250.00 ⇒ 距 DARK_MAX=70 余 51.00、距 LIGHT_MIN=100 余 150.00，
 * 不会被 fixture 抖动吃掉阈值余量。
 * 尺寸取 100×200：标准库路径是纯 Python 逐像素循环，小图才跑得动。
 *
 * 复现命令：cd packages/app-lynx && pnpm vitest run tests/md3MatrixInventory.test.ts
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { encodePngOpts } from './helpers/rasterCanvas'

const SCRIPT_REL = 'scripts/md3-matrix-inventory.py'
const rootDir = resolve(__dirname, '..')

const W = 100
const H = 200

function pythonBin(): string {
  for (const bin of ['python3', 'python']) {
    if (spawnSync(bin, ['-c', 'import sys; sys.exit(0)'], { encoding: 'utf8' }).status === 0) return bin
  }
  throw new Error('md3MatrixInventory 门禁需要 python3 —— 本门禁**故意不 skip**。')
}

/** 内容区有黑白条纹（⇒ 标准差达标），**顶栏中段整片**给定色（⇒ 决定明暗判定）。
 *
 *  ⚠️ 这两个区域**必须分别构造**，踩过一次：整张纯色 ⇒ 判定区对了但 `sd = 0 <
 *  MIN_CONTENT_SD(20)` ⇒ 被判「无内容」，整表一律 ❌，看起来像脚本坏了。
 *  内容纹理（黑白 20px 条纹）只影响「有内容」列，顶带颜色只影响「模式一致」列。
 *
 *  ⚠️⚠️ 判定区**第三十二轮从底部 7%（y 0.93~1.00）改成顶栏中段（y 0.02~0.09）**：
 *  底部那一段在 Android 上整片是**系统导航栏**，跟系统主题走而不跟 app 主题 ⇒
 *  app 暗 + 系统亮时实测 227.68，被判成「亮」（静默不报错）。
 *  这里是同一处改动的 fixture 侧 —— 画错区域的现象是「dark fixture 读出亮色值」，
 *  **看起来像阈值坏了，其实是 fixture 还停在旧区域**。
 */
const MODE_Y0 = Math.floor(H * 0.02)
const MODE_Y1 = Math.ceil(H * 0.09)
function bandedPng(band: [number, number, number]): Buffer {
  const px = new Uint8Array(W * H * 3)
  for (let y = 0; y < H; y++) {
    const c = y >= MODE_Y0 && y < MODE_Y1 ? band : Math.floor(y / 20) % 2 === 0 ? WHITE : BLACK
    for (let x = 0; x < W; x++) px.set(c, (y * W + x) * 3)
  }
  return encodePngOpts({ w: W, h: H, colorType: 2, px })
}

/** 真机暗色表面像素 (16,20,24) —— 顶带实测 19.00。 */
const DARK: [number, number, number] = [16, 20, 24]
/** 真机亮色表面像素 (248,250,255) —— 顶带实测 250.00。 */
const LIGHT: [number, number, number] = [248, 250, 255]
/** 内容区条纹用的两色（只影响「有内容」列，不影响模式列）。 */
const BLACK: [number, number, number] = [0, 0, 0]
const WHITE: [number, number, number] = [255, 255, 255]
/** 落在死区 (DARK_MAX=70, LIGHT_MIN=100) **正中**的灰 ⇒ 两种模式都判「不一致」。
 *
 *  ⚠️ 第三十二轮从 127 改成 85：`LIGHT_MIN` 由 140 降到 100 之后，127 已经 >100
 *  ⇒ 会被判成「亮」，这条用例就测不到死区了。取 85 = (70+100)/2 居中。
 *  真实 37 张里**没有**任何值落在 (70,100)（实测空档 [20.74, 124.76]）——
 *  正因为真实数据够宽，死区才允许留空；这个灰是**专门为测死区**造的，不是「实测值」。
 */
const AMBIGUOUS: [number, number, number] = [85, 85, 85]

/** **整张纯色**图：底带与内容区同色 ⇒ 内容区标准差 = 0 < MIN_CONTENT_SD。
 *
 *  这是「合法 PNG 的空白页」的合成形态 —— §4 表格的**三条主判据之一**就是防它冒充证据。
 *  ⚠️ 与 `bandedPng` 相反：这里**故意不给内容纹理**，否则测的就不是「无内容」那条判据了。
 *  第五轮 finding G1：这一列此前**零断言**（`cell()` 声明了 `有内容` 档位却无人调用），
 *  把 `has = csd >= MIN_CONTENT_SD` 改成 `has = True` 全支仍绿 ⇒ 判据可被静默废除。 */
function flatPng(c: [number, number, number]): Buffer {
  const px = new Uint8Array(W * H * 3)
  for (let i = 0; i < W * H; i++) px.set(c, i * 3)
  return encodePngOpts({ w: W, h: H, colorType: 2, px })
}

const dirs: string[] = []

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

interface Run {
  rc: number
  stdout: string
  stderr: string
}

function runIn(dir: string, ...args: string[]): Run {
  const res = spawnSync(pythonBin(), [SCRIPT_REL, ...args, dir], { cwd: rootDir, encoding: 'utf8' })
  return { rc: res.status ?? -1, stdout: (res.stdout ?? '').trim(), stderr: (res.stderr ?? '').trim() }
}

/** 造一个只含指定文件的目录，返回目录路径。 */
function dirOf(files: Record<string, Buffer | string>): string {
  const d = mkdtempSync(join(tmpdir(), 'md3inv-'))
  dirs.push(d)
  for (const [name, data] of Object.entries(files)) {
    writeFileSync(join(d, name), typeof data === 'string' ? data : Buffer.from(data))
  }
  return d
}

/** 取某一列。**列号从表头本身推导**，不写死 4/7/8。
 *
 * ⚠️ 六轮 review 实测的洞：写死索引 + 只用 toContain 断言表头（集合语义、不锁列序）
 *    ⇒ 把表头里两个测量列的**标签对调**（数据行不动），**全支仍全绿**，
 *    而 §4 那张表会印出「内容区标准差 24.1」—— 那个数其实是**顶栏带**读数。
 *    §8.6 整段论证（判定区 19.00–20.74 vs 内容区 sd 20.88）正建立在这两个数不串台之上。
 *    从表头推导索引 = 列序跟着表头走，对调标签时断言随之转红。 */
function cell(
  out: string,
  file: string,
  col: '合法非空' | '顶栏亮度' | '内容区标准差' | '模式一致' | '有内容',
): string {
  const lines = out.split('\n')
  const cols = lines[0].split('|').map((s) => s.trim())
  // 表头行与数据行的 split 结构**完全相同**（[0]/[n] 是首尾空串，数据列落在 1..n），
  // 所以同一个下标直接可用 —— 别加 1（加了就整体错位一列，会静默取到隔壁列的值）。
  const idx = cols.indexOf(col)
  expect(idx, '表头里没有「' + col + '」这一列：' + lines[0]).toBeGreaterThan(0)
  const line = lines.find((l) => l.startsWith('|') && l.includes(file))
  expect(line, '输出里没有 ' + file + ' 那一行：\n' + out).toBeDefined()
  const cells = line!.split('|').map((s) => s.trim())
  expect(cells.length, '数据行列数与表头不一致（表头改了、数据行没改？）').toBe(cols.length)
  return cells[idx]
}

const TIMEOUT = 120_000

describe('md3-matrix-inventory.py · 证据表的基本盘', () => {
  it('一致的目录 ⇒ rc 0、逐行全 ✅、末尾报「不一致 0 张」', () => {
    const d = dirOf({
      'w-1080x2160-dark-feed.png': bandedPng(DARK),
      'pg-light-01-feed.png': bandedPng(LIGHT),
    })
    const r = runIn(d)
    expect(r.rc, '应全绿。stderr=' + r.stderr).toBe(0)
    expect(r.stdout).toContain('共 2 张，不一致 0 张')
    expect(cell(r.stdout, 'w-1080x2160-dark-feed.png', '模式一致')).toBe('✅')
    expect(cell(r.stdout, 'pg-light-01-feed.png', '模式一致')).toBe('✅')
  }, TIMEOUT)

  it('模式段对**三个轴**都要解析得出（屏宽轴模式前隔着尺寸，是上一轮 S-2 的坑）', () => {
    const d = dirOf({
      'w-720x1280-dark-feed.png': bandedPng(DARK),
      'w-1440x2560-light-me.png': bandedPng(LIGHT),
      'p-pal3-dark-feed.png': bandedPng(DARK),
      'p-pal5-light-feed.png': bandedPng(LIGHT),
      'pg-dark-01-feed.png': bandedPng(DARK),
      'pg-light-02-novel.png': bandedPng(LIGHT),
    })
    const r = runIn(d)
    expect(r.rc, '六个文件名都应解析出明暗。stderr=' + r.stderr).toBe(0)
    for (const f of ['w-720x1280-dark-feed.png', 'p-pal3-dark-feed.png', 'pg-dark-01-feed.png']) {
      expect(cell(r.stdout, f, '模式一致'), f + ' 的模式列解析失败').toBe('✅')
    }
    expect(r.stdout).toContain('共 6 张，不一致 0 张')
  }, TIMEOUT)
})

describe('md3-matrix-inventory.py · 失效面必须被算成「不一致」并反映在 rc 上', () => {
  it('文件名说 dark、图是白的 ⇒ 模式一致 ❌ 且 rc 1', () => {
    const d = dirOf({ 'pg-dark-01-feed.png': bandedPng(LIGHT) })
    const r = runIn(d)
    expect(cell(r.stdout, 'pg-dark-01-feed.png', '模式一致')).toMatch(/❌/)
    expect(r.rc, '有不一致时退出码必须非 0，否则门禁只看输出会假绿').toBe(1)
    expect(r.stdout).toContain('不一致 1 张')
  }, TIMEOUT)

  it('非 PNG / 0 字节 ⇒ 「合法非空」❌ 且计入不一致', () => {
    const d = dirOf({
      'pg-dark-01-feed.png': bandedPng(DARK),
      'pg-light-01-feed.png': '这不是 PNG'.repeat(64),
      'pg-light-02-me.png': '',
    })
    const r = runIn(d)
    expect(cell(r.stdout, 'pg-light-01-feed.png', '合法非空'), '非 PNG 必须被标出来').toBe('❌')
    expect(cell(r.stdout, 'pg-light-02-me.png', '合法非空'), '0 字节必须被标出来').toBe('❌')
    expect(r.rc).toBe(1)
  }, TIMEOUT)

  it('纯色空白页（内容区 sd=0）⇒ 「有内容」❌ 且 rc 1（第五轮 G1 的回归防线）', () => {
    // 整张纯色 ⇒ 顶带等于整幅色（dark 判据 ✅）、内容区 sd = 0。
    // 关键：它**模式是对的**，只有「有内容」这一列能揭穿它 —— 正是「合法 PNG 的
    // 空白页冒充证据」的形态。此列此前零断言，删掉判据全支仍绿。
    const d = dirOf({ 'pg-dark-01-feed.png': flatPng(DARK) })
    const r = runIn(d)
    expect(cell(r.stdout, 'pg-dark-01-feed.png', '模式一致'), '纯色暗图的模式列本身是对的').toBe('✅')
    expect(cell(r.stdout, 'pg-dark-01-feed.png', '有内容'), '内容区标准差 0 ⇒ 必须判「无内容」').toBe('❌')
    expect(r.rc, '空白页必须计入不一致（否则它会冒充一份视觉证据）').toBe(1)
    expect(r.stdout).toContain('不一致 1 张')
  }, TIMEOUT)

  it('死区灰图（顶带 85 落在 DARK_MAX 70 与 LIGHT_MIN 100 之间）⇒ 不能算「一致」', () => {
    const d = dirOf({ 'pg-dark-01-feed.png': bandedPng(AMBIGUOUS) })
    const r = runIn(d)
    // ⚠️ 断言消息必须与**现值**一致：`AMBIGUOUS` 已从 127 改为 85（见 :136）——
    //    85 落在死区 (DARK_MAX=70, LIGHT_MIN=100) 中间，两种模式都判「不一致」。
    //    写 '127 < 140' 会把失败者引向**早已废弃**的阈值。
    expect(cell(r.stdout, 'pg-dark-01-feed.png', '模式一致'), '死区灰 85 落在 70~100 ⇒ 不可能是任一模式').toMatch(/❌/)
    expect(r.rc).toBe(1)
  }, TIMEOUT)

  it('截断的 PNG（magic 齐全、只有真正解码才暴露）⇒ 不许把整表打断', () => {
    // 最阴险的一类：PNG magic 在文件头，砍掉尾巴仍以 ✅ 通过「合法非空」列，
    // 只有真正解码才暴露。旧实现在这里直接崩 ⇒ 输出半张表。
    const d = dirOf({
      'pg-dark-01-feed.png': bandedPng(DARK),
      'pg-light-01-feed.png': bandedPng(LIGHT).subarray(0, 200),
    })
    const r = runIn(d)
    expect(cell(r.stdout, 'pg-dark-01-feed.png', '模式一致'), '好图那行必须照常出现').toBe('✅')
    expect(cell(r.stdout, 'pg-light-01-feed.png', '模式一致'), '坏图那行也要印出来（留 —）').toBe('—')
    expect(r.rc, '坏图必须计入不一致').toBe(1)
    expect(r.stdout).not.toContain('Traceback')
  }, TIMEOUT)

  it('点开头的过程产物（.login.png 等）**不得**进表', () => {
    // 采集脚本把登录窗口/导航/探针的中间态截图写在同一目录，它们是**过程产物**。
    // 收进表里会让「共 N 张」虚高 —— 而矩阵结论是按张数算的。
    const d = dirOf({
      'pg-dark-01-feed.png': bandedPng(DARK),
      '.login.png': bandedPng(LIGHT),
      '.nav.png': bandedPng(LIGHT),
      '.probe.png': bandedPng(LIGHT),
    })
    const r = runIn(d)
    expect(r.stdout, '点开头的临时探针不得计入证据表').toContain('共 1 张，不一致 0 张')
    expect(r.stdout).not.toContain('.login.png')
    expect(r.rc).toBe(0)
  }, TIMEOUT)

  it('空目录 ⇒ rc 1 且说明「没有 PNG」（不是静默通过）', () => {
    const d = dirOf({})
    const r = runIn(d)
    expect(r.rc, '空目录不是「零违规」，是「没采到东西」').toBe(1)
    expect(r.stderr).toContain('没有 PNG')
  })
})

describe('md3-matrix-inventory.py · 用法错误必须 fail-closed', () => {
  it('不给目录 ⇒ rc 2', () => {
    const res = spawnSync(pythonBin(), [SCRIPT_REL], { cwd: rootDir, encoding: 'utf8' })
    expect(res.status, '缺参数应是用法错误（2）').toBe(2)
    expect(res.stderr).toContain('用法')
  })

  it('两个测量列的**值各自对得上自己的标签**（防标签对调后静默串台）', () => {
    // ⚠️ 六轮 review 实测：只断言表头**列名齐全**（集合语义）时，把「顶栏亮度」与
    //    「内容区标准差」两个**标签对调**（数据行不动），全支仍全绿 —— 而 §4 那张表会
    //    印出「内容区标准差 24.1」，那个数其实是**顶栏带**读数。
    //    ⚠️ 引用的 §8.6 选型结论第三十二轮已改写（顶带+降阈值，非底带+不动阈值）；
    //    支撑「两列不串台」的实测区间现为 判定区 **10.77~20.74** / 亮 **124.76~249.78**。
    //    `bandedPng(DARK)`：顶带是真机暗色表面 ⇒ 顶栏亮度 ≈19；内容区是黑白条纹 ⇒ 标准差 ≈127。
    //    ⚠️ 早先写「两个数差两个数量级」—— 那在旧 fixture 下是**空断言**：
    //    底带是纯黑（读数 ≈0）⇒ `sd > band*10` 退化成 `sd > 0`，恒真，串台也抓不住。
    //    换成真机色后 band ≈19、sd ≈127，比值只有 ≈6.7，「两个数量级」这句话本身是错的。
    //    串台检测改由上面两条**区间**断言承担，且更强：
    //    对调后 顶栏亮度≈127（>30 破上界）、标准差≈19（<50 破下界），**两条同时转红**。
    const d = dirOf({ 'pg-dark-01-feed.png': bandedPng(DARK) })
    const r = runIn(d)
    const band = Number(cell(r.stdout, 'pg-dark-01-feed.png', '顶栏亮度'))
    const sd = Number(cell(r.stdout, 'pg-dark-01-feed.png', '内容区标准差'))
    // 顶带读数应落在真机实测的 19.00 附近：断言**区间**而不是精确值，
    // 因为 fixture 是 100×200、抽样步长 7×11 与真机不同，逐位相等不成立也不需要。
    expect(band, '顶栏亮度必须量的是**顶栏中段**（本 fixture 用真机暗色表面 ⇒ ≈19）').toBeGreaterThan(10)
    expect(band, '顶栏亮度不得被内容纹理抬高（否则说明量错了区域）').toBeLessThan(30)
    expect(sd, '内容区标准差必须量的是**内容区**（本 fixture 是黑白条纹 ⇒ ≈127）').toBeGreaterThan(50)
    // 保留一条**相对**断言（两列确实分得开），但按实测比值定系数，不写夸大的数量级。
    expect(sd, '两列必须显著分离：实测比值 ≈6.7（19 vs 127）').toBeGreaterThan(band * 3)
  }, TIMEOUT)

  it('表头的**八个列名**都在（列名与列序是读者和下游的契约）', () => {
    const d = dirOf({ 'pg-dark-01-feed.png': bandedPng(DARK) })
    const r = runIn(d)
    const header = r.stdout.split('\n')[0]
    // 「顶栏」而不是整幅：判据口径被文档 §4 直接引用，写错会让读表的人按整幅理解数字。
    const COLS = ['截图', '轴', '声称模式', '合法非空', '顶栏亮度', '内容区标准差', '模式一致', '有内容']
    for (const c of COLS) {
      expect(header, '表头缺少列「' + c + '」—— 少一列，下面按列号取值就会整体错位').toContain(c)
    }
    expect(header.split('|').length - 2, '表头列数必须与 8 个数据列一致').toBe(COLS.length)
  }, TIMEOUT)
})
