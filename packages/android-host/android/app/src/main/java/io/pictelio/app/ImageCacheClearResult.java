package io.pictelio.app;

/**
 * 图片缓存清空结果（#984）：清空动作<b>实际</b>释放了多少字节、有多少条目没删掉。
 *
 * <p>产出点唯一：{@link PixivImageLoader#clearDiskCache()}。它存在的理由是
 * <b>让失败可见</b>（禁静默降级）：用户点了「清理」，若部分条目因文件占用等原因删不掉，
 * 界面必须能显示「已释放 X，但有 N 项未清理」，而不是一律报成功。
 *
 * <p>不可变值对象。
 */
public final class ImageCacheClearResult {

    /** 未做任何清理（目录不可读等失败路径，见 {@link PixivImageLoader#clearDiskCache()} 的告警） */
    public static final ImageCacheClearResult NOTHING = new ImageCacheClearResult(0L, 0L, true);

    private final long freedBytes;
    private final long deletedEntries;
    private final boolean failed;

    ImageCacheClearResult(long freedBytes, long deletedEntries, boolean failed) {
        this.freedBytes = Math.max(0L, freedBytes);
        this.deletedEntries = Math.max(0L, deletedEntries);
        this.failed = failed;
    }

    /** 实际释放的字节数（各条目删除前 {@code length()} 之和；未删掉的条目不计入） */
    public long freedBytes() {
        return freedBytes;
    }

    /** 成功删除的条目数 */
    public long deletedEntries() {
        return deletedEntries;
    }

    /** 目录不可读或有条目删不掉——调用方须据此给用户可见反馈，不得当作成功 */
    public boolean failed() {
        return failed;
    }

    @Override
    public String toString() {
        return "ImageCacheClearResult{freedBytes=" + freedBytes
                + ", deletedEntries=" + deletedEntries + ", failed=" + failed + '}';
    }
}