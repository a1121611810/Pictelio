package io.pictelio.app;

import android.graphics.Bitmap;

/**
 * 图片 Bitmap 内存缓存（#147）——Lynx 图片渲染的内存缓存层。
 *
 * <p>键为图片 URL，值为解码后的 ARGB_8888 Bitmap，
 * 字节占用按 {@code width * height * 4}（每像素 4 字节）估算。基于 {@link LruCache}
 * （LRU 淘汰 + 线程安全），命中免磁盘读 + 解码。
 *
 * <p><b>键不是 {@code fetchImage} 的入参原始 URL</b>（#980 订正，此前本行写的就是那个已废止的语义）：
 * 调用方必须先经 {@link PixivImageLoader#cacheKey(String)} 产出<b>rewrite 后的官方 CDN URL</b>
 * 再 put/get，内存层与磁盘层因此共用同一键空间。照原始 URL 入参实现会把内存层重新与磁盘层分叉，
 * 那正是 #980 修掉的 bug。反漂移防线为 {@code ImageCacheKeySpaceTest}。
 *
 * <p><b>容量不再写死（#979）</b>：此前是 64MB 常量，与设备无关；现在容量由
 * {@link ImageCacheBudgetResolver} 按设备事实算出后<b>注入</b>（本类不持有任何容量常量，
 * 也不自行推断设备——那是策略类的职责，见 ADR-0222 §2.2 单一策略决策点）。
 * 调用方拿不到设备事实时须显式给值（如单测用小上限触发淘汰），不给默认容量。
 *
 * <p><b>内存压力收缩（#981）</b>：本类只提供 {@link #trimToSize(long)} 这一收缩原语，
 * <b>不自行决定收缩到什么程度</b>——比例在策略类 {@link ImageCacheBudget}，
 * 级别到比例的映射在 {@link ImageMemoryPressureHandler}。
 */
public final class ImageMemoryCache {

    private final LruCache<String, Bitmap> cache;

    /**
     * @param maxBytes 字节上限（须 &gt; 0），由 {@link ImageCacheBudgetResolver}
     *                 按设备算得后注入；越界交由 {@link LruCache} 抛错，不静默兜底
     */
    public ImageMemoryCache(long maxBytes) {
        this(new LruCache<>(maxBytes, (url, bitmap) ->
                (long) bitmap.getWidth() * bitmap.getHeight() * 4L));
    }

    /** 包可见注入构造（测试注入小上限缓存以触发淘汰） */
    ImageMemoryCache(LruCache<String, Bitmap> cache) {
        this.cache = cache;
    }

    /** 命中返回 Bitmap（LruCache 内部同步并刷新 LRU 顺序）；未命中返回 null */
    public Bitmap get(String url) {
        return cache.get(url);
    }

    /**
     * 探测命中（#984 口径修正）：<b>不计入</b> {@link #memoryHits()} / {@link #memoryMisses()}。
     *
     * <p><b>唯一调用点是预取链路的投机探测</b>（{@code PictelioImageService.warmLayers}
     * 的「内存层是否已有可用条目」短路判断）。那次探测不是一次图片加载请求，
     * 用 {@link #get} 会让 {@link ImageCacheStats} 的分子被非显示链路抬高、命中率可能 &gt;100%。
     *
     * <p>LRU 顺序仍被刷新（与改造前一致，见 {@link LruCache#probe}），淘汰行为零变化。
     * 显示链路（{@code deliver}）继续用 {@link #get}——它是唯一应当计入内存命中分子的入口。
     */
    public Bitmap probe(String url) {
        return cache.probe(url);
    }

    /** 写入缓存；超上限自动按 LRU 逐出最旧 */
    public void put(String url, Bitmap bitmap) {
        cache.put(url, bitmap);
    }

    /** 移除指定 URL 的缓存条目（副本交付失败/原图不可拷贝时回退下载用） */
    public void remove(String url) {
        cache.remove(url);
    }

    /** 清空缓存 */
    public void clear() {
        cache.clear();
    }

    /** 当前条目数 */
    public int size() {
        return cache.size();
    }

    /** 当前总字节数（诊断用） */
    public long totalBytes() {
        return cache.totalBytes();
    }

    // ── 可观测计数（#983）：直接透出 LRU 容器内建计数器 ────────

    /**
     * 内存层命中次数（#983）。
     *
     * <p><b>取自 {@link LruCache} 内建计数器</b>，本类不另记影子计数——影子计数会在
     * {@link #clear()}/{@link #trimToSize(long)} 等旁路上漏记，且与容器实际状态可能漂移。
     * 该计数为进程内单调量，进程重启归零（内存层本就是易失的；跨进程的累计由
     * {@link ImageCacheStatsStore} 负责）。
     */
    public long memoryHits() {
        return cache.hitCount();
    }

    /** 内存层未命中次数（#983），口径同 {@link #memoryHits()} */
    public long memoryMisses() {
        return cache.missCount();
    }

    /** 内存层因容量不足被逐出的次数（#983），口径见 {@link LruCache#evictionCount()} */
    public long memoryEvictions() {
        return cache.evictionCount();
    }

    /**
     * 容量预算字节数（#981 内存压力响应）。
     *
     * <p>即构造时注入的设备预算值——内存压力按它的百分比算收缩目标，故须能读回。
     */
    public long maxBytes() {
        return cache.maxBytes();
    }

    /**
     * 收缩到不超过 {@code target} 字节（#981 内存压力）：从最久未使用开始逐出。
     *
     * <p><b>不改变构造容量</b>，故回前台后可照原容量重新填充。
     *
     * @param target 目标字节上限（≥ 0；0 = 清空内存层）
     * @throws IllegalArgumentException {@code target} 为负
     */
    public void trimToSize(long target) {
        cache.trimToSize(target);
    }
}
