package io.pictelio.app;

import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;
import android.view.Gravity;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.splashscreen.SplashScreen;

import com.lynx.react.bridge.JavaOnlyArray;
import com.lynx.tasm.LynxError;
import com.lynx.tasm.LynxView;
import com.lynx.tasm.LynxViewBuilder;
import com.lynx.tasm.LynxViewClient;

import java.lang.ref.WeakReference;
import java.util.concurrent.atomic.AtomicBoolean;

import io.pictelio.app.BuildConfig;

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
 * <p>返回键（ADR-0066）：系统返回（手势/按键）由 {@link OnBackPressedCallback} 拦截，
 * bundle 就绪后经 {@code sendGlobalEvent("pictelioBack")} 转发 JS 决策——有路由历史返回
 * 上一页、根路由提示 + 2s 双击退出（webview client 同语义）；bundle 未就绪时 JS 侧无
 * 监听者，原生兜底 {@link #finish()}。页面内「‹ 返回」按钮由 app-lynx 前端路由处理，
 * 与系统返回桥互不影响。
 */
public class LynxActivity extends AppCompatActivity {

    private static final String TAG = "LynxActivity";

    private LynxView lynxView;
    private final AtomicBoolean bundleLoaded = new AtomicBoolean(false);

    /** 当前 Activity 弱引用（PictelioAppModule.exitApp 使用，ADR-0066；onDestroy 清理） */
    private static WeakReference<LynxActivity> sInstance;

    // ADR-0131：LynxView 内容区尺寸（px；首次布局后更新；-1 = 未布局）。
    // SystemInfo 是全屏物理尺寸，内容区撇除系统导航条 inset（FAB 底部被裁根因），
    // 故以实际内容区为准，经 PictelioAppModule.getViewportSize 回传 JS 订正底部几何。
    private static volatile int sContentW = -1;
    private static volatile int sContentH = -1;

    /** 内容区尺寸 [w, h]（px）；未布局返回 null。 */
    static int[] contentSize() {
        return (sContentW > 0 && sContentH > 0) ? new int[] { sContentW, sContentH } : null;
    }

    /** exitApp 目标：当前 LynxActivity（可能为 null） */
    static LynxActivity current() {
        return sInstance != null ? sInstance.get() : null;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // SplashScreen.installSplashScreen 必须在 super.onCreate 之前（AndroidX 要求）
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
        splashScreen.setKeepOnScreenCondition(() -> !bundleLoaded.get());
        super.onCreate(savedInstanceState);
        sInstance = new WeakReference<>(this);

        // LynxEnv 兜底初始化（进程复用场景：Application.onCreate 未走 initLynx → LynxEnv
        // 未初始化会报 error 102）。LynxEnv.init 幂等（hasInit），与 PictelioApp 共用
        // LynxRuntimeInitializer 单点（issue #122），重复调用安全。
        try {
            LynxRuntimeInitializer.ensureInitialized(getApplication());
        } catch (Throwable t) {
            String safe = sanitizeError(String.valueOf(t.getMessage()));
            Log.w(TAG, "LynxEnv 兜底初始化失败: " + safe);
            bundleLoaded.set(true); // 退出 Splash，展示错误兜底
            showErrorFallback("Lynx 环境初始化失败：" + safe);
            return;
        }

        LynxViewBuilder builder = new LynxViewBuilder();
        // XElement behaviors（#51 真机必需）：<input>/<textarea> 等扩展元件
        builder.addBehaviors(new com.lynx.xelement.XElementBehaviors().create());
        builder.setTemplateProvider(new PictelioTemplateProvider(this));
        // per-view 注册（与 PictelioApp 全局注册并存；LynxEnv 全局优先）
        builder.registerModule("PictelioSecureStorage", PictelioSecureStorageModule.class);
        builder.registerModule("PictelioApp", PictelioAppModule.class);
        builder.registerModule("PictelioAuth", PictelioAuthModule.class);
        builder.registerModule("PictelioApi", PictelioApiModule.class);
        builder.registerModule("PictelioPrefs", PictelioPrefsModule.class);
        lynxView = builder.build(this);

        // Splash 退出时机：bundle 渲染成功/失败（替代 webview 分支 AuthPlugin.hideSplash 桥）
        lynxView.addLynxViewClient(new LynxViewClient() {
            @Override
            public void onLoadSuccess() {
                bundleLoaded.set(true);
                cancelLoadTimeout();
                // bench 导航钩子（wayfinder #306，ADR-0136）：adb `am start --es benchNav <scenario>`
                // 直达目标页。真机 input tap 对放射 FAB 环项 hit-test 失效（事件送达但不导航，
                // Oppo R11s 实测），经 GlobalEventEmitter 深链绕过；生产无此 extra，零影响。
                // BuildConfig.DEBUG 包裹：release（minify+R8）下该分支为恒 false 死代码被移除，
                // 生产包不含钩子（ADR-0136 决策 1）。
                if (BuildConfig.DEBUG) {
                    String benchNav = getIntent().getStringExtra("benchNav");
                    if (benchNav != null && !benchNav.isEmpty()) {
                        // 事件名编码路由（lynx 4.0.1 无 JavaOnlyString，故不用载荷；空数组）。
                        // novel-follow 为两组事件：先路由到 /novels，页面挂载后再切「关注」子 tab。
                        final String[] events = switch (benchNav) {
                            case "carousel" -> new String[]{"pictelioBenchNavCarousel"};
                            case "illust" -> new String[]{"pictelioBenchNavIllust"};
                            case "novel" -> new String[]{"pictelioBenchNavNovel"};
                            case "following" -> new String[]{"pictelioBenchNavFollowing"};
                            case "illust-follow" -> new String[]{"pictelioBenchNavIllust", "pictelioBenchNavIllustFollow"};
                            case "novel-follow" -> new String[]{"pictelioBenchNavNovel", "pictelioBenchNavNovelFollow"};
                            default -> new String[0];
                        };
                        // 四次广播（1.5/3/4.5/6s）：页面级监听（如 NovelList 子 tab）可能晚于路由监听，
                        // 扩大窗口防「App 挂载/页面挂载」竞态；重复到达幂等或无害
                        for (long delay : new long[]{1500, 3000, 4500, 6000}) {
                            for (String event : events) {
                                new android.os.Handler(android.os.Looper.getMainLooper()).postDelayed(() -> {
                                    if (!isFinishing() && !event.isEmpty())
                                        lynxView.sendGlobalEvent(event, new JavaOnlyArray());
                                }, delay);
                            }
                        }
                    }
                }
            }

            @Override
            public void onLoadFailed(String errorMsg) {
                String safe = sanitizeError(errorMsg);
                Log.w(TAG, "bundle 加载失败: " + safe);
                bundleLoaded.set(true); // 失败也退出 Splash，由页面展示错误态
                cancelLoadTimeout();
                showErrorFallback("Lynx bundle 加载失败：" + safe);
            }

            // ── 渲染期错误兜底（ADR-0064，issue #132/#135）──
            // bundle 渲染阶段（非加载阶段）的错误走这里，而非 onLoadFailed。
            // 实测根因（error 990200 InstantiationException：R8 移除 $$PropsSetter
            // 无参构造器）即在此路径——若只挂钩 onLoadFailed 则白屏无出口。
            // 双回调都挂（SDK 分类入口 + 统一入口），showErrorFallback 内部原子防重。
            @Override
            public void onReceivedNativeError(LynxError error) {
                handleRenderError(error);
            }

            @Override
            public void onReceivedError(LynxError error) {
                handleRenderError(error);
            }
        });

        setContentView(lynxView);
        // ADR-0131：内容区尺寸契约——记录 LynxView 实际内容区（撇除系统导航条等 inset），
        // 供 PictelioAppModule.getViewportSize 回传 JS 订正底部几何（放射 FAB 定位）。
        // 首次布局即触发，早于 bundle 渲染，getViewportSize 几乎必然命中有效值。
        // 生命周期：lambda 仅写静态字段、不捕获 this，随 lynxView destroy() 释放，无泄漏。
        lynxView.addOnLayoutChangeListener((v, left, top, right, bottom, ol, ot, or, ob) -> {
            if (right - left > 0 && bottom - top > 0) {
                sContentW = right - left;
                sContentH = bottom - top;
            }
        });
        // ADR-0066：系统返回桥——拦截系统返回（手势/按键），bundle 就绪后仅转发 JS 决策
        // （不自行退出）；bundle 未就绪时 JS 侧无监听者，原生兜底退出，避免卡死。
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                // 渲染/加载错误兜底页（showErrorFallback）没有 JS 消费方：直接退出，
                // 避免返回键被吞导致用户卡死在错误页（lynx-only 包无「返回 WebView」按钮）。
                if (errorShown.get()) {
                    finish();
                    return;
                }
                if (!bundleLoaded.get()) {
                    finish();
                    return;
                }
                lynxView.sendGlobalEvent("pictelioBack", new JavaOnlyArray());
            }
        });
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

    /**
     * 渲染期错误处理（ADR-0064）：仅致命渲染中断类错误弹兜底页，其余仅打日志。
     * 致命信号：errorCode 9902/990200（Lynx 渲染系统错误分类码/完整码，SDK 版本
     * 粒度不一故双匹配）或消息含 InstantiationException（注解生成类反射失败，
     * issue #132 白屏根因），或 isFatal。
     * 避免对可恢复的轻量错误（如单个组件 props 异常）误伤整页。
     */
    private void handleRenderError(LynxError error) {
        int code = error != null ? error.getErrorCode() : -1;
        String msg = error != null ? error.getMsg() : null;
        boolean fatal = error != null && error.isFatal();
        boolean renderBroken =
                code == 9902 || code == 990200
                        || (msg != null && msg.contains("InstantiationException"));
        if (renderBroken || fatal) {
            Log.w(TAG, "Lynx 渲染致命错误（code=" + code + "）→ 展示错误兜底");
            bundleLoaded.set(true); // 退出 Splash（若尚未退出）
            cancelLoadTimeout();
            showErrorFallback("Lynx 渲染失败：" + sanitizeError(msg));
        } else {
            Log.w(TAG, "Lynx 渲染错误（code=" + code + "）已忽略（非致命）：" + sanitizeError(msg));
        }
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
        sInstance = null; // ADR-0066：清理 exitApp 目标引用
        // ADR-0131：复位内容区尺寸（静态字段跨实例复用）——销毁后回到「未布局」哨兵，
        // 保证新实例首次查询（若先于布局）命中「cb(-1,-1) → JS 回退 SystemInfo」契约语义。
        sContentW = -1;
        sContentH = -1;
        if (lynxView != null) {
            lynxView.destroy();
        }
        super.onDestroy();
    }
}
