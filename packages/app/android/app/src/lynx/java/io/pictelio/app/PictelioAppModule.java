package io.pictelio.app;

import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
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
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "setClientKind(" + kind + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void getClientKind(Callback callback) {
        try {
            String stored = appContext()
                    .getSharedPreferences(CLIENT_PREFS, Context.MODE_PRIVATE)
                    .getString(CLIENT_KEY, "webview");
            // ADR-0062：归一化——存储值不在当前包支持列表时回退到包默认引擎
            // （如 full 包切到 lynx 后换装 lynx-only 包，残留 "webview" → 归一为 "lynx"）
            String kind = containsKind(stored) ? stored : BuildConfig.CLIENT_KINDS[0];
            callback.invoke(kind);
        } catch (Exception e) {
            Log.w(TAG, "getClientKind 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    /**
     * 返回当前包支持的 client 引擎列表（ADR-0062）。
     * full → ["webview","lynx"]；webview → ["webview"]；lynx → ["lynx"]。
     * JS 侧据此决定是否渲染引擎切换入口。
     */
    @LynxMethod
    public void getClientKinds(Callback callback) {
        try {
            callback.invoke(BuildConfig.CLIENT_KINDS);
        } catch (Exception e) {
            Log.w(TAG, "getClientKinds 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    private static boolean containsKind(String kind) {
        for (String k : BuildConfig.CLIENT_KINDS) {
            if (k.equals(kind)) return true;
        }
        return false;
    }

    @LynxMethod
    public void restart(Callback callback) {
        try {
            Context ctx = appContext();
            // 通过 PackageManager 获取 LAUNCHER intent，避免硬编码 Activity 类
            // （lynx flavor 无 MainActivity，full flavor LAUNCHER 是 MainActivity）
            Intent intent = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            if (intent == null) {
                callback.invoke("无法获取 LAUNCHER intent");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TASK);
            ctx.startActivity(intent);
            callback.invoke();
            // 不 killProcess（issue #120/#124）：Activity 级切换，进程保留——
            // token 内存态 / OkHttp 连接池 / 图片磁盘缓存延续；旧 Activity（LynxActivity）
            // 被 CLEAR_TASK 销毁后 LynxView.destroy() 释放资源。与 webview 侧
            // ClientInfoPlugin.restart 语义对齐（双向行为一致）。
            // 降级分支：若实测 LynxView.destroy() 释放不净，可恢复 300ms 延迟
            // killProcess（lynx 官方模式）——仅开关一个 flag，架构不变。
        } catch (Exception e) {
            Log.w(TAG, "restart 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }
}
