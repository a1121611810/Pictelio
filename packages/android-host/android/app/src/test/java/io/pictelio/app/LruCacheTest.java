package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

/**
 * {@link LruCache} 纯 JVM 单测（#147）。
 *
 * <p>覆盖：put/get 往返、字节上限、淘汰顺序（最旧先出）、accessOrder 刷新
 * （get 命中提升顺序）、put 超上限逐出至不超、同 key 覆盖、clear、单条目超限自逐出。
 */
public class LruCacheTest {

    /** 简化 sizeOf：以 value 自身作为字节数，便于精确控制 */
    private static LruCache<String, Integer> cacheOf(long maxBytes) {
        return new LruCache<>(maxBytes, (key, value) -> value);
    }

    @Test
    public void put_get_roundTrip() {
        LruCache<String, Integer> cache = cacheOf(100);
        cache.put("a", 10);
        assertEquals(Integer.valueOf(10), cache.get("a"));
        assertEquals(1, cache.size());
    }

    @Test
    public void get_missing_returnsNull() {
        LruCache<String, Integer> cache = cacheOf(100);
        assertNull(cache.get("missing"));
        assertEquals(0, cache.size());
    }

    @Test
    public void totalBytes_tracksSumOfValues() {
        LruCache<String, Integer> cache = cacheOf(100);
        cache.put("a", 10);
        cache.put("b", 30);
        assertEquals(40, cache.totalBytes());
        // 同 key 覆盖：先减旧值再加新值
        cache.put("a", 20);
        assertEquals(50, cache.totalBytes());
    }

    @Test
    public void put_overLimit_evictsOldestUntilUnder() {
        // 上限 30：a(10)+b(10)+c(10) 正好不超；写入 d 后 40 > 30，逐出最旧的 a
        LruCache<String, Integer> cache = cacheOf(30);
        cache.put("a", 10);
        cache.put("b", 10);
        cache.put("c", 10);
        assertNotNull(cache.get("a"));
        assertNotNull(cache.get("b"));
        assertNotNull(cache.get("c"));
        assertEquals(30, cache.totalBytes());

        cache.put("d", 10);
        assertNull("最旧的 a 应被逐出", cache.get("a"));
        assertNotNull(cache.get("b"));
        assertNotNull(cache.get("c"));
        assertNotNull(cache.get("d"));
        assertEquals(3, cache.size());
        assertEquals(30, cache.totalBytes());
    }

    @Test
    public void get_refreshesAccessOrder() {
        // 上限 20：放 a、b；get(a) 后 a 变为最新，再放 c → 超限逐出 b
        LruCache<String, Integer> cache = cacheOf(20);
        cache.put("a", 10);
        cache.put("b", 10);
        cache.get("a"); // accessOrder 刷新：a 移到尾部，b 成最旧
        cache.put("c", 10); // 30 > 20 → 逐出 b
        assertNotNull(cache.get("a"));
        assertNull("未被访问的 b 应最先被逐出", cache.get("b"));
        assertNotNull(cache.get("c"));
    }

    @Test
    public void put_sameKey_overwritesValue() {
        LruCache<String, Integer> cache = cacheOf(100);
        cache.put("a", 10);
        cache.put("a", 99);
        assertEquals(Integer.valueOf(99), cache.get("a"));
        assertEquals(1, cache.size());
        assertEquals(99, cache.totalBytes());
    }

    @Test
    public void clear_emptiesCache() {
        LruCache<String, Integer> cache = cacheOf(100);
        cache.put("a", 10);
        cache.put("b", 10);
        cache.clear();
        assertEquals(0, cache.size());
        assertEquals(0, cache.totalBytes());
        assertNull(cache.get("a"));
        assertNull(cache.get("b"));
    }

    @Test
    public void put_singleEntryOverLimit_evictedItself() {
        // 单条目即超上限：逐出后缓存为空（对齐 Android LruCache 语义：不保留超限条目）
        LruCache<String, Integer> cache = cacheOf(10);
        cache.put("big", 20);
        assertEquals(0, cache.size());
        assertEquals(0, cache.totalBytes());
        assertNull(cache.get("big"));
    }
}
