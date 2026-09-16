package io.pictelio.app;

import android.app.Application;
import android.util.Log;
import android.webkit.WebView;

import io.pictelio.app.engine.EngineRoute;
import io.pictelio.app.engine.EngineRouting;

/**
 * Pictelio Application 入口。
 *
 * <p>按引擎路由（{@link EngineRouting#resolve}，ADR-0164 决策 3：预热与 MainActivity
 * 路由共用同一决策入口，消灭「预热与路由各读一次键」的漂移面）条件初始化（#51）：
 * <ul>
 *   <li>BOOT_LYNX → 初始化 Lynx runtime（LynxEnv + 全局 Native Modules），跳过 WebView 预热；
 *   <li>BOOT_WEBVIEW → 预热 WebView 服务进程；
 *   <li>UPGRADE_PAGE → 双失败 / 引擎均不可用，不预热（消灭「预热与路由错位」）。
 * </ul>
 *
 * <p>WebView 预热与 SplashScreen 互补：SplashScreen 掩盖 Activity 初始化到首帧
 * 绘制之间的视觉空白；预热缩短 WebView 服务进程初始化耗时。异常安全：预热/初始化失败
 * 静默吞异常，app 正常启动，正式引擎创建时回退冷初始化路径。
 */
public class PictelioApp extends Application {

    private static final String TAG = "PictelioApp";

    @Override
    public void onCreate() {
        super.onCreate();
        // 引擎决策唯一入口：本进程无需 intent 路由（forced/stay 仅 MainActivity 语义）。
        // 探针惰性求值——首选 webview 的用户依旧不加载 Lynx（成本与旧实现持平）。
        EngineRoute route = EngineRouting.resolve(this, FullEngineProbe.create(this), false, null);
        switch (route.action) {
            case BOOT_LYNX -> initLynx();
            case BOOT_WEBVIEW -> warmUpWebView();
            case UPGRADE_PAGE -> {
                // 双失败：MainActivity 会落升级页，预热哪个引擎都无意义
            }
        }
    }

    /** Lynx runtime 初始化（须早于任何 LynxView 创建）+ 全局 Native Modules 注册（#51）。
     *  收敛至 LynxRuntimeInitializer 单点（issue #122），LynxActivity 进程复用兜底复用同源逻辑。 */
    private void initLynx() {
        try {
            LynxRuntimeInitializer.ensureInitialized(this);
        } catch (Throwable t) {
            Log.w(TAG, "Lynx 初始化失败（lynx client 将不可用）", t);
        }
    }

    private void warmUpWebView() {
        try {
            WebView webView = new WebView(this);
            webView.destroy();
        } catch (Exception ignored) {
            // 预热失败不阻塞 app 启动
            // 涵盖：WebView 服务崩溃、系统 WebView 未安装、ROM 定制导致
            // 的构造异常等。正式 WebView 创建时会回退到冷初始化路径。
        }
    }
}
