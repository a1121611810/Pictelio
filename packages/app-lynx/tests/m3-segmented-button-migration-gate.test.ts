// ─── app-lynx <M3SegmentedButton> 迁移完备性门禁（spec docs/specs/app-lynx-m3-segmented-button.md §5.5） ───
// 仓库无 vue-lynx 渲染器，CI 不可运行时验证——改用 file grep + count 守卫。
// 锚 ADR-0097（机器防线要求）/ ADR-0190：inline 分段控件 markup 回潮需被自动捕获。
// 背景：7eb0f5eb 曾「修 2 漏 1」（给 ugoira/quality 补段间 border-l 漏 AI 组），
//       5 份拷贝漂移的实际教训是门禁存在的前提。
//
// 守卫项：
// 1. 整仓 src/ 内容器特征串仅 M3SegmentedButton.vue（+其 template test 断言字面量）命中
// 2. Me.vue 内 <M3SegmentedButton 调用 ≥ 4（外观/AI/动图/画质 4 组）
// 3. TranslateModeSwitch.vue 内 <M3SegmentedButton 调用 ≥ 1
// 4. M3SegmentedButton.vue 存在且含容器特征串（组件未被误删）
//
// 失败信号：未来若有人复制 inline 分段 markup 写回任意页面/组件，本测试断言失败，PR 红。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const ROOT = resolve(fileURLToPath(import.meta.url), '../../../../')
const SRC = resolve(ROOT, 'packages/app-lynx/src')

const CONTAINER_SIGNATURE = 'rounded-[var(--md-shape-full)] border border-outline overflow-hidden'
// 容器特征串在 src/ 内的合法持有者：组件本体 + 其 template test 的断言字面量
const SIGNATURE_ALLOWLIST = [
  'components/M3SegmentedButton.vue',
  'components/M3SegmentedButton.template.test.ts',
]

function read(rel: string): string {
  return readFileSync(resolve(SRC, rel), 'utf8')
}

describe('M3SegmentedButton 迁移完备性门禁（防回退到 inline 分段 markup）', () => {
  it('整仓 src/ 内 inline 容器特征串仅组件本体 + 其测试断言命中（其他出现 = 漂移回归）', () => {
    // grep -rlF：固定字符串递归列举；-F 使 [var(--md-shape-full)] 按字面匹配
    const out = execSync(
      `grep -rlF "${CONTAINER_SIGNATURE}" "${SRC}" || true`,
      { encoding: 'utf8' },
    )
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((abs) => abs.slice(SRC.length + 1))
    const offenders = out.filter((rel) => !SIGNATURE_ALLOWLIST.includes(rel))
    expect(
      offenders,
      `容器特征串在以下非白名单文件出现（inline 分段 markup 回潮）：${offenders.join(', ') || '（无）'}`,
    ).toEqual([])
    // 白名单文件必须至少持有组件本体（防 grep 路径漂移导致守卫空转）
    expect(out).toContain('components/M3SegmentedButton.vue')
  })

  it('Me.vue 内 <M3SegmentedButton 调用 ≥ 4（外观模式 / AI 作品 / 动图播放 / 详情画质 4 组）', () => {
    const meSrc = read('pages/Me.vue')
    const count = (meSrc.match(/<M3SegmentedButton\b/g) || []).length
    expect(count, `Me.vue 当前 <M3SegmentedButton 调用数：${count}`).toBeGreaterThanOrEqual(4)
  })

  it('TranslateModeSwitch.vue 内 <M3SegmentedButton 调用 ≥ 1', () => {
    const src = read('components/TranslateModeSwitch.vue')
    const count = (src.match(/<M3SegmentedButton\b/g) || []).length
    expect(count, `TranslateModeSwitch.vue 当前 <M3SegmentedButton 调用数：${count}`).toBeGreaterThanOrEqual(1)
  })

  it('M3SegmentedButton.vue 组件存在且含容器特征串（防组件被误删）', () => {
    const m3src = read('components/M3SegmentedButton.vue')
    expect(m3src).toContain(CONTAINER_SIGNATURE)
  })
})
