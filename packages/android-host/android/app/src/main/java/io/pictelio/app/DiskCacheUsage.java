package io.pictelio.app;

/**
 * 磁盘层占用读数（#983）：缓存目录当前的<b>条目数</b>与<b>占用字节数</b>。
 *
 * <p>不可变值对象，产出点唯一：{@link PixivImageLoader#diskUsage()}（一次
 * {@code listFiles} + 逐条 {@code length()} 求和）。它是磁盘层占用对外的读取契约，
 * 下一张票（清理入口）用它显示「清理前占用」，并与 {@link PixivImageLoader#currentMaxCacheBytes()}
 * 的上限对照。
 *
 * <p>是<b>量表（gauge）不是累计量</b>：条目被逐出或被清空后自然变小，故
 * <b>不持久化</b>——跨进程重启后由首次读取重新求值（{@link ImageCacheStatsStore}
 * 只持久化命中率相关的累计计数）。
 */
public final class DiskCacheUsage {

    /** 空读数（目录不可读时返回，见 {@link PixivImageLoader#diskUsage()} 的告警路径） */
    public static final DiskCacheUsage EMPTY = new DiskCacheUsage(0L, 0L);

    private final long entries;
    private final long bytes;

    public DiskCacheUsage(long entries, long bytes) {
        if (entries < 0 || bytes < 0) {
            throw new IllegalArgumentException("磁盘占用读数不得为负: entries=" + entries + " bytes=" + bytes);
        }
        this.entries = entries;
        this.bytes = bytes;
    }

    /** 缓存目录内的条目数（含写盘过程中的 {@code .tmp} 临时文件，与淘汰看到的是同一份列表） */
    public long entries() {
        return entries;
    }

    /** 占用字节数（各条目 {@code File.length()} 之和） */
    public long bytes() {
        return bytes;
    }

    @Override
    public String toString() {
        return "DiskCacheUsage{entries=" + entries + ", bytes=" + bytes + '}';
    }
}