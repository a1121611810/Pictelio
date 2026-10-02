// ─── 首页顶栏构建开关的极性（唯一事实源）───
//
// 票 #906 / #907。产品裁定 2026-10-02：首页沉浸悬浮顶栏**缺省开启**。
//
// 为什么极性值得一个文件 + 一道门禁：它原本直接内联在 `lynx.config.ts` 的
// define 里，而两套 vitest 配置各自硬编码 `'true'` / `'false'`，从不读它。
// 结果是**零机器防线** —— 把极性改回 `=== '1'`，CI 全绿，而发布出去的 APK
// 静默回到旧 64dp 顶栏。（code-review 第 4 轮 B2，判定为阻塞项。）
//
// 现在 `lynx.config.ts` 与 `tests/homeBleedHeaderFlag.test.ts` import 同一个函数：
// 极性翻反 ⇒ 真值表当场转红 ⇒ 生产侧不可能各走各的。
//
// 本文件**必须**保持无依赖纯函数：一旦它反过来 import `lynx.config.ts`，
// 后者 import 它就成环，配置加载会在构建期直接炸（该约束有门禁，见同名测试）。
//
// 「关掉需要显式动作」这条规则的推论 = **只有精确的 `'0'` 会关闭开关**。
// `PICTELIO_HOME_BLEED=false` / `=no` / `= 0` 都不关（真值表逐条钉住）。
// 这最反直觉，所以写在这里而不是只写在 ADR 里。
//
// ⚠️ 发布风险登记：极性翻成缺省开启后，**CI / 发布环境里若残留
// `PICTELIO_HOME_BLEED=0`（本分支缺省关闭期的遗留值），发布构建会静默交付旧顶栏。**
// 排障时第一件事是查这个变量，而不是查代码。

/** 构建期注入首页顶栏形态的环境变量名。 */
export const HOME_BLEED_ENV_KEY = 'PICTELIO_HOME_BLEED'

/**
 * 解析 `PICTELIO_HOME_BLEED` 的**原始值**（不是 `process.env` 本身）→ 是否启用新顶栏。
 *
 * 刻意收 `value` 而不是收 `env` 对象：这样真值表能用字面量逐条钉住行为，
 * 而不必在测试里伪造 `process.env`（改全局对象是测试间互相污染的经典来源）。
 *
 * @param value `process.env[HOME_BLEED_ENV_KEY]` 的原始值，可能为 `undefined`。
 * @returns `true` = 首页走沉浸悬浮顶栏（缺省）；`false` = 走旧 64dp 顶栏。
 */
export function resolveHomeBleedHeaderFlag(value: string | undefined | null): boolean {
  return value !== '0'
}
