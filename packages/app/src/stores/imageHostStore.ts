import { jsonCodec, settings } from "@/settings";
import { isNativePlatform } from "@/utils/platform";

type ImageHostMode = "race" | "weighted" | "fastest-ip" | "single";

export interface ImageHost {
  id: string;
  name: string;
  baseUrl: string;
  enabled: boolean;
  weight: number;
  isBuiltIn: boolean;
  edited: boolean;
}

export interface ProbeResult {
  hostId: string;
  hostName: string;
  baseUrl: string;
  reachable: boolean;
  latencyMs: number | null;
}

interface ImageHostState {
  masterEnabled: boolean;
  mode: ImageHostMode;
  selectedHostId: string | null;
  hosts: ImageHost[];
  probeResults: ProbeResult[];
  fastestHostId: string | null;
  fastestHostExpiresAt: number | null;
}

const PREF_KEY = "image_host_settings";

export const BUILT_IN_HOSTS: ImageHost[] = [
  {
    id: "pixiv-re",
    name: "Pixiv.re",
    baseUrl: "https://i.pixiv.re",
    enabled: true,
    weight: 100,
    isBuiltIn: true,
    edited: false,
  },
  {
    id: "pixiv-nl",
    name: "Pixiv.nl",
    baseUrl: "https://i.pixiv.nl",
    enabled: true,
    weight: 100,
    isBuiltIn: true,
    edited: false,
  },
  {
    id: "pixivel",
    name: "Pixivel",
    baseUrl: "https://api.pixiv.cat/v1/generate",
    enabled: false,
    weight: 50,
    isBuiltIn: true,
    edited: false,
  },
];

function defaultState(): ImageHostState {
  return {
    masterEnabled: false,
    mode: "weighted",
    selectedHostId: null,
    hosts: BUILT_IN_HOSTS.map((h) => ({ ...h })),
    probeResults: [],
    fastestHostId: null,
    fastestHostExpiresAt: null,
  };
}

/** 本次会话已告警过的明文 HTTP host id（spec #382 Q2：幂等告警，重复 hydrate 不刷屏） */
const cleartextWarnedHostIds = new Set<string>();

export function migrateLegacyState(
  raw: unknown,
  native: boolean = isNativePlatform(),
): ImageHostState {
  if (typeof raw !== "object" || raw === null) {
    return defaultState();
  }

  const legacy = raw as Partial<ImageHostState> & {
    fastestHostId?: string | null;
    fastestHostExpiresAt?: number | null;
  };

  const hosts: ImageHost[] = Array.isArray(legacy.hosts)
    ? legacy.hosts.map((h) => ({
        id: String(h.id ?? ""),
        name: String(h.name ?? ""),
        baseUrl: String(h.baseUrl ?? ""),
        enabled: Boolean(h.enabled),
        weight: Number(h.weight) || 1,
        isBuiltIn: "isBuiltIn" in h ? Boolean(h.isBuiltIn) : true,
        edited: "edited" in h ? Boolean(h.edited) : true,
      }))
    : defaultState().hosts;

  // 确保内置图床至少存在，避免升级后丢失
  for (const builtIn of BUILT_IN_HOSTS) {
    if (!hosts.some((h) => h.id === builtIn.id)) {
      hosts.push({ ...builtIn });
    }
  }

  // 存量明文 HTTP 图床处置（spec #382 Q2）：native 下系统层拒绝 cleartext 请求（保存口
  // 已拦截新增，这里是历史存量），置为未启用 + 可见告警——死配置不再参与下载决策；
  // 用户改用 https:// 后可重新启用。web/dev 无此限制，不迁移。
  if (native) {
    const dead = hosts.filter((h) => h.enabled && h.baseUrl.startsWith("http://"));
    if (dead.length > 0) {
      const fresh = dead.filter((h) => !cleartextWarnedHostIds.has(h.id));
      if (fresh.length > 0) {
        console.warn(
          `[imageHostStore] 已停用 ${fresh.length} 个 http:// 图床（Android 禁止明文 HTTP）: ` +
            fresh.map((h) => h.name).join(", "),
        );
        for (const h of fresh) {
          cleartextWarnedHostIds.add(h.id);
        }
      }
      for (const h of hosts) {
        if (h.baseUrl.startsWith("http://")) {
          h.enabled = false;
        }
      }
    }
  }

  const mode =
    legacy.mode === "race" ||
    legacy.mode === "weighted" ||
    legacy.mode === "fastest-ip" ||
    legacy.mode === "single"
      ? legacy.mode
      : "weighted";

  return {
    masterEnabled: Boolean(legacy.masterEnabled),
    mode,
    selectedHostId: legacy.selectedHostId ?? null,
    hosts,
    probeResults: [],
    fastestHostId: legacy.fastestHostId ?? null,
    fastestHostExpiresAt: legacy.fastestHostExpiresAt ?? null,
  };
}

/** 基础形状校验（decode → migrate 之后执行） */
function isImageHostState(v: unknown): v is ImageHostState {
  if (typeof v !== "object" || v === null) return false;
  const s = v as Partial<ImageHostState>;
  return (
    typeof s.masterEnabled === "boolean" &&
    (s.mode === "race" ||
      s.mode === "weighted" ||
      s.mode === "fastest-ip" ||
      s.mode === "single") &&
    (s.selectedHostId === null || typeof s.selectedHostId === "string") &&
    Array.isArray(s.hosts) &&
    Array.isArray(s.probeResults) &&
    (s.fastestHostId === null || typeof s.fastestHostId === "string") &&
    (s.fastestHostExpiresAt === null || typeof s.fastestHostExpiresAt === "number")
  );
}

const imageHostSetting = settings.define<ImageHostState>({
  key: PREF_KEY,
  default: defaultState(),
  codec: jsonCodec,
  migrate: migrateLegacyState,
  validate: isImageHostState,
  onError: (err, phase) => console.warn(`[imageHostStore] ${phase} failed`, err),
});

export const imageHostState = imageHostSetting.value;

/**
 * SolidJS 2.0 批处理语义（#415）：以下 setter 全部是「读 imageHostState() → 改 → 整体
 * set」的读-改-写模式。2.0 下 set 后同步读返回旧值，同 tick 内连续两次 set 会让后一次
 * 基于旧状态展开、覆盖前一次的变更（丢失更新）。命令式动作边界统一先 flush 再读，
 * 保证每次 set 基于上一次 set 的已提交结果（1.x 同步语义）。
 */
function mutateState(mutate: (state: ImageHostState) => ImageHostState): void {
  imageHostSetting.set(mutate(imageHostState()));
  // set 后立即 flush：本 setter 的写入对「下一个 setter 的读-改-写」和调用方的
  // 同步读（如 setProbeResults 后立即 getFastestHost）同步可见，保持 1.x 语义
  flush();
}

export function setMasterEnabled(enabled: boolean): void {
  mutateState((s) => ({
    ...s,
    masterEnabled: enabled,
  }));
}

export function setMode(mode: ImageHostMode): void {
  mutateState((s) => ({
    ...s,
    mode,
    fastestHostId: null,
    fastestHostExpiresAt: null,
    // "single" mode auto-selects first enabled host
    selectedHostId:
      mode === "single" ? s.selectedHostId || getEnabledHosts()[0]?.id || null : s.selectedHostId,
  }));
}

export function setSelectedHostId(hostId: string | null): void {
  mutateState((s) => ({
    ...s,
    selectedHostId: hostId,
  }));
}

export function updateHost(id: string, patch: Partial<Omit<ImageHost, "id" | "isBuiltIn">>): void {
  mutateState((s) => ({
    ...s,
    hosts: s.hosts.map((host) => {
      if (host.id !== id) {
        return host;
      }
      const edited = host.isBuiltIn
        ? Object.keys(patch).some((key) => {
            const k = key as keyof typeof patch;
            return patch[k] !== undefined && patch[k] !== host[k];
          })
        : host.edited;
      return Object.assign({}, host, patch, { edited });
    }),
  }));
}

export function resetBuiltInHost(id: string): void {
  const builtIn = BUILT_IN_HOSTS.find((h) => h.id === id);
  if (!builtIn) {
    return;
  }

  mutateState((s) => ({
    ...s,
    hosts: s.hosts.map((host) => (host.id === id ? Object.assign({}, builtIn) : host)),
  }));
}

export function resetAllBuiltInHosts(): void {
  mutateState((s) => ({
    ...s,
    hosts: [
      ...BUILT_IN_HOSTS.map((h) => Object.assign({}, h)),
      ...s.hosts.filter((h) => !h.isBuiltIn),
    ],
    probeResults: [],
    fastestHostId: null,
    fastestHostExpiresAt: null,
  }));
}

export function addCustomHost(host: Omit<ImageHost, "id" | "isBuiltIn" | "edited">): void {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  mutateState((s) => ({
    ...s,
    hosts: [
      ...s.hosts,
      {
        ...host,
        id,
        isBuiltIn: false,
        edited: true,
      },
    ],
  }));
}

export function removeCustomHost(id: string): void {
  mutateState((s) => ({
    ...s,
    hosts: s.hosts.filter((h) => h.id !== id),
  }));
}

export function setProbeResults(results: ProbeResult[]): void {
  const sorted = results.toSorted((a, b) => {
    if (a.reachable !== b.reachable) {
      return a.reachable ? -1 : 1;
    }
    if (a.latencyMs == null) {
      return 1;
    }
    if (b.latencyMs == null) {
      return -1;
    }
    return a.latencyMs - b.latencyMs;
  });

  const fastest = sorted.find((r) => r.reachable);
  mutateState((s) => ({
    ...s,
    probeResults: sorted,
    fastestHostId: fastest?.hostId ?? null,
    fastestHostExpiresAt: fastest ? Date.now() + 30_000 : null,
  }));
}

export function modeLabel(mode: ImageHostMode): string {
  return mode === "race"
    ? "并发请求"
    : mode === "weighted"
      ? "负载均衡"
      : mode === "fastest-ip"
        ? "最快 IP 地址"
        : "单一图床";
}

/** 兼容存根：加载已持久化的图床设置（实际由 registry hydrate 管线处理） */
export async function loadImageHostPreference(): Promise<void> {
  await imageHostSetting.hydrate();
}

export function isImageHostEnabled(): boolean {
  return imageHostState().masterEnabled && imageHostState().hosts.some((h) => h.enabled);
}

/** 获取当前状态下用于图片加载的同步候选 URL（race/fastest-ip 模式可能回退到首个启用图床）。 */
export function getEnabledHosts(): ImageHost[] {
  return imageHostState().hosts.filter((h) => h.enabled);
}

export function getFastestHost(): ImageHost | undefined {
  const { fastestHostId, fastestHostExpiresAt } = imageHostState();
  if (!fastestHostId) {
    return undefined;
  }
  if (fastestHostExpiresAt && Date.now() > fastestHostExpiresAt) {
    return undefined;
  }
  return imageHostState().hosts.find((h) => h.id === fastestHostId);
}
