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
public class MainActivityWebview extends BridgeActivity {

    private static final String TAG = "MainActivity";

    /** SplashScreen 控制委托 SplashController（#116 shared），供 AuthPlugin.hideSplash() 跨 flavor 调用 */

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
                WebResourceResponse custom = interceptImage(url, request.getMethod(), request.getRequestHeaders());
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

    private WebResourceResponse interceptImage(String url) {
        // 弃用重载（String url）无法获取请求头 → 按无 Range/HEAD 语义处理
        return interceptImage(url, null, null);
    }

    /**
     * /pixiv-img/ 代理拦截（webview 形态）。
     *
     * <p>扩展（prototype 验证 / research 文档 §5 既定路径）：
     * <ul>
     *   <li>HEAD → 200 + Content-Length + Accept-Ranges（磁盘缓存命中免网络）；
     *       拿不到长度时返回无 Content-Length 的 200（JS 侧会报可读错误，属预期降级）</li>
     *   <li>Range（单段）→ 206 Partial Content + Content-Range/Content-Length；
     *       磁盘缓存命中直接切片，未命中走 {@link PixivImageLoader#downloadRange}（不写盘）；
     *       非单段/畸形 Range → 返回 null 走原路径</li>
     *   <li>其余 → 既有全量 200 逻辑不变</li>
     * </ul>
     */
    private WebResourceResponse interceptImage(String url, String method, Map<String, String> requestHeaders) {
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

            // ── HEAD：返回资源总长（ugoira range 取帧第一步；缓存命中免网络） ──
            if ("HEAD".equalsIgnoreCase(method)) {
                Map<String, String> headers = new HashMap<>();
                headers.put("Accept-Ranges", "bytes");
                long len = -1;
                if (diskCacheEnabled) {
                    File cached = loader.cachedFile(pixivUrl);
                    if (cached != null) len = cached.length();
                }
                if (len < 0) len = loader.downloadHeadLength(pixivUrl);
                if (len >= 0) headers.put("Content-Length", String.valueOf(len));
                return new WebResourceResponse(mimeFor(url), null, 200, "OK", headers, new ByteArrayInputStream(new byte[0]));
            }

            // ── Range：206 分片（ugoira range 流式取帧；缓存命中切片免网络） ──
            String range = findHeader(requestHeaders, "Range");
            if (range != null && range.startsWith("bytes=")) {
                long[] bounds = PixivImageLoader.parseRangeHeader(range);
                if (bounds == null) return null; // 非单段/畸形 → 走原路径
                long start = bounds[0];
                long end = bounds[1];
                long total = -1;
                byte[] bytes;
                if (diskCacheEnabled) {
                    File cached = loader.cachedFile(pixivUrl);
                    if (cached != null) {
                        total = cached.length();
                        if (end < 0) end = total - 1;
                        bytes = PixivImageLoader.sliceFile(cached, start, end);
                    } else if (end < 0) {
                        return null; // 开放区间且未命中缓存：需总长，交给原路径（JS 报可读错误）
                    } else {
                        PixivImageLoader.RangeResult r = loader.downloadRange(pixivUrl, start, end);
                        bytes = r.bytes;
                        total = r.total;
                    }
                } else if (end < 0) {
                    return null;
                } else {
                    PixivImageLoader.RangeResult r = loader.downloadRange(pixivUrl, start, end);
                    bytes = r.bytes;
                    total = r.total;
                }
                Map<String, String> headers = new HashMap<>();
                headers.put("Accept-Ranges", "bytes");
                headers.put("Content-Length", String.valueOf(bytes.length));
                headers.put("Content-Range", "bytes " + start + "-" + end + "/" + (total >= 0 ? total : "*"));
                return new WebResourceResponse(mimeFor(url), null, 206, "Partial Content", headers, new ByteArrayInputStream(bytes));
            }

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

    /** 大小写不敏感请求头查找（WebResourceRequest.getRequestHeaders 键大小写依实现而异） */
    private static String findHeader(Map<String, String> headers, String name) {
        if (headers == null) return null;
        for (Map.Entry<String, String> e : headers.entrySet()) {
            if (name.equalsIgnoreCase(e.getKey())) return e.getValue();
        }
        return null;
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
