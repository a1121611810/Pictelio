package io.pictelio.app;

import android.graphics.Bitmap;

/**
 * 图片 Bitmap 内存缓存（#147）——Lynx 图片渲染的内存缓存层。
 *
 * <p>键为图片 URL（{@code fetchImage} 入参原始 URL），值为解码后的 ARGB_8888 Bitmap，
 * 字节占用按 {@code width * height * 4}（每像素 4 字节）估算。基于 {@link LruCache}
 * （LRU 淘汰 + 线程安全），命中免磁盘读 + 解码。
 *
 * <p><b>容量不再写死（#979）</b>：此前是 64MB 常量，与设备无关；现在容量由
 * {@link ImageCacheBudgetResolver} 按设备事实算出后<b>注入</b>（本类不持有任何容量常量，
 * 也不自行推断设备——那是策略类的职责，见 ADR-0222 §2.2 单一策略决策点）。
 * 调用方拿不到设备事实时须显式给值（如单测用小上限触发淘汰），不给默认容量。
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
}
