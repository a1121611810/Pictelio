package io.pictelio.app;

import android.content.Intent;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.BridgeActivity;

import androidx.core.splashscreen.SplashScreen;

import android.view.View;
import android.view.animation.DecelerateInterpolator;

import io.pictelio.app.engine.EngineRoute;
import io.pictelio.app.engine.EngineRouting;

/**
 * Pictelio Android 客户端 — 拦截 /pixiv-img/ 请求并代理到 i.pximg.net（注入 Referer 头）。
 *
 * <p>入口路由（ADR-0164）：引擎决策唯一经 {@link EngineRouting#resolve}
 * （与 {@link PictelioApp} 预热共用同一决策入口）；本 Activity 是路由壳，
 * BOOT_LYNX 分发 {@link LynxActivity}、UPGRADE_PAGE 落升级页、BOOT_WEBVIEW
 * 落 Capacitor 启动。决策细节（首选/失败记忆/无障碍/双失败）全部在 EngineRouting，
 * ADR-0153 的「WebView 不可用 → Lynx」反向降级保留为矩阵 S10。
 */
public class MainActivity extends BridgeActivity {

    /** 供同包下的 AuthPlugin 调用，通知 SplashScreen 可退出 */
    static void dismissSplash() {
        SplashController.dismiss();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // ① 引擎入口路由（#51 / ADR-0164）：在 Splash/WebView 检查之前分发。
        // resolve 读 preferred（pictelio_client_kind，缺省即 lynx）+ 失败记忆 + 探针，
        // 经 spec §4 决策矩阵裁决并落生效状态快照。研究结论：BridgeActivity.onCreate
        // 无条件创建 WebView，不可同 Activity，故双 Activity 分发。
        // 注意：Android 硬约束——onCreate 必须调用 super.onCreate（否则 SuperNotCalledException，
        // 真机实测 2026-08-01），故各分支先 super 再跳转（bridge 初始化浪费可接受，立即 finish）。
        EngineRoute route = EngineRouting.resolve(getApplication(), FullEngineProbe.create(getApplication()),
                getIntent().getBooleanExtra(EngineRouting.EXTRA_FORCED_WEBVIEW, false),
                getIntent().getStringExtra(EngineRouting.EXTRA_STAY_REASON));
        if (route.action == EngineRoute.Action.BOOT_LYNX) {
            super.onCreate(savedInstanceState);
            // 修复「缩小后点图标永远回推荐页」（ADR-0102，模拟器实证根因）：
            // MainActivity 是 singleTask 路由壳，每次路由后 finish，永远没有存活实例可收
            // launcher 重投递的 onNewIntent → 系统只能重建本 Activity 并压在旧 LynxActivity
            // 之上 → 每次点图标都新开 LynxView（回推荐页 + task 无限堆叠，实测 2 次叠 3 层）。
            // 判别：重建进来时本 Activity 不是 task 根（下面压着存活的旧 LynxActivity）→
            // 直接 finish 退出，由系统恢复旧实例——页面/历史栈/滚动位置原样保留。
            // 冷启动 / 客户端切换（restart 走 CLEAR_TASK）MainActivity 恒为 task 根，不受影响。
            if (!isTaskRoot()) {
                finish();
                return;
            }
            // benchNav 深链参数转发（spec app-lynx-benchnav-meta-exit-hooks）：MainActivity 是
            // launcher 路由壳，`am start --es benchNav xxx` 的 extras 落本 intent，须转给 LynxActivity
            //（getIntent 读取，ADR-0136）；无 extras 时 putExtras 为空，零影响
            Intent lynxIntent = new Intent(this, LynxActivity.class);
            lynxIntent.putExtras(getIntent());
            // 降级进入标记（fallbackEntry = 生效 Lynx ∧ WebView 不可用，spec §4 派生规则）：
            // LynxActivity 错误页只给「退出应用」不给「返回 WebView」，防回环（ADR-0153 E7
            // 的「单次弹跳」被吸收为「不弹跳」，ADR-0164 决策 10）。
            if (route.fallbackEntry) {
                lynxIntent.putExtra(LynxActivity.EXTRA_ENGINE_FALLBACK, true);
            }
            startActivity(lynxIntent);
            finish();
            return; // 不注册插件、不做 WebView 版本检查（resolve 已裁决 Lynx 可用）
        }
        if (route.action == EngineRoute.Action.UPGRADE_PAGE) {
            // 双失败 / stay 且 WebView 不合格（S3/S5'/S11/E7）：升级提示页。
            // ADR-0164 决策 7：?reason= 携带原因码，upgrade.html 据此区分
            // 「WebView 版本过低」与「两引擎均不可用」文案。
            // 必须先 super.onCreate（Android 硬约束：跳过即 SuperNotCalledException 崩溃），
            // 且不初始化 Capacitor Bridge / 插件。
            super.onCreate(savedInstanceState);
            SplashController.dismiss();
            showWebViewUpgradeError(route.reason != null ? route.reason.code : null);
            return;
        }
        // BOOT_WEBVIEW：首选 webview / 预检降级（S2 lynx_unavailable）/ 失败记忆（S4）
        // / stay 回环落地 / 无障碍回退（S1a）——WebView 可用性已由 resolve 裁决
        // （ADR-0153 的「不可用降级 Lynx」保留为矩阵 S10；决策细节全部在 EngineRouting）。

        // 确保每次 Activity 重建时 Splash 可重新显示
        SplashController.keepVisible();
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> SplashController.shouldKeepVisible());
        splashScreen.setOnExitAnimationListener(splashScreenView -> {
            View icon = splashScreenView.getIconView();
            if (icon != null) {
                icon.animate()
                        .scaleX(1.8f).scaleY(1.8f)
                        .alpha(0f)
                        .setDuration(120L)
                        .setInterpolator(new DecelerateInterpolator(2f))
                        .withEndAction(splashScreenView::remove)
                        .start();
            } else {
                splashScreenView.remove();
            }
        });

        registerPlugin(ImageCachePlugin.class);
        registerPlugin(AuthPlugin.class);
        registerPlugin(OAuthPlugin.class);
        registerPlugin(PixivApiPlugin.class);
        registerPlugin(ClientInfoPlugin.class); // ADR-0062
        registerPlugin(OtaPlugin.class); // OTA web bundle（#249）
        registerPlugin(GallerySaverPlugin.class); // 保存到相册（spec image-save-download）
        registerPlugin(PictelioDownloaderPlugin.class); // 下载队列执行器（spec download-manager T3）
        registerPlugin(PictelioSharePlugin.class); // 系统分享（spec download-manager T6）
        registerPlugin(NetDiagPlugin.class); // 网络自检（spec network-self-check）
        registerPlugin(WebDavPlugin.class); // WebDAV 备份薄桥（spec webdav-backup T3）
        super.onCreate(savedInstanceState);
        // 调试模式 — debug 构建时启用
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true);
        }
    }

    @Override
    public void onStart() {
        super.onStart();

        final WebView webView = bridge.getWebView();
        if (webView == null) return;

        // 保留 Capacitor 原有的 WebViewClient，用包装类代理非图片请求；
        // 出口统一过 OtaPlugin.ensureNoStore（OTA 坑①：本地服务器响应缺 Cache-Control
        // 导致 Chromium 缓存旧文档，切换后旧 JS 复活误调 notifyReady）
        final WebViewClient originalClient = webView.getWebViewClient();
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(
                    WebView view,
                    WebResourceRequest request
            ) {
                String url = request.getUrl().toString();
                WebResourceResponse custom = interceptImage(url);
                if (custom != null) return OtaPlugin.ensureNoStore(custom);
                WebResourceResponse upstream;
                if (originalClient != null) {
                    upstream = originalClient.shouldInterceptRequest(view, request);
                } else {
                    upstream = super.shouldInterceptRequest(view, request);
                }
                return OtaPlugin.ensureNoStore(upstream);
            }

            @SuppressWarnings("deprecation")
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                WebResourceResponse custom = interceptImage(url);
                if (custom != null) return OtaPlugin.ensureNoStore(custom);
                // 弃用重载无法获取请求头，让原始 WebViewClient 处理
                WebResourceResponse upstream;
                if (originalClient != null) {
                    upstream = originalClient.shouldInterceptRequest(view, url);
                } else {
                    upstream = super.shouldInterceptRequest(view, url);
                }
                return OtaPlugin.ensureNoStore(upstream);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (originalClient != null) {
                    return originalClient.shouldOverrideUrlLoading(view, request);
                }
                return super.shouldOverrideUrlLoading(view, request);
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (originalClient != null) {
                    return originalClient.shouldOverrideUrlLoading(view, url);
                }
                return super.shouldOverrideUrlLoading(view, url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (originalClient != null) {
                    originalClient.onPageFinished(view, url);
                }
                super.onPageFinished(view, url);
            }
        });
    }

    // X1：拦截核心抽至共享类 ImageIntercept（full/webview 两 flavor 逐字重复实现合并，
    // 行为变化仅 spec 列明的 telemetry/immutable 头/内存热路径三处）
    private WebResourceResponse interceptImage(String url) {
        return ImageIntercept.interceptImage(getApplicationContext(), url);
    }

    // ── 升级提示页（探测逻辑已移交 WebViewAvailability，ADR-0164 决策 3 收编）──

    /**
     * 显示 WebView 升级提示页，阻止应用正常启动。
     *
     * <p>{@code reasonCode} 非空时以 query 传递（ADR-0164 决策 7：upgrade.html 据此
     * 区分「WebView 版本过低」与「两引擎均不可用」文案）；null = 旧语义单引擎文案。
     *
     * <p>直接加载本地静态 HTML，不初始化 Capacitor Bridge / 插件 / WebViewClient 等任何额外组件。
     */
    private void showWebViewUpgradeError(String reasonCode) {
        setContentView(R.layout.activity_webview_error);
        WebView wv = findViewById(R.id.webview_error);
        if (wv != null) {
            wv.getSettings().setJavaScriptEnabled(true);
            wv.loadUrl("file:///android_res/raw/upgrade.html"
                    + (reasonCode == null ? "" : "?reason=" + reasonCode));
        }
    }

}
