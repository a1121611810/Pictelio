package io.pictelio.app;

import android.app.Application;
import android.util.Log;

import com.lynx.service.http.LynxHttpService;
import com.lynx.service.log.LynxLogService;
import com.lynx.tasm.LynxEnv;
import com.lynx.tasm.service.LynxServiceCenter;

/**
 * Lynx runtime 初始化单点（issue #120/#122）。
 *
 * <p>PictelioApp（进程冷启动）与 LynxActivity（进程复用兜底）共用。
 * LynxEnv.init 幂等（内部 hasInit AtomicBoolean，二次调用直接 return），
 * 重复调用安全；进程复用场景（Application.onCreate 不重跑）由 LynxActivity
 * 在此自兜底初始化，消除"切换后 LynxEnv 未初始化 → 102 错误页"。
 *
 * <p>ADR-0153：幂等标志改为「成功才置位、失败不 latch」（{@link InitGate}），
 * 并新增 {@link #isAvailable(Application)} 作为引擎可用性探针。
 */
public final class LynxRuntimeInitializer {

    private static final String TAG = "LynxRuntimeInitializer";

    private LynxRuntimeInitializer() {}

    /**
     * 幂等状态机（ADR-0153）：成功才置位、失败不 latch。
     *
     * <p>旧实现以 AtomicBoolean 在初始化动作**之前** compareAndSet：init() 抛
     * UnsatisfiedLinkError 后标志仍为 true，同进程内重试永久短路。抽成可测小状态机——
     * 动作正常返回才 done=true；动作抛异常则保持未初始化，允许重试。
     */
    static final class InitGate {
        private boolean done;

        synchronized void run(Runnable action) {
            if (done) return;
            action.run(); // 抛异常 → done 保持 false（可重试）
            done = true;
        }

        synchronized boolean isDone() {
            return done;
        }
    }

    /** 进程级幂等门（registerService/registerModule 无官方幂等保证；失败后允许重试） */
    private static final InitGate GATE = new InitGate();

    /**
     * 确保 Lynx runtime 就绪（幂等）。须在任何 LynxView 创建前调用。
     *
     * @param app Application 上下文（LynxEnv.init 要求）
     * @throws Throwable 初始化失败（调用方自行决定兜底策略）
     */
    public static void ensureInitialized(Application app) {
        GATE.run(() -> initInternal(app));
    }

    private static void initInternal(Application app) {
        // Lynx Service 主动注入（官方集成要求，须在 LynxView 创建前）：
        // - LynxHttpService：lynx.fetch 依赖（未注册则原生 fetch 不可用 → 登录/API 断）
        // - LynxLogService：日志服务
        // - PictelioImageService：自研图片服务（#59，Fresco 不传 Referer → i.pximg.net 403）
        LynxServiceCenter.inst().registerService(LynxHttpService.INSTANCE);
        LynxServiceCenter.inst().registerService(LynxLogService.INSTANCE);
        LynxServiceCenter.inst().registerService(PictelioImageService.getInstance());
        // 参数与官方 demo 一致：Application、null（native loader）、null（provider）、null（behaviors）
        LynxEnv.inst().init(app, null, null, null);
        // 全局注册（LynxViewBuilder per-view 注册亦可；全局保证任何 LynxView 可用）
        LynxEnv.inst().registerModule("PictelioSecureStorage", PictelioSecureStorageModule.class);
        LynxEnv.inst().registerModule("PictelioApp", PictelioAppModule.class);
        LynxEnv.inst().registerModule("PictelioAuth", PictelioAuthModule.class);
        LynxEnv.inst().registerModule("PictelioApi", PictelioApiModule.class);
        LynxEnv.inst().registerModule("PictelioPrefs", PictelioPrefsModule.class);
        LynxEnv.inst().registerModule("PictelioGallery", PictelioGalleryModule.class);
        LynxEnv.inst().registerModule("PictelioDownloader", PictelioDownloaderModule.class);
        LynxEnv.inst().registerModule("PictelioShare", PictelioShareModule.class);
        LynxEnv.inst().enableLynxDebug(BuildConfig.DEBUG);
    }

    /**
     * Lynx 引擎可用性判定（ADR-0153）：初始化不抛异常 ∧ native 库真正加载。
     *
     * <p>**不能只用 {@link LynxEnv#hasInited()}**：init() 在 liblynx / liblynxtrace 加载失败时
     * 吞掉 UnsatisfiedLinkError 并正常返回，此时 hasInited()==true 而 native 未加载，且后续
     * init() 短路、进程内不可恢复。只有 {@link LynxEnv#isNativeLibraryLoaded()} 是真信号。
     * 不调用 getLynxVersion()（SDK 返回硬编码 "0.0.1"）。
     *
     * @return true = 可承载 Lynx 客户端；false = 初始化失败或 native 未加载
     */
    public static boolean isAvailable(Application app) {
        try {
            ensureInitialized(app);
        } catch (Throwable t) {
            Log.w(TAG, "Lynx 初始化失败，判定引擎不可用", t);
            return false;
        }
        LynxEnv env = LynxEnv.inst();
        boolean available = env.hasInited() && env.isNativeLibraryLoaded();
        if (!available) {
            Log.w(TAG, "Lynx 初始化未抛异常但 native 未加载，判定引擎不可用");
        }
        return available;
    }
}
