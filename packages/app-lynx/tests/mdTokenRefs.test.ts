// ─── M3 token 引用完整性（源级守卫：var(--md-*) 必须命中 styles/tokens.css）───
// 锁的真实缺陷（2026-09-21 code-review Standards F1，票 #707）：
//   BookmarkButton.vue 写了 border-color: var(--md-on-inverse-surface) —— 该变量**全仓从未定义**
//   （tokens.css 定义的是 --md-inverse-on-surface）。无 fallback 的 var() 让整条声明在 computed-value
//   阶段失效（border-color 退为 currentColor），而单测 / 类型检查 / 构建全绿，只在像素上暴露 ——
//   正是「预览/单测测不到的平台-样式类盲区」里的 token 名一类。
//
// Oracle（期望值独立来源）：AGENTS.md「设计令牌」纪律 = 颜色/间距/圆角/阴影必须在 tokens.css 的 :root
//   声明后使用；唯一事实源 = src/styles/tokens.css。
//
// 抽取器纪律（code-review 审计一「防线判定」模板 B / ArchUnit failOnEmptyShould 教训）：必须断言抽取
//   集合非空且带数量下界 —— 否则正则失效会让全称断言静默恒真。
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const TOKENS_FILE = join(SRC, 'styles', 'tokens.css')

/** 递归列出 src 下的 .vue/.ts/.css（跳过测试文件：负向断言允许出现「坏名字」字面量） */
function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...listSourceFiles(path))
    else if (/\.(vue|ts|css)$/.test(entry) && !/\.test\.ts$/.test(entry)) out.push(path)
  }
  return out
}

const defined = new Set(
  [...readFileSync(TOKENS_FILE, 'utf8').matchAll(/(--md-[a-z0-9-]+)\s*:/g)].map((m) => m[1]!),
)

/** token → 引用点（相对 src 的路径，逐个 token 保留全部引用点便于定位） */
const refs = new Map<string, string[]>()
for (const file of listSourceFiles(SRC)) {
  if (file === TOKENS_FILE) continue
  for (const m of readFileSync(file, 'utf8').matchAll(/var\((--md-[a-z0-9-]+)/g)) {
    refs.set(m[1]!, [...(refs.get(m[1]!) ?? []), relative(SRC, file)])
  }
}

describe('M3 token 引用完整性（源级守卫）', () => {
  it('抽取器自身有效：tokens.css 定义与 src 引用集合都非空且有数量下界（防正则失效后空转恒真）', () => {
    expect(defined.size).toBeGreaterThanOrEqual(50)
    expect(refs.size).toBeGreaterThanOrEqual(15)
  })

  it('每个 var(--md-*) 都能在 tokens.css 命中定义（自造 token 名 = 声明静默失效）', () => {
    const undefinedRefs = [...refs.keys()]
      .filter((token) => !defined.has(token))
      .map((token) => `${token} ← ${[...new Set(refs.get(token))].join(', ')}`)
    expect(undefinedRefs).toEqual([])
  })
})
