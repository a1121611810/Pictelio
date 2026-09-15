// api/search.ts next_url 断言 源级防线（lynx 平台约束，取证 2026-09-15）。
// 期望值出处（Oracle 溯源）：模拟器 logcat 实证——lynx 运行时 URL 全局 polyfill
// 不抛错但 `.hostname` 字段为 undefined，合法 app-api.pixiv.net 绝对 next_url 经
// new URL 断言 100% 误拒 → 搜索分页必败（加载更多失败）且重试秒败无感。
// 防线性质：源级守卫——防「URL 全局（new URL / .hostname）回流到 next_url 断言」回归。
// 同类掩蔽先例：utils/imageUrl.ts isTrustedImageHost 同款用法被 /i.pximg.net/
// marker 路径掩蔽（p2 挂账）；本守卫仅锁定 search.ts 分页断言面。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./search.ts', import.meta.url)), 'utf8')
/** 去注释后的代码本文（负向断言对象；注释本身会提到 new URL——需剥离） */
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('api/search.ts next_url 断言（lynx URL 全局不可用防线）', () => {
  it('assertPixivUrl 不依赖 URL 全局（lynx .hostname 为 undefined，取证 2026-09-15）', () => {
    expect(code).not.toMatch(/new\s+URL\(/)
  })

  it('next_url 校验经字符串 hostname 解析 + 失败必须 warn 可见（禁止静默降级）', () => {
    expect(code).toContain('extractHostname(url)')
    expect(code).toContain('console.warn(`[api/search] ${message}:`, url)')
  })
})
