package io.pictelio.app;

/**
 * 图片缓存的<b>内存预算策略</b>（#979，ADR-0222 §2.2 单一策略决策点）。
 *
 * <p>本类是<b>纯函数</b>：不依赖 {@code Context}、不依赖任何 Android 组件、不读系统服务，
 * 所有设备事实（屏幕尺寸、屏数、内存等级、是否低内存设备）均由入参给出，
 * 因此容量算法可被纯 JVM 单测直接验证（见 {@code ImageCacheBudgetTest}）。
 * 「怎么从系统读到这些事实」在 {@link ImageCacheBudgetResolver}，本类只管「怎么算」。
 *
 * <h3>算法：屏数法目标值 × 进程内存封顶，取二者较小</h3>
 * <pre>
 *   目标值 = 屏幕宽像素 × 屏幕高像素 × 每像素 4 字节 × 屏数
 *   封顶值 = 进程内存等级(MB) × 封顶系数（低内存设备用更保守的系数）
 *   内存缓存预算 = min(目标值, 封顶值)
 * </pre>
 * 取小保证「不把进程可用内存吃满」：屏数法在大屏高分辨率设备上会算出远超进程承受力的值，
 * 没有封顶就会直接换来 OOM。
 *
 * <h3>屏数与封顶系数的外部一手出处</h3>
 * 出处：<b>Glide 4.16 {@code MemorySizeCalculator}</b>
 * （{@code bumptech/glide}，{@code library/src/main/java/com/bumptech/glide/load/engine/cache/MemorySizeCalculator.java}），
 * 已逐行核对源码取下列字面量：
 * <ul>
 *   <li>{@code MEMORY_CACHE_TARGET_SCREENS = 2}——内存缓存目标屏数；</li>
 *   <li>{@code MAX_SIZE_MULTIPLIER = 0.4f}——普通设备进程内存封顶系数；</li>
 *   <li>{@code LOW_MEMORY_MAX_SIZE_MULTIPLIER = 0.33f}——低内存设备（{@code isLowRamDevice()}）封顶系数；</li>
 *   <li>屏幕尺寸按 {@code getScreenSize()} 的宽像素 × 高像素，每像素按 ARGB_8888 的 4 字节计。</li>
 * </ul>
 *
 * <p>⚠️ <b>必须同时记明的反证</b>：网络上流传的「<b>Glide 默认 1/8</b>」<b>不是 Glide 的事实</b>——
 * {@code MemorySizeCalculator} 源码中根本不存在 1/8 这一系数（已核对）。1/8 是
 * <b>Android 官方《Caching Bitmaps》指南里的示例值</b>，属另一出处、另一语境（面向开发者科普，
 * 不是某个库的默认配置），<b>不得据以实现</b>。本类的系数只用上面那份逐行核对过的 Glide 源码。
 *
 * <p>Glide 另有「目标值之和超出可用内存时按比例缩减两池」的收缩逻辑；本仓内存层只有内存缓存
 * 一池（ADR-0222 §3.1 明确不引入 bitmap pool），取小即为该收缩在单池上的等价物，故不移植比例缩减。
 */
public final class ImageCacheBudget {

    /** 内存缓存目标屏数：出处 Glide {@code MEMORY_CACHE_TARGET_SCREENS} */
    public static final int MEMORY_CACHE_TARGET_SCREENS = 2;

    /** ARGB_8888 每像素字节数（与 {@code ImageMemoryCache} 的 sizeOf 口径一致） */
    public static final long BYTES_PER_PIXEL = 4L;

    /** 普通设备封顶系数：出处 Glide {@code MAX_SIZE_MULTIPLIER}（不是网络误传的 1/8） */
    public static final float MAX_SIZE_MULTIPLIER = 0.4f;

    /** 低内存设备封顶系数：出处 Glide {@code LOW_MEMORY_MAX_SIZE_MULTIPLIER} */
    public static final float LOW_MEMORY_MAX_SIZE_MULTIPLIER = 0.33f;

    // ── 内存压力响应（#981，ADR-0222 §2.2 单一策略决策点的「内存压力响应」一维）──
    // 与上面的 Glide 系数不同源：那两个出自 Glide 源码，这两条出自 AOSP
    // ComponentCallbacks2 的 onTrimMemory 文档语义（见各自的 KDoc），是本仓自定取值。

    /**
     * 界面不可见（{@code TRIM_MEMORY_UI_HIDDEN}）时保留的内存层比例。
     *
     * <p><b>取值依据（AOSP {@code ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN} 文档）</b>：
     * 「进程 UI 已不再对用户可见……此时应释放较大分配让机器用于别的进程。
     * <b>但在此状态下收缩会影响用户体验——进程应能快速恢复</b>，故只释放那些妨碍快速恢复的资源」。
     * ⇒ 判为<b>部分收缩</b>而非清空。
     *
     * <p><b>0.5 的推导</b>：预算 {@link #MEMORY_CACHE_TARGET_SCREENS} 屏，预算按屏数法分支取值时
     * 保留一半即<b>整一屏</b>——恰是「快速恢复所需的最小可见状态」；按内存封顶分支取值时
     * 减半即为把进程占用让出一半。二者都落在文档描述的取舍之内。
     *
     * <p>⚠️ 本系数<b>不是</b> Glide 的任何常量（Glide 源码无此值，同 {@link #MAX_SIZE_MULTIPLIER}
     * 的出处说明），也不出自官方文档的字面值，是本仓自定取值。
     */
    public static final float UI_HIDDEN_KEEP_RATIO = 0.5f;

    /**
     * 进程进入后台（{@code TRIM_MEMORY_BACKGROUND}）时保留的内存层比例 = 全清。
     *
     * <p><b>取值依据（AOSP {@code ComponentCallbacks2.TRIM_MEMORY_BACKGROUND} 文档）</b>：
     * 「进程接近 LRU 列表的<b>开头</b>……此时应<b>尽可能多</b>释放内存，否则系统可能因要腾地方
     * 杀掉别的进程」⇒ 判为<b>全部释放</b>。
     *
     * <p>清空的只是<b>内存层</b>：磁盘层不随内存压力收缩（#981 验收项），故回到前台时
     * 重新填充只付「磁盘读 + 解码」，不付网络。
     */
    public static final float BACKGROUND_KEEP_RATIO = 0f;

    private static final long BYTES_PER_MB = 1024L * 1024L;

    private ImageCacheBudget() {}

    /**
     * 计算内存层字节预算 = min(屏数法目标值, 进程内存封顶值)。
     *
     * @param screenWidthPx  屏幕宽像素（正数）
     * @param screenHeightPx 屏幕高像素（正数）
     * @param screens        目标屏数（正数；生产固定取 {@link #MEMORY_CACHE_TARGET_SCREENS}）
     * @param memoryClassMb  进程内存等级（{@code ActivityManager.getMemoryClass()}，单位 MB，正数）
     * @param lowRamDevice   系统是否判定为低内存设备（{@code ActivityManager.isLowRamDevice()}）
     * @return 内存缓存字节上限（恒 &gt; 0，且恒 ≤ {@link #capBytes}）
     * @throws IllegalArgumentException 任一入参非正数——<b>显式暴露错误，不静默兜底</b>
     */
    public static long memoryCacheBudgetBytes(long screenWidthPx, long screenHeightPx, int screens,
            int memoryClassMb, boolean lowRamDevice) {
        requirePositive("screenWidthPx", screenWidthPx);
        requirePositive("screenHeightPx", screenHeightPx);
        requirePositive("screens", screens);
        long targetBytes = screenWidthPx * screenHeightPx * BYTES_PER_PIXEL * screens;
        return Math.min(targetBytes, capBytes(memoryClassMb, lowRamDevice));
    }

    /**
     * 进程内存封顶值 = 内存等级 × 封顶系数（低内存设备取更保守的系数）。
     *
     * @throws IllegalArgumentException {@code memoryClassMb} 非正数
     */
    public static long capBytes(int memoryClassMb, boolean lowRamDevice) {
        requirePositive("memoryClassMb", memoryClassMb);
        float multiplier = lowRamDevice ? LOW_MEMORY_MAX_SIZE_MULTIPLIER : MAX_SIZE_MULTIPLIER;
        // 用 double 承载乘法：float32 在 100MB 量级上会丢精度，导致同样输入得到不可预期的末位差异
        return (long) ((double) memoryClassMb * BYTES_PER_MB * (double) multiplier);
    }

    /**
     * 内存压力收缩后的保留字节上限（#981）= 预算 × 保留比例。
     *
     * <p>纯函数（无 Android 依赖），比例由 {@link #UI_HIDDEN_KEEP_RATIO} /
     * {@link #BACKGROUND_KEEP_RATIO} 给出，故两级行为可被纯 JVM 单测直接验证。
     *
     * <p>结果恒 ≤ {@code budgetBytes}，且 {@code keepRatio == 0} 时恒为 0（即清空内存层）。
     * 用 {@code double} 承载乘法：与 {@link #capBytes} 同理，float32 在 100MB 量级上会丢精度。
     *
     * @param budgetBytes 当前内存层预算（正数）
     * @param keepRatio   保留比例，取值区间 {@code [0, 1]}
     * @throws IllegalArgumentException 预算非正数、或比例越界/为 NaN——<b>显式暴露错误，不静默兜底</b>
     */
    public static long retainedBytesAfterTrim(long budgetBytes, float keepRatio) {
        requirePositive("budgetBytes", budgetBytes);
        if (Float.isNaN(keepRatio) || keepRatio < 0f || keepRatio > 1f) {
            throw new IllegalArgumentException("keepRatio 必须在 [0, 1]: " + keepRatio);
        }
        if (keepRatio == 1f) {
            return budgetBytes;
        }
        return (long) ((double) budgetBytes * (double) keepRatio);
    }

    private static void requirePositive(String name, long value) {
        if (value <= 0) {
            throw new IllegalArgumentException(name + " 必须 > 0: " + value);
        }
    }
}
