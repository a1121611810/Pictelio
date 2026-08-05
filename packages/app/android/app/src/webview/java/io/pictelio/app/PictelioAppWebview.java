package io.pictelio.app;

import android.app.Application;

/**
 * Pictelio Application 入口（webview flavor）。
 *
 * <p>仅预热 WebView 服务进程，无 Lynx 初始化。
 * WebView 预热与 SplashScreen 互补：SplashScreen 掩盖 Activity 初始化到首帧
 * 绘制之间的视觉空白；预热缩短 WebView 服务进程初始化耗时。异常安全：预热失败
 * 静默吞异常，app 正常启动，正式 WebView 回退冷初始化路径。
 */
public class PictelioAppWebview extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        warmUpWebView();
    }

    private void warmUpWebView() {
        try {
            android.webkit.WebView webView = new android.webkit.WebView(this);
            webView.destroy();
        } catch (Exception ignored) {
            // 预热失败不阻塞 app 启动
        }
    }
}
