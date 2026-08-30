import { App as CapApp } from "@capacitor/app";
import {
  clearOverlays,
  closeTopOverlay,
  type OverlayType,
  popOverlay,
  pushOverlay,
} from "@/stores/backGestureStore";

export type { OverlayType };
export { clearOverlays, closeTopOverlay, popOverlay, pushOverlay };

/** 返回手势依赖的上下文，由调用方（App.tsx）注入，避免服务依赖具体路由实现。 */
export interface BackGestureContext {
  /** 获取当前路径名，用于判断是否在根路径。 */
  getPathname: () => string;
  /** 执行路由返回。调用方应使用类型安全的导航 API。 */
  navigateBack: () => void;
  /** 触发“再按一次退出”提示。 */
  dispatchExitHint: () => void;
  /** OTA 强制门槛过渡面激活期间返回键 = 退出应用（#253，对齐 lynx /update 语义）；可选注入避免服务耦合 */
  shouldExitOnBack?: () => boolean;
}

const rootPaths = new Set(["/home", "/login"]);

/** 根路径下两次返回间隔小于此值（毫秒）时退出应用。 */
const EXIT_DOUBLE_TAP_MS = 2000;

export async function registerBackGesture(ctx: BackGestureContext): Promise<() => void> {
  let lastBackTime = 0;
  const listener = await CapApp.addListener("backButton", () => {
    // 门槛过渡面激活期间（#253）：一次返回即退出应用，不可关闭过渡面
    if (ctx.shouldExitOnBack?.()) {
      void CapApp.exitApp();
      return;
    }
    if (closeTopOverlay()) {
      return;
    }

    if (!rootPaths.has(ctx.getPathname())) {
      ctx.navigateBack();
      return;
    }

    if (Date.now() - lastBackTime < EXIT_DOUBLE_TAP_MS) {
      void CapApp.exitApp();
    } else {
      lastBackTime = Date.now();
      ctx.dispatchExitHint();
    }
  });

  return () => listener.remove();
}
