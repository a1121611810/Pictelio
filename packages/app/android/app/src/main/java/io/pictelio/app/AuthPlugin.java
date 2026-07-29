package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Iterator;
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Pixiv OAuth 认证插件 — 在 Native 层完成 refresh_token 交换。
 *
 * 凭证从 OAuthConfig（由 credentials.json5 自动生成）读取，
 * 仅存在于编译后的 Java 字节码中，不出现在 JS bundle 中。
 *
 * 调用方式（JS 侧）：
 *   AuthPlugin.refreshToken({ refreshToken: "..." })
 *     → { accessToken, refreshToken, userId, userName, userAccount }
 */
@CapacitorPlugin(name = "AuthPlugin")
public class AuthPlugin extends Plugin {

    private static volatile OkHttpClient client;

    private static OkHttpClient getClient() {
        if (client != null) return client;
        synchronized (AuthPlugin.class) {
            if (client != null) return client;
            client = new OkHttpClient.Builder()
                    .connectTimeout(OAuthConfig.TIMEOUT_CONNECT, TimeUnit.MILLISECONDS)
                    .readTimeout(OAuthConfig.TIMEOUT_READ, TimeUnit.MILLISECONDS)
                    .build();
        }
        return client;
    }

    /**
     * 使用 refresh_token 交换新的 access_token。
     *
     * @param call 包含 refreshToken 字段的 PluginCall
     */
    @PluginMethod
    public void refreshToken(PluginCall call) {
        String refreshToken = call.getString("refreshToken");
        if (refreshToken == null || refreshToken.isEmpty()) {
            call.reject("refreshToken is required");
            return;
        }

        String localTime = DateTimeFormatter.ISO_OFFSET_DATE_TIME
                .withZone(ZoneOffset.UTC)
                .format(Instant.now())
                .replace("Z", "+00:00");

        String clientHash = md5Hex(localTime + OAuthConfig.HASH_SECRET);

        String body = new URLSearchParams()
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
                .post(RequestBody.create(body, MediaType.parse(OAuthConfig.CONTENT_TYPE)))
                .build();

        saveCall(call);

        getClient().newCall(request).enqueue(new okhttp3.Callback() {
            @Override
            public void onResponse(okhttp3.Call c, Response response) {
                try {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    if (!response.isSuccessful()) {
                        call.reject("OAuth failed (HTTP " + response.code() + "): "
                                + responseBody.substring(0, Math.min(300, responseBody.length())));
                        releaseCall(call);
                        return;
                    }

                    JSONObject json = new JSONObject(responseBody);
                    // Pixiv 返回 { response: { access_token, refresh_token, user } }
                    JSONObject resp = json.optJSONObject("response");
                    if (resp == null) resp = json;

                    JSObject result = new JSObject();
                    result.put("accessToken", resp.optString("access_token", ""));
                    result.put("refreshToken", resp.optString("refresh_token", ""));

                    JSONObject user = resp.optJSONObject("user");
                    if (user != null) {
                        result.put("userId", user.optInt("id", 0));
                        result.put("userName", user.optString("name", ""));
                        result.put("userAccount", user.optString("account", ""));

                        // 提取 profile_image_urls（头像 URL），供 JS 侧 user() 信号使用
                        JSONObject profileImageUrls = user.optJSONObject("profile_image_urls");
                        if (profileImageUrls != null) {
                            JSObject urls = new JSObject();
                            for (Iterator<String> it = profileImageUrls.keys(); it.hasNext();) {
                                String key = it.next();
                                urls.put(key, profileImageUrls.optString(key, ""));
                            }
                            result.put("profileImageUrls", urls);
                        }
                    } else {
                        result.put("userId", 0);
                        result.put("userName", "");
                        result.put("userAccount", "");
                    }

                    call.resolve(result);
                    releaseCall(call);
                } catch (JSONException e) {
                    call.reject("Failed to parse OAuth response: " + e.getMessage());
                    releaseCall(call);
                } catch (Exception e) {
                    call.reject("Unexpected error: " + e.getMessage());
                    releaseCall(call);
                }
            }

            @Override
            public void onFailure(okhttp3.Call c, IOException e) {
                call.reject("Network error: " + e.getMessage());
                releaseCall(call);
            }
        });
    }

    /**
     * 计算 UTF-8 字符串的 MD5 十六进制摘要。
     * 使用 java.security.MessageDigest，无外部依赖。
     */
    private static String md5Hex(String input) {
        try {
            MessageDigest md = MessageDigest.getInstance("MD5");
            byte[] digest = md.digest(input.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(32);
            for (byte b : digest) {
                sb.append(String.format("%02x", b & 0xff));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("MD5 not available", e);
        }
    }

    // ─── 轻量 URLSearchParams 构建（不引入 Android SDK 依赖） ───

    /**
     * 轻量的 URL 编码表单构建器。
     * 避免引入 android.net.Uri 或 java.net.URLEncoder 的平台差异。
     */
    static class URLSearchParams {
        private final StringBuilder sb = new StringBuilder();

        URLSearchParams add(String key, String value) {
            if (sb.length() > 0) sb.append('&');
            sb.append(urlEncode(key)).append('=').append(urlEncode(value));
            return this;
        }

        String build() {
            return sb.toString();
        }

        private static String urlEncode(String s) {
            StringBuilder out = new StringBuilder(s.length());
            for (byte b : s.getBytes(StandardCharsets.UTF_8)) {
                int c = b & 0xff;
                if (c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z'
                        || c >= '0' && c <= '9' || c == '-' || c == '_'
                        || c == '.' || c == '*') {
                    out.append((char) c);
                } else if (c == ' ') {
                    out.append('+');
                } else {
                    out.append('%').append(String.format("%02X", c));
                }
            }
            return out.toString();
        }
    }
}
