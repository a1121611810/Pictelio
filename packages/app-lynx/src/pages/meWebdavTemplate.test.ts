// Me 页 WebDAV 区块模板结构测试（spec docs/specs/webdav-backup.md §7；T7）
// oracle：spec §7 字段清单 + §2 环境边界（web-core 不渲染）+ §6 恢复确认流程。
// lynx 惯例：模板结构用源码断言（downloadManagerTemplate.test.ts 同模式），
// 行为语义由 services/backupWiring.test.ts 覆盖。
// #511 第 2 类补抽：区块文案改 t(key) 渲染，断言改为「t(key) 调用形态 + zh 字典值
// 逐字节 = 抽取前存量文案」双锚（zh 渲染产物不变）；连接测试/立即备份复用 me.webdav.action.*。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ME_A11Y_LABELS } from '../utils/accessibility'
import zhMisc from '../i18n/locales/zh-CN/misc'

const meVue = readFileSync(fileURLToPath(new URL('../pages/Me.vue', import.meta.url)), 'utf8')

/** zh 字典值 = 抽取前存量文案逐字快照（渲染产物不变的 oracle；#511 第 2 类补抽约定） */
const LEGACY_ZH: Record<string, string> = {
  'me.webdav.title': 'WebDAV 备份',
  'me.webdav.httpsWarning': '非 HTTPS 连接存在泄露风险',
  'me.webdav.usernamePlaceholder': '用户名',
  'me.webdav.passwordPlaceholder': '密码（加密存储）',
  'me.webdav.dirPlaceholder': '目录（默认 Pictelio/backup）',
  'me.webdav.backupPasswordPlaceholder': '备份密码（可选，加密备份文件）',
  'me.webdav.sensitiveExclusionHint': '敏感项排除（勾选后不进入备份文件）',
  'me.webdav.autoBackup': '启动时自动备份',
  'me.webdav.lastBackup': '上次备份：{{value}}',
  'me.webdav.undoLastRestore': '撤销上次恢复',
  'me.webdav.chooseBackup': '选择要恢复的备份',
  'me.webdav.overwriteWarning': '恢复会覆盖本机对应设置（仅覆盖备份中存在的键），恢复前自动保存应急快照。',
  'me.webdav.confirmRestore': '确认恢复',
}

describe('Me 页 WebDAV 区块（spec §7）', () => {
  it('文案 i18n 抽取（#511）：zh 字典值 = 存量文案逐字快照（迁移期禁改写）', () => {
    for (const [key, legacy] of Object.entries(LEGACY_ZH)) {
      expect(zhMisc[key as keyof typeof zhMisc], key).toBe(legacy)
    }
  })

  it('spec §7 敏感项排除与非 HTTPS 警告存在（T7 M3/M4 防线）', () => {
    expect(meVue).toContain("t('me.webdav.sensitiveExclusionHint')")
    expect(meVue).toContain('webdavSensitiveKeys')
    expect(meVue).toContain('toggleWebdavExcluded')
    expect(meVue).toContain("t('me.webdav.httpsWarning')")
  })

  it('B1：三个密码输入框 type="password"（不可逆显，spec §7）', () => {
    const passwordInputs = (meVue.match(/type="password"/g) ?? []).length
    expect(passwordInputs).toBe(3) // 登录密码 / 备份密码 / 恢复解密提示
  })

  it('M1：URL/用户名/目录经 setter 持久化（防 v-model 直改 ref 不落盘回归）', () => {
    for (const kind of ['url', 'username', 'dir'] as const) {
      expect(meVue).toContain(`onWebdavFieldInput('${kind}', $event)`)
    }
    expect(meVue).toContain('settings.setWebdavUrl(value)')
    expect(meVue).toContain('settings.setWebdavUsername(value)')
    expect(meVue).toContain('settings.setWebdavDir(value)')
  })

  it('M2：启动自动备份由 router 钩子触发（不在 Me 挂载时），且 appVersion 用构建常量', () => {
    expect(meVue).not.toContain('void runStartupAutoBackup()')
    const routerSource = readFileSync(fileURLToPath(new URL('../router.ts', import.meta.url)), 'utf8')
    expect(routerSource).toContain('void runStartupAutoBackup()')
    const wiring = readFileSync(fileURLToPath(new URL('../services/backupWiring.ts', import.meta.url)), 'utf8')
    expect(wiring).toContain('appVersion: __APP_VERSION__')
  })

  it('spec §7 字段齐全（服务器/用户名/密码/目录/备份密码/自动备份/上次备份/四动作）', () => {
    expect(meVue).toContain("t('me.webdav.title')")
    expect(meVue).toContain('dav.example.com') // 服务器地址示例（非文案，保留静态 placeholder）
    expect(meVue).toContain(`:placeholder="t('me.webdav.usernamePlaceholder')"`)
    expect(meVue).toContain(`:placeholder="t('me.webdav.passwordPlaceholder')"`)
    expect(meVue).toContain(`:placeholder="t('me.webdav.dirPlaceholder')"`)
    expect(meVue).toContain(`:placeholder="t('me.webdav.backupPasswordPlaceholder')"`)
    expect(meVue).toContain("t('me.webdav.autoBackup')")
    expect(meVue).toContain("t('me.webdav.lastBackup'")
    // 连接测试/立即备份按钮复用既有 action.* key（zh 值逐字一致）
    expect(meVue).toContain("t('me.webdav.action.test')")
    expect(meVue).toContain("t('me.webdav.action.backup')")
    expect(meVue).toContain("t('me.webdav.undoLastRestore')")
  })

  it('§2 环境边界：web-core 不渲染（v-if webdavAvailable）', () => {
    expect(meVue).toContain('v-if="webdavAvailable"')
    expect(meVue).toContain('const webdavAvailable = isNativeMode()')
  })

  it('§6 恢复流程：选档 → 确认文案 → 确认恢复（含应急快照说明）', () => {
    expect(meVue).toContain("t('me.webdav.chooseBackup')")
    expect(meVue).toContain("t('me.webdav.overwriteWarning')")
    expect(meVue).toContain("t('me.webdav.confirmRestore')")
    expect(meVue).toContain('onWebdavRestore')
  })

  it('a11y：五个标注全部消费（与注册表一致，测试硬约束）', () => {
    for (const key of [
      'webdavToggle',
      'webdavTest',
      'webdavBackup',
      'webdavRestore',
      'webdavUndo',
    ] as const) {
      expect(ME_A11Y_LABELS[key]).toBeTruthy()
      expect(meVue).toContain(`:accessibility-label="ME_A11Y_LABELS.${key}"`)
    }
  })

  it('错误分类文案经 WEBDAV_ERROR_MESSAGES 渲染（spec §5，不硬编码）', () => {
    expect(meVue).toContain('WEBDAV_ERROR_MESSAGES')
    expect(meVue).toContain('webdavErrorMessage')
  })
})
