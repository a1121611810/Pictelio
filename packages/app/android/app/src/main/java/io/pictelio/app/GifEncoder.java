package io.pictelio.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * GIF89a 动画编码器（spec docs/specs/download-manager.md §6；main sourceSet 双引擎共享）。
 *
 * <p>纯函数（输入 ARGB 像素帧 + 延时 → GIF 字节），不触 Android API，JVM 可测。
 * 调色板用固定 6×6×6 Web-Safe（216 色）+ 索引 216 = 透明；每帧全幅重绘
 * （disposal=NONE, transparent flag）。所有帧共享一个全局调色板；循环次数无限。
 *
 * <p>已知取舍：固定调色板牺牲部分色彩精度换取实现简单与确定性；后续如需可换中位切分。
 */
public final class GifEncoder {

    private static final int PALETTE_LEVELS = 6;
    private static final int PALETTE_SIZE = 216;          // 6^3
    private static final int TRANSPARENT_INDEX = 216;

    private GifEncoder() {}

    /**
     * 编码 GIF89a。
     *
     * @param frames   每帧 ARGB 像素（长度 = width*height）
     * @param delaysMs 每帧延时（毫秒；长度不足用 100ms 兜底）
     */
    public static byte[] encode(List<int[]> frames, int width, int height, int[] delaysMs)
            throws IOException {
        if (frames == null || frames.isEmpty()) {
            throw new IOException("GIF 编码失败：无帧");
        }
        if (width <= 0 || height <= 0) {
            throw new IOException("GIF 编码失败：尺寸非法 " + width + "x" + height);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write("GIF89a".getBytes("US-ASCII"));
        writeLogicalScreenDescriptor(out, width, height);
        writeGlobalColorTable(out);
        writeNetscapeLoop(out);

        for (int i = 0; i < frames.size(); i++) {
            int[] pixels = frames.get(i);
            if (pixels.length != width * height) {
                throw new IOException("GIF 编码失败：第 " + i + " 帧像素数不符");
            }
            int delay = (delaysMs != null && i < delaysMs.length) ? delaysMs[i] : 100;
            byte[] indices = quantize(pixels);
            writeGraphicControl(out, delay, TRANSPARENT_INDEX);
            writeImageDescriptor(out, width, height);
            writeLzwImage(out, indices);
        }
        out.write(0x3b);
        return out.toByteArray();
    }

    // ── 结构 ──────────────────────────────────────────────────

    private static void writeLogicalScreenDescriptor(OutputStream out, int width, int height)
            throws IOException {
        writeShort(out, width);
        writeShort(out, height);
        // GCT=1(0x80) | colorRes=7(0x70) | sort=0 | size=7(256 entries)
        out.write(0xf7);
        out.write(0);
        out.write(0);
    }

    private static void writeGlobalColorTable(OutputStream out) throws IOException {
        for (int i = 0; i < 256; i++) {
            if (i < PALETTE_SIZE) {
                int r = (i / 36) % PALETTE_LEVELS;
                int g = (i / 6) % PALETTE_LEVELS;
                int b = i % PALETTE_LEVELS;
                out.write(r * 51);
                out.write(g * 51);
                out.write(b * 51);
            } else {
                out.write(0);
                out.write(0);
                out.write(0);
            }
        }
    }

    private static void writeNetscapeLoop(OutputStream out) throws IOException {
        out.write(0x21);
        out.write(0xff);
        out.write(0x0b);
        out.write("NETSCAPE2.0".getBytes("US-ASCII"));
        out.write(0x03);
        out.write(0x01);
        writeShort(out, 0); // 无限循环
        out.write(0x00);
    }

    private static void writeGraphicControl(OutputStream out, int delayMs, int transparentIndex)
            throws IOException {
        out.write(0x21);
        out.write(0xf9);
        out.write(0x04);
        // disposal=2(0x08) | userInput=0 | transparentFlag=1(0x01)
        out.write(0x09);
        writeShort(out, Math.max(0, Math.min(65535, delayMs / 10))); // GIF 延时单位 = 1/100 s
        out.write(transparentIndex);
        out.write(0x00);
    }

    private static void writeImageDescriptor(OutputStream out, int width, int height)
            throws IOException {
        out.write(0x2c);
        writeShort(out, 0);
        writeShort(out, 0);
        writeShort(out, width);
        writeShort(out, height);
        out.write(0); // 无局部调色板、非隔行
    }

    private static void writeShort(OutputStream out, int v) throws IOException {
        out.write(v & 0xff);
        out.write((v >> 8) & 0xff);
    }

    // ── 量化 ──────────────────────────────────────────────────

    /** ARGB → 调色板索引（alpha<128 → 透明索引；否则 6 级最近色）。 */
    static byte[] quantize(int[] pixels) {
        byte[] out = new byte[pixels.length];
        for (int i = 0; i < pixels.length; i++) {
            int p = pixels[i];
            int a = (p >>> 24) & 0xff;
            if (a < 128) {
                out[i] = (byte) TRANSPARENT_INDEX;
                continue;
            }
            int r = nearestLevel((p >> 16) & 0xff);
            int g = nearestLevel((p >> 8) & 0xff);
            int b = nearestLevel(p & 0xff);
            out[i] = (byte) (r * 36 + g * 6 + b);
        }
        return out;
    }

    private static int nearestLevel(int c) {
        int level = Math.round(c / 51.0f);
        return Math.max(0, Math.min(PALETTE_LEVELS - 1, level));
    }

    // ── GIF LZW ───────────────────────────────────────────────

    private static void writeLzwImage(OutputStream out, byte[] indices) throws IOException {
        final int minCodeSize = 8;
        out.write(minCodeSize);
        final int clearCode = 1 << minCodeSize;
        final int endCode = clearCode + 1;

        ByteArrayOutputStream bits = new ByteArrayOutputStream();
        BitWriter bw = new BitWriter(bits);
        int codeSize = minCodeSize + 1;
        int next = endCode + 1;
        Map<Integer, Integer> table = new HashMap<>();
        bw.write(clearCode, codeSize);
        if (indices.length > 0) {
            int prefix = indices[0] & 0xff;
            for (int i = 1; i < indices.length; i++) {
                int k = indices[i] & 0xff;
                int key = (prefix << 8) | k;
                Integer code = table.get(key);
                if (code != null) {
                    prefix = code;
                    continue;
                }
                bw.write(prefix, codeSize);
                if (next < 4096) {
                    table.put(key, next);
                    next++;
                    if (next > (1 << codeSize) - 1 && codeSize < 12) {
                        codeSize++;
                    }
                } else {
                    bw.write(clearCode, codeSize);
                    table.clear();
                    codeSize = minCodeSize + 1;
                    next = endCode + 1;
                }
                prefix = k;
            }
            bw.write(prefix, codeSize);
        }
        bw.write(endCode, codeSize);
        bw.flush();

        byte[] data = bits.toByteArray();
        int offset = 0;
        while (offset < data.length) {
            int n = Math.min(255, data.length - offset);
            out.write(n);
            out.write(data, offset, n);
            offset += n;
        }
        out.write(0);
    }

    /** GIF LZW 位流写入器（LSB-first） */
    private static final class BitWriter {
        private final OutputStream out;
        private int buf;
        private int bits;

        BitWriter(OutputStream out) {
            this.out = out;
        }

        void write(int code, int size) throws IOException {
            buf |= (code << bits);
            bits += size;
            while (bits >= 8) {
                out.write(buf & 0xff);
                buf >>>= 8;
                bits -= 8;
            }
        }

        void flush() throws IOException {
            if (bits > 0) {
                out.write(buf & 0xff);
                buf = 0;
                bits = 0;
            }
        }
    }
}
