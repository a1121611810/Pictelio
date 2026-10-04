// ─── 小说导航单点缝隙（ADR-0183 / spec #711 / 票 #713）───
// 六个小说入口（小说列表 / 收藏 / 用户主页 / 追更 / 推荐轮播 / 搜索弹层）的小说分支
// 统一经 openNovel() 跳转；本文件是全仓唯一合法持有 `/intro` 导航串的居所——
// 入口页禁止内联拼接介绍页导航串（源级守卫 tests/novelIntroEntryGuards.test.ts 钉住）。
//
// 开关语义（settingsStore.novelIntroFirst，设备级，默认开）：
//   开 = 介绍页先行 `/novel/:id/intro`（ADR-0167 三段式现状，升级零感知）；
//   关 = 直达正文 `/novel/:id`。
// 路由层零改动（ADR-0183 D3）：/novel/:id 与 /novel/:id/intro 共存、无路由级 redirect。
//
// 📌 **续读入口**（ADR-0219 §2.4 / 票 #926）：段 3「继续读」的点行经 `resume: true` 进入，
//   **无视介绍页开关直达正文**——用户意图是「回到我读的位置」，不是「重新考虑要不要读」，
//   让他先看一遍简介是纯摩擦。
//   实现方式是**扩展本缝隙**（把「这次要不要经介绍页」留成缝隙内部的一个显式决策），
//   而不是在第七个入口旁新开 `navigate('/novel/:id')` 捷径——后者会让
//   tests/novelIntroEntryGuards.test.ts 的源级守卫转红。
import { navigate } from '../router'
import { useSettingsStore } from '../stores/settingsStore'
// 纯判定在 primitives（无 IO，可直测）——本文件只做「读设置 + 拼串 + 导航」的壳
import { decideNovelTarget } from '../primitives/novelNavigationTarget'

/** 小说导航意图 */
export interface OpenNovelOptions {
  /**
   * 续读召回（ADR-0219 §2.4）：true 时**无论 `novelIntroFirst` 如何都进正文**。
   * 仅续读列表点行使用；其余入口不传（计数会随入口增删漂移，故不写死数字）。
   */
  resume?: boolean
}

/** 按介绍页开关跳转小说：开 = 先进介绍页，关 = 直达正文；resume = 无视开关直达正文 */
export function openNovel(id: number | string, opts?: OpenNovelOptions): void {
  // useSettingsStore 必须在调用时（而非模块加载时）执行：模块加载期 Pinia 尚未 active
  const novelIntroFirst = useSettingsStore().novelIntroFirst
  const target = decideNovelTarget({ novelIntroFirst, resume: opts?.resume })
  void navigate(target === 'intro' ? `/novel/${id}/intro` : `/novel/${id}`)
}
