/**
 * Splash Bridge — 控制原生 Splash Screen 关闭。
 *
 * 通过 AuthPlugin.hideSplash() 通知 Native 侧（MainActivity）
 * 将 keepSplashVisible 置为 false，触发 SplashScreen 退出。
 *
 * - 通过 AuthPlugin.hideSplash() 调用 Native 层关闭 Splash
 * - Web 环境下根本不发 IPC（避免 plugin-not-implemented 异常噪音）
 *
 * markContentReady() 是幂等的：首次调用后即锁定，后续调用不生效。
 */
import { AuthPlugin } from "./AuthPlugin";
import { isNativePlatform } from "@/utils/platform";

let contentReady = false;

/**
 * 标记应用内容已就绪，通知原生层关闭 Splash Screen。
 *
 * - 仅在 Capacitor Native 平台（Android）上生效
 * - Web 环境下早返回：根本不发 hideSplash IPC（消除 CapacitorException
 *   噪音 + 节省启动期 IPC 调用）
 * - 幂等：仅首次调用实际执行
 */
export function markContentReady(): void {
  if (contentReady) return;
  contentReady = true;

  // Web 环境无原生 AuthPlugin，根本不发 IPC 调用——这是噪音的真因消除
  // （与项目 platform.ts 守卫一致；项目当前仅 Android 原生容器，平台级守卫够用。
  // 若未来引入桌面 Capacitor/iOS WebView 等非 native 容器，可改用 `isPluginAvailable('AuthPlugin')` 精确守卫）
  if (!isNativePlatform()) return;

  AuthPlugin.hideSplash().catch((err) => {
    console.warn("[splashBridge] hideSplash failed:", err);
  });
}
