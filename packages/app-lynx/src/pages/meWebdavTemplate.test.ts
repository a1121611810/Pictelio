// Me 页 WebDAV 区块模板结构测试（spec docs/specs/webdav-backup.md §7；T7）
// oracle：spec §7 字段清单 + §2 环境边界（web-core 不渲染）+ §6 恢复确认流程。
// lynx 惯例：模板结构用源码断言（downloadManagerTemplate.test.ts 同模式），
// 行为语义由 services/backupWiring.test.ts 覆盖。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ME_A11Y_LABELS } from '../utils/accessibility'

const meVue = readFileSync(fileURLToPath(new URL('../pages/Me.vue', import.meta.url)), 'utf8')

describe('Me 页 WebDAV 区块（spec §7）', () => {
  it('spec §7 敏感项排除与非 HTTPS 警告存在（T7 M3/M4 防线）', () => {
    expect(meVue).toContain('敏感项排除（勾选后不进入备份文件）')
    expect(meVue).toContain('webdavSensitiveKeys')
    expect(meVue).toContain('toggleWebdavExcluded')
    expect(meVue).toContain('非 HTTPS 连接存在泄露风险')
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
    expect(meVue).toContain('WebDAV 备份')
    expect(meVue).toContain('dav.example.com') // 服务器地址示例
    expect(meVue).toContain('placeholder="用户名"')
    expect(meVue).toContain('placeholder="密码（加密存储）"')
    expect(meVue).toContain('placeholder="目录（默认 Pictelio/backup）"')
    expect(meVue).toContain('placeholder="备份密码（可选，加密备份文件）"')
    expect(meVue).toContain('启动时自动备份')
    expect(meVue).toContain('上次备份')
    expect(meVue).toContain('连接测试')
    expect(meVue).toContain('立即备份')
    expect(meVue).toContain('撤销上次恢复')
  })

  it('§2 环境边界：web-core 不渲染（v-if webdavAvailable）', () => {
    expect(meVue).toContain('v-if="webdavAvailable"')
    expect(meVue).toContain('const webdavAvailable = isNativeMode()')
  })

  it('§6 恢复流程：选档 → 确认文案 → 确认恢复（含应急快照说明）', () => {
    expect(meVue).toContain('选择要恢复的备份')
    expect(meVue).toContain('恢复会覆盖本机对应设置')
    expect(meVue).toContain('确认恢复')
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
