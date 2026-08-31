// ─── UgoiraViewer 模板 defer-src-invalidation 绑定 源级防线（A1/B1 闭环） ───
// 期望值来源（Oracle 溯源）：ADR-0126 P1「布尔属性，固定 true」+ 原型实测
// （docs/research/ugoira-playback-flicker-range-proto.md：V2 动态绑定 true = 374/374 帧零空白）
// + 编译实测（裸属性被 vue-lynx 编译为 ""，真机原生 <image> 按 truthy 判断不生效）。
// 防线性质：**源级守卫**（防「改回裸属性/删掉绑定/改 false」回归）——
// 行为正确性（真机不闪）由真机 E2E 录屏验收（issue #272 同源，仓库无 vue 组件测试基建）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const source = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'UgoiraViewer.vue'),
  'utf-8',
)

/** 裸属性判定：行内含 defer-src-invalidation，且非注释行（含块注释状态）、非冒号绑定行、非带值属性行 */
function bareAttrLines(src: string): string[] {
  const hits: string[] = []
  let inBlockComment = false
  for (const line of src.split('\n')) {
    if (line.includes('<!--')) inBlockComment = true
    const trimmed = line.trim()
    if (!inBlockComment && line.includes('defer-src-invalidation')) {
      if (
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('//') &&
        !trimmed.includes(':defer-src-invalidation') &&
        !trimmed.includes('defer-src-invalidation=')
      ) {
        hits.push(line)
      }
    }
    if (line.includes('-->')) inBlockComment = false
  }
  return hits
}

describe('UgoiraViewer 模板 defer-src-invalidation 绑定', () => {
  it('必须是布尔绑定 :defer-src-invalidation="true"（裸属性编译为 ""，真机不生效）', () => {
    expect(source).toContain(':defer-src-invalidation="true"')
  })

  it('禁止裸属性写法（无冒号前缀 defer-src-invalidation 行）', () => {
    expect(bareAttrLines(source)).toEqual([])
  })
})
