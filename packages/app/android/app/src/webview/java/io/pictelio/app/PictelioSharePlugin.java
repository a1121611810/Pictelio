package io.pictelio.app;

import android.content.Intent;
import android.util.Log;

import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;
import java.util.List;

/**
 * 系统分享插件（spec docs/specs/download-manager.md §4.1，webview 引擎薄壳）。
 * Intent 构造全在 {@link ShareHelper}（main sourceSet 深模块，与 lynx 共享）；本壳只做参数校验与启动。
 * 调用：{@code share({ uris: string[], mime?: string })}。
 */
@CapacitorPlugin(name = "PictelioShare")
public class PictelioSharePlugin extends Plugin {

    private static final String TAG = "PictelioSharePlugin";

    @PluginMethod
    public void share(PluginCall call) {
        JSArray arr = call.getArray("uris");
        if (arr == null) {
            call.reject("uris 不能为空");
            return;
        }
        try {
            List<String> uris = new ArrayList<>();
            for (Object o : arr.toList()) {
                uris.add(o == null ? null : String.valueOf(o));
            }
            Intent intent = ShareHelper.buildIntent(getContext(), uris, call.getString("mime"));
            Intent chooser = Intent.createChooser(intent, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(chooser);
            call.resolve();
        } catch (Throwable e) {
            Log.w(TAG, "share 失败", e);
            call.reject(e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        }
    }
}
