#!/usr/bin/env node
/**
 * 状态层「塌陷」审计 —— 判定哪些 `bg-layer-*` utility 在实心底色上按压时会
 * 让**填色整个消失**（#867）。
 *
 * ── 机制 ────────────────────────────────────────────────────────────────
 * Tailwind `bg-*` 直接**替换** `background-color`，不与容器色合成。
 * 替换前元素底色是 C（实心），替换后是 `rgba(L, α)` 绘制在**背后的页面色 P** 上。
 * 所以观感 = composite(L, α, P)，而 ΔE(C, 观感) 就是「按钮消失程度」。
 *
 * 真机（emulator-5556, 1080×2160）实测的两个锚点：
 *   · `bg-primary` + `bg-layer-pressed-on-primary` → RGB (26,111,168)→**(249,251,255)**，塌
 *     （后者 = composite(#ffffff, 0.12, #f8faff)，可逐位复算）
 *   · `bg-primary-container` + `bg-layer-pressed-primary` → 前后**逐位相同**，不塌
 * 阈值必须夹在这两点之间，不能凭印象定。
 *
 * ── 用法 ────────────────────────────────────────────────────────────────
 *   node scripts/state-layer-collapse-audit.mjs          # 人读表格
 *   node scripts/state-layer-collapse-audit.mjs --json   # 机器读（测试消费）
 *   node scripts/state-layer-collapse-audit.mjs --verify  # 自证：锚点是否仍成立
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const TOKENS = resolve(HERE, '../src/styles/tokens.css')

/** 状态层 role → { 容器色令牌（替换前的实心底）, 层色令牌 } */
const ROLE_BASIS = {
  primary: { container: '--md-surface', layer: '--md-primary', note: 'MD3：primary 层色画在 surface 底上' },
  'on-surface': { container: '--md-surface', layer: '--md-on-surface', note: 'MD3：on-surface 层色画在 surface 底上' },
  error: { container: '--md-surface', layer: '--md-error', note: 'MD3：error 层色画在 surface 底上' },
  surface: { container: '--md-surface', layer: '--md-primary', note: '与 primary 档同构（见 tokens.css 注释）' },
  'on-primary': { container: '--md-primary', layer: '--md-on-primary', note: '实心 primary 按钮 ⇒ 唯一会塌的组合' },
}

const STATES = [
  { name: 'hover', alpha: 0.08 },
  { name: 'focus', alpha: 0.12 },
  { name: 'pressed', alpha: 0.12 },
  { name: 'dragged', alpha: 0.16 },
]

/** 塌陷阈值（CIELAB ΔE76）。由 --verify 的两个真机锚点夹逼，见文件末尾实测。 */
export const COLLAPSE_DE = 25

// ── 颜色工具 ────────────────────────────────────────────────────────────
function parseHex(h) {
  const m = /^#([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
/** alpha 合成：前景 fg 以 α 叠在背景 bg 上（sRGB，非线性空间直接混，与真机一致） */
function composite(fg, alpha, bg) {
  return fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
}
function rgbToLab([r, g, b]) {
  const lin = (c) => {
    const s = c / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r), G = lin(g), B = lin(b)
  // sRGB → XYZ (D65)，再 → Lab
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
  ;[x, y, z] = [f(x), f(y), f(z)]
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
function deltaE76(c1, c2) {
  const a = rgbToLab(c1), b = rgbToLab(c2)
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
}

// ── 解析 tokens.css 的主题块 ─────────────────────────────────────────────
/**
 * 基础块在源码里是 `page,` 与 `.theme-sky` **两行**（`page,` 单独起块），
 * 故正则要单独认它 —— 早先只认 `.theme-*`，导致基础块整个被跳过。
 */
function parseThemes(css) {
  const themes = []
  const re = /^(page,|\.theme-[\w-]+(?:\.dark)?)\s*\{?/gm
  let m
  while ((m = re.exec(css)) !== null) {
    // `page,` 行不含 `{`，下一行才是；`.theme-x {` 行内已含
    let start = m.index + m[0].length
    if (!m[0].includes('{')) {
      const nl = css.indexOf('\n', m.index)
      start = nl === -1 ? css.length : nl + 1
    }
    const end = css.indexOf('\n}', start)
    const body = css.slice(start, end === -1 ? css.length : end)
    const map = {}
    for (const line of body.split('\n')) {
      const t = /^\s*(--md-[\w-]+)\s*:\s*([^;]+);/.exec(line)
      if (t) map[t[1]] = t[2].trim()
    }
    themes.push({ name: m[1].replace(/^\./, ''), base: m[1] === 'page,', tokens: map })
  }
  return themes
}

/**
 * 拼出「某色板实际生效的令牌」= 基础块 ∪ 该块自身（后者覆盖前者）。
 *
 * ⚠️ 这一步不是锦上添花：CSS 自定义属性是**运行时继承**的，6 个亮色板
 * （violet/pink/green/orange/teal/bili）**不声明** `--md-error`，
 * 运行时由 `page,` 基础块继承。早先脚本既不解析基础块也不做继承，
 * `if (!container || !layer) continue` 又无 warn ⇒ **24 行被静默丢弃**
 * （error 档 6 板 × 4 态），而全称断言「14 × 4 × 5 = 256 条」名不副实
 * （算术上应为 280）。违反 AGENTS.md 测试硬约束 #3「禁静默降级」。
 * 结论本身经补算仍成立（那 24 条 max ΔE 13.42 < 25，0 条会塌），但证据面被缩小了。
 */
function effectiveThemes(themes) {
  const base = themes.find((t) => t.base)
  if (!base) throw new Error('tokens.css 里找不到 `page,` 基础块 —— 继承链断了，判据会静默缩小证据面')
  return themes
    .filter((t) => !t.base)
    .map((t) => ({ name: t.name, tokens: { ...base.tokens, ...t.tokens } }))
}

/** 解析 `rgba(r, g, b, a)` 或 `var(--x)`（跟随引用） */
function resolveColor(tokens, value, depth = 0) {
  if (depth > 5) return null
  const v = value.trim()
  const hex = parseHex(v)
  if (hex) return { rgb: hex, alpha: 1 }
  const rgba = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/.exec(v)
  if (rgba) {
    return { rgb: [Number(rgba[1]), Number(rgba[2]), Number(rgba[3])], alpha: rgba[4] === undefined ? 1 : Number(rgba[4]) }
  }
  const ref = /^var\(\s*(--md-[\w-]+)\s*\)$/.exec(v)
  if (ref && tokens[ref[1]] !== undefined) return resolveColor(tokens, tokens[ref[1]], depth + 1)
  return null
}

function audit(themes) {
  const rows = []
  const skipped = []
  for (const th of themes) {
    const page = resolveColor(th.tokens, th.tokens['--md-surface'] ?? '')
    if (!page) continue
    for (const [role, basis] of Object.entries(ROLE_BASIS)) {
      const container = resolveColor(th.tokens, th.tokens[basis.container] ?? '')
      const layer = resolveColor(th.tokens, th.tokens[basis.layer] ?? '')
      if (!container || !layer) {
        // 禁静默：跳过了多少必须报出来（早先这里裸 continue，24 行无声消失）
        skipped.push(`${th.name}/${role}`)
        continue
      }
      for (const st of STATES) {
        // 实际生效的 alpha 以 tokens 里的声明为准（surface 档用 var() 跟随 primary 档）
        const decl = th.tokens[`--md-state-layer-${st.name}-${role}`]
        const resolved = decl ? resolveColor(th.tokens, decl) : null
        const alpha = resolved?.alpha ?? st.alpha
        const rgb = resolved?.rgb ?? layer.rgb
        const after = composite(rgb, alpha, page.rgb)
        rows.push({
          theme: th.name,
          role,
          state: st.name,
          alpha,
          container: container.rgb,
          after,
          deltaE: Number(deltaE76(container.rgb, after).toFixed(2)),
          note: basis.note,
        })
      }
    }
  }
  return { rows, skipped }
}

const ALL_THEMES = parseThemes(readFileSync(TOKENS, 'utf8'))
const { rows, skipped } = audit(effectiveThemes(ALL_THEMES))

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ threshold: COLLAPSE_DE, rows }, null, 2))
} else if (process.argv.includes('--verify')) {
  // ── 自证：证明**判据有分离能力**，而不是绑定某次运行的数值 ──────────────
  // ⚠️ 早先版本拿「当前 tokens 的 on-primary 档」当塌陷侧锚点。#867 修复后该档已
  //    预合成、ΔE 落回不塌侧 ⇒ 锚点必然 FAIL，而判据本身没问题。**判别力证明不能
  //    绑定被测对象的状态**，否则一修复就自证失败。故改用合成样本。
  const SKY_PRIMARY = [0x1a, 0x6f, 0xa8]
  const SKY_SURFACE = [0xf8, 0xfa, 0xff]
  const WHITE = [0xff, 0xff, 0xff]
  const probes = [
    {
      name: '合成·实心 primary 底 + 12% 白层（真机复现：(26,111,168)→(249,251,255)）',
      expect: 'collapse',
      de: Number(deltaE76(SKY_PRIMARY, composite(WHITE, 0.12, SKY_SURFACE)).toFixed(2)),
    },
    {
      name: '合成·surface 底 + 12% primary 层（真机 FAB：前后逐位相同）',
      expect: 'keep',
      de: Number(deltaE76(SKY_SURFACE, composite(SKY_PRIMARY, 0.12, SKY_SURFACE)).toFixed(2)),
    },
    {
      name: '合成·预合成不透明色替换（#867 修法）',
      expect: 'keep',
      de: Number(deltaE76(SKY_PRIMARY, composite(WHITE, 0.12, SKY_PRIMARY)).toFixed(2)),
    },
  ]
  let ok = true
  for (const p of probes) {
    const collapsed = p.de > COLLAPSE_DE
    const pass = collapsed === (p.expect === 'collapse')
    ok = ok && pass
    console.log(`  ${pass ? 'PASS' : 'FAIL'}  ΔE=${String(p.de).padStart(6)}  期望${p.expect === 'collapse' ? '判塌' : '判不塌'}  ${p.name}`)
  }
  const gap = probes[0].de - probes[1].de
  console.log(`\n阈值 ${COLLAPSE_DE}：塌/不塌两侧样本 ΔE 分别为 ${probes[0].de} / ${probes[1].de}（间隔 ${gap.toFixed(2)}）`)
  if (gap < 10) {
    console.log('WARN 两侧样本间隔 < 10：阈值缺乏区分空间，取值需谨慎')
  }
  // 另附当前 tokens 的实测分布，供人工核对（不参与判定）
  const cur = rows.filter((r) => r.role === 'on-primary')
  if (cur.length) {
    const max = Math.max(...cur.map((r) => r.deltaE))
    console.log(`当前 tokens：on-primary 档 ${cur.length} 条，ΔE 上限 ${max.toFixed(2)}（应 < ${COLLAPSE_DE}）`)
  }
  process.exit(ok ? 0 : 1)
} else {
  if (skipped.length) {
    console.log(`\n⚠️ 跳过 ${skipped.length} 条（令牌无法解析）：${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ' …' : ''}`)
    console.log('   这些不是「不塌」的证据 —— 证据面被缩小了，须先修解析再引用结论。')
  }
  const expected = ALL_THEMES.filter((t) => !t.base).length * Object.keys(ROLE_BASIS).length * STATES.length
  console.log(`条目数自检：实际 ${rows.length} / 理论 ${expected}（14 色板 × 5 role × 4 态）${rows.length === expected ? ' ✓' : ' ✗ 不一致'}`)
  const collapse = rows.filter((r) => r.deltaE > COLLAPSE_DE)
  const byRole = new Map()
  for (const r of collapse) byRole.set(r.role, (byRole.get(r.role) ?? 0) + 1)
  console.log(`总条目 ${rows.length}，ΔE > ${COLLAPSE_DE}（判定为「按压时填色消失」）的 ${collapse.length} 条\n`)
  console.log('按 role 汇总：')
  for (const [role, n] of [...byRole].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${role.padEnd(12)} ${n} 条   ${ROLE_BASIS[role].note}`)
  }
  const roles = [...byRole.keys()]
  const clean = Object.keys(ROLE_BASIS).filter((r) => !roles.includes(r))
  console.log(`\n未塌陷的 role（保持 alpha）：${clean.join(', ')}`)
  const margins = rows.map((r) => r.deltaE)
  console.log(`\nΔE 分布：min=${Math.min(...margins)} max=${Math.max(...margins)}`)
  const sorted = [...margins].sort((a, b) => a - b)
  const near = sorted.filter((d) => d > COLLAPSE_DE - 6 && d < COLLAPSE_DE + 6)
  console.log(`阈值附近（±6）有 ${near.length} 条：阈值不落在数据空档里需警惕`)
}
