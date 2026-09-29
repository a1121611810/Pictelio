// 小说导出设置键：**Lynx 单端行为基准**（ADR-0203 决策 5 迁移件）。
//
// 形态说明：原 `app/tests/unit/differential/novelExportSettingsConsistency.test.ts`（该源已随 WebView 客户端删除，ADR-0203 决策 2）
// 逐键比对 WebView 与 Lynx 两个 settingsStore。对侧删除后改为断言 Lynx 侧行为。
//
// oracle 溯源（禁自洽反推）：
//   - 四个 `settings_novel_export_*` 键名与默认格式 = spec docs/specs/novel-export.md §6
//   - 默认格式 `txt` = ADR-0154 D4
//   - 格式白名单的单一事实源 = workspace 包 `@pictelio/novel-export`（ADR-0154 D1），
//     Lynx 侧必须消费共享常量而非自行维护副本
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repoRoot = resolve(pkgRoot, '..')

const SPEC = readFileSync(resolve(repoRoot, 'docs/specs/novel-export.md'), 'utf-8')
const LYNX_STORE = readFileSync(resolve(pkgRoot, 'app-lynx/src/stores/settingsStore.ts'), 'utf-8')
const LYNX_BACKUP = readFileSync(resolve(pkgRoot, 'app-lynx/src/services/backupWiring.ts'), 'utf-8').concat(
  LYNX_STORE,
)

/** spec §6 四个设置键 */
const KEYS = [
  'settings_novel_export_format',
  'settings_novel_export_include_metadata',
  'settings_novel_export_include_cover',
  'settings_novel_export_include_images',
] as const

describe('小说导出设置键：Lynx 单端行为基准（spec novel-export §6）', () => {
  for (const key of KEYS) {
    it(`Lynx settingsStore 声明 ${key}`, () => {
      expect(SPEC, `spec §6 必须列出 ${key}`).toContain(key)
      expect(LYNX_STORE, `Lynx settingsStore 必须声明 ${key}`).toContain(`"${key}"`)
    })
  }

  it('键集合恰为 spec §6 的四项（不多不少）', () => {
    const declared = [
      ...LYNX_STORE.matchAll(/"(settings_novel_export_[a-z_]+)"/g),
    ].map((m) => m[1])
    expect(new Set(declared)).toEqual(new Set<string>(KEYS))
  })

  it('默认格式白名单来自共享包 @pictelio/novel-export（ADR-0154 D1 单一事实源）', () => {
    // 白名单与默认值必须来自共享包——自行维护副本就是 ADR-0154 D1 要消灭的双实现漂移
    expect(LYNX_STORE).toMatch(/from\s+["'][^"']*novel-export[^"']*["']/)
    expect(LYNX_STORE).toContain('NOVEL_EXPORT_FORMATS')
    expect(LYNX_STORE).toContain('DEFAULT_NOVEL_EXPORT_FORMAT')
  })

  it('写入路径用白名单校验（非法格式值不得落库，ADR-0154 D4）', () => {
    // 语义判定：写出侧必须先经 NOVEL_EXPORT_FORMATS 白名单过滤
    expect(LYNX_STORE).toMatch(/NOVEL_EXPORT_FORMATS[\s\S]{0,80}?includes\(/)
  })

  it('导出设置进备份域（与 WebDAV 连接配置同规则，spec webdav-backup §8）', () => {
    // 备份收编由 settings registry 负责；此处钉住「导出键确实走 rawValues 收编路径」
    expect(LYNX_BACKUP).toContain('exportRawValues')
  })
})
