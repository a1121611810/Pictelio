package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import android.content.pm.PackageInfo;
import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;

import androidx.core.splashscreen.SplashScreen;

import android.view.View;
import android.view.animation.DecelerateInterpolator;

/**
 * Pictelio Android 客户端 — 拦截 /pixiv-img/ 请求并代理到 i.pximg.net（注入 Referer 头）。
 */
public class MainActivityWebview extends BridgeActivity {

    /** SplashScreen 控制委托 SplashController（#116 shared），供 AuthPlugin.hideSplash() 跨 flavor 调用 */

    /** 供同包下的 AuthPlugin 调用，通知 SplashScreen 可退出 */
    static void dismissSplash() {
        SplashController.dismiss();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // webview flavor：无 lynx 入口路由（#116），直接初始化 WebView client。

        // 确保每次 Activity 重建时 Splash 可重新显示
        SplashController.keepVisible();
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> SplashController.shouldKeepVisible());
        splashScreen.setOnExitAnimationListener(splashScreenView -> {
            View icon = splashScreenView.getIconView();
            if (icon != null) {
                icon.animate()
                        .scaleX(1.8f).scaleY(1.8f)
                        .alpha(0f)
                        .setDuration(120L)
                        .setInterpolator(new DecelerateInterpolator(2f))
                        .withEndAction(splashScreenView::remove)
                        .start();
            } else {
                splashScreenView.remove();
            }
        });
        if (!isWebViewVersionOk()) {
            // WebView 版本不足时立即关闭 Splash，显示升级提示页。
            // 必须先 super.onCreate（Android 硬约束：跳过即 SuperNotCalledException 崩溃），
            // 且不初始化 Capacitor Bridge / 插件。
            super.onCreate(savedInstanceState);
            SplashController.dismiss();
            showWebViewUpgradeError();
            return;
        }

        registerPlugin(ImageCachePlugin.class);
        registerPlugin(AuthPlugin.class);
        registerPlugin(OAuthPlugin.class);
        registerPlugin(PixivApiPlugin.class);
        registerPlugin(ClientInfoPlugin.class); // ADR-0062
        registerPlugin(OtaPlugin.class); // OTA web bundle（#249）
        super.onCreate(savedInstanceState);
        // 调试模式 — debug 构建时启用
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
            // [PROBE prototype/diagnose-direct-oauth-rejection] debug-only：
            // 通过 Intent extra 'debug_refresh_token' 接收 token，写入 SecureStorage。
            // 调用方式：
            //   adb shell am start -n io.pictelio.app/.MainActivity \
            //     --es debug_refresh_token "<refresh_token>"
            // JS 侧 restoreRefreshToken 会拿到 token 触发 performRefresh，
            // Java 侧 PROBE-AuthPlugin / PROBE-PixivApiCore 输出真实 reject message。
            final String debugToken = getIntent() != null
                    ? getIntent().getStringExtra("debug_refresh_token") : null;
            if (debugToken != null && !debugToken.isEmpty()) {
                android.util.Log.w("PROBE-DebugToken", "Intent extra has token; injecting (debug-only); length=" + debugToken.length());
                final android.content.Context ctx = getApplicationContext();
                new Thread(() -> {
                    try {
                        // 写入 CapacitorStorage Preferences（@capacitor/preferences 默认 group），
                        // JS 侧 restoreRefreshToken debug-only 路径会读它。
                        final String tokenJson = "{\"probe_refresh_token\":\"" + debugToken + "\"}";
                        final String directJson = "{\"enabled\":true,\"manual\":[]}"; // 强制直连开关 ON
                        ctx.getSharedPreferences("CapacitorStorage", android.content.Context.MODE_PRIVATE)
                                .edit()
                                .putString("PROBE_DBG", tokenJson)
                                .putString("direct_access_settings", directJson)
                                .apply();
                        android.util.Log.w("PROBE-DebugToken", "CapacitorStorage.PROBE_DBG written; length=" + debugToken.length()
                                + "; direct_access_settings=" + directJson);
                        // 同步 Java 堆 refreshToken 静态字段，让 PixivApiCore 直接拿（避免 JS roundtrip）
                        io.pictelio.app.PixivApiCore.refreshToken = debugToken;
                        android.util.Log.w("PROBE-DebugToken", "PixivApiCore.refreshToken set; prefix=" + debugToken.substring(0, Math.min(8, debugToken.length())));
                        // [PROBE] 立即触发 IP 表远端拉取（用户场景："点击立即更新IP表"）
                        try {
                            io.pictelio.app.directaccess.DirectAccessConfig config =
                                    io.pictelio.app.directaccess.DirectAccessConfig.get(ctx);
                            boolean started = config.refreshIpTableNow();
                            android.util.Log.w("PROBE-DebugToken", "refreshIpTableNow started=" + started);
                        } catch (Throwable t) {
                            android.util.Log.w("PROBE-DebugToken", "refreshIpTableNow failed: " + t.getMessage());
                        }
                    } catch (Exception e) {
                        android.util.Log.w("PROBE-DebugToken", "inject failed: " + e.getClass().getName() + ":" + e.getMessage());
                    }
                }, "PROBE-DebugToken").start();
            }
        }
    }

    @Override
    public void onStart() {
        super.onStart();

        final WebView webView = bridge.getWebView();
        if (webView == null) return;

        // [PROBE prototype/diagnose-direct-oauth-rejection] debug-only：把 webview console
        // 输出桥到 logcat tag "PROBE-WebView"，让 JS 侧 console.warn 可观测。
        if (BuildConfig.DEBUG) {
            webView.setWebChromeClient(new android.webkit.WebChromeClient() {
                @Override
                public boolean onConsoleMessage(android.webkit.ConsoleMessage cm) {
                    android.util.Log.w("PROBE-WebView",
                            cm.message() + " (" + cm.sourceId() + ":" + cm.lineNumber() + ")");
                    return true;
                }
            });
        }

        // 保留 Capacitor 原有的 WebViewClient，用包装类代理非图片请求；
        // 出口统一过 OtaPlugin.ensureNoStore（OTA 坑①：本地服务器响应缺 Cache-Control
        // 导致 Chromium 缓存旧文档，切换后旧 JS 复活误调 notifyReady）
        final WebViewClient originalClient = webView.getWebViewClient();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                String url = request.getUrl().toString();
                WebResourceResponse custom = interceptImage(url);
                if (custom != null) return OtaPlugin.ensureNoStore(custom);
                WebResourceResponse upstream;
                if (originalClient != null) {
                    upstream = originalClient.shouldInterceptRequest(view, request);
                } else {
                    upstream = super.shouldInterceptRequest(view, request);
                }
                return OtaPlugin.ensureNoStore(upstream);
            }

            @SuppressWarnings("deprecation")
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                WebResourceResponse custom = interceptImage(url);
                if (custom != null) return OtaPlugin.ensureNoStore(custom);
                // 弃用重载无法获取请求头，让原始 WebViewClient 处理
                WebResourceResponse upstream;
                if (originalClient != null) {
                    upstream = originalClient.shouldInterceptRequest(view, url);
                } else {
                    upstream = super.shouldInterceptRequest(view, url);
                }
                return OtaPlugin.ensureNoStore(upstream);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (originalClient != null) {
                    return originalClient.shouldOverrideUrlLoading(view, request);
                }
                return super.shouldOverrideUrlLoading(view, request);
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (originalClient != null) {
                    return originalClient.shouldOverrideUrlLoading(view, url);
                }
                return super.shouldOverrideUrlLoading(view, url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (originalClient != null) {
                    originalClient.onPageFinished(view, url);
                }
                super.onPageFinished(view, url);
            }
        });
    }

    // X1：拦截核心抽至共享类 ImageIntercept（full/webview 两 flavor 逐字重复实现合并，
    // 行为变化仅 spec 列明的 telemetry/immutable 头/内存热路径三处）
    private WebResourceResponse interceptImage(String url) {
        return ImageIntercept.interceptImage(getApplicationContext(), url);
    }

    // ── WebView 版本检测 ────────────────────────────────────────────

    /**
     * 提取当前设备 WebView 的主版本号。
     *
     * @return 主版本号（如 85）；无法获取时返回 -1。
     */
    private static int getWebViewMajorVersion() {
        try {
            PackageInfo pi = WebView.getCurrentWebViewPackage();
            if (pi == null || pi.versionName == null) return -1;
            int dotIdx = pi.versionName.indexOf('.');
            if (dotIdx > 0) {
                return Integer.parseInt(pi.versionName.substring(0, dotIdx));
            }
            return -1;
        } catch (Exception e) {
            return -1;
        }
    }

    /**
     * 检查当前 WebView 版本是否满足最低要求。
     *
     * 无法检测到版本时保守放行（避免误杀非标准实现）。
     */
    private boolean isWebViewVersionOk() {
        int major = getWebViewMajorVersion();
        if (major < 0) return true;     // 检测失败 → 放行，让应用自己处理
        return major >= OAuthConfig.MIN_WEBVIEW_VERSION;
    }

    /**
     * 显示 WebView 升级提示页，阻止应用正常启动。
     *
     * 直接加载本地静态 HTML，不初始化 Capacitor Bridge / 插件 / WebViewClient 等任何额外组件。
     */
    private void showWebViewUpgradeError() {
        setContentView(R.layout.activity_webview_error);
        WebView wv = findViewById(R.id.webview_error);
        if (wv != null) {
            wv.getSettings().setJavaScriptEnabled(true);
            wv.loadUrl("file:///android_res/raw/upgrade.html");
        }
    }

}
