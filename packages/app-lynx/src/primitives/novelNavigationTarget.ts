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

/**
 * 介绍页主 CTA 的动作（ADR-0219 §2.4 末段 / 票 #928 AC #6）：
 * `'start'` = 「开始阅读」，`'continue'` = 「继续阅读」。
 *
 * 📌 **判定依据只是「有无位置」这一个布尔**：续读条目按 `novelId` 记，而
 *   位置语义是**会话末**（ADR-0219 §2.2）——记录的 `novelId` **就是**上次读到的那话，
 *   所以落点（`/novel/:id`）两个分支**完全相同**，差的只是这行文案。
 *   不需要「记录话序号再让正文页跳过去」那套：那是把同一件事做两遍。
 *
 * ⚠️ **单按钮形态不变**（票 #734 定的「次级行 + 主 CTA 行」布局不动），
 *   本函数只选文案，不引入第二颗按钮或新的视觉层级。
 *
 * 完成后重开**仍为 `'continue'`**：完成是软删、位置照常更新（ADR-0219 §2.3），
 * 条目仍在存储里 ⇒ 「有位置」为真。调用侧传的是「该作品有无条目」，
 * 而非「该作品是否未完成」。
 */
export type IntroReadAction = 'start' | 'continue'

/** 纯判定：有位置 → 继续读，无位置 → 从头开始。 */
export function decideIntroReadAction(hasPosition: boolean): IntroReadAction {
  return hasPosition === true ? 'continue' : 'start'
}
