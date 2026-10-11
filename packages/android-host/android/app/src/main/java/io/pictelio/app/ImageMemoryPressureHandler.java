package io.pictelio.app;

import android.app.Application;
import android.content.ComponentCallbacks2;
import android.content.res.Configuration;
import android.util.Log;

import java.util.concurrent.Executor;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 图片<b>内存层</b>的内存压力响应（#981，ADR-0222 §2.2 单一策略决策点的「内存压力响应」一维）。
 *
 * <p>本仓此前<b>完全没有接入内存压力回调</b>（设备内存紧张时图片缓存不让路，只能等被低内存杀手
 * 整进程干掉）。本类注册为 {@link Application} 的 {@link ComponentCallbacks2}，在系统通知
 * 内存紧张时主动收缩 {@link ImageMemoryCache}。
 *
 * <h3>只实现两级，且各有官方文档依据</h3>
 * <table>
 *   <caption>级别语义与取值依据</caption>
 *   <tr><th>级别</th><th>处置</th><th>依据</th></tr>
 *   <tr><td>{@code TRIM_MEMORY_UI_HIDDEN}</td><td>收缩到预算的
 *       {@link ImageCacheBudget#UI_HIDDEN_KEEP_RATIO}</td>
 *       <td>AOSP 文档：UI 不可见，应释放较大分配，但<b>须能快速恢复</b> ⇒ 部分收缩</td></tr>
 *   <tr><td>{@code TRIM_MEMORY_BACKGROUND}</td><td>清空内存层
 *       （{@link ImageCacheBudget#BACKGROUND_KEEP_RATIO}）</td>
 *       <td>AOSP 文档：进程接近 LRU 列表开头，<b>应尽可能多释放</b> ⇒ 全部释放</td></tr>
 * </table>
 *
 * <p><b>其余历史级别不作为实现依据</b>：{@code RUNNING_MODERATE / RUNNING_LOW /
 * RUNNING_CRITICAL / MODERATE / COMPLETE} 自 <b>API 34（Android 14）起不再派发</b>，
 * 且在 Android 15 的 AOSP 源码中已标注 {@code @Deprecated}（本仓已逐行核对
 * {@code frameworks/base/core/java/android/content/ComponentCallbacks2.java}，
 * android15-release 分支）。故本类不为它们单列分支；低于 {@code UI_HIDDEN} 的旧级别一律
 * <b>不作为触发条件</b>。由于系统按严重度<b>升序</b>派发（{@code UI_HIDDEN}=20 &lt;
 * {@code BACKGROUND}=40），用 {@code >=} 比较即自动覆盖「比 UI_HIDDEN 更严重」的全部情形，
 * 不需要、也没有引入对废弃常量的单独实现。
 *
 * <p><b>磁盘层不随内存压力收缩</b>（#981 验收项）：本类只碰内存层，不引用
 * {@link PixivImageLoader}。磁盘条目留在 {@code cacheDir}，故回到前台后重新填充
 * 只付「磁盘读 + 解码」，不付网络。
 *
 * <h3>注册幂等：为什么不会漏、也不会重复注册</h3>
 * <p>本仓的 Lynx runtime 初始化是<b>双入口</b>——{@code Application} 冷启动与
 * {@code LynxActivity} 进程复用兜底都会走 {@code LynxRuntimeInitializer.ensureInitialized}，
 * 且那里的幂等门是「<b>成功才置位、失败不 latch</b>」，即初始化失败后同一进程内<b>会重入</b>。
 * <p>因此本类<b>不挂在那条初始化路径上</b>：调用点只有一处
 * （{@link PictelioAppLynx#onCreate}，且在 Lynx 初始化调用<b>之前</b>、不落在它的
 * {@code try/catch} 内）。这样——
 * <ul>
 *   <li><b>不会漏</b>：{@code Application.onCreate()} 由框架保证每进程恰好执行一次、早于任何组件，
 *       与 Lynx 初始化成败<b>无关</b>（Lynx 初始化抛异常被 catch 吞掉时，回收响应依然已就位）；
 *       而挂在 {@code initInternal} 里则会在该路径抛异常时被整体跳过。</li>
 *   <li><b>不会重复注册</b>：本类自持 {@link AtomicBoolean} 闸，与 Lynx 的 {@code InitGate}
 *       <b>相互独立</b>。哪怕将来出现第二条调用路径（或初始化重入），闸也只让第一次注册生效；
 *       反过来，{@code InitGate} 重入也不会导致二次注册。</li>
 * </ul>
 *
 * <p>收缩跑在调用方传入的执行器上（生产复用 {@code PictelioAppLynx} 的
 * {@code TRIM_EXECUTOR} daemon 单线程），不占主线程：{@code onTrimMemory} 由主线程回调，
 * 而逐出要拿 {@link LruCache} 的锁、与并发图片写入争用。
 */
public final class ImageMemoryPressureHandler implements ComponentCallbacks2 {

    /** 日志 TAG（包可见：单测用 ShadowLog 观测「跳过/失败必须告警」，故非 private） */
    static final String TAG = "ImageMemoryPressure";

    /**
     * 进程级注册闸（幂等）。<b>与 Lynx 的 {@code InitGate} 相互独立</b>——
     * 见类注释「注册幂等」一节。成功才置位；注册抛异常时<b>回滚</b>，否则此后永远无法再注册。
     */
    private static final AtomicBoolean REGISTERED = new AtomicBoolean(false);

    /** 已注册实例（测试可读，用于断言注册幂等） */
    private static volatile ImageMemoryPressureHandler registeredInstance;

    /** 内存层取用口：返回<b>当前</b>内存层，null = 尚未创建、无可释放字节 */
    public interface MemoryCacheSource {
        ImageMemoryCache current();
    }

    private final MemoryCacheSource source;
    private final Executor executor;

    private ImageMemoryPressureHandler(MemoryCacheSource source, Executor executor) {
        this.source = source;
        this.executor = executor;
    }

    /**
     * 幂等注册（唯一入口）。
     *
     * @param app      Application 上下文
     * @param source   内存层取用口（通常为方法引用，如 {@code PictelioImageService::memoryCacheForTrim}）
     * @param executor 收缩执行器（生产为 daemon 单线程，不占主线程）
     * @return true = 本次完成注册；false = 此前已注册（幂等跳过）或注册参数缺失/失败
     */
    public static boolean ensureRegistered(Application app, MemoryCacheSource source, Executor executor) {
        if (app == null || source == null || executor == null) {
            // 注册参数缺失若不告警，本类将永久静默失效——正是本票要消灭的失败模式
            Log.w(TAG, "注册参数缺失（app/source/executor 为 null），内存压力响应未生效");
            return false;
        }
        if (!REGISTERED.compareAndSet(false, true)) {
            return false; // 已注册：幂等跳过（不重复 registerComponentCallbacks）
        }
        ImageMemoryPressureHandler handler = new ImageMemoryPressureHandler(source, executor);
        try {
            app.registerComponentCallbacks(handler);
        } catch (RuntimeException e) {
            Log.w(TAG, "内存压力回调注册失败，已回滚注册闸（允许后续重试）", e);
            REGISTERED.set(false);
            return false;
        }
        registeredInstance = handler;
        return true;
    }

    /** 已注册实例；未注册返回 null（单测断言幂等用） */
    static ImageMemoryPressureHandler registeredInstance() {
        return registeredInstance;
    }

    /** 重置注册闸与实例（<b>仅供单测隔离</b>：进程内闸在测试间需重置，生产代码不得调用） */
    static void resetRegistrationForTest() {
        REGISTERED.set(false);
        registeredInstance = null;
    }

    @Override
    public void onTrimMemory(int level) {
        // 系统按严重度升序派发（UI_HIDDEN=20 < BACKGROUND=40），故先判更严重的一档
        if (level >= ComponentCallbacks2.TRIM_MEMORY_BACKGROUND) {
            submitTrim(ImageCacheBudget.BACKGROUND_KEEP_RATIO, "TRIM_MEMORY_BACKGROUND");
        } else if (level >= ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN) {
            submitTrim(ImageCacheBudget.UI_HIDDEN_KEEP_RATIO, "TRIM_MEMORY_UI_HIDDEN");
        }
        // 低于 UI_HIDDEN 的旧级别（RUNNING_* 等）自 API 34 起不再派发且已废弃，
        // 不作为触发条件；此处不静默吞——无动作即无日志，避免废弃级别刷屏。
    }

    /**
     * 遗留回调 {@code ComponentCallbacks.onLowMemory}。
     *
     * <p>它自 API 34 起同样不再派发、已废弃；但接口要求实现，故按其文档语义
     * （「系统判定内存紧张」）等同 {@code TRIM_MEMORY_BACKGROUND} 档处理——保守方向一致。
     */
    @Override
    public void onLowMemory() {
        submitTrim(ImageCacheBudget.BACKGROUND_KEEP_RATIO, "onLowMemory");
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        // 与内存压力无关，不做任何事
    }

    /** 取内存层 → 按比例算目标字节 → 提交到后台执行器收缩；每级不变量失守一律 Log.w */
    private void submitTrim(float keepRatio, String levelName) {
        ImageMemoryCache cache = source.current();
        if (cache == null) {
            // 内存层尚未创建 = 还没有任何图片字节可释放（不是降级，但显式记录，
            // 以免被误读成「回调没触发」）
            Log.w(TAG, levelName + "：内存层尚未创建，本级无可释放对象");
            return;
        }
        final long target = ImageCacheBudget.retainedBytesAfterTrim(cache.maxBytes(), keepRatio);
        final int entriesBefore = cache.size();
        try {
            executor.execute(() -> {
                try {
                    cache.trimToSize(target);
                    Log.i(TAG, levelName + "：图片内存层收缩至 " + target + " 字节（条目 "
                            + entriesBefore + " → " + cache.size() + "）");
                } catch (Throwable t) {
                    // 禁静默降级：收缩失败必须可见，否则表现为「压力响应没生效」而无从排查
                    Log.w(TAG, levelName + " 收缩图片内存层失败", t);
                }
            });
        } catch (RuntimeException e) {
            Log.w(TAG, levelName + " 收缩任务提交失败（执行器不可用）", e);
        }
    }
}
