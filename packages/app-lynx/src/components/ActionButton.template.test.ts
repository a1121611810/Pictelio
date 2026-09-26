// ─── ActionButton.vue 模板契约（spec docs/specs/app-lynx-novel-intro-action-row §5.1 / §US5） ───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言 + SFC parse」约定
//（M3Switch.template.test.ts / SeriesSheet.template.test.ts 同款）：本文件锁**视觉状态机**、
//**接入契约**、**ADR-0123/ADR-0086 合规**与**a11y 标注**。
//
// 期望值出处（Oracle 溯源）：
// - 容器 `flex-1 min-w-0 flex flex-col` = spec §5.1 「等宽四列」原文
// - 文本色 `text-white/85` / `text-tertiary` = spec §5.1 「默认态」/「已激活」逐字
// - `pointer-events-none` 仅 disabled 分支 = spec §5.1 「masked」+ ADR-0123 红线（仅合法禁用语义，
//   禁止全屏遮罩期望下层穿透的反模式）
// - `:accessibility-element` 绑 A11Y_ELEMENT_ENABLED 常量 = accessibility.ts:213-214
// - `text-[6.4vw]` 图标 / `text-label-small` 标签 = spec §5.1 逐字 + ADR-0086（vw 强制，禁 rem）
//
// 契约边界：ActionButton = 纯展示基础组件（无 i18n、无 store、无 API、仅 props + emit('tap')）。
// i18n 责任归宿主 NovelIntro（label 由父组件传入已翻译文本，spec §5.1 注释）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'vue/compiler-sfc'

const src = readFileSync(fileURLToPath(new URL('./ActionButton.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '')

// ─── 验收 #1：组件能 mount（vue/compiler-sfc 解析 <script setup> + <template> 双块无错） ───
describe('ActionButton.vue SFC 编译（验收 #1：组件能 mount）', () => {
  it('parse 不报错（vue/compiler-sfc 解析 <script setup> + <template> 双块）', () => {
    const { errors } = parse(src, { filename: 'ActionButton.vue' })
    expect(errors).toEqual([])
  })

  it('export default 由 <script setup> 自动产生（无显式 export default 重复声明）', () => {
    // <script setup> 编译产物自带隐式 export default；源码不应有显式 export default
    expect(code).not.toMatch(/^export default /m)
  })
})

// ─── 验收 #2 / #3：接入契约（spec §5.1 props + emit） ───
describe('ActionButton.vue 接入契约（spec §5.1：4 props + 1 emit）', () => {
  it('defineProps 包含 icon / label / active / disabled 四个 prop，类型 string/boolean', () => {
    // 4 个 prop 与 spec §5.1 完全一致
    expect(code).toMatch(/icon\s*:\s*string/)
    expect(code).toMatch(/label\s*:\s*string/)
    expect(code).toMatch(/active\s*:\s*boolean/)
    expect(code).toMatch(/disabled\s*:\s*boolean/)
    // 不允许多带 a11y 字符串 prop（a11y 注入责任在组件自身，但参数只有 label 一个字符串）
    expect(code).not.toMatch(/ariaLabel\s*:\s*string/)
    expect(code).not.toMatch(/accessibilityLabel\s*:\s*string/)
  })

  it('defineEmits 仅暴露 tap 一个事件（spec §5.1 语义：纯 chip 展示）', () => {
    // emit 集合必须严格等于 { tap: [] } —— 仅 type literal 一行，无任何额外事件
    expect(code).toContain('defineEmits<{ tap: [] }>()')
    // 防 drift：不允许多发 change / select 之类（本组件语义收敛）
    expect(code).not.toMatch(/change\s*:/)
    expect(code).not.toMatch(/select\s*:/)
    expect(code).not.toMatch(/longPress\s*:/)
    // 全仓不应出现第二次 defineEmits（多事件类型字面量合并会被 redundancy guard 抓）
    expect(code.match(/defineEmits</g)?.length ?? 0).toBe(1)
  })

  it('组件内不调任何 i18n/store/api（spec §5.1 注释：纯展示，i18n 责任在父）', () => {
    // 防止悄悄引入 i18n/store/api 依赖，破坏 ActionButton "无 i18n 依赖" 契约
    expect(code).not.toMatch(/\bt\(/)
    expect(code).not.toMatch(/useI18n|useStore|useBookmarkMutation|useFetch/)
    expect(code).not.toMatch(/apiClient|api\./)
  })
})

// ─── 验收 #5 / #10：容器形态（spec §5.1「等宽四列 + 图标+短文字 chip」） ───
describe('ActionButton.vue 视觉族（spec §5.1：flex-1 等宽 + 图标+文字 chip）', () => {
  it('根 view：flex-1 min-w-0 flex flex-col items-center justify-center py-2（等宽四列 + 防溢出）', () => {
    // 容器 = 行内 flex item 等宽四列（flex-1）+ 文本省略号防溢出（min-w-0）
    expect(code).toContain('flex-1')
    expect(code).toContain('min-w-0')
    expect(code).toContain('flex flex-col')
    expect(code).toContain('items-center')
    expect(code).toContain('justify-center')
    expect(code).toContain('py-2')
  })

  it('容器圆角走 --md-shape-medium token（spec §5.1：rounded M3 + token 唯一来源）', () => {
    // 圆角必须经 tokens.css 定义的中等圆角令牌，禁止字面量 8px / 0.5rem
    expect(code).toContain('rounded-[var(--md-shape-medium)]')
    expect(code).not.toMatch(/rounded-\[\d+(?:\.\d+)?(?:px|rem)\]/)
  })

  it('图标 text-[6.4vw] leading-none + 标签 text-label-small mt-1（spec §5.1 逐字）', () => {
    // ADR-0086 强制：vw 字号，禁 rem
    expect(code).toContain('text-[6.4vw]')
    expect(code).toContain('leading-none')
    // 图标字符 / 标签文字均从 props 取（i18n 不在此处）
    expect(code).toContain('{{ props.icon }}')
    expect(code).toContain('{{ props.label }}')
    expect(code).toContain('text-label-small')
    expect(code).toContain('mt-1')
  })
})

// ─── 验收 #6 / #7 / #8 / #9：状态机（spec §5.1 默认 / active / disabled 三态） ───
describe('ActionButton.vue 三态（spec §5.1：default / active / disabled）', () => {
  it('disabled 分支：opacity-50 pointer-events-none（spec §5.1 masked 态）', () => {
    // disabled 态 = 视觉置灰 + 不响应 tap（pointer-events-none 合法禁用语义，区别于全屏遮罩反模式）
    expect(code).toMatch(/disabled\s*\?\s*['"]opacity-50 pointer-events-none['"]/)
  })

  it('非 disabled 分支：active:bg-white/10（hover/active 态按下色 spec §5.1 提示）', () => {
    // 未禁用时支持 active 反馈（scrim 黑底上能看到浅灰高亮）
    expect(code).toContain("'active:bg-white/10'")
  })

  it('active=true 时文字色走 text-tertiary（M3 tertiary 实色，对齐 BookmarkButton.is-bookmarked chip 范式）', () => {
    expect(code).toMatch(/active\s*\?\s*['"]text-tertiary['"]/)
    // 反向锁：active 态禁用默认色（else 分支必须命中 text-white/85）
    const ternary = code.match(/active\s*\?\s*['"]text-tertiary['"]\s*:\s*['"]text-white\/85['"]/)
    expect(ternary).not.toBeNull()
  })

  it('active=false 时文字色走 text-white/85（scrim 黑底默认够清晰）', () => {
    // 三元已并入上方断言；此处再二次确认白/85 出现于 active 分支
    expect(code).toContain("'text-white/85'")
  })

  it('@tap 在 disabled=true 时短路为 null（不响应 tap），disabled=false 时 emit("tap")', () => {
    // 内联表达式：disabled ? null : emit('tap') —— 与 brief 模板一致
    expect(code).toMatch(/@tap="props\.disabled\s*\?\s*null\s*:\s*emit\('tap'\)"/)
  })
})

// ─── 验收 #9：a11y 标注（accessibility.ts:213 A11Y_ELEMENT_ENABLED 常量 + ADR-0061 E2E 依赖） ───
describe('ActionButton.vue a11y 标注（accessibility.ts A11Y_ELEMENT_ENABLED + 暴露 label）', () => {
  it(':accessibility-element 绑定 A11Y_ELEMENT_ENABLED 常量（accessibility.ts:213）', () => {
    expect(code).toContain('import { A11Y_ELEMENT_ENABLED } from')
    expect(code).toContain('A11Y_ELEMENT_ENABLED')
    expect(code).toMatch(/:accessibility-element="A11Y_ELEMENT_ENABLED"/)
    // 反向锁：false / 默认值不使用 —— 容器必须可被 a11y 树识别
    expect(code).not.toMatch(/:accessibility-element="false"/)
  })

  it(':accessibility-label 绑 props.label（Lynx E2E / Appium 定位「收藏」「追更」等按钮）', () => {
    // a11y 文本 = label props 直传（与宿主 i18n 文案一致即可被无障碍读屏）
    expect(code).toMatch(/:accessibility-label="props\.label"/)
    // 反向锁：不能绑死字符串（必须随 prop 变）
    expect(code).not.toMatch(/:accessibility-label="['"][^'"]*['"]/)
  })
})

// ─── ADR-0123 合规（lynx 原生 hit-testing 不识别 pointer-events CSS，红线 = 全屏遮罩 pointer-events-none） ───
describe('ActionButton.vue ADR-0123 合规（禁 pointer-events-none 反模式）', () => {
  it('pointer-events-none 仅出现在 disabled 分支（三元左侧 true 字面量），不做全屏遮罩', () => {
    // pointer-events-none 必须严格被 disabled 守卫，不能裸用 + 不能作为兜底穿透手段
    const matches = code.match(/pointer-events-none/g) ?? []
    expect(matches).toHaveLength(1) // 模板只 1 处合法使用
    // 该处必须在 disabled ? ... : ... 分支的左侧（if 分支命中）
    expect(code).toMatch(/disabled\s*\?\s*['"]opacity-50 pointer-events-none['"]/)
    expect(code).not.toMatch(/class="pointer-events-none"/) // 禁用类名裸绑（无三元守卫）
  })

  it('根元素非全屏遮罩（无 absolute inset-0 + 无 fixed inset-0 等全屏形态）', () => {
    // ActionButton 是行内 flex item，不做全屏覆盖层；与 SeriesSheet / NovelExportSheet 全屏遮罩范式区分
    expect(code).not.toMatch(/absolute\s+inset-0/)
    expect(code).not.toMatch(/fixed\s+inset-0/)
    // 反向锁：禁止「class 含 pointer-events-none 又不在 disabled 分支」
    expect(code).not.toMatch(/['"]\s*pointer-events-none\s*['"]/)
  })

  it('@tap 绑定存在且不依赖 pointer-events 兜底（ADT-0123 平台约束）', () => {
    // 原生 tap 事件必须落到 @tap 上；不能"用 pointer-events-none 屏蔽外面然后 @tap 绑内层"
    expect(code).toMatch(/@tap=/)
  })
})

// ─── ADR-0086 合规（spacing=vw / fontSize=rpx；图标虽为文本但 spec §5.1 逐字给了 vw，禁 rem） ───
describe('ActionButton.vue ADR-0086 合规（vw 字号，禁 rem）', () => {
  it('字号类仅含 vw 值（text-[6.4vw]），无 rem / em / px 字面量', () => {
    const fontSizes = Array.from(
      code.matchAll(/text-\[(\d+(?:\.\d+)?)(px|rem|em|vw|rpx)\]/g),
    ).map((m) => `${m[1]}${m[2]}`)
    // 必须含 6.4vw（spec §5.1 图标）+ 含 text-label-small utility（非 arbitrary 值）
    expect(fontSizes).toContain('6.4vw')
    // 任何 rem / em / px 字号都视为违规
    const nonVw = fontSizes.filter((s) => !s.endsWith('vw'))
    expect(nonVw, `非 vw 字号违规：${nonVw.join(',')}`).toEqual([])
  })
})
