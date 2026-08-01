package io.pictelio.app;

import android.content.Context;
import android.util.Log;

import com.lynx.jsbridge.LynxMethod;
import com.lynx.jsbridge.LynxModule;
import com.lynx.react.bridge.Callback;
import com.lynx.tasm.behavior.LynxContext;

/**
 * 登录存储 Native Module —— 对齐主项目 {@code @aparajita/capacitor-secure-storage}（ADR-0050），
 * 使 lynx client 与 webview client 登录态共享（同一 Keystore alias + SharedPreferences 密文）。
 *
 * <p>JS 侧访问：{@code NativeModules.PictelioSecureStorage}（Lynx 全局内置对象）。
 * 回调契约（{@link Callback#invoke} 多参，第二参区分错误）：
 * <ul>
 *   <li>{@code getItem(key, cb)}：成功 {@code cb(value, null)}；失败 {@code cb(null, errMsg)}</li>
 *   <li>{@code setItem(key, data, cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 *   <li>{@code removeItem(key, cb)}：成功 {@code cb(null)}；失败 {@code cb(errMsg)}</li>
 * </ul>
 */
public class PictelioSecureStorageModule extends LynxModule {

    private static final String TAG = "PictelioSecureStorage";

    public PictelioSecureStorageModule(Context context) {
        super(context);
    }

    private Context appContext() {
        return ((LynxContext) mContext).getContext();
    }

    @LynxMethod
    public void getItem(String key, Callback callback) {
        try {
            String value = new SecureStorageCompat(appContext()).getItem(key);
            callback.invoke(value, null);
        } catch (Exception e) {
            Log.w(TAG, "getItem(" + key + ") 失败", e);
            callback.invoke(null, String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void setItem(String key, String data, Callback callback) {
        try {
            new SecureStorageCompat(appContext()).setItem(key, data);
            callback.invoke(null);
        } catch (Exception e) {
            Log.w(TAG, "setItem(" + key + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }

    @LynxMethod
    public void removeItem(String key, Callback callback) {
        try {
            new SecureStorageCompat(appContext()).removeItem(key);
            callback.invoke(null);
        } catch (Exception e) {
            Log.w(TAG, "removeItem(" + key + ") 失败", e);
            callback.invoke(String.valueOf(e.getMessage()));
        }
    }
}
