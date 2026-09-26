// ─── 通知 target_url 解析（ADR-0188 D6 / spec 边界）───
// 纯函数层（node 可单测）+ 运行时跳转层。
// 与 lynx 端（packages/app-lynx）同语义双端各自实现，测试用例逐字同构（differential）。
//
// 全程字符串方法解析（lynx 平台陷阱的统一姿态：不依赖 new URL，双端实现逐字同构）。
//
// scheme 映射（D6）：
//   pixiv://users/{id}   → 端内 /user/{id}
//   pixiv://illusts/{id} → 端内 /illust/{id}
//   pixiv://novels/{id}  → 端内 /novel/{id}（webview 无小说介绍页缝隙，直达详情；
//                          lynx 侧经 openNovel 缝隙尊重介绍页开关，终点一致）
//   http(s)://           → 系统浏览器（webview 现有外链通道 window.open，noopener）
//   其它 scheme          → 静默忽略（不抛错，Shaft 同语义）

/** 解析结果：route = 端内路由 / external = 系统外链 / ignore = 静默忽略 */
export type NotificationTarget =
  | { kind: "user"; id: number }
  | { kind: "illust"; id: number }
  | { kind: "novel"; id: number }
  | { kind: "external"; url: string }
  | { kind: "ignore" };

/** pixiv:// 主机段 → 目标 kind（仅三 scheme；未知主机段忽略） */
const PIXIV_HOST_KINDS: Record<string, "user" | "illust" | "novel"> = {
  users: "user",
  illusts: "illust",
  novels: "novel",
};

/** 数字 id 串（剥尾部 query/hash 后须全数字，防注入与畸形导航） */
const NUMERIC_RE = /^\d+$/;

export function resolveNotificationTarget(
  targetUrl: string | null | undefined,
): NotificationTarget {
  if (!targetUrl) return { kind: "ignore" };
  if (targetUrl.startsWith("pixiv://")) {
    const rest = targetUrl.slice("pixiv://".length);
    const slash = rest.indexOf("/");
    if (slash === -1) return { kind: "ignore" };
    const kind = PIXIV_HOST_KINDS[rest.slice(0, slash)];
    if (!kind) return { kind: "ignore" };
    const rawId = rest.slice(slash + 1);
    // 剥尾部 query/hash（服务端后续加参不破坏数字形态）；query 前若有非数字段同样拒绝
    const idPart = rawId.split(/[?#]/, 1)[0] ?? "";
    if (!NUMERIC_RE.test(idPart)) return { kind: "ignore" };
    return { kind, id: Number(idPart) } as NotificationTarget;
  }
  if (targetUrl.startsWith("https://") || targetUrl.startsWith("http://")) {
    return { kind: "external", url: targetUrl };
  }
  return { kind: "ignore" };
}

// ── 运行时跳转层 ──
// webview 的 useNavigate 是组件上下文 hook，由调用方（Notifications 页）注入——
// 本层不直接持有 router 引用，保持 utils 无组件依赖（纯函数可单测）。

/** 端内路由跳转函数（由页面注入 useNavigate 的产物） */
export type NotificationNavigator = (path: string) => void;

/**
 * 解析并跳转一条通知的 target_url。
 * ignore（未知 scheme/畸形 id）静默返回（不抛错，ADR-0188 D6）；
 * 外链走 webview 现有通道 window.open（noopener，RankingR18Notice/Settings 同款）。
 */
export function openNotificationTarget(
  targetUrl: string | null | undefined,
  navigate: NotificationNavigator,
): void {
  const target = resolveNotificationTarget(targetUrl);
  switch (target.kind) {
    case "user":
      navigate(`/user/${target.id}`);
      return;
    case "illust":
      navigate(`/illust/${target.id}`);
      return;
    case "novel":
      navigate(`/novel/${target.id}`);
      return;
    case "external":
      window.open(target.url, "_blank", "noopener,noreferrer");
      return;
    case "ignore":
      return;
  }
}
