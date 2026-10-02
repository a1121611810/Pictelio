// ─── 首页顶栏构建开关的极性契约（票 #906 / #907，code-review 第 4 轮 B2）───
//
// 本文件锁的是一条**曾经零机器防线**的语义：极性表达式
// `process.env.PICTELIO_HOME_BLEED !== '0'` 写在 `lynx.config.ts` 的 define 里，
// 两套 vitest 配置各自**硬编码**自己的值（主配置 `'true'`、fallback 配置 `'false'`），
// 从不读 `lynx.config.ts`。后果是：有人把极性改回 `=== '1'`，**CI 全绿**，
// 而发布出去的 APK 静默回到旧 64dp 顶栏。没有任何一道门禁会红。
//
// 为什么不用「读 lynx.config.ts 源码断言里面有 `!== '0'`」这种写法：
// 那锁的是**文本**不是**行为** —— 把表达式换成任何能得到同样结论的写法
// （`!['0'].includes(v)`、`v === '0' ? false : true`）门禁照样绿，而把
// 极性真的翻反了它也会红。文本断言与被锁的语义之间没有映射。
// 本仓第 3 轮 review 抓到的「bleed 分支 CI 覆盖是假的」正是同一形状：
// 5 条用例读源码文本、2 条调与宏无关的纯函数，宏翻 false 时 6 条照样绿。
//
// 这里的做法是**共用代码**：`lynx.config.ts` 与本测试 import 同一个纯函数。
// 极性翻反 ⇒ 这里的真值表当场转红 ⇒ 生产侧同步翻红。二者不可能各走各的。
//
// 期望值来源：**产品裁定 + ADR-0214 §后果**（缺省开启，回退阀 = 显式 `=0`），
// 不是从 `lynx.config.ts` 的实现反推 —— 真值表是本文件对契约的**声明**。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolveHomeBleedHeaderFlag, HOME_BLEED_ENV_KEY } from '../homeBleedHeaderFlag.ts'

const LYNX_CONFIG = fileURLToPath(new URL('../lynx.config.ts', import.meta.url))
const CONFIG_SRC = readFileSync(LYNX_CONFIG, 'utf8')

/** 剥掉块注释与行注释（沿用 tests/iconMap.test.ts 的同款手法）。
 *  门禁要看的是**代码**，不是文档：注释里出现「lynx.config.ts」是说明文，
 *  不是依赖。首版没剥，直接被本文件自己的文档注释判红 —— 判据报错先怀疑判据。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '')
}

const CONFIG_BARE = stripComments(CONFIG_SRC)

/** 取出 lynx.config.ts define 块里 `__HOME_BLEED_HEADER__` 那**一个条目**的源码。
 *
 *  取值窗口是整个条目（到下一个同级条目或块尾）而不是单行：oxfmt 会按 80 列折行，
 *  `resolveHomeBleedHeaderFlag(...)` 完全可以落在下一行。首版用 `[^\n]*` 按行截断，
 *  当场把自己的实现判红。
 *
 *  ⚠️ **已知失效面**（AGENTS.md「门禁冻结线」#5 要求显式登记，不得只记它抓到了什么）：
 *   若 define 块的缩进被 oxfmt 改动、或同名 key 出现在别的缩进层级，正则失配 ⇒
 *   `end` 为 -1 ⇒ 本函数退化为「返回从命中点到文件尾的整段文本」。
 *   此时下面两条 `toContain` 断言会**恒真**（后面还有一大堆 import 与正文）。
 *   缓解：调用方一律经 `expectDefineEntry()` 走，它带非空断言。
 */
function defineEntry(): string {
  const i = CONFIG_BARE.indexOf('__HOME_BLEED_HEADER__:')
  expect(i, 'lynx.config.ts 的 define 里找不到 __HOME_BLEED_HEADER__').toBeGreaterThan(-1)
  const rest = CONFIG_BARE.slice(i)
  const end = rest.slice(1).search(/\n\s{4,6}\w+:|\n\s{0,4}\},/)
  const entry = end > 0 ? rest.slice(0, end + 1) : rest
  // 非空断言：抽取器不得退化成整段文件尾（那会让下面两条断言恒真）
  expect(
    entry.length,
    'define 条目抽取退化为文件尾 —— 正则已与 lynx.config.ts 的实际排版脱节，' +
      '下面两条 toContain 断言会恒真。',
  ).toBeLessThan(CONFIG_BARE.length / 4)
  return entry
}

describe('resolveHomeBleedHeaderFlag 真值表', () => {
  // 缺省开启（产品裁定 2026-10-02）：漏传 env 必须落在**新顶栏**，
  // 而不是悄悄退回旧顶栏 —— 否则 CI/发布机少一个环境变量就换了套 UI。
  it.each([
    ['未设置', undefined, true],
    ['空串（= 传了变量但值为空）', '', true],
    ['null（env 显式置 null 的少见形态）', null, true],
  ])('%s ⇒ 开启新顶栏', (_label, input, expected) => {
    expect(resolveHomeBleedHeaderFlag(input)).toBe(expected)
  })

  // 回退阀只有一个入口：精确的 '0'。这是 ADR 明文写下的逃生阀。
  it("显式 '0' ⇒ 关闭新顶栏（唯一的回退阀）", () => {
    expect(resolveHomeBleedHeaderFlag('0')).toBe(false)
  })

  // 下面这组是**契约的一部分**，不是边角：它们各自都有人踩过的直觉。
  // 之所以明确钉住，是因为「关掉需要显式动作」这条规则的推论就是
  // 「任何不是 '0' 的写法都不关」—— 而这恰恰最反直觉，必须有据可查。
  it.each([
    ["'1'（旧 opt-in 时代的写法）", '1', true],
    ["'false'（直觉写法，**不**关）", 'false', true],
    ["'no'", 'no', true],
    ["' 0'（带前导空格，**不**关）", ' 0', true],
    ["'00'", '00', true],
    ["'-0'", '-0', true],
  ])('%s ⇒ 开启新顶栏', (_label, input, expected) => {
    expect(resolveHomeBleedHeaderFlag(input)).toBe(expected)
  })

  it('全真值表里恰好只有一个输入会关闭开关（防悄悄加第二个关闭入口）', () => {
    const probe = [undefined, null, '', ' ', '0', '00', '-0', ' 0', '1', 'false', 'no', 'off']
    const off = probe.filter((v) => !resolveHomeBleedHeaderFlag(v))
    expect(
      off,
      `关闭开关的输入不止 '0' 一个：${JSON.stringify(off)}\n` +
        "  ADR-0214 的回退阀是**唯一**的 '0'。多一个关闭入口就意味着\n" +
        '  「关掉需要显式动作」不再是单点规则，排障时要猜哪个值真的生效。',
    ).toEqual(['0'])
  })
})

describe('lynx.config.ts 必须经由该函数取极性（接线，不是文本）', () => {
  it('剥注释器本身没把代码也剥没了（防空转）', () => {
    // ArchUnit `failOnEmptyShould` 教训：抽取/剥除器一旦因重构失效，
    // 「全称断言」会静默恒真。首版正是在没做这一步时判了红。
    expect(CONFIG_SRC.length).toBeGreaterThan(CONFIG_BARE.length)
    expect(CONFIG_BARE, '剥完注释后连 define 块都不见了').toContain('define')
  })

  it('define 里的 __HOME_BLEED_HEADER__ 来自 resolveHomeBleedHeaderFlag(...)', () => {
    // 只锁**接线**：极性真值由上面的真值表用真实执行证明，这里只证明
    // 生产侧没有绕开它写回字面量。写成 `__HOME_BLEED_HEADER__: 'true'` 之类
    // 会让真值表与生产各活各的 —— 那正是本条门禁要拦的形状。
    expect(
      defineEntry(),
      'lynx.config.ts 的 __HOME_BLEED_HEADER__ 没有走 resolveHomeBleedHeaderFlag(...)，\n' +
        "  于是 tests/homeBleedHeaderFlag.test.ts 的真值表与生产构建各活各的：\n" +
        '  极性在此处被翻反，CI 仍全绿，APK 静默交付旧顶栏。',
    ).toContain('resolveHomeBleedHeaderFlag(')
  })

  it('define 读的是 HOME_BLEED_ENV_KEY 常量，且该常量就是 PICTELIO_HOME_BLEED', () => {
    // 上面那条只证明「调用了 resolver」，**证明不了读对了环境变量**。
    // 把 `process.env[HOME_BLEED_ENV_KEY]` 拼错成 `PICTELIO_HOME_BLEED_OLD` 时，
    // 真值表照样全绿（它吃的是字面量）、接线断言也照样全绿（resolver 还在）——
    // 而回退阀已经死了。这条把「键名」也钉住。
    expect(
      defineEntry(),
      'lynx.config.ts 没有用 HOME_BLEED_ENV_KEY 常量取环境变量。\n' +
        "  键名一旦在这里被写死或拼错，tests 的真值表与生产会各活各的：\n" +
        '  回退阀 `PICTELIO_HOME_BLEED=0` 会静默失效，文档与构建各说各话。',
    ).toContain('process.env[HOME_BLEED_ENV_KEY]')
    expect(HOME_BLEED_ENV_KEY, '环境变量名被改了 ⇒ ADR / 发布清单 / 排障命令全部要跟着改').toBe(
      'PICTELIO_HOME_BLEED',
    )
  })

  it('极性函数不得反向依赖 lynx.config.ts（防循环 import）', () => {
    // 实测（变异验证）：加上反向 import 后本 suite **加载失败**，vitest 报
    // "no tests" 而非一条具名断言。那**仍然是红**（不会静默通过），但读起来
    // 容易被误当成「测试被跳过」—— 此处记一笔，避免下一个人据此以为没在跑。
    const src = stripComments(
      readFileSync(fileURLToPath(new URL('../homeBleedHeaderFlag.ts', import.meta.url)), 'utf8'),
    )
    expect(
      src.includes('lynx.config'),
      'homeBleedHeaderFlag.ts 引用了 lynx.config —— 极性函数必须是无依赖纯函数，\n' +
        '  否则 lynx.config.ts import 它就成环，配置加载会在构建期直接炸。',
    ).toBe(false)
  })
})
