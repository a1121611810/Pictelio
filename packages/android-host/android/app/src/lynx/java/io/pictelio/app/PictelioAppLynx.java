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
 * <p>图片磁盘缓存的冷启动维护在本类 {@code onCreate} 调度一次（跑在 {@link #TRIM_EXECUTOR}），
 * 见 {@link #trimImageCacheAtStartup()}：#985 的<b>存量清空</b>（只一次、不迁移）与
 * #978 的<b>容量回收</b>（每次冷启动、超限才淘汰）在同一后台任务内按序执行，
 * 二者共用同一条删除路径（{@link PixivImageLoader#clearDiskCache()}）。
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
     * 调度冷启动图片磁盘缓存维护（#985 存量清空 + #978 容量回收）。
     *
     * <p>跑在本类已存在的 {@link #TRIM_EXECUTOR}（#978 已复用过、#981 的内存压力收缩也复用它）
     * ——<b>不新开常驻线程</b>。维护是阻塞 IO 且与首屏无关，故整段在后台，冷启动耗时不受影响。
     *
     * <p>关闸/开闸与「缓存访问在维护期间排队」的纪律由被调方自持
     * （{@link PixivImageLoader#scheduleStartupCacheMaintenance}），本类只负责把执行器交出去。
     */
    private void trimImageCacheAtStartup() {
        new PixivImageLoader(this).scheduleStartupCacheMaintenance(TRIM_EXECUTOR);
    }
}
