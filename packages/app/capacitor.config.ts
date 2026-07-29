/// <reference types="node" />
import type { CapacitorConfig } from "@capacitor/cli";

// 开发时可通过环境变量启用 Capacitor Live Reload：
// CAPACITOR_DEV_SERVER_URL=http://192.168.x.x:5173 pnpm cap:sync
const devServerUrl = process.env.CAPACITOR_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: "io.pictelio.app",
  appName: "Pictelio",
  webDir: "dist",
  server: {
    androidScheme: "https",
    allowNavigation: ["app-api.pixiv.net", "i.pximg.net"],
    ...(devServerUrl
      ? {
          url: devServerUrl,
          cleartext: true,
        }
      : {}),
  },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
