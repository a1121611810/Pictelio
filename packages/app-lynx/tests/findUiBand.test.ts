/**
 * `scripts/find-ui-band.py` 的 `find_filled_band` 判据门禁。
 *
 * ## 为什么这个脚本需要合成 fixture（而不是「真机跑一次绿了就算」）
 *
 * 它的第 ② 步曾经有一个**潜伏缺陷**：候选带起点取「异色率剖面上向右走到
 * **严格下降处**才停」的那一行 —— 那是平台**最后一行** ⇒ `ry1` 落带底 ⇒
 * `bh = 0` ⇒ 整条带被 `min_height_ratio`（屏高 3.5%）拒掉。
 * 实心矩形的剖面顶部是**平的**，必然踩中。
 *
 * 潜伏的原因是当天那张真机图在带顶恰好有 1px 的小回落，让旧判据「碰巧」停在
 * 首行。于是「它现在是对的」与「它对所有输入都对」**完全同形** ——
 * 真机回归永远抓不到它。必须构造会发作的输入才能区分。
 *
 * 复现命令（改判据前后各跑一次，3/3 阳性由红转绿）：
 *   cd packages/app-lynx && pnpm vitest run tests/findUiBand.test.ts
 *
 * ## fixture 为什么在这里现画，而不是提交 PNG
 *
 * 提交的二进制 fixture 会陈旧：改了脚本里的阈值、换了画布尺寸、调整了圆角半径，
 * PNG 还在，但断言的期望值已经对不上了 —— 门禁要么红得莫名其妙，要么（更糟）
 * 有人顺手把期望值改成「当前输出」那就彻底失去意义。现画则每次运行都从
 * **同一份几何定义**重新生成，期望值和几何写在同一处，不可能对不上。
 *
 * ## 颜色是真机实测值，不是「挑的好看的」
 *
 * 取自 emulator-5556、1080×2160、`io.pictelio.app`「设置 → AI 作品」三段控件
 * 截图，逐像素采样（`read` PNG 后取三元组，坐标一并记在这里便于复采）：
 *   - 选中段填充   (211, 229, 245)  @ (240, 1310)
 *   - 卡片/控件底  (255, 255, 255)  @ (500, 1310)（未选中段与卡片同色，不可分辨）
 *   - 控件描边     (113, 120, 126)  @ (388, 1310) / (240, 1250)
 *   - 页面外底     (248, 250, 255)  @ (20, 300)
 *   - 段内文字     (25, 28, 32)     @ (810, 1310)
 *
 * ⚠️ 第一版这些值是**我编的**（选中段 217,234,247 / 底 242,244,250），
 * 两者色差只有 38，而 `find-ui-band.py` 的 `COLOR_DIFF = 60` ⇒ 合成 fixture 上
 * 「异色率恒为 0」，两张阳性用例以「宽 0px」被拒 —— 看着像脚本坏了，其实在验一个
 * 现实中不存在的颜色。教训：fixture 的输入同样受「期望值须来自独立真源」约束。
 *
 * ## 阴性用例的第二种同形失效：判据**归属**被更早的判据顶掉
 *
 * 上面那条讲的是「输入编了」。这里这条更隐蔽：**输入是真的、断言也绿，但它验的不是
 * 它名字声称的那条判据**。F9 声称在验「实心度能拒掉 Feed 深色缩略图」，实际被
 * `min_height_ratio` 提前拒掉了 —— 因为合成版把浅色文字画得太宽（90px），
 * 那几行整行被浅色替掉，异色率跌破 0.15 显著性门槛，带被切成 38px / 36px 两段。
 *
 * 它之所以能长期潜伏：只断言 `NOTFOUND` 时，「被 A 拒」与「被 B 拒」完全同形。
 * 真机回归也抓不到 —— 真机那条带是连续的 104px，本来就该走到第 ④ 步。
 * 只有**破坏判据看用例会不会转红**才能区分。
 *
 * 复现方式（**只改副本、绝不改仓库脚本**）：本测试按**包根相对路径**调用
 * `scripts/find-ui-band.py`，所以要在 `/tmp` 建一个沙箱包根（被变异的脚本 + 本文件 +
 * `tests/helpers/rasterCanvas.ts` + 软链 `node_modules` + 最小 `vitest.config.ts`），
 * 把 `min_uniform` 默认值改成 0.0 后 `vitest run --root <沙箱>`。
 * 修好后：破坏 `min_uniform` ⇒ F9 转红（修前：仍全绿）。
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { Canvas, encodePng, H, SCAN_Y0, SCAN_Y1, W, type RGB } from './helpers/rasterCanvas'

const SCRIPT_REL = 'scripts/find-ui-band.py'
const rootDir = resolve(__dirname, '..')

// 画布与真机同尺寸：所有判据阈值都是**屏宽/屏高比例**（15%–60% 宽、3.5% 高），
// 换尺寸就是换阈值，fixture 就不再是在验真机上标定的那套判据。
// 画布 / 扫描窗 / PNG 编码器在 `helpers/rasterCanvas.ts`（与色板门禁共用）。

const PAGE: RGB = [248, 250, 255]
const CARD: RGB = [255, 255, 255]
const FILLED: RGB = [211, 229, 245]
const OUTLINE: RGB = [113, 120, 126]
const TEXT: RGB = [25, 28, 32]
/** 真机实测：Feed 底部深色缩略图的填充色 / 其上的浅色文字（F9 负样本） */
const DARK_FILL: RGB = [46, 49, 54]
const LIGHT_TEXT: RGB = [239, 241, 247]
/**
 * 缩略图**作品区的暗部层次**（F9 负样本专用，非真机逐像素采样值，见下）。
 *
 * 为什么允许它不是采样值：它唯一需要满足的性质是**跨过两条阈值** ——
 *   - 与 `DARK_FILL` 差 48 = 2×`UNIFORM_TOL`(24) ⇒ 第 ④ 步判「不实心」；
 *   - 与页面底色差 652 > `COLOR_DIFF`(60) ⇒ 第 ① 步仍算「异色」，带**不会**被切断。
 * 具体取哪个暗色不承载任何期望值（断言只钉拒因，不钉实心度读数）。
 *
 * ⚠️ 这里**不能**改用浅色：浅色与页面底色差仅 26 < `COLOR_DIFF`(60)，
 * 宽浅色块会把整行的深色像素替掉 ⇒ 该行异色率归零 ⇒ 带被切成两段（见 F9h）。
 * 「要压低实心度又不断带」只有「仍然很暗的另一档」这一条路。
 */
const DARK_SHADE: RGB = [30, 33, 38]

/** 1080 实测：控件左缘描边 x=82，选中段右缘描边止于 x=390。 */
const CTRL_X0 = 82
const SEG_W = 306
const SEG_COUNT = 3
const CTRL_W = SEG_W * SEG_COUNT
/** 1080 实测：描边 3px，带 y=1250..1371（高 122px）。 */
const OUTLINE_PX = 3
const BAND_H = 122

interface Geometry {
  cx: number
  cy: number
  x1: number
  x2: number
  y1: number
  y2: number
}

/**
 * 画一个三段分段控件，只有 `selected` 段被填充。
 * `y0` 给的是**描边外沿**的顶。
 */
function segmentedControl(cv: Canvas, selected: number, y0: number, r: number): Geometry {
  const o = OUTLINE_PX
  // 未选中段 = 卡片同色（真机实测：段内无独立底色，只有文字），只画文字块
  cv.rect(CTRL_X0, y0, CTRL_X0 + CTRL_W - 1, y0 + BAND_H - 1, OUTLINE)
  cv.rect(CTRL_X0 + o, y0 + o, CTRL_X0 + CTRL_W - 1 - o, y0 + BAND_H - 1 - o, CARD)
  for (let i = 0; i < SEG_COUNT; i++) {
    if (i === selected) continue
    const mid = CTRL_X0 + i * SEG_W + (SEG_W >> 1)
    cv.rect(mid - 46, y0 + 48, mid + 46, y0 + 74, TEXT)
  }
  const sx0 = CTRL_X0 + selected * SEG_W + o
  const sx1 = CTRL_X0 + (selected + 1) * SEG_W - 1 - o
  cv.roundRect(sx0, y0 + o, sx1, y0 + BAND_H - 1 - o, r, FILLED)
  return {
    x1: CTRL_X0,
    x2: CTRL_X0 + (selected + 1) * SEG_W - 1,
    y1: y0,
    y2: y0 + BAND_H - 1,
    cx: (CTRL_X0 + selected * SEG_W + (CTRL_X0 + (selected + 1) * SEG_W - 1)) >> 1,
    cy: y0 + ((BAND_H - 1) >> 1),
  }
}

// ─────────────────────────────── fixture 定义 ───────────────────────────────

interface Fixture {
  name: string
  build: () => Canvas
  /** 期望检出与否 */
  found: boolean
  /** 期望中心（仅 `found` 时有意义） */
  cx: number
  cy: number
  /** 坐标容差：圆角 + 0.5 列命中阈值会把边缘削掉几像素，见文件头说明 */
  tolX: number
  tolY: number
  /** 阴性用例要断言「是哪条判据拒的」——空扫描面与真零违规不得同形 */
  rejectMustMention?: string
  /**
   * 阴性用例要断言「**不是**哪条判据拒的」。
   *
   * 为什么需要它：只钉 `rejectMustMention` 时，「带被更早的判据切成两段、一段撞高度」
   * 这种失效仍可能蒙混过关 —— 只要另一段还留下了目标判据的拒因，断言照样绿。
   * 本文件里 F9 的第一版正是死在这：它根本没走到实心度判据，却仍报 NOTFOUND。
   */
  rejectMustNotMention?: string
  /** 断言一条候选都没产生（用于钉住结构性事实，见 F5） */
  expectNoCandidate?: boolean
}

const BAND_Y = 1250 // 真机实测的带顶

const FIXTURES: Fixture[] = [
  {
    name: 'F1-leftmost-flat',
    // 方角 ⇒ 异色率剖面在整个带内**完全平坦** ⇒ 旧判据必然把 ry1 推到带末行
    build: () => {
      const cv = new Canvas(PAGE)
      segmentedControl(cv, 0, BAND_Y, 0)
      return cv
    },
    found: true,
    ...segExpected(0, BAND_Y, 0),
  },
  {
    name: 'F2-middle-rounded',
    // 中间段：真结构的**非边缘**实例
    build: () => {
      const cv = new Canvas(PAGE)
      segmentedControl(cv, 1, BAND_Y, 16)
      return cv
    },
    found: true,
    ...segExpected(1, BAND_Y, 16),
  },
  {
    name: 'F3-rightmost-rounded',
    // 最右段：另一侧的边缘实例
    build: () => {
      const cv = new Canvas(PAGE)
      segmentedControl(cv, 2, BAND_Y, 16)
      return cv
    },
    found: true,
    ...segExpected(2, BAND_Y, 16),
  },
  {
    name: 'F8-stem-then-plateau',
    // 细长竖条（60 行 × 1 个抽样列）**骑在**一个宽平台（98 行 × 26 个抽样列）正上方。
    // 真实对应物：色块/卡片上方的一条竖向指示线、细分隔条、图标竖条。
    //
    // 抓的是 `find-ui-band.py` 第 ② 步的第二个缺陷：把向右扩展的阈值种子从
    // 「峰值」换成「上升沿那一行」之后，阈值从 `0.45×0.289=0.13` 掉到
    // `0.45×0.011=0.005`（**低 26 倍**）⇒ 竖条整段被并进带里。
    // 危害不是漏检而是**多吃**：多出来的行是「部分填充」，会把 ④ 实心度压低
    // —— 真机上 0.887 的余量只有 0.037，≥6 行就 NOTFOUND。
    //
    // 期望值**不复刻 0.45×peak 那条规则**（复刻就变成影子实现，自检给假保障）：
    // 断言的是「带不该把细竖条算进去」，用**平台自己的几何中心**当独立 oracle。
    // 竖条 60 行 ⇒ 含竖条时 cy 偏低 30px，两者差得开，不会被容差吃掉。
    build: () => {
      const cv = new Canvas(PAGE)
      const y0 = 600
      const STEM = 60
      const PLATEAU = 98
      for (let r = 0; r < STEM; r++) cv.rect(200, y0 + r, 211, y0 + r, FILLED)
      cv.rect(200, y0 + STEM, 200 + 26 * 12 - 1, y0 + STEM + PLATEAU - 1, FILLED)
      return cv
    },
    found: true,
    cx: 200 + (26 * 12) / 2,
    cy: 600 + 60 + (98 - 1) / 2,
    tolX: 10,
    tolY: 8,
  },
  {
    name: 'F9-dark-thumbnail-must-reject',
    // 真实负样本：Feed 底部的**深色缩略图**。
    // 1080 实测几何 x[70..256] y[1731..1835]（186×104），众数色 (46,49,54) 铺 76%，
    // 另有 8% 浅色文字 (239,241,247) —— `find-ui-band.py` 第 ④ 步注释记的实心度 0.766。
    //
    // ⚠️ 这条用例是**踩坑记录**，不是「本来就该对」：
    //   我曾把 `min_uniform` 从 0.85 降到 0.50，理由是「负样本只有 0.01/0.25，
    //   数据空档 [0.25, 0.72]，0.50 居中」。补采负样本后立刻发现这块缩略图
    //   实心度 0.766 —— **与真阳性的下沿 0.766 完全重合** ⇒ 那条判据在原理上
    //   分不开控件与深色块，0.50 会让 3 张真实 Feed 截图全部假阳性。
    //   教训：**「数据空档」只在你采到的样本上成立**；负样本只采了 2 个就下结论，
    //   等于把「没采到」当成「不存在」。
    //
    // 保留这条用例的作用：把「这一档实心度必须被拒」钉死。将来谁想再降阈值，
    // 会先撞到这里，而不是先在真机上看到 3 张重复的 Feed 截图。
    //
    // ⚠️⚠️ 本条曾经**零判别力**：第一版把浅色「文字」画成 90px 宽的块（占缩略图宽度
    //   近一半），那几行整行被浅色替掉 ⇒ 异色率从 0.178 掉到 0.089 < 0.15 ⇒
    //   第 ② 步把带切成 y[1731..1769] / y[1799..1835] 两段（38px / 36px）⇒
    //   **在到达第 ④ 步之前**就被 `min_height_ratio`（75.6px）拒掉。
    //   症状与「真零违规」完全同形：实测把 `min_uniform` 破坏成 0（本文件仍全绿），
    //   而真机那条带是**连续的** 104px、确实走到第 ④ 步被拒
    //   （`find-ui-band.py ../../docs/research/assets/md3-visual-regression/before/
    //   04-feed-scrolled.png --explain` ⇒ `拒：y[1731..1835] 实心度 0.81 < 0.85`）。
    //   ⇒ 合成版必须复现真机的**带连续性**，否则就是在验另一条判据。
    //   现在的画法：浅色文字收窄到 24px（只吃掉 2 个抽样列，异色率 14/90 = 0.156
    //   仍 ≥ 0.15，带不被切断），压低实心度改由**仍很暗的** `DARK_SHADE` 作品层次承担。
    build: () => {
      const cv = new Canvas(PAGE)
      cv.rect(70, 1731, 256, 1835, DARK_FILL)
      cv.rect(70, 1752, 256, 1763, DARK_SHADE) // 作品区暗部：第 ① 步算异色、第 ④ 步算不实心
      cv.rect(120, 1770, 143, 1798, LIGHT_TEXT) // 8% 浅色「文字」，窄到不切断带
      return cv
    },
    found: false,
    cx: -1,
    cy: -1,
    tolX: 0,
    tolY: 0,
    // 判据归属必须钉住：真机与本 fixture 都是被**实心度**拒的（实测读数 0.80/0.81
    // 一档，都在 0.85 下方不远处）。只断言 NOTFOUND 的话，本条与 F9h 无差别。
    rejectMustMention: '实心度',
    // 反向钉住「整条带没有被自己的浅色内容切断」：若哪天带又被切成两段，
    // 拒因里会**同时**出现「带高」，那时本条就退化成 F9h，必须重新评估而不是放过。
    rejectMustNotMention: '带高',
  },
  {
    name: 'F9h-dark-block-cut-by-wide-text',
    // 上一条的第一版几何**原样保留**成独立用例：缩略图上叠一条**宽**浅色带
    // （横跨大半个宽度）⇒ 那些行整行被浅色替掉，异色率跌破 0.15 显著性门槛
    // ⇒ 带被切成 38px / 36px 两段 ⇒ 被 `min_height_ratio` 拒。
    //
    // 真实对应物：Feed 缩略图上盖了一条宽的浅色说明条 / 浅色字幕条。
    // 它与 F9 是**两条不同的拒因**，不能互相顶替 —— 把「带高不足」当成
    // 「实心度不足」来汇报，就是本文件开头记的那类同形失效。
    build: () => {
      const cv = new Canvas(PAGE)
      cv.rect(70, 1731, 256, 1835, DARK_FILL)
      cv.rect(120, 1770, 210, 1798, LIGHT_TEXT) // 90px 宽：整行深色像素被替掉
      return cv
    },
    found: false,
    cx: -1,
    cy: -1,
    tolX: 0,
    tolY: 0,
    rejectMustMention: '带高',
  },
  {
    name: 'F9b-small-pill-4char-label',
    // **已知局限，不是期望**：1440 上「界面语言 → 跟随系统」那个小药丸
    // （216×97px，4 字标签占面积 ~23%）实测实心度 0.766，与 F9 的深色缩略图同档。
    // 实心度判据无法把「带标签的小控件」与「带文字的深色块」分开，所以这里
    // **必须被拒** —— 把它写成「应检出」就是把一条已证伪的判据固化成门禁。
    //
    // 不影响采集：`capture-md3-matrix.sh` 改用**色板行**作锚点后，
    // find_filled_band 只用来量段宽，拒绝非控件不再是承重项。
    // 真要修判据见 `find-ui-band.py` 第 ④ 步的注释（换成与文字无关的量）。
    build: () => {
      const cv = new Canvas(PAGE)
      const y0 = 600
      cv.roundRect(200, y0, 200 + 216 - 1, y0 + 97 - 1, 48, FILLED)
      cv.rect(200 + 48, y0 + 28, 200 + 48 + 120 - 1, y0 + 28 + 40 - 1, TEXT)
      return cv
    },
    found: false,
    cx: -1,
    cy: -1,
    tolX: 0,
    tolY: 0,
    rejectMustMention: '实心度',
  },
  {
    name: 'F10-gradient-band',
    // 横向渐变带（64 级）—— 真实对应物是 Feed 里的作品图。
    // 实测真机负样本实心度 0.01 / 0.25（docs/research/assets/…/before/ 的 Feed 截图）。
    // 必须在任何阈值下都被拒：它是「实心度」这条判据**存在的理由**。
    build: () => {
      const cv = new Canvas(PAGE)
      for (let x = 200; x < 200 + 400; x++) {
        const t = (x - 200) / 399
        const c: RGB = [Math.round(40 + 180 * t), Math.round(120 - 60 * t), Math.round(200 - 140 * t)]
        cv.rect(x, 600, x, 699, c)
      }
      return cv
    },
    found: false,
    cx: -1,
    cy: -1,
    tolX: 0,
    tolY: 0,
    rejectMustMention: '实心度',
  },
  {
    name: 'F4-no-control',
    build: () => {
      const cv = new Canvas(PAGE)
      cv.rect(0, 300, W - 1, 900, CARD)
      for (let k = 0; k < 6; k++) cv.rect(120, 300 + k * 120, 900, 327 + k * 120, TEXT)
      return cv
    },
    found: false,
    cx: -1,
    cy: -1,
    tolX: 0,
    tolY: 0,
    rejectMustMention: '带高',
  },
  {
    name: 'F5-fullbleed',
    build: () => {
      const cv = new Canvas(PAGE)
      cv.rect(0, BAND_Y, W - 1, BAND_Y + BAND_H - 1, FILLED)
      return cv
    },
    found: false,
    cx: -1,
    cy: -1,
    tolX: 0,
    tolY: 0,
    expectNoCandidate: true,
  },
  {
    name: 'F6-two-bands-scoring',
    // 两条都合规的带，**面积大的必须胜出** —— 钉住打分路径没被第 ② 步的起点修复带偏
    // （起点修复改的是候选怎么被收集，打分仍按 `bw * bh` 取最大）。
    //
    // ⚠️ 宽度都**刻意压在 50% 屏宽以下**：第 ① 步的行背景取「该行众数色」，
    //    一旦色块铺满过半行，众数色就变成色块自己 ⇒ 异色像素数恒为 0 ⇒
    //    连候选都产生不了（F5 钉的就是这个结构性事实）。所以 600px（55%）在这里
    //    **不是**「更宽的带」，而是「看不见的带」。
    build: () => {
      const cv = new Canvas(PAGE)
      cv.rect(200, 400, 499, 499, FILLED) // 300×100 面积 30000
      cv.rect(200, 900, 649, 999, FILLED) // 450×100 面积 45000 ← 应胜出
      return cv
    },
    found: true,
    cx: 425,
    cy: 950,
    tolX: 6,
    tolY: 4,
  },
  {
    name: 'F7-band-at-window-top',
    // 带顶**正好**在扫描窗口第一行 ⇒ 钉住 `left = ratios[i-1] if i>0 else 0.0` 的边界
    build: () => {
      const cv = new Canvas(PAGE)
      segmentedControl(cv, 0, SCAN_Y0, 16)
      return cv
    },
    found: true,
    ...segExpected(0, SCAN_Y0, 16),
  },
]

/** 分段控件的期望几何（`build` 用的同一组常量，避免两处各写一遍） */
function segExpected(selected: number, y0: number, _r: number) {
  const x0 = CTRL_X0 + selected * SEG_W
  const x1 = CTRL_X0 + (selected + 1) * SEG_W - 1
  return {
    cx: (x0 + x1) >> 1,
    cy: y0 + ((BAND_H - 1) >> 1),
    // 描边 3px 会被算进带内（它与卡片底色差 > COLOR_DIFF），选中段填充被圆角削角
    tolX: 8,
    tolY: 4,
  }
}

// ─────────────────────────────── 跑脚本 ───────────────────────────────

interface RunResult {
  rc: number
  cx: number
  cy: number
  stderr: string
}

let dir = ''
const runs = new Map<string, RunResult>()

/** 找不到 python 就**硬失败**，不静默 skip —— skip 会让门禁变成永远绿的空壳。 */
function pythonBin(): string {
  for (const bin of ['python3', 'python']) {
    const probe = spawnSync(bin, ['-c', 'import sys; sys.exit(0)'], { encoding: 'utf8' })
    if (probe.status === 0) return bin
  }
  throw new Error(
    'findUiBand 门禁需要 python3 —— 找不到可用的解释器。' +
      '本门禁**故意不 skip**：skip 等于让判据回归永远绿灯。',
  )
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'uiband-'))
  const bin = pythonBin()
  for (const f of FIXTURES) {
    const png = join(dir, `${f.name}.png`)
    writeFileSync(png, encodePng(f.build().px))
    const res = spawnSync(bin, [SCRIPT_REL, png, '--csv', '--explain'], {
      cwd: rootDir,
      encoding: 'utf8',
    })
    const stdout = (res.stdout ?? '').trim()
    const m = stdout.match(/^(\d+),(\d+)$/m)
    runs.set(f.name, {
      rc: res.status ?? -1,
      cx: m ? Number(m[1]) : -1,
      cy: m ? Number(m[2]) : -1,
      stderr: res.stderr ?? '',
    })
  }
}, 120_000)

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('find-ui-band · find_filled_band 判据', () => {
  for (const f of FIXTURES) {
    it(`${f.name}：${f.found ? '应检出并落在目标段' : '应 NOTFOUND'}`, () => {
      const r = runs.get(f.name)!
      if (!r) throw new Error(`fixture ${f.name} 没有跑出结果`)
      if (!f.found) {
        expect(r.stderr, `${f.name} 必须被拒`).toContain('NOTFOUND')
        if (f.expectNoCandidate) {
          // F5：通栏色块在**第 ① 步**就被结构性抹掉 —— 行众数色取到了横幅自己的颜色，
          // 于是「异色像素数」恒为 0，一条候选都产生不了。
          // ⚠️ 这正是「离屏边」判据（`min_edge_inset_ratio`）对通栏色块**没有判别力**的
          // 原因：它压根没机会触发。若哪天有人把第 ① 步改成固定背景色，这条断言会红，
          // 那时才需要重新评估离屏边判据 —— 那是**好事**，不是回归。
          expect(r.stderr, `${f.name} 不应产生任何候选`).not.toContain('拒：')
        }
        if (f.rejectMustMention) {
          // 阴性用例必须钉住「是哪条判据拒的」。只断言 NOTFOUND 的话，
          // 「扫了 1577 行但一条候选都没有」与「有条候选被正确拒绝」完全同形。
          expect(r.stderr, `${f.name} 应由「${f.rejectMustMention}」判据拒绝`).toContain(
            f.rejectMustMention,
          )
        }
        if (f.rejectMustNotMention) {
          // 反向钉：拒因里**不许**出现这条。早于它的判据一旦抢先拒绝（例如带被切成
          // 若干不足屏高 3.5% 的段），本条就退化成「另一条判据的阴性用例」，
          // 而 NOTFOUND 照样成立 —— 这正是 F9 第一版的失效方式。
          expect(r.stderr, `${f.name} 不应被「${f.rejectMustNotMention}」提前拒绝`).not.toContain(
            f.rejectMustNotMention,
          )
        }
        return
      }
      expect(r.stderr, `${f.name} 不该被拒`).not.toContain('NOTFOUND')
      expect(r.cx, `${f.name} 中心 x 偏离目标段`).toBeGreaterThanOrEqual(f.cx - f.tolX)
      expect(r.cx, `${f.name} 中心 x 偏离目标段`).toBeLessThanOrEqual(f.cx + f.tolX)
      expect(r.cy, `${f.name} 中心 y 偏离目标段`).toBeGreaterThanOrEqual(f.cy - f.tolY)
      expect(r.cy, `${f.name} 中心 y 偏离目标段`).toBeLessThanOrEqual(f.cy + f.tolY)
    })
  }

  it('阴性 fixture 的扫描面非空（防止「空扫描面」与「真零违规」同形）', () => {
    // F4 有 6 条文字行候选，全部被 min_height 拒掉。若哪天抽取器整体失灵、
    // 候选一条都产不出来，`toContain('拒：')` 之外的断言会与「真的没有违规」同形，
    // 所以这里显式钉住「至少有一条候选被某条判据拒绝」。
    const f4 = runs.get('F4-no-control')!
    const drops = f4.stderr.split('\n').filter((l) => l.includes('拒：'))
    expect(drops.length, 'F4 应产生候选并逐条给出拒因').toBeGreaterThanOrEqual(6)
  })

  it('扫描窗口下界与画布一致（改动第 ② 步的边界分支依赖这个常量）', () => {
    // `left = ratios[i-1][0] if i > 0 else 0.0` 里那个 0.0 只在窗口首行有意义。
    // F7 把带顶压在窗口首行上，钉住这个分支；若日后调了 y_min_ratio，这里会先红。
    expect(SCAN_Y0).toBe(259)
    expect(SCAN_Y1).toBe(1836)
    const f7 = runs.get('F7-band-at-window-top')!
    expect(f7.cx).toBeGreaterThan(0)
  })
})
