/**
 * Splash Bridge — 控制原生 Splash Screen 关闭。
 *
 * 通过 AuthPlugin.hideSplash() 通知 Native 侧（MainActivity）
 * 将 keepSplashVisible 置为 false，触发 SplashScreen 退出。
 *
 * markContentReady() 是幂等的：首次调用后即锁定，后续调用不生效。
 */
import { AuthPlugin } from "./AuthPlugin";

let contentReady = false;

/**
 * 标记应用内容已就绪，通知原生层关闭 Splash Screen。
 *
 * - 仅在 Capacitor Native 平台（Android）上生效
 * - Web 环境下静默跳过
 * - 幂等：仅首次调用实际执行
 */
export function markContentReady(): void {
  if (contentReady) return;
  contentReady = true;

  AuthPlugin.hideSplash().catch((err) => {
    // Web 环境下 AuthPlugin 不可用，静默忽略
    console.warn("[splashBridge] hideSplash failed:", err);
  });
}
