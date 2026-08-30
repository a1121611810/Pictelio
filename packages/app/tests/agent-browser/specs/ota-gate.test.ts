/**
 * OTA 门槛 E2E — agent-browser 版（#256）。
 *
 * 覆盖（JS 可观察面）：mockFetch 构造远端 version.json 状态 → 经 DEV 测试钩子
 * （window.pictelioOtaDev.runOtaCheck，与真实启动检查同一代码路径）驱动门槛状态机：
 *   ① floor 命中（bundle < minWebVersion）→ 全屏过渡面出现（阻断态 + 重试出口）
 *   ② floor 缺失 → fail-open 无感（无过渡面）
 *   ③ floor 达标 + 有新 bundle → 无过渡面（静默预热，web 环境原生跳过为预期）
 *   ④ floor 达标 + 无更新 → 无过渡面
 *
 * 机制级四场景（好包生效/坏签拒/崩 10s 回滚/门槛阻断的真实下载-验签-切换链路）
 * 依赖原生桥，agent-browser（浏览器）不可达 → 由 packages/app/scripts/bench-ota.sh
 * 设备回归脚本覆盖（#256 验收的另一张网）。
 *
 * 依赖：无登录凭证需求（门槛面渲染于登录前）。mock 注入不跨 reload——通过
 * __pictelioOtaDev 钩子在 mock 注入后重跑检查（绕开启动时序竞态）。
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { AgentBrowserDriver } from "../driver";

const SLEEP = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UPDATE_URL_PATTERN =
  "raw.githubusercontent.com/a1121611810/Pictelio/main/packages/website/version.json";

/** GateOverlay 阻断态标题（组件文案契约锚点） */
const GATE_BLOCKED_TEXT = "需要更新后才能继续使用";

/** 与生产 schema 同形的 fixture（docs/specs/ota-web-bundle.md「版本与数据源」） */
const FIXTURES = {
  gateHit: {
    version: "99.0.0",
    url: "https://github.com/a1121611810/Pictelio/releases/tag/v99.0.0",
    minWebVersion: "99.0.0",
    webBundle: {
      version: "99.0.0",
      url: "https://github.com/a1121611810/Pictelio/releases/download/v99.0.0/pictelio-99.0.0",
    },
  },
  floorMissing: {
    version: "3.21.2",
    url: "https://github.com/a1121611810/Pictelio/releases/tag/v3.21.2",
  },
  floorOk: {
    version: "99.0.0",
    url: "https://github.com/a1121611810/Pictelio/releases/tag/v99.0.0",
    minWebVersion: "1.0.0",
    webBundle: {
      version: "99.0.0",
      url: "https://github.com/a1121611810/Pictelio/releases/download/v99.0.0/pictelio-99.0.0",
    },
  },
};

describe("agent-browser OTA 门槛（#256）", () => {
  let driver: AgentBrowserDriver;

  beforeAll(async () => {
    driver = new AgentBrowserDriver();
    await driver.launch();
    // R 类：等首屏内容渲染（门槛面渲染于登录前，无需登录态）
    await driver.waitForPageContent(10_000);
    // 竞态消除：页面自带启动检查的真实 fetch（checkForUpdate 10s 超时）必须先落定——
    // 此刻 floor 缓存为空，其 error 分支 fail-open 不设门槛；若不等待，它在场景中途
    // 落地会命中场景①播种的 floor 缓存（99.0.0）把门槛刷回 ON（实测 ④ 稳定复现）。
    // 等待后再注入 mock，后续所有检查均走 mock，无任何在途真实请求。
    await SLEEP(11_000);
  }, 90_000);

  afterAll(async () => {
    await driver?.close();
  });

  /**
   * evaluate 返回值是 JSON 序列化的（对象返回值被双层编码：CLI 层 + 调用方层），
   * 需要逐层解包到对象。update-flow 的字符串返回值单层 parse 即可，对象要多一层。
   */
  function parseEvalResult<T>(raw: string): T {
    const once: unknown = JSON.parse(raw);
    return (typeof once === "string" ? JSON.parse(once) : once) as T;
  }

  async function pageHasGate(): Promise<boolean> {
    const text = await driver.pageText();
    return text.includes(GATE_BLOCKED_TEXT);
  }

  /**
   * 注入 mock + 清空旧规则（mockFetch 规则累积，同 URL 先匹配者胜）+
   * 经 DEV 钩子重跑检查（真实代码路径）。
   *
   * 竞态说明：页面自带启动检查的**真实网络 fetch**（无 mock 时在途）可能在 mock 注入后
   * 才返回（真实 version.json 无 floor → 把门槛刷回 OFF），且每 page load 只发一次。
   * 因此断言采用「重触发 → 轮询收敛」：在途真实响应落地后，mock 重触发必然稳定命中
   * 期望状态（最多 8 轮 × 0.7s）。
   */
  async function driveOtaCheckUntil(
    payload: Record<string, unknown>,
    expectGate: boolean,
  ): Promise<void> {
    const res = await driver.evaluate(
      "(() => { const h = window.pictelioOtaDev; if (!h) return 'no-hook'; void h.runOtaCheck(); return 'triggered'; })()",
    );
    // evaluate 返回 JSON 序列化值（update-flow 同款），需 parse
    expect(JSON.parse(res), "DEV 测试钩子应存在（pictelioOtaDev）").toBe("triggered");
    for (let round = 0; round < 8; round++) {
      await driver.evaluate(
        "(() => { if (window.__mockRules) window.__mockRules.length = 0; return 'cleared'; })()",
      );
      await driver.mockFetch(UPDATE_URL_PATTERN, JSON.stringify(payload));
      await driver.evaluate(
        "(() => { const h = window.pictelioOtaDev; if (!h) return 'no-hook'; void h.runOtaCheck(); return 'triggered'; })()",
      );
      await SLEEP(700);
      // 断言锚点 = 门槛状态机信号（gateActive，确定性）；DOM 文本时序抖动不作为判据
      const state = await driver.evaluate(
        "(() => { const h = window.pictelioOtaDev; return JSON.stringify(h ? h.debug() : null); })()",
      );
      const parsed = parseEvalResult<{ active: boolean }>(state);

      if (parsed.active === expectGate) {
        if (expectGate) {
          expect(await pageHasGate(), "门槛激活时过渡面应渲染").toBe(true);
        }
        return;
      }
    }
    const state = await driver.evaluate(
      "(() => { const h = window.pictelioOtaDev; return JSON.stringify(h ? h.debug() : null); })()",
    );
    expect(
      parseEvalResult<{ active: boolean }>(state).active,
      `重触发 8 轮后门槛状态未收敛到 ${expectGate}`,
    ).toBe(expectGate);
  }

  it("① floor 命中 → 全屏过渡面出现（阻断态 + 重试出口）", async () => {
    await driveOtaCheckUntil(FIXTURES.gateHit, true);
    expect(await pageHasGate(), "floor 99.0.0 > 当前 3.21.x 应出现过渡面").toBe(true);
    const text = await driver.pageText();
    expect(text).toContain("重试更新");
    expect(text).toContain("前往下载");
  }, 30_000);

  it("② floor 缺失 → fail-open 无感（无过渡面）", async () => {
    await driveOtaCheckUntil(FIXTURES.floorMissing, false);
    expect(await pageHasGate(), "floor 缺失 = 不设门槛，不应出现过渡面").toBe(false);
  }, 30_000);

  it("③ floor 达标 + 有新 bundle → 静默（无过渡面）", async () => {
    await driveOtaCheckUntil(FIXTURES.floorOk, false);
    expect(await pageHasGate(), "floor 1.0.0 ≤ 当前版本不应出现过渡面").toBe(false);
  }, 30_000);

  it("④ floor 达标 + 无更新 → 无过渡面", async () => {
    await driveOtaCheckUntil(
      {
        version: "3.21.2",
        url: "https://github.com/a1121611810/Pictelio/releases/tag/v3.21.2",
        minWebVersion: "1.0.0",
      },
      false,
    );
    expect(await pageHasGate()).toBe(false);
  }, 30_000);
});
