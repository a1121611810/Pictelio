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
import { adbPath, APP_PACKAGE, runCapture, runOrThrow, TIMEOUTS } from "./env";

/** CapacitorStorage.xml 在 app 数据目录内的相对路径（run-as 需相对路径，绝对路径被 SELinux 拒） */
const PREFS_REL = "shared_prefs/CapacitorStorage.xml";

export interface ClientPrefs {
  clientKind: "webview" | "lynx" | null;
  /** 文件是否存在（null 时区分「未初始化」与「文件缺失」） */
  fileExists: boolean;
  /** 原始 XML（失败诊断用） */
  rawXml: string;
}

/**
 * 读取设备上 CapacitorStorage.xml 的 pictelio_client_kind 值。
 * 用 run-as 访问 app 私有目录（debug 包可读）。文件不存在 → clientKind=null。
 */
export function readClientPrefs(serial: string): ClientPrefs {
  const r = runCapture(adbPath(), [
    "-s",
    serial,
    "shell",
    `run-as ${APP_PACKAGE} cat ${PREFS_REL}`,
  ]);
  if (r.code !== 0 || r.stdout.trim() === "") {
    // 文件可能不存在（首次启动前）
    return { clientKind: null, fileExists: false, rawXml: r.stdout };
  }
  const xml = r.stdout;
  // Capacitor/Android SharedPreferences 两种序列化形式都兼容：
  // ① <string name="key">value</string>（Capacitor Preferences 实际格式）
  // ② <string name="key" value="value"/>（少数实现）
  const m =
    /<string name="pictelio_client_kind">([^<]*)<\/string>/u.exec(xml) ??
    /name="pictelio_client_kind"\s+value="([^"]*)"/u.exec(xml);
  return {
    clientKind: (m?.[1] as ClientPrefs["clientKind"]) ?? null,
    fileExists: true,
    rawXml: xml,
  };
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
      // 原文件没有该键，插入到 <map> 内
      xml = xml.replace(
        /<map>/u,
        `<map>\n    <string name="pictelio_client_kind">${kind}</string>`,
      );
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

/** 通过 am start 启动 MainActivity（走 MainActivity.onCreate 入口路由分发） */
export function startMainActivity(serial: string): void {
  runOrThrow(
    adbPath(),
    ["-s", serial, "shell", "am", "start", "-n", "io.pictelio.app/io.pictelio.app.MainActivity"],
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
