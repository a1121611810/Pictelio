// ─── IllustDetail 沉浸接线契约（#887 / ADR-0213 决策 1、2、3、9）───
//
// 页面层接线不落在 composable 单测内（.vue 不经 tsc/vitest 渲染），故用源级守卫锚定
// 「不该被静默改掉的形状」：三处图片层全覆盖、角标独立条件渲染且阻断冒泡、chrome 边界、
// 既有处理器不回归、浮层复合动作、a11y 接线、以及**本票不得越界到系统栏**。
//
// 期望值出处（Oracle 溯源）：
// - 三处图片层 = ADR-0213 决策 2 + 复核判据 3「带 @tap 切换 chrome 的容器数 = 3」
//   （只改单图分支会让动图与多图分支静默失去沉浸入口）；
// - 角标「必须独立条件渲染 + @tap.stop」= ADR-0213 决策 2「唯一真冲突」与决策 3
//   chrome 边界表（角标是图片层子节点、父不级联）+ spec user story 13/16；
// - 处理器基线 9 裸 + 3 .stop = ADR-0213 复核判据 4「实施后目标态」；
// - 浮层复合动作 = 决策 3「浮层优先级」+ user story 24；
// - 不得写持久键 = 决策 6 硬规则 + 复核判据 2；系统栏/返回守卫属后续票（决策 4/5）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('./IllustDetail.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明会提到目标串，断言须落在代码本文上） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')
const composableSrc = readFileSync(
  fileURLToPath(new URL('../composables/useImmersiveChrome.ts', import.meta.url)),
  'utf8',
)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
/** 全部 @tap 处理器出现位置（用于分支归属断言） */
function tapIndices(handler: string): number[] {
  const out: number[] = []
  let from = 0
  for (;;) {
    const at = code.indexOf(`@tap="${handler}"`, from)
    if (at === -1) return out
    out.push(at)
    from = at + 1
  }
}

describe('沉浸切换绑在三处图片层容器上（决策 2 + 复核判据 3/4）', () => {
  it('切换处理器恰好 3 处（数错会让动图与多图分支静默失去沉浸入口）', () => {
    expect(tapIndices('toggleImmersive').length).toBe(3)
  })

  it('三处分别落在 ugoira / 多图 / 单图分支内（不靠猜，靠分支锚点定位）', () => {
    const [ugoira, multi, single] = tapIndices('toggleImmersive')
    // 分支锚点：ugoira 条件 → 多图条件 → 多图分支的 </template>（其后才是 v-else 单图分支）
    const ugoiraBranch = code.indexOf("illust.type === 'ugoira'")
    const multiBranch = code.indexOf('v-else-if="slideSrcs.length > 1"')
    const multiBranchEnd = code.indexOf('</template>')
    expect(ugoira).toBeGreaterThan(ugoiraBranch)
    expect(multi).toBeGreaterThan(multiBranch)
    // 多图分支内（未越过其 </template>）
    expect(multi).toBeLessThan(multiBranchEnd)
    // 单图 = 多图分支之后的 v-else 分支
    expect(single).toBeGreaterThan(multiBranchEnd)
    expect(ugoira).toBeLessThan(multi)
    expect(multi).toBeLessThan(single)
  })

  it('绑在容器 view 而非图片元素上（覆盖「图未加载完成时点空位」）', () => {
    // 三处绑定宿主都是图片层 view（`relative ... overflow-hidden`），不是 image/SkeletonImage
    const container = /class="relative w-full bg-surface-container-highest overflow-hidden[^"]*"[\s\S]{0,300}?@tap="toggleImmersive"/g
    expect((code.match(container) ?? []).length).toBe(3)
    // 图片/播放器组件自身不得被绑切换（抢已有手势风险）
    expect(code).not.toMatch(/<SkeletonImage[^>]*@tap=/)
    expect(code).not.toMatch(/<UgoiraViewer[^>]*@tap=/)
  })

  it('处理器总账 = 9 裸 + 3 .stop（ADR 复核判据 4 实施后口径）', () => {
    const bare = (code.match(/@tap="/g) ?? []).length
    const stop = (code.match(/@tap\.stop/g) ?? []).length
    expect(bare).toBe(9)
    expect(stop).toBe(3)
  })

  it('8 个既有处理器一个都不少、语义未改（决策 2「不动既有处理器」）', () => {
    for (const handler of [
      'openAuthor',
      'toggleFollowAuthor',
      'onSaveEntry',
      "navigate('/downloads')",
      'useSearchSheetStore().openSearch(tag.name)',
    ]) {
      expect(code).toContain(`@tap="${handler}"`)
    }
    expect(code).toContain('@tap.stop="toggleWatchLater"')
    expect(code).toContain('@tap.stop="openTagNeighbors"')
    // 评论入口改为复合动作（决策 3 浮层优先级），不再直赋 showComments
    expect(code).toContain('@tap="openComments"')
    expect(code).not.toContain('@tap="showComments = true"')
  })
})

describe('「n / N」页角标：独立条件渲染 + 阻断冒泡（决策 2/3）', () => {
  const badgeTag = /<view\s[^>]*?absolute top-2 left-0[^>]*?>/.exec(code)?.[0] ?? ''

  it('角标宿主带 @tap.stop（否则点角标冒泡到图片层误触发切换，user story 16）', () => {
    expect(badgeTag).not.toBe('')
    expect(badgeTag).toContain('@tap.stop')
  })

  it('角标靠自身 v-if 隐藏，不靠父级 class 级联（图片层本身不隐藏）', () => {
    expect(badgeTag).toContain('v-if="!chromeHidden"')
  })

  it('角标仍是图片层子节点（多图容器内），未提升层级', () => {
    const containerAt = code.indexOf('v-else-if="slideSrcs.length > 1"')
    expect(code.indexOf('absolute top-2 left-0')).toBeGreaterThan(containerAt)
  })
})

describe('chrome 边界：隐藏态不留任何可见非内容元素（决策 3 封闭清单）', () => {
  it('顶栏隐藏（沉浸态不保留任何可见 chrome）', () => {
    expect(code).toContain('<PageTopBar v-if="!chromeHidden" back')
  })

  it('操作 / 信息行整体隐藏', () => {
    expect(code).toContain('<view v-if="!chromeHidden" class="p-4 bg-surface-container-lowest">')
  })

  it('隐藏条件共 3 处且全为 !chromeHidden（顶栏 / 操作行 / 角标，无遗漏也无多余）', () => {
    expect((code.match(/v-if="!chromeHidden"/g) ?? []).length).toBe(3)
    // 图片层**不得**被隐藏（藏的是 chrome 不是图）
    expect(code).not.toMatch(/v-if="!chromeHidden"[^>]*bg-surface-container-highest/)
  })

  it('图片容器无尺寸/缩放改动（本票不碰图片尺寸，只控 chrome 显隐）', () => {
    // 沉浸接线不得给图片容器加 scale/尺寸类（放大看图是另一件事，不在本票）
    for (const at of tapIndices('toggleImmersive')) {
      const tag = /<view\s[^>]*?@tap="toggleImmersive"/.exec(code.slice(Math.max(0, at - 400), at + 40))?.[0] ?? ''
      expect(tag).not.toMatch(/scale-|aspect-\[|h-\[|w-\[/)
    }
  })
})

describe('浮层打开强制退出沉浸（决策 3 浮层优先级）', () => {
  it('三个浮层入口统一走 openOverlay 复合动作（先退出沉浸 + 再打开）', () => {
    expect(code).toContain('openImmersiveOverlay(() => {\n    showComments.value = true\n  })')
    expect(code).toContain('openImmersiveOverlay(() => {\n      showPicker.value = true\n    })')
    expect(code).toContain('openImmersiveOverlay(() => {\n    showBookmarkPanel.value = true\n  })')
  })

  it('打开动作在全文件各只出现一次（不留任何绕过复合动作的直赋入口）', () => {
    expect((code.match(/showComments\.value = true/g) ?? []).length).toBe(1)
    expect((code.match(/showPicker\.value = true/g) ?? []).length).toBe(1)
    expect((code.match(/showBookmarkPanel\.value = true/g) ?? []).length).toBe(1)
  })

  it('浮层组件内不反向感知沉浸（避免反向依赖，决策 3）', () => {
    expect(code).not.toMatch(/CommentOverlay[\s\S]{0,200}chromeHidden/)
    expect(code).not.toMatch(/BookmarkPanel[\s\S]{0,200}chromeHidden/)
  })
})

describe('无障碍（决策 9：动态标签 + 两态可退出路径）', () => {
  it('三处图片容器都挂动态 accessibility-label 与 accessibility-element', () => {
    expect((code.match(/:accessibility-label="immersiveA11yLabel/g) ?? []).length).toBe(3)
    expect((code.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length).toBe(4)
  })

  it('多图分支的标签带「第 n / N 张」，单图 / ugoira 分支不带', () => {
    expect(code).toContain(':accessibility-label="immersiveA11yLabel({ n: i + 1, total: slideSrcs.length })"')
    expect((code.match(/:accessibility-label="immersiveA11yLabel\(\)"/g) ?? []).length).toBe(2)
  })

  it('既有 a11y 键的 element/label 配平不被破坏（tagNeighborsEntry 仍在）', () => {
    expect(code).toContain(':accessibility-label="ILLUST_DETAIL_A11Y_LABELS.tagNeighborsEntry"')
  })
})

describe('降级与范围边界（决策 9 动效 / 决策 6 硬规则 / 本票边界）', () => {
  it('减弱动效：不消费 matchMedia、自建媒体查询（禁自建，全仓唯一事实源在 useReducedMotion）', () => {
    expect(composableSrc).not.toContain('matchMedia')
    // 沉浸切换为 v-if 结构切换 ⇒ 结构上不存在过渡类（比「按偏好条件挂载」更强的 R1 形态）
    expect(composableSrc).not.toContain('transition-')
  })

  it('沉浸接线不引入 i18n 之外的中文字面量（仓库硬门禁，tests/hardcode-gate.test.ts）', () => {
    expect(composableSrc).not.toMatch(/[\u4e00-\u9fa5]/)
  })

  it('沉浸路径不直连原生系统栏、不写持久键（决策 4/6；复核判据 2 硬规则）', () => {
    expect(code).not.toContain('setSystemBarsHidden')
    expect(code).not.toContain('setFullscreenMode')
    expect(code).not.toContain('settings_fullscreen_mode')
  })

  it('返回守卫必须放行、不得拦截（决策 5 L3 明文「return false 不拦截」）', () => {
    // ⚠️ 此处原为 `not.toContain('registerBackGuard')`。那是 #887 期的边界声明（决策 4/5/6
    // 属后续票），#889 落地后已过期，且把「L3 从未接线」锁成了合规态 —— 正是 F1 缺陷能
    // 长期存活的假绿来源。改为正向要求「守卫存在且放行」，语义见下方 describe。
    const guard = /registerBackGuard\(\(\) => \{[\s\S]{0,200}?\n\}\)/.exec(code)?.[0] ?? ''
    expect(guard).not.toBe('')
    expect(guard).toContain('return false')
  })

  it('不引入自动隐藏定时器（决策 1）', () => {
    expect(composableSrc).not.toMatch(/setTimeout|setInterval/)
  })
})

// ─── #889 系统栏联动（ADR-0213 决策 4、5、6）───
//
// #889 在 #887 的「应用内 chrome 显隐」之上补了「宿主系统栏」语义：
// 同一处点击现在同时驱动两层。既有断言（3 处 / 绑容器 / 浮层走复合动作）**全部保留**，
// 只是处理器与复合入口换了名字 —— 属**契约演进**，不是门禁被改宽。
describe('沉浸切换同时驱动宿主系统栏（#889）', () => {
  it('切换处理器必须同时驱动应用内 chrome 与原生系统栏', () => {
    expect(code).toContain('function toggleImmersive()')
    expect(code).toMatch(/const entering = !chromeHidden\.value/)
    expect(code).toMatch(/if \(entering\) onImmersiveEnter\(\)[\s\S]{0,80}?else onImmersiveExit\(\)/)
  })

  it('系统栏恢复必须回落到用户当前的全屏模式设定（不得硬编码 false）', () => {
    // 实现层的回落逻辑在 useImmersiveSystemBars（已单测覆盖）；
    // 本处只锁「页面用的是那个出口、不是自己写死 false」
    expect(code).toContain('useImmersiveSystemBars()')
    expect(code).not.toMatch(/setSystemBarsHidden\(false/)
    expect(code).not.toMatch(/applySystemBars\(false\)/)
  })

  it('三个浮层入口必须走「退出沉浸 + 系统栏恢复」的复合动作', () => {
    const n = (code.match(/openImmersiveOverlay\(\(\) => \{/g) || []).length
    expect(n).toBe(3)
    expect(code).toMatch(/function openImmersiveOverlay[\s\S]{0,120}?onImmersiveExit\(\)/)
  })

  it('沉浸路径不得写持久键（决策 6：写了 = 每次冷启动直接进沉浸）', () => {
    expect(code).not.toMatch(/setFullscreenMode\(/)
    expect(code).not.toMatch(/FULLSCREEN_MODE_KEY/)
  })
})

// ─── 决策 5 的 L2 / L3 复位保障（#889 验收缺口，code-review F1）───
//
// 缺陷：`useImmersiveChrome` 的 `onUnmounted` 只复位应用内 chrome 与所有权，**不碰系统栏**；
// 返回守卫从未接线 ⇒ 沉浸态按返回离开本页时 `applySystemBars(false)` 从未被调用，
// 用户离开详情页后系统栏仍隐藏（#889 标记 CLOSED，但「返回栈弹出路径系统栏会恢复」
// 这条验收未达成）。本组断言把 L2/L3 的接线形状钉住。
describe('卸载与返回两条路径上复位**两层**（决策 5 的 L2 / L3）', () => {
  it('存在唯一复位出口，顺序为先 exit() 再 onImmersiveExit()（顺序即语义）', () => {
    expect(code).toMatch(
      /function releaseImmersive\(\): void \{[\s\S]{0,200}?exit\(\)[\s\S]{0,80}?onImmersiveExit\(\)/,
    )
  })

  it('复位出口幂等：仅在持有沉浸时动作（避免向宿主重复下发原生调用）', () => {
    expect(code).toMatch(
      /function releaseImmersive\(\): void \{[\s\S]{0,80}?if \(!chromeHidden\.value\) return/,
    )
  })

  it('L2：宿主组件卸载即复位（onBeforeUnmount 挂同一个出口）', () => {
    expect(code).toContain('onBeforeUnmount(releaseImmersive)')
  })

  it('L3：返回守卫挂同一个出口，且随卸载注销（不泄漏守卫注册）', () => {
    expect(code).toMatch(
      /const unregisterBackGuard = registerBackGuard\(\(\) => \{[\s\S]{0,200}?releaseImmersive\(\)[\s\S]{0,80}?return false[\s\S]{0,80}?\}\)\s*onBeforeUnmount\(unregisterBackGuard\)/,
    )
  })

  it('L2/L3 不可依赖 useImmersiveChrome 兜底（该模块刻意不碰系统栏）', () => {
    // 记录「系统栏复位只可能发生在页面层」这一前提：若日后把系统栏并进 composable，
    // 本断言会转红并要求重新决策，而不是让两层复位悄悄长出第三个事实源。
    expect(composableSrc).not.toContain('SystemBars')
  })
})
