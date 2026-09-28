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
 * 因此本文件保留的 `writeClientKind` 只剩「通用 pref 覆写 + 回读校验」语义，
 * **不再**具备「切换引擎」的被测价值；相关引擎状态快照工具（`ENGINE_KEYS` /
 * `parseEngineState` / `readEngineState` / `pollEngineState`）已随
 * `engine-fallback-matrix` 等 spec 一并删除（其 oracle `EnginePrefs.java` /
 * `EngineRoute.snapshotLine()` 在源码树中已不存在）。
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
 * 覆写设备上 CapacitorStorage.xml 的 pictelio_client_kind 值（模拟 app 写入）。
 * 用 run-as sh -c 相对路径写文件（run-as 的 cwd 即 app 数据目录，绝对路径
 * 重定向被 SELinux 拒）。先 cat 原文件替换值再写回，文件不存在则新建。
 * 返回覆写后的实际值（供断言比对，防止 shell 转义问题）。
 */
export function writeClientKind(serial: string, kind: "webview" | "lynx"): string {
  const cur = readClientPrefs(serial);
  let xml: string;
  if (cur.fileExists) {
    // 兼容两种序列化形式的替换
    xml = cur.rawXml
      .replace(
        /<string name="pictelio_client_kind">[^<]*<\/string>/u,
        `<string name="pictelio_client_kind">${kind}</string>`,
      )
      .replace(
        /name="pictelio_client_kind"\s+value="[^"]*"/u,
        `name="pictelio_client_kind" value="${kind}"`,
      );
    if (!xml.includes("pictelio_client_kind")) {
      // 原文件没有该键，插入到 <map> 内；空 map 是自闭合 <map /> 需单独处理
      // （新装 app 的 CapacitorStorage.xml 实测为 <map />，2026-08-29 T0 踩中）
      xml = /<map\s*\/>/u.test(xml)
        ? xml.replace(
            /<map\s*\/>/u,
            `<map>\n    <string name="pictelio_client_kind">${kind}</string>\n</map>`,
          )
        : xml.replace(/<map>/u, `<map>\n    <string name="pictelio_client_kind">${kind}</string>`);
    }
  } else {
    xml = `<?xml version='1.0' encoding='utf-8' standalone='yes' ?>\n<map>\n    <string name="pictelio_client_kind">${kind}</string>\n</map>\n`;
  }
  // run-as sh -c 相对路径写（base64 避免 shell 转义陷阱）。
  // 注意：整段 run-as 命令必须作为 adb shell 的单个字符串参数（adb 会把数组
  // 元素重新拼接，拆成多参数会导致 sh -c 脚本被误拆）。
  const b64 = Buffer.from(xml, "utf8").toString("base64");
  const script = `mkdir -p shared_prefs && echo ${b64} | base64 -d > ${PREFS_REL} && chmod 660 ${PREFS_REL} && cat ${PREFS_REL}`;
  const adbCmd = `run-as ${APP_PACKAGE} sh -c '${script}'`;
  const r = runCapture(adbPath(), ["-s", serial, "shell", adbCmd]);
  if (r.code !== 0) {
    throw new Error(
      `[android-e2e] 覆写 ${APP_PACKAGE} 的 pictelio_client_kind=${kind} 失败（code ${r.code}）。` +
        `stderr: ${r.stderr}\n请确认 debug 包可 run-as（安装的是 debug APK）`,
    );
  }
  const written = readClientPrefs(serial);
  if (written.clientKind !== kind) {
    throw new Error(
      `[android-e2e] 写入后校验失败：期望 ${kind}，实际 ${written.clientKind}（${written.rawXml}）`,
    );
  }
  return kind;
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
      : // 空 map 自闭合 <map /> 兼容（同 writeClientKind，2026-08-29 T0 踩中）
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

/** 强制停止 app（清后台进程，重启时走 onCreate 入口路由）。
 *  注意：不等待 pidof 消失——force-stop 后 am start 会启动新进程读最新 prefs；
 *  等待反而可能因旧进程未死透被 am start 复用（读缓存 prefs）导致不分发。 */
export function forceStopApp(serial: string): void {
  runOrThrow(adbPath(), ["-s", serial, "shell", "am", "force-stop", APP_PACKAGE], TIMEOUTS.adb);
}

/** 通过 am start 启动主入口 Activity（按 flavor：full → MainActivity；webview → MainActivityWebview）
 *  —— 走入口 onCreate 的版本门禁 / 引擎路由分发。 */
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
 * token 缺省取 `process.env.PIXIV_REFRESH_TOKEN`（globalSetup 从 packages/app/.env 注入）。
 * 超时即抛错并带上 logcat 尾部——**不做静默降级**：登录失败若被吞掉，
 * 下游用例会以「内容为空」的形式给出完全误导的失败信息。
 */
export async function loginViaDevIntent(
  serial: string,
  token = process.env.PIXIV_REFRESH_TOKEN,
  timeoutMs = 90_000,
  forceR18 = true,
): Promise<void> {
  if (!token) {
    throw new Error(
      "[android-e2e] dev hook 登录缺少 PIXIV_REFRESH_TOKEN。" +
        "请确认 packages/app/.env 存在该键，或显式传入 token 参数。",
    );
  }
  // 先杀进程，保证下面的 am start 走完整启动流程并触发 applyDevIntentHooks
  forceStopApp(serial);
  runOrThrow(adbPath(), ["-s", serial, ...devLoginIntentArgs(token, forceR18)], TIMEOUTS.adb);

  const deadline = Date.now() + timeoutMs;
  let tail = "";
  while (Date.now() < deadline) {
    tail = readAppLogcat(serial);
    if (tail.includes(DEV_LOGIN_SUCCESS_MARK)) {
      console.log("[android-e2e] ✓ dev hook 登录完成（已在 logcat 见到成功标记）");
      return;
    }
    // 失败不做特殊分支：dev hook 的失败路径日志串未在源码中固定，交给超时分支统一暴露
    await sleep(1_000);
  }
  throw new Error(
    `[android-e2e] dev hook 登录超时（${timeoutMs / 1000}s），未等到「${DEV_LOGIN_SUCCESS_MARK}」。\n` +
      `logcat 尾部（已去敏，前 2000 字符）：\n${redactSecrets(tail).slice(0, 2_000)}`,
  );
}

/**
 * 日志去敏：把 refresh_token 明文替换掉。
 *
 * #817 前这里只有 `slice(0, 2000)` 却把结果称作「去敏后」——名不副实。token 经
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
        `S1 契约测试需要 debug APK（run-as 访问私有目录）。请用 pnpm build:android 安装 debug 包。`,
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
