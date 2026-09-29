package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/**
 * 共享设置 KV 桥（ADR-0103）—— 跨 client 设置契约的物理落点。
 *
 * <p>读写 SharedPreferences 文件 {@code "CapacitorStorage"}（@capacitor/preferences 默认
 * group）——webview client 经 {@code @capacitor/preferences} 读写同一文件，两 client
 * 设置互通（契约键：{@code show_r18_${uid}} / {@code show_r18g_${uid}}）。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioPrefs}。回调契约（{@link Callback#invoke}，
 * lynx Callback 对 null 参数崩——真机实测，见 PictelioSecureStorageModule）：
 * <ul>
 *   <li>{@code prefsGet(key, cb)}：成功 {@code cb(value)}——键不存在返回空串 {@code ""}
 *       （JS 侧映射为 null）；失败 {@code cb(errMsg)}</li>
 *   <li>{@code prefsSet(key, value, cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 *   <li>{@code prefsRemove(key, cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 * </ul>
 *
 * <p>通用 KV（非 R18 专用）：未来其他设置跨端同步（布局、画质等）直接复用。
 * 键/值均来自自有 JS 常量，无用户输入注入面。
 */
public class PictelioPrefsModule extends LynxModule {

    private static final String TAG = "PictelioPrefsModule";

    /** SharedPreferences 文件（@capacitor/preferences 默认 group，勿改） */
    public static final String PREFS_FILE = "CapacitorStorage";

    public PictelioPrefsModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    @LynxMethod
    public void prefsGet(String key, Callback callback) {
        try {
            // 成功：单参传值；键不存在返回 ""（不传 null——CallbackImpl 对 null 参数崩）
            callback.invoke(get(appContext(), key));
        } catch (Exception e) {
            Log.w(TAG, "prefsGet(" + key + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void prefsSet(String key, String value, Callback callback) {
        try {
            set(appContext(), key, value);
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "prefsSet(" + key + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void prefsRemove(String key, Callback callback) {
        try {
            remove(appContext(), key);
            callback.invoke();
        } catch (Exception e) {
            Log.w(TAG, "prefsRemove(" + key + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    // ── 纯静态核心（JVM 可测：Robolectric 注入 Application Context） ──

    /** 读取指定键；键不存在返回 ""（与 JS 契约一致，永不为 null） */
    static String get(Context ctx, String key) {
        return ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE).getString(key, "");
    }

    static void set(Context ctx, String key, String value) {
        ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
                .edit()
                .putString(key, value)
                .apply();
    }

    static void remove(Context ctx, String key) {
        ctx.getSharedPreferences(PREFS_FILE, Context.MODE_PRIVATE)
                .edit()
                .remove(key)
                .apply();
    }
}
