package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

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

import okhttp3.Request;
import okhttp3.Response;

/**
 * Pixiv API 请求插件 — Capacitor 薄壳（#114），网络引擎已提取至 PixivApiCore。
 *
 * 所有 Pixiv App-API 请求通过此插件转发，自动注入 Authorization、
 * Referer、User-Agent；遇到 401 时内部静默刷新 token 后重试一次。
 * 图片预缓存直接将 i.pximg.net 资源下载到应用缓存目录。
 *
 * 调用方式（JS 侧）：
 *   PixivApi.request({ method, path, params, body })
 *   PixivApi.syncToken({ token })  // token 为 null/空 时清除 Native 内存与历史残留
 *   PixivApi.prefetchImage({ url })
 */
@CapacitorPlugin(name = "PixivApi")
public class PixivApiPlugin extends Plugin {

    private static final String CACHE_DIR_NAME = "pictelio-images";
    private static final String PREFS_NAME = "PictelioPrefs";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";

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

    @PluginMethod
    public void prefetchImage(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("url is required");
            return;
        }

        try {
            // 确保缓存目录存在
            File cacheDir = new File(getContext().getCacheDir(), CACHE_DIR_NAME);
            if (!cacheDir.exists()) {
                cacheDir.mkdirs();
            }

            // 以 URL 的 Base64 作为文件名——与拦截链路共享 PixivImageLoader 的 key 方案
            //（原内联实现为三处重复之一，B5 收敛后写盘纪律也统一）
            File cacheFile = new File(cacheDir, PixivImageLoader.keyToFilename(url));

            if (cacheFile.exists() && cacheFile.length() > 0) {
                // 已缓存，直接返回
                JSObject result = new JSObject();
                result.put("cached", true);
                result.put("path", cacheFile.getAbsolutePath());
                call.resolve(result);
                return;
            }

            // 下载图片
            Request request = new Request.Builder()
                    .url(url)
                    .addHeader("Referer", OAuthConfig.REFERER)
                    .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                    .build();

            try (Response response = PixivApiCore.getSharedClient().newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    call.reject("Download failed (HTTP " + response.code() + ")");
                    return;
                }

                byte[] bytes = response.body() != null ? response.body().bytes() : new byte[0];
                // B5/P1：预取与拦截链路并发写同文件是诊断 F3 的截断根源，必须走同一原子写
                //（tmp+rename），不能直写 FileOutputStream
                PixivImageLoader.writeFile(cacheFile, bytes);

                // X1：详情页预取热路径填充点——预取字节已在手，≤512KB 的缩略图/卡片图直接进
                // 内存 LRU，详情页渲染触发 /pixiv-img/ 拦截时即内存命中（省一次磁盘回读）。
                // key 用原始 CDN URL：无自定义图床时与拦截侧 rewriteUrl 产物同 key
                //（IMAGE_CDN_URL 前缀一致），可直接命中
                ImageBytesMemoryCache.getInstance().putBounded(url, bytes);

                JSObject result = new JSObject();
                result.put("cached", false);
                result.put("path", cacheFile.getAbsolutePath());
                result.put("size", bytes.length);
                call.resolve(result);
            }
        } catch (Exception e) {
            call.reject("Prefetch failed: " + e.getMessage());
        }
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
