import { registerPlugin } from "@capacitor/core";

export interface PixivApiPlugin {
  request(options: {
    method: "GET" | "POST";
    path: string;
    params?: Record<string, string>;
    body?: string;
  }): Promise<{ status: number; data: string }>;

  setRefreshToken(options: { refreshToken: string }): Promise<void>;

  setAccessToken(options: { accessToken: string }): Promise<void>;

  prefetchImage(options: { url: string }): Promise<{ cached: boolean }>;
}

export const PixivApi = registerPlugin<PixivApiPlugin>("PixivApi");
