// lynx 侧 classifyError 差分测试：以共享差分契约表为 oracle。
// 期望值来源 = 真实 OAuth 快照（pixivpy#374 / gallery-dl#9331）+ 共享差分契约表
// （sharedOAuthErrorCases.ts；app ↔ app-lynx 同语义模块差分，ticket #194；与 app 侧
// 逐字节一致，oauthErrorCasesConsistency.test.ts 守护）。
// 断言用枚举成员 ApiErrorType[key]（T4 已统一两端枚举为大写），规避历史大小写差异。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { classifyError } from '../../src/api/client'
import { ApiErrorType } from '../../src/api/types'
import { OAUTH_ERROR_CLASSIFY_CASES } from './sharedOAuthErrorCases'

describe('classifyError × 共享差分契约表（OAuth 400 错误分类差分）', () => {
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
