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
 * <p><b>内建可观测计数（#983）</b>：命中/未命中/淘汰三个计数<b>由容器自身维护</b>，
 * 与增删发生在同一把锁内，故不存在「统计与实际不一致」的窗口——上层
 * （{@link ImageMemoryCache} → {@code ImageCacheStats}）直接读这里的读数，
 * <b>不另建影子计数器</b>（影子计数器会在 clear/trim 等旁路上漏记）。
 * 计数为进程内单调量：进程重启归零（内存层本就是易失的）。
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
    /** 内建计数（#983）：与增删同锁，无统计漂移窗口；进程内单调，重启归零 */
    private long hitCount;
    private long missCount;
    private long evictionCount;

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

    /** 命中返回 value（并刷新其 LRU 顺序）；未命中返回 null。内建命中/未命中计数见 {@link #hitCount()} */
    public synchronized V get(K key) {
        V value = map.get(key);
        if (value == null) {
            missCount++;
        } else {
            hitCount++;
        }
        return value;
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

    /** 逐出最旧条目直至总字节不超过构造上限 */
    private void trimToSize() {
        evictUntil(maxBytes);
    }

    /**
     * 收缩到不超过 {@code target}（#981 内存压力）：从最旧开始逐出。
     *
     * <p><b>不改变构造上限</b>：本方法只丢条目，{@link #maxBytes} 仍是原值，
     * 故回前台后 {@link #put} 会照原上限重新填充（不会逐级收缩成小缓存）。
     *
     * @param target 目标字节上限（≥ 0；0 = 清空）。已是 ≤ 当前占用时为空操作
     * @throws IllegalArgumentException {@code target} 为负
     */
    public synchronized void trimToSize(long target) {
        if (target < 0) {
            throw new IllegalArgumentException("target 必须 >= 0: " + target);
        }
        evictUntil(target);
    }

    /** 构造时给定的字节上限（#981：内存压力按预算比例算收缩目标，须能读回预算） */
    public synchronized long maxBytes() {
        return maxBytes;
    }

    /**
     * 从最旧开始逐出条目直至总字节不超过 {@code target}。
     * <b>调用方须持有本对象锁</b>（故不自带 synchronized，与 {@link #put} 共用同一把锁）。
     */
    private void evictUntil(long target) {
        while (totalBytes > target && !map.isEmpty()) {
            // accessOrder 模式下头部即最久未使用条目（LRU）
            Map.Entry<K, V> eldest = map.entrySet().iterator().next();
            map.remove(eldest.getKey());
            totalBytes -= sizeOf.sizeOf(eldest.getKey(), eldest.getValue());
            evictionCount++;
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

    // ── 内建可观测计数（#983）────────────────────────────────

    /** get 命中次数（进程内单调，进程重启归零） */
    public synchronized long hitCount() {
        return hitCount;
    }

    /** get 未命中次数（进程内单调，进程重启归零） */
    public synchronized long missCount() {
        return missCount;
    }

    /**
     * LRU 逐出次数（进程内单调）。
     *
     * <p>口径：<b>仅计 {@link #evictUntil} 里的容量逐出</b>——同 key 覆盖 put 掉的旧值
     * 不算淘汰（那是一次替换，不是容量压力），{@link #remove}/{@link #clear} 的显式清除
     * 也不算（那是调用方主动要的，不是缓存自我淘汰）。故本计数回答的是
     * 「缓存因装不下而丢弃了多少次」，而非「丢弃了多少条目」。
     */
    public synchronized long evictionCount() {
        return evictionCount;
    }
}
