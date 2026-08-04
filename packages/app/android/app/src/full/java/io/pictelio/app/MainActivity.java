package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import android.content.pm.PackageInfo;
import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;

import androidx.core.splashscreen.SplashScreen;

import android.view.View;
import android.view.animation.DecelerateInterpolator;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * Pictelio Android 客户端 — 拦截 /pixiv-img/ 请求并代理到 i.pximg.net（注入 Referer 头）。
 */
public class MainActivity extends BridgeActivity {

    private static final String TAG = "MainActivity";

    /** SplashScreen 保持可见的标志位，由 AuthPlugin.hideSplash() 通过 dismissSplash() setter 控制 */
    

    /** 共享图片加载器（#58）：单实例保证 per-URL 锁在并发拦截下生效（避免同 URL 双写缓存） */
    private volatile PixivImageLoader imageLoader;

    private PixivImageLoader imageLoader() {
        PixivImageLoader l = imageLoader;
        if (l == null) {
            synchronized (this) {
                if (imageLoader == null) {
                    imageLoader = new PixivImageLoader(this);
                }
                l = imageLoader;
            }
        }
        return l;
    }

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
            startActivity(new Intent(this, LynxActivity.class));
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

        // 保留 Capacitor 原有的 WebViewClient，用包装类代理非图片请求
        final WebViewClient originalClient = webView.getWebViewClient();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                String url = request.getUrl().toString();
                WebResourceResponse custom = interceptImage(url);
                if (custom != null) return custom;
                if (originalClient != null) {
                    return originalClient.shouldInterceptRequest(view, request);
                }
                return super.shouldInterceptRequest(view, request);
            }

            @SuppressWarnings("deprecation")
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                WebResourceResponse custom = interceptImage(url);
                if (custom != null) return custom;
                // 弃用重载无法获取请求头，让原始 WebViewClient 处理
                if (originalClient != null) {
                    return originalClient.shouldInterceptRequest(view, url);
                }
                return super.shouldInterceptRequest(view, url);
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

    private WebResourceResponse interceptImage(String url) {
        if (url == null || !url.contains("/pixiv-img/")) return null;

        try {
            // URL 重写 + 下载 + 磁盘缓存统一走 PixivImageLoader 公共核心（#57/#58，
            // 与 Lynx PictelioImageService 同源；未命中时补全写盘——行为增强）
            String pixivUrl = PixivImageLoader.rewriteUrl(url);

            // 读取 JS 侧持久化的缓存开关（Capacitor Preferences 存储在默认 SharedPreferences 中）
            android.content.SharedPreferences prefs = getApplicationContext().getSharedPreferences("CapacitorStorage", android.content.Context.MODE_PRIVATE);
            boolean diskCacheEnabled = "true".equals(prefs.getString("image_cache_disk", "true"));
            boolean browserCacheEnabled = "true".equals(prefs.getString("image_cache_browser", "true"));

            PixivImageLoader loader = imageLoader();
            if (diskCacheEnabled) {
                // ── A: 磁盘缓存优先 ──
                File cached = loader.cachedFile(pixivUrl);
                if (cached != null) {
                    return new WebResourceResponse(mimeFor(url), null, 200, "OK", null, new FileInputStream(cached));
                }
                // 未命中：下载 + 写盘（#57 补全缓存写入）
                return bytesResponse(url, loader.loadBytes(pixivUrl), browserCacheEnabled);
            }

            // ── B: 磁盘缓存关闭 → 仅下载不写盘（Referer/UA 注入在核心内） ──
            return bytesResponse(url, loader.download(pixivUrl), browserCacheEnabled);
        } catch (Exception e) {
            Log.w(TAG, "interceptImage 失败: " + url, e);
            return null;
        }
    }

    /** 按 URL 后缀推断图片 mime（webview 专属；下载响应不再依赖服务器 Content-Type） */
    private static String mimeFor(String url) {
        if (url.endsWith(".png")) return "image/png";
        if (url.endsWith(".gif")) return "image/gif";
        if (url.endsWith(".webp")) return "image/webp";
        return "image/jpeg";
    }

    /** 字节 → WebResourceResponse（browserCacheEnabled 时加 immutable 头） */
    private static WebResourceResponse bytesResponse(String url, byte[] bytes, boolean browserCacheEnabled) {
        Map<String, String> headers = new HashMap<>();
        if (browserCacheEnabled) {
            headers.put("Cache-Control", "public, max-age=31536000, immutable");
        }
        return new WebResourceResponse(mimeFor(url), null, 200, "OK", headers, new ByteArrayInputStream(bytes));
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
