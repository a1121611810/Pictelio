package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import android.content.pm.PackageInfo;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;

import androidx.core.splashscreen.SplashScreen;

import android.view.View;
import android.view.animation.DecelerateInterpolator;

import java.net.URI;

import android.util.Base64;

import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Pictelio Android 客户端 — 拦截 /pixiv-img/ 请求并代理到 i.pximg.net（注入 Referer 头）。
 */
public class MainActivity extends BridgeActivity {

    /** SplashScreen 保持可见的标志位，由 AuthPlugin.hideSplash() 通过 dismissSplash() setter 控制 */
    private static final AtomicBoolean keepSplashVisible = new AtomicBoolean(true);

    /** 供同包下的 AuthPlugin 调用，通知 SplashScreen 可退出 */
    static void dismissSplash() {
        keepSplashVisible.set(false);
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // 确保每次 Activity 重建时 Splash 可重新显示
        keepSplashVisible.set(true);
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> keepSplashVisible.get());
        splashScreen.setOnExitAnimationListener(splashScreenView -> {
            View icon = splashScreenView.getIconView();
            if (icon != null) {
                icon.animate()
                        .scaleX(1.8f).scaleY(1.8f)
                        .alpha(0f)
                        .setDuration(280L)
                        .setInterpolator(new DecelerateInterpolator(2f))
                        .withEndAction(splashScreenView::remove)
                        .start();
            } else {
                splashScreenView.remove();
            }
        });
        if (!isWebViewVersionOk()) {
            // WebView 版本不足时立即关闭 Splash，显示升级提示页
            keepSplashVisible.set(false);
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
            String path = url.substring(url.indexOf("/pixiv-img/") + "/pixiv-img/".length());
            String pixivUrl = new URI(OAuthConfig.IMAGE_CDN_URL + "/" + path).normalize().toString();

            // 读取 JS 侧持久化的缓存开关（Capacitor Preferences 存储在默认 SharedPreferences 中）
            android.content.SharedPreferences prefs = getApplicationContext().getSharedPreferences("CapacitorStorage", android.content.Context.MODE_PRIVATE);
            boolean diskCacheEnabled = "true".equals(prefs.getString("image_cache_disk", "true"));
            boolean browserCacheEnabled = "true".equals(prefs.getString("image_cache_browser", "true"));

            // ── A: 磁盘缓存检查 ────────────────────────────────────
            if (diskCacheEnabled) {
                String filename = Base64.encodeToString(pixivUrl.getBytes(), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
                File cacheFile = new File(getCacheDir() + "/" + OAuthConfig.CACHE_DIR + "/", filename);
                if (cacheFile.exists()) {
                    String mime = "image/jpeg";
                    if (path.endsWith(".png")) mime = "image/png";
                    else if (path.endsWith(".gif")) mime = "image/gif";
                    else if (path.endsWith(".webp")) mime = "image/webp";
                    return new WebResourceResponse(mime, null, 200, "OK", null, new FileInputStream(cacheFile));
                }
            }

            // ── B: OkHttp 下载（连接池共享，比 HttpURLConnection 稳定） ──
            okhttp3.Request okRequest = new okhttp3.Request.Builder()
                    .url(pixivUrl)
                    .addHeader("Referer", OAuthConfig.REFERER)
                    .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                    .build();

            okhttp3.Response okResponse = PixivApiPlugin.getSharedClient().newCall(okRequest).execute();

            String mime = okResponse.header("Content-Type");
            if (mime == null) mime = "image/jpeg";

            // ── C: Cache-Control immutable 头 ──
            Map<String, String> headers = new HashMap<>();
            if (browserCacheEnabled) {
                headers.put("Cache-Control", "public, max-age=31536000, immutable");
            }

            return new WebResourceResponse(
                    mime,
                    okResponse.header("Content-Encoding"),
                    200, "OK",
                    headers,
                    okResponse.body().byteStream()
            );
        } catch (Exception e) {
            e.printStackTrace();
            return null;
        }
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
