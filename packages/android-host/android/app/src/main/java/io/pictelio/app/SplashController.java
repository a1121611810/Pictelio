package io.pictelio.app;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * SplashScreen 控制（shared，#116）——从 MainActivity 提取，
 * 供 AuthPlugin.hideSplash() 跨 flavor 调用（webview 的 MainActivityWebview
 * 和 full 的 MainActivity 都委托此类）。
 */
public final class SplashController {

    private static final AtomicBoolean keepSplashVisible = new AtomicBoolean(true);

    private SplashController() {}

    public static void keepVisible() {
        keepSplashVisible.set(true);
    }

    public static void dismiss() {
        keepSplashVisible.set(false);
    }

    public static boolean shouldKeepVisible() {
        return keepSplashVisible.get();
    }
}
