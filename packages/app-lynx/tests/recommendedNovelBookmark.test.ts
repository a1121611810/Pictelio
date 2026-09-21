// ─── 推荐轮播小说滑页收藏入口（票 #707 / spec docs/specs/app-lynx-recommended-novel-bookmark.md）───
// 仓库无 vue-lynx 渲染器（见 components/BookmarkButton.template.test.ts 头注）→ 页面级接线用**源级守卫**
// 锁形态；行为语义（init-only props / novel 端点 / 换卡 remount）由
// components/BookmarkButton.host-matrix.test.ts 的 (c) 轮播小说宿主用例覆盖。
//
// 期望值出处（Oracle 溯源）：
// - 「小说滑页要有与插画同槽位同形的 ♥」= spec §Solution + Q8-A 版面决策（♥ 占插画槽位 mt-5、字数退次行 mt-2）；
// - target-kind="novel" = 小说收藏走 novel 端点（tests/novel-detail-api.test.ts 契约：add=v2/restrict、delete=v1）
//   且不开长按面板（ADR-0160 D7 裁剪：小说标签不在本期）；
// - key 取 feed 跨 kind 唯一键 = src/primitives/createMixFeed.ts `MixFeedItem.key`（`i-<id>` / `n-<id>`）
//   + ADR-0163（init-only props 被复用即冻结；插画与小说 id 数值相同会撞裸 id key）；
// - 「N 字」保留 = spec Q4-A（♥ + 收藏数与字数并存）；
// - 计数/收藏态取自小说真实字段 = src/api/types.ts PixivNovel.is_bookmarked / total_bookmarks。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const src = readFileSync(fileURLToPath(new URL('../src/pages/Recommended.vue', import.meta.url)), 'utf8')
/** 去 HTML 注释与整行行注释（约束说明会提到目标串，断言须落在代码本文上） */
const code = src.replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '')

/** 页面上所有 BookmarkButton 使用点（模板形状，源码级） */
const chipBlocks = code.match(/<BookmarkButton[\s\S]*?\/>/g) ?? []

describe('推荐轮播小说滑页收藏入口（票 #707）', () => {
  it('小说滑页真的渲染 ♥ 且走 novel 目标（不是只显示字数）', () => {
    expect(chipBlocks).toHaveLength(2) // 插画滑页 + 小说滑页各一处
    const novelChip = chipBlocks.find((b) => b.includes('target-kind="novel"'))
    expect(novelChip, '未找到 target-kind="novel" 的 BookmarkButton（小说滑页没有收藏入口）').toBeDefined()
    // 小说 ♥ 必须绑定小说自身的 id/收藏态/计数（不是写死或复用插画字段）
    expect(novelChip).toContain(':illust-id="currentItem.data.id"')
    expect(novelChip).toContain(':initial-bookmarked="currentItem.data.is_bookmarked"')
    expect(novelChip).toContain(':bookmark-count="currentItem.data.total_bookmarks"')
  })

  it('♥ 与插画同槽位、字数退为次行（Q8-A 版面决策）', () => {
    // 两个 kind 的 ♥ 容器都落在 mt-5 槽位 → 左右滑动切换时 ♥ 不跳动
    expect(code.match(/class="mt-5"/g) ?? []).toHaveLength(2)
    // 字数仍在（小说滑页保留「N 字」），且退到 ♥ 下方次行
    expect(code).toMatch(/t\('recommended\.charCount'/)
    expect(code).toContain('class="text-label-medium text-white/70 mt-2"')
  })

  it('两 kind 的 :key 取 feed 跨 kind 唯一键（禁止裸 id：插画/小说 id 相同会复用实例 → init-only props 冻结）', () => {
    expect(code.match(/:key="currentItem\.key"/g) ?? []).toHaveLength(2)
    expect(code).not.toContain(':key="currentItem.data.id"')
  })

  it('不开长按收藏面板（ADR-0160 D7：小说标签不在本期，半成品入口比没有更糟）', () => {
    expect(code).not.toContain('enable-long-press')
  })
})
