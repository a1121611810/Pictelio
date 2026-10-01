// ─── UserRow.vue 结构契约（ADR-0194 / T1 #748；先例 M3SegmentedButton.template.test.ts）───
// 仓库无 vue-lynx 渲染器（vitest node 环境）——沿用「模板源码断言」约定。
// 本文件锁：行卡/头像/名/关注按钮关键类串逐字（FollowList 存量快照）、
// row-tap/toggle 事件上抛（路由与关注业务留调用方，spec D7）、busy 吞 toggle 语义、
// 头像走 proxyImageUrl 代理链（禁直连 pximg）、组件零 i18n 文案。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./UserRow.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与行/块注释（约束说明本身会提到被禁止的串，负向断言必须在代码本文上做） */
const code = src
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')

describe('UserRow 公开接口（user + isFollowed/busy + followLabel/followedLabel，spec D7）', () => {
  it('props：user 形状 = PixivUser；isFollowed 必填；busy 缺省 false；双文案必填', () => {
    expect(code).toMatch(/user\s*:\s*PixivUser/)
    expect(code).toMatch(/isFollowed\s*:\s*boolean/)
    expect(code).toMatch(/busy\?\s*:\s*boolean/)
    expect(code).toMatch(/followLabel\s*:\s*string/)
    expect(code).toMatch(/followedLabel\s*:\s*string/)
    expect(code).toMatch(/withDefaults\([\s\S]*?\{\s*busy:\s*false\s*\}/)
  })

  it('事件上抛：row-tap / toggle 双事件；组件不 import router / api user（业务留调用方）', () => {
    expect(code).toMatch(/defineEmits<\{\s*\(e:\s*'row-tap'\):\s*void;\s*\(e:\s*'toggle'\):\s*void\s*\}>/)
    expect(code).toContain("emit('row-tap')")
    expect(code).toContain("emit('toggle')")
    expect(code).not.toContain("'../router'")
    expect(code).not.toContain("'../api/user'")
  })

  it('busy 吞 toggle：onToggle 内 busy 短路（组件侧防抖，真锁留调用方，无新增可见行为）', () => {
    expect(code).toMatch(/function\s+onToggle\s*\(\)\s*:\s*void\s*\{\s*if \(props\.busy\) return\s*emit\('toggle'\)/)
    expect(code).toContain('@tap="onToggle"')
  })

  it('组件零 i18n：不 import t、模板无 t( 调用（按钮文案经 followLabel/followedLabel 注入）', () => {
    expect(code).not.toMatch(/from '\.\.\/i18n'/)
    expect(code).not.toMatch(/\bt\(/)
  })
})

describe('UserRow 行卡结构（FollowList 存量逐 class 快照）', () => {
  it('行卡容器：m-1.5 mx-3 p-3.5 + surface-container-lowest 卡 + medium 圆角（**零阴影**，票 #884）', () => {
    expect(code).toMatch(
      /<view class="flex flex-row items-center m-1\.5 mx-3 p-3\.5 bg-surface-container-lowest rounded-\[var\(--md-shape-medium\)\]">/,
    )
    // 贴面元素零阴影：层级由 surface-container 明度分档表达，box-shadow 归零
    // （ADR-0212 决策 2 规则「贴面上限 0」+ 决策 3；门禁规则 10 同步钉住）。
    // 本文件是**逐 class 全量快照**，故删阴影必须同步此处 —— 属**契约演进**，非门禁放宽。
  })

  it('行信息区 @tap 承载在 view（不绑 text 根 / list-item 根，ADR-0055 家族）', () => {
    expect(code).toMatch(/<view class="flex-1 flex flex-row items-center" @tap="emit\('row-tap'\)">/)
  })

  it('头像：SkeletonImage 40dp（w/h 10.667vw）圆形 + lazy-load；源走 proxyImageUrl 代理（禁直连 pximg）', () => {
    expect(code).toMatch(/:src="avatarSrc"/)
    expect(code).toMatch(/class="w-\[10\.667vw\] h-\[10\.667vw\] rounded-full"/)
    expect(code).toMatch(/lazy-load/)
    expect(code).toMatch(
      /proxyImageUrl\(props\.user\.profile_image_urls\?\.medium \|\| props\.user\.profile_image_urls\?\.px_170x170 \|\| ''\)/,
    )
    expect(code).not.toContain('i.pximg.net')
  })

  it('名/账号：title-small 单行截断 + label-medium outline @account', () => {
    expect(code).toContain(
      '<text class="text-title-small font-medium text-surface-on [max-line:1]">{{ user.name }}</text>',
    )
    expect(code).toContain(
      '<text class="text-label-medium text-outline mt-0.5">@{{ user.account }}</text>',
    )
  })

  it('关注按钮两态类串逐字：已关注=外框（border outline / text-primary），未关注=实心（bg-primary / text-primary-on）', () => {
    // ⚠️ 未关注分支的按压类已按 ADR-0211 决策 8 归正：
    //   `active:bg-state-pressed-primary`（预计算实色）→ `active:bg-layer-pressed-on-primary`（alpha 正路）。
    //   同元素带 `bg-primary`，满足 `stateLayerOnPrimary.test.ts` 的 C3 消费约束。
    // 另：`:class` 首位并入 `pressColor.className`（颜色状态层的过渡载体，ADR-0211 决策 2）。
    expect(code).toMatch(
      /:class="\[pressColor\.className, isFollowed \? 'border border-outline bg-transparent active:bg-layer-pressed-primary' : 'bg-primary active:bg-layer-pressed-on-primary'\]"/,
    )
    expect(code).toMatch(/:class="isFollowed \? 'text-primary' : 'text-primary-on'"/)
    expect(code).toContain('{{ isFollowed ? followedLabel : followLabel }}')
  })
})

describe('UserRow 禁手写 scoped CSS / 依赖最小面', () => {
  it('组件无 <style> 块（app-lynx Tailwind utility 硬性约定）', () => {
    expect(code).not.toContain('<style')
  })

  it('组件不渲染 list-item（虚拟化边界留页面）', () => {
    expect(code).not.toContain('<list-item')
  })
})
