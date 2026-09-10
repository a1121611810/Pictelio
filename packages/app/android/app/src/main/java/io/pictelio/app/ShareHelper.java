package io.pictelio.app;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * 系统分享深模块（spec docs/specs/download-manager.md §4.1/§7；main sourceSet 双引擎共享）。
 *
 * <p>职责：把已下载文件的 uri 列表转成系统分享 Intent。
 * <ul>
 *   <li>{@code content://}（MediaStore 产物）直用；{@code file://}（API 28 回退产物）经
 *       {@link FileProvider} 转 {@code content://}（Android 7+ 禁 file:// 外泄，否则 FileUriExposedException）；</li>
 *   <li>单条 {@code ACTION_SEND} / 多条 {@code ACTION_SEND_MULTIPLE}；授予读权限；</li>
 *   <li>mime：显式优先，其次 content resolver，最后按扩展名白名单，未知回落 octet-stream。</li>
 * </ul>
 * 调用方（PictelioSharePlugin / PictelioShareModule）负责 startActivity 与线程。
 */
public final class ShareHelper {

    private ShareHelper() {}

    /** 构造分享 Intent（未启动 Activity）；uri 非法/为空/不支持 scheme 抛 IOException（消息可读）。 */
    public static Intent buildIntent(Context context, List<String> uriStrings, String mime)
            throws IOException {
        if (uriStrings == null || uriStrings.isEmpty()) {
            throw new IOException("分享失败：文件列表为空");
        }
        List<Uri> uris = new ArrayList<>();
        for (String raw : uriStrings) {
            uris.add(toShareableUri(context, raw));
        }
        String resolvedMime = (mime != null && !mime.isEmpty()) ? mime : resolveMime(context, uris.get(0));
        Intent intent;
        if (uris.size() == 1) {
            intent = new Intent(Intent.ACTION_SEND);
            intent.putExtra(Intent.EXTRA_STREAM, uris.get(0));
        } else {
            intent = new Intent(Intent.ACTION_SEND_MULTIPLE);
            intent.putParcelableArrayListExtra(Intent.EXTRA_STREAM, new ArrayList<>(uris));
        }
        intent.setType(resolvedMime);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        return intent;
    }

    /** content:// 直用；file:// 经 FileProvider 转 content://；其他 scheme 拒绝。 */
    static Uri toShareableUri(Context context, String raw) throws IOException {
        if (raw == null || raw.isEmpty()) {
            throw new IOException("分享失败：uri 为空");
        }
        Uri uri = Uri.parse(raw);
        String scheme = uri.getScheme();
        if ("content".equals(scheme)) {
            return uri;
        }
        if ("file".equals(scheme)) {
            String path = uri.getPath();
            if (path == null || path.isEmpty()) {
                throw new IOException("分享失败：文件路径为空 " + raw);
            }
            File file = new File(path);
            if (!file.exists()) {
                throw new IOException("分享失败：文件不存在 " + raw);
            }
            return FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
        }
        throw new IOException("分享失败：不支持的 uri「" + raw + "」");
    }

    private static String resolveMime(Context context, Uri uri) {
        if ("content".equals(uri.getScheme())) {
            String type = context.getContentResolver().getType(uri);
            if (type != null && !type.isEmpty()) {
                return type;
            }
        }
        return mimeForUri(uri);
    }

    /** uri 尾段 → mime（非 content uri 的兜底） */
    public static String mimeForUri(Uri uri) {
        return mimeForName(uri == null ? null : uri.getLastPathSegment());
    }

    /** 文件名/路径 → mime（白名单，未知回落 application/octet-stream） */
    static String mimeForName(String nameOrPath) {
        if (nameOrPath == null) {
            return "application/octet-stream";
        }
        int dot = nameOrPath.lastIndexOf('.');
        if (dot < 0) {
            return "application/octet-stream";
        }
        String ext = nameOrPath.substring(dot + 1).toLowerCase(Locale.US);
        switch (ext) {
            case "jpg":
            case "jpeg":
                return "image/jpeg";
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
            default:
                return "application/octet-stream";
        }
    }
}
