package io.pictelio.app;

import android.app.Application;
import android.content.SharedPreferences;
import android.util.Log;
import android.webkit.WebView;

import com.lynx.service.http.LynxHttpService;
import com.lynx.service.log.LynxLogService;
import com.lynx.tasm.LynxEnv;
import com.lynx.tasm.service.LynxServiceCenter;

/**
 * Pictelio Application 入口。
 *
 * <p>按 client 开关（SharedPreferences("CapacitorStorage") 的
 * {@code pictelio_client_kind}）条件初始化（#51）：
 * <ul>
 *   <li>lynx → 初始化 Lynx runtime（LynxEnv + 全局 Native Modules），跳过 WebView 预热；
 *   <li>webview（默认）→ 保持现状：预热 WebView 服务进程。
 * </ul>
 *
 * <p>WebView 预热与 SplashScreen 互补：SplashScreen 掩盖 Activity 初始化到首帧
 * 绘制之间的视觉空白；预热缩短 WebView 服务进程初始化耗时。异常安全：预热失败
 * 静默吞异常，app 正常启动，正式 WebView 回退冷初始化路径。
 */
public class PictelioApp extends Application {

    private static final String TAG = "PictelioApp";

    @Override
    public void onCreate() {
        super.onCreate();
        String clientKind = getSharedPreferences(PictelioAppModule.CLIENT_PREFS, MODE_PRIVATE)
                .getString(PictelioAppModule.CLIENT_KEY, "webview");
        if ("lynx".equals(clientKind)) {
            initLynx();
        } else {
            warmUpWebView();
        }
    }

    /** Lynx runtime 初始化（须早于任何 LynxView 创建）+ 全局 Native Modules 注册（#51） */
    private void initLynx() {
        try {
            // Lynx Service 主动注入（官方集成要求，须在 LynxView 创建前）：
            // - LynxHttpService：lynx.fetch 依赖（未注册则原生 fetch 不可用 → 登录/API 断）
            // - LynxLogService：日志服务
            // - PictelioImageService：自研图片服务（#59，Fresco 不传 Referer → i.pximg.net 403）
            LynxServiceCenter.inst().registerService(LynxHttpService.INSTANCE);
            LynxServiceCenter.inst().registerService(LynxLogService.INSTANCE);
            LynxServiceCenter.inst().registerService(PictelioImageService.getInstance());
            // 参数与官方 demo 一致：Application、null（native loader）、null（provider）、null（behaviors）
            LynxEnv.inst().init(this, null, null, null);
            // 全局注册（LynxViewBuilder per-view 注册亦可；全局保证任何 LynxView 可用）
            LynxEnv.inst().registerModule("PictelioSecureStorage", PictelioSecureStorageModule.class);
            LynxEnv.inst().registerModule("PictelioApp", PictelioAppModule.class);
            LynxEnv.inst().registerModule("PictelioAuth", PictelioAuthModule.class);
            LynxEnv.inst().registerModule("PictelioApi", PictelioApiModule.class);
            LynxEnv.inst().enableLynxDebug(BuildConfig.DEBUG);
        } catch (Throwable t) {
            Log.w(TAG, "Lynx 初始化失败（lynx client 将不可用）", t);
        }
    }

    private void warmUpWebView() {
        try {
            WebView webView = new WebView(this);
            webView.destroy();
        } catch (Exception ignored) {
            // 预热失败不阻塞 app 启动
            // 涵盖：WebView 服务崩溃、系统 WebView 未安装、ROM 定制导致
            // 的构造异常等。正式 WebView 创建时会回退到冷初始化路径。
        }
    }
}
