/**
 * Splash Bridge — 控制原生 Splash Screen 关闭。
 *
 * 通过 @capacitor/splash-screen 的 SplashScreen.hide() 方法，
 * 在 JS 侧确认内容已就绪后通知 Native 侧关闭 Splash。
 *
 * markContentReady() 是幂等的：首次调用后即锁定，后续调用不生效。
 */
import { Capacitor } from "@capacitor/core";

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

  if (!Capacitor.isNativePlatform()) return;

  // 动态导入避免 Web 端 Vite 打包时因 native 模块报错
  import("@capacitor/splash-screen")
    .then(({ SplashScreen }) => SplashScreen.hide())
    .catch(() => {
      // @capacitor/splash-screen 不可用（例如 Web 开发环境），静默忽略
    });
}
