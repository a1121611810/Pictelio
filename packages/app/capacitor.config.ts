/// <reference types="node" />
import type { CapacitorConfig } from "@capacitor/cli";

// 开发时可通过环境变量启用 Capacitor Live Reload：
// CAPACITOR_DEV_SERVER_URL=http://192.168.x.x:5173 pnpm cap:sync
const devServerUrl = process.env.CAPACITOR_DEV_SERVER_URL;

const config: CapacitorConfig = {
  appId: "io.pictelio.app",
  appName: "Pictelio",
  webDir: "dist",
  android: {
    // FT-2 冷启动治理（#365 P2）：关断 native-bridge 对每次插件调用的
    // 「LOG TO/FROM NATIVE」控制台日志（冷启动产生 ~130 条 Capacitor/Console，
    // 每条都是一次控制台桥转发，且插件响应 JSON 会明文泄入 logcat，含 accessToken）。
    // 默认值 "debug" 仅在 debug 构建开启（release 本已关闭）；置 "none" 让 debug
    // 构建与 release 行为一致。注意：Android 上应用自身 console.* 经
    // WebChromeClient → Logger 同通道转发 logcat，亦被此门控一并关断；
    // debug 排障走 chrome://inspect（webContentsDebuggingEnabled 默认 debug 开启）。
    loggingBehavior: "none",
  },
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
