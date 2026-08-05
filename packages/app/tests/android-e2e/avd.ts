/**
 * AVD 管理模块：检测 pictelio_low / pictelio_ui 是否存在、启动、等待 boot 完成。
 *
 * 契约（spec「环境约束」）：复用本机固定 AVD，不新建/删除；模拟器可能被
 * 占用或未启动，需检测 boot 状态、超时处理、清晰报错。
 */
import { execFileSync } from "node:child_process";
import {
  adbPath,
  AVD_PORTS,
  cleanEnv,
  emulatorPath,
  KNOWN_AVDS,
  runCapture,
  spawnLongLived,
  TIMEOUTS,
  waitFor,
  type AvdName,
} from "./env";

/** emulator -list-avds 返回的全部 AVD 名 */
export function listAvds(): string[] {
  const r = runCapture(emulatorPath(), ["-list-avds"]);
  return r.stdout
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 解析目标 AVD：
 * - 显式传入 avdName 时校验其存在性；
 * - 未传入时按 KNOWN_AVDS 顺序取第一个存在的（默认 pictelio_low）。
 * 一个都不存在时给出创建指引的清晰报错。
 */
export function resolveAvd(avdName?: string): AvdName {
  const existing = listAvds();
  if (avdName) {
    if (!existing.includes(avdName)) {
      throw new Error(
        `[android-e2e] 指定的 AVD "${avdName}" 不存在。本机已有 AVD: ${existing.join(", ") || "(无)"}\n` +
          `请在 Android Studio Device Manager 中创建，或用 avdmanager 创建后重试。`,
      );
    }
    return avdName as AvdName;
  }
  for (const name of KNOWN_AVDS) {
    if (existing.includes(name)) {
      console.log(`[android-e2e] 自动选择 AVD: ${name}（可用: ${existing.join(", ")}）`);
      return name;
    }
  }
  throw new Error(
    `[android-e2e] 未找到任何固定 AVD（期望 ${KNOWN_AVDS.join(" / ")}）。` +
      `本机已有 AVD: ${existing.join(", ") || "(无)"}。请先按 ADR-0061 约定创建 pictelio_low / pictelio_ui。`,
  );
}

/** 查询已连接且 boot 完成的模拟器序列号（emulator-5554 等） */
export function onlineEmulatorSerials(): string[] {
  const r = runCapture(adbPath(), ["devices"]);
  // 输出行形如 "emulator-5554\tdevice"；按空白拆分取列，兼容不同 adb 版本带尾部附加字段的输出
  const serials: string[] = [];
  for (const line of r.stdout.split("\n").slice(1)) {
    const cols = line.trim().split(/\s+/u);
    if (cols[0]?.startsWith("emulator-") && cols[1] === "device") {
      serials.push(cols[0]);
    }
  }
  return serials;
}

/** adb shell getprop（无 shell 特殊字符，安全） */
function getProp(serial: string, prop: string): string {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "getprop", prop]);
  return r.stdout.trim();
}

/** 指定 serial 是否已完成 boot */
export function isBootCompleted(serial: string): boolean {
  try {
    return getProp(serial, "sys.boot_completed") === "1";
  } catch {
    return false;
  }
}

/**
 * 确保目标 AVD 已启动且 boot 完成，返回 adb serial（如 emulator-5554）。
 *
 * 策略：
 * 1. 已有在线模拟器且就是目标 AVD → 直接复用；
 * 2. 已有在线模拟器但不是目标 AVD → 报错提示（不抢用，避免误测错设备）；
 * 3. 无在线模拟器 → spawn emulator 启动目标 AVD，轮询 serial 出现 + boot 完成。
 */
export async function ensureEmulator(
  avdName?: string,
): Promise<{ avd: AvdName | "physical"; serial: string }> {
  // 真机直连（ADR-0061 扩展）：ANDROID_E2E_SERIAL 指定已连接真机（如 OPPO R11s），
  // 跳过 AVD 启动——真机网络可达 Pixiv（模拟器被墙，S2 登录在真机可跑通）。
  const physicalSerial = process.env.ANDROID_E2E_SERIAL;
  if (physicalSerial) {
    const devices = runCapture(adbPath(), ["devices"]).stdout;
    if (!devices.includes(physicalSerial)) {
      throw new Error(
        `[android-e2e] ANDROID_E2E_SERIAL=${physicalSerial} 不在线。请检查 USB 连接（adb devices），` +
          `或去掉该变量回退模拟器`,
      );
    }
    await waitFor(
      `真机 ${physicalSerial} 就绪`,
      () => isBootCompleted(physicalSerial),
      TIMEOUTS.boot,
    );
    console.log(`[android-e2e] 使用真机（ANDROID_E2E_SERIAL=${physicalSerial}）`);
    return { avd: "physical", serial: physicalSerial };
  }

  const avd = resolveAvd(avdName);

  // 通过 adb 查询每个在线模拟器的 AVD 名，精确匹配
  const online = onlineEmulatorSerials();
  for (const serial of online) {
    try {
      // 实测不同 AVD 的属性名不同：pictelio_ui 在 ro.boot.qemu.avd_name，
      // pictelio_low 在 ro.kernel.qemu.avd_name——两个都尝试
      const name =
        getProp(serial, "ro.boot.qemu.avd_name") || getProp(serial, "ro.kernel.qemu.avd_name");
      if (name === avd) {
        await waitFor(
          `模拟器 ${avd} (${serial}) boot 完成`,
          () => isBootCompleted(serial),
          TIMEOUTS.boot,
        );
        return { avd, serial };
      }
    } catch {
      // 单个设备查询失败不影响整体判断
    }
  }

  if (online.length > 0) {
    throw new Error(
      `[android-e2e] 检测到在线模拟器 ${online.join(", ")}，但不是目标 AVD "${avd}"。\n` +
        `请先关闭它们（adb -s <serial> emu kill），或设置 ANDROID_E2E_AVD 为正在运行的 AVD 名。`,
    );
  }

  const port = AVD_PORTS[avd] ?? 5554;
  const expectedSerial = `emulator-${port}`;
  console.log(`[android-e2e] 启动模拟器 ${avd}（端口 ${port}，无窗口模式）...`);
  // detached: 模拟器独立于测试进程存活（复用策略：测试结束不杀，下次直接复用）。
  // 否则 vitest 进程退出时子进程组被连带终止，每次都冷启动。
  const proc = spawnLongLived(
    "emulator",
    emulatorPath(),
    [
      "-avd",
      avd,
      "-port",
      String(port),
      "-no-window",
      "-no-audio",
      "-no-boot-anim",
      "-no-snapshot-save",
    ],
    { detached: true },
  );
  // 模拟器进程意外退出时给出清晰报错（而不是干等超时）
  let exitedEarly: number | null = null;
  proc.on("exit", (code) => {
    exitedEarly = code;
  });
  const assertEmulatorAlive = (): void => {
    if (exitedEarly !== null) {
      throw new Error(
        `emulator 进程提前退出（code ${exitedEarly}），请检查 AVD 配置 / HAXM / 磁盘空间`,
      );
    }
  };

  await waitFor(
    `模拟器 serial ${expectedSerial} 上线`,
    () => {
      assertEmulatorAlive();
      return onlineEmulatorSerials().includes(expectedSerial);
    },
    TIMEOUTS.boot,
    3_000,
    // failFast：emulator 已退出时立即报错，不等满超时
    true,
  );

  await waitFor(
    `模拟器 ${avd} boot 完成`,
    () => {
      assertEmulatorAlive();
      return isBootCompleted(expectedSerial);
    },
    TIMEOUTS.boot,
    3_000,
    true,
  );

  // boot 完成后解锁锁屏（无窗口模式下 Keyguard 可能挡住 App 启动）
  runCapture(adbPath(), ["-s", expectedSerial, "shell", "input", "keyevent", "82"]);
  return { avd, serial: expectedSerial };
}

/** 读取设备 WebView 主版本号（用于 Chromedriver 匹配预检与报错信息） */
export function webviewMajorVersion(serial: string): number | null {
  // dumpsys 输出形如 "versionName=114.0.5735.196"，取自 WebView 包信息
  const r = runCapture(adbPath(), [
    "-s",
    serial,
    "shell",
    "dumpsys",
    "package",
    "com.google.android.webview",
  ]);
  const m = /versionName=(\d+)\./u.exec(r.stdout);
  if (m) return Number(m[1]);
  // 部分 ROM 包名不同，尝试 dumpsys webviewupdate
  const r2 = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "webviewupdate"]);
  const m2 = /(\d+)\.\d+\.\d+\.\d+/u.exec(r2.stdout);
  return m2 ? Number(m2[1]) : null;
}

/** 校验设备在线（adb sync 通道可用），供 session 创建前预检 */
export function assertDeviceOnline(serial: string): void {
  execFileSync(adbPath(), ["-s", serial, "wait-for-device"], {
    env: cleanEnv(),
    timeout: TIMEOUTS.adb,
  });
}
