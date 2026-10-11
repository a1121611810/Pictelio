package io.pictelio.app;

/**
 * 图片磁盘缓存预算（#986）：磁盘缓存上限 = <b>可用存储 × 比例</b>，钳制在固定区间。
 *
 * <p>取代此前的写死常量 {@code OAuthConfig.CACHE_MAX_BYTES}（300MB）——固定值在
 * 「存储紧张」与「存储充裕」两类设备上都是错的：前者挤占用户可用空间，后者又留不满缓存。
 *
 * <p><b>本类刻意是纯计算</b>：入参只有「可用存储字节数」，不依赖 {@code Context}／
 * {@code StatFs}。存储探测在 {@link PixivImageLoader} 侧（IO 边界），比例与钳制在这里
 * （可被纯 JVM 单测直接验证，见 {@code DiskCacheBudgetTest}）。
 *
 * <p><b>比例与钳制区间的一手出处</b>：Coil 3.6.3
 * {@code coil-core/src/commonMain/kotlin/coil3/disk/DiskCache.kt}（Builder，已逐行核对）：
 * <pre>
 * private var maxSizePercent = 0.02                          // 2%
 * private var minimumMaxSizeBytes = 10L * 1024 * 1024         // 10MB
 * private var maximumMaxSizeBytes = 250L * 1024 * 1024        // 250MB
 * // build()：
 * val size = maxSizePercent * fileSystem.remainingFreeSpaceBytes(directory)
 * size.toLong().coerceIn(minimumMaxSizeBytes, maximumMaxSizeBytes)
 * </pre>
 * 三处沿用、含 {@code toLong()} 的截断语义；<b>与 Coil 的一处刻意差异</b>：Coil 探测失败时
 * 静默取下界，本仓要求兜底路径显式告警（测试硬约束 #3），故告警放在
 * {@link PixivImageLoader} 的探测侧，本类只负责数值契约。
 *
 * <p>取 Coil 区间而非自拟的理由：2% 让「8GB 可用 → 160MB」这类常见机型落在区间内按比例浮动，
 * 而 10MB 下界保证存储将尽时仍能留住一个可用的浏览缓存，250MB 上界保证 128GB+ 机型
 * 不会把 {@code cacheDir} 撑到数 GB（该目录本就该被系统在存储压力下回收，不该长期占着）。
 */
public final class DiskCacheBudget {

    /** 可用存储占比 2%（Coil {@code maxSizePercent}） */
    public static final double STORAGE_RATIO = 0.02d;

    /** 下界 10MB（Coil {@code minimumMaxSizeBytes}）：可用存储不足 500MB 时取此值 */
    public static final long MIN_BYTES = 10L * 1024 * 1024;

    /** 上界 250MB（Coil {@code maximumMaxSizeBytes}）：可用存储超过约 12.2GB 时取此值 */
    public static final long MAX_BYTES = 250L * 1024 * 1024;

    private DiskCacheBudget() {
    }

    /**
     * 可用存储字节 → 磁盘缓存上限字节，恒落在 [{@link #MIN_BYTES}, {@link #MAX_BYTES}]。
     *
     * <p>非正入参（存储探测失败/读不到）⇒ 取下界：上限为 0 会让<b>每次写入</b>都触发
     * 全量淘汰（比占一点盘更糟），下界保证最坏情况下仍有可用的浏览缓存。
     *
     * @param availableBytes 缓存目录所在卷的可用字节数（{@code <= 0} 表示未知）
     * @return 磁盘缓存上限字节数（> 0）
     */
    public static long computeMaxBytes(long availableBytes) {
        if (availableBytes <= 0) {
            return MIN_BYTES;
        }
        // 先乘后取整：availableBytes 最大约 9.2e18，×0.02 后仍远小于 long 上限，不会溢出
        long budget = (long) (availableBytes * STORAGE_RATIO);
        return Math.min(Math.max(budget, MIN_BYTES), MAX_BYTES);
    }
}
