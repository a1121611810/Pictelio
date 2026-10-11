package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertSame;

import android.graphics.Bitmap;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * {@link ImageMemoryCache} 内存缓存单测（#147，Robolectric 提供 Bitmap）。
 *
 * <p>覆盖：put/get 往返（含按注入容量建的实例）、未命中返回 null、超上限按 LRU 淘汰最旧、
 * clear。淘汰用例通过包可见注入构造用小上限 {@link LruCache} 逼出。
 *
 * <p>容量自 #979 起由 {@link ImageCacheBudgetResolver} 按设备算得后注入，
 * 本类不再有「默认 64MB」实例可测。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ImageMemoryCacheTest {

    /** 与生产同规则：sizeOf = width * height * 4（ARGB_8888 每像素 4 字节） */
    private static LruCache<String, Bitmap> lruCache(long maxBytes) {
        return new LruCache<>(maxBytes, (url, bmp) -> (long) bmp.getWidth() * bmp.getHeight() * 4L);
    }

    private static Bitmap bitmap(int width, int height) {
        return Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
    }

    @Test
    public void put_get_roundTrip() {
        ImageMemoryCache cache = new ImageMemoryCache(lruCache(1000));
        Bitmap bmp = bitmap(4, 4);
        cache.put("https://i.pximg.net/a.jpg", bmp);
        assertSame(bmp, cache.get("https://i.pximg.net/a.jpg"));
        assertEquals(1, cache.size());
    }

    @Test
    public void injectedCapacity_putGetWorks() {
        // 容量由调用方注入（#979 起不再有无参默认容量）：给足一屏预算，读写照常
        long oneScreen = 1080L * 2400L * ImageCacheBudget.BYTES_PER_PIXEL;
        ImageMemoryCache cache = new ImageMemoryCache(oneScreen);
        Bitmap bmp = bitmap(10, 10);
        cache.put("https://i.pximg.net/b.jpg", bmp);
        assertSame(bmp, cache.get("https://i.pximg.net/b.jpg"));
    }

    @Test
    public void get_missing_returnsNull() {
        ImageMemoryCache cache = new ImageMemoryCache(lruCache(1000));
        assertNull(cache.get("https://i.pximg.net/never-cached.jpg"));
    }

    @Test
    public void put_overLimit_evictsOldest() {
        // 上限 64 字节 = 1 张 4x4 图（4*4*4=64）；写第二张超限 → 逐出最旧的 url1
        ImageMemoryCache cache = new ImageMemoryCache(lruCache(64));
        Bitmap first = bitmap(4, 4);
        Bitmap second = bitmap(4, 4);
        cache.put("url1", first);
        assertSame(first, cache.get("url1"));
        cache.put("url2", second);
        assertNull("最旧的 url1 应被逐出", cache.get("url1"));
        assertSame(second, cache.get("url2"));
        assertEquals(1, cache.size());
    }

    @Test
    public void clear_emptiesCache() {
        ImageMemoryCache cache = new ImageMemoryCache(lruCache(1000));
        cache.put("url1", bitmap(4, 4));
        cache.put("url2", bitmap(4, 4));
        assertEquals(2, cache.size());
        cache.clear();
        assertEquals(0, cache.size());
        assertNull(cache.get("url1"));
        assertNull(cache.get("url2"));
    }
}
