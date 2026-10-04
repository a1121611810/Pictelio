// ─── IllustDetail.vue 双轨收藏接线契约（T5 #534 / spec docs/specs/bookmark-tags.md D3/D8）───
// 页面层接线不落在任何 composable 单测内（.vue 不经 tsc/vitest 渲染），故用源级守卫锚定
// 「不该被静默改掉的形状」：唯一状态机注入心形 + 长按开面板 + 面板挂页面层 + 保存经 saveWith
// + 保存成功仅新收藏播动效。
//
// 期望值出处（Oracle 溯源）：
// - 双轨入口与面板挂载 = spec D3/D8 + 用户故事 13（返回键先关面板）；
// - 保存通道 = spec D2/D9（面板经 saveWith 覆盖式保存，宿主写状态）；
// - 「仅新收藏播爆发动效」= 面板保存后的行为契约。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { ILLUST_DETAIL_A11Y_LABELS } from '../utils/accessibility'

const src = readFileSync(fileURLToPath(new URL('./IllustDetail.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明会提到目标串，断言须落在代码本文上） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

describe('IllustDetail 双轨收藏接线（spec D3/D8）', () => {
  it('页面持有唯一收藏状态机并注入心形（单击快速收藏与面板共用一份状态）', () => {
    expect(code).toContain('useBookmarkMutation({')
    expect(code).toContain(':mutation="bm"')
    expect(code).toContain('enable-long-press')
    expect(code).toContain('@long-press="openBookmarkPanel"')
  })

  it('长按打开面板并快照保存前收藏态（决定是否播爆发动效）', () => {
    expect(code).toContain('panelOpenedBookmarked.value = bm.bookmarked.value')
    expect(code).toContain('showBookmarkPanel.value = true')
  })

  it('面板挂页面层且 DOM 顺序在内容区之后（v-if 条件渲染，ADR-0123 全屏层规则）', () => {
    const panelMountAt = code.indexOf('showBookmarkPanel" class="absolute inset-0"')
    expect(panelMountAt).toBeGreaterThan(-1)
    // 在内容滚动区之后挂载 = DOM 后序覆盖（同 CommentOverlay 的离流覆盖层约定）
    expect(code.indexOf('</scroll-view>')).toBeLessThan(panelMountAt)
  })

  it('面板经宿主状态机保存：saveWith + busy/errorMsg 透传 + saved/close 接线', () => {
    expect(code).toContain(':save-with="bm.saveWith"')
    expect(code).toContain(':save-error="bm.errorMsg.value"')
    expect(code).toContain(':saving="bm.busy.value"')
    expect(code).toContain('@close="showBookmarkPanel = false"')
    expect(code).toContain('@saved="onBookmarkPanelSaved"')
  })

  it('保存成功：关面板 + 仅「保存前未收藏」播爆发动效（覆盖式编辑不播）', () => {
    expect(code).toContain('function onBookmarkPanelSaved(): void {')
    expect(code).toContain('showBookmarkPanel.value = false')
    expect(code).toContain('if (panelOpenedBookmarked.value) return')
    expect(code).toContain('heartRef.value.playBurst()')
    // 动效通道缺失不静默（测试硬约束 #3 精神）
    expect(code).toContain('[IllustDetail] 心形 ref 未就绪')
  })

  it('详情返回后把服务端收藏真值写入状态机（缺失即告警，不静默）', () => {
    expect(code).toContain('bm.bookmarked.value = !!res.illust.is_bookmarked')
    expect(code).toContain('bm.count.value = Math.max(0, res.illust.total_bookmarks ?? 0)')
    expect(code).toContain('total_bookmarks 缺失（契约破坏）')
  })

  it('作品标签建议取原形 name', () => {
    expect(code).toContain('illust.value?.tags?.map((tag) => tag.name) ?? []')
  })
})

describe('IllustDetail 作者行命中区（#542）', () => {
  it('openAuthor 只挂在头像+名字内层 view（整行可点会让坐标自动化静默跳作者页）', () => {
    expect((code.match(/@tap="openAuthor"/g) ?? []).length).toBe(1)
    // 内层命中容器 + 测试锚点（web-core/CDP 调试用；原生 a11y 树不暴露，ADR-0123）
    expect(code).toContain('data-testid="illust-detail-author"')
    // 关注按钮不再依赖 @tap.stop 自保（外层无 tap handler，误触面消失）
    expect(code).not.toContain('@tap.stop="toggleFollowAuthor"')
    expect(code).toContain('@tap="toggleFollowAuthor"')
  })
})

describe('IllustDetail 下载入队命名接线（ADR-0192 D7 / spec D6：模板与开关入队即快照）', () => {
  it('enqueuePages / enqueueUgoira 双链同时传 authorDir 与 template（同一读取点 = settingsStore）', () => {
    // 命名模板接线（spec D6/US2/US15）：入队时刻读 settings.downloadFileTemplate 快照，
    // 与 downloadByAuthorDir 同一读取点；缺一即为半交付（模板设置形同虚设）
    expect((code.match(/template: settings\.downloadFileTemplate/g) ?? []).length).toBe(2)
    expect((code.match(/authorDir: settings\.downloadByAuthorDir/g) ?? []).length).toBe(2)
  })
})

// ─── 标签近邻入口接线（ADR-0197 D14 / spec docs/specs/tag-neighbors.md user story 1/2）───
// 期望值出处：ADR-0197 D14「入口为作品详情页动作行新增一项，作用于作品级」；
// user story 2「与既有的保存/评论/稍后看并排出现在动作行里」。
// a11y 键消费完整性沿 ME_A11Y_LABELS / NOTIFICATIONS_A11Y_LABELS 的既有约定。
describe('IllustDetail 标签近邻入口（ADR-0197 D14）', () => {
  it('入口与其它作品级动作同处一个动作行容器', () => {
    // 位置断言：以动作行的开启标签为界，入口须落在「保存 / 评论 / 稍后看」之后
    const actionRow = code.indexOf('class="mt-2 flex flex-row items-center flex-wrap"')
    expect(actionRow).toBeGreaterThan(-1)
    const entry = code.indexOf('@tap.stop="openTagNeighbors"')
    expect(entry).toBeGreaterThan(actionRow)
    // 三项既有动作都在入口之前
    expect(code.indexOf('@tap="onSaveEntry"')).toBeLessThan(entry)
    expect(code.indexOf('@tap.stop="toggleWatchLater"')).toBeLessThan(entry)
  })

  it('动作行必须允许换行：5 项在 360dp 宽机型上放不下，不 wrap 会压缩并折行', () => {
    // 真机走查实证（pictelio_ui 模拟器 1080x2160）：加第 5 项后单行 flex 子项被压缩，
    // 中文标签与收藏数一起折行（「标签近邻」→「标签近/邻」、收藏数「349」→「34/9」）。
    expect(code).toContain('class="mt-2 flex flex-row items-center flex-wrap"')
    expect(code).not.toContain('class="mt-2 flex flex-row items-center"')
  })

  it('跳转前先写入源作品，且用全量 tags 而非模板截断数组', () => {
    expect(code).toContain('tagNeighbors.setSourceIllust(illust.value)')
    expect(code).toContain('navigate(`/illust/${illust.value.id}/tag-neighbors`)')
    // 模板渲染用 slice(0, 8)；近邻计算必须用全量 illust 对象本身
    expect(code).not.toContain('setSourceIllust(workTags')
  })

  it('a11y 注册表键全部被消费且 label/element 配平', () => {
    expect(ILLUST_DETAIL_A11Y_LABELS.tagNeighborsEntry).toBe('查看标签近邻作品')
    for (const key of Object.keys(ILLUST_DETAIL_A11Y_LABELS)) {
      expect(code).toContain(`:accessibility-label="ILLUST_DETAIL_A11Y_LABELS.${key}"`)
    }
    const labelCount = (code.match(/:accessibility-label="ILLUST_DETAIL_A11Y_LABELS\.\w+"/g) ?? []).length
    const elementCount = (code.match(/:accessibility-element="A11Y_ELEMENT_ENABLED"/g) ?? []).length
    expect(labelCount).toBe(Object.keys(ILLUST_DETAIL_A11Y_LABELS).length)
    // [ #887 / ADR-0213 决策 9 ] 图片容器另有 3 处**动态** a11y 标签（进入/退出沉浸模式），
    // 走 t() 而非注册表。配平口径不变——「每个 a11y 标注都配一个 element」，故 element
    // 总量 = 注册表标签数 + 沉浸标签数（缺任一即红）。
    const immersiveLabelCount = (code.match(/:accessibility-label="immersiveA11yLabel/g) ?? []).length
    expect(elementCount).toBe(labelCount + immersiveLabelCount)
  })
})
