package io.pictelio.app;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * ugoira 导出深模块（spec docs/specs/download-manager.md §6；main sourceSet 双引擎共享）。
 *
 * <p>输入：Pixiv ugoira 源 ZIP（帧 PNG）；输出：目标格式文件（cache 目录，供
 * {@link GallerySaver#saveDownloadFile} 落盘）。已支持：
 * <ul>
 *   <li>{@code zip}：原样拷贝源 ZIP；</li>
 *   <li>{@code tar}：ZIP 内普通文件按 ustar 打包；</li>
 *   <li>{@code apng}：按帧时序重排 PNG chunk（IHDR + acTL + fcTL + IDAT + fcTL/fdAT + IEND）。</li>
 * </ul>
 * GIF/MP4/WebP 在后续 ticket 接入。编解码全在 Java（ADR-0146 D1：字节不进 JS 堆）。
 * 帧时序来自 JS 透传的 framesJson：[{"file":"frame_0.png","delay":60}, ...]（缺省用 100ms/帧并 warn）。
 */
public final class UgoiraExporter {

    private static final String TAG = "UgoiraExporter";
    private static final int TAR_BLOCK = 512;
    private static final int APNG_FDAT_CHUNK = 65536;
    private static final String EXPORT_DIR = "pictelio-ugoira-export";
    private static final byte[] PNG_SIGNATURE =
            {(byte) 0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a};

    private UgoiraExporter() {}

    /** 帧时序（与 @pictelio/ugoira / Pixiv 元数据 frames[] 同形） */
    public static final class FrameTiming {
        public final String file;
        public final long delayMs;

        FrameTiming(String file, long delayMs) {
            this.file = file;
            this.delayMs = delayMs;
        }
    }

    /**
     * 导出源 ZIP 到目标格式文件（cache），返回输出文件。
     *
     * @param framesJson 帧时序 JSON（可为 null/空 → APNG 用默认 100ms/帧）
     */
    public static File export(Context context, File zipFile, String format, String id,
            String framesJson) throws IOException {
        if (format == null || format.isEmpty()) {
            throw new IOException("导出失败：格式为空");
        }
        if (zipFile == null || !zipFile.exists()) {
            throw new IOException("导出失败：源 ZIP 不存在");
        }
        File dir = new File(context.getCacheDir(), EXPORT_DIR);
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IOException("导出失败：无法创建目录 " + dir);
        }
        File out = new File(dir, id + "." + format);
        switch (format) {
            case "zip":
                copyFile(zipFile, out);
                break;
            case "tar":
                writeTar(zipFile, out);
                break;
            case "apng":
                writeApng(zipFile, out, framesJson);
                break;
            case "gif":
                writeGif(zipFile, out, framesJson);
                break;
            case "mp4":
                writeMp4(zipFile, out, framesJson);
                break;
            case "webp":
                writeWebp(zipFile, out, framesJson);
                break;
            default:
                throw new IOException("暂不支持的导出格式: " + format);
        }
        return out;
    }

    // ── ZIP / TAR ─────────────────────────────────────────────

    private static void copyFile(File src, File dst) throws IOException {
        try (InputStream in = new FileInputStream(src); OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
        }
    }

    /** ZIP → TAR（ustar）：ZipFile 读中央目录（size 可靠），逐条目 512 对齐，双零块收尾。 */
    static void writeTar(File zipFile, File out) throws IOException {
        try (ZipFile zf = new ZipFile(zipFile); OutputStream tar = new FileOutputStream(out)) {
            Enumeration<? extends ZipEntry> entries = zf.entries();
            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();
                if (entry.isDirectory()) {
                    continue;
                }
                long size = entry.getSize();
                if (size < 0) {
                    throw new IOException("导出失败：条目大小未知 " + entry.getName());
                }
                long mtimeSec = entry.getTime() / 1000L;
                writeTarHeader(tar, entry.getName(), size, mtimeSec < 0 ? 0 : mtimeSec);
                long written = 0;
                try (InputStream in = zf.getInputStream(entry)) {
                    byte[] buf = new byte[8192];
                    int n;
                    while ((n = in.read(buf)) != -1) {
                        tar.write(buf, 0, n);
                        written += n;
                    }
                }
                if (written != size) {
                    throw new IOException("导出失败：条目长度不符 " + entry.getName());
                }
                padToBlock(tar, written);
            }
            tar.write(new byte[TAR_BLOCK * 2]);
        }
    }

    private static void writeTarHeader(OutputStream out, String name, long size, long mtimeSec)
            throws IOException {
        byte[] nameBytes = name.getBytes(StandardCharsets.UTF_8);
        if (nameBytes.length > 100) {
            throw new IOException("导出失败：TAR 条目名过长 " + name);
        }
        byte[] h = new byte[TAR_BLOCK];
        System.arraycopy(nameBytes, 0, h, 0, nameBytes.length);
        putOctal(h, 100, 8, 0L);
        putOctal(h, 108, 8, 0L);
        putOctal(h, 116, 8, 0L);
        putOctal(h, 124, 12, size);
        putOctal(h, 136, 12, mtimeSec);
        for (int i = 148; i < 156; i++) {
            h[i] = ' ';
        }
        h[156] = '0';
        byte[] magic = "ustar".getBytes(StandardCharsets.US_ASCII);
        System.arraycopy(magic, 0, h, 257, 5);
        h[262] = 0;
        h[263] = '0';
        h[264] = '0';
        int sum = 0;
        for (byte b : h) {
            sum += (b & 0xff);
        }
        putOctal(h, 148, 8, sum);
        out.write(h);
    }

    private static void putOctal(byte[] h, int off, int len, long value) {
        for (int i = 0; i < len - 1; i++) {
            h[off + len - 2 - i] = (byte) ('0' + (int) ((value >> (3 * i)) & 7));
        }
        h[off + len - 1] = 0;
    }

    private static void padToBlock(OutputStream out, long written) throws IOException {
        int rem = (int) (written % TAR_BLOCK);
        if (rem != 0) {
            out.write(new byte[TAR_BLOCK - rem]);
        }
    }

    // ── APNG ──────────────────────────────────────────────────

    private static final class Chunk {
        final String type;
        final byte[] data;

        Chunk(String type, byte[] data) {
            this.type = type;
            this.data = data;
        }
    }

    private static final class PngFrame {
        byte[] ihdrData;
        final List<Chunk> preIdat = new ArrayList<>();
        byte[] idatData;
    }

    /**
     * ZIP → APNG：首帧携带原 PNG 的 IHDR/前置 chunk 与 IDAT，后续帧以 fcTL + fdAT 追加；
     * 帧序与时序取 framesJson（缺省退回 ZIP 条目序 + 100ms/帧并 warn）。
     */
    static void writeApng(File zipFile, File out, String framesJson) throws IOException {
        List<FrameTiming> timings = parseFrames(framesJson);
        try (ZipFile zf = new ZipFile(zipFile); OutputStream os = new FileOutputStream(out)) {
            List<String> order = new ArrayList<>();
            Map<String, Long> delays = new LinkedHashMap<>();
            if (!timings.isEmpty()) {
                for (FrameTiming ft : timings) {
                    order.add(ft.file);
                    delays.put(ft.file, ft.delayMs);
                }
            } else {
                Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    if (!e.isDirectory()) {
                        order.add(e.getName());
                        delays.put(e.getName(), 100L);
                    }
                }
                Log.w(TAG, "APNG 缺少帧时序，使用默认 100ms/帧");
            }
            if (order.isEmpty()) {
                throw new IOException("导出失败：无帧");
            }
            PngFrame first = readPng(zf, order.get(0));
            os.write(PNG_SIGNATURE);
            for (Chunk c : first.preIdat) {
                writeChunk(os, c.type, c.data);
            }
            writeChunk(os, "acTL", acTLData(order.size()));
            int[] seq = {0};
            writeChunk(os, "fcTL", fcTLData(seq[0]++, first.ihdrData, delayOf(delays, order.get(0))));
            writeChunk(os, "IDAT", first.idatData);
            for (int i = 1; i < order.size(); i++) {
                PngFrame frame = readPng(zf, order.get(i));
                writeChunk(os, "fcTL",
                        fcTLData(seq[0]++, first.ihdrData, delayOf(delays, order.get(i))));
                byte[] data = frame.idatData;
                int offset = 0;
                while (offset < data.length) {
                    int len = Math.min(APNG_FDAT_CHUNK, data.length - offset);
                    byte[] fd = new byte[4 + len];
                    writeInt(fd, 0, seq[0]++);
                    System.arraycopy(data, offset, fd, 4, len);
                    writeChunk(os, "fdAT", fd);
                    offset += len;
                }
            }
            writeChunk(os, "IEND", new byte[0]);
        }
    }

    /** ZIP → GIF89a 动画：BitmapFactory 解码帧 ARGB → {@link GifEncoder}（固定调色板 + LZW）。 */
    static void writeGif(File zipFile, File out, String framesJson) throws IOException {
        List<FrameTiming> timings = parseFrames(framesJson);
        try (ZipFile zf = new ZipFile(zipFile)) {
            List<String> order = new ArrayList<>();
            Map<String, Long> delays = new LinkedHashMap<>();
            if (!timings.isEmpty()) {
                for (FrameTiming ft : timings) {
                    order.add(ft.file);
                    delays.put(ft.file, ft.delayMs);
                }
            } else {
                Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    if (!e.isDirectory()) {
                        order.add(e.getName());
                        delays.put(e.getName(), 100L);
                    }
                }
                Log.w(TAG, "GIF 缺少帧时序，使用默认 100ms/帧");
            }
            if (order.isEmpty()) {
                throw new IOException("导出失败：无帧");
            }
            List<int[]> frames = new ArrayList<>();
            int width = -1;
            int height = -1;
            for (String name : order) {
                byte[] encoded = readEntry(zf, name);
                Bitmap bmp = BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
                if (bmp == null || bmp.getWidth() <= 0 || bmp.getHeight() <= 0) {
                    throw new IOException("导出失败：无法解码帧 " + name);
                }
                if (width < 0) {
                    width = bmp.getWidth();
                    height = bmp.getHeight();
                } else if (bmp.getWidth() != width || bmp.getHeight() != height) {
                    bmp.recycle();
                    throw new IOException("导出失败：帧尺寸不一致 " + name);
                }
                int[] px = new int[width * height];
                bmp.getPixels(px, 0, width, 0, 0, width, height);
                bmp.recycle();
                frames.add(px);
            }
            int[] delayArr = new int[order.size()];
            for (int i = 0; i < order.size(); i++) {
                delayArr[i] = delayOf(delays, order.get(i));
            }
            byte[] gif = GifEncoder.encode(frames, width, height, delayArr);
            try (OutputStream os = new FileOutputStream(out)) {
                os.write(gif);
            }
        }
    }

    /** ZIP → 动图 WebP：BitmapFactory 解码帧 ARGB → {@link WebpEncoder}。 */
    static void writeWebp(File zipFile, File out, String framesJson) throws IOException {
        List<FrameTiming> timings = parseFrames(framesJson);
        try (ZipFile zf = new ZipFile(zipFile)) {
            List<String> order = new ArrayList<>();
            Map<String, Long> delays = new LinkedHashMap<>();
            if (!timings.isEmpty()) {
                for (FrameTiming ft : timings) {
                    order.add(ft.file);
                    delays.put(ft.file, ft.delayMs);
                }
            } else {
                Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    if (!e.isDirectory()) {
                        order.add(e.getName());
                        delays.put(e.getName(), 100L);
                    }
                }
                Log.w(TAG, "WebP 缺少帧时序，使用默认 100ms/帧");
            }
            if (order.isEmpty()) {
                throw new IOException("导出失败：无帧");
            }
            List<int[]> frames = new ArrayList<>();
            int width = -1;
            int height = -1;
            for (String name : order) {
                byte[] encoded = readEntry(zf, name);
                Bitmap bmp = BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
                if (bmp == null || bmp.getWidth() <= 0 || bmp.getHeight() <= 0) {
                    throw new IOException("导出失败：无法解码帧 " + name);
                }
                if (width < 0) {
                    width = bmp.getWidth();
                    height = bmp.getHeight();
                } else if (bmp.getWidth() != width || bmp.getHeight() != height) {
                    bmp.recycle();
                    throw new IOException("导出失败：帧尺寸不一致 " + name);
                }
                int[] px = new int[width * height];
                bmp.getPixels(px, 0, width, 0, 0, width, height);
                bmp.recycle();
                frames.add(px);
            }
            int[] delayArr = new int[order.size()];
            for (int i = 0; i < order.size(); i++) {
                delayArr[i] = delayOf(delays, order.get(i));
            }
            byte[] webp = WebpEncoder.encode(frames, width, height, delayArr);
            try (OutputStream os = new FileOutputStream(out)) {
                os.write(webp);
            }
        }
    }

    /** ZIP → MP4(H.264)：BitmapFactory 解码帧 ARGB → {@link Mp4Encoder}。 */
    static void writeMp4(File zipFile, File out, String framesJson) throws IOException {
        List<FrameTiming> timings = parseFrames(framesJson);
        try (ZipFile zf = new ZipFile(zipFile)) {
            List<String> order = new ArrayList<>();
            Map<String, Long> delays = new LinkedHashMap<>();
            if (!timings.isEmpty()) {
                for (FrameTiming ft : timings) {
                    order.add(ft.file);
                    delays.put(ft.file, ft.delayMs);
                }
            } else {
                Enumeration<? extends ZipEntry> en = zf.entries();
                while (en.hasMoreElements()) {
                    ZipEntry e = en.nextElement();
                    if (!e.isDirectory()) {
                        order.add(e.getName());
                        delays.put(e.getName(), 100L);
                    }
                }
                Log.w(TAG, "MP4 缺少帧时序，使用默认 100ms/帧");
            }
            if (order.isEmpty()) {
                throw new IOException("导出失败：无帧");
            }
            List<int[]> frames = new ArrayList<>();
            int width = -1;
            int height = -1;
            for (String name : order) {
                byte[] encoded = readEntry(zf, name);
                Bitmap bmp = BitmapFactory.decodeByteArray(encoded, 0, encoded.length);
                if (bmp == null || bmp.getWidth() <= 0 || bmp.getHeight() <= 0) {
                    throw new IOException("导出失败：无法解码帧 " + name);
                }
                if (width < 0) {
                    width = bmp.getWidth();
                    height = bmp.getHeight();
                } else if (bmp.getWidth() != width || bmp.getHeight() != height) {
                    bmp.recycle();
                    throw new IOException("导出失败：帧尺寸不一致 " + name);
                }
                int[] px = new int[width * height];
                bmp.getPixels(px, 0, width, 0, 0, width, height);
                bmp.recycle();
                frames.add(px);
            }
            int[] delayArr = new int[order.size()];
            for (int i = 0; i < order.size(); i++) {
                delayArr[i] = delayOf(delays, order.get(i));
            }
            Mp4Encoder.encode(frames, width, height, delayArr, out);
        }
    }

    private static byte[] readEntry(ZipFile zf, String name) throws IOException {
        ZipEntry entry = zf.getEntry(name);
        if (entry == null) {
            throw new IOException("导出失败：缺少帧文件 " + name);
        }
        try (InputStream in = zf.getInputStream(entry)) {
            ByteArrayOutputStream bos = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) != -1) {
                bos.write(buf, 0, n);
            }
            return bos.toByteArray();
        }
    }

    private static int delayOf(Map<String, Long> delays, String file) {
        Long d = delays.get(file);
        long v = d == null ? 100L : d;
        return (int) Math.max(1, Math.min(65535, v));
    }

    private static byte[] acTLData(int frames) {
        byte[] d = new byte[8];
        writeInt(d, 0, frames);
        writeInt(d, 4, 0);
        return d;
    }

    private static byte[] fcTLData(int seq, byte[] ihdr, int delayMs) {
        byte[] d = new byte[26];
        writeInt(d, 0, seq);
        writeInt(d, 4, readInt(ihdr, 0));
        writeInt(d, 8, readInt(ihdr, 4));
        writeInt(d, 12, 0);
        writeInt(d, 16, 0);
        int num = Math.max(1, delayMs);
        d[20] = (byte) ((num >>> 8) & 0xff);
        d[21] = (byte) (num & 0xff);
        d[22] = (byte) ((1000 >>> 8) & 0xff);
        d[23] = (byte) (1000 & 0xff);
        d[24] = 0;
        d[25] = 0;
        return d;
    }

    /**
     * 读取一帧为 PNG chunk 形式：源帧本就是 PNG 直接解析；若是 JPEG（Pixiv ugoira 帧常见）
     * 等非 PNG，先用 BitmapFactory 解码再无损重编码为 PNG，再解析（APNG 要求帧为 PNG）。
     */
    private static PngFrame readPng(ZipFile zf, String name) throws IOException {
        byte[] bytes = readEntry(zf, name);
        if (bytes.length >= 8 && Arrays.equals(Arrays.copyOf(bytes, 8), PNG_SIGNATURE)) {
            return parsePng(new ByteArrayInputStream(bytes));
        }
        Bitmap bmp = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bmp == null) {
            throw new IOException("导出失败：无法解码帧 " + name);
        }
        ByteArrayOutputStream png = new ByteArrayOutputStream();
        boolean ok = bmp.compress(Bitmap.CompressFormat.PNG, 100, png);
        bmp.recycle();
        if (!ok) {
            throw new IOException("导出失败：帧重编码 PNG 失败 " + name);
        }
        return parsePng(new ByteArrayInputStream(png.toByteArray()));
    }

    private static PngFrame parsePng(InputStream in) throws IOException {
        byte[] sig = readN(in, 8);
        if (!Arrays.equals(sig, PNG_SIGNATURE)) {
            throw new IOException("导出失败：帧不是合法 PNG");
        }
        PngFrame frame = new PngFrame();
        ByteArrayOutputStream idat = new ByteArrayOutputStream();
        boolean sawIdat = false;
        while (true) {
            byte[] lenB = readN(in, 4);
            int len = readInt(lenB, 0);
            String type = new String(readN(in, 4), StandardCharsets.US_ASCII);
            byte[] data = readN(in, len);
            readN(in, 4);
            if ("IEND".equals(type)) {
                break;
            }
            if ("IDAT".equals(type)) {
                sawIdat = true;
                idat.write(data);
            } else if (!sawIdat) {
                if ("IHDR".equals(type)) {
                    frame.ihdrData = data;
                }
                frame.preIdat.add(new Chunk(type, data));
            }
        }
        if (frame.ihdrData == null) {
            throw new IOException("导出失败：帧缺少 IHDR");
        }
        frame.idatData = idat.toByteArray();
        if (frame.idatData.length == 0) {
            throw new IOException("导出失败：帧缺少 IDAT");
        }
        return frame;
    }

    private static void writeChunk(OutputStream out, String type, byte[] data) throws IOException {
        byte[] typeBytes = type.getBytes(StandardCharsets.US_ASCII);
        writeInt(out, data.length);
        out.write(typeBytes);
        out.write(data);
        CRC32 crc = new CRC32();
        crc.update(typeBytes);
        crc.update(data);
        writeInt(out, (int) crc.getValue());
    }

    private static void writeInt(OutputStream out, int v) throws IOException {
        out.write(new byte[]{(byte) (v >>> 24), (byte) (v >>> 16), (byte) (v >>> 8), (byte) v});
    }

    private static void writeInt(byte[] b, int off, int v) {
        b[off] = (byte) (v >>> 24);
        b[off + 1] = (byte) (v >>> 16);
        b[off + 2] = (byte) (v >>> 8);
        b[off + 3] = (byte) v;
    }

    private static int readInt(byte[] b, int off) {
        return ((b[off] & 0xff) << 24) | ((b[off + 1] & 0xff) << 16)
                | ((b[off + 2] & 0xff) << 8) | (b[off + 3] & 0xff);
    }

    private static byte[] readN(InputStream in, int n) throws IOException {
        byte[] buf = new byte[n];
        int read = 0;
        while (read < n) {
            int r = in.read(buf, read, n - read);
            if (r < 0) {
                throw new IOException("导出失败：PNG 数据截断");
            }
            read += r;
        }
        return buf;
    }

    /** 解析帧时序 JSON；非法/空 → 空列表（调用方退回默认）。 */
    static List<FrameTiming> parseFrames(String framesJson) {
        List<FrameTiming> out = new ArrayList<>();
        if (framesJson == null || framesJson.isEmpty()) {
            return out;
        }
        try {
            JSONArray arr = new JSONArray(framesJson);
            for (int i = 0; i < arr.length(); i++) {
                JSONObject o = arr.optJSONObject(i);
                if (o == null) {
                    continue;
                }
                String file = o.optString("file", null);
                long delay = o.optLong("delay", 100L);
                if (file != null && !file.isEmpty()) {
                    out.add(new FrameTiming(file, delay));
                }
            }
        } catch (Exception e) {
            Log.w(TAG, "帧时序解析失败，退回默认", e);
        }
        return out;
    }
}
