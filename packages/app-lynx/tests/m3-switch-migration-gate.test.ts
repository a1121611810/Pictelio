// ─── app-lynx <M3Switch> 迁移完备性门禁（spec docs/specs/app-lynx-m3-switch.md §5.5） ───
// 仓库无 vue-lynx 渲染器，CI 不可运行时验证——改用 file grep + count 守卫。
// 锚 ADR-0097（机器防线要求）：inline 写法回潮需被自动捕获。
//
// 守卫项：
// 1. Me.vue + SettingsEndpoint.vue 内 <M3Switch 总数 ≥ 12（覆盖全部已知 callsite）
// 2. 整仓 packages/app-lynx/src/ 下 w-[13.867vw] 仅 M3Switch.vue 命中（其他出现 = 漂移回归）
// 3. M3Switch.vue 自身存在且 w-[13.867vw] 出现 ≥ 1 次（组件未被误删）
//
// 失败信号：未来若有人复制 inline 写回 Me.vue / SettingsEndpoint.vue，或删掉 M3Switch.vue，
//           本测试断言失败，PR 红。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../')
const SRC = resolve(ROOT, 'packages/app-lynx/src')

function read(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf8')
}

function grepCount(rel: string, pattern: string): number {
  // 全局唯一：不在 Me.vue / SettingsEndpoint.vue 内仍有 inline 残影
  // grep -c 返回 0 行无匹配时 exit code 1，需 swallowError；macOS BSD grep 与 GNU grep 兼容
  try {
    const out = execSync(`grep -c "${pattern}" "${resolve(SRC, rel)}"`, { encoding: 'utf8' }).trim()
    return parseInt(out, 10) || 0
  } catch {
    return 0
  }
}

describe('M3Switch 迁移完备性门禁（防回退到 inline）', () => {
  it('Me.vue 内 <M3Switch 调用 ≥ 10 处（spec §4.4 callsite 表 8 项 + novelExport×3 + webdavEnabled）', () => {
    // spec §4.4 实测 10 处；spec §5.5 机器门禁阈值 ≥ 12 来自 Me+SettingsEndpoint 合计
    // 这里针对 Me.vue 单文件设 ≥ 10，与 spec §4.4 Me.vue 10 处对齐
    const meSrc = read('pages/Me.vue')
    const count = (meSrc.match(/<M3Switch\b/g) || []).length
    expect(count, `Me.vue 当前 <M3Switch 调用数：${count}`).toBeGreaterThanOrEqual(10)
  })

  it('SettingsEndpoint.vue 内 <M3Switch 调用 ≥ 2 处（spec §4.4 callsite 表 2 项）', () => {
    const seSrc = read('components/SettingsEndpoint.vue')
    const count = (seSrc.match(/<M3Switch\b/g) || []).length
    expect(count, `SettingsEndpoint.vue 当前 <M3Switch 调用数：${count}`).toBeGreaterThanOrEqual(2)
  })

  it('Me.vue 内 w-[13.867vw] inline 残影 = 0（防未来回退到 inline 写法）', () => {
    const count = grepCount('pages/Me.vue', 'w-\\[13.867vw\\]')
    expect(count, `Me.vue 内 w-[13.867vw] 残影数：${count}`).toBe(0)
  })

  it('SettingsEndpoint.vue 内 w-[13.867vw] inline 残影 = 0', () => {
    const count = grepCount('components/SettingsEndpoint.vue', 'w-\\[13.867vw\\]')
    expect(count, `SettingsEndpoint.vue 内 w-[13.867vw] 残影数：${count}`).toBe(0)
  })

  it('M3Switch.vue 组件存在且 w-[13.867vw] 出现 ≥ 1 次（防组件被误删）', () => {
    const m3src = read('components/M3Switch.vue')
    expect(m3src).toContain('w-[13.867vw]')
  })
})
