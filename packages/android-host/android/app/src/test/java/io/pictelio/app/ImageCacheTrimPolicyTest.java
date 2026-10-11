package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.graphics.Bitmap;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * 图片内存层收缩原语与策略取值的单测（#981）。
 *
 * <p>覆盖三层各自的不变量：
 * <ul>
 *   <li>{@link LruCache#trimToSize(long)}——收缩原语（部分收缩 / 清空 / 空操作 / 负数显式抛错，
 *       且<b>不改构造上限</b>）；</li>
 *   <li>{@link ImageMemoryCache#trimToSize(long)}——委托与预算读回；</li>
 *   <li>{@link ImageCacheBudget#retainedBytesAfterTrim(long, float)}——纯函数比例与入参校验。</li>
 * </ul>
 *
 * <p>放进独立文件而非改动既有的 {@code LruCacheTest} / {@code ImageMemoryCacheTest} /
 * {@code ImageCacheBudgetTest}：本轮 #980 并行改内存层的<b>键</b>，那两个文件会被对方重写，
 * 新增独立文件可避免改动冲突。
 *
 * <p><b>oracle 溯源</b>：期望字节数均由「条目数 × 每条目 64 字节（4×4 ARGB_8888）」推导，
 * 该 64 与生产 {@code ImageMemoryCache} 的 sizeOf 口径（{@code w*h*4}）一致，
 * 不从被测实现的返回值反推。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageCacheTrimPolicyTest {

    /** 4×4 ARGB_8888 = 64 字节，与生产 sizeOf 口径一致 */
    private static Bitmap bitmap() {
        return Bitmap.createBitmap(4, 4, Bitmap.Config.ARGB_8888);
    }

    /** 与生产同规则：sizeOf = width * height * 4（ARGB_8888 每像素 4 字节） */
    private static LruCache<String, Bitmap> lruCache(long maxBytes) {
        return new LruCache<>(maxBytes, (url, bmp) -> (long) bmp.getWidth() * bmp.getHeight() * 4L);
    }

    // ── LruCache 收缩原语 ──────────────────────────────────────

    @Test
    public void trimToSize_partialTarget_evictsOldestUntilUnderTarget() {
        LruCache<String, Bitmap> cache = lruCache(512);
        for (int i = 0; i < 8; i++) {
            cache.put("url" + i, bitmap());
        }
        // accessOrder 下 get 会把条目移到<b>最近使用</b>端，故 url0 变为最不会被逐出的一条；
        // 真正的最久未使用的是此后未再被读的 url1 —— 用来区分「按使用顺序」与「按写入顺序」逐出
        cache.get("url0");

        cache.trimToSize(256);

        assertEquals("512 → 256 字节 = 保留 4 条", 4, cache.size());
        assertEquals(256L, cache.totalBytes());
        assertNull("最久未使用的条目先被逐出", cache.get("url1"));
        assertNotNull("最近被读过的条目保留（按使用顺序而非写入顺序）", cache.get("url0"));
        assertNotNull("最近写入的条目保留", cache.get("url7"));
    }

    @Test
    public void trimToSize_zeroTarget_emptiesCache() {
        LruCache<String, Bitmap> cache = lruCache(512);
        for (int i = 0; i < 8; i++) {
            cache.put("url" + i, bitmap());
        }

        cache.trimToSize(0);

        assertEquals(0, cache.size());
        assertEquals(0L, cache.totalBytes());
    }

    @Test
    public void trimToSize_targetAboveCurrentUsage_isNoOp() {
        LruCache<String, Bitmap> cache = lruCache(512);
        cache.put("url0", bitmap());

        cache.trimToSize(512);

        assertEquals("占用已低于目标时不得逐出任何条目", 1, cache.size());
    }

    @Test
    public void trimToSize_doesNotChangeConstructedCapacity() {
        LruCache<String, Bitmap> cache = lruCache(512);
        for (int i = 0; i < 8; i++) {
            cache.put("url" + i, bitmap());
        }

        cache.trimToSize(64);
        assertEquals("512 → 64 字节 = 保留 1 条", 1, cache.size());

        assertEquals("收缩不得改写构造上限（回前台按原容量填充的前提）", 512L, cache.maxBytes());
        // 收缩后继续 put 仍按原上限 512 计：再放 7 条 = 共 8 条 512 字节，正好装得下，
        // 若上限真被改成 64，每条 put 都会被立刻逐出、size 将停在 1
        for (int i = 8; i < 15; i++) {
            cache.put("url" + i, bitmap());
        }
        assertEquals(8, cache.size());
        assertEquals(512L, cache.totalBytes());
    }

    @Test
    public void trimToSize_negativeTarget_throwsInsteadOfSilentlyIgnoring() {
        LruCache<String, Bitmap> cache = lruCache(512);
        cache.put("url0", bitmap());

        assertThrows(IllegalArgumentException.class, () -> cache.trimToSize(-1));

        assertEquals("抛错后缓存内容不受影响", 1, cache.size());
    }

    // ── ImageMemoryCache 委托 ──────────────────────────────────

    @Test
    public void imageMemoryCache_trimToSize_delegatesAndKeepsBudgetReadable() {
        ImageMemoryCache cache = new ImageMemoryCache(512L);
        assertEquals("预算须可读回（压力按其百分比算目标）", 512L, cache.maxBytes());
        for (int i = 0; i < 8; i++) {
            cache.put("url" + i, bitmap());
        }
        assertEquals(512L, cache.totalBytes());

        cache.trimToSize(ImageCacheBudget.retainedBytesAfterTrim(
                cache.maxBytes(), ImageCacheBudget.UI_HIDDEN_KEEP_RATIO));

        assertEquals(4, cache.size());
        assertEquals(256L, cache.totalBytes());
        assertEquals("收缩不改写预算", 512L, cache.maxBytes());
    }

    // ── 策略纯函数 ────────────────────────────────────────────

    @Test
    public void retainedBytesAfterTrim_uiHidden_keepsHalf() {
        assertEquals(256L, ImageCacheBudget.retainedBytesAfterTrim(
                512L, ImageCacheBudget.UI_HIDDEN_KEEP_RATIO));
        assertEquals(10L * 1024 * 1024 / 2,
                ImageCacheBudget.retainedBytesAfterTrim(
                        10L * 1024 * 1024, ImageCacheBudget.UI_HIDDEN_KEEP_RATIO));
    }

    @Test
    public void retainedBytesAfterTrim_background_keepsNothing() {
        assertEquals("进程进入后台应全部释放内存层",
                0L, ImageCacheBudget.retainedBytesAfterTrim(512L, ImageCacheBudget.BACKGROUND_KEEP_RATIO));
    }

    @Test
    public void retainedBytesAfterTrim_ratioOne_keepsWholeBudget() {
        assertEquals(512L, ImageCacheBudget.retainedBytesAfterTrim(512L, 1f));
    }

    @Test
    public void retainedBytesAfterTrim_invalidInput_throwsInsteadOfSilentFallback() {
        assertThrows(IllegalArgumentException.class,
                () -> ImageCacheBudget.retainedBytesAfterTrim(0L, 0.5f));
        assertThrows(IllegalArgumentException.class,
                () -> ImageCacheBudget.retainedBytesAfterTrim(-1L, 0.5f));
        assertThrows(IllegalArgumentException.class,
                () -> ImageCacheBudget.retainedBytesAfterTrim(512L, 1.5f));
        assertThrows(IllegalArgumentException.class,
                () -> ImageCacheBudget.retainedBytesAfterTrim(512L, -0.1f));
        assertThrows(IllegalArgumentException.class,
                () -> ImageCacheBudget.retainedBytesAfterTrim(512L, Float.NaN));
    }

    @Test
    public void retainedBytesAfterTrim_neverExceedsBudget() {
        assertTrue(ImageCacheBudget.retainedBytesAfterTrim(1000L, 1f) <= 1000L);
        assertTrue(ImageCacheBudget.retainedBytesAfterTrim(1000L, 0.5f) <= 1000L);
        assertTrue(ImageCacheBudget.retainedBytesAfterTrim(1000L, 0f) <= 1000L);
    }
}
