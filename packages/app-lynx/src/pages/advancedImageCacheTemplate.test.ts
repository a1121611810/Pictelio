// 高级设置页图片缓存区块模板结构测试（#984 清理入口 / #986 磁盘预算 / #985 存量清空）
//
// 为什么用源码断言而不是挂载渲染：本仓 lynx 惯例如此——node 环境下 vue-lynx 依赖 Lynx
// runtime，无法直接挂载组件（见 advancedNetworkTemplate.test.ts 同模式说明）。
//
// **本文件防的具体回归**：清理按钮的「容器底色 / 标签色 / @tap」三处曾各写各的判定条件，
//   容器只看 `clearing`、另两处看 `cacheStatsVisible && !clearing`。于是模块不可用时
//   （web-core 预览 / 原生未初始化 / 读数不真实）按钮仍渲染成满 `bg-primary` 的启用外观，
//   点下去却求值为 undefined —— **用户点一个看起来完全可用的主按钮，零反馈、无状态行**。
//   三态不一致属 AGENTS.md「禁止静默降级」的用户可见等价物，必须有机器防线钉住。
//
// oracle：MD3 状态层与「不可用不该呈现 primary 实色」的交互契约（AGENTS.md「app-lynx 的 MD3
//   约定 → 状态层」）；可用性判据本身是 AdvancedSettings.vue 内 `cacheStatsVisible`（读数真实）
//   与 `clearing`（清理进行中）两个既有 ref，不是本测试发明的。
//
// 规模线（workflows/review-fix-loop.md「门禁冻结线」#1）：本文件对被测对象 `AdvancedSettings.vue`
// 的体积比须 < 30%。**刻意不写死百分比** —— 写死的数字会在每次编辑后过期，而过期数字比没有数字
// 更坏（本文件已因「18% → 22.8% → 28.2%」连错三次：前两次是拿上一轮的体积当本轮的，第三次是量的
// 完又改注释）。要自查时跑：
//   wc -c src/pages/advancedImageCacheTemplate.test.ts src/pages/AdvancedSettings.vue
// 加内容前若已逼近 30%，按该条先问「我是在防回归，还是在给回归创造就业」，
// 必要时先压缩上方注释而非加断言。
//
// **已知失效面（抓不到什么）** —— 按「假绿比没门禁更糟」登记，不得只记它抓到了什么。
//   第 4、5 条是 Round 2 在 /tmp 用**逐字抄自本文件的抽取器**跑变异体**实测出来的**，不是推演：
//   4. **抽取范围漂移看不见**。`clearButtonBlock()` 以 `advanced.cache.clearing` 为锚点回溯最近的
//      `<view`。若按钮**上方**新增一处也含该字面量的元素（例如第二处状态行），抽取块会静默扩大
//      （实测 550 → 1094 字符），而 T1「防抽取器静默恒真」只防「取不到」、不防「抽错范围」，
//      12/12 全绿。当前 `AdvancedSettings.vue` 里该字面量仅按钮标签一处，但这是巧合不是保证。
//   5. **不验排他**。三条断言只证明「三处存在且指向 canClearCache」，不证明「不存在第 4 处独立判定源」。
//      实测新增 `:class="clearing ? 'opacity-50' : …"` 一处，12/12 仍全绿 —— 于是又出现一次发散判定，
//      正是本门禁要防的那类漂移。
//   1. 本门禁是**源码文本断言**，只能证明三处绑定在文本上同源。若有人把判定挪进 computed 之外的
//      watch/事件里做运行时二次覆盖，本门禁看不见。
//   2. 它**不校验 MD3 令牌值**是否正确（bg-primary / text-primary-on 的具体色值由
//      tokens.css 单一事实源保证），只校验选择器挂对了。
//   3. 它**不能替代目视验收**：按钮实际渲染出的对比度与触控反馈仍需真机/浏览器走查
//      （#984 已登记该欠账）。
//   6. `canClearCache` 的定义若被折成多行，T3 的单行正则会 fail-loud 转红（实测）——可接受，
//      但那是以「误报」换「不静默抽空」，不是被设计支持的形态。
//   **不在失效面内**（已核实）：`vite.config.ts` 把 `packages/app-lynx/**` 同时排除在 oxfmt 与
//   oxlint 之外，格式化器碰不到本文件与被测 .vue，故不存在「格式化重排致锚点失效」这一风险。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const vueSrc = readFileSync(fileURLToPath(new URL('./AdvancedSettings.vue', import.meta.url)), 'utf8')

/** 剥掉注释再匹配，避免注释里的示例文本让断言假绿（ArchUnit failOnEmptyShould 教训） */
const withoutComments = vueSrc.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

/** 取清理按钮那一整段 <view>…</view>；取不到返回空串由调用方断言 */
function clearButtonBlock(): string {
  const start = withoutComments.indexOf('advanced.cache.clearing')
  if (start < 0) return ''
  // 从按钮起点回溯到它自己的 <view，再取到该 <view 的闭合
  const open = withoutComments.lastIndexOf('<view', start)
  const close = withoutComments.indexOf('</view>', start)
  return open < 0 || close < 0 ? '' : withoutComments.slice(open, close + '</view>'.length)
}

describe('高级设置页 · 图片缓存清理按钮（#984）', () => {
  it('清理按钮存在且锚定在 pictelio 缓存区块上（取不到块即失败，防抽取器静默恒真）', () => {
    const block = clearButtonBlock()
    expect(block, '清理按钮源码块抽取失败——抽取器坏了，不是页面坏了').not.toBe('')
    expect(block).toContain("t('advanced.cache.clearing')")
    expect(block).toContain("t('advanced.cache.clear')")
  })

  it('容器底色、标签色、@tap 三处同源引用 canClearCache（禁用态不得自成一派）', () => {
    const block = clearButtonBlock()
    expect(block).not.toBe('')
    // 三处绑定必须各自指向同一个判定源，否则又会漂移回「容器看 clearing、另两处看可用性」
    expect(block).toContain("canClearCache ? 'bg-primary' : 'bg-surface-container-high'")
    expect(block).toContain("canClearCache ? 'text-primary-on' : 'text-surface-on-variant'")
    expect(block).toContain('@tap="canClearCache ? clearImageCache() : undefined"')
  })

  it('canClearCache 的定义同时含可用性与进行中两个条件（只判 clearing 即回归）', () => {
    const def = withoutComments.match(
      /const\s+canClearCache\s*=\s*computed\(\(\)\s*=>\s*([^\n]+)\)/,
    )
    expect(def, 'canClearCache 定义抽取失败').not.toBeNull()
    const expr = def?.[1] ?? ''
    // 可用性（读数真实）——缺它则不可用时按钮仍是启用外观
    expect(expr).toContain('cacheStatsVisible.value')
    // 进行中——缺它则清理进行中按钮仍是可点的启用外观
    expect(expr).toContain('clearing.value')
  })

  it('旧的伪可用形态已消失：容器底色不得再单独由 clearing 决定', () => {
    // 变异验证：把模板改回 `clearing ? 'bg-surface-container-high' : 'bg-primary'` 必然转红
    expect(withoutComments).not.toMatch(
      /:class="clearing\s*\?\s*'bg-surface-container-high'\s*:\s*'bg-primary'"/,
    )
  })

  it('不可用原因显式展示，不靠「点了没反应」表达（禁静默降级）', () => {
    expect(withoutComments).toContain('v-if="!cacheStatsVisible && cacheUnavailableReason"')
    expect(withoutComments).toContain('{{ cacheUnavailableReason }}')
  })
})
