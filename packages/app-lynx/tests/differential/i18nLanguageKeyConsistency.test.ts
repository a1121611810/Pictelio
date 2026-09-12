// 双端语言键契约（spec docs/specs/i18n.md §4.1）：settings_language 键名与值域跨引擎逐字一致。
// Oracle 来源：从两侧源码提取常量字面量比对（webdavSettingsConsistency 模式），非手写自洽 mock。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('differential: settings_language 双端契约', () => {
  const appSource = readFileSync(resolve(root, 'app/src/i18n/index.ts'), 'utf-8')
  const lynxSource = readFileSync(resolve(root, 'app-lynx/src/stores/settingsStore.ts'), 'utf-8')

  it('键名逐字一致：settings_language', () => {
    const appKey = appSource.match(/PREF_KEY_LANGUAGE = "([^"]+)"/)?.[1]
    const lynxKey = lynxSource.match(/LANGUAGE_KEY = "([^"]+)"/)?.[1]
    expect(appKey).toBe('settings_language')
    expect(lynxKey).toBe(appKey)
  })

  it('值域一致："" | "zh-CN" | "en"（app SUPPORTED_LOCALES 与 lynx load/applyRawKey 两处白名单）', () => {
    expect(appSource).toContain('SUPPORTED_LOCALES: readonly Locale[] = ["zh-CN", "en"]')
    expect(appSource).toContain('default: ""')
    // lynx 载入白名单
    expect(lynxSource).toContain('raw === "en" || raw === "zh-CN"')
    // lynx 回写白名单（applyRawKey）
    expect(lynxSource).toContain(`raw !== "" && raw !== "en" && raw !== "zh-CN"`)
  })
})
