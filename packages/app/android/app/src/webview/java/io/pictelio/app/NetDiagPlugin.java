package io.pictelio.app;

import android.content.Context;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

/**
 * 网络自检 Capacitor 插件（webview 壳）。
 *
 * <p>JS：{@code NetDiag.run({ userId })} -> {@code { device, probes }}。
 * 阻塞 IO 在后台线程执行（NetDiagProbe.run 内含网络请求）。
 * 判定/文案/报告在 @pictelio/net-diagnostics，本壳只做数据搬运。
 */
@CapacitorPlugin(name = "NetDiag")
public class NetDiagPlugin extends Plugin {

    @PluginMethod
    public void run(PluginCall call) {
        final String userId = call.getString("userId", "");
        final Context ctx = getContext().getApplicationContext();
        new Thread(() -> {
            try {
                JSONObject result = NetDiagProbe.run(ctx, userId);
                call.resolve(new JSObject(result.toString()));
            } catch (Exception e) {
                call.reject("NetDiag failed: " + e.getMessage());
            }
        }, "netdiag").start();
    }
}
