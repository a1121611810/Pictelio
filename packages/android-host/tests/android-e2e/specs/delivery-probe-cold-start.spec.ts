/**
 * 送达通道 · 触达探测的**冷启动端到端发布门**（spec notification-delivery-probe / #942）。
 *
 * ⚠️ **手动发布门，不进 CI**（ADR-0084）。本仓 e2e 不进 CI，且历史上多次出现
 * 「单测全绿而真机错」——本片是**补强**，不是唯一防线。门禁职责由 #938/#939/#940/#941
 * 的单测与跨端契约门禁承担。本 spec 只钉住那条**只有真机能证伪**的链路。
 *
 * 链路：登录 → 触发一轮探测 → 强杀 App → 点通知 → 断言落到通知中心页。
 *
 * ⚠️ **oracle 选择**：Lynx 4.0.1 的 accessibility 树不暴露 view/text，Appium 无法定位
 * Lynx 元素（本仓既有共识，见 specs/lynx-network-check.spec.ts）。故断言以**原生日志**
 * 为准：`NotificationTapActivity`「转发落点」+ `LynxActivity`「通知落点 kind=COLD」+
 * JS「记 1 个点击样本」，并辅以截图作为人工可读的证据落盘。
 *
 * ⚠️ **已知失效面**（AC-5 要求诚实登记）：
 *  1. **点通知靠固定坐标**：通知栏里本 App 通知的位置随系统通知增减而漂移
 *     （本轮实测漂移过一次，误点到系统「设置屏锁」）。因此这里用 `NOTIFICATION_TAP_Y`
 *     常量并在失败时**落截图**，而不是假装坐标稳定。若系统通知挤占，改该常量即可。
 *  2. **依赖通知权限已授予**：探测器刻意不申请权限（ADR-0220 D3），未授权时
 *     根本不会发出通知，本 spec 会卡在「等通知」这一步并报错——这是**预期行为**，
 *     不是 flaky。
 *  3. **强杀用 `am kill`**：它只回收后台进程且**保留通知**；`am force-stop` 会连带
 *     清掉通知，冷启动场景就构造不出来了（实测踩过）。
 *  4. **静默期 90s**：本 spec 单次运行至少 2.5 分钟，不适合放进任何 CI。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureEmulator } from "../avd";
import { assertDebugApkInstalled, forceStopApp, writePrefKey } from "../prefs";
import { buildDebugApk, installApk } from "../build-install";
import { adbPath, APP_PACKAGE, LYNX_ACTIVITY, runCapture, runOrThrow } from "../env";
import { SLEEP } from "../helpers";

/** 证据落盘目录（相对 android-e2e/）。失败时人能直接翻出卡在哪一步。 */
const EVIDENCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "evidence");
/** 通知栏里本 App 通知正文的 y 坐标（1080×2160 模拟器）。漂移时改这里。 */
const NOTIFICATION_TAP_Y = 832;
const NOTIFICATION_TAP_X = 540;
/** 探测静默期 90s（ADR-0220 决策 2），加余量。 */
const PROBE_TIMEOUT_MS = 180_000;

/** 跑 adb 并取 stdout。 */
function adb(serial: string, args: string[], timeoutMs = 30_000): string {
  return runCapture(adbPath(), ["-s", serial, ...args], timeoutMs).stdout;
}

async function waitFor(
  probe: () => boolean,
  timeoutMs: number,
  step: string,
  evidence?: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (probe()) return;
    await SLEEP(2_000);
  }
  throw new Error(
    `卡在【${step}】（等 ${timeoutMs / 1000}s 未达成）${evidence ? `，证据截图: ${evidence}` : ""}`,
  );
}

/** logcat 里出现任一 needle（真机证据用）。 */
function logHas(serial: string, needle: string): boolean {
  return adb(serial, ["logcat", "-d"], 60_000).includes(needle);
}

function resumed(serial: string): string {
  const d = adb(serial, ["shell", "dumpsys", "activity", "activities"]);
  return /ResumedActivity:\s*ActivityRecord\{[^}]*u0\s+([^\s]+)/u.exec(d)?.[1] ?? "";
}

/** 系统里是否真的有本 App 的通知（不是「代码调用没抛异常」）。 */
function notificationPresent(serial: string): boolean {
  return adb(serial, ["shell", "dumpsys", "notification"], 60_000).includes(
    "pictelio_delivery_probe",
  );
}

function shoot(serial: string, name: string): string {
  const remote = `/data/local/tmp/evidence/${name}`;
  const local = resolve(EVIDENCE_DIR, name);
  runOrThrow(adbPath(), ["-s", serial, "shell", "mkdir", "-p", `/data/local/tmp/evidence`], 30_000);
  runOrThrow(adbPath(), ["-s", serial, "shell", "screencap", "-p", remote], 30_000);
  runOrThrow(adbPath(), ["-s", serial, "pull", remote, local], 60_000);
  return local;
}

describe("android-e2e 触达探测 · 冷启动点通知（手动发布门，不进 CI）", () => {
  let serial: string;

  beforeAll(async () => {
    const { serial: s } = await ensureEmulator(process.env.ANDROID_E2E_AVD);
    serial = s;
    assertDebugApkInstalled(serial);
    await buildDebugApk();
    await installApk(serial);
    mkdirSync(EVIDENCE_DIR, { recursive: true });
    forceStopApp(serial);
    runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
  });

  afterAll(() => {
    if (serial)
      runOrThrow(adbPath(), ["-s", serial, "shell", "cmd", "statusbar", "collapse"], 30_000);
  });

  it("强杀进程后点通知 ⇒ 冷启动落到通知中心页并记 1 次点击", async () => {
    // 步骤 0：把「本地已读记忆」退回过去 ⇒ 未读恢复 ⇒ 探测器才会发通知。
    //  ⚠️ 不可省：落点会进入通知列表页，而该页加载成功后按 ADR-0188 D11 推进已读记忆
    //  ⇒ 上一轮跑完后未读归零，本轮 decideProbe 会判 no-unread 而**根本不发通知**。
    //  这是探测器与被测链路共享同一份状态导致的跨轮污染，手测时同样会踩。
    writePrefKey(serial, "notifications_last_read_time", "2020-01-01T00:00:00.000Z");

    // 步骤 1：启动 App（登录态由 devLoginIntent 在外层 spec 播种；此处只验链路）
    runOrThrow(
      adbPath(),
      ["-s", serial, "shell", "am", "start", "-n", `${APP_PACKAGE}/.LynxActivity`],
      60_000,
    );
    await waitFor(
      () => logHas(serial, "deliveryProbe"),
      60_000,
      "App 启动并挂上探测链",
      shoot(serial, "01-boot.png"),
    );

    // 步骤 2：等静默期走完，探测器发出汇总通知
    await waitFor(
      () => logHas(serial, "已发汇总通知"),
      PROBE_TIMEOUT_MS,
      "探测器发出汇总通知（未读为 0 或权限未授予时本步会超时——属预期，见已知失效面 2）",
      shoot(serial, "02-no-notification.png"),
    );
    await waitFor(
      () => notificationPresent(serial),
      30_000,
      "通知落到系统通知栏",
      shoot(serial, "03-no-system-notification.png"),
    );

    // 步骤 3：退到后台让进程变成可被回收态，再用 am kill 强杀
    //（force-stop 会连通知一起清掉，冷启动场景就构造不出来了 —— 已知失效面 3）
    runOrThrow(adbPath(), ["-s", serial, "shell", "input", "keyevent", "KEYCODE_HOME"], 30_000);
    await SLEEP(3_000);
    runOrThrow(adbPath(), ["-s", serial, "shell", "am", "kill", APP_PACKAGE], 30_000);
    await SLEEP(3_000);

    const pid = adb(serial, ["shell", "pidof", APP_PACKAGE]).trim();
    expect(pid, "am kill 未回收进程 ⇒ 后面不是冷启动，场景没构造出来").toBe("");
    expect(notificationPresent(serial), "am kill 后通知应仍在（强杀进程不清通知）").toBe(true);

    // 步骤 4：点通知
    runOrThrow(
      adbPath(),
      ["-s", serial, "shell", "cmd", "statusbar", "expand-notifications"],
      30_000,
    );
    await SLEEP(3_000);
    shoot(serial, "04-shade.png");
    runOrThrow(adbPath(), ["-s", serial, "logcat", "-c"]);
    runOrThrow(
      adbPath(),
      [
        "-s",
        serial,
        "shell",
        "input",
        "tap",
        String(NOTIFICATION_TAP_X),
        String(NOTIFICATION_TAP_Y),
      ],
      30_000,
    );

    // 步骤 5：断言落点被分派并落地（oracle = 原生日志，见文件头）
    //  ⚠️ **不**断言 kind=COLD/WARM：广播次数判据已在 #940 被证伪并移除（恒为四窗重发），
    //  冷启动性由步骤 3 的前置条件证明（点通知前 pidof 为空）。
    await waitFor(
      () => logHas(serial, "通知落点"),
      60_000,
      "落点被分派",
      shoot(serial, "05-no-landing.png"),
    );
    expect(
      logHas(serial, "四次广播"),
      "落点未走四窗重发 ⇒ 渲染竞态下页面级监听未挂，点击会丢。证据: evidence/05-no-landing.png",
    ).toBe(true);
    await waitFor(
      () => logHas(serial, "记 1 个点击样本"),
      30_000,
      "点击被记 1 次",
      shoot(serial, "06-no-click.png"),
    );

    // 步骤 6：页面确实在前台（落点页非空）
    await waitFor(() => resumed(serial).endsWith(LYNX_ACTIVITY), 30_000, "落点页处于前台");
    shoot(serial, "07-landed.png");
  }, 600_000);
});
