package io.pictelio.app;

import android.graphics.Bitmap;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

/**
 * 动图 WebP 编码器（spec docs/specs/download-manager.md §6；main sourceSet 双引擎共享）。
 *
 * <p>方案（无需 NDK/预编译 .so）：每帧经 {@link Bitmap#compress}（设备内置 libwebp）产出
 * 单帧 WebP → 抽取其 ALPH/VP8/VP8L chunk → 纯 Java 组装动图容器
 * （RIFF/WEBP + VP8X(animation) + ANIM + 每帧 ANMF）。容器组装（{@link #buildAnimatedWebp}）
 * 与帧抽取（{@link #extractFramePayload}）为纯函数，JVM 可单测；Bitmap 压缩路径由设备批次验收。
 *
 * <p>限制：无有效帧/非法尺寸/非 RIFF 输入抛可读 IOException（无静默降级）。
 */
public final class WebpEncoder {

    private static final int WEBP_QUALITY = 90;
    private static final int ANIMATION_FLAG = 0x02;

    private WebpEncoder() {}

    /** 编码动图 WebP：ARGB 帧 + 延时（缺省 100ms）。 */
    public static byte[] encode(List<int[]> frames, int width, int height, int[] delaysMs)
            throws IOException {
        if (frames == null || frames.isEmpty()) {
            throw new IOException("WebP 编码失败：无帧");
        }
        if (width <= 0 || height <= 0) {
            throw new IOException("WebP 编码失败：尺寸非法 " + width + "x" + height);
        }
        List<byte[]> payloads = new ArrayList<>();
        for (int[] px : frames) {
            if (px.length != width * height) {
                throw new IOException("WebP 编码失败：帧像素数不符");
            }
            Bitmap bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888);
            bmp.setPixels(px, 0, width, 0, 0, width, height);
            ByteArrayOutputStream baos = new ByteArrayOutputStream();
            boolean ok = bmp.compress(Bitmap.CompressFormat.WEBP, WEBP_QUALITY, baos);
            bmp.recycle();
            if (!ok) {
                throw new IOException("WebP 编码失败：设备内置 WebP 编码器失败");
            }
            payloads.add(extractFramePayload(baos.toByteArray()));
        }
        return buildAnimatedWebp(payloads, width, height, delaysMs);
    }

    /**
     * 从单帧 WebP 抽取可作为 ANMF 帧数据的 chunk 序列：ALPH（可选）+ VP8/VP8L（含 chunk 头）。
     * 跳过 VP8X/ICCP/EXIF/XMP 等容器级 chunk。
     */
    static byte[] extractFramePayload(byte[] webp) throws IOException {
        if (webp == null || webp.length < 12
                || !fourcc(webp, 0).equals("RIFF") || !fourcc(webp, 8).equals("WEBP")) {
            throw new IOException("WebP 编码失败：非法 RIFF/WEBP");
        }
        ByteArrayOutputStream payload = new ByteArrayOutputStream();
        boolean hasVp8 = false;
        int off = 12;
        while (off + 8 <= webp.length) {
            String cc = fourcc(webp, off);
            long size = u32(webp, off + 4);
            if (size < 0 || off + 8 + size > webp.length) {
                break;
            }
            if (cc.equals("ALPH") || cc.equals("VP8 ") || cc.equals("VP8L")) {
                int end = off + 8 + (int) size;
                int padded = end + (((int) size & 1) == 1 ? 1 : 0);
                padded = Math.min(padded, webp.length);
                payload.write(webp, off, padded - off);
                if (cc.equals("VP8 ") || cc.equals("VP8L")) {
                    hasVp8 = true;
                }
            }
            off += 8 + (int) size + (((int) size & 1) == 1 ? 1 : 0);
        }
        if (!hasVp8) {
            throw new IOException("WebP 编码失败：单帧缺少 VP8/VP8L");
        }
        return payload.toByteArray();
    }

    /** 组装动图 WebP 容器（RIFF/WEBP + VP8X + ANIM + ANMF×N）。 */
    static byte[] buildAnimatedWebp(List<byte[]> payloads, int width, int height, int[] delaysMs)
            throws IOException {
        if (payloads == null || payloads.isEmpty()) {
            throw new IOException("WebP 编码失败：无帧");
        }
        if (width <= 0 || height <= 0) {
            throw new IOException("WebP 编码失败：尺寸非法 " + width + "x" + height);
        }
        ByteArrayOutputStream body = new ByteArrayOutputStream();

        byte[] vp8x = new byte[10];
        vp8x[0] = (byte) ANIMATION_FLAG;
        putU24(vp8x, 4, width - 1);
        putU24(vp8x, 7, height - 1);
        writeChunk(body, "VP8X", vp8x);

        byte[] anim = new byte[6]; // 背景色 0（透明）+ 循环 0（无限）
        writeChunk(body, "ANIM", anim);

        for (int i = 0; i < payloads.size(); i++) {
            int delay = (delaysMs != null && i < delaysMs.length) ? delaysMs[i] : 100;
            ByteArrayOutputStream frame = new ByteArrayOutputStream();
            byte[] hdr = new byte[16];
            putU24(hdr, 0, 0);          // frame x
            putU24(hdr, 3, 0);          // frame y
            putU24(hdr, 6, width - 1);
            putU24(hdr, 9, height - 1);
            putU24(hdr, 12, Math.max(0, Math.min(0xffffff, delay)));
            hdr[15] = 0;                // blend=0(alpha blend) | disposal=0(none)
            frame.write(hdr);
            frame.write(payloads.get(i));
            writeChunk(body, "ANMF", frame.toByteArray());
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write("RIFF".getBytes(StandardCharsets.US_ASCII));
        writeU32(out, 4 + body.size());
        out.write("WEBP".getBytes(StandardCharsets.US_ASCII));
        body.writeTo(out);
        return out.toByteArray();
    }

    // ── 工具 ──────────────────────────────────────────────────

    private static void writeChunk(OutputStream out, String cc, byte[] data) throws IOException {
        out.write(cc.getBytes(StandardCharsets.US_ASCII));
        writeU32(out, data.length);
        out.write(data);
        if ((data.length & 1) == 1) {
            out.write(0);
        }
    }

    private static void writeU32(OutputStream out, int v) throws IOException {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
        out.write((v >> 16) & 0xff);
        out.write((v >> 24) & 0xff);
    }

    private static void putU24(byte[] b, int off, int v) {
        b[off] = (byte) (v & 0xff);
        b[off + 1] = (byte) ((v >> 8) & 0xff);
        b[off + 2] = (byte) ((v >> 16) & 0xff);
    }

    private static String fourcc(byte[] b, int off) {
        return new String(b, off, 4, StandardCharsets.US_ASCII);
    }

    private static long u32(byte[] b, int off) {
        return (b[off] & 0xffL) | ((b[off + 1] & 0xffL) << 8)
                | ((b[off + 2] & 0xffL) << 16) | ((b[off + 3] & 0xffL) << 24);
    }
}
