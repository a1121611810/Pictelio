// ─── IllustDetail.vue 双轨收藏接线契约（T5 #534 / spec docs/specs/bookmark-tags.md D3/D8）───
// 页面层接线不落在任何 composable 单测内（.vue 不经 tsc/vitest 渲染），故用源级守卫锚定
// 「不该被静默改掉的形状」：唯一状态机注入心形 + 长按开面板 + 面板挂页面层 + 保存经 saveWith
// + 保存成功仅新收藏播动效。
//
// 期望值出处（Oracle 溯源）：
// - 双轨入口与面板挂载 = spec D3/D8 + 用户故事 13（返回键先关面板）；
// - 保存通道 = spec D2/D9（面板经 saveWith 覆盖式保存，宿主写状态）；
// - 「仅新收藏播爆发动效」= webview handleBookmarkSaved（packages/app/src/routes/IllustDetail.tsx）。
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

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

  it('作品标签建议取原形 name（与 webview 面板 workTags 同源）', () => {
    expect(code).toContain('illust.value?.tags?.map((tag) => tag.name) ?? []')
  })
})
