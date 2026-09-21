// ─── 小说推荐端点契约测试（票 #707/#708 / spec docs/specs/app-lynx-recommended-novel-bookmark.md）───
// Oracle（期望值独立来源）：
//   1. **真实响应 fixture** = `tests/fixtures/novel-recommended.real.json`
//      —— 2026-09-21 从**真实端点**抓取（`GET /v1/novel/recommended?filter=for_ios`，经 web-core 预览的
//      dev 代理 `http://127.0.0.1:3003/pixiv-api/...`，HTTP 200，原始 body 88,626 字节 / 33 条小说）。
//      入库形态：**保留 3 条完整条目（字段逐字未改）**，覆盖 `x_restrict` 0/1/2 与有无 `series`；
//      裁剪的只有条数（33→3）与两个应用未消费的顶层键（`ranking_novels` / `privacy_policy`）。
//      重新抓取：预览登录后 `playwright-cli run-code` 监听 `page.on('response')` 中 url 含
//      `/novel/recommended` 的响并取其 `await r.text()`（详见 docs/verification/
//      app-lynx-recommended-novel-bookmark-emulator-2026-09-21.md）。
//   2. 端点/参数 = 既有实现（src/api/novel.ts loadRecommendedNovels）+ Pixiv-Shaft 同款端点
//      + webview 差分实现（packages/app/src/api/novel.ts）三处一致。
//   3. 透传语义 / 失败传播 = 不变量（客户端不改写响应；错误必须上抛而非静默吞；测试硬约束 #1）。
//
// 本 fixture 钉死的正是本 feature 的**唯一外部依赖**：推荐小说条目确实携带
// `is_bookmarked` / `total_bookmarks` / `text_length`（推荐轮播小说滑页的 ♥ 初始态、计数与「N 字」全取自它们）。
// 附注（实测发现，非缺陷）：真实响应还带 `is_muted` / `is_mypixiv_only` / `is_original` / `is_x_restricted` /
// `request` / `restrict` / `visible` 等 `PixivNovel` 未声明的字段——应用只消费已声明子集，多余字段无害。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { apiClient } from '../src/api/client'
import { loadRecommendedNovels } from '../src/api/novel'
import type { PixivNovelListResponse } from '../src/api/types'

/** 真实响应 fixture（逐字入库，非手写样例） */
const REAL: PixivNovelListResponse = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/novel-recommended.real.json', import.meta.url)), 'utf8'),
) as PixivNovelListResponse

describe('loadRecommendedNovels 契约（/v1/novel/recommended）', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('真实 fixture 自身有效性：非空、字段齐、覆盖三档 x_restrict（防空 fixture 让断言恒真）', () => {
    expect(REAL.novels.length).toBeGreaterThanOrEqual(3)
    expect(new Set(REAL.novels.map((n) => n.x_restrict))).toEqual(new Set([0, 1, 2]))
    expect(REAL.next_url).toContain('/v1/novel/recommended')
  })

  it('端点/参数契约：GET /v1/novel/recommended 带 filter=for_ios，响应原样透传', async () => {
    const spy = vi.spyOn(apiClient, 'get').mockResolvedValue(REAL)
    const res = await loadRecommendedNovels()
    expect(spy).toHaveBeenCalledWith('/v1/novel/recommended', { filter: 'for_ios' }, undefined)
    // 透传语义：客户端不改写字段（页面直接消费响应对象）
    expect(res).toBe(REAL)
  })

  it('真实响应确实携带 ♥ 与字数所需字段（is_bookmarked / total_bookmarks / text_length）', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue(REAL)
    const res = await loadRecommendedNovels()
    // oracle = 真实抓取（fixture）；这里断言的是「页面依赖的字段在真实响应中存在且类型可用」
    for (const novel of res.novels) {
      expect(typeof novel.is_bookmarked).toBe('boolean')
      expect(Number.isFinite(novel.total_bookmarks)).toBe(true)
      expect(Number.isFinite(novel.text_length)).toBe(true)
      expect(novel.text_length).toBeGreaterThan(0) // 「N 字」不显示 0 字的前提
    }
  })

  it('失败路径：apiClient.get 拒绝时错误向上传播（页面走 presentError，不静默吞）', async () => {
    vi.spyOn(apiClient, 'get').mockRejectedValue(new Error('network down'))
    await expect(loadRecommendedNovels()).rejects.toThrow('network down')
  })
})
