import {
  imageHostState,
  type ImageHost,
  type ProbeResult,
  getEnabledHosts,
  getFastestHost,
  setProbeResults,
} from "../stores/imageHostStore";

export interface HostInput {
  name: string;
  baseUrl: string;
}

export function validateHostInput(input: HostInput): string | null {
  const name = input.name.trim();
  const baseUrl = input.baseUrl.trim();

  if (!name) {
    return "名称不能为空";
  }
  if (!baseUrl) {
    return "代理 URL 不能为空";
  }

  const [err, url] = trySync(() => new URL(baseUrl));
  if (err) {
    return "请输入有效的 URL";
  }
  if (!/^https?:$/u.test(url!.protocol)) {
    return "仅支持 http:// 或 https:// 协议";
  }
  if (url!.hostname.includes("pximg.net")) {
    return "图床 URL 不能直接使用 Pixiv 官方域名";
  }

  return null;
}

export function hasDuplicateBaseUrl(baseUrl: string, excludeId?: string): boolean {
  const normalized = baseUrl.replace(/\/$/u, "");
  return imageHostState().hosts.some(
    (h) => h.id !== excludeId && h.baseUrl.replace(/\/$/u, "") === normalized,
  );
}

/**
 * 将原始 Pixiv 图片 URL 转换为指定图床的代理 URL。
 *
 * 支持两种占位模式：
 * - 包含 {path} 的 baseUrl：替换为原始 URL 的 pathname（去掉前导 /）
 * - 普通模式：仅替换 hostname，保留协议、路径、查询参数
 */
export function transformUrl(originalUrl: string, baseUrl: string): string {
  if (!originalUrl) {
    return "";
  }

  const [err, result] = trySync(() => {
    if (baseUrl.includes("{path}")) {
      const originalPath = new URL(originalUrl).pathname.slice(1);
      return baseUrl.replace("{path}", originalPath);
    }

    const source = new URL(originalUrl);
    const proxy = new URL(baseUrl);
    source.protocol = proxy.protocol;
    source.hostname = proxy.hostname;
    source.port = proxy.port;
    return source.toString();
  });
  if (err) {
    return originalUrl;
  }
  return result;
}

/** 按权重随机选择一个启用的图床。 */
export function selectWeightedHost(hosts: ImageHost[]): ImageHost | undefined {
  const enabled = hosts.filter((h) => h.enabled && h.weight > 0);
  if (enabled.length === 0) {
    return undefined;
  }

  const total = enabled.reduce((sum, h) => sum + h.weight, 0);
  let roll = Math.random() * total;

  for (const host of enabled) {
    roll -= host.weight;
    if (roll <= 0) {
      return host;
    }
  }

  return enabled[enabled.length - 1];
}

/**
 * 同步返回当前配置下应该使用的图片 URL。
 *
 * 注意：race 模式下这里只返回一个候选 URL，真正的并发请求在 loadImage 中完成；
 * fastest-ip 模式若缓存过期，同样回退到加权选择。
 */
export function getEffectiveImageUrl(originalUrl: string): string {
  if (!isImageHostActive()) {
    return originalUrl;
  }

  const state = imageHostState();
  const enabled = getEnabledHosts();
  if (enabled.length === 0) {
    return originalUrl;
  }

  if (state.mode === "single") {
    const host = enabled.find((h) => h.id === state.selectedHostId);
    if (host) {
      return transformUrl(originalUrl, host.baseUrl);
    }
    // 无选中或选中不可用，退回到第一个启用的
    return transformUrl(originalUrl, enabled[0].baseUrl);
  }

  if (state.mode === "fastest-ip") {
    const fastest = getFastestHost();
    if (fastest) {
      return transformUrl(originalUrl, fastest.baseUrl);
    }
    // 无缓存时自动后台探测，不阻塞当前加载
    void probeHosts();
  }

  if (state.mode === "weighted" || state.mode === "fastest-ip") {
    const host = selectWeightedHost(enabled);
    if (host) {
      return transformUrl(originalUrl, host.baseUrl);
    }
  }

  return transformUrl(originalUrl, enabled[0].baseUrl);
}

/**
 * 异步解析最终图片 URL。
 *
 * 对于 fastest-ip 模式，若缓存已过期，会触发一次后台探测；
 * 但 probe 不阻塞当前加载，直接回退到加权选择返回，避免首屏等待。
 */
export async function getEffectiveImageUrlAsync(originalUrl: string): Promise<string> {
  if (!isImageHostActive()) {
    return originalUrl;
  }

  const state = imageHostState();
  const enabled = getEnabledHosts();
  if (enabled.length === 0) {
    return originalUrl;
  }

  if (state.mode === "fastest-ip") {
    const fastest = getFastestHost();
    if (fastest) {
      return transformUrl(originalUrl, fastest.baseUrl);
    }
    // 无缓存时后台触发一次探测，不阻塞当前加载
    void probeHosts();
    const host = selectWeightedHost(enabled);
    if (host) {
      return transformUrl(originalUrl, host.baseUrl);
    }
  }

  if (state.mode === "weighted") {
    const host = selectWeightedHost(enabled);
    if (host) {
      return transformUrl(originalUrl, host.baseUrl);
    }
  }

  return transformUrl(originalUrl, enabled[0].baseUrl);
}

/** 返回当前模式下应请求的图片候选 URL。
 * race 模式返回所有启用图床的 URL（并发竞速）；
 * 其他模式只返回 fetchWeb 传入的 targetUrl 原值（已是 getEffectiveImageUrl 选定的主机）。 */
export function getRaceCandidateUrls(originalUrl: string): string[] {
  if (!isImageHostActive()) {
    return [originalUrl];
  }
  const enabled = getEnabledHosts();
  if (enabled.length === 0) {
    return [originalUrl];
  }
  // Race 模式：返回所有启用主机的候选 URL
  if (imageHostState().mode === "race") {
    return enabled.map((host) => transformUrl(originalUrl, host.baseUrl));
  }
  // Weighted / fastest-ip / single：URL 已由 getEffectiveImageUrl 决定，不再变更
  return [originalUrl];
}

function isImageHostActive(): boolean {
  return imageHostState().masterEnabled && getEnabledHosts().length > 0;
}

/**
 * 对启用的图床进行并发探测。
 *
 * 使用 HEAD 请求（允许回退到 GET）并设置短超时，避免长时间阻塞 UI。
 * 结果会写回 store 的 probeResults，并更新 fastestHostId。
 */
export async function probeHosts(): Promise<ProbeResult[]> {
  const enabled = getEnabledHosts();
  if (enabled.length === 0) {
    return [];
  }

  const probeUrl = buildProbeSampleUrl();

  const promises = enabled.map(async (host): Promise<ProbeResult> => {
    const url = probeUrl ? transformUrl(probeUrl, host.baseUrl) : host.baseUrl;
    const start = performance.now();
    const [probeErr, probeResult] = await tryAsync(
      (async () => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const resp = await fetch(url, {
          method: "HEAD",
          mode: "no-cors",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const latency = Math.round(performance.now() - start);
        // No-cors  opaque response status 为 0，视为可达
        return {
          hostId: host.id,
          hostName: host.name,
          baseUrl: host.baseUrl,
          reachable: resp.ok || resp.status === 0,
          latencyMs: latency,
        };
      })(),
    );
    if (probeErr) {
      return {
        hostId: host.id,
        hostName: host.name,
        baseUrl: host.baseUrl,
        reachable: false,
        latencyMs: null,
      };
    }
    return probeResult;
  });

  const results = await Promise.all(promises);
  setProbeResults(results);
  return results;
}

/**
 * 构建一个用于探测的样本图片 URL。
 *
 * 这里使用一个已知存在的公开 sample 图。实际探测样本并不重要，
 * 因为图床通常只根据 path 转发，返回任意 2xx/0 都说明服务在线。
 */
function buildProbeSampleUrl(): string {
  // 使用 Pixiv 官方 sample 图作为通用样本，减少隐私/404 风险
  return "https://i.pximg.net/c/360x360_70/img-master/img/2020/01/01/00/00/00/0_p0_master1200.jpg";
}
