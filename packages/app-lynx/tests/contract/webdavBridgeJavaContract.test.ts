// WebDAV 桥跨语言契约：**Lynx ↔ Java 契约**（ADR-0203 决策 5 迁移件）。
//
// 形态说明：原 `app/tests/unit/differential/webdavBridgeContract.test.ts` 同时比对（该源已随 WebView 客户端删除，ADR-0203 决策 2）
// Java 与**两个** TS 桥（`app/src/native/WebDav.ts` + app-lynx 桥）。WebView 侧随
// packages/app 删除后其桥文件与被测对象一并消失，**不得**保留对它的引用；
// 本文件只断言仍然存在的对侧：Java 宿主实现（协议/枚举/常量/注册）↔ Lynx 桥。
// 任一漂移 = 桥静默失效（TS 调不存在的动词 / kind 映射落到 SERVER 兜底）。
//
// oracle 溯源：
//   - Kind 枚举与固定值 = spec docs/specs/webdav-backup.md §5 错误分类映射 + ADR-0156 D1
//   - 协议子集（MKCOL/PUT/GET/PROPFIND/DELETE，无 LOCK/MOVE/ETag）= spec §4
//   - 错误 payload 三键 = PictelioWebDavModule 的 javadoc 契约 + 桥的解析实现
//   - 注册点 = LynxRuntimeInitializer
//
// Java 路径指向 **最终位置** `packages/android-host/android/`（ADR-0203 决策 2）。
// 匹配纪律：枚举用「集合相等双向比对」而非逐字包含——改名/增删任一侧都必须红，
// 且不会因 Java 枚举多出一个 kind 而被 `toContain` 静默放过。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const HOST = resolve(pkgRoot, 'android-host/android/app/src')

const CLIENT_JAVA = readFileSync(
  resolve(HOST, 'main/java/io/pictelio/app/WebDavClient.java'),
  'utf-8',
)
const MODULE_JAVA = readFileSync(
  resolve(HOST, 'lynx/java/io/pictelio/app/PictelioWebDavModule.java'),
  'utf-8',
)
const INITIALIZER_JAVA = readFileSync(
  resolve(HOST, 'lynx/java/io/pictelio/app/LynxRuntimeInitializer.java'),
  'utf-8',
)
const LYNX_BRIDGE = readFileSync(
  resolve(pkgRoot, 'app-lynx/src/utils/webDavBridge.ts'),
  'utf-8',
)

/** spec §5 错误分类 + §6 解密失败归类（CRYPTO 仅桥层，无对应 Java 枚举成员） */
const KINDS = [
  'AUTH_FAILED',
  'FORBIDDEN',
  'NOT_FOUND',
  'QUOTA_EXCEEDED',
  'CONFLICT',
  'NETWORK',
  'SERVER',
  'CRYPTO',
] as const

/** spec §4 协议子集（桥层暴露的动词） */
const VERBS = [
  'ensureDir',
  'upload',
  'uploadWithVerify',
  'download',
  'list',
  'stat',
  'delete',
  'prune',
  'encrypt',
  'decrypt',
  'isEncrypted',
] as const

/** 剥注释：注释里的裸大写词（HTTP 状态说明）不得被误抓成枚举成员 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

/** 抽取 Java enum Kind 的成员（剥注释后取全大写标识符） */
function javaKindMembers(source: string): string[] {
  const block = source.match(/enum\s+Kind\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
  return [...stripComments(block).matchAll(/\b([A-Z][A-Z_]+)\b/g)].map((m) => m[1])
}

describe('WebDAV 桥契约：Lynx ↔ Java（Kind 分类）', () => {
  it('Java 枚举抽取器下界自检：确实抽到了成员（防抽取失效致全称断言恒真）', () => {
    expect(javaKindMembers(CLIENT_JAVA).length).toBeGreaterThanOrEqual(5)
  })

  it('Java Kind 枚举成员 = spec §5 分类集合减去桥层专有的 CRYPTO', () => {
    const expectedJava = KINDS.filter((k) => k !== 'CRYPTO')
    // 集合相等（双向）：Java 枚举多出或缺少任何 kind 都必须红
    expect(new Set(javaKindMembers(CLIENT_JAVA))).toEqual(new Set(expectedJava))
  })

  it('Lynx 桥的 WEBDAV_ERROR_KINDS = spec §5 全集（含 CRYPTO）', () => {
    const declared = LYNX_BRIDGE.match(
      /WEBDAV_ERROR_KINDS[^=]*=\s*\[([\s\S]*?)\]/,
    )?.[1]
    expect(declared, 'WEBDAV_ERROR_KINDS 数组必须存在（抽取器下界自检）').toBeTruthy()
    const kinds = [...(declared ?? '').matchAll(/"([A-Z_]+)"/g)].map((m) => m[1])
    expect(new Set(kinds)).toEqual(new Set(KINDS))
  })

  it('桥层必须把未知 kind 显式降级为 SERVER 并留痕（禁止静默兜底，测试硬约束 #3）', () => {
    // 语义判定：抽出「已知性判定 → 未知分支」这一段，要求它同时 warn 并回落 SERVER
    const fallback = LYNX_BRIDGE.match(
      /const known = WEBDAV_ERROR_KINDS\.includes\(([\s\S]*?)\n {4}\}/,
    )?.[0]
    expect(fallback, '必须存在「已知 kind 判定 → 未知则回落」分支（抽取器下界自检）').toBeTruthy()
    expect(fallback).toMatch(/console\.warn\(/)
    expect(fallback).toMatch(/:\s*"SERVER"/)
  })
})

describe('WebDAV 桥契约：Lynx ↔ Java（错误 payload 与回调）', () => {
  it('错误 payload 三键（kind / statusCode / message）两侧同形', () => {
    for (const key of ['kind', 'statusCode', 'message']) {
      expect(MODULE_JAVA, `Java 模块必须产出 ${key}`).toMatch(new RegExp(`"${key}"`))
      expect(LYNX_BRIDGE, `Lynx 桥必须解析 ${key}`).toContain(key)
    }
  })

  it('Java 模块对 CRYPTO / SERVER 兜底有显式分支（解密失败不落进协议分类）', () => {
    expect(MODULE_JAVA).toContain('"CRYPTO"')
    expect(MODULE_JAVA).toContain('"SERVER"')
  })

  it('Callback 双参契约：成功 invoke(0, …) / 失败 invoke(1, …)，不得传裸 null 参数', () => {
    // 平台事实：Lynx CallbackImpl 对 null 参数崩溃（module javadoc 记录的真机实测），
    // 故两条路径都必须是「状态码 + payload」双参。
    expect(MODULE_JAVA).toMatch(/callback\.invoke\(0,/)
    expect(MODULE_JAVA).toMatch(/callback\.invoke\(1,/)
    // 桥侧回调签名必须声明双参
    expect(LYNX_BRIDGE).toMatch(/\(code:\s*number,\s*payload:\s*string\)/)
  })
})

describe('WebDAV 桥契约：Lynx ↔ Java（动词与注册点）', () => {
  it('两侧暴露同一组动词（TS 调 Java 不存在的方法 = 桥静默失效）', () => {
    for (const verb of VERBS) {
      expect(MODULE_JAVA, `PictelioWebDavModule 缺 ${verb}`).toMatch(
        new RegExp(`void\\s+${verb}\\s*\\(`),
      )
      expect(LYNX_BRIDGE, `Lynx 桥缺 ${verb}`).toContain(`${verb}`)
    }
  })

  it('注册点存在且模块名一致（漏注册 = 桥静默失效）', () => {
    expect(INITIALIZER_JAVA).toMatch(
      /registerModule\(\s*"PictelioWebDav"\s*,\s*PictelioWebDavModule\.class\s*\)/,
    )
    expect(LYNX_BRIDGE).toContain('PictelioWebDav')
  })

  it('桥层引用协议常量而非字面量（防与 WebDavClient 漂移）', () => {
    expect(MODULE_JAVA).toContain('WebDavClient.VERIFY_MAX_ATTEMPTS')
    expect(MODULE_JAVA).toContain('WebDavClient.KEEP_BACKUPS')
  })
})

describe('WebDAV 桥契约：Lynx ↔ Java（协议子集与固定值）', () => {
  it('spec §5 固定值：重试 3 / 保留 10 份，Java 侧是唯一事实源', () => {
    const attempts = CLIENT_JAVA.match(/VERIFY_MAX_ATTEMPTS\s*=\s*(\d+)/)?.[1]
    const keep = CLIENT_JAVA.match(/KEEP_BACKUPS\s*=\s*(\d+)/)?.[1]
    expect(attempts).toBe('3')
    expect(keep).toBe('10')
  })

  it('spec §4：非标准动词显式传 method；LOCK/MOVE/If-Match 不得作为头上传', () => {
    const code = stripComments(CLIENT_JAVA)
    for (const verb of ['MKCOL', 'PUT', 'PROPFIND']) {
      expect(code, `WebDavClient 必须显式发出 ${verb}`).toContain(`"${verb}"`)
    }
    expect(code).toContain('.get()')
    expect(code).toContain('.delete()')
    // 反向钉子：条件请求与锁/移动不在协议子集内
    expect(code).not.toContain('"LOCK"')
    expect(code).not.toContain('"MOVE"')
    expect(code).not.toContain('"If-Match"')
  })
})
