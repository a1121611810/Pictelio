// Me 页网络区块模板结构测试（ADR-0199 D4 / #779 T2：限流退避四参数设置）
// oracle：ADR-0199 D4 设置页暴露的效果类四参数 + 档位集合单一事实源（api/rateLimitBackoff.ts
// 三个 OPTIONS 常量，形状 6/4/3）。lynx 惯例：模板结构用源码断言（meWebdavTemplate.test.ts
// 同模式；node 环境 vue-lynx 依赖 Lynx runtime 无法直接挂载渲染），点击切换/选中态的
// 行为语义由 settingsStore.rateLimitBackoff 单测覆盖（setter 落盘 + 组装注入 client）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ME_A11Y_LABELS } from '../utils/accessibility'
import {
  RATE_LIMIT_BASE_DELAY_MS_OPTIONS,
  RATE_LIMIT_MAX_DELAY_MS_OPTIONS,
  RATE_LIMIT_MAX_RETRIES_OPTIONS,
} from '../api/rateLimitBackoff'
import zhPages from '../i18n/locales/zh-CN/pages'
import enPages from '../i18n/locales/en/pages'

const meVue = readFileSync(fileURLToPath(new URL('./Me.vue', import.meta.url)), 'utf8')

/** zh/en 字典值 = 本批新增文案快照（渲染产物 oracle；后续改写须显式更新此处并说明） */
const NETWORK_ZH: Record<string, string> = {
  'me.network.title': '网络',
  'me.network.hint': '请求被 Pixiv 限流时自动等待重试',
  'me.network.backoff': '限流退避',
  'me.network.backoffDesc': '收到 429 时自动等待并重试；关闭后立即报错',
  'me.network.maxRetries': '最大重试次数',
  'me.network.baseDelay': '初始等待',
  'me.network.maxDelay': '最长等待',
  'me.network.delaySeconds': '{{seconds}} 秒',
}
const NETWORK_EN: Record<string, string> = {
  'me.network.title': 'Network',
  'me.network.hint': 'Automatically wait and retry when rate-limited by Pixiv',
  'me.network.backoff': 'Rate-limit backoff',
  'me.network.backoffDesc': 'Wait and retry automatically on HTTP 429; off fails immediately',
  'me.network.maxRetries': 'Max retries',
  'me.network.baseDelay': 'Initial delay',
  'me.network.maxDelay': 'Max delay',
  'me.network.delaySeconds': '{{seconds}}s',
}

describe('Me 页网络区块（ADR-0199 D4 / #779）', () => {
  it('文案 i18n：zh 与 en 字典值逐字快照（双份键清单一致，防静默改写）', () => {
    for (const [key, legacy] of Object.entries(NETWORK_ZH)) {
      expect(zhPages[key as keyof typeof zhPages], key).toBe(legacy)
    }
    for (const [key, legacy] of Object.entries(NETWORK_EN)) {
      expect(enPages[key as keyof typeof enPages], key).toBe(legacy)
    }
    // zh/en 键清单完全一致
    expect(Object.keys(NETWORK_ZH).sort()).toEqual(Object.keys(NETWORK_EN).sort())
  })

  it('网络组标题与 hint 渲染（卡片结构沿用 Me 页通用分组卡）', () => {
    expect(meVue).toContain("t('me.network.title')")
    expect(meVue).toContain("t('me.network.hint')")
    expect(meVue).toContain('ME_A11Y_LABELS.networkGroupTitle')
  })

  it('开关行存在：backoff + backoffDesc + M3Switch 绑定 + @tap 切换（按 M3 开关行范式）', () => {
    expect(meVue).toContain("t('me.network.backoff')")
    expect(meVue).toContain("t('me.network.backoffDesc')")
    expect(meVue).toContain(':checked="rateLimitBackoffEnabled"')
    expect(meVue).toContain('@tap="toggleRateLimitBackoff"')
    // 点击切换状态的接线：toggle 翻转当前 ref → 设备级 setter（落盘 + 注入即时生效）
    expect(meVue).toContain('settings.setRateLimitBackoffEnabled(!rateLimitBackoffEnabled.value)')
  })

  it('三档位行全部 chips 存在（6/4/3，档位集 = rateLimitBackoff.ts 单一事实源常量）', () => {
    // 形状守卫：6 重试档 / 4 初始等待档 / 3 最长等待档
    expect(RATE_LIMIT_MAX_RETRIES_OPTIONS).toHaveLength(6)
    expect(RATE_LIMIT_BASE_DELAY_MS_OPTIONS).toHaveLength(4)
    expect(RATE_LIMIT_MAX_DELAY_MS_OPTIONS).toHaveLength(3)
    // 渲染走 v-for 常量（新增魔法数字必须来自选项常量，模板不得另写死档位）
    expect(meVue).toContain('v-for="n in RATE_LIMIT_MAX_RETRIES_OPTIONS"')
    expect(meVue).toContain('v-for="ms in RATE_LIMIT_BASE_DELAY_MS_OPTIONS"')
    expect(meVue).toContain('v-for="ms in RATE_LIMIT_MAX_DELAY_MS_OPTIONS"')
    expect(meVue).toContain("t('me.network.maxRetries')")
    expect(meVue).toContain("t('me.network.baseDelay')")
    expect(meVue).toContain("t('me.network.maxDelay')")
  })

  it('点击 chip 更新选中态：@tap pick 函数 + 选中 bg-primary/text-primary-on、未选 container-high/surface-on', () => {
    expect(meVue).toContain('@tap="pickRateLimitMaxRetries(n)"')
    expect(meVue).toContain('@tap="pickRateLimitBaseDelayMs(ms)"')
    expect(meVue).toContain('@tap="pickRateLimitMaxDelayMs(ms)"')
    // 三行的选中态 class 组合（镜像 webdavAutoBackupDays chips 行）：
    // 重试档循环变量 n；两个 delay 档循环变量 ms
    expect(meVue).toContain("rateLimitMaxRetries === n ? 'bg-primary' : 'bg-surface-container-high'")
    expect(meVue).toContain("rateLimitMaxRetries === n ? 'text-primary-on' : 'text-surface-on'")
    for (const ref of ['rateLimitBaseDelayMs', 'rateLimitMaxDelayMs']) {
      expect(meVue).toContain(`${ref} === ms ? 'bg-primary' : 'bg-surface-container-high'`)
      expect(meVue).toContain(`${ref} === ms ? 'text-primary-on' : 'text-surface-on'`)
    }
  })

  it('delay 档位文案经 delaySeconds 插值渲染秒数（重试档直接渲染数字）', () => {
    expect(meVue).toContain("t('me.network.delaySeconds', { seconds: toSeconds(ms) })")
    // 单一换算点：500→0.5、1000→1、…、60000→60
    expect(meVue).toContain('function toSeconds(ms: number): number')
    expect(meVue).toContain('return ms / 1000')
  })

  it('a11y：五个标注全部消费且与注册表文本一致（unit.test.ts 完整性守卫的本地锚）', () => {
    for (const key of [
      'networkGroupTitle',
      'rateLimitBackoff',
      'rateLimitMaxRetries',
      'rateLimitBaseDelay',
      'rateLimitMaxDelay',
    ] as const) {
      expect(ME_A11Y_LABELS[key]).toBeTruthy()
      expect(meVue).toContain(`:accessibility-label="ME_A11Y_LABELS.${key}"`)
    }
    expect(ME_A11Y_LABELS.networkGroupTitle).toBe('网络')
    expect(ME_A11Y_LABELS.rateLimitBackoff).toBe('限流退避')
    expect(ME_A11Y_LABELS.rateLimitMaxRetries).toBe('最大重试次数')
    expect(ME_A11Y_LABELS.rateLimitBaseDelay).toBe('初始等待')
    expect(ME_A11Y_LABELS.rateLimitMaxDelay).toBe('最长等待')
  })
})
