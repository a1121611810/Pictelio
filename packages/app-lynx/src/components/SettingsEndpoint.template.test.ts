// ─── SettingsEndpoint 两层状态接线契约（ADR-0173） ───
// 仓库无 vue-lynx 渲染器 —— 沿用「模板源码断言」约定。
//
// 期望值出处（Oracle 溯源）：
// - 「动作按钮标题 ≠ 结果文案」= 报障形态（2026-09-19 截图：没输入任何内容就看到写着「连接成功」的按钮）
//   + ADR-0173 D1/D5：结果只出现在结果区，按钮恒为动作；
// - 兼容性自动探测（dummy key、debounce 600ms）= spec §6.1:419-422/§639 + ADR-0170:153 + ADR-0173 D2；
// - 兼容性 / 凭据两个徽章各自独立 = ADR-0173 D1；
// - 测试连接写凭据验证状态并给内联反馈 = ADR-0173 D5。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./SettingsEndpoint.vue', import.meta.url)), 'utf8')
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('SettingsEndpoint 按钮文案 = 动作（报障回归锚）', () => {
  it('测试按钮标题用 action 键，不得用 probe 结果键', () => {
    expect(code).toContain('t("novelTranslate.endpoint.test.button")')
    expect(code).toContain('t("novelTranslate.endpoint.test.running")')
    // 特征化回归：曾把 probe.success（"连接成功"）当按钮标题
    const buttonBlock = code.slice(code.indexOf('@tap="onTestConnection"'))
    expect(buttonBlock.slice(0, 400)).not.toContain('novelTranslate.endpoint.probe.success')
  })
})

describe('端点兼容性（地址层，自动探测）', () => {
  it('baseURL 输入触发 debounce 600ms 自动探测', () => {
    expect(code).toContain('@input="scheduleCompatibilityProbe"')
    expect(code).toContain('}, 600)')
    expect(code).toContain('store.probeCompatibility(baseURL.value)')
  })

  it('兼容性 chip 有全部八态文案键（显式映射，禁拼键）', () => {
    expect(code).toContain('const COMPAT_KEYS = {')
    for (const state of ['idle', 'ok', 'azure', 'deepseek', 'vllm', 'partial', 'incompatible', 'unknown']) {
      expect(code).toContain(`novelTranslate.endpoint.compat.${state}`)
    }
  })
})

describe('凭据验证（密钥层，手动测试）', () => {
  it('测试连接走 store.testConnection（真实 key），成功/失败都写状态', () => {
    expect(code).toContain('store.testConnection(')
    expect(code).toContain('novelTranslate.endpoint.credential.invalidKey')
  })

  it('凭据徽章独立于兼容性展示（三态）', () => {
    expect(code).toContain('store.credential.state')
    for (const state of ['verified', 'failed', 'unverified']) {
      expect(code).toContain(`credential.${state}`)
    }
  })

  it('测试结果走内联提示（4s 淡出），不是按钮标题', () => {
    expect(code).toContain('showTestResult(')
    expect(code).toContain('}, 4000)')
    expect(code).toContain('testResultText')
  })
})
