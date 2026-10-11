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
 *
 * <p>图片内存层的内存压力响应（#981）在本类 {@code onCreate} 注册一次，见
 * {@link #registerImageMemoryPressureResponse()}；只注册这一次，不随 Lynx runtime 的
 * 双入口初始化重复注册。
 */
public class PictelioAppLynx extends Application {

    private static final String TAG = "PictelioAppLynx";

    /**
     * 缓存维护的后台执行器（单线程 daemon）：磁盘扫描不得占主线程；
     * #981 的内存压力收缩<b>复用同一线程</b>（语义同类、避免多开一个常驻线程）。
     */
    static final ExecutorService TRIM_EXECUTOR = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "pictelio-cache-trim");
        t.setDaemon(true);
        return t;
    });

    @Override
    public void onCreate() {
        super.onCreate();
        // #981：内存压力回调注册<b>先于</b> Lynx 初始化，且不落在它的 try/catch 内——
        // Lynx 初始化失败被吞掉时回收响应仍须就位（详见 ImageMemoryPressureHandler 类注释）。
        registerImageMemoryPressureResponse();
        try {
            LynxRuntimeInitializer.ensureInitialized(this);
        } catch (Throwable t) {
            Log.w(TAG, "Lynx 初始化失败", t);
        }
        trimImageCacheAtStartup();
    }

    /**
     * 注册图片内存层的内存压力回调（#981）。
     *
     * <p><b>全仓唯一调用点</b>，且不在 {@code LynxRuntimeInitializer} 的初始化路径上——
     * 那条路径是双入口（Application 冷启动 / LynxActivity 进程复用兜底）且失败会重入，
     * 挂上去要么被跳过、要么重复。注册幂等由
     * {@link ImageMemoryPressureHandler#ensureRegistered} 自持的闸保证。
     */
    private void registerImageMemoryPressureResponse() {
        try {
            boolean registered = ImageMemoryPressureHandler.ensureRegistered(
                    this, PictelioImageService.getInstance()::memoryCacheForTrim, TRIM_EXECUTOR);
            if (!registered) {
                // 幂等跳过不是错误，但留痕以便确认「已注册过一次」而非「注册失败」
                Log.i(TAG, "图片内存压力回调此前已注册，本次幂等跳过");
            }
        } catch (Throwable t) {
            Log.w(TAG, "注册图片内存压力回调失败", t);
        }
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
