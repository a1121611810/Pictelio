import { Preferences } from "@capacitor/preferences";

export type ImageHostMode = "race" | "weighted" | "fastest-ip" | "single";

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

const [state, setState] = createSignal<ImageHostState>(defaultState());

export const imageHostState = state;

async function persist(snapshot: ImageHostState): Promise<void> {
  const [err] = await tryAsync(Preferences.set({ key: PREF_KEY, value: JSON.stringify(snapshot) }));
  if (err) {
    console.warn("[imageHostStore] Failed to persist state", err);
  }
}

export function setMasterEnabled(enabled: boolean): void {
  const next = {
    ...state(),
    masterEnabled: enabled,
  };
  setState(next);
  void persist(next);
}

export function setMode(mode: ImageHostMode): void {
  const next = {
    ...state(),
    mode,
    fastestHostId: null,
    fastestHostExpiresAt: null,
    // "single" mode auto-selects first enabled host
    selectedHostId:
      mode === "single"
        ? state().selectedHostId || getEnabledHosts()[0]?.id || null
        : state().selectedHostId,
  };
  setState(next);
  void persist(next);
}

export function setSelectedHostId(hostId: string | null): void {
  const next = {
    ...state(),
    selectedHostId: hostId,
  };
  setState(next);
  void persist(next);
}

export function updateHost(id: string, patch: Partial<Omit<ImageHost, "id" | "isBuiltIn">>): void {
  const next: ImageHostState = {
    ...state(),
    hosts: state().hosts.map((host) => {
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
  setState(next);
  void persist(next);
}

export function resetBuiltInHost(id: string): void {
  const builtIn = BUILT_IN_HOSTS.find((h) => h.id === id);
  if (!builtIn) {
    return;
  }

  const next: ImageHostState = {
    ...state(),
    hosts: state().hosts.map((host) => (host.id === id ? Object.assign({}, builtIn) : host)),
  };
  setState(next);
  void persist(next);
}

export function resetAllBuiltInHosts(): void {
  const custom = state().hosts.filter((h) => !h.isBuiltIn);
  const next: ImageHostState = {
    ...state(),
    hosts: [...BUILT_IN_HOSTS.map((h) => Object.assign({}, h)), ...custom],
    probeResults: [],
    fastestHostId: null,
    fastestHostExpiresAt: null,
  };
  setState(next);
  void persist(next);
}

export function addCustomHost(host: Omit<ImageHost, "id" | "isBuiltIn" | "edited">): void {
  const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const next: ImageHostState = {
    ...state(),
    hosts: [
      ...state().hosts,
      {
        ...host,
        id,
        isBuiltIn: false,
        edited: true,
      },
    ],
  };
  setState(next);
  void persist(next);
}

export function removeCustomHost(id: string): void {
  const next: ImageHostState = {
    ...state(),
    hosts: state().hosts.filter((h) => h.id !== id),
  };
  setState(next);
  void persist(next);
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
  const next: ImageHostState = {
    ...state(),
    probeResults: sorted,
    fastestHostId: fastest?.hostId ?? null,
    fastestHostExpiresAt: fastest ? Date.now() + 30_000 : null,
  };
  setState(next);
  void persist(next);
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

export async function loadImageHostPreference(): Promise<void> {
  const [err, result] = await tryAsync(Preferences.get({ key: PREF_KEY }));
  if (err) {
    console.warn("[imageHostStore] Failed to load preference", err);
    setState(defaultState());
  } else {
    const { value } = result!;
    if (value !== null) {
      const parsed = JSON.parse(value);
      setState(migrateLegacyState(parsed));
    }
  }
}

export function isImageHostEnabled(): boolean {
  return state().masterEnabled && state().hosts.some((h) => h.enabled);
}

/** 获取当前状态下用于图片加载的同步候选 URL（race/fastest-ip 模式可能回退到首个启用图床）。 */
export function getEnabledHosts(): ImageHost[] {
  return state().hosts.filter((h) => h.enabled);
}

export function getFastestHost(): ImageHost | undefined {
  const { fastestHostId, fastestHostExpiresAt } = state();
  if (!fastestHostId) {
    return undefined;
  }
  if (fastestHostExpiresAt && Date.now() > fastestHostExpiresAt) {
    return undefined;
  }
  return state().hosts.find((h) => h.id === fastestHostId);
}
