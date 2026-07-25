import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  define: {
    __CREDENTIALS__: JSON.stringify({
      clientId: "MOBrBDS8blbauoSck0ZfDbtuzpyT",
      clientSecret: "lsACyCD94FhDUtGTXi3QzcFE2uU1hqtDaKeqrdwj",
      hashSecret: "28c1fdd170a5204386cb1313c7077b34f83e4aaf4aa829ce78c231e05b0bae2c",
      userAgent: "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)",
      appOs: "ios",
      appOsVersion: "18.5",
      authUrl: "https://oauth.secure.pixiv.net/auth/token",
      apiBaseUrl: "https://app-api.pixiv.net",
      loginUrl: "https://app-api.pixiv.net/web/v1/login",
      redirectUri: "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback",
      imageCdnUrl: "https://i.pximg.net",
      referer: "https://app-api.pixiv.net/",
      contentType: "application/x-www-form-urlencoded",
      timeout: {
        connect: 15000,
        read: 30000,
        overrides: {
          imageProxy: { connect: 10000, read: 15000 },
          dnsQuery: { connect: 5000, read: 5000 },
          oauthDialog: { read: 120000 },
        },
      },
      minWebviewVersion: 85,
      cacheDir: "pictelio-images",
      cacheMaxBytes: 314572800,
      dohUrl: "https://cloudflare-dns.com/dns-query?name=",
      allowedHosts: ["app-api.pixiv.net", "i.pximg.net"],
    }),
    __PUBLIC_CONFIG__: JSON.stringify({
      userAgent: "PixivIOSApp/7.18.3 (iOS 18.5; iPhone15,4)",
      appOs: "ios",
      appOsVersion: "18.5",
      authUrl: "https://oauth.secure.pixiv.net/auth/token",
      apiBaseUrl: "https://app-api.pixiv.net",
      loginUrl: "https://app-api.pixiv.net/web/v1/login",
      redirectUri: "https://app-api.pixiv.net/web/v1/users/auth/pixiv/callback",
      imageCdnUrl: "https://i.pximg.net",
      referer: "https://app-api.pixiv.net/",
      contentType: "application/x-www-form-urlencoded",
      timeout: {
        connect: 15000,
        read: 30000,
        overrides: {
          imageProxy: { connect: 10000, read: 15000 },
          dnsQuery: { connect: 5000, read: 5000 },
          oauthDialog: { read: 120000 },
        },
      },
      minWebviewVersion: 85,
      cacheDir: "pictelio-images",
      cacheMaxBytes: 314572800,
      dohUrl: "https://cloudflare-dns.com/dns-query?name=",
      allowedHosts: ["app-api.pixiv.net", "i.pximg.net"],
    }),
  },
  test: {
    name: "agent-browser",
    include: ["tests/agent-browser/specs/**/*.test.ts"],
    environment: "node",
    passWithNoTests: true,
    testTimeout: 120_000,
    hookTimeout: 60_000,
    retry: 2,
    setupFiles: ["./tests/agent-browser/setup.ts"],
    globalSetup: ["./tests/ai-shared/globalSetup.ts"],
    globalTeardown: ["./tests/ai-shared/globalTeardown.ts"],
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
