// ─── ActionButton.vue 模板契约（spec docs/specs/app-lynx-novel-intro-action-row §5.1 / §US5） ───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言 + SFC parse」约定
//（M3Switch.template.test.ts / SeriesSheet.template.test.ts 同款）：本文件锁**视觉状态机**、
//**接入契约**、**ADR-0123/ADR-0086 合规**与**a11y 标注**。
//
// 期望值出处（Oracle 溯源）：
// - 容器 `flex-1 min-w-0 flex flex-col` = spec §5.1 「等宽四列」原文
// - 文本色 `text-white/85` / `text-tertiary` = spec §5.1 「默认态」/「已激活」逐字
// - disabled 态 = `opacity-50` 置灰 + `@tap` 处理器短路。**不含** `pointer-events-none`：
//   它在 Lynx 下是死类名（preset 的 corePlugins 白名单裁掉了 `pointerEvents`），
//   写了不产生任何规则 ⇒ 锁它等于锁一个不存在的防护。详见文件末尾的 describe。
// - `:accessibility-element` 绑 A11Y_ELEMENT_ENABLED 常量 = accessibility.ts:213-214
// - `text-[6.4vw]` 图标 / `text-label-small` 标签 = spec §5.1 逐字 + ADR-0086（vw 强制，禁 rem）
//   ⚠️ ADR-0208 决策 3（2026-09 图标迁移）后：6.4vw 不再是本组件的 text 字面量，而由
//   `<AppIcon>` 缺省 :size 承担（= 24dp），IconName 类型取代 string 图标 prop。
//
// 契约边界：ActionButton = 纯展示基础组件（无 i18n、无 store、无 API、仅 props + emit('tap')）。
// i18n 责任归宿主 NovelIntro（label 由父组件传入已翻译文本，spec §5.1 注释）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parse } from 'vue/compiler-sfc'

const src = readFileSync(fileURLToPath(new URL('./ActionButton.vue', import.meta.url)), 'utf8')
/** IconName 定义源（= ICON_CODEPOINTS 键联合，ADR-0208 决策 2）与图标缺省字号的定义源 */
const iconMapSrc = readFileSync(fileURLToPath(new URL('../utils/iconMap.ts', import.meta.url)), 'utf8')
const appIconSrc = readFileSync(fileURLToPath(new URL('./AppIcon.vue', import.meta.url)), 'utf8')
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
  it('defineProps 包含 icon / label / active / disabled 四个 prop，类型 IconName/string/boolean', () => {
    // 4 个 prop 与 spec §5.1 完全一致
    expect(code).toMatch(/icon\s*:\s*IconName/)
    expect(code).toMatch(/label\s*:\s*string/)
    expect(code).toMatch(/active\s*:\s*boolean/)
    expect(code).toMatch(/disabled\s*:\s*boolean/)
    // 反向锁：icon 退回 string 即退回字形串（ADR-0208 决策 2/3：传码点会被默认字体静默渲染成空白）
    expect(code).not.toMatch(/icon\s*:\s*string/)
    // IconName 的定义源 = ICON_CODEPOINTS 键联合（utils/iconMap.ts），非本组件另立一套
    expect(iconMapSrc).toMatch(/export type IconName = keyof typeof ICON_CODEPOINTS/)
    expect(code).toMatch(/import type \{ IconName \} from '\.\.\/utils\/iconMap'/)
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

  it('图标位经 <AppIcon :name="props.icon"> 走 24dp 缺省字号（spec §5.1 的 6.4vw）+ 标签 text-label-small mt-1', () => {
    // ADR-0208 决策 3：图标位只传图标名，字形由 <AppIcon> 查 ICON_CODEPOINTS 渲染。
    expect(code).toContain('<AppIcon :name="props.icon" />')
    // spec §5.1 的 6.4vw 不再是本组件的 text 字面量，而由 AppIcon 缺省 :size 承担（24dp）——
    // 因此本组件不得覆盖 :size（覆盖即脱离 spec 逐字给出的 24dp 口径）。
    expect(code).not.toMatch(/<AppIcon[^>]*:size=/)
    expect(appIconSrc).toMatch(/size:\s*6\.4/) // 缺省 24dp 字号的事实源
    expect(appIconSrc).toContain('`${props.size}vw`') // 单位恒为 vw（ADR-0086 禁 rem）
    // 标签文字从 props 取（i18n 不在此处）
    expect(code).toContain('{{ props.label }}')
    expect(code).toContain('text-label-small')
    expect(code).toContain('mt-1')
  })
})

// ─── 验收 #6 / #7 / #8 / #9：状态机（spec §5.1 默认 / active / disabled 三态） ───
describe('ActionButton.vue 三态（spec §5.1：default / active / disabled）', () => {
  it('disabled 分支：opacity-50 置灰（spec §5.1 masked 态）', () => {
    // 视觉置灰 + @tap 不 emit。**不含** pointer-events-none —— 它在 Lynx 下不产出规则，
    // 详见本文件下方 describe 的说明。
    expect(code).toMatch(/disabled\s*\?\s*['"]opacity-50['"]/)
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

// ─── ADR-0123 合规（Lynx 原生 hit-testing 不识别 pointer-events CSS ⇒ 该类名是**死类名**） ───
//
// ⚠️ 本 describe 原先断言「`pointer-events-none` 只出现在 disabled 分支」——而那条断言
// **锁的是一个不存在的效果**：`@lynx-js/tailwind-preset@0.5.1` 的 `corePlugins: DEFAULT_CORE_PLUGINS`
// 白名单（57 项）裁掉了 `pointerEvents`，实测产物里 `.pointer-events-none` / `.pointer-events-auto`
// 均为 0 处（同批 `opacity-50`、`bg-surface-tint` 正常产出，作阳性对照）。
// 即「以为在防护、实际不防护」。真实防护是模板里的 `@tap` 处理器短路（见下）。
// 全仓级门禁见 `tests/lynxUnsupportedTailwindClasses.test.ts`。
describe('ActionButton.vue 的 disabled 防护不依赖 CSS（Lynx 无 pointer-events）', () => {
  it('模板 class 上不得出现 pointer-events-*（死类名，不产出规则）', () => {
    // 剥掉注释后再断言：组件抬头那段**必须**能解释为什么不用它。
    const bare = code.replace(/<!--[\s\S]*?-->/g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
    expect(bare).not.toMatch(/pointer-events-/)
  })

  it('真实防护是 @tap 处理器短路（disabled 时不 emit）', () => {
    expect(code).toMatch(/@tap="props\.disabled \? null : emit\('tap'\)"/)
  })

  it('根元素非全屏遮罩（无 absolute inset-0 + 无 fixed inset-0 等全屏形态）', () => {
    // ActionButton 是行内 flex item，不做全屏覆盖层；与 SeriesSheet / NovelExportSheet 全屏遮罩范式区分
    expect(code).not.toMatch(/absolute\s+inset-0/)
    expect(code).not.toMatch(/fixed\s+inset-0/)
  })
})

// ─── ADR-0086 合规（spacing=vw / fontSize=rpx；图标经 AppIcon 拿 vw 缺省字号，禁 rem） ───
describe('ActionButton.vue ADR-0086 合规（vw 字号，禁 rem）', () => {
  it('禁 rem / em / px 字面量：任意长度单位只允许 vw，图标字号由 AppIcon 的 vw 缺省承担', () => {
    // ADR-0208 决策 3 后本组件不再持有 text-[6.4vw]（字号下沉到 AppIcon），
    // 但 ADR-0086 的红线不变——扫描面从「text-[…]」扩到全部 `-[Nunit]` 任意长度值。
    const units = Array.from(code.matchAll(/-\[(\d+(?:\.\d+)?)(px|rem|em|vw|rpx)\]/g)).map(
      (m) => `${m[1]}${m[2]}`,
    )
    const nonVw = units.filter((s) => !s.endsWith('vw'))
    expect(nonVw, `非 vw 任意长度单位违规：${nonVw.join(',')}`).toEqual([])
    // 图标字号不写在本组件 ⇒ 由 AppIcon 承担，其单位恒为 vw（禁 rem 的最后一道面）
    expect(code).not.toMatch(/<AppIcon[^>]*:size=/)
    expect(appIconSrc).toContain('`${props.size}vw`')
    expect(appIconSrc).toMatch(/size:\s*6\.4/) // 24dp 缺省 = spec §5.1 的 6.4vw
    // 标签字号走语义档位（text-label-small），不是 arbitrary 字面量
    expect(code).toContain('text-label-small')
  })
})
