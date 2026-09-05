package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.WebResourceResponse;

import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.FileInputStream;
import java.util.HashMap;
import java.util.Map;

/**
 * /pixiv-img/ 拦截核心（X1 纯重构）：从 {@code MainActivity(full)}/{@code MainActivityWebview}
 * 的逐字重复实现抽取为共享类——两个 flavor 均编译 webview 源集（build.gradle sourceSets），
 * 一处改动同时生效；lynx flavor 不编译该源集，零 diff。
 *
 * <p><b>行为变化点</b>（仅 spec X1 列明的三处，其余与原实现逐字等价）：
 * <ol>
 *   <li>telemetry：hit/miss/err 三个 return 前结算 PerfLog（计时+格式化仅 DEBUG）;</li>
 *   <li>F1 修复：磁盘命中补 immutable 头——原实现 headers=null 时
 *       {@code OtaPlugin.ensureNoStore} 会给 null 头注入 {@code Cache-Control: no-store}
 *       （OtaPlugin.java:438-451），导致磁盘命中永不进 Chromium 内存缓存，同 URL
 *       每次渲染都重进拦截器（磁盘命中 3-4ms 热路径的根源）；</li>
 *   <li>内存热路径：{@link ImageBytesMemoryCache} 命中直接 serve（ByteArrayInputStream）；
 *       磁盘命中异步回填；miss 下载完成后写入。</li>
 * </ol>
 */
public final class ImageIntercept {

    /** 保留原 Activity 的 TAG——logcat 过滤契约不变（原 interceptImage 失败日志同 tag） */
    private static final String TAG = "MainActivity";

    /** 共享图片加载器（#58）：单实例保证 per-URL 锁在并发拦截下生效（避免同 URL 双写缓存） */
    private static volatile PixivImageLoader imageLoader;

    private ImageIntercept() {}

    private static PixivImageLoader imageLoader(Context context) {
        PixivImageLoader l = imageLoader;
        if (l == null) {
            synchronized (ImageIntercept.class) {
                if (imageLoader == null) {
                    imageLoader = new PixivImageLoader(context.getApplicationContext());
                }
                l = imageLoader;
            }
        }
        return l;
    }

    /**
     * 拦截 /pixiv-img/ 请求；非代理 URL 或失败返回 null（交还原 WebViewClient）。
     *
     * <p>release 零开销：计时只在 DEBUG 分支发生（telemetry 硬约束），非 DEBUG 路径
     * telemetry 恒 false，无计时、无格式化、无 Log.i。
     */
    public static WebResourceResponse interceptImage(Context context, String url) {
        if (url == null || !url.contains("/pixiv-img/")) return null;
        if (BuildConfig.DEBUG) {
            return interceptInternal(context, url, true);
        }
        return interceptInternal(context, url, false);
    }

    private static WebResourceResponse interceptInternal(Context context, String url, boolean telemetry) {
        long start = telemetry ? SystemClock.uptimeMillis() : 0L;
        try {
            // URL 重写 + 下载 + 磁盘缓存统一走 PixivImageLoader 公共核心（#57/#58，
            // 与 Lynx PictelioImageService 同源；未命中时补全写盘——行为增强）
            String pixivUrl = PixivImageLoader.rewriteUrl(url);

            // 读取 JS 侧持久化的缓存开关（Capacitor Preferences 存储在默认 SharedPreferences 中）
            SharedPreferences prefs = context.getApplicationContext().getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
            boolean diskCacheEnabled = "true".equals(prefs.getString("image_cache_disk", "true"));
            boolean browserCacheEnabled = "true".equals(prefs.getString("image_cache_browser", "true"));

            PixivImageLoader loader = imageLoader(context);
            ImageBytesMemoryCache memCache = ImageBytesMemoryCache.getInstance();

            // ── 0: 内存热路径（X1）：命中直接 serve，绝不回读磁盘/网络 ──
            byte[] memBytes = memCache.get(pixivUrl);
            if (memBytes != null) {
                if (telemetry) PerfLog.logIntercept(pixivUrl, "hit", "mem", SystemClock.uptimeMillis() - start, memBytes.length);
                return bytesResponse(url, memBytes, browserCacheEnabled);
            }

            if (diskCacheEnabled) {
                // ── A: 磁盘缓存优先 ──
                File cached = loader.cachedFile(pixivUrl);
                if (cached != null) {
                    if (telemetry) PerfLog.logIntercept(pixivUrl, "hit", "disk", SystemClock.uptimeMillis() - start, cached.length());
                    // 异步回填内存缓存：下次同 URL 直接走内存热路径（拦截线程不回读磁盘）
                    memCache.backfillFromFile(pixivUrl, cached);
                    // F1：原实现 headers=null → ensureNoStore 注入 no-store → 磁盘命中永不进
                    // Chromium 缓存，同 URL 每次渲染重进拦截器。补 immutable 头（与 bytesResponse
                    // 同规则；用户关浏览器缓存时不加，ADR-0090 语义保持）
                    return diskResponse(url, cached, browserCacheEnabled);
                }
                // 未命中：下载 + 写盘（#57 补全缓存写入）
                byte[] bytes = loader.loadBytes(pixivUrl);
                memCache.putBounded(pixivUrl, bytes);
                if (telemetry) PerfLog.logIntercept(pixivUrl, "miss", null, SystemClock.uptimeMillis() - start, bytes.length);
                return bytesResponse(url, bytes, browserCacheEnabled);
            }

            // ── B: 磁盘缓存关闭 → 仅下载不写盘（Referer/UA 注入在核心内） ──
            byte[] bytes = loader.download(pixivUrl);
            memCache.putBounded(pixivUrl, bytes);
            if (telemetry) PerfLog.logIntercept(pixivUrl, "miss", null, SystemClock.uptimeMillis() - start, bytes.length);
            return bytesResponse(url, bytes, browserCacheEnabled);
        } catch (Exception e) {
            Log.w(TAG, "interceptImage 失败: " + url, e);
            // 失败时 pixivUrl 可能未产出（如 rewriteUrl 抛出），url8 用原始代理 URL 兜底
            if (telemetry) PerfLog.logIntercept(url, "err", null, SystemClock.uptimeMillis() - start, -1);
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

    /**
     * F1 响应头构造单点（S1 机器防线）：包可见静态纯函数。原实现 bytesResponse/diskResponse
     * 两处内联同一字面量，私有方法内联无任何测试可达，翻转回归无防线——提为纯函数后由
     * {@code ImageInterceptTest} 直接断言。内存命中 serve 复用 bytesResponse，三处统一收敛。
     *
     * <p>enabled=false 返回空 Map：此时 {@code OtaPlugin.ensureNoStore} 会注入 no-store，
     * 与用户「响应不进浏览器缓存」意图一致（ADR-0090 语义保持）。
     */
    static Map<String, String> cacheHeaders(boolean browserCacheEnabled) {
        Map<String, String> headers = new HashMap<>();
        if (browserCacheEnabled) {
            headers.put("Cache-Control", "public, max-age=31536000, immutable");
        }
        return headers;
    }

    /** 字节 → WebResourceResponse（browserCacheEnabled 时加 immutable 头） */
    private static WebResourceResponse bytesResponse(String url, byte[] bytes, boolean browserCacheEnabled) {
        return new WebResourceResponse(
                mimeFor(url), null, 200, "OK", cacheHeaders(browserCacheEnabled),
                new ByteArrayInputStream(bytes));
    }

    /**
     * 磁盘文件 → WebResourceResponse（F1 修复：与 bytesResponse 同规则补 immutable 头，
     * 避免 ensureNoStore 注入 no-store；用户关浏览器缓存时不加）。
     */
    private static WebResourceResponse diskResponse(String url, File file, boolean browserCacheEnabled) throws java.io.FileNotFoundException {
        return new WebResourceResponse(
                mimeFor(url), null, 200, "OK", cacheHeaders(browserCacheEnabled),
                new FileInputStream(file));
    }
}
