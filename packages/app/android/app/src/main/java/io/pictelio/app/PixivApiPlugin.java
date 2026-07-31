package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import android.util.Base64;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Pixiv API 请求插件 — 在 Native 层完成鉴权注入与图片预缓存。
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

    private static final String API_BASE = "https://app-api.pixiv.net";
    private static final String CACHE_DIR_NAME = "pictelio-images";
    private static final String PREFS_NAME = "PictelioPrefs";
    private static final String KEY_REFRESH_TOKEN = "refresh_token";

    private static volatile OkHttpClient client;
    private static String accessToken;
    private static String refreshToken;
    /** 刷新 token 中的锁，防止并发 401 重复刷新 */
    private static volatile boolean isRefreshing = false;

    // ─── OkHttp 客户端（单例） ────────────────────────────────

    private static OkHttpClient getClient() {
        if (client != null) return client;
        synchronized (PixivApiPlugin.class) {
            if (client != null) return client;
            client = new OkHttpClient.Builder()
                    .connectTimeout(OAuthConfig.TIMEOUT_CONNECT, TimeUnit.MILLISECONDS)
                    .readTimeout(OAuthConfig.TIMEOUT_READ, TimeUnit.MILLISECONDS)
                    .callTimeout(OAuthConfig.TIMEOUT_CONNECT + OAuthConfig.TIMEOUT_READ, TimeUnit.MILLISECONDS)
                    .dispatcher(new okhttp3.Dispatcher(
                            java.util.concurrent.Executors.newCachedThreadPool()
                    ))
                    .build();
            // 提高每主机并发上限，避免大量多图请求时排队超时
            client.dispatcher().setMaxRequestsPerHost(10);
            client.dispatcher().setMaxRequests(20);
        }
        return client;
    }

    /**
     * 对外暴露共享 OkHttp 客户端，供 MainActivity.interceptImage 复用连接池，
     * 避免每次图片请求都创建新的 HttpURLConnection。
     */
    static OkHttpClient getSharedClient() {
        return getClient();
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
        StringBuilder urlBuilder = new StringBuilder(API_BASE);
        if (!path.startsWith("/")) urlBuilder.append('/');
        urlBuilder.append(path);

        // 追加查询参数
        String queryString = jsObjectToQuery(params);
        if (queryString != null) {
            urlBuilder.append(urlBuilder.indexOf("?") < 0 ? '?' : '&').append(queryString);
        }

        String url = urlBuilder.toString();

        try {
            JSObject result = executeRequest(method, url, body, false);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("Request failed: " + e.getMessage());
        }
    }

    /**
     * 执行 HTTP 请求，遇 401 自动刷新 token 后重试一次。
     */
    private JSObject executeRequest(String method, String url, String body, boolean isRetry)
            throws IOException, JSONException {
        Request.Builder builder = new Request.Builder()
                .url(url)
                .addHeader("Authorization", "Bearer " + (accessToken != null ? accessToken : ""))
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT);

        if ("POST".equalsIgnoreCase(method)) {
            MediaType mediaType = MediaType.parse(OAuthConfig.CONTENT_TYPE);
            RequestBody requestBody = body != null
                    ? RequestBody.create(body, mediaType)
                    : RequestBody.create("", null);
            builder.post(requestBody);
        }

        try (Response response = getClient().newCall(builder.build()).execute()) {
            int statusCode = response.code();
            String responseBody = response.body() != null ? response.body().string() : "";

            // 401 且未重试过 → 静默刷新 token 后重试
            if (statusCode == 401 && !isRetry) {
                boolean refreshed = false;
                synchronized (PixivApiPlugin.class) {
                    if (!isRefreshing) {
                        isRefreshing = true;
                        try {
                            refreshed = refreshAccessToken();
                        } finally {
                            isRefreshing = false;
                        }
                    }
                }
                if (refreshed) {
                    return executeRequest(method, url, body, true);
                }
            }

            JSObject result = new JSObject();
            result.put("status", statusCode);
            result.put("data", responseBody);
            return result;
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
        refreshToken = (token == null || token.isEmpty()) ? null : token;
        if (token == null || token.isEmpty()) {
            // 登出：顺带清空 access token（纵深防御，authPermanentFailure 已挡请求）
            accessToken = null;
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
        accessToken = token;
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

            // 以 URL 的 MD5 作为文件名，保留扩展名
            String ext = extractExtension(url);
            String filename = Base64.encodeToString(url.getBytes(), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
            File cacheFile = new File(cacheDir, filename);

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

            try (Response response = getClient().newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    call.reject("Download failed (HTTP " + response.code() + ")");
                    return;
                }

                byte[] bytes = response.body() != null ? response.body().bytes() : new byte[0];
                try (FileOutputStream fos = new FileOutputStream(cacheFile)) {
                    fos.write(bytes);
                    fos.flush();
                }

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

    // ─── 内部：刷新 Access Token ──────────────────────────────

    /**
     * 使用内存中的 refresh_token 调用 Pixiv OAuth 端点刷新 access_token，
     * 成功后更新内存变量。token 由 JS 侧通过 syncToken 注入（tokenReady barrier
     * 保证注入先于任何 API 请求，见 ADR-0041）。
     *
     * @return true 如果刷新成功
     */
    private boolean refreshAccessToken() {
        try {
            String savedRefreshToken = refreshToken;

            if (savedRefreshToken == null || savedRefreshToken.isEmpty()) {
                return false;
            }

            String localTime = DateTimeFormatter.ISO_OFFSET_DATE_TIME
                    .withZone(ZoneOffset.UTC)
                    .format(Instant.now())
                    .replace("Z", "+00:00");

            String clientHash = OAuthUtils.md5Hex(localTime + OAuthConfig.HASH_SECRET);

            String formBody = new OAuthUtils.URLSearchParams()
                    .add("client_id", OAuthConfig.CLIENT_ID)
                    .add("client_secret", OAuthConfig.CLIENT_SECRET)
                    .add("grant_type", "refresh_token")
                    .add("refresh_token", savedRefreshToken)
                    .add("get_secure_url", "1")
                    .build();

            Request request = new Request.Builder()
                    .url(OAuthConfig.AUTH_URL)
                    .addHeader("X-Client-Time", localTime)
                    .addHeader("X-Client-Hash", clientHash)
                    .addHeader("App-OS", OAuthConfig.APP_OS)
                    .addHeader("App-OS-Version", OAuthConfig.APP_OS_VERSION)
                    .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                    .addHeader("Content-Type", OAuthConfig.CONTENT_TYPE)
                    .post(RequestBody.create(formBody, MediaType.parse(OAuthConfig.CONTENT_TYPE)))
                    .build();

            try (Response response = getClient().newCall(request).execute()) {
                if (!response.isSuccessful()) {
                    return false;
                }
                String responseBody = response.body() != null ? response.body().string() : "";
                if (responseBody.isEmpty()) return false;

                org.json.JSONObject json = new org.json.JSONObject(responseBody);
                org.json.JSONObject resp = json.optJSONObject("response");
                if (resp == null) resp = json;

                String newAccessToken = resp.optString("access_token", null);
                String newRefreshToken = resp.optString("refresh_token", null);

                if (newAccessToken == null || newAccessToken.isEmpty()) {
                    return false;
                }

                accessToken = newAccessToken;

                // 如果服务端返回了新的 refresh_token，也更新（仅内存，不落盘）
                if (newRefreshToken != null && !newRefreshToken.isEmpty()) {
                    boolean rotated = !newRefreshToken.equals(refreshToken);
                    refreshToken = newRefreshToken;
                    if (rotated) {
                        // token 轮换：通知 JS 侧持久化新值，避免重启后回退旧 token
                        JSObject data = new JSObject();
                        data.put("token", newRefreshToken);
                        notifyListeners("refreshTokenRotated", data);
                    }
                }

                return true;
            }
        } catch (Exception e) {
            return false;
        }
    }

    // ─── 工具方法 ─────────────────────────────────────────────

    /**
     * 将 JSObject 转为 URL 查询字符串 (key=value&key2=value2)，跳过空 key。
     * 对 key 和 value 做 URL 编码。
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

    /**
     * 从图片 URL 中提取文件扩展名（如 .jpg, .png）。
     */
    private static String extractExtension(String url) {
        if (url == null) return "";
        int queryIdx = url.indexOf('?');
        String clean = queryIdx >= 0 ? url.substring(0, queryIdx) : url;
        int dotIdx = clean.lastIndexOf('.');
        if (dotIdx >= 0 && dotIdx < clean.length() - 1) {
            String ext = clean.substring(dotIdx);
            // 只保留常见图片扩展名
            if (ext.matches("(?i)\\.(jpg|jpeg|png|gif|webp|bmp|svg|avif)")) {
                return ext;
            }
        }
        return "";
    }


}
