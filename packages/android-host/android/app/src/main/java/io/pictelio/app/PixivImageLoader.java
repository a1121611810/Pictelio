package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.StatFs;
import android.util.Base64;
import android.util.Log;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Arrays;
import java.util.Comparator;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.function.LongSupplier;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * 图片流水线公共核心（#57）——图片加载链路的单一事实源（URL 改写 / 磁盘缓存 / 下载）。
 *
 * <p>职责（均为唯一实现）：
 * <ul>
 *   <li>URL 重写：{@code /pixiv-img/{path}} → {@code OAuthConfig.IMAGE_CDN_URL + "/" + path}</li>
 *   <li>OkHttp 下载：注入 {@code Referer}/{@code User-Agent}（i.pximg.net 防盗链必需），
 *       复用 {@link PixivApiCore#getSharedClient()} 共享连接池</li>
 *   <li>磁盘缓存读写 + 淘汰：目录/文件名沿用现有约定（{@code OAuthConfig.CACHE_DIR}、
 *       Base64 URL-safe no-padding 文件名），上限改为<b>按可用存储比例</b>计算
 *       （{@link DiskCacheBudget}，#986），淘汰仍复用 {@link #enforceCacheLimit} 单一路径</li>
 *   <li>下载源决策（ADR-0143 D1/D4）：{@link ImageHostConfig#resolve} 决定镜像/官方下载源，
 *       镜像失败回退官方一次；<b>缓存键恒官方 URL</b>（D2 源无关命中不变量，本类缓存路径
 *       只认官方入参，不消费 resolve 返回值）</li>
 * </ul>
 *
 * <p>消费方（薄适配，不复制逻辑）：图片拦截链路、
 * {@code PictelioImageService}（Lynx Bitmap 形态，见 #58/#59）。
 *
 * <p>非 final 是<b>测试缝</b>：{@link NovelExporter} 的取图注入要求测试可覆盖
 * {@link #loadBytesCachedFirst(String)} 提供确定性字节（生产调用方零影响，公开 API 不变）。
 *
 * <p><b>入口命名（#978）</b>：加载入口一律带 {@code CachedFirst} 后缀——它们<b>先查缓存、
 * 未命中才下载</b>，旧名 {@code loadBytes}/{@code loadFile} 掩盖了这一点，读代码的人
 * 第一眼会以为那是纯下载。缓存探针 {@link #cachedFile(String)} 保持纯查询语义（不刷新时间戳），
 * 访问时间戳只在真正交付条目的加载路径上刷新。
 *
 * <p><b>磁盘淘汰为真 LRU（#978）</b>：命中时刷新条目访问时间戳（{@code setLastModified}），
 * 淘汰按该时间戳升序——即「最近被<b>用过</b>」而非「最近被<b>写下</b>」。一手先例：Fresco
 * {@code imagepipeline-base} 磁盘缓存读取路径同款做法。淘汰触发点为「启动时 + 每次写入后」，
 * 使长期不写入的超限存量也能被回收。目录名与文件名约定不变（无存储格式迁移）。
 *
 * <p><b>磁盘上限随可用存储浮动（#986）</b>：上限不再是写死常量，而是
 * {@link DiskCacheBudget#computeMaxBytes(long)}（可用存储 × 2%，钳制 10MB–250MB，一手出处
 * 见该类注释）。上限在<b>每次淘汰时重新求值</b>，故存储紧张时自动收缩、恢复后自然增长；
 * 收缩后超限条目由下方<b>同一条</b>淘汰路径按访问时间序回收（不另起删除逻辑）。
 *
 * <p><b>升级清空存量缓存（#985）</b>：{@link #purgeLegacyCacheOnUpgrade()} 按<b>缓存布局代次</b>
 * 只清空一次——存量直接清空、不做迁移（缓存非真相源，可从网络重建），清空后状态等同全新安装。
 * 它<b>不实现删除逻辑</b>，删除一律委托 {@link #clearDiskCache()}，与用户手动清理同一条路径。
 * 与上文的启动容量回收（{@link #trimAtStartup()}）语义不同、不得互相替代：前者是<b>存量处置</b>
 * （只一次、全删），后者是<b>容量管理</b>（每次冷启动、超限才淘汰、保留最近被用过的）。
 *
 * <p><b>两层缓存共用一个键空间（#980）</b>：缓存键由 {@link #cacheKey(String)} 唯一产出，
 * 内存层（{@code PictelioImageService} 的 {@code ImageMemoryCache}）与本类磁盘层消费<b>同一</b>个键。
 * 此前磁盘层键是 rewrite 产物、内存层却用未 rewrite 的原始 URL——同一张图以代理路径与绝对地址
 * 两种形态请求时磁盘共享一条目而内存记两份。此差异已消除，ADR-0143 D2「缓存键恒官方 CDN URL」
 * 与 ADR-0222 §2.5「预取/显示/zip 三链路共用同一键空间」两条不变量现覆盖两层。
 * <b>本类缓存方法的入参契约不变</b>：调用方传入的应是官方 URL（{@code cacheKey} 幂等，重复调用无害）。
 */
public class PixivImageLoader {

    /** 下载进度回调（done/total 字节；total <= 0 表示长度未知） */
    public interface ProgressSink {
        void onProgress(long done, long total);
    }

    /** 取消信号（true = 请求取消，读取循环抛 IOException 中止） */
    public interface Cancellation {
        boolean isCancelled();
    }

    private static final String TAG = "PixivImageLoader";
    /**
     * 缓存目录名——<b>直接引用唯一事实源</b> {@link OAuthConfig#CACHE_DIR}（由
     * {@code app-lynx/credentials.json5} 的 {@code cacheDir} 生成）。
     *
     * <p>此前此处另写了一份字面量，与 {@code OAuthConfig.CACHE_DIR} 构成双事实源；
     * #986 已以「保留写死常量只会留下第二事实源」为由从 credentials 退役 {@code cacheMaxBytes}，
     * 同一问题此处只处理了一半（2026-10-11 code-review 订正）。
     *
     * <p><b>仍保留的机器防线</b>：两个测试类以<b>字面量</b>断言锚点
     * （{@code ImageCacheClearScopeTest} / {@code ImageCacheUpgradePurgeTest} 的
     * {@code *_anchor_isTheImageCacheDirItself}），故改动 credentials 会转红。
     */
    private static final String CACHE_DIR_NAME = OAuthConfig.CACHE_DIR;

    /**
     * 升级清空标记的持久化文件名（#985，<b>独立于存量格式契约</b>，理由与
     * {@code ImageCacheStatsStore} 同源）：刻意不是 {@code SecureStorageCompat.PREFS_NAME}
     * （安全存储），也不是图床配置所在的 {@code "CapacitorStorage"}——那两处的键空间属于
     * ADR-0050 存量用户数据，一字不改。本文件只<b>新增</b>一个标记文件，不读写存量键空间。
     */
    private static final String UPGRADE_PREFS_NAME = "pictelio-image-cache-upgrade";
    /** 键：已清空到的缓存布局代次（值见 {@link #CACHE_LAYOUT_GENERATION}） */
    private static final String KEY_PURGED_GENERATION = "purged_generation";
    /**
     * 缓存布局代次（#985）：升级清空只做一次，靠它而非「版本号大小比较」判定。
     *
     * <p>为何不用 versionCode 比大小：清空必须<b>恰好一次</b>，而版本号语义是
     * 「用户装到了哪版」，两者在降级安装、跳版升级、应用市场回滚下会分叉。
     * 代次只表达「存量缓存是否已按当前布局清过」，与用户装没装某一版无关。
     * 日后缓存目录布局/语义再变，递增此串即可让清空对新代次重新生效一次。
     *
     * <p>取值 {@code v1} = 图片缓存重设计（#978 真 LRU / #980 键空间统一 / #986 上限浮动）
     * 后的首个代次：这三者改的是<b>淘汰策略与键空间</b>，目录名与文件名约定未变，故存量条目
     * 虽可被新策略正确管理，但按 ADR-0222 §2.6「存量直接清空、不做迁移」的决策仍一次性清掉。
     */
    private static final String CACHE_LAYOUT_GENERATION = "v1";

    /**
     * 缓存目录<b>内容增删</b>的进程级互斥锁（#985 随升级清空引入）。
     *
     * <h3>为什么需要它</h3>
     * 删除方（用户手动清理 {@code clearDiskCache} / 升级清空 / 容量淘汰
     * {@code enforceCacheLimit}）与写入方（{@link #writeFile} 的 tmp→目标 rename）
     * 此前<b>没有任何互斥</b>：删除恰好落在 rename 中间时，tmp 已被删掉，
     * {@code renameTo} 失败并抛 {@link IOException}，调用方（如「保存到相册」）
     * 会把一次后台清理显示成用户可见的失败。容量淘汰只在超限时删、命中概率低，
     * 而升级清空是<b>一次性全删</b>，把这个原本罕见的竞态放大成了必然，故此处让二者互斥。
     *
     * <h3>边界（刻意不做满）</h3>
     * 本锁只保护<b>目录内容的增删</b>，不覆盖「把 {@link File} 句柄返回给调用方、调用方之后才读」
     * 的时序（如 {@code loadFileCachedFirst}）；对<b>升级存量清空</b>这一条路径，该时序已由
     * 冷启动闸门（{@link #awaitStartupCacheMaintenance()}）整体排除，但用户手动清理与容量淘汰
     * 仍保留这一暴露面（早于本票即如此），不属本票范围。
     *
     * <h3>不会死锁</h3>
     * 持锁期间不做网络 IO（下载早于写盘完成），且删除方不获取任何 per-URL 锁，
     * 故不存在与 {@link #urlLocks} 的反向等待顺序。
     */
    private static final Object CACHE_DIR_MUTATION_LOCK = new Object();

    /**
     * 磁盘上限成功路径的一次性日志闸（2026-10-11）。
     *
     * <p>{@link #currentDiskBudget} 在<b>每次写盘后</b>的淘汰里都会调，故不能直接在里面打日志；
     * 但只留降级告警会让「StatFs 真机读数与算出的上限」完全不可观测，而 Robolectric 的
     * {@code StatFs} 返回 0 ⇒ 单测只覆盖了降级分支，#986 的真机数值欠账无法偿还。
     */
    private static final java.util.concurrent.atomic.AtomicBoolean DISK_BUDGET_LOGGED =
            new java.util.concurrent.atomic.AtomicBoolean(false);

    /**
     * 冷启动缓存维护的<b>闸门</b>（#985）：调度时关、维护结束开，缓存访问在 {@link #getCacheDir()}
     * 处等它（见 {@link #awaitStartupCacheMaintenance()}）。
     *
     * <p>初值 count=0（已开闸）：未经 {@link #scheduleStartupCacheMaintenance} 调度的进程
     * （例如不经 Application 冷启动的测试）不会因为等一个不存在的闸门而卡住。
     */
    private static volatile CountDownLatch startupMaintenanceGate = new CountDownLatch(0);
    /**
     * 正在执行维护的线程——让该线程自身不被「等待维护结束」挡住
     * （维护内部同样会走 {@link #getCacheDir()}）。
     */
    private static volatile Thread startupMaintenanceThread;
    /** 等待冷启动维护的兜底超时（秒）：超时只记告警并放行，不把启动卡死（缓存本非真相源） */
    private static final long STARTUP_MAINTENANCE_WAIT_SECONDS = 15L;
    /** 镜像下载预算（实现定值：connect 5s / call 15s，低于官方 connect 15s / read 30s / call 45s
     *  ——ADR-0143 D4「低于官方」的具体化；劣化镜像快失败，不拖慢官方回退） */
    private static final int MIRROR_CONNECT_TIMEOUT_SECONDS = 5;
    private static final int MIRROR_CALL_TIMEOUT_SECONDS = 15;
    /** 流式进度上报粒度（字节）：约每 64KB 或收尾各一次，避免大文件回调风暴 */
    private static final long PROGRESS_REPORT_BYTES = 64 * 1024;

    private final Context context;
    private final OkHttpClient client;
    /** 磁盘上限供给器（#986）：每次淘汰时求值，故上限跟随当前可用存储浮动 */
    private final LongSupplier maxCacheBytesSupplier;
    /** 图床下载源决策（ADR-0143 D1 深模块；resolve 不命中时行为与既有官方路径逐字节一致） */
    private final ImageHostConfig imageHostConfig;
    /** per-URL 锁：并发同 URL 加载时避免截断写同一缓存文件（拦截链路为多线程） */
    private final ConcurrentHashMap<String, Object> urlLocks = new ConcurrentHashMap<>();
    /** 磁盘层自计统计的采集器（#983）；惰性解析，进程级单例（见 {@link ImageCacheStatsStore}） */
    private volatile ImageCacheStatsStore statsStore;

    /**
     * 生产构造：磁盘上限按<b>当期可用存储</b>比例计算（#986），故上限供给器是惰性的、
     * 每次淘汰时重新求值——存储紧张时自动收缩、恢复后自然增长。
     */
    public PixivImageLoader(Context context) {
        this(context, PixivApiCore.getSharedClient(), () -> currentDiskBudget(context),
                ImageHostConfig.get(context));
    }

    /** 包可见注入构造（测试注入 mock 网络与固定的小缓存上限）；图床配置默认走生产单例 */
    PixivImageLoader(Context context, OkHttpClient client, long maxCacheBytes) {
        this(context, client, fixedBudget(maxCacheBytes));
    }

    /**
     * 包可见注入构造（测试缝，#986）：注入<b>可变的</b>上限供给器，等价于设备可用存储随时间变化，
     * 用于验证「上限收缩后同一条淘汰路径仍按访问时间序回收」。
     */
    PixivImageLoader(Context context, OkHttpClient client, LongSupplier maxCacheBytesSupplier) {
        this(context, client, maxCacheBytesSupplier, ImageHostConfig.get(context));
    }

    /** 全注入构造（包可见）：测试注入固定图床配置与上限供给器，不触生产单例与 SharedPreferences */
    PixivImageLoader(Context context, OkHttpClient client, LongSupplier maxCacheBytesSupplier,
            ImageHostConfig imageHostConfig) {
        this.context = context.getApplicationContext();
        this.client = client;
        this.maxCacheBytesSupplier = maxCacheBytesSupplier;
        this.imageHostConfig = imageHostConfig;
    }

    /** 全注入构造（包可见）：既有调用方以固定字节数注入上限 */
    PixivImageLoader(Context context, OkHttpClient client, long maxCacheBytes,
            ImageHostConfig imageHostConfig) {
        this(context, client, fixedBudget(maxCacheBytes), imageHostConfig);
    }

    private static LongSupplier fixedBudget(long maxCacheBytes) {
        return () -> maxCacheBytes;
    }

    /**
     * 按<b>当期</b>可用存储求磁盘上限（#986）。
     *
     * <p>每次淘汰时调用（而非构造时算一次）：可用存储会变，冻结的取值会让「恢复后自然增长」
     * 落空。开销为一次 {@code statfs}，相较同轮淘汰自身的 listFiles + 逐条 stat 可忽略。
     */
    private static long currentDiskBudget(Context app) {
        return DiskCacheBudget.computeMaxBytes(availableBytes(app));
    }

    /**
     * 探测缓存目录所在卷的可用字节（{@code StatFs}）；失败或非正值<b>不静默</b>：
     * 记 Log.w 后返回 -1，由 {@link DiskCacheBudget#computeMaxBytes(long)} 兜到下界。
     */
    private static long availableBytes(Context app) {
        long available;
        try {
            StatFs statFs = new StatFs(app.getCacheDir().getAbsolutePath());
            available = statFs.getAvailableBytes();
        } catch (Throwable t) {
            Log.w(TAG, "读取可用存储失败，磁盘缓存上限退回下界 " + DiskCacheBudget.MIN_BYTES + "B", t);
            return -1L;
        }
        if (available <= 0) {
            Log.w(TAG, "可用存储读数非正（" + available + "B），磁盘缓存上限退回下界 "
                    + DiskCacheBudget.MIN_BYTES + "B");
            return -1L;
        }
        // 成功路径一次性留痕（2026-10-11，与内存预算的观测出口对称）：此前只有降级才告警，
        // 故「StatFs 读到了多少、算出的上限是多少」在正常设备上完全查不到——而 Robolectric
        // 的 StatFs 返回 0，单测只覆盖了降级分支，真机数值欠账无法偿还。用一次性闸避免
        // 「每次淘汰都打一行」：currentDiskBudget 是每次写盘后都调的。
        if (DISK_BUDGET_LOGGED.compareAndSet(false, true)) {
            long budget = DiskCacheBudget.computeMaxBytes(available);
            Log.i(TAG, "磁盘缓存上限已按可用存储算出: " + (budget / 1024 / 1024) + "MB"
                    + "（StatFs 可用 " + (available / 1024 / 1024) + "MB"
                    + "，比例 " + DiskCacheBudget.STORAGE_RATIO
                    + "，钳制 " + (DiskCacheBudget.MIN_BYTES / 1024 / 1024)
                    + "-" + (DiskCacheBudget.MAX_BYTES / 1024 / 1024) + "MB）");
        }
        return available;
    }

    /** 当前生效的磁盘上限（字节）：包可见测试缝，亦是 #983 可观测统计的读点 */
    long currentMaxCacheBytes() {
        return maxCacheBytesSupplier.getAsLong();
    }

    // ── 磁盘层自计统计（#983）─────────────────────────────────

    /**
     * 统计采集器（惰性解析，进程级单例）。
     *
     * <p>惰性而非构造期解析：构造期解析会让每个测试实例都去开一次 SharedPreferences，
     * 而本类有多个仅作网络/淘汰测试缝存在的短命实例。
     */
    private ImageCacheStatsStore statsStore() {
        ImageCacheStatsStore store = statsStore;
        if (store == null) {
            store = ImageCacheStatsStore.get(context);
            statsStore = store;
        }
        return store;
    }

    /**
     * 磁盘层占用读数（#983 的对外读取契约）：条目数 + 字节数，一次 {@code listFiles} 求值。
     *
     * <p><b>不在热路径调用</b>——加载路径只复用 {@link #enforceCacheLimit} 已经算好的
     * 总量（那里本来就要遍历目录），本方法供「读快照 / 清理前展示」等低频场景现算。
     * <b>含一次目录遍历（阻塞 IO），调用方须放在后台线程</b>（与
     * {@code PictelioAppLynx.TRIM_EXECUTOR} 同款做法），别在 UI 刷新里反复调。
     * 目录不可读<b>不静默</b>：Log.w 后返回 {@link DiskCacheUsage#EMPTY}。
     */
    public DiskCacheUsage diskUsage() {
        File cacheDir = getCacheDir();
        File[] files = cacheDir.listFiles();
        if (files == null) {
            Log.w(TAG, "缓存目录不可读，占用统计按 0 计: " + cacheDir);
            return DiskCacheUsage.EMPTY;
        }
        long total = 0L;
        for (File f : files) {
            total += f.length();
        }
        DiskCacheUsage usage = new DiskCacheUsage(files.length, total);
        statsStore().publishDiskUsage(usage);
        return usage;
    }

    /**
     * 磁盘层自计：记一次命中（该次加载由缓存条目供给，未触网络）。热路径只做内存自增。
     *
     * <p><b>口径闸门在 {@link ImageCacheStatsStore} 内</b>（{@link ImageLoadChain#DISPLAY}
     * 才计入分子），此处只负责把归属传下去——闸门不散落到调用点。
     */
    private void recordDiskHit(ImageLoadChain chain) {
        statsStore().recordDiskHit(chain);
    }

    /** 磁盘层自计：记一次未命中（该次加载需要发起网络下载）；口径闸门同 {@link #recordDiskHit} */
    private void recordDiskMiss(ImageLoadChain chain) {
        statsStore().recordDiskMiss(chain);
    }

    // ── URL 重写（/pixiv-img/ → i.pximg.net） ─────────────────

    /** 代理路径重写为 CDN 绝对 URL（含 dot-segment normalize，对齐 MainActivity 既有行为）；非代理 URL 原样返回；null 返回 null */
    public static String rewriteUrl(String url) {
        if (url == null || !url.contains("/pixiv-img/")) {
            return url;
        }
        int idx = url.indexOf("/pixiv-img/");
        String path = url.substring(idx + "/pixiv-img/".length());
        String cdnUrl = OAuthConfig.IMAGE_CDN_URL + "/" + path;
        try {
            return new URI(cdnUrl).normalize().toString();
        } catch (URISyntaxException e) {
            // 非法 URI 字符（如未编码空格）：回退原始拼接，与既有 interceptImage 行为一致
            return cdnUrl;
        }
    }

    /**
     * <b>缓存键的唯一产出点（#980）</b>：内存层与磁盘层<b>必须</b>都用本函数产出键。
     *
     * <p>为什么需要它：此前磁盘层由调用方先 {@code rewriteUrl} 再传进来（键 = 官方 URL），
     * 而内存层直接拿未 rewrite 的原始 {@code url} 当键。同一张图若以 {@code /pixiv-img/x}
     * 与 {@code https://i.pximg.net/x} 两种形态请求，磁盘共享一条目、内存却记两份——
     * 内存预算被双份占用，命中率统计随之失真。本函数把「键怎么算」收敛到一处，
     * 两条链路不可能再算出不同的键。
     *
     * <p><b>形态归一 ≠ 换源（#980 定产出，#987 定消费）</b>：本函数只做<b>形态归一</b>
     * （代理路径 → 官方 CDN URL），它与 {@link ImageHostConfig} 的<b>换源</b>是两件事——
     * 前者决定「同一张图是否共用同一条目」，后者决定「从哪台机器取字节」。
     * <br><br>
     * <b>消费分两处</b>：内存层由调用点<b>显式</b>取键；磁盘层经
     * {@code cacheFileName(url)} <b>内部</b>取键（#987：读路径与三个
     * {@code *CachedFirst} 入口的写路径全部经它）。
     * <br><br>
     * <b>唯一禁止的是把 {@code cacheKey} 挪进 {@link #download} 或 {@link ImageHostConfig#resolve}</b>
     * ——那才会让缓存键跟随下载源，切源 / 开关图床 / 换镜像将使已缓存条目失效，
     * 直接违反 ADR-0143 D2 源无关命中。（注意：这与「在磁盘路径内部取键」是两回事，
     * 后者正是 #987 做的事且是正确的。）
     *
     * <p><b>幂等</b>：{@code rewriteUrl} 对已 rewrite 的官方 URL 原样返回
     * （其中不含 {@code /pixiv-img/}），故重复调用本函数不改变结果。
     */
    public static String cacheKey(String url) {
        return rewriteUrl(url);
    }

    // ── 磁盘缓存（对齐 ImageCachePlugin/PixivApiPlugin 同规则） ─

    /**
     * URL → 缓存文件名（Base64 URL-safe no-padding；同 keyToFilename 契约）。
     *
     * <p><b>包可见是刻意的（#987）</b>：本方法是<b>原始</b>键到文件名的直译，
     * <b>未经 {@link #cacheKey(String)} 归一</b>。磁盘层<b>不得</b>直接调用它——
     * 生产代码里唯一的合法用法是经 {@code cacheFileName(url)}（本包内）间接调用。
     * 收窄到包可见即把「键必须归一」从<b>约定</b>变成<b>编译器保证</b>：
     * 包外任何新代码都无法绕过 {@code cacheFileName} 另起一个文件名产出点。
     *
     * <p>保留可见的原因：本包内测试需要它来<b>独立</b>构造「期望的文件名」，
     * 若一并私有化，测试就只能调用被测实现反推期望值，违反 oracle 溯源（测试硬约束 #6）。
     */
    static String keyToFilename(String url) {
        return Base64.encodeToString(url.getBytes(), Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    /**
     * URL → <b>本类内部使用的缓存文件名</b>（#987）：{@code keyToFilename(cacheKey(url))}。
     *
     * <p><b>为什么收口到这里</b>：#980 只把<b>预取与显示</b>两条链路收敛到 {@link #cacheKey(String)}，
     * 剩下的 zip / 导出 / 保存三条链路把 URL <b>直接</b>交给 {@link #loadBytesCachedFirst} /
     * {@link #loadFileCachedFirst} / {@link #loadFileWithProgressCachedFirst}，而这三个入口内部
     * 各自 {@code keyToFilename(url)}、<b>不</b>调 {@code cacheKey} ⇒ 磁盘键<b>结构上</b>不受
     * 「缓存键恒官方 CDN URL」不变量保护。今天不出分叉只因这些调用点传入的恰好已是官方 URL，
     * 而 {@link #cacheKey(String)} 对官方 URL <b>幂等</b>——那是<b>巧合正确</b>，不是结构性正确。
     *
     * <p><b>为什么不改调用点而改这里</b>：改调用点要让 7 处各自记得调 {@code cacheKey}，
     * 漏一处就复现原 bug；收口到唯一的文件名产出点则<b>结构性</b>成立，且因 {@code cacheKey}
     * 幂等，<b>对现有调用点行为零变化</b>（预取与显示本就已先过一遍 {@code cacheKey}，
     * 这里再过一次仍是同一结果）。
     *
     * <p><b>边界</b>：本方法只统一<b>键的产出</b>，不改变<b>下载源</b>的决策——
     * 下载仍由 {@link #download} 内部的 {@link ImageHostConfig} 负责（ADR-0143 D2 源无关命中）。
     * 切勿把 {@code cacheKey} 挪进 {@code download}：那会让键与下载源耦合。
     *
     * <p>防线：{@code ImageCacheKeySpaceTest} 断言 {@code cacheKey} 幂等 +
     * {@code ImageCacheZipChainKeyTest}（#987 新增）断言三条链路传入代理形态 URL 时
     * 与官方形态<b>共用同一条目</b>。
     */
    private static String cacheFileName(String url) {
        return keyToFilename(cacheKey(url));
    }

    /**
     * 取图片缓存目录——<b>全部缓存访问的唯一入口</b>（读、写、清空、淘汰都经此）。
     *
     * <p>因此它也是「等待冷启动缓存维护」的<b>唯一收口点</b>（见
     * {@link #awaitStartupCacheMaintenance()}）：维护期间若有别的线程来读写缓存，
     * 在这里排队而不是拿到一个马上就会被删掉的文件。
     */
    public File getCacheDir() {
        awaitStartupCacheMaintenance();
        File dir = new File(context.getCacheDir(), CACHE_DIR_NAME);
        if (!dir.exists()) {
            dir.mkdirs();
        }
        return dir;
    }

    /**
     * 缓存命中返回文件（非空）；未命中返回 null。<b>纯查询</b>：不刷新访问时间戳。
     *
     * <p>键经 {@link #cacheFileName(String)} 产出，故本方法与三个 {@code *CachedFirst} 入口
     * 的写入路径<b>必然同名</b>，读与写不可能落到不同条目上（#987）。
     */
    public File cachedFile(String url) {
        File f = new File(getCacheDir(), cacheFileName(url));
        return f.exists() && f.length() > 0 ? f : null;
    }

    /**
     * 命中后刷新条目的<b>访问</b>时间戳，使淘汰顺序反映「最近被用过」而非「最近被写下」（#978）。
     *
     * <p>一手先例：Fresco {@code imagepipeline-base} 磁盘缓存读取路径对内容文件
     * {@code setLastModified} 刷新时间戳，淘汰比较器按该时间戳升序删除。
     *
     * <p><b>开销评估（#978 申报）</b>：本机实测 {@code setLastModified} ≈ 8µs/次，而同一次
     * 磁盘命中必然伴随的全文件读 ≈ 59µs（512KB 条目）——即 touch 约为命中路径既有开销的 1/7；
     * 列表快速滚动按 30 次磁盘命中/秒计，占单核 ≈ 0.025%，不构成密集系统调用。
     * 故按 Fresco 做法<b>不</b>做批量/延迟刷新或频率上限（那类节流会让「最近用过」的
     * 语义变模糊、且在命中稀疏时省不下什么）。刷新失败<b>不静默</b>：记 Log.w 后继续返回条目
     * （时间戳陈旧只影响淘汰优先级，不影响内容正确性）。
     */
    private static File touchOnHit(File cached) {
        if (!cached.setLastModified(System.currentTimeMillis())) {
            Log.w(TAG, "缓存命中刷新访问时间戳失败（淘汰将退回写入序）: " + cached.getName());
        }
        return cached;
    }

    // ── 下载（Referer/UA 注入防盗链；下载源跟随图床，缓存键恒官方——ADR-0143 D1/D2/D4） ──

    /**
     * 下载图片字节；非 2xx 或空 body 抛 IOException。
     *
     * <p>下载源决策（ADR-0143 D1/D4）：{@link ImageHostConfig#resolve} 命中镜像时先走镜像
     * （专用预算 client：connect 5s / call 15s，newBuilder 复用共享连接池/线程池，不新建全局单例），
     * 失败（IOException/非 2xx）Log.w 后以官方 URL 重试一次；重试仍失败抛镜像原始异常
     * （ticket #378 申报语义——失败上下文已由 Log.w 记录，抛出侧保持首次失败现场）。
     * resolve 恒等（图床关/配置损坏/无可用 host）时与既有官方路径逐字节一致（回归保护）。
     * <b>缓存键恒官方 URL</b>（D2 源无关命中）：本方法不触缓存，调用方
     * {@code loadFileCachedFirst}/{@code loadBytesCachedFirst}
     * 继续以官方入参寻址——换源/开关图床/换镜像均不使已缓存条目失效。
     */
    public byte[] download(String url) throws IOException {
        String downloadUrl = imageHostConfig.resolve(url);
        if (!Objects.equals(downloadUrl, url)) {
            // 镜像生效：预算仅用于镜像请求（官方回退保持现有 client，避免镜像预算缩窄官方通路）
            OkHttpClient mirrorClient = client.newBuilder()
                    .connectTimeout(MIRROR_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .callTimeout(MIRROR_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                    .build();
            try {
                return fetch(mirrorClient, downloadUrl);
            } catch (IOException mirrorError) {
                Log.w(TAG, "镜像下载失败，回退官方: " + url, mirrorError);
                try {
                    return fetch(client, url);
                } catch (IOException officialError) {
                    throw mirrorError; // 申报语义：重试仍失败抛镜像原始异常（ticket #378）
                }
            }
        }
        return fetch(client, url);
    }

    /** 单次 HTTP 请求：Referer/UA 注入（i.pximg.net 防盗链契约，镜像站代理官方资源同样适用） */
    private static byte[] fetch(OkHttpClient client, String url) throws IOException {
        Request request = new Request.Builder()
                .url(url)
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("图片下载失败 (HTTP " + response.code() + "): " + url);
            }
            if (response.body() == null) {
                throw new IOException("图片响应无 body: " + url);
            }
            byte[] bytes = response.body().bytes();
            if (bytes.length == 0) {
                throw new IOException("图片响应为空 body: " + url);
            }
            return bytes;
        }
    }

    // ── 加载（缓存优先；未命中下载 + 写盘 + 淘汰） ────────────

    /**
     * 返回图片文件：缓存命中直接返回（并刷新访问时间戳）；未命中下载写盘并淘汰后返回；失败抛 IOException。
     *
     * <p>「缓存优先」语义显式写进方法名（#978）：调用方读代码即知命中不再触网络。
     *
     * <p><b>归因固定为 {@link ImageLoadChain#NON_DISPLAY}（#984）</b>：本入口的生产调用方
     * 只有作品下载链路（{@code PictelioDownloader}）与作品导出链路，均非显示链路。
     * 显示链路走 {@link #loadBytesCachedFirst(String, ImageLoadChain)}。
     */
    public File loadFileCachedFirst(String url) throws IOException {
        File cached = cachedFile(url);
        if (cached != null) {
            recordDiskHit(ImageLoadChain.NON_DISPLAY);
            return touchOnHit(cached);
        }
        // per-URL 锁 + double-check：并发同 URL 只下载一次，避免截断写同一缓存文件
        Object lock = urlLocks.computeIfAbsent(url, k -> new Object());
        synchronized (lock) {
            cached = cachedFile(url);
            if (cached != null) {
                // 并发同 URL 由别的线程先下完：本次请求<b>仍算磁盘命中</b>（未触网络），
                // 故此处记命中而不记未命中——命中/未命中按「请求最终是否触网」计，
                // 两者之和恒等于本层的请求数。
                recordDiskHit(ImageLoadChain.NON_DISPLAY);
                return touchOnHit(cached);
            }
            recordDiskMiss(ImageLoadChain.NON_DISPLAY);
            byte[] bytes = download(url);
            File file = new File(getCacheDir(), cacheFileName(url));
            writeFile(file, bytes);
            enforceCacheLimit();
            return file;
        }
    }

    // ── 流式加载（下载队列：进度上报 + 可取消；字节直落缓存文件，不进 JS 堆） ──

    /**
     * 流式加载：缓存命中直接返回（并刷新访问时间戳）；未命中流式下载并原子写盘，
     * 全程按字节回调进度、响应取消。与 {@link #loadFileCachedFirst(String)} 同缓存键/下载源/
     * 镜像回退语义（ADR-0143 不偏离）。
     *
     * <p><b>归因固定为 {@link ImageLoadChain#NON_DISPLAY}（#984）</b>：本入口只服务作品保存与
     * zip 下载（{@code PictelioDownloader}），两条链路的磁盘命中都不计入命中率分子。
     */
    public File loadFileWithProgressCachedFirst(String url, ProgressSink sink, Cancellation cancel)
            throws IOException {
        File cached = cachedFile(url);
        if (cached != null) {
            reportDone(sink, cached.length());
            recordDiskHit(ImageLoadChain.NON_DISPLAY);
            return touchOnHit(cached);
        }
        Object lock = urlLocks.computeIfAbsent(url, k -> new Object());
        synchronized (lock) {
            cached = cachedFile(url);
            if (cached != null) {
                reportDone(sink, cached.length());
                recordDiskHit(ImageLoadChain.NON_DISPLAY);
                return touchOnHit(cached);
            }
            recordDiskMiss(ImageLoadChain.NON_DISPLAY);
            File target = new File(getCacheDir(), cacheFileName(url));
            downloadToFile(url, target, sink, cancel);
            enforceCacheLimit();
            return target;
        }
    }

    private static void reportDone(ProgressSink sink, long len) {
        if (sink != null) {
            sink.onProgress(len, len);
        }
    }

    private void downloadToFile(String url, File target, ProgressSink sink, Cancellation cancel)
            throws IOException {
        String downloadUrl = imageHostConfig.resolve(url);
        File tmp = new File(target.getAbsolutePath() + ".tmp");
        try {
            if (!Objects.equals(downloadUrl, url)) {
                OkHttpClient mirrorClient = client.newBuilder()
                        .connectTimeout(MIRROR_CONNECT_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                        .callTimeout(MIRROR_CALL_TIMEOUT_SECONDS, TimeUnit.SECONDS)
                        .build();
                try {
                    fetchToFile(mirrorClient, downloadUrl, tmp, sink, cancel);
                } catch (IOException mirrorError) {
                    Log.w(TAG, "镜像下载失败，回退官方: " + url, mirrorError);
                    try {
                        fetchToFile(client, url, tmp, sink, cancel);
                    } catch (IOException officialError) {
                        throw mirrorError;
                    }
                }
            } else {
                fetchToFile(client, url, tmp, sink, cancel);
            }
            atomicReplace(tmp, target);
        } catch (IOException e) {
            if (!tmp.delete()) {
                Log.w(TAG, "tmp 清理失败（留待容量淘汰/清空缓存回收）: " + tmp);
            }
            throw e;
        }
    }

    /** 单次流式 HTTP 请求：Referer/UA 注入 + 8KB 分块 + 进度节流 + 取消检查 */
    private static void fetchToFile(OkHttpClient client, String url, File tmp, ProgressSink sink,
            Cancellation cancel) throws IOException {
        if (cancel != null && cancel.isCancelled()) {
            throw new IOException("下载已取消: " + url);
        }
        Request request = new Request.Builder()
                .url(url)
                .addHeader("Referer", OAuthConfig.REFERER)
                .addHeader("User-Agent", OAuthConfig.USER_AGENT)
                .build();
        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("图片下载失败 (HTTP " + response.code() + "): " + url);
            }
            if (response.body() == null) {
                throw new IOException("图片响应无 body: " + url);
            }
            long total = response.body().contentLength();
            long done = 0;
            long lastReported = 0;
            byte[] buf = new byte[8192];
            try (InputStream in = response.body().byteStream();
                 OutputStream out = new FileOutputStream(tmp)) {
                int n;
                while ((n = in.read(buf)) != -1) {
                    if (cancel != null && cancel.isCancelled()) {
                        throw new IOException("下载已取消: " + url);
                    }
                    out.write(buf, 0, n);
                    done += n;
                    if (sink != null && (done - lastReported >= PROGRESS_REPORT_BYTES
                            || (total > 0 && done >= total))) {
                        lastReported = done;
                        sink.onProgress(done, total);
                    }
                }
            }
            if (done == 0) {
                throw new IOException("图片响应为空 body: " + url);
            }
            if (sink != null && lastReported < done) {
                sink.onProgress(done, total > 0 ? total : done);
            }
        }
    }

    /** 原子替换（与 {@link #writeFile} 同纪律）：rename 优先，失败删旧目标重试一次 */
    private static void atomicReplace(File tmp, File target) throws IOException {
        if (tmp.renameTo(target)) {
            return;
        }
        if (target.exists() && !target.delete()) {
            throw new IOException("无法删除旧缓存文件: " + target);
        }
        if (!tmp.renameTo(target)) {
            throw new IOException("rename 失败: " + tmp + " -> " + target);
        }
    }

    /** {@link #loadFileCachedFirst(String)} 的字节形态（缓存命中读文件并刷新访问时间戳；
     *  未命中下载后直接返回字节并写盘）。
     *
     *  <p><b>默认按 {@link ImageLoadChain#NON_DISPLAY} 归因（#984）</b>：本重载无链路信息可依，
     *  而漏传时的错误方向必须是「不计入分子」（低估）而非「把非显示命中算进分子」（&gt;100%）。
     *  显示链路必须显式传 {@link ImageLoadChain#DISPLAY}。 */
    public byte[] loadBytesCachedFirst(String url) throws IOException {
        return loadBytesCachedFirst(url, ImageLoadChain.NON_DISPLAY);
    }

    /**
     * {@link #loadFileCachedFirst(String)} 的字节形态，<b>带链路归属</b>（#984）。
     *
     * <p>本方法是显示、预取、作品导出三条链路的<b>唯一共用入口</b>
     * （{@code PictelioImageService} 的显示与预取两处 + {@code NovelPdfEncoder} 一处），
     * 方法名无法区分链路，故归属必须由调用方显式声明，见 {@link ImageLoadChain}。
     *
     * @param chain 本次加载的链路归属；决定磁盘命中/未命中是否计入命中率分子，不影响缓存读写行为
     */
    public byte[] loadBytesCachedFirst(String url, ImageLoadChain chain) throws IOException {
        File cached = cachedFile(url);
        if (cached != null) {
            recordDiskHit(chain);
            return readAll(touchOnHit(cached));
        }
        Object lock = urlLocks.computeIfAbsent(url, k -> new Object());
        synchronized (lock) {
            cached = cachedFile(url);
            if (cached != null) {
                recordDiskHit(chain);
                return readAll(touchOnHit(cached));
            }
            recordDiskMiss(chain);
            byte[] bytes = download(url);
            writeFile(new File(getCacheDir(), cacheFileName(url)), bytes);
            enforceCacheLimit();
            return bytes;
        }
    }

    // ── 淘汰（对齐 ImageCachePlugin.enforceCacheLimit） ────────

    /**
     * 原子写盘（B5/诊断 F3）：先写同目录临时文件，成功后 rename 原子替换目标。
     * 直接 FileOutputStream(目标) 时，prefetchImage 与拦截链路并发写同一文件可能
     * 交错产生截断文件，而 cachedFile 仅查 exists+length>0，截断文件会被当命中
     * 持久返回坏图。失败路径清理 tmp 并上抛，目标保持原内容不被半截写入污染。
     * 包可见：预取与拦截链路共享同一写盘纪律。
     */
    static void writeFile(File file, byte[] bytes) throws IOException {
        File tmp = new File(file.getAbsolutePath() + ".tmp");
        synchronized (CACHE_DIR_MUTATION_LOCK) {
            try {
                try (FileOutputStream fos = new FileOutputStream(tmp)) {
                    fos.write(bytes);
                    fos.flush();
                }
                if (!tmp.renameTo(file)) {
                    // 个别文件系统的 rename 不覆盖已存在目标：先删旧目标再重试一次
                    if (file.exists() && !file.delete()) {
                        throw new IOException("无法删除旧缓存文件: " + file);
                    }
                    if (!tmp.renameTo(file)) {
                        throw new IOException("rename 失败: " + tmp + " -> " + file);
                    }
                }
            } catch (IOException e) {
                if (!tmp.delete()) {
                    Log.w(TAG, "tmp 清理失败（留待容量淘汰/清空缓存回收）: " + tmp);
                }
                throw e;
            }
        }
    }

    // ── 清空（#984）：只删图片缓存目录的内容 ──────────────────

    /**
     * 清空<b>磁盘缓存目录的内容</b>（#984）——用户主动「清理图片缓存」的磁盘侧。
     *
     * <h3>⚠️ 不可逆风险：本方法只允许删图片缓存目录里的条目</h3>
     * {@code context.getCacheDir()} 下有<b>五个同级目录</b>，只有第一个是本类的职责范围：
     * <pre>
     *   cacheDir/
     *   ├── pictelio-images            ← 本方法唯一的删除对象
     *   ├── pictelio_translate_cache   ← 用户的翻译成果（删除需重新翻译，可能重新计费）
     *   ├── ugoira/&lt;illustId&gt;/      ← 动图帧解压产物
     *   ├── pictelio-novel-export      ← 可能正有进行中的作品导出
     *   └── pictelio-ugoira-export    ← 同上
     * </pre>
     * <b>因此本方法的实现被刻意写成「逐条删目录内的子项」，绝不 {@code delete()} 目录本身、
     * 更不碰父目录</b>——目录被删后下一次 {@link #getCacheDir()} 会重新创建，但若哪天有人
     * 把锚点改成 {@code new File(context.getCacheDir(), "..")} 或直接删父目录，
     * 上面四个兄弟目录会一起消失（翻译成果重译 + 导出中断）。防线是
     * {@code ImageCacheClearScopeTest}：清理后逐个核对那四个目录的内容与文件数不变。
     *
     * <p><b>不做递归删除</b>：缓存条目按约定是扁平文件（{@link #keyToFilename}），
     * 若目录里出现子目录（异常残留），{@code File.delete()} 会因非空而失败 →
     * 计入 {@link ImageCacheClearResult#failed()} 并告警，而不是递归进去——
     * 递归删除是「删多了一层」这类事故的典型写法，这里显式拒绝。
     *
     * <p><b>与启动清理的关系</b>：{@link #trimAtStartup()} 是<b>容量管理</b>（超限才淘汰、
     * 保留最近使用的），本方法是<b>用户显式清空</b>（全删）。两者语义不同，不得互相替代，
     * 也不得把本方法挂在启动/写入路径上自动触发（#984 拍板：清理只由设置页按钮触发）。
     *
     * <p><b>不静默降级</b>：目录不可读 → 记 Log.w 并返回 {@code failed=true}；
     * 单条删不掉 → 逐条 Log.w 并计入 {@code failed}。
     */
    public ImageCacheClearResult clearDiskCache() {
        File cacheDir = getCacheDir();
        File[] files = cacheDir.listFiles();
        if (files == null) {
            Log.w(TAG, "缓存目录不可读，磁盘层清理失败: " + cacheDir);
            return ImageCacheClearResult.NOTHING;
        }
        long freed = 0L;
        long deleted = 0L;
        boolean failed = false;
        // 与写盘互斥：否则删除可能落在某次写盘的 tmp→目标 rename 中间，把一次后台清理
        // 变成调用方可见的 IOException（见 CACHE_DIR_MUTATION_LOCK）
        synchronized (CACHE_DIR_MUTATION_LOCK) {
            for (File f : files) {
                long size = f.length();
                if (f.delete()) {
                    freed += size;
                    deleted++;
                } else {
                    // 不静默：删不掉必须留痕并让上层知道（可能仍有进行中的导出/保存持有该文件）
                    failed = true;
                    Log.w(TAG, "删除图片缓存条目失败（可能正被使用）: " + f.getName());
                }
            }
        }
        if (failed) {
            Log.w(TAG, "磁盘层清理部分失败：已释放 " + freed + "B，目录 " + cacheDir);
        }
        // 量表立即归零（否则后台读数会停留在清理前的值，直到下一次遍历）
        statsStore().publishDiskUsage(DiskCacheUsage.EMPTY);
        return new ImageCacheClearResult(freed, deleted, failed);
    }

    // ── 升级清空（#985）：只执行一次，存量直接清空不迁移 ──────────

    /**
     * 升级后清空存量图片缓存（#985），<b>恰好执行一次</b>。
     *
     * <h3>为什么需要它</h3>
     * 旧缓存由「写死上限 + 按写入序淘汰 + 内存/磁盘两套键空间」那套策略写下，新版策略接手后
     * 它们既非真相源、又无法说清用户到底在用哪套（ADR-0222 §2.6：<b>存量直接清空、不做迁移</b>）。
     * 缓存删后可从网络重建，故清空后行为与全新安装完全一致。
     *
     * <h3>「只执行一次」的判据</h3>
     * 标记写在<b>数据目录下的 SharedPreferences</b>（{@code shared_prefs/}），内容是已清空到的
     * <b>缓存布局代次</b>（{@link #CACHE_LAYOUT_GENERATION}）。选择落数据目录而非缓存目录的
     * 三个理由：
     * <ol>
     *   <li><b>不能放进图片缓存目录</b>——{@link #clearDiskCache()} 逐条删目录内的全部子项，
     *       标记会被自己清掉，于是每次冷启动都重跑一次；</li>
     *   <li><b>不能作为 cacheDir 的兄弟文件</b>——{@code getCacheDir()} 会被系统在存储紧张时
     *       回收，标记随之消失，用户重新缓存的图会在下次冷启动被无谓清掉；</li>
     *   <li><b>不用 versionCode 比大小</b>——降级安装、跳版升级、市场回滚下版本号与
     *       「存量是否已清过」会分叉（见常量注释）。</li>
     * </ol>
     *
     * <h3>与清理入口复用同一条路径（票面硬要求）</h3>
     * 本方法<b>不实现任何删除逻辑</b>：唯一的删除动作是调用 {@link #clearDiskCache()}——
     * 与用户手动「清理图片缓存」（#984 桥接模块 {@code PictelioImageCacheModule}）走同一方法。
     * 因此「只删图片缓存目录内的子项、绝不删目录本身、绝不碰父目录与四个兄弟目录、显式拒绝递归」
     * 这套锚定纪律对升级清空同样成立，且由 {@code ImageCacheClearScopeTest} 与本票的
     * {@code ImageCacheUpgradePurgeTest} 共同钉死。
     *
     * <h3>与 {@link #trimAtStartup()} 的关系：语义不同，不得互相替代</h3>
     * {@code trimAtStartup} 是<b>容量管理</b>（超限才淘汰、保留最近被用过的条目，每次冷启动都跑）；
     * 本方法是<b>存量处置</b>（全删、只跑一次）。二者触发时机、判定条件、目的都不同，
     * 启动时按「先存量清空、后容量回收」的顺序各跑一次。
     *
     * <h3>失败不静默、也不假装清过</h3>
     * 清空失败（目录不可读 / 有条目删不掉）时记 {@code Log.w} 且<b>不写标记</b>——
     * 下次冷启动自动重试，绝不出现「标记说清过了、实际还剩半截旧缓存」的状态。
     *
     * <p><b>阻塞 IO</b>：内部遍历目录并逐条 {@code delete()}，调用方<b>须放后台线程</b>
     * （{@code PictelioAppLynx} 已挂在缓存维护执行器上）。
     *
     * @return 本次是否<b>执行了</b>清空动作（{@code false} = 本代次早已清过、无需再跑）。
     *         注意：返回 {@code true} 只代表「动作已执行」，成败以日志与是否落标记为准
     *         （目录不可读时目录仍为空，从结果上与成功清空不可区分，故不以此返回值冒充成败）。
     */
    public boolean purgeLegacyCacheOnUpgrade() {
        SharedPreferences prefs = context.getSharedPreferences(UPGRADE_PREFS_NAME, Context.MODE_PRIVATE);
        if (CACHE_LAYOUT_GENERATION.equals(prefs.getString(KEY_PURGED_GENERATION, null))) {
            return false;
        }
        ImageCacheClearResult result = clearDiskCache();
        if (result.failed()) {
            // 不落标记 ⇒ 下次冷启动重试；显式告警，不静默吞掉也不谎报「已清过」
            Log.w(TAG, "升级清空存量图片缓存未完全成功，本次不落标记、下次冷启动重试: " + result);
            return true;
        }
        prefs.edit().putString(KEY_PURGED_GENERATION, CACHE_LAYOUT_GENERATION).apply();
        Log.i(TAG, "升级已清空存量图片缓存（不迁移），清空结果: " + result);
        return true;
    }

    /**
     * 调度冷启动缓存维护（#985 + #978）——<b>全仓唯一调用点</b>在 {@code PictelioAppLynx.onCreate}。
     *
     * <p>顺序刻意为「先存量清空（#985，只一次、全删、不迁移），后容量回收（#978，每次冷启动、
     * 超限才淘汰）」：两者语义不同、缺一不可；先清空则本轮容量回收无事可做。
     *
     * <h3>为什么维护期间要关闸</h3>
     * 存量清空是<b>一次性全删</b>，若与并发的缓存访问交错，用户会看到实打实的故障：
     * 写盘侧 tmp 被删 → rename 失败 → 「保存到相册」报错；读盘侧刚拿到的文件被删 →
     * {@code FileNotFoundException}。二者都<b>不是缓存该有的语义</b>（缓存只是加速层，
     * 条目随时可重建），故让缓存访问在 {@link #getCacheDir()} 处等维护结束，
     * 而不是各自去容忍这些故障。
     *
     * <p>执行器由调用方传入（{@code PictelioAppLynx} 传 #978 已有的 {@code TRIM_EXECUTOR}）：
     * 维护是阻塞 IO 且与首屏无关，<b>不新开常驻线程</b>；关闸在<b>提交前</b>完成，
     * 故提交之后的任何缓存访问都能看见它。
     */
    public void scheduleStartupCacheMaintenance(Executor executor) {
        final CountDownLatch gate = new CountDownLatch(1);
        startupMaintenanceGate = gate;
        executor.execute(() -> {
            startupMaintenanceThread = Thread.currentThread();
            try {
                purgeLegacyCacheOnUpgrade();
                trimAtStartup();
            } catch (Throwable t) {
                Log.w(TAG, "启动缓存维护失败（不阻断启动）", t);
            } finally {
                gate.countDown();
            }
        });
    }

    /**
     * 等冷启动缓存维护结束（见 {@link #scheduleStartupCacheMaintenance}）。
     *
     * <p>三种情况直接放行：闸门本就开着（从未调度）、调用方就是维护线程自身、
     * 或被中断。等待<b>有兜底超时</b>且超时记 Log.w——不让一个后台任务把启动永久卡住，
     * 也<b>不静默</b>（超时是异常路径，必须留痕）。
     */
    private static void awaitStartupCacheMaintenance() {
        CountDownLatch gate = startupMaintenanceGate;
        if (gate.getCount() == 0L || Thread.currentThread() == startupMaintenanceThread) {
            return;
        }
        try {
            if (!gate.await(STARTUP_MAINTENANCE_WAIT_SECONDS, TimeUnit.SECONDS)) {
                Log.w(TAG, "等待启动缓存维护超时（继续；缓存非真相源，最坏只是多留一次旧条目）");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /**
     * 启动清理（#978）：<b>不依赖任何写入</b>地执行一次容量淘汰。
     *
     * <p>存在理由：淘汰原先只在写入后触发，于是「长期不写入但早已超限」的存量缓存
     * 在整个使用期内都不会被回收（用户不翻新的图就一直占着盘）。
     * 本入口由 Application 冷启动调用一次，把淘汰触发点从「仅写入后」扩为「启动时 + 写入后」。
     *
     * <p>与 #986 协同：清理按<b>当期</b>预算（{@link #maxCacheBytesSupplier}）判定超限，
     * 故存储紧张导致上限收缩后，存量超限缓存在这里被回收——复用同一条淘汰路径，不另实现。
     *
     * <p>失败路径<b>不静默</b>：目录不可读时记 Log.w 并跳过（不阻断启动）。
     */
    public void trimAtStartup() {
        try {
            enforceCacheLimit();
        } catch (Throwable t) {
            Log.w(TAG, "启动清理图片缓存失败（不阻断启动）", t);
        }
    }

    /**
     * 容量淘汰：超限时按<b>访问</b>时间升序（最久未用在前）逐个删除，直到回到上限。
     *
     * <p>排序键即文件 mtime，但语义已由「最后<b>写</b>下」转为「最后被<b>用过</b>」——
     * 命中路径 {@link #touchOnHit} 会刷新它（#978）。未命中过的新条目 mtime 等于写入时刻，
     * 与 LRU 语义一致。
     *
     * <p>上限来源为 {@link #maxCacheBytesSupplier}（#986：按当期可用存储比例计算），
     * <b>本方法即唯一的删除实现</b>：写入后与启动清理两个触发点共用它——上限收缩时
     * 超限条目按同一访问时间序被回收，不存在第二套删除逻辑。
     */
    private void enforceCacheLimit() {
        File cacheDir = getCacheDir();
        File[] files = cacheDir.listFiles();
        if (files == null) {
            // 不静默：目录不可读时告警（本轮跳过淘汰，下一个写入/启动点会重试）
            Log.w(TAG, "缓存目录不可读，本轮跳过淘汰: " + cacheDir);
            return;
        }
        long maxCacheBytes = maxCacheBytesSupplier.getAsLong();
        long total = 0;
        for (File f : files) {
            total += f.length();
        }
        // #983：本次遍历已把「条目数 + 占用字节数」算出来了，顺手发布给统计层——
        // 写入路径本来就要遍历目录，这样<b>不新增任何 IO</b>，热路径代价仅两次赋值。
        // 读数取自<b>本次遍历时刻</b>（即淘汰前）；淘汰后的准确值由 {@link #diskUsage()} 现算，
        // 快照读取走的就是后者，故这里只是让后台量表不至于长期停留在 0。
        statsStore().publishDiskUsage(new DiskCacheUsage(files.length, total));
        if (total <= maxCacheBytes) {
            return;
        }
        // 按访问时间升序（最久未用在前），逐个删除直到低于上限（#978：语义由写入序改为访问序）
        Arrays.sort(files, Comparator.comparingLong(File::lastModified));
        // 与写盘互斥（见 CACHE_DIR_MUTATION_LOCK）：淘汰也是删除方，同样不得落在 rename 中间
        synchronized (CACHE_DIR_MUTATION_LOCK) {
            for (File f : files) {
                if (total <= maxCacheBytes) {
                    break;
                }
                total -= f.length();
                if (!f.delete()) {
                    Log.w(TAG, "淘汰缓存文件失败: " + f.getName());
                }
            }
        }
    }

    private static byte[] readAll(File file) throws IOException {
        try (FileInputStream fis = new FileInputStream(file);
             ByteArrayOutputStream bos = new ByteArrayOutputStream()) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = fis.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        }
    }
}
