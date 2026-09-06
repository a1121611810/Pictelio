package io.pictelio.app;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;

/**
 * Pixiv API 请求插件 — Capacitor 薄壳（#114），网络引擎已提取至 PixivApiCore。
 *
 * 所有 Pixiv App-API 请求通过此插件转发，自动注入 Authorization、
 * Referer、User-Agent；遇到 401 时内部静默刷新 token 后重试一次。
 * 图片预缓存经 PixivImageLoader 下载核心落盘到应用缓存目录
 *（下载源随图床配置生效，缓存键恒为官方 URL——ADR-0143）。
 *
 * 调用方式（JS 侧）：
 *   PixivApi.request({ method, path, params, body })
 *   PixivApi.syncToken({ token })  // token 为 null/空 时清除 Native 内存与历史残留
 *   PixivApi.prefetchImage({ url })
 */
@CapacitorPlugin(name = "PixivApi")
public class PixivApiPlugin extends Plugin {

    private static final String PREFS_NAME = "PictelioPrefs";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";

    /** 共享图片加载器单例（与拦截链路共享同一下载核心）。Context 键控绑定：生产进程内
     *  ApplicationContext 恒同一对象（绑定永不触发重建）；Robolectric 每用例新建 Application
     *  → 自动重建，保证测试间无静态加载器/图床配置泄漏。 */
    private static volatile PixivImageLoader imageLoader;
    private static volatile Context imageLoaderApp;

    private static PixivImageLoader imageLoader(Context context) {
        Context app = context.getApplicationContext();
        PixivImageLoader l = imageLoader;
        if (l == null || imageLoaderApp != app) {
            synchronized (PixivApiPlugin.class) {
                app = context.getApplicationContext();
                if (imageLoader == null || imageLoaderApp != app) {
                    imageLoader = new PixivImageLoader(app);
                    imageLoaderApp = app;
                }
                l = imageLoader;
            }
        }
        return l;
    }

    // ─── 插件方法：通用 API 请求 ─────────────────────────────

    @PluginMethod
    public void request(PluginCall call) {
        String method = call.getString("method", "GET");
        String path = call.getString("path");
        JSObject params = call.getObject("params", null);
        String body = call.getString("body", null);

        if (path == null || path.isEmpty()) {
            call.reject("path is required");
            return;
        }

        // 构建 URL
        StringBuilder urlBuilder = new StringBuilder(PixivApiCore.apiBase());
        if (!path.startsWith("/")) urlBuilder.append('/');
        urlBuilder.append(path);

        // 追加查询参数
        String queryString = jsObjectToQuery(params);
        if (queryString != null) {
            urlBuilder.append(urlBuilder.indexOf("?") < 0 ? '?' : '&').append(queryString);
        }

        String url = urlBuilder.toString();

        try {
            JSONObject coreResult = PixivApiCore.executeRequest(method, url, body, false,
                    token -> {
                        // token 轮换：通知 JS 侧持久化新值（webview 专属；Lynx 走 PictelioAuth）
                        JSObject data = new JSObject();
                        data.put("token", token);
                        notifyListeners("refreshTokenRotated", data);
                    });
            // JSONObject → JSObject 桥接（#114：Core 去 Capacitor 化）
            JSObject result = new JSObject();
            result.put("status", coreResult.getInt("status"));
            result.put("data", coreResult.getString("data"));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Request failed: " + e.getMessage());
        }
    }

    // ─── 插件方法：同步 Refresh Token（内存持有，不落盘） ─────────

    /**
     * 同步 refresh_token 到 Native 内存（供 401 静默刷新使用）。
     *
     * token 为 null/空时清除内存值——登出路径调用。
     * 无论何种形态都幂等清理 PictelioPrefs.xml 中的历史明文残留
     * （旧版本 setRefreshToken 曾明文写入，见 ADR-0003 / docs/research）。
     *
     * 安全约束：refresh_token 只允许存在于 Java 堆内存，禁止落盘。
     */
    @PluginMethod
    public void syncToken(PluginCall call) {
        String token = call.getString("token");
        PixivApiCore.refreshToken = (token == null || token.isEmpty()) ? null : token;
        if (token == null || token.isEmpty()) {
            // 登出：顺带清空 access token（纵深防御，authPermanentFailure 已挡请求）
            PixivApiCore.accessToken = null;
        }

        getActivity().getSharedPreferences(PREFS_NAME, android.content.Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_REFRESH_TOKEN)
                .apply();

        call.resolve();
    }

    @PluginMethod
    public void setAccessToken(PluginCall call) {
        String token = call.getString("accessToken");
        if (token == null || token.isEmpty()) {
            call.reject("accessToken is required");
            return;
        }
        PixivApiCore.accessToken = token;
        JSObject result = new JSObject();
        result.put("success", true);
        call.resolve(result);
    }

    // ─── 插件方法：预缓存图片 ─────────────────────────────────

    /**
     * 图片预缓存（ADR-0143 T3）：下载源委托 {@link PixivImageLoader#download}——图床
     * resolve、镜像失败官方回退、Referer/UA 注入均在下载核心内（与拦截链路同源），
     * 本壳只做参数校验与结果映射。
     *
     * <p>行为申报（review P3 #1 补记）：失败 reject 消息从旧内联实现的
     * {@code "Download failed (HTTP xxx)"} 变为 {@code "Prefetch failed: <IOException 消息>"}
     * ——JS 侧仅 tryAsync 捕获后 console.warn，无文本解析消费方，无行为影响。
     * 另：空 body 200 响应由「写空缓存文件」变为抛 IOException 不写盘（download 核心语义，
     * self-healing miss 改进，ADR-0143 后果节已补记）。
     *
     * <p>缓存键契约（ADR-0143 D2 源无关命中不变量）：磁盘文件名与内存缓存键一律用
     * <b>官方入参 url</b>（而非 resolve 后的下载 URL）——下载源跟随图床，缓存键不跟随。
     */
    @PluginMethod
    public void prefetchImage(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        try {
            PrefetchResult r = prefetchCore(getContext(), url);
            JSObject result = new JSObject();
            result.put("cached", r.cached);
            result.put("path", r.path);
            if (!r.cached) {
                result.put("size", r.size);
            }
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Prefetch failed: " + e.getMessage());
        }
    }

    /** 预取结果：cached=true 为磁盘已命中（仅 path 有意义）；否则 size 为下载字节数 */
    static final class PrefetchResult {
        final boolean cached;
        final String path;
        final int size;

        private PrefetchResult(boolean cached, String path, int size) {
            this.cached = cached;
            this.path = path;
            this.size = size;
        }

        static PrefetchResult cachedHit(String path) {
            return new PrefetchResult(true, path, 0);
        }

        static PrefetchResult downloaded(String path, int size) {
            return new PrefetchResult(false, path, size);
        }
    }

    /**
     * 预取核心（生产入口）：持有共享 loader 单例（与拦截链路同源）后委托注入核心。
     */
    static PrefetchResult prefetchCore(Context ctx, String url) throws IOException {
        return prefetchCore(imageLoader(ctx), url);
    }

    /**
     * 预取核心（包可见：loader 注入的可测单口）。行为与原内联实现等价：
     * 已缓存短路；未命中下载后经 {@link PixivImageLoader#writeFile} 原子写盘（B5 纪律，
     * tmp+rename 防并发截断），内存 LRU 以官方 url 键填充（X1 详情页预取热路径）。
     * 仅下载源随图床生效；非 2xx / 空 body 抛 IOException（壳映射为 reject）。
     *
     * <p>测试注入独立 loader（Robolectric 生产单例跨测试存活，绑定首个测试的
     * Application 会让 SharedPreferences fixture / cacheDir 失真，故全注入隔离）。
     */
    static PrefetchResult prefetchCore(PixivImageLoader loader, String url) throws IOException {
        // 磁盘文件名 = keyToFilename(官方 url)——与拦截链路共享 key 方案；不得用 resolve 返回值
        File cacheFile = new File(loader.getCacheDir(), PixivImageLoader.keyToFilename(url));

        if (cacheFile.exists() && cacheFile.length() > 0) {
            // 已缓存，直接返回
            return PrefetchResult.cachedHit(cacheFile.getAbsolutePath());
        }

        // 下载（图床 resolve + 镜像失败官方回退 + Referer/UA 注入均在 PixivImageLoader 内）
        byte[] bytes = loader.download(url);
        // B5/P1：预取与拦截链路并发写同文件是诊断 F3 的截断根源，必须走同一原子写
        //（tmp+rename），不能直写 FileOutputStream
        PixivImageLoader.writeFile(cacheFile, bytes);

        // X1：详情页预取热路径填充点——预取字节已在手，≤512KB 的缩略图/卡片图直接进
        // 内存 LRU，详情页渲染触发 /pixiv-img/ 拦截时即内存命中（省一次磁盘回读）。
        // key 恒为官方入参 url（ADR-0143 D2）：无论字节来自官方还是镜像，拦截侧按官方键
        // 查询必命中；图床关时与拦截侧 rewriteUrl 产物同 key 的既有对齐保持不变
        ImageBytesMemoryCache.getInstance().putBounded(url, bytes);

        return PrefetchResult.downloaded(cacheFile.getAbsolutePath(), bytes.length);
    }

    // ─── 工具方法 ─────────────────────────────────────────────

    /**
     * 将 JSObject 转为 URL 查询字符串 (key=value&key2=value2)，跳过空 key。
     * 对 key 和 value 做 URL 编码。webview 专属（Lynx 侧不走 JSObject query）。
     */
    private static String jsObjectToQuery(JSObject obj) {
        if (obj == null || obj.keys() == null || !obj.keys().hasNext()) return null;

        StringBuilder sb = new StringBuilder();
        java.util.Iterator<String> keys = obj.keys();
        while (keys.hasNext()) {
            String key = keys.next();
            Object value = obj.opt(key);
            if (value == null) continue;
            if (sb.length() > 0) sb.append('&');
            sb.append(OAuthUtils.urlEncode(key)).append('=').append(OAuthUtils.urlEncode(value.toString()));
        }
        return sb.length() > 0 ? sb.toString() : null;
    }
}
