#!/usr/bin/env node
// ─── app-lynx pre-push E2E 锚点校验（code-review Round 2 S5 finding）───
//
// 用途：被 .husky/pre-push 引用。当 push 涉及 packages/app-lynx/ 改动时，
// 强制跑 pnpm test:app-lynx + 真机 bench 链接（未来扩展）。当前最小实现：
// 仅检查 app-lynx 单测是否全过（防止 commit 304d5f07 之类「T6 测试失真
// commit message 不实」类问题再次无声推上 main）。
//
// 锚点模式参考 packages/app/scripts/check-e2e-anchors.mjs（仓库既有
// 防线模式，ADR-0097 治理记录）。

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const lynxPkg = resolve(process.cwd(), 'packages/app-lynx')
if (!existsSync(lynxPkg)) {
  console.log('[check-app-lynx-anchors] packages/app-lynx not found, skip')
  process.exit(0)
}

console.log('[check-app-lynx-anchors] running pnpm test for app-lynx')
const result = spawnSync('pnpm', ['test', '--silent'], {
  cwd: lynxPkg,
  stdio: 'inherit',
  shell: true,
})

if (result.status !== 0) {
  console.error('[check-app-lynx-anchors] ❌ app-lynx tests failed')
  process.exit(1)
}

// 进一步：检查 commit message 是否包含「1103 / 791 / tests pass / 全过」之类数字声明
// — 与 commit 304d5f07 R2 message 失实的根因对齐，未来扩展。
// 当前简化：仅 tests 失败时拦截。
console.log('[check-app-lynx-anchors] ✅ app-lynx tests pass')
process.exit(0)