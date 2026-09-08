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

import okhttp3.MediaType;
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
                .url("https://oauth.secure.pixiv.net/auth/token") // 官方域 + directaccess 钉 IP
                .addHeader("X-Client-Time", localTime)
                .addHeader("X-Client-Hash", clientHash)
                .addHeader("App-OS", OAuthConfig.APP_OS)
                .addHeader("App-OS-Version", OAuthConfig.APP_OS_VERSION)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .addHeader("Content-Type", OAuthConfig.CONTENT_TYPE)
                .post(RequestBody.create(body, MediaType.parse(OAuthConfig.CONTENT_TYPE)))
                .build();

        bridge.saveCall(call);
        // #386：复用 PixivApiCore 共享 OkHttp 单例（同包 package-private 访问，
        // 先例：PictelioApiModule 同包调用 PixivApiCore 静态成员），
        // 不再自建 client——连接池/dispatcher/callTimeout 与全 app 网络面收敛为一。
        PixivApiCore.getSharedClient().newCall(request).enqueue(new okhttp3.Callback() {
            @Override
            public void onResponse(okhttp3.Call c, Response response) {
                try {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    if (!response.isSuccessful()) {
                        call.reject(oauthRejectMessage(response.code(), responseBody));
                        bridge.releaseCall(call);
                        return;
                    }

                    JSObject result = parseTokenResponse(responseBody);
                    call.resolve(result);
                    bridge.releaseCall(call);
                } catch (JSONException e) {
                    call.reject("Failed to parse OAuth response: " + e.getMessage());
                    bridge.releaseCall(call);
                } catch (Exception e) {
                    call.reject("Unexpected error: " + e.getMessage());
                    bridge.releaseCall(call);
                }
            }

            @Override
            public void onFailure(okhttp3.Call c, IOException e) {
                call.reject("Network error: " + e.getMessage());
                bridge.releaseCall(call);
            }
        });
    }

    /**
     * 通知 Native 层关闭 Splash Screen。
     *
     * 由 JS 侧在内容就绪后调用，将 MainActivity.keepSplashVisible 置为 false，
     * 触发 setKeepOnScreenCondition 退出 SplashScreen。
     */
    @PluginMethod
    public void hideSplash(PluginCall call) {
        SplashController.dismiss();
        call.resolve();
    }

    /**
     * 构造 OAuth 交换失败（非 2xx）的 reject 消息（#386 code-review 审计一防线）。
     *
     * <p><b>跨端契约（改动前先读）</b>：前缀 {@code "OAuth failed (HTTP 4xx)"} 是 JS 侧
     * {@code authStore.isAuthErrorPermanent}（authStore.ts）做永久/瞬时分类的判据——
     * 其对消息做 {@code includes("OAuth failed (HTTP 40")} 子串匹配，400–409 由此判定为
     * 永久失效（触发 logout），其余（TypeError/429 等）为瞬时（保留 token 待重试）。
     * {@link AuthPluginTest} 钉住该前缀形态：改消息必先核对 JS 消费方。
     */
    static String oauthRejectMessage(int statusCode, String responseBody) {
        return "OAuth failed (HTTP " + statusCode + "): "
                + responseBody.substring(0, Math.min(300, responseBody.length()));
    }

    /**
     * 解析 OAuth token 交换成功响应（HTTP 2xx）为插件结果对象（#386）。
     *
     * <p>包可见静态纯函数：从 refreshToken 的 onResponse 内联逻辑<b>原样提取</b>，
     * 供 JVM 单测（AuthPluginTest）直接验证解析契约。提取后行为逐字节等价：
     * <ul>
     *   <li>responseBody 非法 JSON → 抛 JSONException，由调用方 catch 映射为
     *       "Failed to parse OAuth response: ..." reject（与提取前同一条 catch 路径）；</li>
     *   <li>缺字段时按 optString/optInt 默认值宽松降级——生产路径上错误形态
     *       （has_error / error 载荷）以 HTTP 400 到达，已被调用方
     *       "OAuth failed (HTTP xxx)" reject 短路，不会进入本解析核心。</li>
     * </ul>
     *
     * @param responseBody HTTP 2xx 响应体
     * @return 结果对象：accessToken / refreshToken / userId / userName / userAccount，
     *         user 存在时另含 profileImageUrls（profile_image_urls 键值原样拷贝）
     * @throws JSONException responseBody 非法 JSON
     */
    static JSObject parseTokenResponse(String responseBody) throws JSONException {
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
        return result;
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
