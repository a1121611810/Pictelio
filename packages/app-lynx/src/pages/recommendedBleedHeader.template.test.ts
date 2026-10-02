// ─── B 变体顶栏 · 源级守卫（票 #906 / #907）───
//
// 本文件是 ADR-0163「平台事实 = 探针记录 + 源级守卫」纪律在**新平台行为依赖**上的应用。
//
// ## 守卫的靶子（v3，已随实现演进）
//
// 初版实现内联了 `linear-gradient(to bottom, var(--md-surface) 0%, rgba(0,0,0,0) 100%)`
// —— **CSS 变量作为 `linear-gradient()` 的函数实参**（下称 B 型）。它与仓内既有范式
// （A 型：整个渐变作为变量的值，元素侧写 `background: var(--md-scrim-overlay)`）**不是同一件事**，
// 且当时 `rg 'linear-gradient\([^)]*var\(' src/` 在落地前命中 0 次 ⇒ 属新平台行为依赖。
//
// **v3 现状（第三轮 review 后修正）**：渐变已抽为令牌 `--md-statusbar-scrim`，
// 页面侧只写 `var(--md-statusbar-scrim)`。
// ⚠️ **不要**据此认为 B 型依赖已消除 —— 第三轮 review 证伪过两次：
//   ① 「只在基础块定义一次」依赖「变量在使用点解析」，该行为未在本仓 Lynx 取证；
//   ② 「14 处逐块显式定义」里 **值逐字相同、都是 var(--md-surface)**，
//      重复 14 遍不改变任何一个 var() 的解析时机 —— 依赖被搬进 tokens.css 而非消除。
//   真正的修法：把**本色板的 surface 烘焙成字面量**（生成器 + 手调色板都这样做），
//   使 token 内零 var()。本文件末尾两条断言就是把这一点钉住，且**直接扫 tokens.css** ——
//   前两轮的断言只扫 Recommended.vue，而 B 型当时已经在 tokens.css 里了。
//
// ⚠️ 关于「同款先例」：`--md-scrim-overlay` / `--md-scroll-indicator` 都是**扁平 rgba、
//   不含嵌套 var**，与本 token 才是同款。之前引用它们作「嵌套 var 可用」的先例是错的
//   （review 两轮先后否证过 --md-scroll-indicator 与 --md-scrim-overlay 两个先例）。
//
// ## 设备取证记录（ADR-0163 要求，不可省略）
//
// 设备：emulator-5554 / Android / 1080×2160 物理 px / density 480 ⇒ 换算比率 3.0
// 平台真值：`dumpsys window` → `type=statusBars frame=[0,0][1080,72]` ⇒ inset = 72 物理 px
//       （= 24 逻辑 px；与 utils/topInset.test.ts 的 oracle 同源）
//
// 量法：取状态栏区（y∈[4,68)）在 x∈[0.42W, 0.58W] 的像素样本，算 on-surface 深色图标
//       （rgb(25,28,32)）对最亮/最暗底色的 WCAG 相对亮度对比度。
//
//   亮色 sky · 出血但**无**遮罩：底色区间 rgb(255,253,254) ~ rgb(41,7,8)
//     ⇒ 深色图标 vs 最暗 = **1.09:1**（近乎不可见；AA 正文需 4.5）
//   亮色 sky · 出血且**有**遮罩：底色区间 rgb(251,252,255) ~ rgb(205,218,231)
//     ⇒ vs 最暗 = **12.03:1**，vs 最亮 = 16.67:1
//
// ⚠️ **该对比度数字目前没有提交内的复现手段**（`scripts/verify-top-inset.mjs` 量的是标题带几何，
// 不是状态栏对比度）。深色主题下的取值**未实测**（票 #906 风险⑤，已显式挂账）。
//
// ## 本守卫的已知失效面（照例显式登记）
//
// 纯文本判据。它能抓「遮罩被删 / 令牌被换回字面量 / 高度写成魔数」，
// 抓不到「遮罩在真机上没生效」—— 后者靠上面的取证 + 人工复跑。
// **本文件绿灯 ≠ 状态栏可读性有保证。**
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(fileURLToPath(new URL('./Recommended.vue', import.meta.url)), 'utf8')

/** 先剥注释：注释里正是在解释这段渐变，连注释一起扫会被自己的说明顶红 */
function code(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ')
}

describe('B 变体顶栏 · 状态栏遮罩（源级守卫）', () => {
  it('顶部遮罩存在，且走令牌（不内联渐变）', () => {
    const c = code(SRC)
    // v3：渐变已从「内联 literal-gradient」改为**令牌** `var(--md-statusbar-scrim)`
    // （定义在 tokens.css，与 --md-scrim-overlay 同款：整个渐变作为变量值 = A 型范式）。
    // 这同时消掉了 B 型（变量作渐变实参）这个无先例的平台依赖 —— 见文件头「守卫的靶子」。
    expect(c, 'B 变体分支的顶部遮罩不见了 —— 状态栏底色会退回不可预测的封面像素').toContain(
      'var(--md-statusbar-scrim)',
    )
    expect(c, '渐变不得再内联在模板里（应走 tokens.css 令牌）').not.toMatch(/linear-gradient\(/)
  })

  it('遮罩与图标按钮底色一律走令牌，不得写字面量（AGENTS.md「禁硬编码」）', () => {
    const c = code(SRC)
    // 三个曾内联的 rgba(28,28,30,α) / rgba(0,0,0,0) 已全部改为 --md-scrim / --md-statusbar-scrim。
    // ⚠️ pages/Recommended.vue 虽在 hardcode-whitelist-colors.json 内（理由只覆盖旧的
    //   text-white 叠 scrim-overlay），但**不得借那条旧豁免藏新字面量** —— 门禁冻结线 #5。
    expect(c, '不得出现任何 rgba 字面量').not.toMatch(/rgba\(/)
    expect(c, '通知按钮底应走 --md-scrim').toContain('var(--md-scrim)')
  })

  it('遮罩高度随安全区缩放（写死 px 会在不同 inset 的设备上失效）', () => {
    const c = code(SRC)
    // 只锁**策略**（高度必须是 safeTop 的倍数），**不锁具体倍数**。
    // ⚠️ 早前这里写的是 `/safeTop\s*\*\s*2\.2/`，把实现魔数抄进了断言，
    //    而本条自己的失败文案却写「而不是某个魔数」—— 断言与文案互相打脸。
    //    实测：把 2.2 改成 2.0 / 2.5 都会转红，说明它锁的是数字本身，不是「成比例」这件事。
    //    倍数是设计选择、会变；「必须随 inset 等比缩放」才是不会变的契约。
    expect(c, '遮罩高度应随安全区等比缩放，而不是写死 px').toMatch(/safeTop\s*\*\s*[\d.]+/)
    expect(c, '遮罩高度不得是脱离 safeTop 的魔数').not.toMatch(/height:\s*\d+px['"]/)
  })

  it('遮罩令牌在 tokens.css 里**不含任何 var()**（平台假设的机器防线）', () => {
    // ## 这条为什么必须存在 —— 前两轮都在这里翻了车
    //
    // · 第二轮：token 只在 tokens.css **基础块**定义一次，依赖「CSS 变量在**使用点**解析」。
    //   那是 CSS 规范行为，但**未在本仓 Lynx 取证** —— 若引擎在定义点求值，14 个色板会一起
    //   取到基础块的浅 surface，而全部门禁仍绿。
    // · 第三轮：修法是「14 处逐块显式定义」，但**值逐字相同、都是 var(--md-surface)** ——
    //   重复 14 遍**不改变任何一个 var() 的解析时机**。B 型依赖被搬走而非消除。
    //
    // 现在的形态：生成器（暗色 7 套）+ 手调色板（亮色 7 套）都把**本色板的 surface 烘焙成
    // 字面量** ⇒ token 内零 var() ⇒ 平台假设不复存在。本条把它钉住。
    //
    // ⚠️ 本条**扫 tokens.css**：先前所有「B 型已消除」的断言都只扫 Recommended.vue，
    //    而 B 型当时已经搬到 tokens.css —— **守卫盯着的地方没有那个东西**。
    const TOKENS = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8')
    const decls = [...TOKENS.matchAll(/--md-statusbar-scrim:\s*([^;]+);/g)].map((m) => m[1]!)
    expect(decls.length, `应恰好 14 处定义（7 亮 + 7 暗），实得 ${decls.length}`).toBe(14)
    for (const d of decls) {
      expect(d, `令牌值不得含 var()（会重新引入未取证的平台假设）：${d}`).not.toContain('var(')
      expect(d, `令牌应是 surface 实色起手的渐变：${d}`).toMatch(
        /^linear-gradient\(to bottom, #[0-9a-fA-F]{3,8} 0%, rgba\(0, 0, 0, 0\) 100%\)$/,
      )
    }
  })

  it('每处烘焙值与该色板自己的 --md-surface 逐字一致（换色板不会漏改遮罩）', () => {
    const TOKENS = readFileSync(fileURLToPath(new URL('../styles/tokens.css', import.meta.url)), 'utf8')
    const blocks = [...TOKENS.matchAll(/(page,\s*\.theme-\w+|\.theme-[\w.]+)\s*\{([\s\S]*?)\n\}/g)]
    let checked = 0
    for (const [, , body] of blocks) {
      const scrim = /--md-statusbar-scrim:[^;]*to bottom,\s*(#[0-9a-fA-F]{3,8})\s/.exec(body)
      const surface = /--md-surface:\s*(#[0-9a-fA-F]{3,8});/.exec(body)
      if (!scrim || !surface) continue
      checked++
      expect(scrim[1], '遮罩起手色应等于本色板的 --md-surface').toBe(surface[1])
    }
    expect(checked, '未匹配到任何同时含遮罩与 surface 的色板块').toBe(14)
  })
})

describe('B 变体顶栏 · 通知按钮（源级守卫）', () => {
  it('图标按钮必须带容器填充（M3 对透明 app bar 的原话要求）', () => {
    const c = code(SRC)
    // 「容器透明时图标按钮要有底」——缺了这层，浅色封面上的白图标会消失。
    // 底色走 --md-scrim 令牌（主题无关的暗色遮罩：白图标要求恒为暗底，
    // 故不能用会随深色模式翻浅的 --md-inverse-surface）。
    expect(c, '通知按钮缺容器填充 —— 浅色封面下白图标不可见').toContain('var(--md-scrim)')
  })

  it('通知入口带 a11y 标签（取消顶栏后不能丢失朗读路径）', () => {
    const c = code(SRC)
    expect(c).toMatch(/ME_A11Y_LABELS\.notifications/)
  })
})

describe('B 变体顶栏 · 与路由 meta 的同源性', () => {
  it('模板与 meta 消费同一个构建期宏，不会出现「一边开一边关」', () => {
    // meta 在 router.ts：topInset: __HOME_BLEED_HEADER__ ? 'bleed' : 'self'
    // 模板在本文件：v-if="!HOME_BLEED" / v-else
    // 若二者不同源 → 一种组合是「无让位且无顶栏」（内容顶进状态栏），
    // 另一种是「有让位且无顶栏」（顶部多一条空白）。两者都静默破版。
    const ROUTER = readFileSync(fileURLToPath(new URL('../router.ts', import.meta.url)), 'utf8')
    expect(ROUTER).toContain('__HOME_BLEED_HEADER__ ?')
    expect(ROUTER).toMatch(/topInset: __HOME_BLEED_HEADER__ \? 'bleed' : 'self'/)
    // 绝不能是 'root'：该模式已随根容器补偿一起删除，含义退化成「完全不让位」
    expect(ROUTER).not.toMatch(/topInset: __HOME_BLEED_HEADER__ \? 'bleed' : 'root'/)
    expect(code(SRC)).toContain('HOME_BLEED')
  })
})
