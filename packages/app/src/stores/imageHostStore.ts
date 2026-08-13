import { jsonCodec, settings } from "@/settings";

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

function migrateLegacyState(raw: unknown): ImageHostState {
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

export function setMasterEnabled(enabled: boolean): void {
  imageHostSetting.set({
    ...imageHostState(),
    masterEnabled: enabled,
  });
}

export function setMode(mode: ImageHostMode): void {
  imageHostSetting.set({
    ...imageHostState(),
    mode,
    fastestHostId: null,
    fastestHostExpiresAt: null,
    // "single" mode auto-selects first enabled host
    selectedHostId:
      mode === "single"
        ? imageHostState().selectedHostId || getEnabledHosts()[0]?.id || null
        : imageHostState().selectedHostId,
  });
}

export function setSelectedHostId(hostId: string | null): void {
  imageHostSetting.set({
    ...imageHostState(),
    selectedHostId: hostId,
  });
}

export function updateHost(id: string, patch: Partial<Omit<ImageHost, "id" | "isBuiltIn">>): void {
  const next: ImageHostState = {
    ...imageHostState(),
    hosts: imageHostState().hosts.map((host) => {
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
  };
  imageHostSetting.set(next);
}

export function resetBuiltInHost(id: string): void {
  const builtIn = BUILT_IN_HOSTS.find((h) => h.id === id);
  if (!builtIn) {
    return;
  }

  imageHostSetting.set({
    ...imageHostState(),
    hosts: imageHostState().hosts.map((host) =>
      host.id === id ? Object.assign({}, builtIn) : host,
    ),
  });
}

export function resetAllBuiltInHosts(): void {
  const custom = imageHostState().hosts.filter((h) => !h.isBuiltIn);
  imageHostSetting.set({
    ...imageHostState(),
    hosts: [...BUILT_IN_HOSTS.map((h) => Object.assign({}, h)), ...custom],
    probeResults: [],
    fastestHostId: null,
    fastestHostExpiresAt: null,
  });
}

export function addCustomHost(host: Omit<ImageHost, "id" | "isBuiltIn" | "edited">): void {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  imageHostSetting.set({
    ...imageHostState(),
    hosts: [
      ...imageHostState().hosts,
      {
        ...host,
        id,
        isBuiltIn: false,
        edited: true,
      },
    ],
  });
}

export function removeCustomHost(id: string): void {
  imageHostSetting.set({
    ...imageHostState(),
    hosts: imageHostState().hosts.filter((h) => h.id !== id),
  });
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
  imageHostSetting.set({
    ...imageHostState(),
    probeResults: sorted,
    fastestHostId: fastest?.hostId ?? null,
    fastestHostExpiresAt: fastest ? Date.now() + 30_000 : null,
  });
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
