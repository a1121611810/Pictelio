// ─── @pictelio/update-check ───
// Pictelio 更新检查共享库：主 app（pictelio-app）与 app-lynx 共用同一份实现，
// 版本比较 / 拉取 URL / 超时 / 错误兜底 一处维护（单一事实源）。
//
// 契约：packages/website/version.json，字段 version / url / release_url / changelog
// （url 为 scripts/release.mjs 生成的历史字段，release_url 为未来扩展兼容项）；
// OTA 扩展字段 minWebVersion / webBundle（docs/specs/ota-web-bundle.md「版本与数据源」，
// 旧客户端未知字段忽略，缺失 = 显式 undefined 交由消费端 fail-open，不在本层伪造默认值）。
//
// 设计要点：
// - checkForUpdate(localVersion, fetchImpl?)：本地版本显式传入（不依赖全局常量），
//   fetchImpl 依赖注入（accept dependencies, don't create them）——测试直接传 mock，
//   不 stub 全局 fetch；app-lynx 可传其环境适配层 requestFetch。
// - error 字段区分「检查失败」与「无更新」：失败时带原因并 console.warn（禁止静默降级）。

export interface CheckResult {
  hasUpdate: boolean
  latestVersion: string
  latestReleaseUrl: string
  latestChangelog: string
  /** web 层强制门槛 floor（OTA web bundle）：undefined = 未设门槛（fail-open 判定由消费端做） */
  minWebVersion?: string
  /** OTA bundle 元数据：version + 三件套资产前缀 URL（拼 -manifest.json / .sig / -web-bundle.zip） */
  webBundle?: WebBundleMeta
  /** 检查失败原因（undefined = 检查成功且已解析远端数据） */
  error?: string
}

/** version.json 的 webBundle 子对象（checksum/minApkVersion 只存在于签名的 manifest，不进本契约） */
export interface WebBundleMeta {
  version: string
  url: string
}

/** 可注入的 fetch 依赖（标准 DOM 类型；缺省用全局 fetch，app-lynx 传 requestFetch） */
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>

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
    .map((s) => Number(s) || 0)
  const rParts = remote
    .trim()
    .replace(/^v/i, "")
    .split(".")
    .map((s) => Number(s) || 0)

  // 只比较 major.minor.patch（标准 semver 三段）
  for (let i = 0; i < 3; i++) {
    const l = lParts[i] ?? 0
    const r = rParts[i] ?? 0
    if (r > l) return true
    if (r < l) return false
  }
  return false // equal
}

// ── 核心 fetch ──

/**
 * 强制门槛判定（OTA web bundle）：local 低于 floor 返回 true。
 * 语义 = isNewer(local, floor)（floor 较新 ⟺ local 未达标）；floor 缺失/空 → false
 * （fail-open，不设门槛）。签名接受 undefined：消费端可直接透传
 * CheckResult.minWebVersion（string | undefined）。差分断言见 tests
 * （oracle：docs/specs/ota-web-bundle.md「版本与数据源」）。
 */
export function isBelowMin(local: string, floor?: string): boolean {
  if (!floor?.trim()) return false
  return isNewer(local, floor)
}

/**
 * webBundle 脏数据防御：字段缺失（undefined/null）= 未发布 OTA，静默视为不存在；
 * 字段存在但非法 = 契约破坏，必须 warn 可见（禁静默降级），同样按不存在处理。
 */
function parseWebBundle(raw: unknown): WebBundleMeta | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "object") {
    console.warn("[update-check] webBundle 字段存在但非法（非对象），按无 bundle 更新处理")
    return undefined
  }
  const { version, url } = raw as { version?: unknown; url?: unknown }
  if (typeof version !== "string" || !version.trim() || typeof url !== "string" || !url.trim()) {
    console.warn("[update-check] webBundle 字段残缺（version/url 缺失或非法），按无 bundle 更新处理")
    return undefined
  }
  return { version: version.trim(), url: url.trim() }
}

/** minWebVersion 脏数据防御：缺失静默视为未设门槛；存在但非法 → warn（契约破坏可见） */
function parseMinWebVersion(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== "string" || !raw.trim()) {
    console.warn(
      `[update-check] minWebVersion 字段存在但非法（${JSON.stringify(raw)}），按未设门槛处理`,
    )
    return undefined
  }
  return raw.trim()
}

// 通过 raw.githubusercontent.com 获取版本信息（直连，不被 Pixiv 代理拦截）；
// repo 曾用名 pixivizer，已重命名为 Pictelio；若 repo 迁移需同步此处。
const UPDATE_URL =
  "https://raw.githubusercontent.com/a1121611810/Pictelio/main/packages/website/version.json"

const CHECK_TIMEOUT_MS = 10_000

const EMPTY_RESULT: CheckResult = {
  hasUpdate: false,
  latestVersion: "",
  latestReleaseUrl: "",
  latestChangelog: "",
}

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
  const fetchFn: FetchLike = fetchImpl ?? ((input, init) => fetch(input, init))
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS)

  let res: Response
  try {
    res = await fetchFn(UPDATE_URL, { signal: controller.signal })
  } catch (err) {
    clearTimeout(timeoutId)
    console.warn("[update-check] 检查更新失败:", err)
    return { ...EMPTY_RESULT, error: err instanceof Error ? err.message : String(err) }
  }
  clearTimeout(timeoutId)

  if (!res.ok) {
    console.warn(`[update-check] 检查更新失败: HTTP ${res.status}`)
    return { ...EMPTY_RESULT, error: `HTTP ${res.status}` }
  }

  let parsed: unknown
  try {
    parsed = await res.json()
  } catch (err) {
    // 200 但响应体非 JSON（如网关错误页）：解析失败同样按检查失败处理
    console.warn("[update-check] 解析 version.json 失败:", err)
    return { ...EMPTY_RESULT, error: err instanceof Error ? err.message : String(err) }
  }
  // res.json() 对「合法 JSON 但非对象」的 body（字面量 null / 数组 / 字符串）原样返回，
  // 同样按检查失败处理——「调用方无需 try/catch」的契约不能被脏 body 击穿
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn("[update-check] version.json 响应体非对象，按检查失败处理")
    return { ...EMPTY_RESULT, error: "invalid body: not an object" }
  }
  const data = parsed as {
    version?: unknown
    url?: unknown
    release_url?: unknown
    changelog?: unknown
    minWebVersion?: unknown
    webBundle?: unknown
  }

  const remoteVersion = typeof data.version === "string" ? data.version : ""
  const hasUpdate = remoteVersion ? isNewer(localVersion, remoteVersion) : false

  // trim 口径：新字段（minWebVersion/webBundle）入库前 trim；存量字段保持原样透传
  // （isNewer 内部自带 trim，行为不变——避免对既有消费方的语义漂移）
  return {
    hasUpdate,
    latestVersion: remoteVersion,
    latestReleaseUrl:
      typeof data.url === "string" ? data.url : typeof data.release_url === "string" ? data.release_url : "",
    latestChangelog: typeof data.changelog === "string" ? data.changelog : "",
    minWebVersion: parseMinWebVersion(data.minWebVersion),
    webBundle: parseWebBundle(data.webBundle),
  }
}
