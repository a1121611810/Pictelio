package io.pictelio.app;

/**
 * 图片两层缓存的可观测统计快照（#983）——不可变值对象，<b>即下一张票（清理入口）的读取契约</b>。
 *
 * <h3>统计口径（写死于此，并由 {@code ImageCacheStatsTest} 钉住）</h3>
 * <ul>
 *   <li><b>分母 {@link #requests()} = 图片加载请求总数</b>：每次进入内存层探测记 1
 *       （{@code PictelioImageService.deliver}，即 Lynx 的 {@code fetchImage} /
 *       {@code decodeImage}）。空 URL（探测前即被拒）不计入。预取 / zip 导出 /
 *       图片拦截链路<b>不计入分母</b>——它们不是「图片加载请求」。</li>
 *   <li><b>分子 {@link #hits()} = {@link #memoryHits()} + {@link #diskHits()}</b>，
 *       即内存层命中数 + 磁盘层命中数（口径由票面写死）。</li>
 *   <li>{@link #hitRate()} = 分子 / 分母；<b>分母为 0 时返回
 *       {@link #NO_SAMPLE_RATE}</b>（不除零、不返回 NaN）。</li>
 * </ul>
 *
 * <p><b>为什么两个命中数可以相加</b>：内存命中与磁盘命中在同一次请求里<b>互斥</b>——
 * 内存命中即当场交付，根本不会走磁盘层。{@link #memoryMisses()} 因此恒等于
 * 「进到磁盘层的请求数」，与 {@link #diskHits()} + {@link #diskMisses()} 的差额
 * 恰为「磁盘层未覆盖到的链路」（预取 / zip / 拦截），这就是本快照<b>不</b>声称
 * {@code requests == memoryHits + diskHits} 的原因。
 *
 * <p><b>累计 vs 量表</b>：{@link #requests()} / {@link #memoryHits()} /
 * {@link #diskHits()} / {@link #diskMisses()} 是<b>跨进程累计量</b>（由
 * {@link ImageCacheStatsStore} 持久化，重启后<b>累加</b>而非归零）；
 * {@link #memoryEntries()} / {@link #memoryBytes()} / {@link #memoryEvictions()}
 * 与 {@link #diskEntries()} / {@link #diskBytes()} 是<b>本进程实时量表</b>
 * （内存层本就是易失的，磁盘层占用每次读取重新求值），不跨进程累积。
 */
public final class ImageCacheStats {

    /** 无样本（{@link #requests()} 为 0）时的命中率取值——不用 NaN/Infinity，避免下游格式化出 "NaN%" */
    public static final double NO_SAMPLE_RATE = 0d;

    private final long requests;
    private final long memoryHits;
    private final long memoryMisses;
    private final long memoryEvictions;
    private final long memoryEntries;
    private final long memoryBytes;
    private final long diskHits;
    private final long diskMisses;
    private final long diskEntries;
    private final long diskBytes;

    ImageCacheStats(long requests, long memoryHits, long memoryMisses, long memoryEvictions,
            long memoryEntries, long memoryBytes, long diskHits, long diskMisses,
            long diskEntries, long diskBytes) {
        this.requests = requests;
        this.memoryHits = memoryHits;
        this.memoryMisses = memoryMisses;
        this.memoryEvictions = memoryEvictions;
        this.memoryEntries = memoryEntries;
        this.memoryBytes = memoryBytes;
        this.diskHits = diskHits;
        this.diskMisses = diskMisses;
        this.diskEntries = diskEntries;
        this.diskBytes = diskBytes;
    }

    // ── 命中率口径 ───────────────────────────────────────────

    /** 分母：图片加载请求总数（跨进程累计） */
    public long requests() {
        return requests;
    }

    /** 分子的一半：内存层命中数（跨进程累计，取自 LRU 容器内建计数器） */
    public long memoryHits() {
        return memoryHits;
    }

    /** 分子的一半：磁盘层命中数（跨进程累计，磁盘层自计） */
    public long diskHits() {
        return diskHits;
    }

    /** 分子 = 内存命中 + 磁盘命中 */
    public long hits() {
        return memoryHits + diskHits;
    }

    /**
     * 命中率 = （内存命中 + 磁盘命中）/ 图片加载请求总数。
     *
     * <p>分母为 0（尚未发生任何图片加载）时返回 {@link #NO_SAMPLE_RATE}。
     */
    public double hitRate() {
        if (requests <= 0) {
            return NO_SAMPLE_RATE;
        }
        return (double) hits() / (double) requests;
    }

    // ── 内存层明细 ───────────────────────────────────────────

    /** 内存层未命中次数（本进程实时，取自 LRU 容器内建计数器） */
    public long memoryMisses() {
        return memoryMisses;
    }

    /** 内存层因容量不足被逐出的次数（本进程实时，口径见 {@link LruCache#evictionCount()}） */
    public long memoryEvictions() {
        return memoryEvictions;
    }

    /** 内存层当前条目数（本进程实时） */
    public long memoryEntries() {
        return memoryEntries;
    }

    /** 内存层当前占用字节数（本进程实时） */
    public long memoryBytes() {
        return memoryBytes;
    }

    // ── 磁盘层明细 ───────────────────────────────────────────

    /** 磁盘层未命中次数（跨进程累计，磁盘层自计） */
    public long diskMisses() {
        return diskMisses;
    }

    /** 磁盘层当前条目数（本进程实时，由 {@link PixivImageLoader#diskUsage()} 求值） */
    public long diskEntries() {
        return diskEntries;
    }

    /** 磁盘层当前占用字节数（本进程实时） */
    public long diskBytes() {
        return diskBytes;
    }

    @Override
    public String toString() {
        return "ImageCacheStats{requests=" + requests
                + ", hits=" + hits() + " (mem=" + memoryHits + ", disk=" + diskHits + ")"
                + ", hitRate=" + hitRate()
                + ", memEvictions=" + memoryEvictions + ", memEntries=" + memoryEntries
                + ", memBytes=" + memoryBytes
                + ", diskMisses=" + diskMisses + ", diskEntries=" + diskEntries
                + ", diskBytes=" + diskBytes + '}';
    }
}