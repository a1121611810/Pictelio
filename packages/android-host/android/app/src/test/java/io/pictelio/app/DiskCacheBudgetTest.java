package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * 图片磁盘缓存预算（#986）纯 JVM 单测——上限 = 可用存储 × 比例，钳制在固定区间。
 *
 * <p>被测缝：{@link DiskCacheBudget#computeMaxBytes(long)}（纯计算，入参只有可用存储字节数），
 * 不触 {@code StatFs}／{@code Context}，故可在纯 JVM 下验证——这正是把容量算法与存储 API
 * 拆开的目的（docs/testing/conventions.md 强制约束 #1 的 IO 边界由 PixivImageLoader 侧用例覆盖）。
 *
 * <p><b>期望值出处（强制约束 #5 oracle 溯源）</b>：比例与钳制上下界的 oracle 是
 * <b>Coil 3.6.3 源码</b>（{@code coil-core/src/commonMain/kotlin/coil3/disk/DiskCache.kt}）：
 * <pre>
 * private var maxSizePercent = 0.02            // 2%
 * private var minimumMaxSizeBytes = 10L * 1024 * 1024   // 10MB
 * private var maximumMaxSizeBytes = 250L * 1024 * 1024  // 250MB
 * val size = maxSizePercent * fileSystem.remainingFreeSpaceBytes(directory)
 * size.toLong().coerceIn(minimumMaxSizeBytes, maximumMaxSizeBytes)
 * </pre>
 * 用例断言的是「按该公式应得的字节数」与「恒在钳制区间内」两条性质，
 * <b>不</b>从被测实现反推（期望值手写字面量，见各用例注释）。
 */
public class DiskCacheBudgetTest {

    /** 10MB 下界（Coil {@code minimumMaxSizeBytes}） */
    private static final long MIN = 10L * 1024 * 1024;
    /** 250MB 上界（Coil {@code maximumMaxSizeBytes}） */
    private static final long MAX = 250L * 1024 * 1024;

    /**
     * 不同可用存储 ⇒ 不同上限（核心验收条件）。
     *
     * <p>字面量 = 可用字节 × 2%（Coil 比例），三个输入分处 [1G, 2G, 8G]，
     * 均落在钳制区间内（故期望值 = 纯比例值，未被上下界截断）：
     * 1G→20MB、2G→40MB、8G→160MB（递增且严格小于 250MB 上界）。
     */
    @Test
    public void computeMaxBytes_moreAvailableSpace_largerBudget() {
        assertEquals(20_000_000L, DiskCacheBudget.computeMaxBytes(1_000_000_000L));
        assertEquals(40_000_000L, DiskCacheBudget.computeMaxBytes(2_000_000_000L));
        assertEquals(160_000_000L, DiskCacheBudget.computeMaxBytes(8_000_000_000L));
    }

    /** 比例口径：可用存储翻倍 ⇒ 上限同步翻倍（未触钳制时严格线性） */
    @Test
    public void computeMaxBytes_doublesAvailableSpace_doublesBudget() {
        long one = DiskCacheBudget.computeMaxBytes(3_000_000_000L);
        long two = DiskCacheBudget.computeMaxBytes(6_000_000_000L);
        assertEquals(one * 2, two);
    }

    /**
     * 存储紧张 ⇒ 压到下界 10MB（100MB 可用 × 2% 仅 2MB，低于 10MB 下界）。
     */
    @Test
    public void computeMaxBytes_tightStorage_clampsToMin() {
        assertEquals(MIN, DiskCacheBudget.computeMaxBytes(104_857_600L)); // 100MB → 2MB
    }

    /**
     * 存储充裕 ⇒ 压到上界 250MB（64GiB 可用 × 2% ≈ 1.28GiB，远超上界）。
     * 若无上界，128GB+ 机型会得出数 GB 的荒谬上限。
     */
    @Test
    public void computeMaxBytes_abundantStorage_clampsToMax() {
        assertEquals(MAX, DiskCacheBudget.computeMaxBytes(68_719_476_736L)); // 64GiB
    }

    /**
     * 全域不变量：任意输入（含 0 / 负数 / Long.MAX_VALUE / 抽样扫描）恒落在 [10MB, 250MB]。
     */
    @Test
    public void computeMaxBytes_anyInput_withinClampRange() {
        long[] inputs = {
                0L, -1L, Long.MIN_VALUE, 1L, 999L, 1024L,
                104_857_600L, 1_073_741_824L, 8_589_934_592L,
                107_374_182_400L, Long.MAX_VALUE,
        };
        for (long in : inputs) {
            long budget = DiskCacheBudget.computeMaxBytes(in);
            assertTrue("输入 " + in + " → " + budget + " 超出下界", budget >= MIN);
            assertTrue("输入 " + in + " → " + budget + " 超出上界", budget <= MAX);
        }
        // 抽样扫描：逐步推进可用空间，确认全程不越界且单调不减
        long previous = 0L;
        for (long available = 0; available <= 40_000_000_000L; available += 1_000_000_000L) {
            long budget = DiskCacheBudget.computeMaxBytes(available);
            assertTrue("可用 " + available + " → " + budget + " 越界", budget >= MIN && budget <= MAX);
            assertTrue("上限应随可用存储单调不减", budget >= previous);
            previous = budget;
        }
    }

    /**
     * 探测失败（可用字节读不到 = 非正值）⇒ 退回下界，<b>不</b>得出 0 或负上限
     * （0 会让每次写入都触发全量淘汰）。
     * 告警由调用侧（{@link PixivImageLoader} 探测失败路径）发出，此处只钉数值契约。
     */
    @Test
    public void computeMaxBytes_unknownAvailable_fallsBackToMin() {
        assertEquals(MIN, DiskCacheBudget.computeMaxBytes(0L));
        assertEquals(MIN, DiskCacheBudget.computeMaxBytes(-1L));
    }
}
