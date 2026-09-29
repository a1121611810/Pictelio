// settings_language 契约测试：**Lynx ↔ Java 读侧 + spec 契约**（ADR-0203 决策 5 改写件）。
//
// 形态说明（与迁移前的关键差异）：本文件原为「双端语言键契约」，读取已删除的
// `packages/app/src/i18n/index.ts` 与被测的 WebView 侧字面量。WebView 客户端随
// ADR-0203 删除后对侧消失，**不得**留悬空引用；改为断言 Lynx 侧与两个仍然存在的
// 对侧一致：
//   ① Java 读侧：PictelioApiModule 经 PictelioPrefsModule 读同一键（ADR-0200 D2）
//   ② 需求侧 spec：docs/specs/i18n.md §设置键（键名与值域的唯一需求出处）
//
// oracle 溯源：
//   - 键名 `settings_language` 与值域 `"" | "zh-CN" | "en"` = spec docs/specs/i18n.md:53
//   - Java 读侧接线与 Accept-Language 解析 = ADR-0200 D1/D2/D5
//   - 401 重试透传 = ADR-0200 D5 + spec docs/specs/lynx-accept-language-header.md
//   （401 刷新真路径在 JVM 单测不可达——OAuth AUTH_URL 为编译期常量内联会打真实网络——
//     故按 bridge-contract 先例以源码契约钉住；解析表五分支已有
//     PictelioAcceptLanguageTest JVM 防线，本文件不重复钉字面量。）
//
// Java 路径：随宿主迁移指向 **最终位置** `packages/android-host/android/`（ADR-0203 决策 2）。
// 匹配纪律：能用语义判定的一律按语义（键提取 + 值域集合），不按格式敏感的字面量。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/** packages/ 根（tests/contract → ../../..）与仓库根（→ ../../../..） */
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repoRoot = resolve(pkgRoot, '..')

/** 宿主包最终路径（ADR-0203 决策 2：packages/app/android → packages/android-host/android） */
const HOST_JAVA = resolve(pkgRoot, 'android-host/android/app/src')
const API_MODULE = readFileSync(
  resolve(HOST_JAVA, 'lynx/java/io/pictelio/app/PictelioApiModule.java'),
  'utf-8',
)
const PREFS_MODULE = readFileSync(
  resolve(HOST_JAVA, 'lynx/java/io/pictelio/app/PictelioPrefsModule.java'),
  'utf-8',
)
const API_CORE = readFileSync(
  resolve(HOST_JAVA, 'main/java/io/pictelio/app/PixivApiCore.java'),
  'utf-8',
)

/** Lynx 侧设置存储与需求侧 spec */
const LYNX_STORE = readFileSync(resolve(pkgRoot, 'app-lynx/src/stores/settingsStore.ts'), 'utf-8')
const I18N_SPEC = readFileSync(resolve(repoRoot, 'docs/specs/i18n.md'), 'utf-8')

/** spec 声明的值域（docs/specs/i18n.md:53「值域 `"" | "zh-CN" | "en"`」） */
const SPEC_VALUES = ['', 'zh-CN', 'en']

/** 从 TS/Java 源码提取「键常量 = 字面量」的值（形如 `KEY = "settings_language"`） */
function keyLiteral(source: string, keyIdent: string): string | undefined {
  return source.match(new RegExp(`\\b${keyIdent}\\s*(?::[^=]+)?=\\s*["']([^"']+)["']`))?.[1]
}

describe('settings_language 契约：Lynx ↔ Java 读侧 ↔ spec', () => {
  it('三侧读到同一个键名（spec 钉住字面量，TS 与 Java 各自提取后比对）', () => {
    // oracle = spec docs/specs/i18n.md:53 —— 需求侧单一出处
    expect(I18N_SPEC).toContain('`settings_language`')

    const specKey = I18N_SPEC.match(/`([a-z_]*language[a-z_]*)`/)?.[1]
    expect(specKey, 'spec 必须显式给出 settings_language 键名').toBe('settings_language')

    const lynxKey = keyLiteral(LYNX_STORE, 'LANGUAGE_KEY')
    const javaKey = keyLiteral(API_MODULE, 'SETTINGS_KEY_LANGUAGE')
    expect(lynxKey, 'Lynx 侧必须声明 settings_language 键常量').toBe(specKey)
    expect(javaKey, 'Java 侧必须声明 settings_language 键常量').toBe(specKey)
  })

  it('Lynx 侧值域与 spec 一致：载入白名单与回写拒绝集都恰好等于 spec 的值域', () => {
    // 语义判定：取两处判定的字符串字面量集合与 spec 值域比对，不依赖书写顺序或代码形态。
    const nonEmpty = SPEC_VALUES.filter((v) => v !== '')

    // 载入路径：prefs().get(LANGUAGE_KEY) 之后的 if 白名单
    const loadBranch = LYNX_STORE.match(/prefs\(\)\.get\(LANGUAGE_KEY\)[\s\S]*?\n {4}\}/)?.[0] ?? ''
    expect(loadBranch, '载入分支必须存在（抽取器下界自检）').not.toBe('')
    const loadAccepted = new Set(
      [...loadBranch.matchAll(/raw === "([^"]*)"/g)].map((m) => m[1]),
    )
    expect(loadAccepted, '载入白名单必须恰好是 spec 的非空值域').toEqual(new Set(nonEmpty))

    // 回写路径：applyRawKey 的 LANGUAGE_KEY 分支内被拒绝的取值集合
    const applyBranch = LYNX_STORE.match(/case LANGUAGE_KEY:\n([\s\S]*?)\n {6}case /)?.[1] ?? ''
    expect(applyBranch, 'applyRawKey 的 LANGUAGE_KEY 分支必须存在（抽取器下界自检）').not.toBe('')
    const rejected = new Set(
      [...applyBranch.matchAll(/raw !== "([^"]*)"/g)].map((m) => m[1]),
    )
    expect(rejected, '回写白名单必须恰好是 spec 的值域（含空串 = 跟随系统）').toEqual(
      new Set(SPEC_VALUES),
    )

    // 反证：值域外的标签不得被写侧接受
    expect(applyBranch).not.toMatch(/raw !== "fr"/)
  })

  it('Java 读侧接线：键经 PictelioPrefsModule 读（ADR-0200 D2，零桥签名变更）', () => {
    const javaKey = keyLiteral(API_MODULE, 'SETTINGS_KEY_LANGUAGE')
    expect(javaKey).toBe('settings_language')
    // 语义：Java 侧读语言设置时必须走 PictelioPrefsModule.get(ctx, <该键常量>)
    expect(API_MODULE).toMatch(/PictelioPrefsModule\.get\(\s*ctx\s*,\s*SETTINGS_KEY_LANGUAGE\s*\)/)
    // 同一 SharedPreferences 文件（ADR-0103 契约键，存量格式勿改）
    const prefsFile = PREFS_MODULE.match(/PREFS_FILE\s*=\s*"([^"]+)"/)?.[1]
    expect(prefsFile).toBe('CapacitorStorage')
  })

  it('Java 失败语义显式留痕：读取抛异常不得静默（ADR-0200 D5）', () => {
    const readMethod = API_MODULE.match(/private String readLanguageSetting\(\)\s*\{([\s\S]*?)\n    \}/)?.[1]
    expect(readMethod, 'readLanguageSetting 方法体必须存在（抽取器下界自检）').toBeTruthy()
    expect(readMethod).toMatch(/Log\.w\(/)
  })

  it('Java 初始调用胶水钉：request 把解析结果传入 executeRequest（防线纵深）', () => {
    // 抽取器下界自检：胶水行存在，否则本组断言恒真
    expect(API_MODULE).toMatch(/PixivApiCore\.executeRequest\(/)
    // 语义：胶水行必须把 resolveAcceptLanguage 的结果作为 acceptLanguage 形参传下去
    expect(API_CORE).toMatch(
      /[\w.]*executeRequest\(\s*method\s*,\s*url\s*,\s*body\s*,\s*[\w.]*acceptLanguage[\w.]*\s*,/,
    )
  })

  it('Java E4：401 重试的两处递归重放都透传 acceptLanguage（ADR-0200 D5）', () => {
    // 语义判定而非字面量匹配：取所有 executeRequest( 调用点，
    // 挑出「含 acceptLanguage 实参且带重试标志 true」的重放点，数量必须恰好为 2
    // （旋转成功分支 + 他人已完成刷新分支）。
    const calls = [...API_CORE.matchAll(/executeRequest\(([^;]*?)\);/g)].map((m) => m[1])
    const replays = calls.filter((args) => /acceptLanguage/.test(args) && /,\s*true\s*,/.test(args))
    expect(calls.length, 'executeRequest 调用点必须非空（抽取器下界自检）').toBeGreaterThan(0)
    expect(replays, '401 重放点必须恰好两处').toHaveLength(2)
    // 反证：不得存在「重放但不透传语言」的调用点（该写法会让重试请求丢掉 Accept-Language）
    const replayWithoutLang = calls.filter((args) => /,\s*true\s*,/.test(args) && !/acceptLanguage/.test(args))
    expect(replayWithoutLang).toHaveLength(0)
  })
})
