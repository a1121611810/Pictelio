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
 * 「内容断言的「不可判定」口径（三态记账）」表（`judged>0` / `judged=0,skipped>0` /
 * `judged=0,skipped=0` 三行 → 各自的「外层门」列），而非跑一遍
 * `classifyOutcomeRows` 把输出当快照。改动 spec 而不改本测试（或反之）都会立刻红。
 */
import { describe, expect, it } from "vitest";
import {
  buildGateFailureMessage,
  buildUnverifiedWarning,
  classifyOutcomeRows,
  runReleaseGate,
  type OutcomeRow,
} from "../support/releaseGate";

/** 台账行：[可读名, 计数]。名字取自 spec 里两行内容断言的原文。 */
const row = (label: string, judged: number, skipped: number): OutcomeRow => [
  label,
  { judged, skipped },
];

describe("发版门外层三态门 · 台账分类", () => {
  it("judged > 0：既不判红、也不算未验证（行真跑了并给出判定）", () => {
    // 依据：qa-defense-lines 三态表第 1 行「正常判红（断言不通过时）」
    const r = classifyOutcomeRows([row("R1 断言③「相关作品」段注入", 1, 0)]);
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
    const r = classifyOutcomeRows([row("R1 断言③「相关作品」段注入", 0, 0)]);
    expect(r.silent).toEqual(["R1 断言③「相关作品」段注入"]);
    // ⚠️ 这条**不是**抄自三态表第 3 行（那里只写「判红」），而是由 warn 的筛选条件
    // `judged === 0` 推出：双 0 必然满足 judged === 0 ⇒ 也进 warn 名单。
    // 生产里这条**观察不到**——`fail` 先抛，warn 根本走不到；单测替身不抛才看得见。
    // 顺序本身另有一条用例钉住（见「收尾与执行顺序」组）。
    expect(r.unverified).toEqual(["R1 断言③「相关作品」段注入"]);
  });

  it("逐行判定：R3 判过不能替 R1 背书（这正是首版「求和 > 0」被弃用的理由）", () => {
    // 反事实对照：首版外层门是 `r1Injected + r3BookmarkPairs > 0`，此状态下首版会绿。
    const r = classifyOutcomeRows([row("R1", 0, 0), row("R3", 3, 0)]);
    expect(r.silent).toEqual(["R1"]);
    expect(r.unverified).toEqual(["R1"]);
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
    row("R1 断言③「相关作品」段注入", 0, 0),
    row("R3「收藏行」两两不同", 2, 0),
  ];
  const msg = buildGateFailureMessage(rows, classifyOutcomeRows(rows));

  it("必须并列列出**两类**成因（① 被写回 return / ② 该 test 本轮没跑），不单因归错", () => {
    expect(msg).toMatch(/①/);
    expect(msg).toMatch(/②/);
    expect(msg).toMatch(/return/);
    expect(msg).toMatch(/没跑|根本没跑/);
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
    expect(msg).toMatch(/R1 断言③「相关作品」段注入/);
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

  it("⚠️ 门必须排在收尾**之后**（台账要能触发门，否则断言退化成假绿）", async () => {
    // 本条专治一个实测过的假绿：用**全判定过**的台账去断顺序时，events 里根本不会出现
    // fail/warn，`toEqual` 只比较了 teardown 与 forceStop 两个事件 ⇒ 把整段门挪到收尾
    // **之前**也照样 17 例全绿，而生产后果是 appium 未停 / 全局代理未清除 / app 未
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
