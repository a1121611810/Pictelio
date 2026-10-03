/**
 * SharedPreferences 契约工具（S1，issue #105）。
 *
 * 验证「JS/native 侧写入 CapacitorStorage 键 → 重启后被读取」这类跨进程数据契约。
 * 通过 adb 直接读/写真实 CapacitorStorage.xml（run-as 访问 debug 包私有目录），不 mock
 * ——沿用「真实数据源比对」契约测试原则。写后即回读校验（write-then-verify），
 * 从而秒级区分「写入问题」与「读取/分发问题」。
 *
 * ⚠️ 单引擎化后（#610）：`pictelio_client_kind` **不再决定任何行为**——
 * `MainActivity` 分发器与引擎路由均已删除，唯一入口是 launcher `LynxActivity`，
 * 且 `PictelioAppModule.getClientKind` 会把任何写入值归一为 lynx（ADR-0062）。
 * 因此播种该键的工具（`writeClientKind`）与相关引擎状态快照工具（`ENGINE_KEYS` /
 * `parseEngineState` / `readEngineState` / `pollEngineState`）**均已删除**——
 * 前者无被测行为（写入值被归一，断言恒真），后者的 spec
 * （`engine-fallback-matrix` 等）与 oracle（`EnginePrefs.java` /
 * `EngineRoute.snapshotLine()`）在源码树中已不存在。
 * 通用 pref 读写（`readPrefValue` / `writePrefKey` / `readClientPrefs` /
 * `pollPrefs`）不受影响，继续服务仍存活的键契约断言。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adbPath, APP_PACKAGE, MAIN_ACTIVITY, runCapture, runOrThrow, TIMEOUTS } from "./env";

/** CapacitorStorage.xml 在 app 数据目录内的相对路径（run-as 需相对路径，绝对路径被 SELinux 拒） */
const PREFS_REL = "shared_prefs/CapacitorStorage.xml";

export interface ClientPrefs {
  clientKind: "webview" | "lynx" | null;
  /** 文件是否存在（null 时区分「未初始化」与「文件缺失」） */
  fileExists: boolean;
  /** 原始 XML（失败诊断用） */
  rawXml: string;
}

/** CapacitorStorage.xml 单次原始读取结果（文件存在性 + 原始 XML） */
interface PrefsFile {
  fileExists: boolean;
  rawXml: string;
}

/**
 * 读取设备上 CapacitorStorage.xml 的原始内容（run-as cat，debug 包可读）。
 * 文件不存在 / run-as 失败 → fileExists=false（rawXml 保留失败输出供诊断）。
 * readClientPrefs / readPrefValue 共用同一 adb 调用路径，不重复实现。
 */
function readPrefsXml(serial: string): PrefsFile {
  const r = runCapture(adbPath(), [
    "-s",
    serial,
    "shell",
    `run-as ${APP_PACKAGE} cat ${PREFS_REL}`,
  ]);
  if (r.code !== 0 || r.stdout.trim() === "") {
    // 文件可能不存在（首次启动前）
    return { fileExists: false, rawXml: r.stdout };
  }
  return { fileExists: true, rawXml: r.stdout };
}

/**
 * 从 SharedPreferences XML 提取指定键的字符串值。
 * Capacitor/Android SharedPreferences 两种序列化形式都兼容：
 * ① <string name="key">value</string>（Capacitor Preferences 实际格式）
 * ② <string name="key" value="value"/>（少数实现）
 * 键不存在 → null。
 */
function extractStringValue(xml: string, key: string): string | null {
  const m =
    new RegExp(`<string name="${key}">([^<]*)</string>`, "u").exec(xml) ??
    new RegExp(`name="${key}"\\s+value="([^"]*)"`, "u").exec(xml);
  return m?.[1] ?? null;
}

/**
 * 读取设备上 CapacitorStorage.xml 的 pictelio_client_kind 值。
 * 用 run-as 访问 app 私有目录（debug 包可读）。文件不存在 → clientKind=null。
 */
export function readClientPrefs(serial: string): ClientPrefs {
  const { fileExists, rawXml } = readPrefsXml(serial);
  if (!fileExists) {
    return { clientKind: null, fileExists: false, rawXml };
  }
  return {
    clientKind:
      (extractStringValue(rawXml, "pictelio_client_kind") as ClientPrefs["clientKind"]) ?? null,
    fileExists: true,
    rawXml,
  };
}

/**
 * 轮询读取 CapacitorStorage.xml 直到谓词满足（issue #523，T3 共享契约工具）。
 *
 * 为什么必须轮询：app 侧写 prefs 走「JS 桥排队 → Java 线程 → SharedPreferences
 * editor.apply()」异步链（apply 只保证写内存，落盘由调度器异步 flush），且桥
 * 调用本身有排队延迟。测试用 adb run-as 单次直读读到的是落盘瞬间的文件，与
 * 写入天然竞态（#10 flaky / roundtrip 单读失败的根因）——断言「写入已生效」
 * 必须按固定间隔重读，直到谓词满足或超时。
 *
 * @param serial adb 设备序列号
 * @param predicate 判定快照是否满足期望（满足即停，返回该次快照）
 * @param timeoutMs 总超时，默认 30s
 * @param intervalMs 轮询间隔，默认 1s
 * @param readFn 读取函数，默认 readClientPrefs；仅单测注入 fake 用，E2E 勿传
 * @returns 满足谓词的那次快照
 * @throws Error 超时未满足：消息含「轮询超时」与最后一次 rawXml 快照（诊断用）
 */
export async function pollPrefs(
  serial: string,
  predicate: (prefs: ClientPrefs) => boolean,
  timeoutMs = 30_000,
  intervalMs = 1_000,
  readFn: (serial: string) => ClientPrefs = readClientPrefs,
): Promise<ClientPrefs> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const prefs = readFn(serial);
    if (predicate(prefs)) return prefs;
    if (Date.now() >= deadline) {
      throw new Error(
        `[android-e2e] pollPrefs 轮询超时（timeoutMs=${timeoutMs}, intervalMs=${intervalMs}）。` +
          `最后一次 CapacitorStorage.xml 快照: ${prefs.rawXml || "(文件不存在)"}`,
      );
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
}

/**
 * 读取 CapacitorStorage.xml 中任意字符串键的值（run-as 直读，debug 包可读）。
 * 文件不存在或键不存在 → null。用于取证键写入后的落盘校验。
 */
export function readPrefValue(serial: string, key: string): string | null {
  const { fileExists, rawXml } = readPrefsXml(serial);
  if (!fileExists) return null;
  return extractStringValue(rawXml, key);
}

/**
 * 覆写真实 CapacitorStorage.xml 的任意键值（ADR-0103 T5 契约测试：等价 app 内
 * 经 @capacitor/preferences（webview）/ PictelioPrefsModule（lynx）写入的效果）。
 * 文件不存在时新建 <map>；存在时替换同名 <string>；值域 string。
 * 键/值来自测试字面量（show_r18_42 / true），无正则特殊字符风险。
 */
export function writePrefKey(serial: string, key: string, value: string): void {
  const cur = readClientPrefs(serial);
  let xml: string;
  if (cur.fileExists) {
    const hasKey = cur.rawXml.includes(`name="${key}"`);
    xml = hasKey
      ? cur.rawXml
          .replace(
            new RegExp(`<string name="${key}">[^<]*</string>`, "u"),
            `<string name="${key}">${value}</string>`,
          )
          .replace(
            new RegExp(`name="${key}"\\s+value="[^"]*"`, "u"),
            `name="${key}" value="${value}"`,
          )
      : // 空 map 自闭合 <map /> 兼容（新装 app 的 CapacitorStorage.xml 实测为 <map />，2026-08-29 T0 踩中）
        /<map\s*\/>/u.test(cur.rawXml)
        ? cur.rawXml.replace(
            /<map\s*\/>/u,
            `<map>\n    <string name="${key}">${value}</string>\n</map>`,
          )
        : cur.rawXml.replace(/<map>/u, `<map>\n    <string name="${key}">${value}</string>`);
  } else {
    xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <string name="${key}">${value}</string>\n</map>\n`;
  }
  const b64 = Buffer.from(xml, "utf8").toString("base64");
  const script = `mkdir -p shared_prefs && echo ${b64} | base64 -d > ${PREFS_REL} && chmod 660 ${PREFS_REL} && cat ${PREFS_REL}`;
  const adbCmd = `run-as ${APP_PACKAGE} sh -c '${script}'`;
  const r = runCapture(adbPath(), ["-s", serial, "shell", adbCmd]);
  if (r.code !== 0) {
    throw new Error(
      `[android-e2e] 覆写 ${APP_PACKAGE} 的 ${key}=${value} 失败（code ${r.code}）。` +
        `stderr: ${r.stderr}`,
    );
  }
  const written = readClientPrefs(serial);
  if (!written.rawXml.includes(`name="${key}"`)) {
    throw new Error(`[android-e2e] 写入后校验失败：${key} 不在 ${written.rawXml}`);
  }
}

/**
 * 外观（主题色 / 明暗）播种契约（issue #852）。
 *
 * 与 `writePrefKey` 的关系：`seedAppearance` 是**多键原子播种 + 回读校验**的便捷层，
 * 落盘仍走 `writePrefKey`（同一份 XML 序列化口径），不引入第二条写盘路径。
 *
 * ## 键名 oracle（单一事实源在 app 侧，不在本文件）
 *
 *  - `settings_theme_color` —— `packages/app-lynx/src/stores/settingsStore.ts`
 *    `THEME_COLOR_KEY`；值域见 `utils/themeColor.THEME_COLOR_OPTIONS`（sky/violet/pink/
 *    green/orange/teal/bili）。非法值在 JS 侧 `themeColorClass` 会 warn 并回退 sky，
 *    **不会崩**——所以写错值的表现是「颜色没变」，不是报错（#852 A3 断言正是靠这一点
 *    构成负向对照：主题类没生效时读到的是回退色板，与目标色板必然不同）。
 *  - `settings_dark_mode` —— 同文件 `DARK_MODE_KEY`；值域 `light` / `dark` / `auto`。
 *    原生侧 `LynxActivity.readDarkModeRaw` + `normalizeDarkMode` 读同一个键
 *    （状态栏/启动页配色与 JS 侧读点同源）。
 * 两者都落在 `CapacitorStorage` 这个 SharedPreferences 文件里（与
 * `PictelioPrefsModule.PREFS_FILE`、`LynxActivity.SYSTEMBARS_PREFS` 同一份）。
 *
 * ## 为什么要先 force-stop
 *
 * `writePrefKey` 是**直写 XML 文件**，绕过了 app 进程内的 `SharedPreferences` 内存缓存。
 * app 在运行时若持有同一键的旧值并随后调 `editor.apply()`，会把文件**覆写回旧值**，
 * 表现为「刚写的主题色重启后又变回去」。故调用方**必须**先 `forceStopApp` 再播种。
 * 本函数不代劳 force-stop：是否需要保活由用例决定（#852 的 spec 在播种前已停进程）。
 */
export interface AppearanceSeed {
  /** 主题色 id（THEME_COLOR_OPTIONS 之一）；省略 = 不动该键 */
  themeColor?: string;
  /** 明暗模式（`light` / `dark` / `auto`）；省略 = 不动该键 */
  darkMode?: string;
}

/** 外观两键的键名（写盘与回读校验共用，避免两处各写一份字符串） */
export const APPEARANCE_KEYS = {
  themeColor: "settings_theme_color",
  darkMode: "settings_dark_mode",
} as const;

/**
 * 播种外观键并回读校验（write-then-verify，秒级区分「写失败」与「读不到」）。
 *
 * @param serial adb 设备序列号
 * @param seed 要写入的键值；至少给一个，否则直接抛错（空播种是调用方 bug，不静默通过）
 */
export function seedAppearance(serial: string, seed: AppearanceSeed): void {
  if (seed.themeColor === undefined && seed.darkMode === undefined) {
    throw new Error(
      "[android-e2e] seedAppearance 未给任何键——空播种会让用例「什么都没改就判通过」。" +
        `期望键名: ${APPEARANCE_KEYS.themeColor} / ${APPEARANCE_KEYS.darkMode}`,
    );
  }
  if (seed.themeColor !== undefined) {
    writePrefKey(serial, APPEARANCE_KEYS.themeColor, seed.themeColor);
  }
  if (seed.darkMode !== undefined) {
    writePrefKey(serial, APPEARANCE_KEYS.darkMode, seed.darkMode);
  }
  // 回读校验：写入后必须真的能在 XML 里读到，否则后续断言会在一个「没播种」的
  // 设备上跑出与期望无关的红，报错指向错误的根因。
  for (const [key, want] of [
    [APPEARANCE_KEYS.themeColor, seed.themeColor],
    [APPEARANCE_KEYS.darkMode, seed.darkMode],
  ] as const) {
    if (want === undefined) continue;
    const got = readPrefValue(serial, key);
    if (got !== want) {
      throw new Error(
        `[android-e2e] 播种 ${key} 回读不一致：写入 ${want}，读到 ${got ?? "(缺失)"}。` +
          "（app 进程是否仍在运行并覆写了 SharedPreferences？先 forceStopApp 再播种）",
      );
    }
  }
  console.log(
    `[android-e2e] ✓ 已播种外观 ${
      seed.themeColor === undefined ? "" : `${APPEARANCE_KEYS.themeColor}=${seed.themeColor}`
    }${seed.themeColor !== undefined && seed.darkMode !== undefined ? " " : ""}${
      seed.darkMode === undefined ? "" : `${APPEARANCE_KEYS.darkMode}=${seed.darkMode}`
    }`,
  );
}

/** 强制停止 app（清后台进程，重启时走 onCreate 入口路由）。
 *  注意：不等待 pidof 消失——force-stop 后 am start 会启动新进程读最新 prefs；
 *  等待反而可能因旧进程未死透被 am start 复用（读缓存 prefs）导致不分发。 */
export function forceStopApp(serial: string): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "am", "force-stop", APP_PACKAGE], TIMEOUTS.adb);
}

/**
 * 通过 am start 启动主入口 Activity。
 *
 * 单引擎布局下 `E2E_FLAVOR` 缺省 `single`，唯一入口恒为 `LynxActivity`；
 * `full` / `webview` 分支只留在 `env.mainActivityFor` 的纯函数映射里（供单测覆盖），
 * 运行时由 `env.ts` 的「非 single 即显式抛错」守卫挡住——`build.gradle` 已无
 * `productFlavors`，不存在可跑那两个 flavor 的包。
 */
export function startMainActivity(serial: string): void {
  runOrThrow(
    adbPath(),
    ["-s", serial, "shell", "am", "start", "-n", `${APP_PACKAGE}/${MAIN_ACTIVITY}`],
    TIMEOUTS.adb,
  );
}

/** dev hook 的 intent extra key。oracle = LynxActivity.java:98 DEV_EXTRA_REFRESH_TOKEN */
const DEV_EXTRA_REFRESH_TOKEN = "pictelio_dev_refresh_token";

/**
 * dev hook 登录的 am start 参数（纯函数，便于单测）。
 *
 * oracle = `LynxActivity.applyDevIntentHooks()`（LynxActivity.java:697-706）：
 * 非空时调 `autoLoginWithRefreshToken(token)` 持久化进 SecureStorage 并登录。
 * 门禁 `BuildConfig.DEBUG` ⇒ 只有 debug 包有该钩子，release 包被 R8 整段移除。
 *
 * 显式打 `io.pictelio.app/.LynxActivity` 而非 `MAIN_ACTIVITY`：该钩子只在
 * LynxActivity 内实现，落到别的 Activity 上 intent 会被静默忽略。
 */
export function devLoginIntentArgs(token: string, forceR18 = true): string[] {
  // token 是设备 shell 侧参数，单引号包裹并转义内嵌单引号，防注入与截断
  const quoted = `'${token.replace(/'/gu, `'\\''`)}'`;
  const args = [
    "shell",
    "am",
    "start",
    "-n",
    `${APP_PACKAGE}/.LynxActivity`,
    "--es",
    DEV_EXTRA_REFRESH_TOKEN,
    quoted,
  ];
  // 强制 R-18 可见（默认开）。不强制时，受限作品会渲染成灰色占位「受浏览限制，不予显示」——
  // 既没有真实像素（像素判据恒等），又点不进去（导航断言必败）。项目内已有先例：
  // tools/verify-translation.sh:47 与 tools/README.md:42 都带这个 extra。
  if (forceR18) args.push("--es", DEV_EXTRA_FORCE_R18, "true");
  return args;
}

/** 强制 R-18 可见的 dev hook extra。oracle = LynxActivity.java:103 DEV_EXTRA_FORCE_R18 */
const DEV_EXTRA_FORCE_R18 = "pictelio_dev_force_r18";

/** 登录成功标记。oracle = LynxActivity 内 `dev hook: 自动登录成功` 那一行（实测 2026-09-28） */
const DEV_LOGIN_SUCCESS_MARK = "dev hook: 自动登录成功";

/** logcat 采集的 maxBuffer（字节）。Lynx 的 `ElementManager::OnPatchFinishForFiber`
 *  是 ~60fps 逐帧日志，单次 dump 可达数 MB；env.runCapture 的缺省 1MB 会抛 ENOBUFS
 *  （实测把 lynx-bookmark-tags 用例 ② 打成红）。 */
const MAX_LOGCAT_BUFFER = 16 * 1024 * 1024;

/** readAppLogcat 的可选参数 */
export interface AppLogcatOptions {
  /** `-t <lines>`：只取尾部若干行（全量 dump 被逐帧噪声淹没）；省略 = 全量 */
  lines?: number;
  /** spawnSync maxBuffer 覆盖，默认 16MB（见 MAX_LOGCAT_BUFFER） */
  maxBufferBytes?: number;
}

/**
 * 读取 **app 进程**的 logcat（`--pid` 过滤），供所有渲染/登录就绪判定共用。
 *
 * 两条设计约束，都来自实测（2026-09-28，单引擎包，pictelio_ui）：
 *
 * ① **必须按 pid 过滤**：logcat 是环形 buffer，而 e2e 大量使用
 *    `dumpsys activity activities` 轮询（本身就会刷出成百上千行
 *    ActivityTaskManager/WindowManager 日志），叠加模拟器系统日志后，
 *    最早产生的 Lynx 初始化行会被挤出 buffer——实测 `logcat -d | grep LynxEnv`
 *    为空，按 pid 抓同一次启动立刻拿到 `LynxEnv start init`。
 *
 * ② **进程不存在时返回空串，绝不抛错**：`am start` 返回后，ActivityTaskManager 的
 *    Activity 记录会**先于**进程创建出现（实测 `START` 23:39:49.923 vs
 *    `Start proc` 23:39:50.070，差约 150ms）。因此「`dumpsys` 已看到目标 Activity」
 *    **不代表**进程已起，紧接着的 `pidof` 仍可能为空。
 *    调用方（`waitForLynxRenderReady` 等）本来就在轮询里，返回空串让轮询继续才是
 *    正确行为；抛错会把「进程还没起」误报成「app 崩溃/被杀」。
 */
export function readAppLogcat(serial: string, opts: AppLogcatOptions = {}): string {
  const pid = runCapture(adbPath(), ["-s", serial, "shell", "pidof", APP_PACKAGE]).stdout.trim();
  if (!pid) {
    console.warn(
      `[android-e2e] pidof ${APP_PACKAGE} 为空（app 进程尚未创建，或已被杀）——本次返回空日志，由调用方轮询重试`,
    );
    return "";
  }
  // `-t <lines>`：全量 dump 无意义（Lynx 的 OnPatchFinishForFiber 是 ~60fps 逐帧日志），
  // 取尾部若干行足够覆盖渲染信号，同时把 ENOBUFS 概率压到最低。省略时取全量。
  const args = ["-s", serial, "logcat", "-d", `--pid=${pid}`];
  if (opts.lines !== undefined) args.push("-t", String(opts.lines));
  return runCapture(adbPath(), args, TIMEOUTS.adb, opts.maxBufferBytes ?? MAX_LOGCAT_BUFFER).stdout;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * 用 dev intent hook 登录（等价 webview 登录页注入的 refresh_token，
 * 但不依赖 WebView 客户端——单引擎化后 webview 登录页已不存在）。
 *
 * **本函数会先 force-stop 再启动，因此是自包含的启动入口**，调用方不必关心
 * 前置时序。原因是 `LynxActivity` **不覆写 `onNewIntent`**（实测 `grep onNewIntent`
 * 0 命中）而 manifest 是 `launchMode="singleTask"`：app 已在运行时再 `am start`，
 * intent 只会走 onNewIntent 通道（无处理者），`applyDevIntentHooks(getIntent())`
 * 那唯一一次调用（LynxActivity.java:660，挂在 LynxView 初始化路径 `renderTemplateUrl`
 * 之后）**不会再次执行** ⇒ 登录静默不发生。故必须先杀掉进程走完整启动流程。
 *
 * 本函数是阻塞的：发起 `am start` 后轮询 logcat 直到看到成功标记才返回。
 * `autoLoginWithRefreshToken` 的 OAuth 交换与 SecureStorage 落盘是异步的——
 * 调用方若紧接着再做 force-stop/重启，会把登录打断，表现为「登录态莫名失效」。
 * 等成功标记即消除了这个竞态，且比各 spec 各自 sleep 固定秒数更可靠。
 *
 * **实机验证（2026-09-28，pictelio_ui + 单引擎 debug 包）**：logcat 打出
 * `I LynxActivity: dev hook: 自动登录成功（userInfo={"userId":…,"userName":…}）`，
 * 随后 `PictelioSecureStorage.setItem.refresh_token` 持久化。
 *
 * token 缺省取 `process.env.PIXIV_REFRESH_TOKEN`（globalSetup 从 packages/app-lynx/.env 注入）。
 * 超时即抛错并带上 logcat 尾部——**不做静默降级**：登录失败若被吞掉，
 * 下游用例会以「内容为空」的形式给出完全误导的失败信息。
 */
export async function loginViaDevIntent(
  serial: string,
  token = process.env.PIXIV_REFRESH_TOKEN,
  timeoutMs = 90_000,
  forceR18 = true,
  attempts = 3,
): Promise<void> {
  if (!token) {
    throw new Error(
      "[android-e2e] dev hook 登录缺少 PIXIV_REFRESH_TOKEN。" +
        "请确认 packages/app-lynx/.env 存在该键，或显式传入 token 参数。",
    );
  }
  // ⚠️ **有界重试**（2026-10-03）：模拟器到 Pixiv 的链路是**间歇性**的 ——
  //   实测同一 token 连续 3 次里 2 次成功、1 次 `登录失败: Connection reset`
  //   （约 10 秒后重置）。单次尝试超时会把**网络抖动**变成整条 spec 的红，
  //   而报错指向「登录超时」，把排查方向引向 token/hook（实测就被误导过一次：
  //   先以为是 token 失效，实际是自己的 shell 提取写错）。
  //   ⇒ 重试只针对「没等到成功标记」这一种可恢复态；**用尽次数仍失败照旧抛错**，
  //     且报错附上最后一次的 logcat 尾部，真实失败不会被重试掩盖。
  let lastTail = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    // 先杀进程，保证下面的 am start 走完整启动流程并触发 applyDevIntentHooks
    forceStopApp(serial);
    runOrThrow(adbPath(), ["-s", serial, ...devLoginIntentArgs(token, forceR18)], TIMEOUTS.adb);

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      lastTail = readAppLogcat(serial);
      if (lastTail.includes(DEV_LOGIN_SUCCESS_MARK)) {
        console.log(
          `[android-e2e] ✓ dev hook 登录完成（logcat 见到成功标记${attempt > 1 ? `，第 ${attempt}/${attempts} 次尝试` : ""}）`,
        );
        return;
      }
      // 失败不做特殊分支：dev hook 的失败路径日志串未在源码中固定，交给超时分支统一暴露
      await sleep(1_000);
    }
    if (attempt < attempts) {
      console.warn(
        `[android-e2e] dev hook 登录第 ${attempt}/${attempts} 次超时（${timeoutMs / 1000}s）——` +
          "按间歇性网络抖动重试；若多次都失败请查 logcat 尾部的真实原因（可能是 token 或 hook）",
      );
    }
  }
  throw new Error(
    `[android-e2e] dev hook 登录超时（${attempts} 次尝试 × ${timeoutMs / 1000}s），未等到「${DEV_LOGIN_SUCCESS_MARK}」。\n` +
      `logcat 尾部（已去敏，前 2000 字符）：\n${redactSecrets(lastTail).slice(0, 2_000)}`,
  );
}

/**
 * 日志去敏：把 refresh_token 明文替换掉。
 *
 * #819 前这里只有 `slice(0, 2000)` 却把结果称作「去敏后」——名不副实。token 经
 * `am start --es pictelio_dev_refresh_token <token>` 下发，若 Lynx/Java 侧任何一行
 * 日志回显了它，就会**原样**进这条错误消息，随后被 vitest 写进
 * `test-results/` 与 CI 输出。本函数按已知 token 精确替换（token 长度 ≥40，
 * 不可能与其它日志内容自然碰撞），是纯函数，单测直接覆盖。
 */
export function redactSecrets(text: string, token = process.env.PIXIV_REFRESH_TOKEN): string {
  if (!token || token.length < 8) return text;
  return text.split(token).join("[REDACTED]");
}

/** 查询当前前台 Activity（dumpsys activity），归一化为 "package.Class" 形式 */
export function currentTopActivity(serial: string): string | null {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "dumpsys", "activity", "activities"]);
  let raw: string | null = null;
  // android-30+ 用 topResumedActivity；android-28 等用 mResumedActivity / ResumedActivity。
  // 前缀必选（不能可选）——否则会匹配到 dumpsys 输出里历史的 ActivityRecord 条目。
  // ActivityRecord{<hash> u0 <component> t<task>}——hash 后是用户 id（u0）再是组件。
  const m =
    /(?:topResumedActivity=|mResumedActivity: |ResumedActivity: )(?:Activity\{|ActivityRecord\{)[\w-]+\s+u\d+\s+([\w./]+)/u.exec(
      r.stdout,
    );
  if (m) raw = m[1];
  if (!raw) {
    // 备用：mCurrentFocus
    const m2 = /mCurrentFocus=Window\{[^}]+\s+([\w./]+)\}/u.exec(r.stdout);
    raw = m2 ? m2[1] : null;
  }
  if (!raw) return null;
  // 归一化 "io.pictelio.app/io.pictelio.app.LynxActivity" → "io.pictelio.app.LynxActivity"；
  // "io.pictelio.app/.LynxActivity" → 同。
  if (raw.includes("/")) {
    const [pkg, cls] = raw.split("/", 2);
    if (cls.startsWith(".")) return pkg + cls;
    return cls.includes(".") ? cls : `${pkg}.${cls}`;
  }
  return raw;
}

/** 校验 APK 是 debug 包（run-as 依赖 debug 签名） */
export function assertDebugApkInstalled(serial: string): void {
  const r = runCapture(adbPath(), ["-s", serial, "shell", "run-as", APP_PACKAGE, "pwd"]);
  if (r.code !== 0) {
    throw new Error(
      `[android-e2e] ${APP_PACKAGE} 无法 run-as（code ${r.code}）。` +
        `S1 契约测试需要 debug APK（run-as 访问私有目录）。请用 pnpm build:android-host 安装 debug 包。`,
    );
  }
}

/** 本地快照目录（test-results/android-e2e），失败诊断用 */
export function snapshotDir(): string {
  return resolve(process.cwd(), "test-results/android-e2e");
}

/** 失败时把当前 SharedPreferences 内容落盘（诊断证据） */
export function dumpPrefsToFile(serial: string, tag: string): void {
  try {
    const prefs = readClientPrefs(serial);
    const dir = snapshotDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(resolve(dir, `${tag}-CapacitorStorage.xml`), prefs.rawXml || "(文件不存在)");
  } catch {
    // 诊断落盘失败不阻断主流程
  }
}
