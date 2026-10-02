// ───────────────────────────────────────────────────────────────────────────
// 入场动效的**可见性**门禁（#913 / spec `fail-safe-aux-mechanisms` D1）
//
// 守的契约（D1 的一句话形式）：
//   **动效可改变内容「如何」出现，不可改变内容「是否」出现。**
//
// 事故形态（真机复现，无日志无报错、单测全绿）：`@keyframes item-rise` 的
// `from { opacity: 0; … }` 配上 `fill-mode: both` ⇒ 动画**没播**时（冷挂载的静态
// 兄弟节点上引擎不启动入场动画），`both` 把 `from` 态长期驻留 ⇒ 整段 UI
// 「占位但不可见」。⚠️ 单独把 `both` 改成 `none` 实测**救不回**。
//
// ⚠️ 判据取的是**帧体源码**而非本仓的字面量常量：帧体是纯 CSS，没有执行环境，
// 「动画到底播没播」只能在真机观察 —— 所以门禁把可静态判定的那半条契约
// （`from` 态不得让元素不可见）钉死，剩下的一半留给真机取证。
// ───────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { LIST_ITEM_ANIMATION, LIST_ITEM_VISIBILITY_CONTRACT, listItemStyle } from './motion'

const _here = dirname(fileURLToPath(import.meta.url))
/** 帧体唯一定义方（ADR-0211 决策 5 记的反向依赖是刻意的：几何量归调用方组件） */
const DEFINER = resolve(_here, '../components/RefreshableList.vue')

/** 剥掉注释后再匹配。⚠️ 必需：`RefreshableList.vue` 的抬头注释里**正文提及**
 *  `@keyframes item-rise`（解释帧体为何定义在本文件），不剥注释时 `indexOf`
 *  命中的是那句注释、抽出一段无关文本 —— 而防空转断言只查「抽到了 from 帧」，
 * 不足以分辨「抽到真帧体」与「抽到一段恰好带 from 的文本」。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}
const SRC = stripComments(readFileSync(DEFINER, 'utf-8'))

/** 抽出 `@keyframes <name> { … }` 的帧体源码。找不到 ⇒ 返回 ''（防空转：调用方必须断言非空）。 */
function keyframeBody(name: string, src = SRC): string {
  const start = new RegExp(`@keyframes\\s+${name}\\s*\\{`).exec(src)
  if (!start) return ''
  let depth = 0
  for (let i = src.indexOf('{', start.index); i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}' && --depth === 0) return src.slice(start.index, i + 1)
  }
  return ''
}

/** 抽出某个帧（`from` / `to` / 百分比）的声明块源码；该帧不存在 ⇒ 返回 ''。 */
function stepBody(step: string, body: string): string {
  const m = new RegExp(`(?:^|[\\s{])${step}\\s*\\{([^}]*)\\}`).exec(body)
  return m ? m[1] : ''
}

/** 声明体里出现该属性（键名边界，防止 `max-opacity` 之类误命中） */
function declares(decls: string, prop: string): boolean {
  return new RegExp(`(?:^|;|\\s)${prop}\\s*:`).test(decls)
}

/** `opacity` 的声明值（取最后一个，与 CSS 层叠同序）；未声明 ⇒ null */
function opacityValue(decls: string): string | null {
  const m = /(?:^|;|\s)opacity\s*:\s*([^;]+)/.exec(decls)
  return m ? m[1].trim() : null
}

// `from` 态里任何一项成立，元素就「占位但不可见」：
// · opacity 显式 0            —— 事故本体
// · opacity 为「几乎不可见」   —— 0.001 这类折中值：播放时像淡入，不播时仍是空卡片
// · visibility: hidden / collapse
// · display: none
// · clip-path / 裁剪类 —— 留空位即可，本帧体未用；一旦有人加进来需重新评估
function invisibleReasons(from: string): string[] {
  const out: string[] = []
  const op = opacityValue(from)
  if (op !== null) {
    const n = Number.parseFloat(op)
    if (Number.isNaN(n)) out.push(`opacity 非字面量（${op}）：无法判定可见性`)
    else if (n < 1) out.push(`opacity: ${op} —— from 态让元素不可见或近乎不可见`)
  }
  for (const [prop, why] of [
    ['visibility', 'visibility: hidden/collapse 会让元素占位而不可见'],
    ['display', 'display: none 会让元素不可见'],
  ] as const) {
    if (declares(from, prop)) out.push(`${prop} —— ${why}`)
  }
  return out
}

describe('入场动效可见性契约（#913 D1）', () => {
  it('防空转：帧体真的被抽出来了（否则下面所有判据都是恒绿的假门禁）', () => {
    const body = keyframeBody(LIST_ITEM_ANIMATION)
    expect(body, '抽不到帧体 —— 判据内核失效，后面全是假绿').not.toBe('')
    expect(body).toContain('@keyframes')
    expect(stepBody('from', body), '抽不到 from 帧').not.toBe('')
    expect(stepBody('to', body), '抽不到 to 帧').not.toBe('')
  })

  it('D1：帧体 from 态可见 —— 动效只改「如何」出现，不改「是否」出现', () => {
    const from = stepBody('from', keyframeBody(LIST_ITEM_ANIMATION))
    expect(invisibleReasons(from), '入场帧 from 态让元素占位但不可见（D1 违例）').toEqual([])
  })

  it('to 帧可见（终态被填充驻留时不得是空态）', () => {
    const to = stepBody('to', keyframeBody(LIST_ITEM_ANIMATION))
    expect(invisibleReasons(to), '入场帧 to 态不可见').toEqual([])
  })

  it('契约常量已登记且形态为 from-visible（供消费方/文档对齐，不是一句空话）', () => {
    expect(LIST_ITEM_VISIBILITY_CONTRACT).toBe('from-visible')
  })

  it('唯一出口产出的简写确实会触发填充驻留 —— 即 D1 风险面真实存在', () => {
    // 反事实意义：若将来 listItemStyle 不再带 `both`，本门禁的 from 态检查
    // 仍成立（from 可见恒是必要条件），但这段会转红提醒「风险面变了，需重估判据」。
    const a = listItemStyle(0).animation
    expect(a, 'listItemStyle 不再产出入场简写？').toContain(LIST_ITEM_ANIMATION)
    expect(a, '填充模式变了：from 态驻留面改变，需复核 D1 判据是否仍够').toMatch(/\b(both|backwards)\b$/)
  })

  it('阳性对照：违规帧体被同一判据内核点名（不靠判据恒绿自证）', () => {
    // 原事故帧体逐字还原 ⇒ 必须被判红
    const buggy = `@keyframes ${LIST_ITEM_ANIMATION} {
  from { opacity: 0; transform: translateY(12px) scale(0.92); }
  to { opacity: 1; transform: none; }
}`
    expect(invisibleReasons(stepBody('from', buggy))).not.toEqual([])
    // 0.001 折中值也判红 —— 它在「动画不播」时仍是空卡片
    expect(invisibleReasons('  opacity: 0.001;')).not.toEqual([])
    expect(invisibleReasons('  visibility: hidden;')).not.toEqual([])
    expect(invisibleReasons('  display: none;')).not.toEqual([])
    // 阴性对照：只动几何的 from 态不得被误伤
    expect(invisibleReasons('  opacity: 1; transform: translateY(12px) scale(0.92);')).toEqual([])
    expect(invisibleReasons('  transform: translateY(12px);')).toEqual([])
  })
})
