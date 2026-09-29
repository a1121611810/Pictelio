// WebDAV 连接配置键：**Lynx 单端行为基准**（ADR-0203 决策 5 迁移件）。
//
// 形态说明：原 `app/tests/unit/differential/webdavSettingsConsistency.test.ts` 逐键比对（该源已随 WebView 客户端删除，ADR-0203 决策 2）
// WebView 与 Lynx 两个 settingsStore。WebView 侧删除后对侧消失，**不得**保留该比对；
// 本文件改为断言 Lynx 侧行为，oracle 分层如实标注（测试硬约束 #6，禁止自洽反推）：
//   - `settings_webdav_*` 精确键名：spec §8 只给通配（`settings_webdav_*`），
//     精确键名的 oracle = ADR-0103 跨引擎键命名约定 + spec §7 逐项列出的设置区块
//   - 默认值 `Pictelio/backup` 与默认周期 7：spec §7 字面（spec:65/107）
//   - 两个密码键：spec §8 原文（"键如 webdav_password/webdav_backup_password"）
//   - 密码键不得混入 settings_*：spec §8 红线（两密码都不进备份文件、不进普通 Preferences）
//
// 匹配纪律：默认值按「ref 初值」语义提取，不锁死 `ref(7)` 的书写形态；
// 键名按「前缀覆盖 + 逐键存在」语义判定，新增键不被误判为漂移。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repoRoot = resolve(pkgRoot, '..')

const SPEC = readFileSync(resolve(repoRoot, 'docs/specs/webdav-backup.md'), 'utf-8')
const LYNX_STORE = readFileSync(resolve(pkgRoot, 'app-lynx/src/stores/settingsStore.ts'), 'utf-8')
const LYNX_CREDS = readFileSync(
  resolve(pkgRoot, 'app-lynx/src/utils/webdavCredentials.ts'),
  'utf-8',
)

/** spec §7 设置区块 + §8 主开关（连接配置进备份域，密码除外） */
const KEYS = [
  'settings_webdav_enabled',
  'settings_webdav_url',
  'settings_webdav_username',
  'settings_webdav_dir',
  'settings_webdav_auto_backup',
  'settings_webdav_auto_backup_days',
  'settings_webdav_last_backup',
  'settings_webdav_excluded_keys',
] as const

/** spec §8：两个密码键——secure storage，绝不进普通 Preferences / 备份文件 */
const SECURE_KEYS = ['webdav_password', 'webdav_backup_password'] as const

/** 提取 `const NAME = ref(<字面量>)` 的初值（容忍泛型标注） */
function refInitial(source: string, name: string): string | undefined {
  return source.match(new RegExp(`const\\s+_${name}\\s*=\\s*ref(?:<[^>]*>)?\\(\\s*["']?([^"')]*)["']?`))?.[1]
}

describe('WebDAV 设置键：Lynx 单端行为基准（spec §7/§8）', () => {
  it('spec 给出 settings_webdav_* 通配命名（键命名约定的需求侧出处）', () => {
    expect(SPEC).toContain('settings_webdav_*')
  })

  for (const key of KEYS) {
    it(`Lynx settingsStore 声明 ${key}`, () => {
      expect(LYNX_STORE).toContain(`"${key}"`)
    })
  }

  it('键集合恰为上述八项：不多不少（新增键须显式评审，不得默默扩域）', () => {
    const declared = [...LYNX_STORE.matchAll(/"(settings_webdav_[a-z_]+)"/g)].map((m) => m[1])
    expect(new Set(declared)).toEqual(new Set<string>(KEYS))
  })

  it('默认值与 spec §7 一致：默认目录 Pictelio/backup、默认周期 7', () => {
    expect(SPEC).toContain('Pictelio/backup')
    expect(refInitial(LYNX_STORE, 'webdavDir'), '默认目录').toBe('Pictelio/backup')
    expect(refInitial(LYNX_STORE, 'webdavAutoBackupDays'), '默认自动备份周期').toBe('7')
  })
})

describe('WebDAV 密码键：secure storage 隔离（spec §8 红线）', () => {
  for (const key of SECURE_KEYS) {
    it(`凭据模块声明 secure storage 键 ${key}`, () => {
      expect(LYNX_CREDS).toContain(`"${key}"`)
    })
  }

  it('密码键不得出现在 settingsStore（进备份域的只有非敏感连接配置）', () => {
    for (const key of SECURE_KEYS) {
      expect(LYNX_STORE.includes(`"${key}"`), `settingsStore 不得包含 ${key}`).toBe(false)
    }
  })

  it('凭据模块不得退回普通 prefs（必须走 secure storage 封装）', () => {
    expect(LYNX_CREDS).toContain('PictelioSecureStorage')
    expect(LYNX_CREDS).toMatch(/console\.warn\(/)
  })
})
