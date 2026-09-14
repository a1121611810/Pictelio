package io.pictelio.app;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 测试用 GIF89a 解码器（spec docs/specs/download-manager.md §6 验 oracle）。
 * 按 GIF 规范独立实现解析 + LZW 解码，与 {@link GifEncoder} 形成差分验证
 * （android.jar 无 javax.imageio，无法用 JDK 解码器）。
 */
final class GifDecode {

    static final class Result {
        int width;
        int height;
        final List<int[]> frames = new ArrayList<>();
        final List<Integer> delays = new ArrayList<>();
    }

    private GifDecode() {}

    static Result decode(byte[] data) throws IOException {
        if (data.length < 13 || !new String(data, 0, 6, "US-ASCII").equals("GIF89a")) {
            throw new IOException("非法 GIF 头");
        }
        Result r = new Result();
        int off = 6;
        r.width = u16(data, off);
        r.height = u16(data, off + 2);
        int packed = data[off + 4] & 0xff;
        off += 7;
        int[] palette = new int[256];
        if ((packed & 0x80) != 0) {
            int size = 2 << (packed & 0x07);
            for (int i = 0; i < size; i++) {
                int rr = data[off + i * 3] & 0xff;
                int gg = data[off + i * 3 + 1] & 0xff;
                int bb = data[off + i * 3 + 2] & 0xff;
                palette[i] = 0xff000000 | (rr << 16) | (gg << 8) | bb;
            }
            off += size * 3;
        }
        int delay = 0;
        int transparent = -1;
        boolean hasTransparent = false;
        while (off < data.length) {
            int block = data[off++] & 0xff;
            if (block == 0x3b) {
                break;
            }
            if (block == 0x21) {
                int label = data[off++] & 0xff;
                if (label == 0xf9) {
                    int size = data[off++] & 0xff;
                    int gce = data[off] & 0xff;
                    delay = u16(data, off + 1);
                    transparent = data[off + 3] & 0xff;
                    hasTransparent = (gce & 0x01) != 0;
                    off += size;
                    off++; // block terminator
                } else {
                    off = skipSubBlocks(data, off);
                }
            } else if (block == 0x2c) {
                int left = u16(data, off);
                int top = u16(data, off + 2);
                int w = u16(data, off + 4);
                int h = u16(data, off + 6);
                int imgPacked = data[off + 8] & 0xff;
                off += 9;
                if ((imgPacked & 0x80) != 0) {
                    throw new IOException("测试解码器不支持局部调色板");
                }
                int minCodeSize = data[off++] & 0xff;
                int start = off;
                off = skipSubBlocks(data, off);
                byte[] lzw = subBlockData(data, start, off);
                byte[] indices = lzwDecode(lzw, minCodeSize);
                int[] frame = new int[r.width * r.height];
                for (int y = 0; y < h; y++) {
                    for (int x = 0; x < w; x++) {
                        int idx = indices[y * w + x] & 0xff;
                        int color = palette[idx];
                        if (hasTransparent && idx == transparent) {
                            color = 0x00000000;
                        }
                        frame[(top + y) * r.width + (left + x)] = color;
                    }
                }
                r.frames.add(frame);
                r.delays.add(delay);
            } else {
                throw new IOException("未知块 0x" + Integer.toHexString(block));
            }
        }
        return r;
    }

    private static int u16(byte[] d, int off) {
        return (d[off] & 0xff) | ((d[off + 1] & 0xff) << 8);
    }

    private static int skipSubBlocks(byte[] d, int off) {
        while (off < d.length) {
            int len = d[off++] & 0xff;
            if (len == 0) {
                return off;
            }
            off += len;
        }
        return off;
    }

    private static byte[] subBlockData(byte[] d, int start, int end) {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        int off = start;
        while (off < end) {
            int len = d[off++] & 0xff;
            if (len == 0) {
                break;
            }
            out.write(d, off, len);
            off += len;
        }
        return out.toByteArray();
    }

    static byte[] lzwDecode(byte[] data, int minCodeSize) throws IOException {
        int clear = 1 << minCodeSize;
        int end = clear + 1;
        Map<Integer, int[]> dict = new HashMap<>();
        resetDict(dict, clear);
        int codeSize = minCodeSize + 1;
        int next = end + 1;
        int bitPos = 0;
        int prev = -1;
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        while (bitPos + codeSize <= data.length * 8) {
            int code = readBits(data, bitPos, codeSize);
            bitPos += codeSize;
            if (code == clear) {
                resetDict(dict, clear);
                codeSize = minCodeSize + 1;
                next = end + 1;
                prev = -1;
                continue;
            }
            if (code == end) {
                break;
            }
            int[] entry;
            if (dict.containsKey(code)) {
                entry = dict.get(code);
            } else if (code == next && prev != -1) {
                int[] p = dict.get(prev);
                entry = concat(p, p[0]);
            } else {
                throw new IOException("非法 LZW code " + code);
            }
            for (int v : entry) {
                out.write(v);
            }
            if (prev != -1) {
                int[] p = dict.get(prev);
                dict.put(next, concat(p, entry[0]));
                next++;
                if (next == (1 << codeSize) && codeSize < 12) {
                    codeSize++;
                }
            }
            prev = code;
        }
        return out.toByteArray();
    }

    private static void resetDict(Map<Integer, int[]> dict, int clear) {
        dict.clear();
        for (int i = 0; i < clear; i++) {
            dict.put(i, new int[]{i});
        }
    }

    private static int[] concat(int[] a, int b) {
        int[] out = new int[a.length + 1];
        System.arraycopy(a, 0, out, 0, a.length);
        out[a.length] = b;
        return out;
    }

    private static int readBits(byte[] d, int bitPos, int size) {
        int v = 0;
        for (int i = 0; i < size; i++) {
            int p = bitPos + i;
            int bit = ((d[p >> 3] & 0xff) >> (p & 7)) & 1;
            v |= bit << i;
        }
        return v;
    }
}
