package io.pictelio.app;

import android.content.Context;
import android.net.Uri;
import android.util.Log;

import java.io.File;
import java.io.IOException;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 下载队列原生执行器深模块（spec docs/specs/download-manager.md §4.3；main sourceSet 双引擎共享）。
 *
 * <p>职责：把一个下载任务从官方 URL 落到用户空间，并在过程中支持进度上报与取消。
 * <ul>
 *   <li>字节获取复用 {@link PixivImageLoader#loadFileWithProgress}（缓存优先 + 流式写盘 +
 *       图床 resolve / 镜像失败官方回退 + Referer/UA 注入，ADR-0143 语义不复制不偏离）；</li>
 *   <li>落盘复用 {@link GallerySaver#saveFile}（MediaStore API 29+ / 应用目录 API 28）；</li>
 *   <li>取消：按 taskId 登记 {@link AtomicBoolean}，下载读取循环轮询中止（失败抛可读 IOException）。</li>
 * </ul>
 *
 * <p>全部方法同步阻塞——薄壳（{@code PictelioDownloaderPlugin} / {@code PictelioDownloaderModule}）
 * 负责线程与进度转译。队列状态机在 JS（ADR-0146 D1），本模块只做单任务执行。
 */
public final class PictelioDownloader {

    private static final String TAG = "PictelioDownloader";

    /** 单任务进度回调（done/total 字节） */
    public interface ProgressListener {
        void onProgress(long done, long total);
    }

    /** 取消登记表：taskId → 取消信号（仅在途任务；结束即移出） */
    private static final ConcurrentHashMap<String, AtomicBoolean> CANCELS = new ConcurrentHashMap<>();

    private PictelioDownloader() {}

    /**
     * 执行一次下载任务：流式下载（进度 / 取消）→ 落盘到相册，返回 outputUri。
     * 阻塞 IO，调用方自备线程；失败抛 IOException（消息可读，无静默降级）。
     */
    public static String download(Context context, PixivImageLoader loader, String id,
            String sourceUrl, String fileName, ProgressListener listener) throws IOException {
        if (id == null || id.isEmpty()) {
            throw new IOException("下载失败：任务 id 为空");
        }
        if (sourceUrl == null || sourceUrl.isEmpty()) {
            throw new IOException("下载失败：URL 为空");
        }
        if (fileName == null || fileName.isEmpty()) {
            throw new IOException("下载失败：文件名为空");
        }
        AtomicBoolean token = new AtomicBoolean(false);
        CANCELS.put(id, token);
        try {
            File source = loader.loadFileWithProgress(sourceUrl, (done, total) -> {
                if (listener != null) {
                    listener.onProgress(done, total);
                }
            }, token::get);
            GallerySaver.SaveResult result = GallerySaver.saveFile(context, source, fileName);
            return result.uri.toString();
        } finally {
            CANCELS.remove(id);
        }
    }

    /**
     * 执行一次 ugoira 导出任务：下载源 ZIP（进度/取消）→ 导出目标格式（{@link UgoiraExporter}）
     * → 落盘到系统下载，返回 outputUri。阻塞 IO，调用方自备线程；失败抛 IOException。
     */
    public static String downloadUgoira(Context context, PixivImageLoader loader, String id,
            String zipUrl, String format, String fileName, String framesJson,
            ProgressListener listener) throws IOException {
        if (id == null || id.isEmpty()) {
            throw new IOException("下载失败：任务 id 为空");
        }
        if (zipUrl == null || zipUrl.isEmpty()) {
            throw new IOException("下载失败：URL 为空");
        }
        if (format == null || format.isEmpty()) {
            throw new IOException("下载失败：导出格式为空");
        }
        if (fileName == null || fileName.isEmpty()) {
            throw new IOException("下载失败：文件名为空");
        }
        AtomicBoolean token = new AtomicBoolean(false);
        CANCELS.put(id, token);
        try {
            File zip = loader.loadFileWithProgress(zipUrl, (done, total) -> {
                if (listener != null) {
                    listener.onProgress(done, total);
                }
            }, token::get);
            if (token.get()) {
                throw new IOException("下载已取消");
            }
            File exported = UgoiraExporter.export(context, zip, format, id, framesJson);
            GallerySaver.SaveResult result = GallerySaver.saveDownloadFile(context, exported, fileName);
            return result.uri.toString();
        } finally {
            CANCELS.remove(id);
        }
    }

    /**
     * 执行一次小说导出任务：{@link NovelExporter} 按目标格式编码（封面/正文插图经 loader
     * 取字节，字节零进 JS 堆）→ 落盘到系统下载，返回 outputUri。阻塞 IO，调用方自备线程；
     * 失败抛 IOException（消息可读，无静默降级）。
     *
     * <p>进度为粗粒度（spec novel-export §8）：编码前 5%、落盘前 90%，完成由队列置 100%
     *（单次编码不可中断分片，故不提供逐图级进度）。
     */
    public static String downloadNovel(Context context, PixivImageLoader loader, String id,
            String payloadJson, String format, String fileName, ProgressListener listener)
            throws IOException {
        if (id == null || id.isEmpty()) {
            throw new IOException("导出失败：任务 id 为空");
        }
        if (payloadJson == null || payloadJson.isEmpty()) {
            throw new IOException("导出失败：导出载荷为空");
        }
        if (format == null || format.isEmpty()) {
            throw new IOException("导出失败：导出格式为空");
        }
        if (fileName == null || fileName.isEmpty()) {
            throw new IOException("导出失败：文件名为空");
        }
        AtomicBoolean token = new AtomicBoolean(false);
        CANCELS.put(id, token);
        try {
            if (listener != null) {
                listener.onProgress(5, 100);
            }
            File exported = NovelExporter.export(context, loader, payloadJson, format, id);
            if (token.get()) {
                throw new IOException("导出已取消");
            }
            if (listener != null) {
                listener.onProgress(90, 100);
            }
            GallerySaver.SaveResult result = GallerySaver.saveDownloadFile(context, exported, fileName);
            return result.uri.toString();
        } finally {
            CANCELS.remove(id);
        }
    }

    /** 请求取消任务；返回是否命中在途任务（未命中 = 已完成/未知，幂等 no-op） */
    public static boolean cancel(String id) {
        if (id == null) {
            return false;
        }
        AtomicBoolean token = CANCELS.get(id);
        if (token == null) {
            return false;
        }
        token.set(true);
        return true;
    }

    /**
     * 删除已落盘文件：content://（MediaStore）删除媒体项；file:// 删除文件。
     * 未命中（文件已不存在）视为成功（幂等）；不支持 scheme 或删除失败抛 IOException。
     */
    public static void deleteFile(Context context, String uriString) throws IOException {
        if (uriString == null || uriString.isEmpty()) {
            throw new IOException("删除失败：uri 为空");
        }
        Context app = context.getApplicationContext();
        if (uriString.startsWith("content://")) {
            int rows = app.getContentResolver().delete(Uri.parse(uriString), null, null);
            if (rows == 0) {
                Log.w(TAG, "删除媒体项未命中（可能已删除，视为成功）: " + uriString);
            }
            return;
        }
        if (uriString.startsWith("file://")) {
            File file = new File(Uri.parse(uriString).getPath());
            if (file.exists() && !file.delete()) {
                throw new IOException("删除失败：无法删除文件 " + uriString);
            }
            return;
        }
        throw new IOException("删除失败：不支持的 uri「" + uriString + "」");
    }
}
