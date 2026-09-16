/**
 * SharedPreferences 契约工具（S1，issue #105）。
 *
 * 验证「WebView 侧写入 pictelio_client_kind → MainActivity 重启读取分发」这条
 * 跨进程数据契约。通过 adb 直接读/写真实 CapacitorStorage.xml（run-as 访问
 * debug 包私有目录），不 mock——沿用「真实数据源比对」契约测试原则。
 *
 * 写值的方式：debug 包可用 run-as 进入 app 数据目录写文件。直接覆写
 * CapacitorStorage.xml 模拟 app 写入后的状态，重启后断言 MainActivity 的分发
 * 行为，从而秒级区分「写入问题」与「分发问题」。
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

/** EnginePrefs.KEY_* 的 TS 镜像（唯一所有者 = Java
 *  android/.../engine/EnginePrefs.java；键字面量漂移由一致性测试/本文件注释锚定）。
 *  E2E 侧只读这些键做取证播种，不在此处发明新键。 */
export const ENGINE_KEYS = {
  /** 首选引擎（"lynx" | "webview"；翻转后缺省语义 = lynx） */
  preferredKind: "pictelio_client_kind",
  /** 运行时自动回退开关（"true" | "false"；缺省 true） */
  autoFallback: "pictelio_engine_auto_fallback",
  /** Lynx 失败记忆（versionCode 十进制字符串；与当前版本精确相等才命中） */
  failureMemory: "pictelio_engine_lynx_failure_version",
  /** 生效状态快照（每次 EngineRouting.resolve 覆写） */
  state: "pictelio_engine_state",
  /** webview 提示条「不再提示」 */
  fallbackOptout: "pictelio_engine_fallback_optout",
  /** E2E 取证键：强制 Lynx 探针返回 false（仅 DEBUG 构建被读取，release 无此分支） */
  debugForceLynxUnavailable: "pictelio_debug_force_lynx_unavailable",
} as const;

/** 生效状态快照（EngineRoute.snapshotLine 解析结果；spec §3 / §3.1） */
export interface EngineStateSnapshot {
  /** 首选引擎（"lynx" | "webview"） */
  preferred: string;
  /** 本次生效引擎；null = effective=none（双失败，无引擎生效，落升级页） */
  effective: string | null;
  /** 降级原因码（spec §3.1 稳定 ASCII） */
  reason: string;
}

/**
 * 解析快照行 `preferred=<kind|none> effective=<kind|none> reason=<code>`
 * （格式唯一来源 = Java EngineRoute.snapshotLine()）。畸形行 → null（E11：
 * 禁止静默——解析失败按「无快照」处理，不构造部分合法的假数据）。
 * 纯函数，单测直接覆盖（unit/prefs.engineState.test.ts）。
 */
export function parseEngineState(raw: string | null): EngineStateSnapshot | null {
  if (raw === null) return null;
  // 锚定整行（^…$）：值被污染（前后混入其他内容）时按畸形处理，不误提取
  const m = /^preferred=(\S+) effective=(\S+) reason=(\S+)$/u.exec(raw);
  if (!m) return null;
  const preferred = m[1];
  const effectiveRaw = m[2];
  const reason = m[3];
  if (preferred === undefined || effectiveRaw === undefined || reason === undefined) return null;
  return {
    preferred,
    effective: effectiveRaw === "none" ? null : effectiveRaw,
    reason,
  };
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
 * 读取引擎生效状态快照（KEY_STATE 行 → 结构化；配合 pollEngineState 轮询）。
 * 键不存在 / 行畸形 → null。
 */
export function readEngineState(serial: string): EngineStateSnapshot | null {
  return parseEngineState(readPrefValue(serial, ENGINE_KEYS.state));
}

/**
 * 轮询引擎状态快照直到谓词满足（pollPrefs 的引擎态镜像，#557 T5）。
 *
 * 为什么必须轮询：快照由 Java 侧 SharedPreferences.apply() 异步落盘（见
 * pollPrefs 注释的同款竞态），adb 直读是落盘瞬间的文件——「快照已发布」断言
 * 必须按固定间隔重读。
 *
 * @param predicate 判定快照是否满足期望（满足即停；传 `(s) => s !== null` 即
 *   「等快照首次出现」，随后用 expect toEqual 做精确断言——失败时 vitest 差异
 *   直接给出真实快照，诊断优于在谓词里静默等满超时）
 * @returns 满足谓词的那次快照
 * @throws Error 超时未满足：消息含最后一次快照原始值（诊断用）
 */
export async function pollEngineState(
  serial: string,
  predicate: (state: EngineStateSnapshot | null) => boolean,
  timeoutMs = 30_000,
  intervalMs = 1_000,
  readFn: (serial: string) => EngineStateSnapshot | null = readEngineState,
): Promise<EngineStateSnapshot | null> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const state = readFn(serial);
    if (predicate(state)) return state;
    if (Date.now() >= deadline) {
      throw new Error(
        `[android-e2e] pollEngineState 轮询超时（timeoutMs=${timeoutMs}, intervalMs=${intervalMs}）。` +
          `最后一次 ${ENGINE_KEYS.state} 原始值: ${readPrefValue(serial, ENGINE_KEYS.state) ?? "(键不存在)"}`,
      );
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
  }
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
