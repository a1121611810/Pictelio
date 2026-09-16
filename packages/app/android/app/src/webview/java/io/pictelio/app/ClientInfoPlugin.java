package io.pictelio.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;
import android.util.Log;

import java.util.Locale;

import io.pictelio.app.engine.EnginePrefs;

/**
 * Client 能力信息插件（ADR-0062）——webview 前端读取当前包支持的 client 引擎列表，
 * 并提供 Activity 级重启（引擎切换，issue #120）。
 *
 * <p>webview 前端（pictelio-app）据此决定是否渲染"切换渲染引擎"入口：
 * 仅当列表同时含 webview 与 lynx（full 包）时切换有意义，独立包隐藏。
 *
 * <p>调用方式（JS 侧）：
 *   ClientInfo.getClientKinds() → { kinds: ["webview"] | ["webview","lynx"] | ["lynx"] }
 *   ClientInfo.restart() → Promise<void>（Activity 级切换，进程保留）
 */
@CapacitorPlugin(name = "ClientInfo")
public class ClientInfoPlugin extends Plugin {

    private static final String TAG = "ClientInfoPlugin";

    @PluginMethod
    public void getClientKinds(PluginCall call) {
        JSArray kinds = new JSArray();
        for (String kind : BuildConfig.CLIENT_KINDS) {
            kinds.put(kind);
        }
        JSObject result = new JSObject();
        result.put("kinds", kinds);
        call.resolve(result);
    }

    /**
     * 当前应用生效 locale（B10 i18n）：Android 13+ 的 per-app language 由系统管理，
     * configuration 里的首个 locale 即应用生效语言。WebView 侧 navigator.language 不可信
     * （Chromium 会异步重置应用 locale，Google #37113860），跟随系统态经此桥校正。
     */
    @PluginMethod
    public void getLocale(PluginCall call) {
        Locale locale = getContext().getResources().getConfiguration().getLocales().get(0);
        JSObject result = new JSObject();
        result.put("languageTag", locale.toLanguageTag());
        call.resolve(result);
    }

    /**
     * Activity 级重启（引擎切换后由新 Activity 的入口路由按开关分发）。
     * 不 killProcess：进程保留，token 内存态 / OkHttp 连接池 / 图片磁盘缓存延续；
     * 旧 Activity（CLEAR_TASK）销毁后其 WebView/LynxView destroy() 释放资源。
     * 与 lynx 侧 PictelioAppModule.restart 语义对齐（双向行为一致，issue #124）。
     * 降级分支：若实测 LynxView.destroy() 释放不净，可恢复 300ms 延迟 killProcess。
     */
    @PluginMethod
    public void restart(PluginCall call) {
        try {
            // S12（ADR-0164 决策 9）：显式切换前清 Lynx 失败记忆——JS 侧 switchClient
            // 已写 pictelio_client_kind（显式选择语义），残留记忆会让新引擎下次启动
            // 又被 S4 弹回。失败不阻断重启（记忆可由升级/显式选择自愈）。
            try {
                EnginePrefs.clearLynxFailure(getContext().getApplicationContext());
            } catch (Exception clearEx) {
                Log.w(TAG, "clearLynxFailure 失败（显式选择可能被失败记忆覆盖）", clearEx);
            }
            Intent intent = getActivity().getPackageManager()
                    .getLaunchIntentForPackage(getContext().getPackageName());
            if (intent == null) {
                call.reject("无法获取 LAUNCHER intent");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            getContext().startActivity(intent);
            call.resolve();
        } catch (Exception e) {
            Log.w(TAG, "restart 失败", e);
            call.reject(e.getMessage(), e);
        }
    }
}
