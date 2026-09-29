// WebDAV 备份格式契约：**Lynx ↔ spec + Java 契约**（ADR-0203 决策 5 迁移件）。
//
// 形态说明：合并迁移自 `app/tests/unit/differential/` 的三个文件——（该源已随 WebView 客户端删除，ADR-0203 决策 2）
// `backupSnapshotContract`（spec ↔ 代码）、`backupCoreConsistency`（两端 core 逐字）、
// `backupServiceConsistency`（两端 service ↔ Java）。原三者的对侧断言一律是
// 「WebView 副本与 Lynx 副本一致」；对侧删除后改为断言 Lynx 侧与**两个仍存在的对侧**：
//   ① 需求侧 spec（docs/specs/webdav-backup.md）—— 格式的唯一规范出处
//   ② 协议侧 Java（WebDavClient / BackupCrypto）—— 协议的单一事实源
//
// oracle 溯源（每条断言都指向独立来源，禁自洽反推）：
//   - 格式标识 / schemaVersion / 九个字段 / 文件名 / 封装 magic = spec §3.2/§3.3/§3.4
//   - 账号级键前缀 = spec §3.1 + ADR-0103 契约键
//   - 拒绝分类 / 错误分类 = spec §6 / §5
//   - 固定值（重试 3 / 保留 10）= spec §5 字面 + Java 常量
//   - 协议子集 = spec §4
//
// Java 路径指向 **最终位置** `packages/android-host/android/`（ADR-0203 决策 2）。
// 匹配纪律：常量取值用「提取后比对」而非 `toContain("KEEP_BACKUPS = 10")` 这类形态锁定
// ——改名/改类型（如 int → short）不得让防线误报，值漂移必须红。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const repoRoot = resolve(pkgRoot, '..')
const HOST = resolve(pkgRoot, 'android-host/android/app/src')

const SPEC = readFileSync(resolve(repoRoot, 'docs/specs/webdav-backup.md'), 'utf-8')
const LYNX_CORE = readFileSync(resolve(pkgRoot, 'app-lynx/src/utils/backupCore.ts'), 'utf-8')
const LYNX_SERVICE = readFileSync(resolve(pkgRoot, 'app-lynx/src/utils/backupService.ts'), 'utf-8')
const CLIENT_JAVA = readFileSync(
  resolve(HOST, 'main/java/io/pictelio/app/WebDavClient.java'),
  'utf-8',
)
const CRYPTO_JAVA = readFileSync(
  resolve(HOST, 'main/java/io/pictelio/app/BackupCrypto.java'),
  'utf-8',
)

/** spec §3.2 快照字段（唯一的规范字段序） */
const SNAPSHOT_FIELDS = [
  'format',
  'schemaVersion',
  'appVersion',
  'engine',
  'createdAt',
  'excludedKeys',
  'deviceKeys',
  'accountKeys',
  'sets',
] as const

/** spec §3.1 账号级键前缀（ADR-0103 契约键） */
const ACCOUNT_PREFIXES = ['show_r18_', 'show_r18g_', 'ai_filter_mode_'] as const

/** spec §6 解析拒绝分类 */
const FORMAT_ERROR_KINDS = ['NOT_BACKUP', 'SCHEMA_TOO_NEW', 'CORRUPT'] as const

/** spec §5 错误分类 + §6 解密失败（CRYPTO） */
const ERROR_KINDS = [
  'AUTH_FAILED',
  'FORBIDDEN',
  'NOT_FOUND',
  'QUOTA_EXCEEDED',
  'CONFLICT',
  'NETWORK',
  'SERVER',
  'CRYPTO',
] as const

/** 公共导出面（调用层消费） */
const EXPORTS = [
  'partitionKeys',
  'buildSnapshot',
  'serializeSnapshot',
  'parseSnapshot',
  'planRestore',
  'summarize',
  'isAccountScopedKey',
  'accountUidOf',
] as const

/** 从源码提取 `NAME = <字面量>` 的字面量部分（容忍类型标注差异） */
function literalOf(source: string, name: string): string | undefined {
  return source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*["']([^"']*)["']`))?.[1]
}

function numberOf(source: string, name: string): number | undefined {
  return source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*(\\d+)`))?.[1] === undefined
    ? undefined
    : Number(source.match(new RegExp(`\\b${name}\\s*(?::[^=]+)?=\\s*(\\d+)`))?.[1])
}

describe('备份快照契约：Lynx ↔ spec（格式与字段）', () => {
  it('格式标识与 schemaVersion：spec §3.2 钉住值，Lynx core 取值一致', () => {
    expect(SPEC).toMatch(/"format":\s*"pictelio-backup"/)
    expect(SPEC).toMatch(/"schemaVersion":\s*1/)
    expect(literalOf(LYNX_CORE, 'BACKUP_FORMAT')).toBe('pictelio-backup')
    expect(numberOf(LYNX_CORE, 'BACKUP_SCHEMA_VERSION')).toBe(1)
  })

  it('快照九个字段齐全且与 spec 字段序一致（core 的类型声明逐个命中）', () => {
    for (const field of SNAPSHOT_FIELDS) {
      expect(SPEC, `spec 必须声明字段 ${field}`).toContain(field)
      expect(LYNX_CORE, `Lynx core 必须承载字段 ${field}`).toContain(field)
    }
    // 字段在 core 里的声明顺序与 spec 规范顺序一致（快照是可序列化契约，顺序即兼容面）
    const typeBlock = LYNX_CORE.match(/(?:interface|type)\s+\w*Snapshot\w*\s*=\s*\{([\s\S]*?)\n\}/)?.[1]
      ?? LYNX_CORE.match(/(?:interface|type)\s+\w*Snapshot\w*\s*\{([\s\S]*?)\n\}/)?.[1]
    expect(typeBlock, '必须能抽出快照类型声明（抽取器下界自检）').toBeTruthy()
    const declared = SNAPSHOT_FIELDS.map((f) => (typeBlock ?? '').indexOf(f))
    expect(declared.every((i) => i >= 0), '九个字段必须都在类型声明里').toBe(true)
    expect(declared).toEqual([...declared].sort((a, b) => a - b))
  })

  it('账号级键前缀 = spec §3.1 + ADR-0103（提取后集合比对，非逐字包含）', () => {
    const declared = LYNX_CORE.match(/ACCOUNT_KEY_PREFIXES[^=]*=\s*\[([\s\S]*?)\]/)?.[1]
    expect(declared, 'ACCOUNT_KEY_PREFIXES 必须存在（抽取器下界自检）').toBeTruthy()
    const prefixes = [...(declared ?? '').matchAll(/["']([^"']+)["']/g)].map((m) => m[1])
    expect(new Set(prefixes)).toEqual(new Set(ACCOUNT_PREFIXES))
  })

  it('解析拒绝边界 = spec §6 三类（标识符取自 core 声明，文案取自 spec 需求侧）', () => {
    // spec §6 只给需求语义（「不是有效的 Pictelio 备份」/「备份来自更新版本…」），
    // 标识符是实现侧命名；两者按 kind↔语义配对，不把标识符当 spec 字面量。
    const declared = LYNX_CORE.match(/type\s+BackupFormatErrorKind\s*=\s*([\s\S]*?)\n/)?.[1]
    expect(declared, 'BackupFormatErrorKind 必须声明（抽取器下界自检）').toBeTruthy()
    const kinds = [...(declared ?? '').matchAll(/"([A-Z_]+)"/g)].map((m) => m[1])
    expect(new Set(kinds)).toEqual(new Set(FORMAT_ERROR_KINDS))

    // 需求侧：两类拒绝的用户可见语义必须在 spec 中有出处
    expect(SPEC).toContain('不是有效的 Pictelio 备份')
    expect(SPEC).toContain('备份来自更新版本的应用，请升级后恢复')
    // 实现侧：SCHEMA_TOO_NEW 只能由「版本高于支持版本」这一分支抛出
    const tooNewBranch = LYNX_CORE.match(
      /if\s*\(schemaVersion\s*>\s*supportedVersion\)[\s\S]{0,160}?BackupFormatError\(\s*"SCHEMA_TOO_NEW"/,
    )?.[0]
    expect(tooNewBranch, 'SCHEMA_TOO_NEW 必须由「版本高于支持版本」分支抛出').toBeTruthy()
    // 反向钉子：不得把「版本未知/非法」也归成 SCHEMA_TOO_NEW（那会误导用户去升级）
    expect(LYNX_CORE).toMatch(
      /typeof schemaVersion !== "number"[\s\S]{0,200}?BackupFormatError\(\s*"CORRUPT"/,
    )
  })

  it('错误分类全集 = spec §5 + CRYPTO（提取后集合比对）', () => {
    for (const kind of ERROR_KINDS) {
      expect(LYNX_CORE, `Lynx core 必须承载 ${kind}`).toContain(kind)
    }
    // Java 侧 Kind 枚举 = 该全集减去 CRYPTO（CRYPTO 是桥层对 CryptoException 的归类）
    const enumBlock = CLIENT_JAVA.match(/enum\s+Kind\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''
    const javaKinds = [...enumBlock
      .replace(/\/\/[^\n]*/g, '')
      .matchAll(/\b([A-Z][A-Z_]+)\b/g)]
    javaKinds.length
    expect(new Set(javaKinds.map((m) => m[1]))).toEqual(
      new Set(ERROR_KINDS.filter((k) => k !== 'CRYPTO')),
    )
  })

  it('导出面齐全（调用层与测试都消费这一组函数）', () => {
    for (const fn of EXPORTS) {
      expect(LYNX_CORE, `Lynx core 必须导出 ${fn}`).toContain(`export function ${fn}`)
    }
  })

  it('恢复计划字段齐全（apply / sets / skipped*）', () => {
    for (const f of ['apply', 'sets', 'skippedAccountKeys', 'skippedExcludedKeys']) {
      expect(LYNX_CORE, `恢复计划必须含 ${f}`).toContain(f)
    }
  })
})

describe('备份服务契约：Lynx ↔ spec + Java（文件名与固定值）', () => {
  it('文件名前缀与加密后缀：spec §3.4 钉住值，Lynx service 取值一致', () => {
    expect(SPEC).toContain('pictelio-backup-<yyyyMMdd-HHmmss>.json')
    expect(SPEC).toContain('.json.enc')
    expect(literalOf(LYNX_SERVICE, 'BACKUP_FILE_PREFIX')).toBe('pictelio-backup-')
    expect(literalOf(LYNX_SERVICE, 'ENCRYPTED_SUFFIX')).toBe('.enc')
  })

  it('固定值重试 3 / 保留 10：spec §5 字面 + Java 常量 + Lynx service 三方一致', () => {
    expect(SPEC).toContain('重试 ×3')
    expect(SPEC).toContain('保留最近 10 份')
    expect(numberOf(CLIENT_JAVA, 'VERIFY_MAX_ATTEMPTS')).toBe(3)
    expect(numberOf(CLIENT_JAVA, 'KEEP_BACKUPS')).toBe(10)
    expect(numberOf(LYNX_SERVICE, 'VERIFY_MAX_ATTEMPTS')).toBe(3)
    expect(numberOf(LYNX_SERVICE, 'KEEP_BACKUPS')).toBe(10)
  })

  it('恢复流程钩子顺序：应急快照先于写回（T9 语义，防回归成「先写回再快照」）', () => {
    // 语义判定：取 onBeforeApply 调用点与 apply 调用点的位置，要求前者更早。
    // 容忍 `await deps.onBeforeApply()` / `await deps.onBeforeApply?.()` 两种写法。
    const hookAt = LYNX_SERVICE.search(/await\s+deps\.onBeforeApply/)
    const applyAt = LYNX_SERVICE.search(/await\s+deps\.apply\(/)
    expect(hookAt, 'onBeforeApply 钩子必须存在（抽取器下界自检）').toBeGreaterThanOrEqual(0)
    expect(applyAt, 'apply 写回必须存在（抽取器下界自检）').toBeGreaterThanOrEqual(0)
    expect(hookAt).toBeLessThan(applyAt)
  })

  it('自动备份边界：恰好 N 天跳过；非法时间戳显式 warn 不静默（spec §7 / 测试硬约束 #3）', () => {
    expect(LYNX_SERVICE).toMatch(/elapsedDays\s*<=\s*[\w.]*days[\s\S]{0,20}return null/)
    expect(LYNX_SERVICE).toMatch(/console\.warn\(\s*["']\[backupService\]/)
  })
})

describe('加密封装契约：Lynx ↔ spec + Java（§3.3）', () => {
  it('封装 magic 与算法：spec §3.3 钉住，Java BackupCrypto 为实现侧事实源', () => {
    expect(SPEC).toContain('PICTELIO-ENC1')
    expect(CRYPTO_JAVA).toContain('"PICTELIO-ENC1"')
    // 语义判定：算法名以字面量出现即命中（避免写成常量拼接时误报）
    expect(CRYPTO_JAVA).toContain('PBKDF2WithHmacSHA256')
    expect(CRYPTO_JAVA).toContain('AES/GCM/NoPadding')
  })
})
