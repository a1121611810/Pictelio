// sync-credentials.mjs
// 从 credentials.json5 读取配置，生成 Java 常量类 OAuthConfig.java。
// 在 build:android / build:android:release 之前自动调用。
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import JSON5 from "json5";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const credsPath = resolve(rootDir, "credentials.json5");
if (!existsSync(credsPath)) {
  console.error("[sync-credentials] ❌ 未找到 credentials.json5，请确认文件存在后重试");
  process.exit(1);
}

let cfg;
try {
  const raw = readFileSync(credsPath, "utf-8");
  cfg = JSON5.parse(raw);
} catch (e) {
  console.error("[sync-credentials] ❌ credentials.json5 解析失败:", e.message);
  process.exit(1);
}

const { timeout } = cfg;
const to = timeout.overrides ?? {};

const lines = [
  "package io.pictelio.app.config;",
  "",
  "/**",
  " * 自动生成的 OAuth 与运行时配置常量类。",
  " * 由 scripts/sync-credentials.mjs 从 credentials.json5 生成。",
  " * 请勿手动编辑 — 修改 credentials.json5 后重新运行 pnpm sync:credentials。",
  " */",
  "public final class OAuthConfig {",
  "  private OAuthConfig() {}",
  "",
  "  // ── A: OAuth 凭证 ──",
  `  public static final String CLIENT_ID = "${cfg.clientId}";`,
  `  public static final String CLIENT_SECRET = "${cfg.clientSecret}";`,
  `  public static final String HASH_SECRET = "${cfg.hashSecret}";`,
  "",
  "  // ── B: 请求头伪装 ──",
  `  public static final String USER_AGENT = "${cfg.userAgent}";`,
  `  public static final String APP_OS = "${cfg.appOs}";`,
  `  public static final String APP_OS_VERSION = "${cfg.appOsVersion}";`,
  "",
  "  // ── C: 端点 URL ──",
  `  public static final String AUTH_URL = "${cfg.authUrl}";`,
  `  public static final String LOGIN_URL = "${cfg.loginUrl}";`,
  `  public static final String IMAGE_CDN_URL = "${cfg.imageCdnUrl}";`,
  `  public static final String REDIRECT_URI = "${cfg.redirectUri}";`,
  "",
  "  // ── D: 请求头固定值 ──",
  `  public static final String REFERER = "${cfg.referer}";`,
  `  public static final String CONTENT_TYPE = "${cfg.contentType}";`,
  "",
  "  // ── E: 超时 ──",
  `  public static final int TIMEOUT_CONNECT = ${timeout.connect};`,
  `  public static final int TIMEOUT_READ = ${timeout.read};`,
  `  public static final int TIMEOUT_IMAGE_PROXY_CONNECT = ${to.imageProxy?.connect ?? timeout.connect};`,
  `  public static final int TIMEOUT_IMAGE_PROXY_READ = ${to.imageProxy?.read ?? timeout.read};`,
  `  public static final int TIMEOUT_DNS_QUERY_CONNECT = ${to.dnsQuery?.connect ?? timeout.connect};`,
  `  public static final int TIMEOUT_DNS_QUERY_READ = ${to.dnsQuery?.read ?? timeout.read};`,
  `  public static final int TIMEOUT_OAUTH_DIALOG_READ = ${to.oauthDialog?.read ?? timeout.read};`,
  "",
  "  // ── F: Android 平台 ──",
  `  public static final int MIN_WEBVIEW_VERSION = ${cfg.minWebviewVersion};`,
  `  public static final String CACHE_DIR = "${cfg.cacheDir}";`,
  `  public static final long CACHE_MAX_BYTES = ${cfg.cacheMaxBytes}L;`,
  `  public static final String DOH_URL = "${cfg.dohUrl}";`,
  `  public static final String[] ALLOWED_HOSTS = {`,
  cfg.allowedHosts.map((h) => `    "${h}"`).join(",\n"),
  "  };",
  "}",
  "",
];

const outDir = resolve(
  rootDir,
  "android",
  "app",
  "src",
  "main",
  "java",
  "io",
  "pictelio",
  "app",
  "config",
);
mkdirSync(outDir, { recursive: true });

const outPath = resolve(outDir, "OAuthConfig.java");
writeFileSync(outPath, lines.join("\n"), "utf-8");

console.log(`[sync-credentials] ✓ ${outPath}`);
