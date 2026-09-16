// PlatformCheck.vue 平台一致性自检页 源级防线（spec docs/specs/qa-defense-lines.md §3.T4，issue #550）。
// 期望值出处（Oracle 溯源）：
// - 矩阵五项 = spec §3.T4.2 逐条清单（URL 全局 / safeParseUrl / URLSearchParams / JSON / bridge 引号契约）。
// - 「URL 全局 hostname」探针是全页唯一允许 new URL 的位置（自检矩阵的探针本身，
//   记录 lynx 平台事实——.hostname 为 undefined，取证 2026-09-15，ADR-0163）；
//   业务判定必须走 safeParseUrl.extractHostname，禁裸 URL 全局。
// 防线性质：源级守卫——锁矩阵项存在 + 锁 new URL 不逃逸出探针函数（防未来
// 有人在此页复制 URL 全局写法到业务判定）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./PlatformCheck.vue', import.meta.url)), 'utf8')
/** 去注释后的代码本文（负向断言对象；说明注释会提到 new URL——需剥离 HTML/块/行注释） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

/** 从声明串起做大括号配对，取函数体原文（探针体无对象字面量/字符串内大括号，naive 配对足够） */
function extractBracedBody(source: string, decl: string): string | null {
  const i = source.indexOf(decl)
  if (i < 0) return null
  const open = source.indexOf('{', i)
  if (open < 0) return null
  let depth = 0
  for (let j = open; j < source.length; j++) {
    if (source[j] === '{') depth++
    else if (source[j] === '}') {
      depth--
      if (depth === 0) return source.slice(open, j + 1)
    }
  }
  return null
}

describe('PlatformCheck.vue 自检矩阵项（spec §3.T4.2 清单锁定）', () => {
  it('五个矩阵项名称全部存在', () => {
    expect(code).toContain('URL 全局 hostname')
    expect(code).toContain('safeParseUrl 解析')
    expect(code).toContain('URLSearchParams 往返')
    expect(code).toContain('JSON 往返')
    expect(code).toContain('bridge 引号契约')
  })

  it('每项渲染三要素：名称 + PASS/FAIL/SKIP 判定 + 实际值', () => {
    expect(code).toContain("STATUS_LABEL[item.status]")
    expect(code).toContain("STATUS_CLASS[item.status]")
    expect(code).toContain('{{ item.actual }}')
  })

  it('顶部总体结论 N/M PASS 大字', () => {
    expect(code).toMatch(/{{ passCount }}\/{{ items.length }} PASS/)
  })
})

/** 剥字符串字面量（负向断言只关心代码形态；oracle 注脚等字符串「数据」不算 URL 全局用法，
 *  如矩阵项 expect 文本合法地提到 `.hostname` 平台事实——那正是本页要展示的内容） */
function stripStrings(source: string): string {
  return source
    .replace(/'[^'\n]*'/g, '')
    .replace(/"[^"\n]*"/g, '')
    .replace(/`[^`]*`/g, '')
}

describe('PlatformCheck.vue URL 全局边界（new URL 仅限探针函数，业务判定禁用）', () => {
  it('探针函数 probeUrlGlobalHostname 存在且体内含 new URL（刻意例外的唯一落点）', () => {
    const body = extractBracedBody(code, 'function probeUrlGlobalHostname')
    expect(body).not.toBeNull()
    expect(body).toContain('new URL(')
  })

  it('移除探针函数体 + 剥字符串后全文无 new URL( 与 .hostname（不逃逸到业务判定）', () => {
    const body = extractBracedBody(code, 'function probeUrlGlobalHostname')
    expect(body).not.toBeNull()
    const outside = stripStrings(code.replace(body ?? '', ''))
    expect(outside).not.toMatch(/new\s+URL\(/)
    expect(outside).not.toContain('.hostname')
  })

  it('业务判定经收口函数：safeParseUrl 导入且探针判定用其结果', () => {
    expect(code).toContain("from '../utils/safeParseUrl'")
    expect(code).toContain("extractHostname('https://app-api.pixiv.net/v1/x')")
  })
})

describe('PlatformCheck.vue bridge 引号契约探针（已知契约：缺键 ""、字符串带引号需 unquote）', () => {
  it('prefsGet 用专属探针键 + unquoteNativeString 还原', () => {
    expect(code).toContain("prefsGet('qa_probe_absent_key'")
    expect(code).toContain('unquoteNativeString(')
    expect(code).toContain("from '../utils/tokenStorage'")
  })

  it('web-core 无 NativeModules 时显示 SKIP（非静默降级）', () => {
    expect(code).toContain('无 NativeModules → SKIP')
  })
})
