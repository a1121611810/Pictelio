// ─── BottomSheet.vue 结构契约（ADR-0194 D5/D6 / spec docs/specs/lynx-common-components.md D6）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定
//（M3SegmentedButton.template.test.ts 同款）：本文件锁**外部行为与平台约束**——
// 命中测试语义四要素、scrim/面板/标题栏关键类串、高度三变体映射、slot 投影、拖把手柄变体。
//
// 期望值出处（Oracle 溯源）：
// - 壳类串 = 迁移前各弹层手写壳的逐字节快照（CommentOverlay.vue L90-104 / SearchSheet.vue
//   L345-364 = canonical；SeriesSheet.vue L144-165 = 把手 + max-h-[80vh]；NovelExportSheet.vue
//   L86-105 = 无固定高面板）——本组件是这些串的**单点新家**，禁止增删任何 token；
// - 命中测试语义 = ADR-0123（全屏层 v-if / scrim @tap / 面板 @tap.stop / pointer-events 无效）
//   + ADR-0147（scroll-view 覆层约束）+ glossary「BottomSheet」词条，独立于本实现；
// - a11y 可选分支 = 各弹层现状差分（CommentOverlay 的 scrim/× 均无 a11y；SearchSheet/
//   NovelExportSheet/SeriesSheet 的 ×/把手有、scrim 仅 SeriesSheet 有）——分支渲染保证
//   「缺省 = 无 a11y 属性」逐字节对齐，而不是靠 undefined 属性省略的平台假设；
// - 组件零 i18n 内置（文案 props/slot 注入）= ADR-0190/0194 排除面，noDeadKeys 面不稀释。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./BottomSheet.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('BottomSheet 命中测试语义四要素（ADR-0123/0147，禁止改动）', () => {
  it('① 全屏层根 absolute inset-0：自身不挂 @tap（scrim 全覆盖即交互面），组件不自管 open（无 v-show）', () => {
    // 根层 = 定位上下文（SeriesSheet 既有层级形态）；挂载由父级 v-if 控制
    expect(code).toContain('<view class="absolute inset-0">')
    expect(code).not.toContain('<view class="absolute inset-0" @tap')
    expect(code).not.toContain('v-show')
  })

  it('② scrim = absolute inset-0 bg-scrim + @tap 关闭（原生 hit-testing：全屏层必须自身是交互面）', () => {
    expect(code).toContain('class="absolute inset-0 bg-scrim"')
    // 缺省（无 a11y）分支：类串与 @tap 同标签逐字节相邻（CommentOverlay/SearchSheet 迁移前写法）
    // ⚠️ #878 起两分支都多一个 :style="scrimStyle"（遮罩淡入/淡出，ADR-0211 决策 4）：
    //    淡入是**一次性播放**的入场动画，只能走 @keyframes（Tailwind 无 opacity 关键帧工具类），
    //    且 Lynx 无 transitionend 事件可挂 ⇒ 退场相位由 :motion-phase prop 切换、计时器在调用方。
    expect(code).toMatch(/v-else class="absolute inset-0 bg-scrim" :style="scrimStyle" @tap="emit\('close'\)" \/>/)
    // 动画绑定点两处（遮罩 + 面板）都必须存在，否则「有相位 prop 但没绑样式」= 静默无动效
    expect((code.match(/:style="scrimStyle"/g) ?? []).length).toBe(2)
    expect((code.match(/:style="panelStyle"/g) ?? []).length).toBe(1)
  })

  it('④ z 序 scrim < 面板：DOM 顺序 scrim 在前（同层兄弟靠后覆盖，不依赖 z-index）', () => {
    // 面板在模板中的锚 = :class="panelClass"（buildPanelClass 的类串字面量在 script 区，先于模板出现）
    const scrimIdx = code.indexOf('absolute inset-0 bg-scrim')
    const panelIdx = code.indexOf(':class="panelClass"')
    expect(scrimIdx).toBeGreaterThan(-1)
    expect(panelIdx).toBeGreaterThan(scrimIdx)
  })

  it('③ 面板根 @tap.stop 防穿透 + 全模板禁 pointer-events（原生不识别，ADR-0123 红线）', () => {
    expect(code).toContain('@tap.stop')
    expect(code).not.toContain('pointer-events')
  })

  it('关闭事件统一上抛 @close：6 处 @tap="emit(\'close\')"（scrim/把手/× 各有 a11y 与缺省双分支）', () => {
    expect((code.match(/@tap="emit\('close'\)"/g) ?? []).length).toBe(6)
  })
})

describe('BottomSheet 面板高度三变体（buildPanelClass 纯函数求值 = 迁移前实例逐字节快照）', () => {
  /** 从组件源码正则提取私有纯函数体并构造可调用函数（M3SegmentedButton.template.test.ts 同款缝隙） */
  function buildFn(): (panelHeight: 'fixed' | 'fit' | 'content' | undefined) => string {
    const m = code.match(/function\s+buildPanelClass\s*\([^)]*\)[^{]*\{([\s\S]*?)\n\s*\}/)
    if (!m) throw new Error('源码中未找到私有纯函数 buildPanelClass')
    // oxlint 放行：测试缝隙需对源码提取的函数体求值
    // eslint-disable-next-line no-new-func
    return new Function('panelHeight', m[1]) as (
      panelHeight: 'fixed' | 'fit' | 'content' | undefined,
    ) => string
  }

  it("fixed（默认）= '… h-[80vh] …'（CommentOverlay / SearchSheet 迁移前面板串）", () => {
    expect(buildFn()('fixed')).toBe(
      'absolute bottom-0 left-0 right-0 h-[80vh] bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col',
    )
  })

  it("fit = '… max-h-[80vh] …'（SeriesSheet 迁移前面板串：内容自适应上限 80vh）", () => {
    expect(buildFn()('fit')).toBe(
      'absolute bottom-0 left-0 right-0 max-h-[80vh] bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col',
    )
  })

  it('content = 无高度段（NovelExportSheet 迁移前面板串：纯内容高）', () => {
    expect(buildFn()('content')).toBe(
      'absolute bottom-0 left-0 right-0 bg-surface-container-lowest rounded-t-[var(--md-shape-extra-large)] flex flex-col',
    )
  })

  it('缺省（undefined）走 h-[80vh]（withDefaults fixed 之外的兜底等价）', () => {
    expect(buildFn()(undefined)).toBe(buildFn()('fixed'))
  })
})

describe('BottomSheet 标题栏（居中 title-large + × 关闭，canonical 类串单点）', () => {
  it('标题栏 = h-[11.733vw] px-4 行 + 左侧 w-[8vw] 配重 + 居中标题', () => {
    expect(code).toContain('class="flex flex-row items-center h-[11.733vw] px-4 flex-shrink-0"')
    expect(code).toContain('<view class="w-[8vw]" />')
    expect(code).toContain('class="flex-1 text-center text-title-large font-medium text-surface-on"')
  })

  it('× 关闭按钮 = w-[8vw] 方形命中面 + text-[6.4vw] 字符（迁移前 × 写法逐字节）', () => {
    expect(code).toContain('class="w-[8vw] h-[8vw] flex items-center justify-center"')
    expect(code).toContain('leading-none text-surface-on-variant">×</text>')
  })

  it('slot 投影：#title 替换标题元素、default 投影面板内容（标题栏之下全部业务内容）', () => {
    expect(code).toContain('<slot name="title">')
    expect(code).toContain('<slot />')
    // 缺省标题走 title prop（文案调用方注入，组件零 i18n）
    expect(code).toContain('{{ title }}')
  })
})

describe('BottomSheet 拖把手柄变体（SeriesSheet 形态，spec D6 变体）', () => {
  it('handle = 把手行（w-full flex justify-center pt-2 pb-1）+ 把手（w-12 h-1 rounded-full bg-outline）', () => {
    expect(code).toContain('class="w-full flex justify-center pt-2 pb-1"')
    expect(code).toContain('class="w-12 h-1 rounded-full bg-outline"')
  })

  it('把手与标题栏互斥（v-if="handle" / v-else），把手可点关闭', () => {
    expect(code).toContain('<template v-if="handle">')
    expect(code).toContain(
      '<view v-else class="flex flex-row items-center h-[11.733vw] px-4 flex-shrink-0">',
    )
  })
})

describe('BottomSheet a11y 可选分支（缺省 = 无 a11y 属性，迁移前现状差分）', () => {
  it('scrim a11y：v-if="scrimAccessibilityLabel" 双分支，a11y 文案透传注册表 value', () => {
    expect(code).toContain('v-if="scrimAccessibilityLabel"')
    expect(code).toContain(':accessibility-label="scrimAccessibilityLabel"')
  })

  it('×/把手 a11y：v-if="closeAccessibilityLabel" 双分支（把手 + × 各一对）', () => {
    expect((code.match(/v-if="closeAccessibilityLabel"/g) ?? []).length).toBe(2)
    expect((code.match(/:accessibility-label="closeAccessibilityLabel"/g) ?? []).length).toBe(2)
  })

  it('每处 accessibility-label 都配套 accessibility-element（ADR-0061）+ 常量单点导入', () => {
    const labels = (code.match(/accessibility-label=/g) ?? []).length
    const elements = (code.match(/accessibility-element=/g) ?? []).length
    expect(labels).toBe(3) // scrim / 把手 / × 各一处（均带 v-if 分支）
    expect(elements).toBe(labels)
    expect(code).toContain("import { A11Y_ELEMENT_ENABLED } from '../utils/accessibility'")
  })
})

describe('BottomSheet 纪律（ADR-0116 / ADR-0190 排除面 / Tailwind 约定）', () => {
  it('零 i18n 内置：无 t() 调用、无 i18n 导入（文案全部 props/slot 注入，noDeadKeys 面不稀释）', () => {
    expect(code).not.toMatch(/\bt\(/)
    expect(code).not.toContain("from '../i18n'")
  })

  it('<script setup> 禁显式 export（ADR-0116）', () => {
    expect(code).not.toMatch(/^export /m)
  })

  it('无 scoped/手写 style 块、无 rem、无硬编码色值（app-lynx Tailwind 硬性约定）', () => {
    // ⚠️ keyframes 不在本组件：帧体在 SheetShell.vue（BottomSheet 只发 inline 简写）。
    //   顺带一条纪律红利——本组件因此连 <style> 块都没有，帧体改错也不会被局部样式作用域掩盖。
    expect(src).not.toContain('<style')
    expect(code).not.toMatch(/[0-9]rem/)
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('动效档位经 composables 唯一入口（motionPhase 只做相位，不自带时长/曲线）', () => {
    expect(code).toContain("from '../composables/useSheetDismiss'")
    expect(code).toContain('SHEET_ANIMATION')
    expect(code).toContain('motion.panelStyle(props.motionPhase)')
    expect(code).toContain('motion.scrimStyle(props.motionPhase)')
    // 时长/曲线字面量零出现（唯一入口纪律；档位在 composables/motion.ts）
    expect(code).not.toMatch(/\d+ms/)
    expect(code).not.toMatch(/cubic-bezier/)
    // 相位 prop 必须有缺省值：不传 = 只有入场动画（未接相位的调用方行为不变）
    expect(code).toContain("motionPhase?: 'enter' | 'exit'")
    expect(code).toContain("{ panelHeight: 'fixed', motionPhase: 'enter' }")
  })
})
