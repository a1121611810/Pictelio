// src/types/env.d.ts
declare const APP_VERSION: string;
/** E2E 测试钩子开关：仅 --mode e2e 构建为 true（vite.config define） */
declare const __E2E__: boolean;

interface CredentialsConfig {
  clientId: string;
  clientSecret: string;
  hashSecret: string;
  userAgent: string;
  appOs: string;
  appOsVersion: string;
  authUrl: string;
  apiBaseUrl: string;
  loginUrl: string;
  redirectUri: string;
  imageCdnUrl: string;
  referer: string;
  contentType: string;
  timeout: {
    connect: number;
    read: number;
    overrides?: {
      imageProxy?: { connect: number; read: number };
      dnsQuery?: { connect: number; read: number };
      oauthDialog?: { read: number };
    };
  };
  minWebviewVersion: number;
  cacheDir: string;
  cacheMaxBytes: number;
}

/** 不含 A 类凭据的公开配置子集，用于模块顶层引用。 */
type PublicCredentialsConfig = Omit<CredentialsConfig, "clientId" | "clientSecret" | "hashSecret">;

declare const __CREDENTIALS__: CredentialsConfig;
declare const __PUBLIC_CONFIG__: PublicCredentialsConfig;
