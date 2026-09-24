// ─── 小说导航缝隙源级守卫（spec #711 / ADR-0183 / 票 #713；仓库「模板/源码断言」约定）───
// 背景：ADR-0183 把小说导航从固定三段式（ADR-0167）升级为双态——settingsStore.novelIntroFirst
// 开关（默认开 = 介绍页先行），六入口小说分支统一改经 utils/novelNavigation.ts 的
// openNovel() 单点缝隙。本文件逐入口钉住：
//   ① 源码必须经缝隙调用（含 `openNovel(`）；
//   ② `/intro` 字面量不得回流入口内联（该导航串全仓唯一合法居所 = 缝隙模块自身）。
// 另钉缝隙模块双态自钉（介绍页与裸正文两个模板串同时存在）与路由共存量（D3 零改动）。
// oracle：ADR-0183 D2（单点缝隙）/ D3（路由层零改动），出处 docs/adr/ADR-0183-lynx-novel-intro-toggle.md。
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 本文件位于 <pkg>/tests/，包根 = 上一级
const pkgRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const ENTRIES: Array<{ file: string }> = [
  { file: 'src/pages/NovelList.vue' },
  { file: 'src/pages/Bookmarks.vue' },
  { file: 'src/pages/UserHome.vue' },
  { file: 'src/pages/Watchlist.vue' },
  { file: 'src/pages/Recommended.vue' },
  { file: 'src/components/SearchSheet.vue' },
]

describe('六入口小说导航缝隙（openNovel 单点，ADR-0183 / 票 #713）', () => {
  for (const entry of ENTRIES) {
    it(`${entry.file}：小说分支经 openNovel 缝隙导航，/intro 导航串不回流内联`, () => {
      const source = readFileSync(resolve(pkgRoot, entry.file), 'utf-8')
      expect(source).toContain('openNovel(')
      expect(source).not.toContain('/intro')
    })
  }

  it('缝隙模块双态自钉（介绍页与裸正文两个导航模板串同时存在，ADR-0183 D2）', () => {
    const source = readFileSync(resolve(pkgRoot, 'src/utils/novelNavigation.ts'), 'utf-8')
    expect(source).toContain('`/novel/${id}/intro`')
    expect(source).toContain('`/novel/${id}`')
  })

  it('介绍页路由保留（/novel/:id 不做路由级重定向，票 #576 benchNav/测试通道约束）', () => {
    const router = readFileSync(resolve(pkgRoot, 'src/router.ts'), 'utf-8')
    expect(router).toContain("path: '/novel/:id/intro'")
    expect(router).toContain("path: '/novel/:id',")
    expect(router).not.toContain("redirect: '/novel/:id/intro'")
  })
})
