// ─── #1018：常驻弹层（SearchSheet）跨明暗翻转的呈现契约（源级守卫）───
//
// 性质（#1018 结论：**冻结未复现** —— 弹层在系统 uiMode 实时翻转时跟随换色，双向；
// 真机像素取证见 docs/research/lynx-night-mode-walkthrough-acceptance.md §Round-3）：
//
//   常驻弹层挂在**根 `<page>` 直下**（不经 RouterView / KeepAlive），其样式**全部继承**
//   根级 CSS 变量 ⇒ 系统明暗翻转 ⇒ 根类（.theme-X / .dark）变化 ⇒ 整树变量重算 ⇒ 弹层重绘。
//   #1016 给 RouterView 子页加了「明暗 epoch : 路由名」的 key（强制原生重建），但**弹层不在
//   那条链路上**——它靠的是根类继承，不是重建。⇒ 这条性质原先**没有任何机器防线**，
//   正是本轮定性结论要求补上的那一条——把「弹层跟随重绘」钉住，不再依赖无人守护的
//   CSS 变量级联。
//
// 本门禁钉的三条（每条都对应上面级联的一环）：
//   ① 位置：`<SearchSheet>` 必须是根 `<page>` 的**直接子节点**，不在 `<RouterView>`/`<KeepAlive>` 内
//      —— 否则它会落进 #1016 的 epoch-key 重建语义（或 KeepAlive 缓存桶）里，性质随之改变；
//   ② 不快照主题：SearchSheet 不得把明暗/色板**快照**成非响应式值、也不得自带主题类
//      —— 一旦快照，翻转后弹层不再跟随；
//   ③ 触发器：根 `<page>` 的类绑定仍由 `appearanceClasses(theme, resolvedDark)` 驱动，
//      且该纯函数在 light/dark 下必产出不同类 ⇒ 翻转必然改根类。
//
// 仓库约定：`.vue` 不经 vitest 渲染，模板接线以**源级断言**做机器防线
// （对齐 src/pages/novelIntro.template.test.ts / tests/novelIntroNarrowViewport.test.ts 模式）。
//
// **已知失效面（不假装已覆盖）**：
//   - 本门禁只看**接线**，不渲染、不取像素 ⇒「像素是否真的重绘」的真机结论在
//     docs/research/lynx-night-mode-walkthrough-acceptance.md §Round-3（设备取证），不在此门禁面内；
//   - 源级抽取依赖标签名与缩进形态（`</RouterView>` / `</KeepAlive>` 的**首个**出现位置）；
//     若将来出现嵌套同名标签，抽取器会误判 ⇒ 正因如此才有下面的**阳性对照**（合成源码必须被判负）；
//   - exitHint / muteTagHint 两条 2s 瞬态 snackbar **不在本门禁面内**（它们同样在根 `<page>` 直下，
//     但瞬态特性使「跨翻转取第二帧」不可行，未定性，见走查落档 §Round-3 残留）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { appearanceClasses, DARK_CLASS } from '../src/utils/appearanceClasses'
import { THEME_COLOR_OPTIONS } from '../src/utils/themeColor'

const src = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

const appVue = src('../src/App.vue')
const searchSheetVue = src('../src/components/SearchSheet.vue')

/** 去 HTML 注释与整行行注释（注释里也会提到 `<page>` / 动作名，断言须落在代码本文上） */
const strip = (s: string) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * 根 `<page>` … `</page>` 段（模板层）。
 *
 * ⚠️ **先剥注释再切**：App.vue 的**脚本注释里**就写着「根 `<page>`」字面量
 * （`因此降级总闸只能落在**根 `<page>**`），裸 `indexOf('<page')` 会命中**脚本注释**而不是
 * 模板标签 ⇒ 切出的「根块」起点错位（GLOSSARY「源级守卫」条：裸 indexOf 会被注释里同名
 * 字面量顶替 ⇒ 断言恒真）。故按该条默认口径**先剥注释**。
 */
function rootPageBlock(s: string): string {
  const clean = strip(s)
  const start = clean.indexOf('<page')
  const end = clean.indexOf('</page>', start)
  if (start === -1 || end === -1) throw new Error('App.vue 模板缺根 <page>…</page>')
  return clean.slice(start, end)
}

/** 去掉某个标签的首尾配对块（同名标签不再嵌套时成立——见「已知失效面」） */
function removeBlock(s: string, open: string, close: string): string {
  const i = s.indexOf(open)
  if (i === -1) return s
  const j = s.indexOf(close, i)
  if (j === -1) return s
  return s.slice(0, i) + s.slice(j + close.length)
}

/**
 * 弹层是否挂在根 `<page>` 的**直接子级**（剔除 RouterView / KeepAlive 子树后仍在）。
 * 抽取器有牙与否由下面的**阳性对照**证明（合成源码必须被判负）。
 */
function dialogIsRootLevel(s: string): boolean {
  const root = rootPageBlock(s)
  const stripped = removeBlock(
    removeBlock(root, '<RouterView', '</RouterView>'),
    '<KeepAlive',
    '</KeepAlive',
  )
  return stripped.includes('<SearchSheet')
}

describe('#1018 ① 位置：常驻弹层挂在根 <page> 直下（不经 RouterView / KeepAlive）', () => {
  it('抽取器切到的确实是**模板的根 <page>**（不是脚本注释里的同名字面量）', () => {
    // 根块的特征 = 它带主题类绑定（只有模板根 <page> 才有）
    expect(rootPageBlock(appVue)).toContain(
      ':class="appearanceClasses(settings.themeColor, settings.resolvedDark)"',
    )
  })

  it('App.vue 里 <SearchSheet> 是根 <page> 的直接子节点', () => {
    expect(dialogIsRootLevel(appVue)).toBe(true)
  })

  it('<SearchSheet> 与 <RouterView> 都是根 <page> 的子节点（结构前提，不是巧合）', () => {
    const root = rootPageBlock(appVue)
    expect(root).toContain('<SearchSheet')
    expect(root).toContain('<RouterView')
    expect(root).toContain('<KeepAlive')
  })

  it('阳性对照：弹层被挪进 RouterView 内 ⇒ 抽取器必须判负（证明门禁有牙）', () => {
    const synthetic = `<page :class="appearanceClasses(settings.themeColor, settings.resolvedDark)">
      <RouterView v-slot="{ Component }">
        <KeepAlive :include="['discover']">
          <component :is="Component" :key="x" />
        </KeepAlive>
        <SearchSheet v-if="searchSheet.isOpen" />
      </RouterView>
    </page>`
    expect(dialogIsRootLevel(synthetic)).toBe(false)
  })

  it('阳性对照：弹层被挪进 KeepAlive 内 ⇒ 抽取器必须判负（证明门禁有牙）', () => {
    const synthetic = `<page :class="appearanceClasses(settings.themeColor, settings.resolvedDark)">
      <KeepAlive :include="['discover']">
        <SearchSheet v-if="searchSheet.isOpen" />
      </KeepAlive>
    </page>`
    expect(dialogIsRootLevel(synthetic)).toBe(false)
  })
})

describe('#1018 ② SearchSheet 不得快照主题（否则系统翻转后弹层不跟随）', () => {
  const body = strip(searchSheetVue)

  it('不读 resolvedDark / themeColor（主题一律从根 <page> 的 CSS 变量继承）', () => {
    expect(body).not.toMatch(/resolvedDark/)
    expect(body).not.toMatch(/themeColor/)
  })

  it('不自带主题类绑定（根类翻转即整树变量重算，弹层不应另起一套主题源）', () => {
    expect(body).not.toMatch(/appearanceClasses\(/)
  })
})

describe('#1018 ③ 触发器：翻转 ⇒ 根类必变（弹层跟随翻转的前提）', () => {
  it('根 <page> 的类绑定仍由 appearanceClasses(theme, resolvedDark) 驱动', () => {
    expect(appVue).toContain(':class="appearanceClasses(settings.themeColor, settings.resolvedDark)"')
  })

  it('appearanceClasses 在 light / dark 下产出不同类（纯函数行为）', () => {
    const themeId = THEME_COLOR_OPTIONS[0]!.id
    const light = appearanceClasses(themeId, 'light')
    const dark = appearanceClasses(themeId, 'dark')
    expect(dark).toContain(DARK_CLASS)
    expect(light).not.toContain(DARK_CLASS)
    expect(dark).not.toEqual(light)
  })
})

/**
 * #1018 ④ 瞬态轻提示（exitHint / muteTagHint）：**源级守卫**，非取帧。
 *
 * <p>为什么是源级守卫而不是真机取帧：这两条提示 2 秒自动消失（瞬态），
 * #1018 的取证方法是「翻转主题 → 取第二帧」—— 要取到第二帧，就得在提示仍在屏上的
 * 那 2 秒内完成一次翻转，时序上极不可靠 ⇒ **只能定性，不能取证**。
 *
 * <p>那为什么要守：它们**会**经过主题翻转（挂在根 `<page>` 直下），若配色哪天从
 * 「CSS 变量引用」退化成「静态色值」，就会出现「提示还在屏上但颜色是旧主题的」
 * —— 这正是 #1018 想防的形态。守卫钉住的正是这条**不变量**：不得出现字面量颜色。
 *
 * <p>当前实现用 `bg-inverse-surface` / `text-inverse-on-surface`，二者展开为
 * `var(--md-inverse-surface)` / `var(--md-inverse-on-surface)`
 * （`packages/app-lynx/tailwind.config.ts` 的 inverse 色组）⇒ 主题类一变，
 * 浏览器立即重新求值并重绘 ⇒ **不存在「2 秒内看到旧色」的窗口**。
 *
 * <p>取证与结论：[docs/research/issue-1018-and-755-residual-findings-2026-10.md](../../docs/research/issue-1018-and-755-residual-findings-2026-10.md)
 */
describe('#1018 ④ 瞬态轻提示配色必须走令牌（不得退化成静态色值）', () => {
  const appBody = strip(appVue)

  /**
   * 两条瞬态轻提示的宿主 view：各自带 v-if 判据。
   *
   * <p>⚠️ 切片边界：配色 class 在**内层** view 上（外层 view 只管定位），故必须取到
   * **配对闭合**的整个 view 块，不能按「下一个 `<view` 起始」截断 —— 那样只会拿到
   * 外层定位 view，恒不含配色 class（断言恒假 ⇒ 门禁无牙）。
   */
  const hintBlocks = (): string[] => {
    const out: string[] = []
    for (const marker of ['v-if="exitHint"', 'v-if="settings.muteTagHint"']) {
      const i = appBody.indexOf(marker)
      if (i === -1) continue
      // 从该 marker 所在的 <view 起，按 <view …>…</view> 配对取出整个块
      const openStart = appBody.lastIndexOf('<view', i)
      let depth = 0
      let pos = openStart
      let end = -1
      while (pos !== -1) {
        const nextOpen = appBody.indexOf('<view', pos + 1)
        const nextClose = appBody.indexOf('</view>', pos + 1)
        if (nextClose === -1) break
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth += 1
          pos = nextOpen
        } else {
          if (depth === 0) {
            end = nextClose + '</view>'.length
            break
          }
          depth -= 1
          pos = nextClose
        }
      }
      out.push(end === -1 ? appBody.slice(openStart) : appBody.slice(openStart, end))
    }
    return out
  }

  it('两条瞬态轻提示都存在（抽取器前提）', () => {
    const blocks = hintBlocks()
    expect(blocks).toHaveLength(2)
  })

  it('两条瞬态轻提示都用 inverse 令牌配色（bg-inverse-surface + text-inverse-on-surface）', () => {
    for (const block of hintBlocks()) {
      expect(block).toContain('bg-inverse-surface')
      expect(block).toContain('text-inverse-on-surface')
    }
  })

  it('两条瞬态轻提示均不出现字面量颜色（否则主题翻转后不跟随 —— #1018 要防的形态）', () => {
    for (const block of hintBlocks()) {
      // 十六进制 / rgb() / hsl() / 具名色 —— 一律禁止
      expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
      expect(block).not.toMatch(/\brgba?\(/)
      expect(block).not.toMatch(/\bhsla?\(/)
      expect(block).not.toMatch(/\b(?:white|black|red|blue|gray|grey)\b/)
    }
  })
})
