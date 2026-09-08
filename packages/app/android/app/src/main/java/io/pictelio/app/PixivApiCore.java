package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.concurrent.TimeUnit;

import android.util.Log;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Pixiv API 网络核心 — 双 client（webview/lynx）共享，零 Capacitor 依赖。
 *
 * <p>从 PixivApiPlugin 提取（#114），包含：
 * <ul>
 *   <li>access_token / refresh_token 静态字段（Java 堆，JS 零知）
 *   <li>401 自动刷新 + 单次的重试（synchronized 防并发刷新风暴）
 *   <li>OAuth refresh_token 交换（md5 签名 + X-Client-Time/Hash）
 *   <li>OkHttpClient 单例（连接池调优）
 * </ul>
 *
 * <p>调用方：
 * <ul>
 *   <li>webview → PixivApiPlugin（Capacitor 壳，委托本类）
 *   <li>lynx → PictelioApiModule / PictelioAuthModule（Lynx Native Module）
 * </ul>
 */
final class PixivApiCore {

    private static final String API_BASE = "https://app-api.pixiv.net";

    private static volatile OkHttpClient client;
    /** #53：Lynx Native Module（PictelioAuth/PictelioApi）同包读写；access_token 只进不出 */
    static String accessToken;
    static String refreshToken;
    /** 刷新 token 中的锁，防止并发 401 重复刷新 */
    private static volatile boolean isRefreshing = false;

    private PixivApiCore() {}

    // ─── OkHttp 客户端（单例） ────────────────────────────────

    private static OkHttpClient getClient() {
        if (client != null) return client;
        synchronized (PixivApiCore.class) {
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
     * 对外暴露共享 OkHttp 客户端，供 PixivImageLoader 复用连接池，
     * 避免每次图片请求都创建新的 HttpURLConnection。
     */
    static OkHttpClient getSharedClient() {
        return getClient();
    }

    // ─── API 端点 ────────────────────────────────────────────

    static String apiBase() {
        return API_BASE;
    }

    // ─── 401 刷新 + 重试核心 ─────────────────────────────────

    /** #53：token 轮换回调（webview 用 notifyListeners；Lynx 传 null） */
    interface RefreshTokenRotationListener {
        void onRefreshTokenRotated(String newRefreshToken);
    }

    /**
     * 执行 HTTP 请求，遇 401 自动刷新 token 后重试一次。
     * #53：package-private static，供 PictelioApiModule（Lynx）同包转发。
     * #114：返回类型从 JSObject 改为 JSONObject（去 Capacitor 依赖）。
     *
     * @param rotationListener 401 刷新且 refresh_token 轮换时回调（webview 通知 JS；Lynx 传 null）
     */
    static JSONObject executeRequest(String method, String url, String body, boolean isRetry,
            RefreshTokenRotationListener rotationListener)
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
                String rotated = null;
                synchronized (PixivApiCore.class) {
                    if (!isRefreshing) {
                        isRefreshing = true;
                        try {
                            rotated = refreshAccessTokenCore();
                        } finally {
                            isRefreshing = false;
                        }
                    }
                }
                if (rotated != null) {
                    if (rotationListener != null && !rotated.isEmpty()) {
                        rotationListener.onRefreshTokenRotated(rotated);
                    }
                    return executeRequest(method, url, body, true, rotationListener);
                }
            }

            JSONObject result = new JSONObject();
            result.put("status", statusCode);
            result.put("data", responseBody);
            return result;
        }
    }

    // ─── 内部：刷新 Access Token ──────────────────────────────

    /**
     * 刷新核心（#53）：oauthTokenExchange 更新 Java 堆字段，无 notify——
     * Lynx executeRequest/PictelioAuth 401 刷新用。
     *
     * @return 成功时返回新 refresh_token（可能为空串），失败返回 null
     */
    static String refreshAccessTokenCore() {
        try {
            String saved = refreshToken;
            if (saved == null || saved.isEmpty()) {
                return null;
            }
            JSONObject r = oauthTokenExchange(saved);
            if (r == null) {
                return null;
            }
            accessToken = r.optString("accessToken");
            String newRefresh = r.optString("refreshToken");
            if (!newRefresh.isEmpty()) {
                refreshToken = newRefresh;
            }
            return newRefresh;
        } catch (Exception e) {
            return null;
        }
    }

    /**
     * OAuth refresh_token 交换（#53，Lynx PictelioAuth 登录用）。
     *
     * 复用主项目 OAuth 请求（client_id/secret + spark-md5 签名），
     * 返回完整结果：{accessToken, refreshToken, user}——access_token 只进
     * Java 堆（调用方负责写入字段），user 供 JS 展示。失败返回 null。
     */
    static JSONObject oauthTokenExchange(String refreshToken)
            throws IOException, JSONException {
        String localTime = DateTimeFormatter.ISO_OFFSET_DATE_TIME
                .withZone(ZoneOffset.UTC)
                .format(Instant.now())
                .replace("Z", "+00:00");
        String clientHash = OAuthUtils.md5Hex(localTime + OAuthConfig.HASH_SECRET);

        String formBody = new OAuthUtils.URLSearchParams()
                .add("client_id", OAuthConfig.CLIENT_ID)
                .add("client_secret", OAuthConfig.CLIENT_SECRET)
                .add("grant_type", "refresh_token")
                .add("refresh_token", refreshToken)
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
                Log.w("PixivApiCore", "oauthTokenExchange HTTP " + response.code()
                        + " 失败（refresh_token 无效或服务端拒绝）");
                return null;
            }
            String responseBody = response.body() != null ? response.body().string() : "";
            if (responseBody.isEmpty()) {
                return null;
            }
            JSONObject json = new JSONObject(responseBody);
            JSONObject resp = json.optJSONObject("response");
            if (resp == null) {
                resp = json;
            }
            if (!resp.has("access_token")) {
                return null;
            }
            JSONObject result = new JSONObject();
            result.put("accessToken", resp.optString("access_token"));
            result.put("refreshToken", resp.optString("refresh_token", ""));
            result.put("user", resp.optJSONObject("user"));
            return result;
        }
    }

    // ─── 工具方法 ─────────────────────────────────────────────

    /**
     * 从图片 URL 中提取文件扩展名（如 .jpg, .png）。
     */
    static String extractExtension(String url) {
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
