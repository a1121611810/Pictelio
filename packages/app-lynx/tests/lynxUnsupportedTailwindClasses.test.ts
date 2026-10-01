/**
 * Lynx 不产出的 Tailwind 类名门禁 —— 禁 `pointer-events-*` 出现在 class 上。
 *
 * ## 本文件是「Lynx 静默失灵机制」的索引，不是唯一门禁
 * `pointer-events-*`（Tailwind 类名）与 `hover-class`（Lynx 属性）**不是同一种东西**：
 * 前者被 `@lynx-js/tailwind-preset` 的 `corePlugins` 白名单裁掉（构建期就没了），
 * 后者**构建期正常产规则、真机按住却零变化**（引擎不产生视觉状态切换）。
 * 两者的共同点是**失败方式静默**，但断言面不同（class 属性 vs 任意属性绑定），
 * 故 `hover-class` 的门禁**不复制到这里**（复制会变成第二处需要同步的真相源），
 * 它的 load-bearing 断言是：
 *   → `tests/stateLayerOnPrimary.test.ts` 的 **C4**（禁 `hover-class` 绑定本身）
 *   → 依据见 ADR-0207 决策 9
 * 记在这里只是为了让「查 Lynx 支持什么」的人不必只搜 `pointer-events` 就以为看全了。
 *
 * ## 起因（早前 code-review 复审查出的真缺陷）
 * `src/components/ActionButton.vue` 的 disabled 态写着 `opacity-50 pointer-events-none`，
 * 看起来像在「禁止点击」，但 **`pointer-events-none` 在本项目根本不产出任何规则**。
 *
 * 根因（实跑定位，非推断）：`@lynx-js/tailwind-preset@0.5.1` 的 `lynx.js` 里设了
 * `corePlugins: DEFAULT_CORE_PLUGINS` —— 一份 **57 项白名单**，`pointerEvents` 不在其中
 * （同样被裁掉的还有 `cursor` / `select`；`opacity` 在）。
 * Lynx 原生 hit-testing 不实现 `pointer-events` 这个 CSS 属性，preset 是**故意**裁掉的。
 *
 * ⚠️ **「不在白名单 ⇒ 死类名」不能当通用判据用**（本段原先把 `transition` / `transform`
 * 一并写成「同样被裁」，两处都已被实跑推翻，故此列只保留确定被裁的项）：
 *   · `transition` 族（`transitionProperty` / `transitionDuration` /
 *     `transitionTimingFunction`）确实不在白名单里，但 preset 用**自定义 plugin**
 *     （`createPlugin` + `matchUtilities`）把它们**补了回来、绕开白名单过滤**
 *     ⇒ 产物里 `transition-colors` / `duration-[…]` / `ease-[…]` 都是真规则，
 *     真机取样也确认过渡会插值。**`transition-*` 不是死类名。**
 *   · `transform` 族走同一条自定义 plugin 通道，工具类**能产出规则**；它失效的原因是规则引用的
 *     `--tw-*` 变量在产物里**从未被定义**（Tailwind 的 `* { --tw-tx: 0; … }` 默认值块不在
 *     产物中），`var()` 取不到值 ⇒ **渲染为空**。
 *   ⇒ 白名单只回答「官方 corePlugin 有没有被保留」，**不**回答「这个类名在 Lynx 上能不能用」。
 *     判死类名的判据是**产物里有没有对应规则**；下方白名单快照只锁「前提」这一层。
 *
 * ⚠️ 「57」这个数**曾经被我写成 129**（凭印象，没数）。preset 升级会改它，所以本文件
 * 下方有一条 `白名单快照` 判据把真实内容钉住并在 preset 升级时转红 —— **数字以那条
 * 判据的实跑输出为准，不要凭记忆改注释**。复跑命令：
 *   node -e "const s=require('fs').readFileSync('node_modules/@lynx-js/tailwind-preset/dist/lynx.js','utf8');console.log(s.match(/DEFAULT_CORE_PLUGINS\s*=\s*\[([\s\S]*?)\]/)[1].split(',').length)"
 *
 * 实测阳性对照（Tailwind CLI + 项目真实 config，产物 418 条 utility）：
 *   `.pointer-events-none`  ✗ 0 处      `.opacity-50`      ✓ 1 处
 *   `.pointer-events-auto`  ✗ 0 处      `.opacity-\[0\.08\]` ✓ 1 处
 *                                        `.bg-surface-tint` ✓ 1 处
 * ⇒ 不是「管线没跑起来」，是这个类名**被 preset 裁掉了**。
 * 构建产物侧交叉证实：`grep -c pointer-events dist/main.lynx.bundle` = 0 —— 类名只作为
 * class 属性字符串出现，没有任何对应 CSS 规则。
 *
 * ## 为什么这条比看起来严重
 * 「以为在防护、实际不防护」比不写更危险：
 * ① `ActionButton` 恰好另有 `@tap` 处理器守卫，所以它的 disabled **行为上是对的**——
 *    纯冗余，不算功能缺陷；
 * ② 但 `src/pages/NovelIntro.vue` 的书签 wrap 层**只靠这个死类名**，
 *    `BookmarkButton` 没有 `disabled` prop、wrap 也没有 `@tap` 守卫
 *    ⇒ R-18/AI 屏蔽态下收藏仍可点（真缺陷，已在该处注释登记并另开票）。
 *
 * ## 扫描口径：**只扫 class 属性值**，不扫全文
 * 本文件自己的注释、以及 `ActionButton.vue` / `SeriesSheet.vue` / `NovelIntro.vue`
 * 都要**解释**为什么不能用它 —— 那些说明文字里必然出现 `pointer-events-none` 字样。
 * 若扫全文，这些解释会把门禁顶红 ⇒ 门禁第一次红就会被人加白名单，然后彻底失效。
 * 所以判据 = 「出现在 `class=` / `:class=` 的字符串字面量里」。
 *
 * 用 `readdirSync` 递归整个 `src/`（**不按目录名过滤**，避免整目录落空那种空转）。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/** 递归收集；**刻意不过滤目录名** —— 加一层 `name === 'x'` 就能让整目录静默落空，
 *  而空集与「零违规」在 `toEqual([])` 上完全同形。 */
function collectVue(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) collectVue(p, out)
    else if (entry.name.endsWith('.vue')) out.push(p)
  }
  return out
}

const FILES = collectVue(SRC)

/** 先剥注释，再取 class 属性的字符串字面量。
 *
 *  ⚠️ 必须剥：Vue 模板注释 `<!-- … -->` 里**可以合法出现** `class="…"`，
 *  而本文件自己的说明、以及各组件「原先怎么写的」那段解释，都会写到它。
 *  不剥的话，别人写一句 `<!-- 改前是 class="pointer-events-none" -->` 就会把门禁顶红，
 *  下一步必然是加白名单 ⇒ 门禁当场失效。 */
function stripComments(text: string): string {
  return text.replace(/<!--[\s\S]*?-->/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

/** 只取 class 属性的字符串字面量内容：`class="..."` 与 `:class="..."` / `:class='...'` */
function classLiterals(text: string): string[] {
  const out: string[] = []
  for (const m of stripComments(text).matchAll(/(?<![\w-]):?class\s*=\s*(["'])([\s\S]*?)\1/g)) {
    out.push(m[2] ?? '')
  }
  return out
}

// 收集用「全局」正则（matchAll 要求 g），断言用「非全局」副本 ——
// 全局正则的 lastIndex 会在多次 .test() 之间残留，是典型的间歇性假红/假绿来源。
// ⚠️ 尾边界必须把**引号**算进去：被扫的是 class 属性的字符串字面量内容，
// 里面最后一个 token 后面紧跟的是引号（`class="… pointer-events-none"`），
// 只认空白/行尾的话整条都匹配不上 —— 阴性对照用例抓到的就是这个。
const BANNED_SRC = '(?:^|[\\s"\'])(pointer-events-(?:none|auto))(?=[\\s"\']|$)'
const BANNED = new RegExp(BANNED_SRC, 'g')
const BANNED_ONE = new RegExp(BANNED_SRC)

function scan(): { rel: string; token: string }[] {
  const hits: { rel: string; token: string }[] = []
  for (const abs of FILES) {
    const rel = relative(SRC, abs)
    for (const lit of classLiterals(readFileSync(abs, 'utf8'))) {
      for (const m of lit.matchAll(BANNED)) {
        hits.push({ rel, token: m[1] ?? m[0].trim() })
      }
    }
  }
  return hits
}

describe('Lynx 不产出的 Tailwind 类名 · pointer-events-*', () => {
  it('抽取器本身有效：全量文件非空且含三类扩展名', () => {
    // 非空下界 + 覆盖面。没有这条，walker 整目录落空时下面那条会恒绿。
    expect(FILES.length, 'src/ 下 .vue 文件数过少，扫描疑似空转').toBeGreaterThanOrEqual(50)
    expect(FILES.some((f) => f.includes('/components/'))).toBe(true)
    expect(FILES.some((f) => f.includes('/pages/'))).toBe(true)
  })

  it('class 属性抽取器认得静态与动态两种写法（阳性对照）', () => {
    const sample = '<view class="a pointer-events-none b" /><view :class="x ? \'pointer-events-auto\' : \'\'" />'
    expect(classLiterals(sample)).toHaveLength(2)
    expect(BANNED_ONE.test(classLiterals(sample)[0]!)).toBe(true)
    expect(BANNED_ONE.test(classLiterals(sample)[1]!)).toBe(true)
  })

  it('注释里解释「为什么不能用它」不算违规（阴性对照）', () => {
    // 这条是本门禁能长期存活的前提：说明文字必须能自由提到这个类名，
    // **包括**写成 `class="pointer-events-none"` 的示例（模板注释里能合法出现 class=）。
    const sample = [
      '<!-- 禁用态拦截靠 @tap 守卫；改前写的是 class="opacity-50 pointer-events-none"，',
      '     但它在 Lynx 不产出规则。真正防护见 @tap="props.disabled ? null : emit(\'tap\')" -->',
      '// 另一处：:class="masked ? \'pointer-events-none\' : \'\'"  ← 行注释同样不算',
    ].join('\n')
    expect(classLiterals(sample)).toEqual([])
    expect(BANNED_ONE.test(sample)).toBe(true) // 全文里确实有，但都在注释里 ⇒ 不该被抓
  })

  it('src/ 的 class 属性上不得出现 pointer-events-*（它是死类名，不产出任何规则）', () => {
    const hits = scan()
    expect(
      hits.map((h) => `${h.rel}｜${h.token}`),
      'pointer-events-* 在 Lynx 下不产出规则（preset 的 corePlugins 白名单裁掉了 pointerEvents），' +
        '不能用作点击防护。请改用 @tap 处理器守卫或 v-if 条件渲染。',
    ).toEqual([])
  })
})

// ══════════════════ 白名单快照：把「为什么是死类名」钉成机器事实 ══════════════════
/**
 * 上面那条全称断言有个软肋：它**只锁类名用法，不锁前提**。
 * 若某天 `@lynx-js/tailwind-preset` 升级后把 `pointerEvents` 加回白名单，
 * 上面那条会继续绿着，而它的报错文案（"preset 的白名单裁掉了 pointerEvents"）就成了**假陈述**。
 *
 * ⚠️ 这不是假设：文件头那句「**129 项白名单**」就是我凭印象写的，实测是 **57 项**——
 * 数字错了整整一轮，靠另一个 agent 复跑 preset 源码才抓到。**注释里的数字不可信。**
 * 所以下面把白名单**内容**读出来断言：preset 变 ⇒ 这里转红 ⇒ 注释与报错文案一起复核。
 *
 * 读法刻意选正则截取而非 `require()`：preset 的入口是 ESM 产物，测试侧不必为断言
 * 引入加载副作用；`DEFAULT_CORE_PLUGINS = [...]` 在打包产物里是字面量数组，够用。
 */
const PRESET = fileURLToPath(
  new URL('../node_modules/@lynx-js/tailwind-preset/dist/lynx.js', import.meta.url),
)

function corePlugins(): string[] {
  const src = readFileSync(PRESET, 'utf8')
  const m = src.match(/DEFAULT_CORE_PLUGINS\s*=\s*\[([\s\S]*?)\]/)
  if (!m?.[1]) throw new Error(`未在 ${PRESET} 里找到 DEFAULT_CORE_PLUGINS 字面量数组`)
  return m[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
}

describe('preset corePlugins 白名单快照（前提判据，不是用法判据）', () => {
  const list = corePlugins()

  it('抽取器读到了非空白名单', () => {
    // 抽取器防空转：正则失配 / preset 改结构时这里抛错，而不是静默给空集。
    expect(list.length, '白名单读成空集，抽取器可能已失效').toBeGreaterThanOrEqual(20)
  })

  it('pointerEvents 确实不在白名单里（上面那条全称断言的前提）', () => {
    // 阳性对照：同一份列表里 `opacity` **在**。若这条也不在，多半是抽取器整体失灵，
    // 而不是「preset 真的把 opacity 也裁了」——两者在 `not.toContain` 上同形。
    expect(list, '抽取器疑似整体失灵：连 opacity 都不在白名单里了').toContain('opacity')
    expect(list, 'pointerEvents 竟在白名单里 ⇒ pointer-events-* 不再是死类名，' +
      '请重跑 Tailwind CLI 产物核对，并同步修正文件头与各处「死类名」注释').not.toContain(
      'pointerEvents',
    )
  })

  it('白名单条数快照（升级 preset 时这里会红，提示复核所有「N 项」注释）', () => {
    // 刻意锁**条数**而不只是成员：成员断言只会在 pointerEvents 状态翻转时才响，
    // 而 preset 一次升级可能同时改掉别的裁剪项（如 transform），那些改动也需要人看一眼。
    expect(
      list.length,
      `白名单条数变了（原 57）。preset 升级请复核：\n` +
        '  ① 本文件头与 ActionButton.vue / ActionButton.template.test.ts 里的「N 项白名单」措辞\n' +
        '  ② 被裁/未被裁的类名清单是否需要增补（transition / cursor / select / transform …）',
    ).toBe(57)
  })
})
