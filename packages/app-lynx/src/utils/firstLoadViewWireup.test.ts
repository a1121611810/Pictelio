// 页级首载骨架 跨页接线源级防线（ADR-0150 / spec T5 #436）。
// 期望值出处（Oracle 溯源）：ADR-0150:14-20（受影响面）+ 决策 1/4 + spec:56 优先级 / spec:57「统一消费」
// + spec:103-107（T1-T4 验收）。
// 防线性质：仓库级源级守卫——防「某个页面回退到 loading && 渲染流为空 的旧骨架条件 /
// 去掉 deriveFirstLoadView 消费」造成的单页遗漏（T1 的单文件防线只覆盖 IllustList）。
// 行为正确性（首帧骨架、刷新不闪、失败显错误）由 web-core + 模拟器 / 真机闭环承担。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import zhMisc from '../i18n/locales/zh-CN/misc'

/** 读取相对本测试文件的 .vue 源码 */
function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8')
}
/** 去注释后的代码本文（负向断言对象；说明本身会提到旧写法——含 HTML / 块 / 行注释） */
function code(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
/** 模板条件行：v-if / v-else-if */
function conditionLines(src: string): string[] {
  return code(src)
    .split('\n')
    .filter((l) => /v-(if|else-if)=/.test(l))
}

/** ADR-0150 受影响面（spec:16-19）：9 个网络首载页 / 组件；Recommended 已正确（不在范围） */
const FILES = [
  '../pages/IllustList.vue',
  '../pages/Following.vue',
  '../pages/NovelList.vue',
  '../pages/Watchlist.vue',
  '../pages/Bookmarks.vue',
  '../pages/UserHome.vue',
  '../pages/FollowList.vue',
  '../components/CommentOverlay.vue',
  '../components/SearchSheet.vue',
]

describe('页级首载骨架 跨页接线（ADR-0150 / T5 #436）', () => {
  for (const rel of FILES) {
    it(rel + ' 消费 deriveFirstLoadView 且骨架不再依赖 loading 标志', () => {
      const src = read(rel)
      expect(src).toContain("import { deriveFirstLoadView } from '../utils/firstLoadView'")
      expect(src).toContain('deriveFirstLoadView(')
      // 骨架分支落在模板条件上（变量名不限，故按 'skeleton' 文案断言）
      expect(conditionLines(src).some((l) => l.includes("'skeleton'"))).toBe(true)
      // 负向：禁止任何条件同时门控 loading 与「渲染流为空」（旧 bug 形态；含 !x.length / length == 0 变体）
      const bad = conditionLines(src).filter(
        (l) => /loading/i.test(l) && /(?:length\s*===?\s*0|!\s*[\w.$]*\.length)/.test(l),
      )
      expect(bad).toEqual([])
    })
  }
})

describe('首载三态 状态映射与错误可见性（ADR-0150 / spec:57 / T4 #435）', () => {
  it('评论浮层：useComments 的 idle 与 loading 同归骨架，ready 才判定空态', () => {
    const src = read('../components/CommentOverlay.vue')
    expect(src).toContain("state.value.status === 'loading' || state.value.status === 'idle'")
    expect(src).toContain("state.value.status === 'ready'")
    expect(conditionLines(src).some((l) => l.includes("'skeleton'"))).toBe(true)
    expect(conditionLines(src).some((l) => l.includes("'empty'"))).toBe(true)
  })

  it('搜索弹层：isSearching/loading 且无旧结果走骨架；换词保留旧结果（hasItems 优先）', () => {
    const src = read('../components/SearchSheet.vue')
    expect(src).toContain('state.value.isSearching || state.value.status ===')
    expect(conditionLines(src).some((l) => l.includes("'skeleton'"))).toBe(true)
    expect(conditionLines(src).some((l) => l.includes("'empty'"))).toBe(true)
  })

  it('存在数据时的刷新 / 分页错误必须可见（槽位分离，不静默吞错）', () => {
    const src = read('../pages/FollowList.vue')
    expect(src).toMatch(/pageErrorMsg\.value = presentError/)
    expect(conditionLines(src).some((l) => l.includes('pageErrorMsg'))).toBe(true)
  })

  it('关注 / 取关动作失败必须可见（不得写入仅无数据时渲染的 errorMsg 槽）', () => {
    const src = read('../pages/FollowList.vue')
    // #511 补抽：文案走 t('followList.actionFailed')（赋值时快照）；zh 字典值 = 存量文案「操作失败」逐字快照
    expect(zhMisc['followList.actionFailed']).toBe('操作失败')
    expect(src).toContain("pageErrorMsg.value = t('followList.actionFailed')")
    expect(src).not.toContain("errorMsg.value = t('followList.actionFailed')")
  })

  it('追更列表：有数据刷新失败必须可见（watchlistFeed 保留 items，不落 error 分支）', () => {
    const src = read('../pages/Watchlist.vue')
    // 顶部内联错误条：view==='content' 且 errorMsg 时仍渲染（防三态错误分支吞掉刷新失败）
    expect(conditionLines(src).some((l) => l.includes('errorMsg'))).toBe(true)
    // 首载错误态补重试入口（非 tab 页无全局刷新 FAB）
    expect(src).toContain('@tap="refreshFeed"')
  })

  it('首载错误态保留重试入口（Following / FollowList 为非 tab 页，无全局刷新 FAB）', () => {
    const following = read('../pages/Following.vue')
    expect(conditionLines(following).some((l) => l.includes("'error'"))).toBe(true)
    expect(following).toContain('@tap="refreshFeed"')
    const followList = read('../pages/FollowList.vue')
    expect(conditionLines(followList).some((l) => l.includes("'error'"))).toBe(true)
    expect(followList).toContain('@tap="fetchFirstPage"')
  })
})
