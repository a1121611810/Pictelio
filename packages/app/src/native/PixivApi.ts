import { registerPlugin, type PluginListenerHandle } from "@capacitor/core";

export interface PixivApiPlugin {
  request(options: {
    method: "GET" | "POST";
    path: string;
    params?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; data: string }>;

  syncToken(options: { token: string | null }): Promise<void>;

  setAccessToken(options: { accessToken: string }): Promise<void>;

  prefetchImage(options: { url: string }): Promise<{ cached: boolean }>;

  /**
   * Java 401 静默刷新发现 refresh_token 被轮换时触发（Java 侧仅更新内存，
   * 通知 JS 持久化新值，避免重启后回退旧 token）。
   */
  addListener(
    eventName: "refreshTokenRotated",
    listener: (data: { token: string }) => void,
  ): Promise<PluginListenerHandle>;
}

export const PixivApi = registerPlugin<PixivApiPlugin>("PixivApi");
