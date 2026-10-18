package io.pictelio.app;

import android.app.Application;

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
 * <p>ADR-0153：幂等标志改为「成功才置位、失败不 latch」（{@link InitGate}）。
 */
public final class LynxRuntimeInitializer {

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
        LynxEnv.inst().registerModule("NetDiag", NetDiagModule.class);
        LynxEnv.inst().registerModule("PictelioWebDav", PictelioWebDavModule.class); // WebDAV 备份薄桥（spec webdav-backup T3）
        LynxEnv.inst().registerModule("PictelioClipboard", PictelioClipboardModule.class); // 剪贴板薄桥（spec app-lynx-novel-text-selection §ID 6）
        // 送达通道 · 触达探测薄桥（spec notification-delivery-probe / ADR-0220 决策 4）
        LynxEnv.inst().registerModule("PictelioNotification", PictelioNotificationModule.class);
        // 图片缓存设置薄桥（#984）：占用/命中率展示 + 一键清理的 JS 入口
        LynxEnv.inst().registerModule("PictelioImageCache", PictelioImageCacheModule.class);
        LynxEnv.inst().enableLynxDebug(BuildConfig.DEBUG);
    }
}
