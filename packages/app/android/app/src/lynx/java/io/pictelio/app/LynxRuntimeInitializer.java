package io.pictelio.app;

import android.app.Application;

import com.lynx.service.http.LynxHttpService;
import com.lynx.service.log.LynxLogService;
import com.lynx.tasm.LynxEnv;
import com.lynx.tasm.service.LynxServiceCenter;

import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Lynx runtime 初始化单点（issue #120/#122）。
 *
 * <p>PictelioApp（进程冷启动）与 LynxActivity（进程复用兜底）共用。
 * LynxEnv.init 幂等（内部 hasInit AtomicBoolean，二次调用直接 return），
 * 重复调用安全；进程复用场景（Application.onCreate 不重跑）由 LynxActivity
 * 在此自兜底初始化，消除"切换后 LynxEnv 未初始化 → 102 错误页"。
 */
public final class LynxRuntimeInitializer {

    private LynxRuntimeInitializer() {}

    /** 初始化自守护：registerService/registerModule 无官方幂等保证，进程复用场景重复调用必须跳过 */
    private static final AtomicBoolean initialized = new AtomicBoolean(false);

    /**
     * 确保 Lynx runtime 就绪（幂等）。须在任何 LynxView 创建前调用。
     *
     * @param app Application 上下文（LynxEnv.init 要求）
     * @throws Throwable 初始化失败（调用方自行决定兜底策略）
     */
    public static void ensureInitialized(Application app) {
        if (!initialized.compareAndSet(false, true)) {
            return; // 已初始化（进程冷启动 PictelioApp / 进程复用 LynxActivity 兜底，只跑一次）
        }
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
        LynxEnv.inst().enableLynxDebug(BuildConfig.DEBUG);
    }
}
