// ─── 共享目录遍历：生产 .vue 的扫描面（#1006）───
//
// 两道门禁（列表逐项铺开契约 / 沉浸卡 scrim 对比度）都需要「遍历源码树、
// 找出生产用的 `.vue`」。本模块是那份能力的**唯一实现**。
//
// ⚠️ 为什么必须是共享的一份，而不是各写各的：
//    扫描面是一份**隐含的范围承诺**。它一旦在两道门禁之间漂移，其中一道会
//    静默扫到另一道扫不到的文件，而**两边的测试都不会响**——这正是 #1004
//    那类「压根不判」的同形失效。共用一份代码，才能保证它不漂。
//
// ⚠️ 策略四条不可各自放宽（改任何一条都要同时想两道门禁的后果）：
//    ① 只收 `.vue` —— `src/` 下有测试夹具（`.ts`）也含目标串，不过滤会凭空
//       多出候选，集合相等断言当场判红。
//    ② 排测试文件 —— 夹具形态与真实消费点同形，留着会自证。
//    ③ 排 `errorPrototype` —— 该目录是 dev-only 原型页，AGENTS.md 已把它
//       登记为 MD3 规则的非约束对象，且不在 router 内。
//    ④ 目录不可读**必须出声** —— 「扫到 0 个文件」与「仓里真的没有」在输出上
//       完全同形，静默降级会让门禁伪装成通过（本仓测试硬约束：禁止静默降级）。
import { readdirSync, type Dirent } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * 归一化为「相对 `root` 的正斜杠路径」。
 *
 * ⚠️ 与遍历放同一个模块，是为了让「路径形态」和「扫描面」一样只有一份：
 *    登记键、集合比对、验收断言全走它。归一化若各写各的（`relative().split(sep)
 *    .join('/')` 抄两遍），就会漂成两种键写法，而两边的比对各自绿。
 */
export function srcKey(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}

/**
 * 遍历 `root` 下全部生产 `.vue`，产出**绝对路径**。
 *
 * @param root  扫描根（通常是包的 `src`）
 * @param label 告警前缀。每道门禁传自己的标识，否则共享之后无法分辨是谁扫不到。
 */
export function* walkProductionVue(root: string, label: string): Generator<string> {
  // ⚠️ 显式标注 `Dirent[]` + `encoding: 'utf-8'`：`ReturnType<typeof readdirSync>`
  // 会解析到 Buffer 重载（Dirent<NonSharedBuffer>），导致 entry.name 被推成
  // NonSharedBuffer 而非 string。本文件在**生产类型门禁**内
  // （src/tsconfig.json 的 include 含 ../tests/helpers/**/*.ts），不容它漂。
  let entries: Dirent[]
  try {
    entries = readdirSync(root, { withFileTypes: true, encoding: 'utf-8' })
  } catch (err) {
    // 降级必须出声（禁静默降级）：路径写错时若默默返回空集合，
    // 「扫到 0 个文件」与「仓里真的没有」同形 ⇒ 门禁恒真。
    console.warn(`${label} 目录不可读，已跳过：${root}（${(err as Error).message}）`)
    return
  }
  for (const entry of entries) {
    if (entry.name === 'errorPrototype') continue
    const p = join(root, entry.name)
    if (entry.isDirectory()) yield* walkProductionVue(p, label)
    else if (entry.name.endsWith('.vue') && !entry.name.includes('.test.')) yield p
  }
}