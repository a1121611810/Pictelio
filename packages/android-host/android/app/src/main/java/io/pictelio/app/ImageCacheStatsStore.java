package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Supplier;

/**
 * 图片缓存统计的采集与持久化（#983）——把内存层（内建计数）、磁盘层（自计）与
 * 请求总数合成一张 {@link ImageCacheStats} 快照，并让累计量跨进程重启延续。
 *
 * <h3>热路径性能：只自增内存、攒够一批才落盘</h3>
 * 统计采集在图片加载热路径上，<b>绝不能每命中一次就同步写一次存储</b>——
 * {@code SharedPreferences.edit().apply()} 每次都要序列化整份 XML 并做一次内存拷贝，
 * 按每秒 30 次滚动命中计就是每秒 30 次无谓开销，会直接掉帧。本类的做法：
 * <ol>
 *   <li><b>记录</b>只做 {@link AtomicLong#incrementAndGet()}（纳秒级、无锁竞争、
 *       不分配对象），并累加一个待落盘事件数；</li>
 *   <li>待落盘事件数达到 {@link #FLUSH_THRESHOLD} 才 {@link #flush()} 一次，
 *       即最坏情况下每 {@value #FLUSH_THRESHOLD} 个事件才付一次落盘代价；</li>
 *   <li>{@link #flush()} 用 {@code apply()}（异步落盘、内存镜像立即一致，
 *       读侧永不读到旧值），<b>不占</b>热路径线程；</li>
 *   <li>读取快照（{@link #snapshot}）与显式 {@link #flush()} 本身也顺带落盘，
 *       故「刚被读到就一定已持久」。</li>
 * </ol>
 * <p><b>已知代价（不掩盖）</b>：进程被<b>强杀</b>时，最后不足
 * {@value #FLUSH_THRESHOLD} 个事件的增量会丢失（最多 {@value #FLUSH_THRESHOLD}-1 个）。
 * 这是为了不掉帧而做的<b>明确取舍</b>——相对一次会话数百上千次加载，它是千分之几量级的
 * 低估；反过来「每次命中同步落盘」是把可见精度换成掉帧，本仓不接受。
 * 应用后台/退出时若需零损失，调用 {@link #flush()} 即可（下一张票的清理入口在写操作前会做）。
 *
 * <h3>持久化介质：<b>独立</b>的 SharedPreferences</h3>
 * 刻意<b>不复用</b> {@code "WSSecureStorageSharedPreferences"}（{@link SecureStorageCompat}
 * 的 ADR-0050 存量用户数据：一字不改的密文格式契约），也<b>不</b>复用图床配置所在的
 * {@code "CapacitorStorage"}。理由三条，任一条独立成立：
 * <ol>
 *   <li><b>存量格式零风险</b>：存量文件的 key 一律带 {@code capacitor-storage_} 前缀、
 *       值是 {@code Base64(ciphertext)+分隔符+Base64(iv)} 密文。把明文计数塞进去，
 *       一旦日后有人对该文件做「遍历迁移/加密」就会误伤这些明文 key，
 *       而 ADR-0050 明确要求该格式一字不改；独立文件名即物理隔离。</li>
 *   <li><b>生命周期不搭车</b>：存量文件的生命周期绑在 Keystore 密钥轮换上（密钥失效 → 读不出来），
 *       统计是无密钥的纯计数，不该继承那条生命周期。</li>
 *   <li><b>可丢弃</b>：统计是诊断量，丢了不影响任何用户数据；独立文件让「清统计」
 *       与「清缓存」各自独立，且将来若决定不再采集，直接删文件即可，不牵动存量。</li>
 * </ol>
 *
 * <p><b>不静默降级</b>：读存量字段遇类型异常（XML 损坏/被外部改写）记 {@code Log.w}
 * 并按 0 起算；写失败由 {@code apply()} 自身的返回语义处理（内存镜像始终一致）。
 */
public final class ImageCacheStatsStore {

    private static final String TAG = "ImageCacheStatsStore";

    /**
     * 持久化文件名（#983，<b>独立于存量格式契约</b>；理由见类注释）。
     *
     * <p>刻意<b>不是</b> {@link SecureStorageCompat#PREFS_NAME}，也不是图床配置所在的
     * {@code "CapacitorStorage"}——那两处的键空间属于 ADR-0050 存量用户数据，一字不改。
     */
    public static final String PREFS_NAME = "pictelio-image-cache-stats";

    private static final String KEY_REQUESTS = "total_requests";
    private static final String KEY_MEMORY_HITS = "total_memory_hits";
    private static final String KEY_DISK_HITS = "total_disk_hits";
    private static final String KEY_DISK_MISSES = "total_disk_misses";

    /** 批量落盘阈值（事件数）：攒够这么多事件才写一次存储，见类注释「热路径性能」 */
    static final int FLUSH_THRESHOLD = 32;

    private static volatile ImageCacheStatsStore instance;

    private final SharedPreferences prefs;
    /** 跨进程累计量：构造时读入存量，之后在内存里自增 */
    private final AtomicLong requests = new AtomicLong();
    private final AtomicLong memoryHits = new AtomicLong();
    private final AtomicLong diskHits = new AtomicLong();
    private final AtomicLong diskMisses = new AtomicLong();
    /** 内存层已并入 {@link #memoryHits} 的命中读数（LruCache 内建计数是进程内单调量，取差即增量） */
    private final AtomicLong syncedMemoryHits = new AtomicLong();
    /** 自上次落盘以来累计的事件数（达到 {@link #FLUSH_THRESHOLD} 触发一次 flush） */
    private final AtomicInteger pendingEvents = new AtomicInteger();
    /** 磁盘层占用量表（最近一次 {@link #publishDiskUsage} 的读数；不持久化） */
    private volatile DiskCacheUsage diskUsage = DiskCacheUsage.EMPTY;
    /**
     * 内存层取用口（#983）：由 {@code PictelioImageService} 装一次。
     *
     * <p>有了它，任何时机落盘（阈值触发 / 读快照 / 显式 flush）都能读到<b>最新</b>的
     * 内建命中计数，不必依赖调用方「记得先取一次快照」——那正是本次实现踩到的坑。
     */
    private volatile Supplier<ImageMemoryCache> memoryLayerSource;

    /**
     * 进程级单例（多线程安全的双重检查）。
     *
     * <p>必须单例：磁盘层的多个 {@link PixivImageLoader} 实例（服务常驻实例、
     * 启动清理实例、测试实例）若各持一份累计量，命中率会被按实例数重复计数。
     *
     * @param app 任一 Context（内部取 applicationContext 避免持有 Activity）
     * @throws NullPointerException {@code app} 为 null——那是调用点没初始化，不是可降级的情形
     */
    public static ImageCacheStatsStore get(Context app) {
        if (app == null) {
            throw new NullPointerException("ImageCacheStatsStore.get 需要非空 Context（服务未 onInitialize？）");
        }
        ImageCacheStatsStore local = instance;
        if (local != null) {
            return local;
        }
        synchronized (ImageCacheStatsStore.class) {
            if (instance == null) {
                Context context = app.getApplicationContext();
                instance = new ImageCacheStatsStore(
                        context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE));
            }
            return instance;
        }
    }

    /** 包可见构造（测试缝）：直接绑定一份 prefs，用于造出「同介质、第二个进程」的实例 */
    ImageCacheStatsStore(SharedPreferences prefs) {
        this.prefs = prefs;
        this.requests.set(readLong(KEY_REQUESTS));
        this.memoryHits.set(readLong(KEY_MEMORY_HITS));
        this.diskHits.set(readLong(KEY_DISK_HITS));
        this.diskMisses.set(readLong(KEY_DISK_MISSES));
    }

    /** 包可见测试缝：清掉进程级单例（各 Robolectric 用例之间彼此隔离） */
    static void resetSingletonForTest() {
        synchronized (ImageCacheStatsStore.class) {
            instance = null;
        }
    }

    /** 读存量累计值；字段类型异常（XML 被改写/损坏）不静默——Log.w 后按 0 起算 */
    private long readLong(String key) {
        try {
            return prefs.getLong(key, 0L);
        } catch (ClassCastException e) {
            Log.w(TAG, "统计存量字段类型异常，按 0 起算: " + key, e);
            return 0L;
        }
    }

    // ── 采集（热路径：只做内存自增）─────────────────────────

    /**
     * 记一次<b>图片加载请求</b>（{@link ImageCacheStats#requests()} 的分母）。
     *
     * <p>调用点唯一：{@code PictelioImageService.deliver}，即每次真正进入内存层探测时。
     * 预取 / zip / 拦截链路<b>不</b>调本方法（它们不是图片加载请求，见 {@link ImageCacheStats} 口径）。
     */
    public void recordRequest() {
        bump(requests);
    }

    /**
     * 记一次磁盘层命中（该次加载由缓存条目供给，未触网络）。
     *
     * <p><b>口径闸门（#984）</b>：只有 {@link ImageLoadChain#DISPLAY}（显示链路）
     * 才计入分子。预取 / zip / 保存 / 导出链路的命中<b>不计入</b>——分母本就只数显示链路，
     * 分子若含非显示链路，命中率会算出 &gt;100% 的荒谬值。归属判定是唯一决策点，不在调用方散落。
     */
    public void recordDiskHit(ImageLoadChain chain) {
        if (chain != ImageLoadChain.DISPLAY) {
            return;
        }
        bump(diskHits);
    }

    /**
     * 记一次磁盘层未命中（该次加载需要发起网络下载）。
     *
     * <p>口径闸门同 {@link #recordDiskHit(ImageLoadChain)}：非显示链路不计入。
     */
    public void recordDiskMiss(ImageLoadChain chain) {
        if (chain != ImageLoadChain.DISPLAY) {
            return;
        }
        bump(diskMisses);
    }

    private void bump(AtomicLong counter) {
        counter.incrementAndGet();
        if (pendingEvents.incrementAndGet() >= FLUSH_THRESHOLD) {
            flush();
        }
    }

    /**
     * 发布磁盘层占用量表（条目数 / 字节数）。
     *
     * <p>产出点：{@link PixivImageLoader#diskUsage()}（读取时求值）与
     * {@code enforceCacheLimit}（每次写入本来就要 listFiles，顺手把已算出的数带出来，
     * 不额外增加任何 IO）。
     */
    public void publishDiskUsage(DiskCacheUsage usage) {
        this.diskUsage = usage;
    }

    // ── 读取与落盘 ───────────────────────────────────────────

    /**
     * 合成统计快照（即对外读取契约），并<b>顺带落盘</b>。
     *
     * <p>「读到即已持久」是这里刻意保证的不变式：调用方（清理入口展示、诊断页）读到的
     * 数值此刻必定已写入介质，不依赖阈值是否凑满。
     *
     * @param memoryLayer 内存层；{@code null} 表示尚未拿到（回退到 {@link #attachMemoryLayer}
     *                    装的口，再取不到则内存侧读数全记 0，不静默捏造）
     * @param usage       磁盘层占用量表；{@code null} 表示磁盘层尚未创建，
     *                    此时回退用最近一次 {@link #publishDiskUsage} 的读数
     */
    public ImageCacheStats snapshot(ImageMemoryCache memoryLayer, DiskCacheUsage usage) {
        ImageMemoryCache mem = memoryLayer != null ? memoryLayer : attachedMemoryLayer();
        syncMemoryHits(mem);
        DiskCacheUsage disk = usage != null ? usage : diskUsage;
        ImageCacheStats stats = new ImageCacheStats(
                requests.get(),
                memoryHits.get(),
                mem == null ? 0L : mem.memoryMisses(),
                mem == null ? 0L : mem.memoryEvictions(),
                mem == null ? 0L : mem.size(),
                mem == null ? 0L : mem.totalBytes(),
                diskHits.get(),
                diskMisses.get(),
                disk.entries(),
                disk.bytes());
        flush();
        return stats;
    }

    /**
     * 安装内存层取用口（#983）：使落盘路径在<b>任何时机</b>都能读到最新的内建命中计数。
     *
     * <p>内存层的计数住在 {@link LruCache} 里（不另造影子计数器），而落盘发生在采集器
     * 内部——若不装这个口，阈值触发的落盘就拿不到内存层计数，内存命中会滞后到下次读快照
     * 才补上（实测踩过：flush 落盘的是上一次同步时的旧值）。装口后该滞后不存在。
     *
     * <p>幂等：重复安装只是覆盖引用，无副作用。
     */
    public void attachMemoryLayer(Supplier<ImageMemoryCache> source) {
        this.memoryLayerSource = source;
    }

    private ImageMemoryCache attachedMemoryLayer() {
        Supplier<ImageMemoryCache> source = memoryLayerSource;
        return source == null ? null : source.get();
    }

    /**
     * 把内存层<b>内建</b>命中计数并入跨进程累计量。
     *
     * <p>不是影子计数：{@link LruCache} 的命中计数是进程内单调量，故
     * 「本次新增 = 当前读数 − 上次并入读数」，读数本身始终来自容器内部计数器。
     * 内存层计数每次进程重启归零（内存层本就是易失的），跨进程的累计由本方法补齐。
     */
    private void syncMemoryHits(ImageMemoryCache memoryLayer) {
        if (memoryLayer == null) {
            return;
        }
        long current = memoryLayer.memoryHits();
        long delta = current - syncedMemoryHits.get();
        if (delta > 0) {
            memoryHits.addAndGet(delta);
            syncedMemoryHits.set(current);
        }
    }

    /**
     * 落盘（{@code apply()} 异步写、内存镜像立即一致，不阻塞调用线程）。
     *
     * <p>读快照（{@link #snapshot}）之后调用方若要保证零损失，应显式调一次本方法。
     */
    public void flush() {
        syncMemoryHits(attachedMemoryLayer());
        pendingEvents.set(0);
        prefs.edit()
                .putLong(KEY_REQUESTS, requests.get())
                .putLong(KEY_MEMORY_HITS, memoryHits.get())
                .putLong(KEY_DISK_HITS, diskHits.get())
                .putLong(KEY_DISK_MISSES, diskMisses.get())
                .apply();
    }

    /**
     * 统计清零（下一张票「清理入口」在用户主动清缓存时一并调用）。
     *
     * <p>内存层侧：{@code syncedMemoryHits} 对齐到<b>当前</b>内建计数，
     * 故清零后只统计清零之后新发生的命中，<b>不会把本进程已累计的命中倒算回来</b>
     * （内建计数是只增的、无法回退，这是唯一正确的对齐方式）。
     */
    public void reset(ImageMemoryCache memoryLayer) {
        requests.set(0);
        diskHits.set(0);
        diskMisses.set(0);
        memoryHits.set(0);
        syncedMemoryHits.set(memoryLayer == null ? 0L : memoryLayer.memoryHits());
        diskUsage = DiskCacheUsage.EMPTY;
        flush();
    }
}