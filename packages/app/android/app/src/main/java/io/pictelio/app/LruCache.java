package io.pictelio.app;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 泛型 LRU 内存缓存（纯 JVM，无 Android 依赖）。
 *
 * <p>基于 {@link LinkedHashMap} 的 accessOrder 模式（构造参数 true）：每次 get/put
 * 命中都会把条目移到链表尾部，头部始终是最久未使用的（LRU）。put 后按字节上限
 * 从头部逐出最旧条目，直至总字节不超上限。全部操作 synchronized，可安全多线程调用
 * （Lynx 图片请求本身多线程）。
 *
 * @param <K> key 类型
 * @param <V> value 类型
 */
public final class LruCache<K, V> {

    /** 内部函数式接口：计算单个条目的字节占用（key 参与可处理按 URL 大小的场景） */
    public interface SizeOf<K, V> {
        /** 返回 key-value 条目占用的字节数 */
        long sizeOf(K key, V value);
    }

    private final long maxBytes;
    private final SizeOf<K, V> sizeOf;
    private final LinkedHashMap<K, V> map;
    private long totalBytes;

    /**
     * @param maxBytes 字节上限（&gt; 0）；put 后总字节超限时按 LRU 逐出
     * @param sizeOf   条目字节计算器
     */
    public LruCache(long maxBytes, SizeOf<K, V> sizeOf) {
        if (maxBytes <= 0) {
            throw new IllegalArgumentException("maxBytes 必须 > 0: " + maxBytes);
        }
        if (sizeOf == null) {
            throw new NullPointerException("sizeOf");
        }
        this.maxBytes = maxBytes;
        this.sizeOf = sizeOf;
        // accessOrder=true：get/put 命中刷新顺序（最近使用移到尾部）
        this.map = new LinkedHashMap<>(16, 0.75f, true);
    }

    /** 命中返回 value（并刷新其 LRU 顺序）；未命中返回 null */
    public synchronized V get(K key) {
        return map.get(key);
    }

    /**
     * 写入/覆盖条目；写入后总字节超限时从最旧开始逐出至不超。
     * 单条目即超限时该条目也会被逐出（缓存最终为空，与 Android LruCache 语义一致）。
     */
    public synchronized void put(K key, V value) {
        V previous = map.put(key, value);
        if (previous != null) {
            totalBytes -= sizeOf.sizeOf(key, previous);
        }
        totalBytes += sizeOf.sizeOf(key, value);
        trimToSize();
    }

    /** 逐出最旧条目直至总字节不超过上限 */
    private void trimToSize() {
        while (totalBytes > maxBytes && !map.isEmpty()) {
            // accessOrder 模式下头部即最久未使用条目（LRU）
            Map.Entry<K, V> eldest = map.entrySet().iterator().next();
            map.remove(eldest.getKey());
            totalBytes -= sizeOf.sizeOf(eldest.getKey(), eldest.getValue());
        }
    }

    /** 移除指定 key（并扣减字节）；不存在时无操作 */
    public synchronized void remove(K key) {
        V removed = map.remove(key);
        if (removed != null) {
            totalBytes -= sizeOf.sizeOf(key, removed);
        }
    }

    /** 清空缓存 */
    public synchronized void clear() {
        map.clear();
        totalBytes = 0;
    }

    /** 当前条目数 */
    public synchronized int size() {
        return map.size();
    }

    /** 当前总字节数（便于诊断/测试验证字节上限） */
    public synchronized long totalBytes() {
        return totalBytes;
    }
}
