package io.pictelio.app;

import android.graphics.Bitmap;

/**
 * 图片 Bitmap 内存缓存（#147）——Lynx 图片渲染的内存缓存层。
 *
 * <p>键为图片 URL（{@code fetchImage} 入参原始 URL），值为解码后的 ARGB_8888 Bitmap，
 * 字节占用按 {@code width * height * 4}（每像素 4 字节）估算；上限 64MB
 * （{@link #MAX_BYTES}）。基于 {@link LruCache}（LRU 淘汰 + 线程安全），命中免磁盘读 + 解码。
 *
 * <p>容量参考：{@code PictelioImageService.decodeSampled} 采样上限 2048×2048
 * （约 16MB/张），64MB 约可容纳 4 张大图，实际页面多为小图，容量更宽裕。
 */
public final class ImageMemoryCache {

    /** 内存缓存字节上限：64MB（ARGB_8888 每像素 4 字节） */
    public static final long MAX_BYTES = 64L * 1024 * 1024;

    private final LruCache<String, Bitmap> cache;

    /** 默认 64MB 上限实例 */
    public ImageMemoryCache() {
        this(new LruCache<>(MAX_BYTES, (url, bitmap) ->
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
