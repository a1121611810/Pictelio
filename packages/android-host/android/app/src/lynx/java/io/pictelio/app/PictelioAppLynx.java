package io.pictelio.app;

import android.app.Application;
import android.util.Log;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Pictelio Application 入口（lynx flavor）。
 *
 * <p>Lynx runtime 初始化收敛至 {@link LynxRuntimeInitializer} 单点
 * （issue #122）：进程冷启动由本类触发；进程复用场景由 LynxActivity 兜底触发。
 * 单点内部 AtomicBoolean 自守护，重复调用安全。
 *
 * <p>图片磁盘缓存的启动清理（#978）在本类 {@code onCreate} 触发一次，见
 * {@link #trimImageCacheAtStartup()}。
 */
public class PictelioAppLynx extends Application {

    private static final String TAG = "PictelioAppLynx";

    /** 启动清理的后台执行器（单线程 daemon）：磁盘扫描不得占主线程 */
    private static final ExecutorService TRIM_EXECUTOR = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "pictelio-cache-trim");
        t.setDaemon(true);
        return t;
    });

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            LynxRuntimeInitializer.ensureInitialized(this);
        } catch (Throwable t) {
            Log.w(TAG, "Lynx 初始化失败", t);
        }
        trimImageCacheAtStartup();
    }

    /**
     * 启动清理图片磁盘缓存（#978）：把淘汰触发点从「仅写入后」扩为「启动时 + 写入后」，
     * 使长期不写入的超限存量也能被回收。
     *
     * <p>跑在后台单线程：{@code enforceCacheLimit} 要 listFiles + 逐条 stat + 排序，
     * 目录条目多时在主线程会拖慢冷启动。失败仅记 Log.w（不阻断启动，trimAtStartup 内部兜底）。
     */
    private void trimImageCacheAtStartup() {
        TRIM_EXECUTOR.execute(() -> {
            try {
                new PixivImageLoader(this).trimAtStartup();
            } catch (Throwable t) {
                Log.w(TAG, "启动清理图片缓存失败（不阻断启动）", t);
            }
        });
    }
}
