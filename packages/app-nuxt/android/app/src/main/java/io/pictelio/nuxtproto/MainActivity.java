package io.pictelio.nuxtproto;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;

import java.util.HashMap;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(OtaPlugin.class);
        super.onCreate(savedInstanceState);
        final WebView webView = bridge.getWebView();
        if (webView != null) wrapNoStore(webView);
    }

    @Override
    public void onStart() {
        super.onStart();
        // 兜底：若 onCreate 时 WebView 尚未创建，此处补挂（幂等）
        final WebView webView = bridge.getWebView();
        if (webView != null) wrapNoStore(webView);
    }

    /**
     * PROTOTYPE 关键修复（#245 实测发现）：Capacitor 本地服务器响应不带 Cache-Control，
     * Chromium 启发式缓存 index.html/chunk——OTA 切换后旧文档从缓存复活、误调 notifyReady
     * （坏 bundle 被标健康）。onCreate/onStart 双挂点（首次文档加载最早发生在 onStart 前）。
     */
    private void wrapNoStore(WebView webView) {
        final WebViewClient original = webView.getWebViewClient();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view, WebResourceRequest request) {
                WebResourceResponse response = original != null
                        ? original.shouldInterceptRequest(view, request)
                        : super.shouldInterceptRequest(view, request);
                if (response != null) {
                    Map<String, String> headers = response.getResponseHeaders();
                    if (headers == null) {
                        headers = new HashMap<>();
                        response.setResponseHeaders(headers);
                    }
                    if (!headers.containsKey("Cache-Control")) {
                        headers.put("Cache-Control", "no-store");
                    }
                }
                return response;
            }
        });
    }
}
