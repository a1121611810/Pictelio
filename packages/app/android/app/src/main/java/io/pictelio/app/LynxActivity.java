package io.pictelio.app;

import android.os.Bundle;
import android.util.Log;

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
        lynxView = builder.build(this);

        // Splash 退出时机：bundle 渲染成功/失败（替代 webview 分支 AuthPlugin.hideSplash 桥）
        lynxView.addLynxViewClient(new LynxViewClient() {
            @Override
            public void onLoadSuccess() {
                bundleLoaded.set(true);
            }

            @Override
            public void onLoadFailed(String errorMsg) {
                Log.w(TAG, "bundle 加载失败: " + errorMsg);
                bundleLoaded.set(true); // 失败也退出 Splash，由页面展示错误态
            }
        });

        setContentView(lynxView);
        // renderTemplateUrl(url, initData)：initData 由 app-lynx 启动自恢复，无需注入
        lynxView.renderTemplateUrl("main.lynx.bundle", "");
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
        if (lynxView != null) {
            lynxView.destroy();
        }
        super.onDestroy();
    }
}
