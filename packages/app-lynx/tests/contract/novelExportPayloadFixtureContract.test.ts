// 小说导出 golden payload 跨语言契约：**Lynx ↔ Java 契约**（ADR-0203 决策 5 迁移件）。
//
// 形态说明：原 `app/tests/unit/differential/novelExportPayloadFixtureConsistency.test.ts`（该源已随 WebView 客户端删除，ADR-0203 决策 2）
// 位于 WebView 包内，但它断言的**两侧都不是 WebView 源码**：TS 侧是 workspace 包
// `@pictelio/novel-export` 的 golden fixture，Java 侧是 Android 测试资源。
// ⇒ 这是纯跨语言数据契约，WebView 客户端删除不影响其成立，判定为「迁」。
// Java 侧路径随宿主迁移改指 **最终位置** `packages/android-host/android/`。
//
// oracle 溯源：两侧 fixture 的真值来源是构建器产出的**真实 TS payload**
// （测试硬约束 #2：Java 侧 oracle 必须来自真实 TS 产出，禁手写自洽字段）。
// 本测试只保证「双副本不漂移」，不承担字段语义判定。
import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

const TS_FIXTURE = resolve(
  pkgRoot,
  'novel-export/tests/fixtures/sample-payload.json',
)
const JAVA_FIXTURE = resolve(
  pkgRoot,
  'android-host/android/app/src/test/resources/novel-export-sample-payload.json',
)

describe('golden payload 跨语言副本契约（TS ↔ Java）', () => {
  it('两侧 fixture 均存在（宿主迁移后路径必须指向最终位置）', () => {
    expect(existsSync(TS_FIXTURE), `TS fixture 缺失: ${TS_FIXTURE}`).toBe(true)
    expect(existsSync(JAVA_FIXTURE), `Java fixture 缺失: ${JAVA_FIXTURE}`).toBe(true)
  })

  it('两侧副本逐字节一致（任一单侧改动而不同步即红）', () => {
    expect(readFileSync(TS_FIXTURE, 'utf8')).toBe(readFileSync(JAVA_FIXTURE, 'utf8'))
  })

  it('fixture 是可解析 JSON 且非空（空壳副本会让上一条断言恒真）', () => {
    const raw = readFileSync(TS_FIXTURE, 'utf8')
    expect(raw.length).toBeGreaterThan(0)
    const parsed = JSON.parse(raw) as Record<string, unknown>
    expect(Object.keys(parsed).length).toBeGreaterThan(0)
  })
})
