package io.pictelio.app;

import android.app.Application;
import android.util.Log;

/**
 * Pictelio Application 入口（lynx flavor）。
 *
 * <p>Lynx runtime 初始化收敛至 {@link LynxRuntimeInitializer} 单点
 * （issue #122）：进程冷启动由本类触发；进程复用场景由 LynxActivity 兜底触发。
 * 单点内部 AtomicBoolean 自守护，重复调用安全。
 */
public class PictelioAppLynx extends Application {

    private static final String TAG = "PictelioAppLynx";

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            LynxRuntimeInitializer.ensureInitialized(this);
        } catch (Throwable t) {
            Log.w(TAG, "Lynx 初始化失败", t);
        }
    }
}
