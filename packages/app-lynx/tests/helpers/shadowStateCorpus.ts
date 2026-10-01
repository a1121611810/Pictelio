// ─── 阴影状态语义扫描器（#885 判据的共用内核）───
//
// 口径**窄**：只认「同一个 class 属性里同时出现静止阴影与 active: 阴影变体」。
// 宽口径（全文 grep `active:shadow`）会把注释里的说明文字也算进来 ——
// 本项目已因宽口径吃过假阳性（本工单 README 的说明就会自触发）。
// 窄口径只扫模板属性位 ⇒ 注释天然不参与。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const SRC = join(import.meta.dirname, '..', '..', 'src')

export interface ShadowStateHit {
  file: string
  token: string
}

/** 从一段模板文本里抽出 class 属性值（裸 class 与 :class 都算） */
function classAttrs(text: string): string[] {
  const out: string[] = []
  const re = /(?::|v-bind:)?class\s*=\s*(?:"([^"]*)"|'([^']*)')/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) out.push(m[1] ?? m[2] ?? '')
  return out
}

function scan(text: string): string[] {
  const hits: string[] = []
  for (const attr of classAttrs(text)) {
    if (!/active:shadow/.test(attr)) continue
    // 必须同时有静止阴影才算「用阴影承担状态」；只有 active: 阴影的极端形态也一并算
    hits.push(attr.split(/\s+/).find((t) => t.startsWith('active:shadow')) ?? 'active:shadow-*')
  }
  return hits
}

function walk(dir: string, acc: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, acc)
    else if (e.name.endsWith('.vue') && !e.name.endsWith('.test.ts')) acc.push(p)
  }
  return acc
}

export function SHADOW_STATE_VIOLATIONS(text?: string): ShadowStateHit[] {
  if (text !== undefined) return scan(text).map((token) => ({ file: '<构造正样本>', token }))
  return walk(SRC).flatMap((f) => scan(readFileSync(f, 'utf8')).map((token) => ({ file: f, token })))
}
