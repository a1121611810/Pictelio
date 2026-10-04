// ─── 小说导航目的地判定（纯逻辑，无 IO 无 Pinia）[ADR-0219 §2.4 / 票 #926] ───
// 「这次导航该不该经介绍页」的**唯一事实源**。抽成纯模块有两个原因：
//   ① 可在 node 下直测真语义——`utils/novelNavigation.ts` 是 IO 壳（import router →
//      拉进整条 app 链，含构建期注入的 `__PUBLIC_CONFIG__`），其内联逻辑测不了；
//   ② 「续读无视开关」是**契约**，必须有一处可被单测钉住的实现，而不是散在调用点。
//
// 与 IO 壳的分工：这里只判「落哪」，不碰 navigate / store；壳负责读设置 + 拼串。
// 术语与红线见 docs/adr/glossary-lynx-continue-reading.md。

/** 导航目的地：`'intro'` = 介绍页（`/novel/:id/intro`），`'body'` = 正文（`/novel/:id`） */
export type NovelTarget = 'intro' | 'body'

/** 判定输入 */
export interface NovelTargetInput {
  /** 设置 `novelIntroFirst`（设备级，默认开）：开 = 介绍页先行 */
  novelIntroFirst: boolean
  /**
   * 续读召回（ADR-0219 §2.4）：true 时**无论开关如何都进正文**——
   * 用户意图是「回到我读的位置」，不是「重新考虑要不要读」，先看一遍简介是纯摩擦。
   * 仅续读列表点行使用；其余入口不传（计数会随入口增删漂移，故不写死数字）。
   */
  resume?: boolean
}

/** 纯判定：resume 优先于开关，其次看开关。 */
export function decideNovelTarget(input: NovelTargetInput): NovelTarget {
  return input.resume === true || !input.novelIntroFirst ? 'body' : 'intro'
}
