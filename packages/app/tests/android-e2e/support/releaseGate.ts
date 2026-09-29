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
 *
 * ⚠️ 「求和 > 0」太弱（R3 判过就能替 R1 背书）、「逐行 AND」太强（把内容形态导致的
 * 合法 skip 报成产品回归 ⇒ 随机红的发版门）。逐行分类 + 三态是唯一同时满足
 * 「不放过 `return` 回潮」与「不因内容形态随机红」的形态。
 */

/** 一行内容断言的判定台账：`judged` = 真判过几次；`skipped` = 显式声明不可判定几次。 */
export interface OutcomeCounts {
  judged: number;
  skipped: number;
}

/** 台账行：`[可读名, 计数]`。可读名进判红文案，读者据此定位到具体断言。 */
export type OutcomeRow = readonly [label: string, counts: OutcomeCounts];

/** 三态分类结果。 */
export interface GateClassification {
  /** 既没判定也没声明的行名 —— **非空即判红**。 */
  silent: string[];
  /** 本轮没有判定过的行名（含显式 skip）—— 非空即 warn「本轮未验证」。 */
  unverified: string[];
}

/**
 * 把台账分类为「判红名单」与「未验证名单」。
 *
 * 纯函数、无 IO、不依赖 vitest —— 可在 `tests/android-e2e/unit/` 里被
 * `pnpm test` → `test:all` → CI 直接跑到（不碰 adb / 模拟器）。
 */
export function classifyOutcomeRows(rows: readonly OutcomeRow[]): GateClassification {
  return {
    silent: rows.filter(([, o]) => o.judged === 0 && o.skipped === 0).map(([name]) => name),
    unverified: rows.filter(([, o]) => o.judged === 0).map(([name]) => name),
  };
}

/**
 * 判红消息：`judged === 0 && skipped === 0` 时它是读者**唯一**能看到的诊断物
 * （台账对象不出现在 vitest 输出里）。
 *
 * ⚠️ **必须并列两类成因，不替读者猜是哪种**。单因归错（「只可能是 return 回潮」）
 * 会把「该 test 本轮没跑」这条同样停在双 0 的路径导向错误的修法——
 * 本仓实测过：文案写单因时，读者会去改根本没错的 skip 分支。
 * 防线见 `unit/releaseGate.test.ts`「判红文案」组。
 */
export function buildGateFailureMessage(
  rows: readonly OutcomeRow[],
  silent: readonly string[],
): string {
  const ledger = rows
    .map(([name, o]) => `${name} judged=${o.judged}/skipped=${o.skipped}`)
    .join("；");
  return (
    `发版门内容断言既未判定、也未声明不可判定：${silent.join(" + ")}。` +
    `两种成因，**报错文案不替你猜是哪种**（务必按序自查）：` +
    `① 该行被写回 return —— 不可判定分支直接返回，vitest 记 passed 且日志宣称已验证，` +
    `实际什么都没验到（「什么都没验到」≠「通过」）；` +
    `② 该行所属 test 本轮**根本没跑** —— 台账停在 0/0，但与 ① 的成因和修法完全不同` +
    `（子因：-t 只滤掉本 test / beforeAll 失败 / 前面断言抛错 / 超时）。` +
    `修法：① 改用 t.skip() 显式声明不可判定并写明原因；② 跑全量（不带 -t）、` +
    `并先看 vitest 结果的 passed/skipped 计数与 beforeAll 报错，再谈代码回潮。` +
    `本轮台账：${ledger}。` +
    `取证：test-results/android-e2e/transition-matrix/ 下各 r1-*/r3-* 帧 + logcat。`
  );
}

/**
 * 「本轮未验证」warn：`judged === 0` 的行（含显式 skip）点名报出。
 * 全都判定过时返回 `undefined` —— 调用方据此不打印，避免无内容时刷屏。
 */
export function buildUnverifiedWarning(rows: readonly OutcomeRow[]): string | undefined {
  const unverified = classifyOutcomeRows(rows).unverified;
  if (unverified.length === 0) return undefined;
  return (
    `[transition-matrix] ⚠️ 本轮发版门**未验证**：${unverified.join(" + ")}` +
    `（内容形态导致采样窗取不到被测对象，已显式 skip 并记为 skipped 而非 passed）。` +
    `该 test 在 vitest 结果里显示为 skipped；不判红是刻意取舍——` +
    `按「内容形态不可判定」判红只会得到随机红的发版门。留证与挂账见 #819。`
  );
}

/** `runReleaseGate` 的依赖注入——全部为回调，故本模块不 import vitest，可纯函数单测。 */
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
  const { silent } = classifyOutcomeRows(deps.rows);
  if (silent.length > 0) {
    deps.fail(silent, buildGateFailureMessage(deps.rows, silent));
  }
  const warning = buildUnverifiedWarning(deps.rows);
  if (warning !== undefined) deps.warn(warning);
}
