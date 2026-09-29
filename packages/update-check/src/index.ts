// ─── @pictelio/update-check ───
// Pictelio 更新检查共享库：主 app（pictelio-app）与 app-lynx 共用同一份实现，
// 版本比较 / 拉取 URL / 超时 / 错误兜底 一处维护（单一事实源）。
//
// 契约：packages/website/version.json，字段 version / url / release_url / changelog
// （url 为 scripts/release.mjs 生成的历史字段，release_url 为未来扩展兼容项）；
// 未知字段一律忽略，不在本层伪造默认值。
//
// ⚠️ 本包**只服务 APK 更新检查**。OTA web bundle 的双坐标契约（minWebVersion /
// webBundle / WebBundleMeta / isBelowMin）已随发布通道下线（ADR-0202）与 WebView
// 客户端源码删除（ADR-0203）整体移除——其唯一消费层是已删的 `packages/app/src/**`。
// 不得以「消费层将来要回来」为理由加回：那会让 isBelowMin 再次成为恒空读。
// 历史设计见 docs/specs/ota-web-bundle.md（存档，正文一字不改）。
//
// 设计要点：
// - checkForUpdate(localVersion, fetchImpl?)：本地版本显式传入（不依赖全局常量），
//   fetchImpl 依赖注入（accept dependencies, don't create them）——测试直接传 mock，
//   不 stub 全局 fetch；app-lynx 可传其环境适配层 requestFetch。
// - error 字段区分「检查失败」与「无更新」：失败时带原因并 console.warn（禁止静默降级）。

export interface CheckResult {
  hasUpdate: boolean;
  latestVersion: string;
  latestReleaseUrl: string;
  latestChangelog: string;
  /** 检查失败原因（undefined = 检查成功且已解析远端数据） */
  error?: string;
}

/** 可注入的 fetch 依赖（标准 DOM 类型；缺省用全局 fetch，app-lynx 传 requestFetch） */
export type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

// ── 版本比较（无 semver 依赖） ──

/**
 * 数值化比较两个版本串：remote 比 local 新返回 true。
 * 兼容：可选 v 前缀（大小写）、首尾空白、build metadata（+ 后缀）、不足三段（缺位按 0）、
 * 非数字段（按 0，防御脏输入不崩溃）。
 */
export function isNewer(local: string, remote: string): boolean {
  const lParts = local
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((s) => Number(s) || 0);
  const rParts = remote
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((s) => Number(s) || 0);

  // 只比较 major.minor.patch（标准 semver 三段）
  for (let i = 0; i < 3; i++) {
    const l = lParts[i] ?? 0;
    const r = rParts[i] ?? 0;
    if (r > l) return true;
    if (r < l) return false;
  }
  return false; // equal
}

// ── 核心 fetch ──

// 通过 raw.githubusercontent.com 获取版本信息（直连，不被 Pixiv 代理拦截）；
// repo 曾用名 pixivizer，已重命名为 Pictelio；若 repo 迁移需同步此处。
const UPDATE_URL =
  "https://raw.githubusercontent.com/a1121611810/Pictelio/main/packages/website/version.json";

const CHECK_TIMEOUT_MS = 10_000;

const EMPTY_RESULT: CheckResult = {
  hasUpdate: false,
  latestVersion: "",
  latestReleaseUrl: "",
  latestChangelog: "",
};

/**
 * 拉取远端最新版本并与本地 APK 版本比较。
 * 所有错误显式捕获并 console.warn（禁止静默降级）——失败返回安全默认值
 * 并带 error 原因，调用方无需 try/catch。
 *
 * @param localVersion 本地（当前安装）版本号，如 "4.5.0"
 * @param fetchImpl 可注入的 fetch 依赖；缺省用全局 fetch
 */
export async function checkForUpdate(
  localVersion: string,
  fetchImpl?: FetchLike,
): Promise<CheckResult> {
  const fetchFn: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init));
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchFn(UPDATE_URL, { signal: controller.signal });
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn("[update-check] 检查更新失败:", err);
    return { ...EMPTY_RESULT, error: err instanceof Error ? err.message : String(err) };
  }
  clearTimeout(timeoutId);

  if (!res.ok) {
    console.warn(`[update-check] 检查更新失败: HTTP ${res.status}`);
    return { ...EMPTY_RESULT, error: `HTTP ${res.status}` };
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    // 200 但响应体非 JSON（如网关错误页）：解析失败同样按检查失败处理
    console.warn("[update-check] 解析 version.json 失败:", err);
    return { ...EMPTY_RESULT, error: err instanceof Error ? err.message : String(err) };
  }
  // res.json() 对「合法 JSON 但非对象」的 body（字面量 null / 数组 / 字符串）原样返回，
  // 同样按检查失败处理——「调用方无需 try/catch」的契约不能被脏 body 击穿
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn("[update-check] version.json 响应体非对象，按检查失败处理");
    return { ...EMPTY_RESULT, error: "invalid body: not an object" };
  }
  const data = parsed as {
    version?: unknown;
    url?: unknown;
    release_url?: unknown;
    changelog?: unknown;
  };

  const remoteVersion = typeof data.version === "string" ? data.version : "";
  const hasUpdate = remoteVersion ? isNewer(localVersion, remoteVersion) : false;

  // 存量字段保持原样透传（isNewer 内部自带 trim，行为不变——避免对既有消费方的语义漂移）
  return {
    hasUpdate,
    latestVersion: remoteVersion,
    latestReleaseUrl:
      typeof data.url === "string"
        ? data.url
        : typeof data.release_url === "string"
          ? data.release_url
          : "",
    latestChangelog: typeof data.changelog === "string" ? data.changelog : "",
  };
}
