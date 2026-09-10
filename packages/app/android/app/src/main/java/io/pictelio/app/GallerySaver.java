package io.pictelio.app;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Log;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Locale;

/**
 * 作品图片保存深模块（spec docs/specs/image-save-download.md §3 D1）——双引擎共享（src/main）。
 *
 * <p>职责：把一张官方 URL 的图片落盘到用户空间。
 * <ul>
 *   <li>字节获取复用 {@link PixivImageLoader#loadFile}（缓存优先 + per-URL 锁 + 图床
 *       resolve/镜像失败官方回退 + Referer/UA 注入，ADR-0143 语义不复制不偏离）；</li>
 *   <li>API ≥ 29：MediaStore（Pictures/Pictelio，IS_PENDING 两段式），无权限要求；</li>
 *   <li>API 28（minSdk）：应用专属外部目录 + MediaScanner 尽力入库——不给系统弹
 *       WRITE_EXTERNAL_STORAGE 权限（两端各自实现权限管线的成本 > 该 API 段的图库可见性收益，
 *       spec §3 D1 已申报）。</li>
 * </ul>
 *
 * <p>文件名由 JS 生成（单一事实源，spec §3 D3），Java 侧只做防御性清洗；
 * 同名重复保存不在本层去重（spec §2：MediaStore 29+ 自动加 " (1)"，回退路径覆盖同名）。
 * 全部方法同步阻塞——调用方（GallerySaverPlugin / PictelioGalleryModule）负责线程。
 */
public final class GallerySaver {

    private static final String TAG = "GallerySaver";

    /** 相册相对目录（API 29+ RELATIVE_PATH；API 28 回退子目录同名，两个 API 段路径观感一致） */
    static final String RELATIVE_PATH = "Pictures/Pictelio";
    /** API 28 回退根：getExternalFilesDir(Pictures) 下的子目录名 */
    private static final String FALLBACK_DIR_NAME = "Pictelio";
    /** 非图片产物（ugoira 导出：视频/归档）子目录名（Downloads/Pictelio） */
    private static final String DOWNLOAD_DIR_NAME = "Pictelio";

    private GallerySaver() {}

    /** 保存结果：mediaStore=true 时 uri 为 content://（图库可见）；false 为 file://（回退路径） */
    public static final class SaveResult {
        public final Uri uri;
        public final boolean mediaStore;

        SaveResult(Uri uri, boolean mediaStore) {
            this.uri = uri;
            this.mediaStore = mediaStore;
        }
    }

    /**
     * 保存单张图片。阻塞 IO，调用方自备线程。
     *
     * @param officialUrl 官方原图 URL（缓存键恒官方——ADR-0143 D2）
     * @param fileName    JS 生成的展示文件名（Pictelio_&lt;id&gt;[_pN].&lt;ext&gt;）
     * @throws IOException 下载失败 / 非法文件名 / 媒体库或回退目录写入失败（消息可读，无静默降级）
     */
    public static SaveResult save(Context context, PixivImageLoader loader, String officialUrl,
            String fileName) throws IOException {
        if (officialUrl == null || officialUrl.isEmpty()) {
            throw new IOException("保存失败：图片 URL 为空");
        }
        File source = loader.loadFile(officialUrl);
        return saveFile(context, source, fileName);
    }

    /**
     * 保存一个已就位的本地文件（下载队列执行器复用；调用方自备线程）。
     * 文件名清洗 / mime / 落盘分流与 {@link #save} 完全一致。
     */
    public static SaveResult saveFile(Context context, File source, String fileName)
            throws IOException {
        if (source == null || !source.exists()) {
            throw new IOException("保存失败：源文件不存在");
        }
        String safe = sanitizeFileName(fileName);
        String mime = mimeFor(safe);
        Context app = context.getApplicationContext();
        if (Build.VERSION.SDK_INT >= 29) {
            return saveToMediaStore(app, source, safe, mime);
        }
        return saveToFallbackDir(app, source, safe, mime);
    }

    /**
     * 保存非图片产物（ugoira 导出：GIF/WebP/APNG/MP4/ZIP/TAR）。
     * API 29+：MediaStore.Downloads（Downloads/Pictelio）；API 28：应用专属 Downloads 目录 + 扫描。
     * 与 {@link #save} 的区别仅在目标集合/目录（文件名清洗与 mime 同规则）。
     */
    public static SaveResult saveDownloadFile(Context context, File source, String fileName)
            throws IOException {
        if (source == null || !source.exists()) {
            throw new IOException("保存失败：源文件不存在");
        }
        String safe = sanitizeFileName(fileName);
        String mime = mimeFor(safe);
        Context app = context.getApplicationContext();
        if (Build.VERSION.SDK_INT >= 29) {
            return saveToDownloads(app, source, safe, mime);
        }
        return saveToFallbackDir(app, source, safe, mime,
                Environment.DIRECTORY_DOWNLOADS, DOWNLOAD_DIR_NAME);
    }

    // ── API 29+：MediaStore（IS_PENDING 两段式） ──────────────

    private static SaveResult saveToMediaStore(Context app, File source, String displayName,
            String mime) throws IOException {
        ContentResolver cr = app.getContentResolver();
        Uri uri = cr.insert(
                MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY),
                buildImageValues(displayName, mime));
        return writeToMediaStore(app, uri, source);
    }

    /** API 29+：非图片产物入 MediaStore.Downloads（Downloads/Pictelio）。 */
    private static SaveResult saveToDownloads(Context app, File source, String displayName,
            String mime) throws IOException {
        ContentResolver cr = app.getContentResolver();
        Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI,
                buildDownloadValues(displayName, mime));
        return writeToMediaStore(app, uri, source);
    }

    /** 共享两段式写入：insert 得到的 uri + pending 复位；失败清 pending 记录。 */
    private static SaveResult writeToMediaStore(Context app, Uri uri, File source)
            throws IOException {
        if (uri == null) {
            throw new IOException("保存失败：媒体库拒绝写入（insert 返回空）");
        }
        ContentResolver cr = app.getContentResolver();
        try (InputStream in = new FileInputStream(source);
             OutputStream out = openMediaStoreOutput(cr, uri)) {
            copy(in, out);
        } catch (IOException e) {
            // 失败清理 pending 记录，避免图库残留 0 字节占位
            try {
                cr.delete(uri, null, null);
            } catch (Exception cleanupError) {
                Log.w(TAG, "失败清理 pending 记录失败: " + uri);
            }
            throw e;
        }
        // 清 pending → 对图库可见；复位失败 = 图停留 pending（图库不可见），必须留痕
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        if (cr.update(uri, done, null, null) == 0) {
            Log.w(TAG, "IS_PENDING 复位失败（图库可能不可见，字节已写入）: " + uri);
        }
        return new SaveResult(uri, true);
    }

    private static OutputStream openMediaStoreOutput(ContentResolver cr, Uri uri) throws IOException {
        OutputStream out = cr.openOutputStream(uri);
        if (out == null) {
            throw new IOException("保存失败：媒体库输出流打开失败");
        }
        return out;
    }

    /** MediaStore 插入 values（包可见纯构造，测试锚定字段契约——spec §6） */
    static ContentValues buildImageValues(String displayName, String mime) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, RELATIVE_PATH);
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        return values;
    }

    /** Downloads 插入 values（包可见纯构造，测试锚定字段契约） */
    static ContentValues buildDownloadValues(String displayName, String mime) {
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH,
                Environment.DIRECTORY_DOWNLOADS + "/Pictelio");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);
        return values;
    }

    // ── API 28：应用专属外部目录 + MediaScanner 尽力入库 ──────

    private static SaveResult saveToFallbackDir(Context app, File source, String displayName,
            String mime) throws IOException {
        return saveToFallbackDir(app, source, displayName, mime,
                Environment.DIRECTORY_PICTURES, FALLBACK_DIR_NAME);
    }

    private static SaveResult saveToFallbackDir(Context app, File source, String displayName,
            String mime, String dirType, String subDirName) throws IOException {
        File picturesDir = app.getExternalFilesDir(dirType);
        if (picturesDir == null) {
            throw new IOException("保存失败：外部存储不可用");
        }
        File dir = new File(picturesDir, subDirName);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("保存失败：无法创建目录 " + dir);
        }
        File dest = new File(dir, displayName);
        File tmp = new File(dir, displayName + ".tmp");
        try (InputStream in = new FileInputStream(source);
             FileOutputStream out = new FileOutputStream(tmp)) {
            copy(in, out);
        } catch (IOException e) {
            // 失败清理 tmp，目标保持原内容（对齐 PixivImageLoader.writeFile 纪律）
            if (!tmp.delete()) {
                Log.w(TAG, "tmp 清理失败: " + tmp);
            }
            throw e;
        }
        if (!tmp.renameTo(dest)) {
            if (!tmp.delete()) {
                Log.w(TAG, "tmp 清理失败: " + tmp);
            }
            throw new IOException("保存失败：rename " + tmp + " -> " + dest);
        }
        // 尽力让图库索引（API 28 无 RELATIVE_PATH，扫描入库是唯一可见途径）
        MediaScannerConnection.scanFile(app, new String[]{dest.getAbsolutePath()},
                new String[]{mime}, null);
        return new SaveResult(Uri.fromFile(dest), false);
    }

    // ── 纯函数（文件名清洗 / ext / mime，测试锚定——spec §6） ──

    /**
     * 防御性清洗 JS 生成的文件名：路径分隔符与控制字符替换为下划线（防路径穿越），
     * 去首尾空白；清洗后为空视为契约破坏（可读失败，不静默兜底）。
     */
    static String sanitizeFileName(String fileName) throws IOException {
        if (fileName == null) {
            throw new IOException("保存失败：文件名为空");
        }
        String cleaned = fileName.replaceAll("[/\\\\\\x00-\\x1f]", "_").trim();
        if (cleaned.isEmpty()) {
            throw new IOException("保存失败：文件名非法「" + fileName + "」");
        }
        return cleaned;
    }

    /** 扩展名推断：取 URL 路径尾段（剥离 query），白名单外一律 jpg */
    static String extFor(String url) {
        String path = url;
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        if (dot < 0 || dot < slash) {
            return "jpg";
        }
        String ext = path.substring(dot + 1).toLowerCase(Locale.US);
        switch (ext) {
            case "jpg":
            case "jpeg":
            case "png":
            case "gif":
            case "webp":
                return ext;
            default:
                return "jpg";
        }
    }

    /**
     * mime 映射：图片（jpg/jpeg/png/apng/gif/webp）+ 非图片产物（mp4/zip/tar）；
     * 未知回落 image/jpeg（保持既有契约）。注意不能复用 extFor——后者是图片 URL 白名单。
     */
    static String mimeFor(String fileNameOrUrl) {
        String path = fileNameOrUrl == null ? "" : fileNameOrUrl;
        int q = path.indexOf('?');
        if (q >= 0) {
            path = path.substring(0, q);
        }
        int dot = path.lastIndexOf('.');
        int slash = path.lastIndexOf('/');
        String ext = (dot < 0 || dot < slash) ? "" : path.substring(dot + 1).toLowerCase(Locale.US);
        switch (ext) {
            case "png":
            case "apng":
                return "image/png";
            case "gif":
                return "image/gif";
            case "webp":
                return "image/webp";
            case "mp4":
                return "video/mp4";
            case "zip":
                return "application/zip";
            case "tar":
                return "application/x-tar";
            case "jpeg":
            case "jpg":
            default:
                return "image/jpeg";
        }
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) != -1) {
            out.write(buf, 0, n);
        }
    }
}
