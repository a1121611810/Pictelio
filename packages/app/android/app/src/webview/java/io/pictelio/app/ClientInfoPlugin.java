package io.pictelio.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.content.Intent;
import android.util.Log;

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
     * Activity 级重启（引擎切换后由新 Activity 的入口路由按开关分发）。
     * 不 killProcess：进程保留，token 内存态 / OkHttp 连接池 / 图片磁盘缓存延续；
     * 旧 Activity（CLEAR_TASK）销毁后其 WebView/LynxView destroy() 释放资源。
     * 与 lynx 侧 PictelioAppModule.restart 语义对齐（双向行为一致，issue #124）。
     * 降级分支：若实测 LynxView.destroy() 释放不净，可恢复 300ms 延迟 killProcess。
     */
    @PluginMethod
    public void restart(PluginCall call) {
        try {
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
