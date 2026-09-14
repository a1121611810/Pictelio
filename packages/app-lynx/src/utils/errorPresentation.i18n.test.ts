// B1 错误文案 key 化的副端差分断言（oracle：zh 渲染 ≡ classifyError.message 快照）。
// 独立文件追加，不改动既有 errorPresentation.test.ts 的断言面。
import { describe, expect, it } from 'vitest'
import { classifyError } from '../api/client'
import { apiErrorMessage, setLocale } from '../i18n'
import { presentError } from './errorPresentation'

describe('utils.errorPresentation B1 messageKey 化', () => {
  const cases: Array<[number, unknown]> = [
    [401, undefined],
    [403, { message: 'nope' }],
    [429, undefined],
    [500, undefined],
    [404, undefined],
    [0, undefined],
  ]

  it.each(cases)('HTTP %# → zh 渲染 ≡ message 快照', (status, body) => {
    const err = classifyError(status, new TypeError('net'), body)
    expect(err.messageKey).toBeTruthy()
    expect(apiErrorMessage(err)).toBe(err.message)
  })

  it('presentError 对 classifyError 产出走 key 渲染（zh 输出不变）', () => {
    const classified = classifyError(401, null)
    expect(presentError(classified)).toBe(classified.message + '。请重新登录')
  })

  it('en 下 presentError 渲染英文（风格基线样例）', () => {
    setLocale('en')
    const classified = classifyError(401, null)
    // presentError = t(unauthorized 模板) + t(hintSeparator) + t(hint)
    expect(presentError(classified)).toBe('Session expired (HTTP 401). Sign in again')
    setLocale('zh-CN')
  })
})
