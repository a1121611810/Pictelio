package io.pictelio.app;

import android.content.Context;
import android.content.Intent;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONArray;

import java.util.ArrayList;
import java.util.List;

/**
 * 系统分享 Native Module（spec docs/specs/download-manager.md §4.1，lynx 引擎薄壳）。
 * JS 侧：{@code NativeModules.PictelioShare.share(urisJson, mime, cb)}；Intent 构造在 {@link ShareHelper}。
 */
public class PictelioShareModule extends LynxModule {

    private static final String TAG = "PictelioShareModule";

    public PictelioShareModule(Context context) {
        super(context);
    }

    @LynxMethod
    public void share(String urisJson, String mime, Callback callback) {
        final Context app = ((LynxContext) mContext).getContext();
        try {
            JSONArray arr = new JSONArray(urisJson == null ? "[]" : urisJson);
            List<String> uris = new ArrayList<>();
            for (int i = 0; i < arr.length(); i++) {
                uris.add(arr.optString(i, null));
            }
            Intent intent = ShareHelper.buildIntent(app, uris, mime);
            Intent chooser = Intent.createChooser(intent, null);
            chooser.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            app.startActivity(chooser);
            callback.invoke("1", "");
        } catch (Throwable e) {
            Log.w(TAG, "share 失败", e);
            callback.invoke("", e.getMessage() != null ? e.getMessage() : e.getClass().getSimpleName());
        }
    }
}
