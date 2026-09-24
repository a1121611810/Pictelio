// ─── 小说导航单点缝隙（ADR-0183 / spec #711 / 票 #713）───
// 六个小说入口（小说列表 / 收藏 / 用户主页 / 追更 / 推荐轮播 / 搜索弹层）的小说分支
// 统一经 openNovel() 跳转；本文件是全仓唯一合法持有 `/intro` 导航串的居所——
// 入口页禁止内联拼接介绍页导航串（源级守卫 tests/novelIntroEntryGuards.test.ts 钉住）。
//
// 开关语义（settingsStore.novelIntroFirst，设备级，默认开）：
//   开 = 介绍页先行 `/novel/:id/intro`（ADR-0167 三段式现状，升级零感知）；
//   关 = 直达正文 `/novel/:id`。
// 路由层零改动（ADR-0183 D3）：/novel/:id 与 /novel/:id/intro 共存、无路由级 redirect。
import { navigate } from '../router'
import { useSettingsStore } from '../stores/settingsStore'

/** 按介绍页开关跳转小说：开 = 先进介绍页，关 = 直达正文 */
export function openNovel(id: number | string): void {
  // useSettingsStore 必须在调用时（而非模块加载时）执行：模块加载期 Pinia 尚未 active
  const novelIntroFirst = useSettingsStore().novelIntroFirst
  void navigate(novelIntroFirst ? `/novel/${id}/intro` : `/novel/${id}`)
}
