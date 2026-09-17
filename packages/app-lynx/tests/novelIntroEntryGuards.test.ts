// ─── 三段式导航改道源级守卫（spec #585 / 票 #588；仓库「模板/源码断言」约定）───
// 背景：改道前 6 个小说入口中仅搜索弹层有源级钉（其提交点③测试）——改道时其余入口
// 不会被任何测试变红暴露漏改（地图 #575 深核发现，spec 测试决策「补齐源级防线」）。
// 本文件逐入口钉住：小说导航串必须指向 /novel/:id/intro，且不存在直达正文（裸 /novel/:id）的回退。
// oracle：spec 决策（票 #576 UI 改道 + #588 六入口清单，出处=地图 #575 取证）；
// 负向断言的 bare 串含收尾反引号，故不会误伤 /intro 版本（后者多 /intro 前缀于反引号）。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本文件位于 <pkg>/tests/，包根 = 上一级
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ENTRIES: Array<{ file: string; intro: string; bare: string }> = [
  {
    file: 'src/pages/NovelList.vue',
    intro: 'navigate(`/novel/${id}/intro`)',
    bare: 'navigate(`/novel/${id}`)',
  },
  {
    file: 'src/pages/Bookmarks.vue',
    intro: 'navigate(`/novel/${id}/intro`)',
    bare: 'navigate(`/novel/${id}`)',
  },
  {
    file: 'src/pages/UserHome.vue',
    intro: 'navigate(`/novel/${id}/intro`)',
    bare: 'navigate(`/novel/${id}`)',
  },
  {
    file: 'src/pages/Watchlist.vue',
    intro: 'navigate(`/novel/${item.latest_content_id}/intro`)',
    bare: 'navigate(`/novel/${item.latest_content_id}`)',
  },
  {
    file: 'src/pages/Recommended.vue',
    intro: '${prefix}${item.id}${item.kind === \'illust\' ? \'\' : \'/intro\'}',
    bare: '${prefix}${item.id}`',
  },
  {
    file: 'src/components/SearchSheet.vue',
    intro: '/novel/${row.entity.id}/intro',
    bare: 'navigate(row.type === \'novel\' ? `/novel/${row.entity.id}` :',
  },
]

describe('六入口三段式改道（小说 → /novel/:id/intro，票 #588）', () => {
  for (const entry of ENTRIES) {
    it(`${entry.file}：小说导航进介绍页，无直达正文回退`, () => {
      const source = readFileSync(resolve(pkgRoot, entry.file), 'utf-8')
      expect(source).toContain(entry.intro)
      expect(source).not.toContain(entry.bare)
    })
  }

  it('介绍页路由保留（/novel/:id 不做路由级重定向，票 #576 benchNav/测试通道约束）', () => {
    const router = readFileSync(resolve(pkgRoot, 'src/router.ts'), 'utf-8')
    expect(router).toContain("path: '/novel/:id/intro'")
    expect(router).toContain("path: '/novel/:id',")
    expect(router).not.toContain("redirect: '/novel/:id/intro'")
  })
})
