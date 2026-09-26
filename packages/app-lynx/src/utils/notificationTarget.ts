// ─── 通知 target_url 解析（ADR-0188 D6 / spec 边界）───
// 纯函数层（node 可单测）+ 运行时跳转层（对齐 utils/novelNavigation 的 utils→router 先例）。
//
// lynx 平台陷阱（ADR-0163）：禁 new URL()——URL polyfill 的 .hostname 为 undefined，
// 本文件全程字符串方法解析。
//
// scheme 映射（D6）：
//   pixiv://users/{id}   → 端内 /user/{id}
//   pixiv://illusts/{id} → 端内 /illust/{id}
//   pixiv://novels/{id}  → 端内小说（经 openNovel 缝隙：尊重介绍页开关，ADR-0183；
//                          关 = 直达 /novel/{id}，与票面终点一致）
//   http(s)://           → 系统浏览器（utils/nativeUrl 单点）
//   其它 scheme          → 静默忽略（不抛错，Shaft 同语义）

import { navigate } from "../router"
import { openExternalUrl } from "./nativeUrl"
import { openNovel } from "./novelNavigation"

/** 解析结果：route = 端内路由 / external = 系统外链 / ignore = 静默忽略 */
export type NotificationTarget =
  | { kind: "user"; id: number }
  | { kind: "illust"; id: number }
  | { kind: "novel"; id: number }
  | { kind: "external"; url: string }
  | { kind: "ignore" }

/** pixiv:// 主机段 → 目标 kind（仅三 scheme；未知主机段忽略） */
const PIXIV_HOST_KINDS: Record<string, "user" | "illust" | "novel"> = {
  users: "user",
  illusts: "illust",
  novels: "novel",
}

/** 数字 id 串（剥尾部 query/hash 后须全数字，防注入与畸形导航） */
const NUMERIC_RE = /^\d+$/

export function resolveNotificationTarget(
  targetUrl: string | null | undefined,
): NotificationTarget {
  if (!targetUrl) return { kind: "ignore" }
  if (targetUrl.startsWith("pixiv://")) {
    const rest = targetUrl.slice("pixiv://".length)
    const slash = rest.indexOf("/")
    if (slash === -1) return { kind: "ignore" }
    const kind = PIXIV_HOST_KINDS[rest.slice(0, slash)]
    if (!kind) return { kind: "ignore" }
    const rawId = rest.slice(slash + 1)
    // 剥尾部 query/hash（服务端后续加参不破坏数字形态）；query 前若有非数字段同样拒绝
    const idPart = rawId.split(/[?#]/, 1)[0] ?? ""
    if (!NUMERIC_RE.test(idPart)) return { kind: "ignore" }
    return { kind, id: Number(idPart) } as NotificationTarget
  }
  if (targetUrl.startsWith("https://") || targetUrl.startsWith("http://")) {
    return { kind: "external", url: targetUrl }
  }
  return { kind: "ignore" }
}

// ── 运行时跳转层（utils→router 先例：utils/novelNavigation.ts；import 见文件顶部）───

/**
 * 解析并跳转一条通知的 target_url。
 * ignore（未知 scheme/畸形 id）静默返回（不抛错，ADR-0188 D6）；外链经 nativeUrl 单点。
 */
export function openNotificationTarget(targetUrl: string | null | undefined): void {
  const target = resolveNotificationTarget(targetUrl)
  switch (target.kind) {
    case "user":
      void navigate(`/user/${target.id}`)
      return
    case "illust":
      void navigate(`/illust/${target.id}`)
      return
    case "novel":
      // 小说经 openNovel 缝隙（ADR-0183：介绍页开关；关 = 直达 /novel/{id}）
      openNovel(target.id)
      return
    case "external":
      openExternalUrl(target.url, "Notifications")
      return
    case "ignore":
      return
  }
}
