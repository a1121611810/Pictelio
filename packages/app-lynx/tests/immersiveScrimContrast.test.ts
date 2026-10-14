// 沉浸卡 scrim 的文字对比度判据（issue #891）。
//
// ── 这条门禁在防什么 ──────────────────────────────────────────────────────
// 沉浸卡（推荐页作品卡 / 排行榜入口卡 / 小说介绍页）把文字叠在**不可预测**的作品图上。
// #891 实测：白字在标题行只有 **1.56:1**、作者行 **2.17:1**（远低于 AA 4.5），
// 肉眼判为「接近不可读」。
//
// ── 为什么判据必须**绝对** ────────────────────────────────────────────────
// 作品图每张不同 ⇒ 「渐变在该处有多深」不可能对所有图同时成立。
// 所以判据**不能**写成「比当前底色深多少」这类相对断言：底色接近某值时相对断言退化成恒真，
// 看上去有门槛、实际抓不到任何东西。这里一律断言**绝对下界 AA = 4.5**（WCAG 2.1 §1.4.3）。
//
// ── 与 Python 探针的关系 ──────────────────────────────────────────────────
// `scripts/scrim-contrast.py` 是**真机测量**工具（读截图、须先过校准锚点）；
// 本文件是**常驻门禁**（不碰设备、直接从 tokens.css 重算）。两者各司其职，
// 公式同为 WCAG 相对亮度；数值不一致时以本文件为准（它才是拦住回归的那道）。
// ⚠️ 结构（#1009 拆分，2026-10-14）：本文件只留「模型 + 消费点判据」主干。
//    共享内核（消费点清单 / 颜色判定 / 底色抽取 / 自发现扫描面）在
//    ./helpers/immersiveScrimShared.ts；验收组在 immersiveScrimContrast.acceptance.test.ts；
//    自发现组在 immersiveScrimDiscovery.test.ts。改判据前先读共享模块的头注释。
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  CONSUMERS,
  PALETTES,
  Rgb,
  extractPlates,
  judgeConsumerColours,
  missingPlateMessage,
  plateAlphaViolation,
  stripVueComments,
} from './helpers/immersiveScrimShared'
import { templateBlock } from './helpers/vueTagScan'

/** WCAG 2.1 AA 通用门槛（取严的正文 4.5，而非大字 3.0）。 */
const AA = 4.5
// ── WCAG 相对亮度（WCAG 2.1 §Relative luminance） ──────────────────────────

function lin(c: number): number {
  const s = c / 255
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminance([r, g, b]: Rgb): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a)
  const lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** source-over 合成：`fg` 以 `alpha` 叠在**不透明** `bg` 上（作品图与页面底都是不透明底）。 */
function over(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Math.max(0, Math.min(1, alpha))
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]
}
// ── 渐变模型（记录**现状**并解释「为什么百分比渐变治不了」） ────────────────

type Stop = { pos: number; rgb: Rgb; alpha: number }
type RawStop = { pos: number | null; rgb: Rgb; alpha: number }

/** 按**顶层**逗号切色标 —— 不能直接 `split(',')`：`rgba(0, 0, 0, 0.82)` 自己就带逗号，
 *  直接切会把它撕成 `rgba(0` / ` 0` / ` 0` / ` 0.82)` 四段，然后解析失败。 */
function splitTopLevel(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) {
      out.push(cur.trim())
      cur = ''
    } else {
      cur += ch
    }
  }
  if (cur.trim()) out.push(cur.trim())
  return out
}

function parseStops(css: string): Stop[] {
  const m = /linear-gradient\(\s*to\s+(\w+)\s*,([\s\S]*)\)\s*$/.exec(css.trim())
  if (!m) throw new Error(`不是 linear-gradient：${css}`)
  // 本仓三处 scrim 全是 to top（0% 在**下边**）；方向不认识就抛，别猜。
  if (m[1] !== 'top') throw new Error(`只支持 to top，实际 ${m[1]}`)
  const raw = splitTopLevel(m[2]).map((part): RawStop => {
    const pm = /([\d.]+)%\s*$/.exec(part)
    const rest = pm ? part.slice(0, pm.index).trim() : part
    const cm = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(rest)
    if (!cm) throw new Error(`色标解析不了：${part}`)
    return {
      pos: pm ? Number(pm[1]) / 100 : null,
      rgb: [Number(cm[1]), Number(cm[2]), Number(cm[3])] as Rgb,
      alpha: cm[4] === undefined ? 1 : Number(cm[4]),
    }
  })
  if (raw.length === 0) throw new Error('色标为空')
  return fillPositions(raw)
}

/** 补齐省略百分比的色标位置（CSS 语义：省略位置在相邻已声明位置间**均分**；
 *  首个省略 → 0%，末个省略 → 100%）。
 *
 * ⚠️ 把省略位置一律当 0% 会让渐变**顶端**那一档塌到盒子下沿：alpha 算得比真实值小
 * （标题处 0.089 而非 0.189），而**错的方向恰好是「更容易达标」**——于是依赖它的
 * 「现状不达标」断言照样绿，成为一条自己骗自己的绿。必须按 CSS 语义补齐。 */
function fillPositions(raw: RawStop[]): Stop[] {
  const n = raw.length
  const pos: (number | null)[] = raw.map((r) => r.pos)
  if (pos.every((p) => p === null)) {
    const step = 1 / Math.max(1, n - 1)
    return raw.map((r, i) => ({ pos: i * step, rgb: r.rgb, alpha: r.alpha }))
  }
  if (pos[n - 1] === null) pos[n - 1] = 1
  if (pos[0] === null) pos[0] = 0
  for (let pass = 0; pass < n; pass++) {
    for (let i = 1; i < n - 1; i++) {
      if (pos[i] === null && pos[i - 1] !== null && pos[i + 1] !== null) {
        pos[i] = ((pos[i - 1] as number) + (pos[i + 1] as number)) / 2
      }
    }
  }
  if (pos.some((p) => p === null)) throw new Error('存在无法确定位置的色标')
  return raw.map((r, i) => ({ pos: pos[i] as number, rgb: r.rgb, alpha: r.alpha }))
}

/** pos：0 = 盒子下沿，1 = 上沿。段外沿用最近端点。 */
function stopAt(stops: Stop[], pos: number): { rgb: Rgb; alpha: number } {
  const pts = [...stops].sort((a, b) => a.pos - b.pos)
  const first = pts[0]
  const last = pts[pts.length - 1]
  if (pos <= first.pos) return { rgb: first.rgb, alpha: first.alpha }
  if (pos >= last.pos) return { rgb: last.rgb, alpha: last.alpha }
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    if (a.pos <= pos && pos <= b.pos) {
      const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos)
      return {
        rgb: [
          Math.round(a.rgb[0] + (b.rgb[0] - a.rgb[0]) * t),
          Math.round(a.rgb[1] + (b.rgb[1] - a.rgb[1]) * t),
          Math.round(a.rgb[2] + (b.rgb[2] - a.rgb[2]) * t),
        ],
        alpha: a.alpha + (b.alpha - a.alpha) * t,
      }
    }
  }
  throw new Error('unreachable')
}

// ── 代表性底色组（含**纯白**这个最坏情况） ────────────────────────────────
// 纯白是最坏情况：任何黑色 scrim 叠在纯白上都最浅。
// 刻意包含非灰的色 —— alpha 合成逐通道进行，不能只测灰度。
const BASES: { name: string; rgb: Rgb }[] = [
  { name: '纯白（最坏情况）', rgb: [255, 255, 255] },
  { name: '近白米色', rgb: [250, 246, 236] },
  { name: '浅肤色', rgb: [242, 224, 210] },
  { name: '亮黄', rgb: [252, 240, 120] },
  { name: '中灰', rgb: [128, 128, 128] },
  { name: '暗部', rgb: [40, 44, 58] },
  { name: '纯黑', rgb: [0, 0, 0] },
]
describe('#891 沉浸卡 scrim 文字对比度判据', () => {
  it('tokens.css 里 7 亮 + 7 暗 = 14 套色板全部自带 inverse 配对（门禁自身的前置条件）', () => {
    expect(PALETTES).toHaveLength(14)
    expect(PALETTES.filter((p) => p.selector.includes('.dark'))).toHaveLength(7)
  })

  it('--md-scrim-overlay 只在默认块与 7 个 .dark 块显式声明，其余 6 套亮色板靠层叠继承', () => {
    // 记录**当前事实**而非假设：若哪天色板生成脚本改成每块都写，这里会红，
    // 那时需要把下面两处 `PALETTES[0].scrimOverlay` 换成按色板取值。
    expect(PALETTES.filter((p) => p.scrimOverlay !== undefined)).toHaveLength(8)
    expect(PALETTES[0].selector).toContain('page')
    expect(PALETTES[0].scrimOverlay).toBeDefined()
  })

  describe('绝对下界：叠加后的文字对比度 ≥ AA 4.5', () => {
    for (const p of PALETTES) {
      it(`${p.selector}：底色遍历（含纯白）均达标`, () => {
        for (const base of BASES) {
          // 文字不透明地压在**不透明**稳定底色上 ⇒ 底图对最终对比度**零贡献**。
          // 这正是本判据能「分开所有图片情况」的原因，也是它敢写成绝对下界的前提。
          const c = contrast(p.inverseOnSurface, p.inverseSurface)
          expect(
            c,
            `${p.selector} / ${base.name}：inverse-on-surface on inverse-surface = ${c.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(AA)
          // ⚠️ 这里曾有一条 `expect(over(p.inverseOnSurface, 1, base.rgb)).toEqual(...)`，
          //    注释声称「把『底色被完全盖掉』钉死」——**它是恒真的**（#897）：
          //    `over` 的定义是 `fg*a + bg*(1-a)`，取 a=1 时 bg 被乘以 0、**完全消失**，
          //    结果恒等于 fg，与 base 无关 ⇒ 对任意底色恒真，且 `base` 从未参与任何断言
          //    （外层遍历形同虚设）。它拦不住任何回归，却一直冒充防线计入门禁台账。
          //    已删除。「底色不许带 alpha 修饰符」的真防线在下方消费点 describe 里
          //    （源级 class 形态断言）——纯数学断言在原理上做不到，因为「不透明」是
          //    一个 class 形态的事实，不是颜色数值的事实。
          //    ⚠️ base 仍用于上面那条对比度断言的错误信息（逐底色板的可读诊断），
          //    但**判据本身与 base 无关**是事实：若要让 base 真正参与判据，
          //    必须改为「把底色板实际合成进结果后仍达标」，那是另一种门禁形态（见 #897）。
        }
      })
    }
  })

  describe('阳性对照：判据必须有能力判红，否则就是恒真门禁', () => {
    it('同一判据对「纯白底 + 只靠渐变」判红，且给出具体数值', () => {
      // 复原 #891 的现状：白字只叠 --md-scrim-overlay，没有稳定底色。
      const white: Rgb = [255, 255, 255]
      const grad = PALETTES[0].scrimOverlay
      // 标题落在盒高 0.48、作者 0.37（真机实测反推：标题底 rgb 207 ⇒ alpha 0.189，
      // 与模型 0.189 吻合；作者底 rgb 176 ⇒ alpha 0.310，对应盒高约 0.30 而非 0.37）
      for (const pos of [0.3, 0.37, 0.48]) {
        const s = stopAt(parseStops(grad), pos)
        const c = contrast(white, over(s.rgb, s.alpha, white))
        expect(c >= AA, `pos=${pos} 处白字/纯白底 = ${c.toFixed(2)}，应判红`).toBe(false)
        expect(c).toBeLessThan(AA)
      }
    })

    it('模型 alpha 与真机实测底色对得上（pos 0.48 处实测 rgb207 ⇒ alpha 0.189）', () => {
      // 这条把「模型」与「真机截图」对上一次账，防止两边各自漂移。
      const grad = PALETTES[0].scrimOverlay
      const s = stopAt(parseStops(grad), 0.48)
      expect(s.alpha).toBeCloseTo(0.189, 2)
      const bg = over(s.rgb, s.alpha, [255, 255, 255] as Rgb)
      // 真机 emulator-5554 标题行右侧同高背景实测 q_rgb = [207,207,207]
      expect(Math.round(bg[0])).toBeGreaterThanOrEqual(200)
      expect(Math.round(bg[0])).toBeLessThanOrEqual(210)
    })

    it('同一判据对达标组合判绿（证明上一条不是恒假）', () => {
      const p = PALETTES[0]
      expect(contrast(p.inverseOnSurface, p.inverseSurface) >= AA).toBe(true)
    })

    it('换成同亮度的彩色底仍判红（相对断言在这里会漏）', () => {
      // 判据比的是**绝对比值**，不是「比底色深多少」。这里先由目标亮度**反解**出
      // 等亮度灰（不要手挑一个「看起来差不多」的灰——上面那次就挑错了，差 0.09），
      // 再验证彩色底与等亮度灰给出同一个比值：只要底色够亮，两者都判红。
      const white: Rgb = [255, 255, 255]
      const yellow: Rgb = [252, 240, 120]
      const target = luminance(yellow)
      // 由 L 反解 8 位灰：lin^-1(v) = 1.055 * v^(1/2.4) - 0.055
      const v = 1.055 * target ** (1 / 2.4) - 0.055
      const grey: Rgb = [
        Math.round(v * 255),
        Math.round(v * 255),
        Math.round(v * 255),
      ]
      // 彩色底与它的等亮度灰落在同一个比值上（量化到整数通道，容忍 1 级误差）
      expect(contrast(white, yellow)).toBeCloseTo(contrast(white, grey), 2)
      expect(contrast(white, yellow) >= AA).toBe(false)
    })
  })

  describe('现状记录：为什么单靠渐变撑不住（此组转红 = 渐变被改，先重算再决定方案）', () => {
    it('--md-scrim-overlay 在文字所在的盒高区间内，叠纯白底后达不到 AA', () => {
      const white: Rgb = [255, 255, 255]
      const stops = parseStops(PALETTES[0].scrimOverlay)
      for (const pos of [0.3, 0.37, 0.48, 0.6]) {
        const s = stopAt(stops, pos)
        expect(
          contrast(white, over(s.rgb, s.alpha, white)) >= AA,
          `pos=${pos} 渐变 alpha=${s.alpha.toFixed(3)} 已达 AA —— 若真是如此，应改用渐变方案并重写本判据`,
        ).toBe(false)
      }
    })

    it('同一张卡内各行「过没过线」取决于落在盒高哪一段（排行榜入口卡实测）', () => {
      // 排行榜入口卡的信息块：渐变罩 h-[36vw]=135dp，bottom-3 起步，按档位行高算中心距卡底
      // 徽章行 33dp / 标题 23dp / 作者 10dp ⇒ pos 0.244 / 0.170 / 0.074。
      const white: Rgb = [255, 255, 255]
      const stops = parseStops(PALETTES[0].scrimOverlay)
      const at = (dp: number) => {
        const s = stopAt(stops, dp / 135)
        return contrast(white, over(s.rgb, s.alpha, white))
      }
      const badge = at(33)
      const title = at(23)
      const author = at(10)
      // 徽章行真的不达线（= 本卡真正的破口），标题过线但余量很薄，作者很宽裕
      expect(badge).toBeCloseTo(3.75, 1)
      expect(title).toBeCloseTo(5.43, 1)
      expect(author).toBeCloseTo(9.16, 1)
      expect(badge >= AA).toBe(false)
      expect(title >= AA).toBe(true)
      // 三行余量相差 5 倍 ⇒ 「渐变够不够」是**位置**的函数，不是卡片属性的函数
      expect(author / badge).toBeGreaterThan(2)
    })

    it('--md-scrim（0.5 黑）单层差一点到 AA（≈3.98 < 4.5），不能拿来当稳定底色', () => {
      const white: Rgb = [255, 255, 255]
      const c = contrast(white, over([0, 0, 0], 0.5, white))
      expect(c).toBeCloseTo(3.977, 2)
      expect(c >= AA).toBe(false)
    })
  })

  describe('三个消费点确实用上了稳定底色（防「只改令牌不改页面」）', () => {
    for (const c of CONSUMERS) {
      it(`${c.name}：标题落在 stable 底色块之内，且渐变仍在`, () => {
        const raw = fs.readFileSync(path.resolve(__dirname, c.rel), 'utf-8')
        // ⚠️ 必须先剥注释再断言（理由见 stripVueComments）
        const src = stripVueComments(raw)

        // 渐变**不能**被顺手删掉：它是「与作品图融合」的唯一手段，删了会变成硬边色块。
        expect(src, `${c.name} 丢了渐变 var(--md-scrim-overlay)`).toContain('var(--md-scrim-overlay)')

        const plates = extractPlates(src)

        expect(plates, missingPlateMessage(c.name, src, plates)).not.toHaveLength(0)

        // 颜色判定**只经由共享接线 `judgeConsumerColours`**（#1012 洞 1 + 洞 2）。
        // ⚠️ 禁止在本 describe 内再直接调 `colourTokenViolation` / `colourTokenNames`：
        //    此前正是「真门禁内联调、验收组也直接调」导致共享的只是**函数**、不是**接线**，
        //    拔掉真门禁那两处判红或退回读常量，验收组 57/57 照样全绿（code-review 阻塞 F1）。
        //    验收组的「接线自检」用 source-scan 钉住本行确实存在。
        const colours = judgeConsumerColours(src, c)
        expect(colours.violation || undefined, '颜色令牌判定（#1012 洞 1 / 洞 2）').toBeUndefined()

        // 结构性判据：底色块必须**开在标题之前**——否则标题又落回渐变上。
        // ⚠️ 两个下标必须取自**同一作用域**（都走 templateBlock），否则 `<script>` 里的同
        //    needle 字面量会让标题下标指到 script 内、本断言以「底色块在标题之后」误诊。
        const plateIdx = templateBlock(src).indexOf(plates[0]!)
        const titleIdx = colours.titleIdx
        expect(
          plateIdx,
          `${c.name}：底色块出现在标题之后（idx ${plateIdx} >= ${titleIdx}），文字没被底色兜住`,
        ).toBeLessThan(titleIdx)

        // ── 把 .vue 里**实际写的**颜色 class 解析回令牌，再算对比度 ──────────
        // 没有这一步，上面的「找到了底色块」与前面的对比度计算是**两件不相干的事**：
        // 把底色换成任意一个别的深色 class 也能过「有底色块」，而对比度数字纹丝不动。
        // 这一步让门禁真正咬住标记本身。
        //
        // ⚠️ 两侧的输入**必须同源**（#1012 洞 2）：底色块读 `extractPlates(src)` 的实写
        //    类串，标题读标题标签的实写 class。**不得**再拿 `CONSUMERS` 里的 `titleMarker`
        //    常量当解析输入 —— 它是**期望值**，needle 之后追加的任何类名对它不可见，
        //    文字色一侧对源文件改动等于零反应（实测：追加 `text-primary` 后 50 用例全绿）。
        //
        // ⚠️ 颜色令牌必须**恰好一个**（#1012 洞 1，判据与理由见 `colourTokenViolation`）：
        //    叠了多个颜色 utility 时，真实渲染里哪个胜出取决于 Tailwind 产物顺序，
        //    取任一个都是在算一个**未必被渲染**的数字 ⇒ **判歧义，不挑一个算**。
        //
        // ⚠️ 「本仓类串约定颜色在末尾」是**错误的不变式**，已随 #1005 从注释里删除。
        //    三个消费点当前恰好颜色在末尾，那是巧合不是保证。正确理由是「排版档位不是
        //    颜色令牌、被令牌存在性滤掉，故剩下那唯一一个命中才是颜色」。
        const plateBg = colours.plateTokens[0]!
        const plateFg = colours.titleToken!
        for (const p of PALETTES) {
          const bg = p.tokens.get(plateBg!)
          const fg = p.tokens.get(plateFg!)
          expect(bg, `${p.selector} 找不到底色令牌 --md-${plateBg}`).toBeDefined()
          expect(fg, `${p.selector} 找不到文字令牌 --md-${plateFg}`).toBeDefined()
          const c2 = contrast(fg!, bg!)
          expect(
            c2,
            `${c.name} / ${p.selector}：${plateFg} on ${plateBg} = ${c2.toFixed(2)}`,
          ).toBeGreaterThanOrEqual(AA)
        }

        // ⚠️ inverse 令牌的 alpha 变体是**死类名**：颜色档位是裸 var()、无 <alpha-value>
        // （tailwind.config.ts），`text-inverse-on-surface/85` 不产出任何规则 ⇒ 静默无样式。
        // 实测（tailwindcss 3.4.19 产物）：text-inverse-on-surface/85 → 0 条规则；
        // 而 text-white/85 → 1 条（white 是字面量）——**别把这两者混为一谈**。
        // 层级因此只能由字号/字重承担（MD3 对 on-surface 的本意）。
        expect(src, `${c.name} 出现 text-inverse-on-surface 的 alpha 变体（死类名）`).not.toMatch(
          /text-inverse-on-surface\/\d+/,
        )

        // ── 稳定底色**不许带 alpha 修饰符**（#897 修法）────────────────────────
        // 上一条只守住了 text- 侧的**死类名**；底色侧是完全不同的失效机制，且**恒绿**：
        //  1. 上面的 `colourTokenNames()` 用 `bg-([\w-]+)` 提取令牌名，`\w` **不含 `/`**，
        //     故 `bg-inverse-surface/70` 会被静默截成 `inverse-surface` ⇒ plateBg 不变
        //     ⇒ 对比度数字**纹丝不动** ⇒ 上游所有断言照常全绿。
        //  2. 与 text- 侧相反，底色的 `/70` **不是死类名**：Tailwind 对裸 var() 颜色档
        //     同样接受 alpha 修饰符，会正常产出规则 ⇒ 真实渲染为半透明，无任何构建期报错。
        //     即：这是**视觉静默回归**，不是死类名，运行时表现与意图一致地错。
        //  为什么必须禁：绝对下界判据（上面 `for (const base of BASES)`）的全部有效性
        //     建立在「文字不透明地压在**不透明**稳定底色上」这一前提上。底色一旦半透明，
        //     作品图就会透过底色参与合成，`base` 重新变得相关，而门禁对 base 的实际影响
        //     恒为零 ⇒ 整道门宣称覆盖的底色范围**从未被真正验证过**。
        //
        // 实测（变异验证）：把 RankingEntryCard.vue:141 的底色改成
        // `bg-inverse-surface/70` 后，本文件 26 个用例**全绿**。
        // 改动后同一变异会让本断言判红。
        //
        // 判据只针对**稳定底色块**（上面的 plates），不扫全文件：
        // NovelIntro / Recommended 里另有与 scrim 无关的 inverse 元素，且本仓有
        // 刻意使用 alpha 的状态层（bg-layer-pressed/16 等），全文件禁 `/` 会误伤。
        for (const [plateIdxInPlates, plate] of plates.entries()) {
          // 判定走**共享函数**，不内联复制正则 —— 验收组必须打到与真门禁同一份判据，
          // 否则删掉这个循环（#897 的判红能力）新增用例仍全绿（code-review 阻塞项）。
          expect(plateAlphaViolation(c.name, plate)).toBeUndefined()
        }
      })
    }
  })
})
