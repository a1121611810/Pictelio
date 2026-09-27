// 双端语言键契约（spec docs/specs/i18n.md §4.1）：settings_language 键名与值域跨引擎逐字一致。
// Oracle 来源：从两侧源码提取常量字面量比对（webdavSettingsConsistency 模式），非手写自洽 mock。
// Java 读侧（ADR-0200）：PictelioApiModule 经 PictelioPrefsModule 读同一键——401 刷新真路径
// 在 JVM 单测不可达（OAuth AUTH_URL 为编译期常量内联，打真实网络），故 Java E4 递归透传
// 与键同源均按 bridge-contract.test.ts 先例以源码契约钉住（review round 1 P2-1/P2-2）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

describe('differential: settings_language 双端契约', () => {
  const appSource = readFileSync(resolve(root, 'app/src/i18n/index.ts'), 'utf-8')
  const lynxSource = readFileSync(resolve(root, 'app-lynx/src/stores/settingsStore.ts'), 'utf-8')
  const lynxApiModuleSource = readFileSync(
    resolve(root, 'app/android/app/src/lynx/java/io/pictelio/app/PictelioApiModule.java'),
    'utf-8',
  )
  const apiCoreSource = readFileSync(
    resolve(root, 'app/android/app/src/main/java/io/pictelio/app/PixivApiCore.java'),
    'utf-8',
  )

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

  it('Java 读侧同源：PictelioApiModule 键常量与 PictelioPrefsModule.get 接线（review P2-2）', () => {
    // oracle = ADR-0200 D1/D2：Java 读 settings_language 走 PictelioPrefsModule.get
    // （"CapacitorStorage" 文件，与 TS 写侧 settingsStore 同一 SharedPreferences）
    expect(lynxApiModuleSource).toMatch(/SETTINGS_KEY_LANGUAGE = "settings_language"/)
    expect(lynxApiModuleSource).toContain('PictelioPrefsModule.get(ctx, SETTINGS_KEY_LANGUAGE)')
  })

  it('Java E4：PixivApiCore 401 重试两处递归均透传 acceptLanguage（review P2-1）', () => {
    // oracle = ADR-0200 E4/D5：401 刷新重试的重放请求语言头同样携带。
    // 两处递归 = rotated != null 分支 与 他人已完成刷新分支（spec §4 E4）。
    const retrySites = apiCoreSource.match(
      /executeRequest\(method, url, body, acceptLanguage, true, rotationListener\)/g,
    )
    expect(retrySites).toHaveLength(2)
  })
})
