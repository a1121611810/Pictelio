import { defineConfig } from "vite-plus/test/config";
import solid from "@solidjs/vite-plugin";
import AutoImport from "unplugin-auto-import/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    AutoImport({
      imports: [
        // 与 vite.config.ts 的 SolidJS 2.0 显式导出名清单保持一致（preset "solid-js"
        // 含 2.0 已删 API，不可用）。
        {
          "solid-js": [
            "createSignal",
            "createEffect",
            "createMemo",
            "createRenderEffect",
            "createRoot",
            "createStore",
            "onCleanup",
            "onSettled",
            "untrack",
            "flush",
            "mapArray",
            "reconcile",
            "snapshot",
            "merge",
            "omit",
            "children",
            "lazy",
            "createUniqueId",
            "createContext",
            "useContext",
            "Show",
            "For",
            "Switch",
            "Match",
            "Loading",
            "Errored",
            "Repeat",
            "Reveal",
          ],
        },
        {
          "@solidjs/web": ["render", "hydrate", "Portal", "Dynamic", "isServer"],
        },
        {
          "@solidjs/router": [
            "useNavigate",
            "useLocation",
            "useParams",
            "useSearchParams",
            "useBeforeLeave",
            "useIsRouting",
            "useMatch",
          ],
        },
        { "@/utils/tryAsync": ["tryAsync", "trySync"] },
        { "@/primitives/fluentOn": ["fluentOn"] },
      ],
      dts: "./src/auto-imports.d.ts",
    }),
    solid(),
  ],
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
    }),
    APP_VERSION: JSON.stringify("3.21.2"),
    __E2E__: "false", // 与 vite.config.ts 的 --mode e2e define 对齐；单测环境恒为 false
  },
  test: {
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    // SolidJS 2.0：@solidjs/vite-plugin 对 node 环境走「server 姿态」（solid-js 解析到
    // server 构建，signal 写入为惰性数据）。全仓单测依赖真实 client signal 语义，
    // 必须用 DOM 环境走 client 姿态（ADR-0144）。
    environment: "happy-dom",
    // T0 门禁（ADR-0097）：禁止空测试文件，防空壳套件漂移（ADR-0084 教训）
    passWithNoTests: false,
    clearMocks: true,
    restoreMocks: true,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
