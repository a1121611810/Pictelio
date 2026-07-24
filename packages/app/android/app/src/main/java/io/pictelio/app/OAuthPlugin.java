package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.view.ViewGroup;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.LinearLayout;
import android.widget.ProgressBar;

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
import java.util.concurrent.TimeUnit;

import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;

/**
 * Pixiv OAuth 授权码流程插件 — 在 Native 层完成 WebView 登录 + Token 交换。
 *
 * 提供两个方法：
 *
 * 1. startOAuth() — 在 AlertDialog 中打开 WebView 导航到 Pixiv 登录页，
 *    通过 shouldOverrideUrlLoading 拦截回调 URL，提取 authorization_code。
 *
 * 2. exchangeCode() — 使用 authorization_code 交换 access_token + refresh_token。
 *    凭证从 OAuthConfig（由 credentials.json5 自动生成）读取，
 *    仅存在于编译后的 Java 字节码中，不出现在 JS bundle 中。
 */
@CapacitorPlugin(name = "OAuthPlugin")
public class OAuthPlugin extends Plugin {

    private static volatile OkHttpClient client;
    private AlertDialog dialog;
    private WebView oauthWebView;
    private final Handler timeoutHandler = new Handler(Looper.getMainLooper());

    private static OkHttpClient getClient() {
        if (client != null) return client;
        synchronized (OAuthPlugin.class) {
            if (client != null) return client;
            client = new OkHttpClient.Builder()
                    .connectTimeout(OAuthConfig.TIMEOUT_CONNECT, TimeUnit.MILLISECONDS)
                    .readTimeout(OAuthConfig.TIMEOUT_READ, TimeUnit.MILLISECONDS)
                    .build();
        }
        return client;
    }

    /**
     * 打开内嵌 WebView 进行 Pixiv OAuth 登录。
     *
     * 1. 创建 AlertDialog 内嵌 WebView
     * 2. 导航到 Pixiv OAuth 登录 URL
     * 3. 通过 shouldOverrideUrlLoading 检测回调 URL
     * 4. 提取 authorization_code → resolve call
     *
     * @param call 包含 loginUrl 字段
     */
    @PluginMethod
    public void startOAuth(PluginCall call) {
        String loginUrl = call.getString("loginUrl");
        String codeChallenge = call.getString("codeChallenge");

        // 若提供了 codeChallenge 但无 loginUrl，从 OAuthConfig 构建完整 URL
        if ((loginUrl == null || loginUrl.isEmpty()) && codeChallenge != null && !codeChallenge.isEmpty()) {
            loginUrl = OAuthConfig.LOGIN_URL
                + "?client_id=" + OAuthConfig.CLIENT_ID
                + "&code_challenge=" + codeChallenge
                + "&code_challenge_method=S256&response_type=code&redirect_uri="
                + OAuthConfig.REDIRECT_URI;
        }

        if (loginUrl == null || loginUrl.isEmpty()) {
            call.reject("loginUrl or codeChallenge is required");
            return;
        }

        getBridge().getActivity().runOnUiThread(() -> {
            // ── 构建 WebView ──
            WebView webView = new WebView(getContext());
            oauthWebView = webView;
            webView.getSettings().setJavaScriptEnabled(true);
            webView.getSettings().setDomStorageEnabled(true);
            webView.getSettings().setAllowFileAccess(false);
            webView.getSettings().setUserAgentString(OAuthConfig.USER_AGENT);

            // ── 加载指示器 ──
            LinearLayout layout = new LinearLayout(getContext());
            layout.setOrientation(LinearLayout.VERTICAL);

            ProgressBar progressBar = new ProgressBar(getContext(), null, android.R.attr.progressBarStyleHorizontal);
            progressBar.setLayoutParams(new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    android.R.attr.progressBarStyleHorizontal != 0 ? 4 : 4
            ));

            layout.addView(progressBar);
            layout.addView(webView, new LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
            ));

            // ── WebViewClient ──
            webView.setWebViewClient(new WebViewClient() {
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    String url = request.getUrl().toString();
                    String code = extractCode(url);
                    if (code != null) {
                        timeoutHandler.removeCallbacksAndMessages(null);
                        dismissDialog();
                        JSObject result = new JSObject();
                        result.put("code", code);
                        call.resolve(result);
                        return true;
                    }
                    return false;
                }

                @SuppressWarnings("deprecation")
                @Override
                public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    String code = extractCode(url);
                    if (code != null) {
                        timeoutHandler.removeCallbacksAndMessages(null);
                        dismissDialog();
                        JSObject result = new JSObject();
                        result.put("code", code);
                        call.resolve(result);
                        return true;
                    }
                    return false;
                }

                @Override
                public void onPageStarted(WebView view, String url, Bitmap favicon) {
                    super.onPageStarted(view, url, favicon);
                    progressBar.setVisibility(ViewGroup.VISIBLE);
                }

                @Override
                public void onPageFinished(WebView view, String url) {
                    super.onPageFinished(view, url);
                    progressBar.setVisibility(ViewGroup.GONE);
                }

                @Override
                public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                    super.onReceivedError(view, errorCode, description, failingUrl);
                    // 兜底：如果出错 URL 中包含 authorization_code，直接提取
                    if (failingUrl != null && failingUrl.contains("code=")) {
                        String code = extractCode(failingUrl);
                        if (code != null) {
                            timeoutHandler.removeCallbacksAndMessages(null);
                            dismissDialog();
                            JSObject result = new JSObject();
                            result.put("code", code);
                            call.resolve(result);
                            return;
                        }
                    }
                    // 忽略非关键错误（如页面内嵌资源加载失败）
                    if (errorCode == ERROR_HOST_LOOKUP || errorCode == ERROR_CONNECT || errorCode == ERROR_TIMEOUT) {
                        timeoutHandler.removeCallbacksAndMessages(null);
                        dismissDialog();
                        call.reject("Network error: " + description);
                    }
                }
            });

            // ── 构建对话框 ──
            AlertDialog.Builder builder = new AlertDialog.Builder(getContext());
            builder.setTitle("Pixiv 登录");
            builder.setView(layout);
            builder.setCancelable(true);
            builder.setOnCancelListener((DialogInterface di) -> {
                timeoutHandler.removeCallbacksAndMessages(null);
                call.reject("cancelled");
            });

            dialog = builder.create();
            dialog.show();

            // ── 超时 ──
            timeoutHandler.postDelayed(() -> {
                if (dialog != null && dialog.isShowing()) {
                    dismissDialog();
                    call.reject("timeout");
                }
            }, OAuthConfig.TIMEOUT_OAUTH_DIALOG_READ);

            // ── 加载登录页 ──
            webView.loadUrl(loginUrl);
        });
    }

    /**
     * 使用 authorization_code 交换 access_token + refresh_token。
     *
     * @param call 包含 code 和 codeVerifier 字段
     */
    @PluginMethod
    public void exchangeCode(PluginCall call) {
        String code = call.getString("code");
        String codeVerifier = call.getString("codeVerifier");
        if (code == null || code.isEmpty()) {
            call.reject("code is required");
            return;
        }
        if (codeVerifier == null || codeVerifier.isEmpty()) {
            call.reject("codeVerifier is required");
            return;
        }

        String localTime = DateTimeFormatter.ISO_OFFSET_DATE_TIME
                .withZone(ZoneOffset.UTC)
                .format(Instant.now())
                .replace("Z", "+00:00");

        String clientHash = md5Hex(localTime + OAuthConfig.HASH_SECRET);

        String body = new AuthPlugin.URLSearchParams()
                .add("client_id", OAuthConfig.CLIENT_ID)
                .add("client_secret", OAuthConfig.CLIENT_SECRET)
                .add("grant_type", "authorization_code")
                .add("code", code)
                .add("code_verifier", codeVerifier)
                .add("redirect_uri", OAuthConfig.REDIRECT_URI)
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

        getClient().newCall(request).enqueue(new okhttp3.Callback() {
            @Override
            public void onResponse(okhttp3.Call c, Response response) {
                try {
                    String responseBody = response.body() != null ? response.body().string() : "";
                    if (!response.isSuccessful()) {
                        call.reject("OAuth failed (HTTP " + response.code() + "): "
                                + responseBody.substring(0, Math.min(300, responseBody.length())));
                        return;
                    }

                    JSONObject json = new JSONObject(responseBody);
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

                        JSONObject profileImageUrls = user.optJSONObject("profile_image_urls");
                        if (profileImageUrls != null) {
                            JSObject urls = new JSObject();
                            for (java.util.Iterator<String> it = profileImageUrls.keys(); it.hasNext(); ) {
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
                } catch (JSONException e) {
                    call.reject("Failed to parse OAuth response: " + e.getMessage());
                } catch (Exception e) {
                    call.reject("Unexpected error: " + e.getMessage());
                }
            }

            @Override
            public void onFailure(okhttp3.Call c, IOException e) {
                call.reject("Network error: " + e.getMessage());
            }
        });
    }

    // ── 工具方法 ──

    /**
     * 从回调 URL 中提取 authorization_code。
     * 支持 ?code=xxx 和 &code=xxx 两种模式。
     *
     * @param url 回调 URL
     * @return authorization_code，未找到时返回 null
     */
    private static String extractCode(String url) {
        if (url == null || url.isEmpty()) return null;

        // 查找 code 参数
        int codeIdx = url.indexOf("code=");
        if (codeIdx < 0) return null;

        int valueStart = codeIdx + 5;
        if (valueStart >= url.length()) return null;

        // 提取直到遇到 & 或字符串末尾
        int ampIdx = url.indexOf('&', valueStart);
        String code = ampIdx > 0 ? url.substring(valueStart, ampIdx) : url.substring(valueStart);

        return code.isEmpty() ? null : code;
    }

    /**
     * 计算 UTF-8 字符串的 MD5 十六进制摘要。
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

    private void dismissDialog() {
        if (dialog != null && dialog.isShowing()) {
            try {
                dialog.dismiss();
            } catch (Exception ignored) {
            }
        }
        dialog = null;
        // 释放 WebView 资源，防止内存泄漏
        if (oauthWebView != null) {
            try {
                oauthWebView.removeAllViews();
                oauthWebView.destroy();
            } catch (Exception ignored) {
            }
            oauthWebView = null;
        }
    }
}
