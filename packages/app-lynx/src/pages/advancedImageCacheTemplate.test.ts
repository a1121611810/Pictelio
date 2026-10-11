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