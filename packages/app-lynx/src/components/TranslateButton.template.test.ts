// ─── TranslateButton 四态接线契约（spec §6.2 + ADR-0173 D6） ───
// 仓库无 vue-lynx 渲染器（node 环境）——沿用「模板源码断言」约定（BookmarkButton.template.test.ts 同款）。
//
// 期望值出处（Oracle 溯源）：
// - 四态集合 = spec §6.2 表格（未译 / 未译+无 endpoint=配置翻译 / 已缓存=重译 / 翻译中）+ ADR-0173 D6；
// - 「翻译中可点 = abort」「未配置 → 配置翻译跳转」「已缓存 → 重译（先失效本章缓存）」= ADR-0173 D6 逐条；
// - 本文件锁**接线形状**（态 → 标签键 / 点击行为）；状态机语义由 novelTranslateStore.test.ts 覆盖。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./TranslateButton.vue', import.meta.url)), 'utf8')
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('TranslateButton 四态（ADR-0173 D6）', () => {
  it('态派生顺序：翻译中 > 已缓存 > 失败 > 未配置 > 首译', () => {
    const i = code.indexOf('const buttonState = computed<ButtonState>')
    expect(i).toBeGreaterThan(-1)
    const body = code.slice(i, code.indexOf('})', i))
    const order = ['translating', 'retranslate', 'retry', 'configure', 'start']
    let cursor = -1
    for (const state of order) {
      const at = body.indexOf(`"${state}"`)
      expect(at, `${state} 应出现在态派生里`).toBeGreaterThan(-1)
      expect(at, `${state} 顺序应与优先级一致`).toBeGreaterThan(cursor)
      cursor = at
    }
  })

  it('标签经显式映射表（i18n 键是字面量联合类型，禁模板拼键）', () => {
    expect(code).toContain('const LABEL_KEYS = {')
    expect(code).toContain('t(LABEL_KEYS[buttonState.value])')
    // 每个态都有自己的键（不再出现「成功文案当按钮标题」）
    for (const key of [
      'novelTranslate.action.start',
      'novelTranslate.status.translating',
      'novelTranslate.action.retranslate',
      'novelTranslate.action.retry',
      'novelTranslate.action.configure_translate',
    ]) {
      expect(code).toContain(key)
    }
    // 回归锚：探测结果文案不得再被当成按钮标题
    expect(code).not.toContain('novelTranslate.endpoint.probe.success')
  })

  it('翻译中可点 = abort（此前 disabled 时 onTap 直接 return，用户无法停止）', () => {
    expect(code).toContain('if (buttonState.value === "translating")')
    expect(code).toContain('store.abort()')
  })

  /**
   * #640 step 6 真机取证：未授权 R-18G 章节点击后 store 已正确置
   * `aborted + R18G_BLOCKED`（正文零外发），但此处原先只判 `R18_BLOCKED`
   * → 按钮视觉上仍可点 = 用户看到「点了没反应」的静默 no-op。
   *
   * <p>Oracle：store 的闸门分支（`novelTranslateStore.ts` R18 段）产出**两类**码 ——
   * `xRestrict === 2 ? "R18G_BLOCKED" : "R18_BLOCKED"`；按钮的 disabled 必须与之对齐，
   * 否则二者只在 R18 一侧一致。
   */
  it('R18 **与** R18G 拦截都不可点（#640 step 6：R18G 曾漏判）', () => {
    expect(code).toContain('"R18_BLOCKED"')
    expect(code).toContain('"R18G_BLOCKED"')
  })

  it('未配置 → 发 translate-configure 事件（宿主负责跳设置页）', () => {
    expect(code).toContain('if (buttonState.value === "configure")')
    expect(code).toContain('emit("translate-configure")')
    expect(code).toContain('configured: boolean')
  })

  it('已缓存 → 调 retranslate（先失效本章缓存再翻，避免命中旧译文）', () => {
    expect(code).toContain('if (buttonState.value === "retranslate")')
    expect(code).toContain('store.retranslate(')
  })
})
