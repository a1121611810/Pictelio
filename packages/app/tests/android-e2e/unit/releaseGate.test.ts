/**
 * 发版门**外层三态门**的纯函数防线（issue #819 第 8 项）。
 *
 * ## 为什么需要它（ADR-0097 判据：翻转必须配机器防线）
 *
 * 这道门堵的是「不可判定分支被写回 `return` ⇒ vitest 记 passed 而实际什么都没验到」。
 * 但门本身此前**没有任何机器防线**：
 *   · `grep -rln "transition-matrix|@release-gate" packages/app/tests/unit packages/app/src` → 空；
 *   · `expect` 的判红消息文本、warn 文案、三态判定语义，**全仓无断言钉住**；
 *   · 「反事实检验」只是一次性人工实测（结果记在 issue #819 正文），无重跑入口。
 * 后果实测过：本仓出现过「订正文案从未进入任何提交（被文件还原静默回退）」而
 * 无人察觉——因为没有任何断言会在文案退化时变红。
 *
 * ## 为什么期望值不是从实现反推（测试硬约束 #4 / #6 oracle 溯源）
 *
 * 下面的真值表**逐格抄自 spec**：`docs/specs/qa-defense-lines.md` 的
 * 「内容断言的「不可判定」口径」表（**四行** → 各自的「外层门」列），而非跑一遍
 * `classifyOutcomeRows` 把输出当快照：
 *   ① `judged > 0`                ② `judged = 0, skipped > 0`
 *   ③ `judged = 0, skipped = 0`   ④ `0 < judged < expected`（覆盖率不足，第 11 轮补）
 *
 * ⚠️ 「抄」本身**不构成机器防线**——本文件早前那句「改动 spec 而不改本测试都会立刻红」
 * 是假的：它当时只在注释里提到那份 .md，从不读它（故那句 grep 当时全是注释文本命中；
 * ⚠️ 自本组加入后该证据已失效，改 spec 的读点现在**真的存在**——就是下面那个
 * `readFileSync`）。故补了「spec 一致性」组的 doc-parity 断言：真去读那份 .md、
 * 抽出四格的判定词，再与 `classifyOutcomeRows` 的**实际行为**对照。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildGateFailureMessage,
  buildUnverifiedWarning,
  classifyOutcomeRows,
  runReleaseGate,
  type OutcomeRow,
} from "../support/releaseGate";

const testDir = path.dirname(fileURLToPath(import.meta.url));
/** 仓根 = unit → android-e2e → tests → app → packages → 仓根，共 5 级。 */
const SPEC_MD_PATH = path.resolve(testDir, "../../../../../docs/specs/qa-defense-lines.md");
const specMd = readFileSync(SPEC_MD_PATH, "utf8");
/** 实现侧的同款表（`releaseGate.ts` 头注释）——两份表可各自漂移，必须同源核对。 */
const GATE_SRC_PATH = path.resolve(testDir, "../support/releaseGate.ts");
const gateSrc = readFileSync(GATE_SRC_PATH, "utf8");

/**
 * 台账行：[可读名, 计数]。名字取自 spec 里两行内容断言的原文。
 * 第 4 参 `expected` = 本行应有的子判定总数（覆盖率维度，缺省不做覆盖率判定）。
 */
const row = (label: string, judged: number, skipped: number, expected?: number): OutcomeRow => [
  label,
  expected === undefined ? { judged, skipped } : { judged, skipped, expected },
];

describe("发版门外层三态门 · 台账分类", () => {
  it("judged > 0：既不判红、也不算未验证（行真跑了并给出判定）", () => {
    // 依据：qa-defense-lines 三态表第 1 行「正常判红（断言不通过时）」
    const r = classifyOutcomeRows([
      row("R1 断言③ 锚点卡下方区域帧差 > INJECT_TH（代理「相关作品」段注入）", 1, 0),
    ]);
    expect(r.silent).toEqual([]);
    expect(r.unverified).toEqual([]);
  });

  it("judged = 0, skipped > 0：显式声明不可判定 ⇒ 不判红，但算未验证", () => {
    // 依据：qa-defense-lines 三态表第 2 行「**不判红**，但 console.warn 高亮「本轮未验证」」
    const r = classifyOutcomeRows([row("R3「收藏行」两两不同", 0, 1)]);
    expect(r.silent).toEqual([]);
    expect(r.unverified).toEqual(["R3「收藏行」两两不同"]);
  });

  it("judged = 0, skipped = 0：既没判定也没声明 ⇒ 判红", () => {
    // 依据：qa-defense-lines 三态表第 3 行「**判红**」
    const r = classifyOutcomeRows([
      row("R1 断言③ 锚点卡下方区域帧差 > INJECT_TH（代理「相关作品」段注入）", 0, 0),
    ]);
    expect(r.silent).toEqual(["R1 断言③ 锚点卡下方区域帧差 > INJECT_TH（代理「相关作品」段注入）"]);
    // ⚠️ 这条**不是**抄自三态表第 3 行（那里只写「判红」），而是由 warn 的筛选条件
    // `judged === 0` 推出：双 0 必然满足 judged === 0 ⇒ 也进 warn 名单。
    // 生产里这条**观察不到**——`fail` 先抛，warn 根本走不到；单测替身不抛才看得见。
    // 顺序本身另有一条用例钉住（见「收尾与执行顺序」组）。
    expect(r.unverified).toEqual([
      "R1 断言③ 锚点卡下方区域帧差 > INJECT_TH（代理「相关作品」段注入）",
    ]);
  });

  it("逐行判定：R3 判过不能替 R1 背书（这正是首版「求和 > 0」被弃用的理由）", () => {
    // 反事实对照：首版外层门是 `r1Injected + r3BookmarkPairs > 0`，此状态下首版会绿。
    const r = classifyOutcomeRows([row("R1", 0, 0), row("R3", 3, 0)]);
    expect(r.silent).toEqual(["R1"]);
    expect(r.unverified).toEqual(["R1"]);
  });

  it("⚠️ 覆盖率不足（0 < judged < expected）必须落进未验证，而**不是**静默", () => {
    // #819 第 11 轮 review 的阻塞项：R3「三帧两两不同」= 3 对，采样窗可能只让
    // 1 对可判定、另 2 对被 `continue` 吞掉且**不写台账**。只看 `judged === 0` 时
    // 这种「1/3 覆盖」既不判红也不 warn ⇒ 门完全静默，而行名承诺的是「两两不同」。
    const r = classifyOutcomeRows([row("R3", 1, 0, 3)]);
    expect(r.silent, "部分覆盖不判红（内容形态决定覆盖率，判红即随机红）").toEqual([]);
    expect(r.unverified, "部分覆盖必须算未验证并 warn").toEqual(["R3"]);
  });

  it("覆盖率足额（judged >= expected）不算未验证", () => {
    expect(classifyOutcomeRows([row("R3", 3, 0, 3)]).unverified).toEqual([]);
    // 判过量超过 expected 也算足额（防御：台账累加口径变了不至于误 warn）
    expect(classifyOutcomeRows([row("R3", 4, 0, 3)]).unverified).toEqual([]);
  });

  it("expected 缺省 = 不做覆盖率判定（单次判定行的旧行为不变）", () => {
    // R1 断言③ 是单次判定；不给 expected 时 judged=1 不该被 warn
    expect(classifyOutcomeRows([row("R1", 1, 0)]).unverified).toEqual([]);
  });

  it("双 0 且带 expected 时仍**判红**（test 没跑那条路径不被覆盖率逻辑吞掉）", () => {
    // 关键：R3 test 本轮没跑时 expected 仍是初值 0，判据 `judged < expected`
    // 为假 ⇒ 落回 `judged === 0 && skipped === 0` 判红，不会被新逻辑放过。
    const r = classifyOutcomeRows([row("R3", 0, 0, 0)]);
    expect(r.silent, "双 0 必须判红").toEqual(["R3"]);
    expect(r.unverified).toEqual(["R3"]);
  });

  it("两行都双 0 时全量报出，不做「报一行就够」的折叠", () => {
    // 读者要一次看到全部缺口，且判红消息要逐行列出台账——折叠会让第二行静默漏掉。
    const r = classifyOutcomeRows([row("R1", 0, 0), row("R3", 0, 0)]);
    expect(r.silent).toEqual(["R1", "R3"]);
  });
});

/**
 * 文案防线。判红消息是 spec 里**唯一**读者能看到的诊断物（台账对象不出现在
 * vitest 输出里），所以它的退化必须有人拦。本仓实测过的退化方式：文案被改成
 * 单因归错（「只可能是 return 回潮」），而**没有任何断言会因此变红**。
 * 依据：`docs/specs/qa-defense-lines.md` 三态表第 3 行「成因有两类」+ issue #819。
 */
describe("发版门外层三态门 · 判红文案", () => {
  const rows: OutcomeRow[] = [
    row("R1 断言③ 锚点卡下方区域帧差 > INJECT_TH（代理「相关作品」段注入）", 0, 0),
    row("R3「收藏行」两两不同", 2, 0),
  ];
  const msg = buildGateFailureMessage(rows, classifyOutcomeRows(rows));

  it("必须并列列出**三类**成因（① return 回潮 / ② test 没跑 / ③ 本行自己的 expect 真失败）", () => {
    expect(msg).toMatch(/①/);
    expect(msg).toMatch(/②/);
    expect(msg).toMatch(/③/);
    expect(msg).toMatch(/return/);
    expect(msg).toMatch(/没跑|根本没跑/);
    // ③ 是 #819 第 12 轮 review 补的：台账写入点在所有 expect 之后 ⇒ 本行断言真失败
    // 同样留下双 0，而 ② 的措辞（「前面断言抛错」）会把你引去查 beforeAll。诊断指向错
    // 与「单因归错」同型，故必须单独点名。
    expect(msg, "必须点名第三类成因：本行自己的内容断言真失败").toMatch(
      /该行自己的内容断言真失败/u,
    );
  });

  it("第 ② 类的**成因子句**自带子因（含 -t 只滤掉本 test），不得只藏在修法里", () => {
    // ⚠️ 只断言整条消息含 "-t" 是**假绿**：修法② 里的「跑全量（不带 -t）」就会让它通过
    // （本条就是这么被自己抓住的）。必须只截 **② 到「修法：」** 这一段成因子句来查。
    //
    // 判红消息是唯一诊断物（台账不在 vitest 输出里）。子因若只出现在修法里，读者会以为
    // ② 只等于 beforeAll 失败 —— 而实际上「-t 只滤掉本 test」同样停在双 0，
    // 是发版前最常见的一种。依据：qa-defense-lines 三态表第 3 行 + spec 行内注释的子因枚举。
    const causeClause = msg.slice(msg.indexOf("②"), msg.indexOf("修法："));
    expect(causeClause).toMatch(/-t/);
    expect(causeClause).toMatch(/beforeAll/);
  });

  it("逐行列出本轮台账，读者不查源码就能自查", () => {
    // 两行都要出现，且带各自计数——判红时台账对象不在 vitest 输出里。
    expect(msg).toMatch(/R1 断言③ 锚点卡下方区域帧差 > INJECT_TH（代理「相关作品」段注入）/);
    expect(msg).toMatch(/judged=0\/skipped=0/);
    expect(msg).toMatch(/R3「收藏行」两两不同/);
    expect(msg).toMatch(/judged=2\/skipped=0/);
  });

  it("取证指引必须说清「目录里只有帧、logcat 要现取」，不得承诺盘上有 logcat", () => {
    // 实测（code-review Spec 轴 S-4）：spec 只把帧 writeFileSync 进 EVIDENCE_DIR，
    // logcat 全程只在内存里轮询、**从不落盘** ⇒ 文案承诺「各 r1-*/r3-* 帧 + logcat」
    // 会让判红的人去那个目录翻一个不存在的文件。
    expect(msg).toMatch(/test-results\/android-e2e\/transition-matrix/);
    expect(msg).toMatch(/logcat 不落盘|只落帧/);
    // 命令带 serial 参数，不能写成 /adb logcat/（那匹配不上 `adb -s <serial> logcat -d`）
    expect(msg).toMatch(/adb[^\n`]*logcat/);
    // 环形 buffer 会滚：实测 main ring 2 MiB、可读仅 200 KiB，而 Lynx 有 ~60fps 逐帧日志。
    // 只说「现取」而不说「可能已滚」，等于把读者引向一个可能扑空的目录。
    expect(msg).toMatch(/滚|已被挤|可能已丢/);
  });

  it("两行都双 0 时，缺口的**全部**行名都进消息", () => {
    const bothZero: OutcomeRow[] = [row("R1", 0, 0), row("R3", 0, 0)];
    const m = buildGateFailureMessage(bothZero, classifyOutcomeRows(bothZero));
    expect(m).toMatch(/R1/);
    expect(m).toMatch(/R3/);
  });
});

describe("发版门外层三态门 · 未验证 warn 文案", () => {
  it("本轮全部判定过 ⇒ 不产生 warn（返回 undefined）", () => {
    const allJudged = [row("R1", 1, 0), row("R3", 2, 0)];
    expect(buildUnverifiedWarning(classifyOutcomeRows(allJudged))).toBeUndefined();
  });

  it("显式 skip 的行 ⇒ warn 点名该行并说明「不判红是刻意取舍」", () => {
    const w = buildUnverifiedWarning(classifyOutcomeRows([row("R1", 1, 0), row("R3", 0, 1)]));
    expect(w).toBeDefined();
    expect(w).toMatch(/R3/);
    expect(w).toMatch(/未验证/);
    // 读者容易把「未验证」误读成失败，必须说明这是刻意取舍而非回归
    expect(w).toMatch(/刻意取舍/);
  });
});

/**
 * 执行顺序防线（本轮 code-review Spec 轴阻塞项实测发现）。
 *
 * ## 被拦住的真实回归
 *
 * 原 `afterAll` 的第一版形态是：
 *
 *     await ctx?.teardown().catch(() => {});
 *     try { if (!serial) return; forceStopApp(serial); } catch {}
 *     // …外层门在这里…
 *
 * `serial` 初值是 `""`，且在 `beforeAll` 的**前三步**（token 断言 / 深链钩子断言 /
 * `setupAndroidE2e`）任一失败时都还没被赋值 ⇒ 那句 early return 会让
 * **外层门整段一次都不执行**：不判红、不 warn、无门结论。
 * 而 spec 行内注释、`qa-defense-lines.md`、issue #819 三处都断言
 * 「beforeAll 失败 ⇒ afterAll 仍执行 ⇒ 门抓得到」——被探针实测证伪。
 *
 * ## 为什么用行为测试而不是源码扫描
 *
 * 正则扫「early return 是否出现在门之前」会在正则失效时**静默恒真**。
 * 这里改为把「收尾 → 外层门」的时序本身做成可测函数：门**无条件**执行是
 * 函数体的结构性质，不依赖调用方写对顺序。
 */
describe("发版门外层三态门 · 收尾与执行顺序", () => {
  /** 记录门与收尾的实际发生顺序，便于断言「门没有被收尾吞掉」。 */
  const makeDeps = (serial: string, rows: OutcomeRow[]) => {
    const events: string[] = [];
    return {
      events,
      deps: {
        teardown: async () => {
          events.push("teardown");
        },
        forceStop: (s: string) => {
          events.push(`forceStop:${s}`);
        },
        serial,
        rows,
        warn: (m: string) => events.push(`warn:${m}`),
        fail: (_silent: readonly string[], m: string) => events.push(`fail:${m}`),
      },
    };
  };

  it("beforeAll 早于 serial 赋值失败（serial 仍为空）⇒ 外层门**仍执行**并判红", async () => {
    const { events, deps } = makeDeps("", [row("R1", 0, 0), row("R3", 0, 0)]);
    await runReleaseGate(deps);
    expect(events.filter((e) => e.startsWith("fail"))).toHaveLength(1);
    // 空 serial 时不得调 forceStop（adb 会拿到非法 serial）
    expect(events.filter((e) => e.startsWith("forceStop"))).toHaveLength(0);
  });

  it("正常路径：收尾完成后门静默（不判红、不 warn）", async () => {
    const { events, deps } = makeDeps("emulator-5554", [row("R1", 1, 0), row("R3", 2, 0)]);
    await runReleaseGate(deps);
    // 不断言 events 的完整集合：合法地新增一个收尾动作就会让 `toEqual` 误伤。
    // 这里要表达的是「门没开口」，故只断言门的两类事件都没出现。
    expect(events.some((e) => e.startsWith("fail:") || e.startsWith("warn:"))).toBe(false);
  });

  it("⚠️ fail 收到的必须是**分类出的那份** silent 名单，而不是空名单/别的名单", async () => {
    // 实测过的洞：把 runReleaseGate 里的 `deps.fail(classification.silent, …)`
    // 改成 `deps.fail([], …)`，**当时全部 25 例照样绿** —— 因为调用方绑的是
    // `expect(silent, msg).toEqual([])`，空数组对空数组恒过 ⇒ 门永不判红。
    // 接线契约（读 spec 源码）抓不到这一条：退化发生在 **runReleaseGate 内部**。
    // 故这里是**行为**断言：fail 的第一个参数必须与 classifyOutcomeRows 的 silent 同值，
    // 且必须等于「台账里双 0 的那些行」。
    const seen: (readonly string[])[] = [];
    const rows: OutcomeRow[] = [row("R1", 0, 0), row("R3", 2, 0)];
    await runReleaseGate({
      teardown: async () => {},
      forceStop: () => {},
      serial: "emulator-5554",
      rows,
      warn: () => {},
      fail: (silent) => {
        seen.push(silent);
      },
    });
    expect(seen, "双 0 时 fail 必须被调用一次").toHaveLength(1);
    expect(seen[0], "fail 拿到的必须正是双 0 的行，且非空").toEqual(["R1"]);
    expect(seen[0]).toEqual(classifyOutcomeRows(rows).silent);
  });

  it("⚠️ 门必须排在收尾**之后**（台账要能触发门，否则断言退化成假绿）", async () => {
    // 本条专治一个实测过的假绿：用**全判定过**的台账去断顺序时，events 里根本不会出现
    // fail/warn，`toEqual` 只比较了 teardown 与 forceStop 两个事件 ⇒ 把整段门挪到收尾
    // **之前**也照样 17 例全绿（用例数随防线增补已变多，该数字只作当时记录），
    // 而生产后果是 appium 未停 / 全局代理未清除 / app 未
    // force-stop（收尾根本没跑）。故这里的台账必须**能触发门**。
    const { events, deps } = makeDeps("emulator-5554", [row("R1", 0, 0), row("R3", 2, 0)]);
    await runReleaseGate(deps);
    // 用**相对序**而非绝对下标：合法地新增一个收尾动作不应让本条转红，
    // 但「门排到收尾之前」必须转红。
    const teardownAt = events.indexOf("teardown");
    const forceStopAt = events.indexOf("forceStop:emulator-5554");
    const failAt = events.findIndex((e) => e.startsWith("fail:"));
    expect(teardownAt).toBeGreaterThanOrEqual(0);
    expect(forceStopAt).toBeGreaterThan(teardownAt);
    expect(failAt).toBeGreaterThan(forceStopAt);
  });

  it("⚠️ 判红本身也排在收尾之后（fail 抛错时收尾仍已完成）", async () => {
    // 生产里 fail 会抛，抛了就不会走到 warn。此处钉的是「抛之前收尾已经做完」——
    // 否则读者会在收尾都没做完时就看到判红，去追一个尚未稳定的现场。
    const events: string[] = [];
    await expect(
      runReleaseGate({
        teardown: async () => {
          events.push("teardown");
        },
        forceStop: (s) => events.push(`forceStop:${s}`),
        serial: "emulator-5554",
        rows: [row("R1", 0, 0)],
        warn: () => events.push("warn"),
        fail: () => {
          throw new Error("判红");
        },
      }),
    ).rejects.toThrow("判红");
    expect(events.indexOf("teardown")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("forceStop:emulator-5554")).toBeGreaterThan(events.indexOf("teardown"));
  });

  it("显式 skip 的行 ⇒ 不判红，只 warn「本轮未验证」", async () => {
    const { events, deps } = makeDeps("emulator-5554", [row("R1", 1, 0), row("R3", 0, 1)]);
    await runReleaseGate(deps);
    expect(events.filter((e) => e.startsWith("fail"))).toHaveLength(0);
    expect(events.filter((e) => e.startsWith("warn"))).toHaveLength(1);
  });

  // 顺序约定的出处：docs/specs/qa-defense-lines.md 三态口径段的「**顺序约定**：判红先于 warn」
  // （三态表本身只规定各自判不判红，不规定先后——故这条不是抄表，是抄那段顺序约定）
  it("判红抛错（生产里 expect 会抛）⇒ warn 不执行 —— 判红优先于 warn", async () => {
    // 上面所有用例的 `fail` 替身只记录不抛，所以「fail 抛了会怎样」一直没被钉住。
    // 生产形态 `fail = (silent, msg) => expect(silent, msg).toEqual([])` **会抛**，
    // 抛了就不会走到 warn —— 顺序反了读者会先看到「本轮未验证」再看到判红，更误导。
    const events: string[] = [];
    await expect(
      runReleaseGate({
        teardown: async () => {},
        forceStop: () => {},
        serial: "emulator-5554",
        rows: [row("R1", 0, 0)],
        warn: () => events.push("warn"),
        fail: () => {
          throw new Error("判红");
        },
      }),
    ).rejects.toThrow("判红");
    expect(events).not.toContain("warn");
  });

  it("收尾（teardown / forceStop）抛错**不阻断**外层门", async () => {
    const events: string[] = [];
    await runReleaseGate({
      teardown: async () => {
        throw new Error("teardown 挂了");
      },
      forceStop: () => {
        throw new Error("forceStop 挂了");
      },
      serial: "emulator-5554",
      rows: [row("R1", 0, 0)],
      warn: () => events.push("warn"),
      fail: (_s, m) => events.push(`fail:${m}`),
    });
    expect(events.filter((e) => e.startsWith("fail"))).toHaveLength(1);
  });

  it("beforeAll 早于 serial 赋值失败且**台账双 0** ⇒ 门给的是「没跑」口径的诊断", async () => {
    // 判红消息必须并列两类成因，读者才分得清「代码回潮」与「这台机器上 beforeAll 挂了」
    const { events, deps } = makeDeps("", [row("R1", 0, 0)]);
    await runReleaseGate(deps);
    const failMsg = events.find((e) => e.startsWith("fail")) ?? "";
    expect(failMsg).toMatch(/①/);
    expect(failMsg).toMatch(/②/);
  });
});

/**
 * spec 一致性（doc-parity）：三态表的**判定词**与 `classifyOutcomeRows` 的实际行为对照。
 *
 * ## 为什么需要它（ADR-0097：翻转必须配机器防线）
 *
 * 三态表是这道门对外的**唯一语义契约**（`qa-defense-lines.md` §3.T2「不可判定口径」）。
 * 本文件早前的真值表是**人工抄**进去的，抄错不会有任何东西变红——实测该文件从头到尾
 * 只在**注释**里提到那份 .md，从不读它（`grep -rln qa-defense-lines tests/ src/`
 * 的命中全是注释文本）⇒ 「改 spec 而不改本测试」曾经是零成本静默漂移。
 * 本组把那张表读出来、把每格映射成一个可执行的判定（判红 / 不判红+warn），
 * 再与纯函数的**实际输出**对照。
 *
 * ⚠️ 抽取器**必须断言抽到了 3 格**（ArchUnit `failOnEmptyShould` 教训）：表格改格式时
 * 静默抽到 0 格，会让全称断言恒真——那正是本组要防的假绿。
 */
describe("发版门外层三态门 · spec 一致性（三态表 ↔ 实现行为）", () => {
  /** 抽出三态表的数据行（blockquote 内的 `| … |` 行，跳过表头与分隔行）。 */
  /**
   * 抽出三态表的数据行（blockquote 内、每格 3 列的行）。
   *
   * ⚠️ **两个独立的抽取边界都要由结构界定**，缺一即假绿：
   *
   * ① **行的边界**：锚点必须**紧跟首个竖线的反引号**（`| \`judged…`），不能用
   *    `/^\|.*judged/`——后者会把任何「表格行里含 judged 一词」的行也算进来（review 往
   *    R1 行补了句含 `judged` 的挂账说明，就多收了 1 行）。锚点 `^\|\s*\`` 修好了这层。
   * ② **格的边界**：**不能直接 `split("|")`**。第 4 格正文里写了 markdown 转义竖线
   *    `\|\|`（判据 `judged === 0 \|\| judged < expected`），naive split 会把该行切成
   *    **5 格**、`cells[2]` 在 322 字符处**截断**——尾部那句真正的规范承诺
   *    （「⚠️ 仍**不判红**：覆盖率由内容形态决定…」）**从不进入任何断言**。
   *    实测把那句改成「一律判红」或「仍判红」，doc-parity **全绿**。
   *    修法：split 前先把 `\|` 换成哨兵、split 后还原；并断言 `cells.length === 3`
   *    （那才是能抓住这个洞的下界断言）。
   */
  function threeStateRows(md: string): { ledger: string; gate: string; cells: number }[] {
    const SENTINEL = " ";
    return md
      .split("\n")
      .map((l) => l.replace(/^\s*>\s?/, ""))
      .filter((l) => /^\|\s*`/.test(l))
      .map((l) => {
        const raw = l.replace(/\\\|/g, SENTINEL).split("|").slice(1, -1);
        const cells = raw.map((c) => c.trim().replaceAll(SENTINEL, "|"));
        return { ledger: cells[0] ?? "", gate: cells[2] ?? "", cells: raw.length };
      });
  }
  const specRows = threeStateRows(specMd);

  it("必须从 qa-defense-lines.md 抽到三态表的全部 4 格（抽到 0 格会让本组全称断言恒真）", () => {
    expect(specRows.length, "三态表数据行数").toBe(4);
    expect(specMd.length, "spec 文件没读到空串").toBeGreaterThan(1000);
    for (const { ledger, gate, cells } of specRows) {
      // ⚠️ 每行必须**恰 3 格**：这是「格的边界没界定」的唯一下界断言。第 4 格正文含
      // 转义竖线 `\|\|`，naive split 会让它变 5 格、尾部承诺被静默截断（review 实测：
      // 把尾部改成「一律判红」时全部测试照绿）。少这行断言，那类假绿就永久藏着。
      expect(cells, `「${ledger}」那行必须是 3 格（转义竖线须还原）`).toBe(3);
      expect(ledger, "台账列必须非空").not.toBe("");
      expect(gate, "外层门列必须非空").not.toBe("");
    }
  });

  it("第 2 格「显式声明不可判定」：spec 说不判红 + warn，实现也必须不判红且给 warn", () => {
    const specRow = specRows.find((r) => /skipped\s*>\s*0/.test(r.ledger));
    expect(specRow, "必须抽到「judged = 0, skipped > 0」那一格").toBeDefined();
    // 判定词只认「**不判红**」——它与「判红」共用「判红」二字，必须按是否被否定区分
    expect(specRow!.gate, "spec 该格必须声明不判红").toMatch(/不判红/);
    // ⚠️ 「不判红」半边之外还要钉「**要 warn**」半边：#819 第 12 轮实测把 spec 该格
    // 改成「不判红，且**不 warn**（静默放过）」时 doc-parity 全绿——warn 承诺是硬编码在
    // 测试里查实现的，不是从 spec 读的，spec 可以悄悄把它删掉。
    // ⚠️ 断的是**承诺的具体措辞**而非裸的 `/warn/`：反事实实测把该格改成
    // 「**不 warn**（静默放过）」时，`/warn|未验证/` 照样命中 ⇒ 假绿。中文否定句天然
    // 包含被否定的关键词（与「不判红 vs 判红」同族；那处用 `(?<!不)判红` 处理，此处否定词
    // 与被否词之间还隔了空格、lookbehind 抓不到，故改断正向措辞）。
    // 措辞与实现、checklist 共用「本轮未验证」一词，改一处要同步另两处。
    expect(specRow!.gate, "spec 该格必须同时承诺 warn「本轮未验证」").toMatch(/本轮未验证/u);

    const r = classifyOutcomeRows([row("R1", 0, 1)]);
    expect(r.silent, "实现必须不判红").toEqual([]);
    expect(buildUnverifiedWarning(r), "实现必须给出 warn").toBeDefined();
  });

  it("第 3 格「既没判定也没声明」：spec 说判红，实现也必须进 silent 名单", () => {
    const specRow = specRows.find(
      (r) => /judged\s*=\s*0/.test(r.ledger) && /skipped\s*=\s*0/.test(r.ledger),
    );
    expect(specRow, "必须抽到「judged = 0, skipped = 0」那一格").toBeDefined();
    // ⚠️ 该格含成因说明，若只写「不判红」就是自相矛盾
    expect(specRow!.gate, "spec 该格必须判红").toMatch(/(?<!不)判红/);
    expect(specRow!.gate, "spec 该格不得声明不判红").not.toMatch(/不判红/);

    expect(classifyOutcomeRows([row("R1", 0, 0)]).silent, "实现必须判红").toEqual(["R1"]);
  });

  it("实现侧头注释的表必须与 spec 同格数、且含第 4 格（两份表可各自漂移）", () => {
    // 之前只有 spec 那张表被机器核对，实现注释里手抄的那张谁都不读 —— 三份真值表
    // （spec md / releaseGate.ts 注释 / 本测试断言）可以各说各话。
    const table = /\* \| 台账 \| 外层门 \|([\s\S]*?)\n \*\n/.exec(gateSrc)?.[1] ?? "";
    const rows = table.split("\n").filter((l) => l.startsWith(" * | `"));
    expect(rows.length, "实现注释表的数据行数（须与 spec 的 4 格一致）").toBe(4);
    expect(table, "实现注释表必须提到覆盖率维度 expected").toMatch(/expected/);
    expect(gateSrc, "实现侧分类函数必须真的读 expected（否则注释与行为脱节）").toMatch(
      /o\.expected !== undefined && o\.judged < o\.expected/u,
    );
  });

  it("第 4 格「覆盖率不足」（0 < judged < expected）：spec 说不判红 + warn，实现也必须只 warn", () => {
    const specRow = specRows.find((r) => /judged\s*<\s*expected/u.test(r.ledger));
    expect(specRow, "必须抽到「0 < judged < expected」那一格").toBeDefined();
    expect(specRow!.gate, "spec 该格必须声明不判红").toMatch(/不判红/);
    expect(specRow!.gate, "spec 该格必须同时承诺 warn「本轮未验证」").toMatch(/本轮未验证/u);
    // ⚠️ 覆盖率不足**不得**升级为判红：那会因内容形态随机红（与三态表同源纪律）
    expect(specRow!.gate, "spec 该格不得声明判红").not.toMatch(/(?<!不)判红/u);

    const r = classifyOutcomeRows([row("R3", 1, 0, 3)]);
    expect(r.silent, "部分覆盖不得判红").toEqual([]);
    expect(r.unverified, "部分覆盖必须算未验证").toEqual(["R3"]);
  });

  it("第 1 格「真跑了并给出判定」：spec 说不因台账判红，实现也不得凭空判红", () => {
    const specRow = specRows.find((r) => /judged\s*>\s*0/.test(r.ledger));
    expect(specRow, "必须抽到「judged > 0」那一格").toBeDefined();
    // 该格的判红来自**断言不通过**，不是台账 ⇒ 台账层不得产生 silent
    expect(specRow!.gate, "spec 该格的外层门列必须指向断言结果而非台账").toMatch(/断言不通过/);

    const r = classifyOutcomeRows([row("R1", 1, 0)]);
    expect(r.silent, "判过就不该判红").toEqual([]);
    expect(r.unverified, "判过就不该算未验证").toEqual([]);
  });
});
