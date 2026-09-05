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
public class MainActivity extends BridgeActivity {

    /** SplashScreen 保持可见的标志位，由 AuthPlugin.hideSplash() 通过 dismissSplash() setter 控制 */

    /** 供同包下的 AuthPlugin 调用，通知 SplashScreen 可退出 */
    static void dismissSplash() {
        SplashController.dismiss();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // ① lynx client 入口路由（#51）：在 Splash/WebView 检查之前分发。
        // 读 SharedPreferences("CapacitorStorage") 的 pictelio_client_kind：
        // "lynx" → 跳 LynxActivity（纯 LynxView，无 Capacitor bridge），本 Activity 不初始化。
        // 研究结论：BridgeActivity.onCreate 无条件创建 WebView，不可同 Activity，故双 Activity 分发。
        // 注意：Android 硬约束——onCreate 必须调用 super.onCreate（否则 SuperNotCalledException，
        // 真机实测 2026-08-01），故 lynx 分支先 super 再跳转（bridge 初始化浪费可接受，立即 finish）。
        String clientKind = getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .getString("pictelio_client_kind", "webview");
        if ("lynx".equals(clientKind)) {
            super.onCreate(savedInstanceState);
            // 修复「缩小后点图标永远回推荐页」（ADR-0102，模拟器实证根因）：
            // MainActivity 是 singleTask 路由壳，每次路由后 finish，永远没有存活实例可收
            // launcher 重投递的 onNewIntent → 系统只能重建本 Activity 并压在旧 LynxActivity
            // 之上 → 每次点图标都新开 LynxView（回推荐页 + task 无限堆叠，实测 2 次叠 3 层）。
            // 判别：重建进来时本 Activity 不是 task 根（下面压着存活的旧 LynxActivity）→
            // 直接 finish 退出，由系统恢复旧实例——页面/历史栈/滚动位置原样保留。
            // 冷启动 / 客户端切换（restart 走 CLEAR_TASK）MainActivity 恒为 task 根，不受影响。
            if (!isTaskRoot()) {
                finish();
                return;
            }
            // benchNav 深链参数转发（spec app-lynx-benchnav-meta-exit-hooks）：MainActivity 是
            // launcher 路由壳，`am start --es benchNav xxx` 的 extras 落本 intent，须转给 LynxActivity
            //（getIntent 读取，ADR-0136）；无 extras 时 putExtras 为空，零影响
            Intent lynxIntent = new Intent(this, LynxActivity.class);
            lynxIntent.putExtras(getIntent());
            startActivity(lynxIntent);
            finish();
            return; // 不注册插件、不做 WebView 版本检查
        }

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
        }
    }

    @Override
    public void onStart() {
        super.onStart();

        final WebView webView = bridge.getWebView();
        if (webView == null) return;

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
