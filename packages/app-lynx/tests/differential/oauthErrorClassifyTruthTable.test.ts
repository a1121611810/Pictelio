// Lynx 单端行为基准：classifyError 以 OAuth 错误真值表为 oracle。
// 形态说明（ADR-0203 决策 5）：WebView 客户端删除后差分对侧消失，本文件只断言 Lynx 侧。
// 期望值来源 = 真实 OAuth 快照（pixivpy#374 / gallery-dl#9331）+ sharedOAuthErrorCases.ts
// （独立 oracle），fixture 为 Lynx 唯一事实源。
// 断言用枚举成员 ApiErrorType[key]（枚举成员名已统一为大写），规避大小写差异。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { classifyError } from '../../src/api/client'
import { ApiErrorType } from '../../src/api/types'
import { OAUTH_ERROR_CLASSIFY_CASES } from './sharedOAuthErrorCases'

describe('Lynx 单端行为基准：classifyError × OAuth 400 错误分类真值表（7 例）', () => {
  beforeEach(() => {
    vi.stubGlobal('NativeModules', undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it.each(OAUTH_ERROR_CLASSIFY_CASES)('$id → $expectedTypeKey', (c) => {
    const error = c.errorKind === 'TypeError' ? new TypeError('fetch failed') : null
    const err = classifyError(c.status, error, c.responseBody)
    expect(err.type).toBe(ApiErrorType[c.expectedTypeKey])
  })
})
