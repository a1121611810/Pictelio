package io.pictelio.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;

import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewBuilder;
import com.lynx.tasm.LynxViewClient;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Lynx client 宿主 Activity（#51，双 client 启动分支）。
 *
 * <p>由 MainActivity 入口路由分发（SharedPreferences("CapacitorStorage")
 * 的 {@code pictelio_client_kind} == "lynx" 时跳转）。纯 LynxView 全屏，
 * 无 Capacitor bridge 参与（研究：BridgeActivity 无法跳过 bridge 初始化，
 * 故采用双 Activity 方案）。
 *
 * <p>生命周期：onResume/onPause/onDestroy 转发 LynxView
 * onEnterForeground/onEnterBackground/destroy()（LynxView 无自带生命周期）。
 *
 * <p>返回键（MVP）：默认 predictive back（manifest 已开
 * {@code enableOnBackInvokedCallback}）→ 退出 Activity；前端路由返回由
 * app-lynx 页面内返回按钮处理。前后端 back 事件消费链路列为实现期验证项。
 */
public class LynxActivity extends AppCompatActivity {

    private static final String TAG = "LynxActivity";

    private LynxView lynxView;
    private final AtomicBoolean bundleLoaded = new AtomicBoolean(false);

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // SplashScreen.installSplashScreen 必须在 super.onCreate 之前（AndroidX 要求）
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> !bundleLoaded.get());
        super.onCreate(savedInstanceState);

        LynxViewBuilder builder = new LynxViewBuilder();
        // XElement behaviors（#51 真机必需）：<input>/<textarea> 等扩展元件
        builder.addBehaviors(new com.lynx.xelement.XElementBehaviors().create());
        builder.setTemplateProvider(new PictelioTemplateProvider(this));
        // per-view 注册（与 PictelioApp 全局注册并存；LynxEnv 全局优先）
        builder.registerModule("PictelioSecureStorage", PictelioSecureStorageModule.class);
        builder.registerModule("PictelioApp", PictelioAppModule.class);
        builder.registerModule("PictelioAuth", PictelioAuthModule.class);
        builder.registerModule("PictelioApi", PictelioApiModule.class);
        lynxView = builder.build(this);

        // Splash 退出时机：bundle 渲染成功/失败（替代 webview 分支 AuthPlugin.hideSplash 桥）
        lynxView.addLynxViewClient(new LynxViewClient() {
            @Override
            public void onLoadSuccess() {
                bundleLoaded.set(true);
                cancelLoadTimeout();
            }

            @Override
            public void onLoadFailed(String errorMsg) {
                String safe = sanitizeError(errorMsg);
                Log.w(TAG, "bundle 加载失败: " + safe);
                bundleLoaded.set(true); // 失败也退出 Splash，由页面展示错误态
                cancelLoadTimeout();
                showErrorFallback("Lynx bundle 加载失败：" + safe);
            }
        });

        setContentView(lynxView);
        // renderTemplateUrl(url, initData)：initData 由 app-lynx 启动自恢复，无需注入
        lynxView.renderTemplateUrl("main.lynx.bundle", "");

        // 兜底：bundle 加载可能既不回调成功也不回调失败（如宿主层卡死），
        // 10 秒未就绪则视为失败，退出 Splash 并展示错误页，避免启动屏/白屏卡死。
        scheduleLoadTimeout();
    }

    // ── bundle 加载失败兜底（#51 修复：切换引擎后白屏死锁） ─────────────

    /** 截断并清理 SDK 错误串，避免把本地路径/URL 等细节原样展示在用户可见错误页 */
    private static String sanitizeError(String msg) {
        if (msg == null) return "未知错误";
        String cleaned = msg.replaceAll("[\\r\\n\\t]+", " ").trim();
        return cleaned.length() > 120 ? cleaned.substring(0, 120) + "…" : cleaned;
    }

    private static final long LOAD_TIMEOUT_MS = 10_000L;
    private final Handler mainHandler = new Handler(Looper.getMainLooper());
    private final AtomicBoolean errorShown = new AtomicBoolean(false);
    private final Runnable loadTimeoutRunnable = () -> {
        if (!bundleLoaded.get()) {
            Log.w(TAG, "bundle 加载超时（" + LOAD_TIMEOUT_MS + "ms）→ 展示错误兜底");
            bundleLoaded.set(true); // 退出 Splash
            showErrorFallback("Lynx bundle 加载超时");
        }
    };

    private void scheduleLoadTimeout() {
        mainHandler.postDelayed(loadTimeoutRunnable, LOAD_TIMEOUT_MS);
    }

    private void cancelLoadTimeout() {
        mainHandler.removeCallbacks(loadTimeoutRunnable);
    }

    /**
     * bundle 加载失败/超时时展示错误视图（替代白屏），并提供"返回 WebView"出口。
     * full 包（含 webview 能力）才显示切回按钮；lynx-only 包仅展示错误信息。
     */
    private void showErrorFallback(String message) {
        if (errorShown.getAndSet(true)) return;
        runOnUiThread(() -> {
            LinearLayout root = new LinearLayout(this);
            root.setOrientation(LinearLayout.VERTICAL);
            root.setGravity(Gravity.CENTER);
            root.setPadding(dp(28), dp(28), dp(28), dp(28));
            root.setBackgroundColor(0xFF1B1B1B);

            TextView title = new TextView(this);
            title.setText("Lynx 客户端启动失败");
            title.setTextColor(0xFFFFFFFF);
            title.setTextSize(20);
            title.setGravity(Gravity.CENTER);
            root.addView(title, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            TextView detail = new TextView(this);
            detail.setText(message);
            detail.setTextColor(0xFFCCCCCC);
            detail.setTextSize(14);
            detail.setGravity(Gravity.CENTER);
            detail.setPadding(0, dp(12), 0, dp(28));
            root.addView(detail, new LinearLayout.LayoutParams(
                    LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT));

            if (hasWebviewClient()) {
                Button backButton = new Button(this);
                backButton.setText("返回 WebView");
                backButton.setOnClickListener(v -> switchBackToWebview());
                root.addView(backButton, new LinearLayout.LayoutParams(
                        LinearLayout.LayoutParams.WRAP_CONTENT, LinearLayout.LayoutParams.WRAP_CONTENT));
            }

            setContentView(root);
        });
    }

    /** 当前包是否含 webview 能力（full 包才可切回；BuildConfig 按 flavor 注入） */
    private boolean hasWebviewClient() {
        for (String kind : BuildConfig.CLIENT_KINDS) {
            if ("webview".equals(kind)) return true;
        }
        return false;
    }

    /**
     * 清除 client 开关并重启 MainActivity（webview 宿主）。
     * 用反射探测 MainActivity：lynx-only 包无该类（编译期也不可引用，
     * 故 Intent 目标同样走反射），full 包存在且 Manifest 已注册为非 LAUNCHER。
     */
    private void switchBackToWebview() {
        Class<?> mainActivityClass;
        try {
            mainActivityClass = Class.forName("io.pictelio.app.MainActivity");
        } catch (ClassNotFoundException e) {
            Log.w(TAG, "当前包无 MainActivity（lynx-only），无法切回 WebView");
            return;
        }
        getSharedPreferences("CapacitorStorage", MODE_PRIVATE)
                .edit()
                .remove("pictelio_client_kind")
                .apply();
        android.content.Intent intent = new android.content.Intent(this, mainActivityClass);
        intent.addFlags(android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK | android.content.Intent.FLAG_ACTIVITY_NEW_TASK);
        startActivity(intent);
        finish();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (lynxView != null) {
            lynxView.onEnterForeground();
        }
    }

    @Override
    protected void onPause() {
        super.onPause();
        if (lynxView != null) {
            lynxView.onEnterBackground();
        }
    }

    @Override
    protected void onDestroy() {
        // 取消未触发的加载超时回调，避免 Activity 销毁后仍执行 setContentView
        cancelLoadTimeout();
        if (lynxView != null) {
            lynxView.destroy();
        }
        super.onDestroy();
    }
}
