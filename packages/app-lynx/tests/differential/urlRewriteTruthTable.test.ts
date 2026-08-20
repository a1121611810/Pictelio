// lynx 侧 rewriteUrl（web 分支）差分测试：以共享差分契约表为 oracle。
// 期望值来源 = 共享差分契约表（sharedUrlRewriteCases.ts；app ↔ app-lynx 同语义模块差分，
// spec #187 决策 2 / ticket #194；与 app 侧逐字节一致，urlRewriteCasesConsistency.test.ts 守护；
// 契约差异分列记录，见表格 note）。
// web 模式 = isNativeMode() 为 false：rewriteUrl 内部运行时探测 NativeModules
// （isNativeMode，裸变量/globalThis 双通道）——vi.stubGlobal('NativeModules', undefined)
// 强制 web 分支（client.test.ts 同款 mock）。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { rewriteUrl } from '../../src/api/client'
import { URL_REWRITE_CASES } from './sharedUrlRewriteCases'

describe('rewriteUrl web 分支 × 共享差分契约表（URL 重写差分）', () => {
  beforeEach(() => {
    vi.stubGlobal('NativeModules', undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it.each(URL_REWRITE_CASES)('$id → $expectedWebLynx', (c) => {
    expect(rewriteUrl(c.input)).toBe(c.expectedWebLynx)
  })
})
