package io.pictelio.app;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Client 能力信息插件（ADR-0062）——webview 前端读取当前包支持的 client 引擎列表。
 *
 * <p>webview 前端（pictelio-app）据此决定是否渲染"切换渲染引擎"入口：
 * 仅当列表同时含 webview 与 lynx（full 包）时切换有意义，独立包隐藏。
 *
 * <p>调用方式（JS 侧）：
 *   ClientInfo.getClientKinds() → { kinds: ["webview"] | ["webview","lynx"] | ["lynx"] }
 */
@CapacitorPlugin(name = "ClientInfo")
public class ClientInfoPlugin extends Plugin {

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
}
