// Lynx 单端行为基准：rewriteUrl（web 分支）以真值表 fixture 为 oracle。
// 形态说明（ADR-0203 决策 5）：WebView 客户端删除后差分的对侧已不存在，
// 本文件不再是「跨端一致性」断言，而是 Lynx 侧 URL 边界契约的行为基准。
// 期望值来源 = sharedUrlRewriteCases.ts（spec #187 决策 2 / ticket #194 / ADR-0100，
// 独立 oracle），禁止从被测实现反推。
// web 模式 = isNativeMode() 为 false：rewriteUrl 内部运行时探测 NativeModules
// （isNativeMode，裸变量/globalThis 双通道）——vi.stubGlobal('NativeModules', undefined)
// 强制 web 分支（client.test.ts 同款 mock）。
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { rewriteUrl } from '../../src/api/client'
import { URL_REWRITE_CASES } from './sharedUrlRewriteCases'

describe('Lynx 单端行为基准：rewriteUrl web 分支 × URL 重写真值表（8 例）', () => {
  beforeEach(() => {
    vi.stubGlobal('NativeModules', undefined)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
  it.each(URL_REWRITE_CASES)('$id → $expectedWeb', (c) => {
    expect(rewriteUrl(c.input)).toBe(c.expectedWeb)
  })
})
