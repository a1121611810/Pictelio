package io.pictelio.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.os.Process;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/**
 * client 切换重启 Native Module（#51）。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioApp}。回调契约（第二参区分错误）：
 * <ul>
 *   <li>{@code setClientKind(kind, cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 *   <li>{@code getClientKind(cb)}：成功 {@code cb(kind, null)}；失败 {@code cb(null, errMsg)}</li>
 *   <li>{@code restart(cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 * </ul>
 *
 * <p>{@code setClientKind} 落盘文件必须是 {@code "CapacitorStorage"} ——
 * 与 {@code @capacitor/preferences} 默认 group、MainActivity 分发读取的是同一文件，
 * 保证 webview/lynx 两侧读到同一开关。
 */
public class PictelioAppModule extends LynxModule {

    private static final String TAG = "PictelioAppModule";

    /** SharedPreferences 文件（@capacitor/preferences 默认 group，勿改） */
    public static final String CLIENT_PREFS = "CapacitorStorage";
    /** client 开关 key（app-lynx clientSwitchStore 同名） */
    public static final String CLIENT_KEY = "pictelio_client_kind";

    public PictelioAppModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    @LynxMethod
    public void setClientKind(String kind, Callback callback) {
        try {
            appContext()
                    .getSharedPreferences(CLIENT_PREFS, Context.MODE_PRIVATE)
                    .edit()
                    .putString(CLIENT_KEY, kind)
                    .apply();
            callback.invoke(null);
        } catch (Exception e) {
            Log.w(TAG, "setClientKind(" + kind + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void getClientKind(Callback callback) {
        try {
            String kind = appContext()
                    .getSharedPreferences(CLIENT_PREFS, Context.MODE_PRIVATE)
                    .getString(CLIENT_KEY, "webview");
            callback.invoke(kind, null);
        } catch (Exception e) {
            Log.w(TAG, "getClientKind 失败", e);
            callback.invoke(null, String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void restart(Callback callback) {
        try {
            Context ctx = appContext();
            Intent intent = new Intent(ctx, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            ctx.startActivity(intent);
            callback.invoke(null);
            // 延迟杀进程：等 MainActivity 启动完成后结束当前进程，
            // 保证全新进程重新走 client 分发（避免 Lynx runtime 静态状态残留）
            new Handler(Looper.getMainLooper()).postDelayed(() -> {
                Process.killProcess(Process.myPid());
            }, 300L);
        } catch (Exception e) {
            Log.w(TAG, "restart 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }
}
