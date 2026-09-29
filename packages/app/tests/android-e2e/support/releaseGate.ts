/**
 * 发版门**外层三态门**的纯函数部分（issue #819 第 8 项）。
 *
 * ## 为什么要从 spec 里抽出来
 *
 * 这道门的判定语义与判红文案此前只存在于 `transition-matrix.spec.ts` 的 `afterAll` 里，
 * 没有断言钉住 ⇒ 任何一次「为了跑通而改文案 / 改判定」都不会变红（ADR-0097：
 * 翻转必须配机器防线，无防线 = 审计不完备）。抽出成纯函数后，语义与文案都进单测。
 *
 * ## 判定语义（三态，**逐格对齐 spec** `docs/specs/qa-defense-lines.md` 的三态表）
 *
 * | 台账 | 外层门 |
 * |---|---|
 * | `judged > 0` | 正常判红（断言不通过时） |
 * | `judged = 0, skipped > 0` | **不判红**，但 warn 高亮「本轮未验证」 |
 * | `judged = 0, skipped = 0` | **判红** |
 * | `0 < judged < expected`（一行内**部分**子判定未覆盖） | **不判红**，但 warn 高亮「本轮未验证」 |
 *
 * ⚠️ 「求和 > 0」太弱（R3 判过就能替 R1 背书）、「逐行 AND」太强（把内容形态导致的
 * 合法 skip 报成产品回归 ⇒ 随机红的发版门）。逐行分类 + 三态是唯一同时满足
 * 「不放过 `return` 回潮」与「不因内容形态随机红」的形态。
 */

/**
 * 一行内容断言的判定台账：`judged` = 真判过几次；`skipped` = 显式声明不可判定几次。
 *
 * ⚠️ `expected` 是**覆盖率**维度（#819 第 11 轮 review 补）：一行内容断言内部可能
 * 含**多次**子判定（如 R3「三帧两两不同」= 3 对），只记 `judged === 0` 会让
 * 「1 对判过 + 2 对采样窗无内容」这种**部分验证**既不判红也不 warn ⇒ 门完全静默，
 * 而该行对外承诺的是「两两不同」（3 对）。补 `expected` 后，部分覆盖落进 `unverified`
 * （warn「本轮未验证」），**不判红**——与三态表同源：内容形态导致的覆盖不足不是产品回归。
 */
export interface OutcomeCounts {
  judged: number;
  skipped: number;
  /**
   * 本行应给出的判定总数（子判定个数）。`undefined` = 不做覆盖率判定（单次判定行）。
   *
   * ⚠️ **不变量**（review 第 12 轮实测枚举 8 种组合后记录）：必须是**有限正整数**。
   * 两种越界形态当前**生产不可达**（赋值点与 `judged` 累加相邻、无 `await`，
   * `frames.length` 恒 3），但若将来成立会**恒静默**：`NaN` 满足 `judged < NaN` 为
   * false；`expected = 0` 配 `judged > 0` 也不触发 `judged === 0`。接线契约
   * `transitionMatrixWiring.test.ts` 已按「求值 RHS」钉住公式，故此处不再加运行时守卫。
   */
  expected?: number;
}

/** 台账行：`[可读名, 计数]`。可读名进判红文案，读者据此定位到具体断言。 */
export type OutcomeRow = readonly [label: string, counts: OutcomeCounts];

/** 三态分类结果。 */
export interface GateClassification {
  /** 既没判定也没声明的行名 —— **非空即判红**。 */
  silent: string[];
  /** 本轮**未完整验证**的行名（非空即 warn）。含两类：`judged === 0`，以及覆盖率不足。 */
  unverified: string[];
}

/**
 * 把台账分类为「判红名单」与「未验证名单」。
 *
 * 纯函数、无 IO、不依赖 vitest —— 可在 `tests/android-e2e/unit/` 里被
 * `pnpm test` → `test:all` → CI 直接跑到（不碰 adb / 模拟器）。
 *
 * ⚠️ 「未验证」的判据是 `judged === 0` **或覆盖率不足**（`judged < expected`）：
 * 只看 `judged === 0` 会漏掉「一行含多次子判定、只判过一部分」——那种情况既不判红
 * 也不 warn，门静默，而行名对外承诺的是全量。⚠️ 但覆盖率不足**只 warn 不判红**：
 * 判红它就是随机红的发版门（内容形态决定覆盖率），与三态表同源纪律。
 */
export function classifyOutcomeRows(rows: readonly OutcomeRow[]): GateClassification {
  return {
    silent: rows.filter(([, o]) => o.judged === 0 && o.skipped === 0).map(([name]) => name),
    unverified: rows
      .filter(([, o]) => o.judged === 0 || (o.expected !== undefined && o.judged < o.expected))
      .map(([name]) => name),
  };
}

/**
 * 判红消息：`judged === 0 && skipped === 0` 时它是读者**唯一**能看到的诊断物
 * （台账对象不出现在 vitest 输出里）。
 *
 * ⚠️ **必须并列三类成因，不替读者猜是哪种**。单因归错（「只可能是 return 回潮」）
 * 会把「该 test 本轮没跑」这条同样停在双 0 的路径导向错误的修法——
 * 本仓实测过：文案写单因时，读者会去改根本没错的 skip 分支。
 * 防线见 `unit/releaseGate.test.ts`「判红文案」组（三类各有一条断言）。
 */
export function buildGateFailureMessage(
  rows: readonly OutcomeRow[],
  classification: GateClassification,
): string {
  const ledger = rows
    .map(([name, o]) => `${name} judged=${o.judged}/skipped=${o.skipped}`)
    .join("；");
  return (
    `发版门内容断言既未判定、也未声明不可判定：${classification.silent.join(" + ")}。` +
    `两种成因，**报错文案不替你猜是哪种**（务必按序自查）：` +
    `① 该行被写回 return —— 不可判定分支直接返回，vitest 记 passed 且日志宣称已验证，` +
    `实际什么都没验到（「什么都没验到」≠「通过」）；` +
    `② 该行所属 test 本轮**根本没跑** —— 台账停在 0/0，但与 ① 的成因和修法完全不同` +
    `（子因：-t 只滤掉本 test / beforeAll 失败 / 前面断言抛错 / 超时）。` +
    `③ **该行自己的内容断言真失败** —— 台账写入点在所有 expect **之后**，故这一行自己的` +
    `expect 抛错同样留下 0/0。它**不是**「前面断言抛错」（② 的措辞会把你引去查 beforeAll，` +
    `而真因在本行）。判红本身是对的，错的是诊断指向——先看是哪一行的哪条 expect 红了。` +
    `修法：① 改用 t.skip() 显式声明不可判定并写明原因；② 跑全量（不带 -t）、` +
    `并先看 vitest 结果的 passed/skipped 计数与 beforeAll 报错；③ 修那条 expect 指向的产品缺陷，` +
    `再谈代码回潮。` +
    `本轮台账：${ledger}。` +
    `取证：test-results/android-e2e/transition-matrix/ 下有各 r1-*/r3-* 帧；` +
    `⚠️ 该目录**只落帧、logcat 不落盘**（spec 全程只在内存里轮询 logcat），` +
    `logcat 需现取 \`adb -s <serial> logcat -d\`，但**环形 buffer 会滚**（main ring 2 MiB、` +
    `实测可读常只剩 200 KiB 量级，而 Lynx 有 ~60fps 逐帧日志），判红后要尽快取，否则可能已被挤掉。`
  );
}

/**
 * 「本轮未验证」warn：`judged === 0` 的行点名报出。
 * 全都判定过时返回 `undefined` —— 调用方据此不打印，避免无内容时刷屏。
 *
 * ⚠️ 参数吃的是**已算好的分类**，不是 rows：让文案自己再推导一次，会留下
 * 「分类与文案各说各话」的缝（判红时消息里点的行名与实际判红名单不一致），
 * 也让同一份台账被 filter 两遍。
 */
export function buildUnverifiedWarning(classification: GateClassification): string | undefined {
  const { unverified } = classification;
  if (unverified.length === 0) return undefined;
  return (
    `[transition-matrix] ⚠️ 本轮发版门**未验证**：${unverified.join(" + ")}` +
    `（两种成因：① 该行被显式 \`t.skip()\` 声明不可判定（vitest 记 skipped）；` +
    `② 该行含多次子判定、本轮**只覆盖了一部分**（test 跑完并通过，skipped 计数对它贡献 0）。` +
    `⚠️ 两者的共同点是「**没验全 ≠ 通过**」：读 vitest 结果时不能只看 skipped 计数——` +
    `成因 ② 在那个计数器上是 0。不判红是刻意取舍：按「内容形态不可判定」判红只会得到` +
    `随机红的发版门。留证与挂账见 #819。`
  );
}

/**
 * `runReleaseGate` 的依赖注入。**不含 vitest**，故本模块可被纯函数单测直接调用
 * （`tests/android-e2e/unit/releaseGate.test.ts`，随 `pnpm test` → CI 执行）。
 *
 * 6 个字段：4 个是调用方注入的**回调**（teardown / forceStop / warn / fail），
 * 2 个是**数据**（serial / rows）——不是「全部为回调」。
 */
export interface ReleaseGateDeps {
  /** 设备/会话收尾。抛错被吞（收尾失败不阻断判定）。 */
  teardown: () => Promise<unknown>;
  /** 按 serial 杀进程。`serial` 为空时**不调用**（adb 会拿到非法 serial）。 */
  forceStop: (serial: string) => void;
  /** `beforeAll` 赋值的设备序列号；未赋值时为 `""`（含 beforeAll 早期失败的情形）。 */
  serial: string;
  /** 本轮内容断言台账。 */
  rows: readonly OutcomeRow[];
  /** 「本轮未验证」提示。 */
  warn: (message: string) => void;
  /** 判红。**应抛则抛**（调用方传 `expect(...).toEqual([])`）。 */
  fail: (silent: readonly string[], message: string) => void;
}

/**
 * 收尾后**无条件**执行外层三态门。
 *
 * ## 为什么必须是无条件（code-review Spec 轴阻塞项，实测证伪）
 *
 * 历史形态是 `try { if (!serial) return; forceStopApp(serial); } catch {}` 后接外层门。
 * 而 `serial` 初值 `""`，且 `beforeAll` 的前三步（token 断言 / 深链钩子断言 /
 * `setupAndroidE2e`）任一失败时都还没赋值 ⇒ 那句 early return 让**外层门整段不执行**：
 * 不判红、不 warn、无门结论。偏偏这三步覆盖了最常见也最贵的失败路径。
 * vitest 的 `afterAll runs even if beforeAll ... fail` 只保证 afterAll **被调用**，
 * 不保证 afterAll **里的门被执行**——文档曾把这两步当成一步。
 *
 * 现在把「收尾」与「判定」拆开：收尾的错误与空 serial 只影响收尾本身，
 * 判定永远执行。这让「门被 early return 吞掉」在结构上不可 reintroduce。
 */
export async function runReleaseGate(deps: ReleaseGateDeps): Promise<void> {
  await deps.teardown().catch(() => {});
  try {
    if (deps.serial) deps.forceStop(deps.serial);
  } catch {
    // 收尾失败不阻断判定
  }
  // 只分类一次，两处文案共用同一份结果（避免「判红名单」与「消息里点的行名」分叉）
  const classification = classifyOutcomeRows(deps.rows);
  if (classification.silent.length > 0) {
    deps.fail(classification.silent, buildGateFailureMessage(deps.rows, classification));
  }
  // ⚠️ fail 在生产里会抛（expect），抛了就不会走到这里 —— 判红优先于 warn。
  // 这条顺序在生产与测试替身里**不一致**（替身只记录不抛），已单独用一条用例钉住。
  const warning = buildUnverifiedWarning(classification);
  if (warning !== undefined) deps.warn(warning);
}
