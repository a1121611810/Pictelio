package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

import java.io.File;
import java.io.IOException;

/**
 * Mp4Encoder 纯函数单测（spec docs/specs/download-manager.md §6）。
 * oracle = BT.601 有限范围公式 / 时间戳累加定义（与实现独立推导）。
 * 编解码路径（MediaCodec）由真机批次验收（Robolectric 无 MediaCodec）。
 */
public class Mp4EncoderTest {

    @Test
    public void argbToYuv420_white() {
        int w = 2;
        int h = 2;
        int[] white = {0xffffffff, 0xffffffff, 0xffffffff, 0xffffffff};
        byte[] y = new byte[4];
        byte[] u = new byte[1];
        byte[] v = new byte[1];
        Mp4Encoder.argbToYuv420(white, w, h, y, u, v);
        assertEquals(235, y[0] & 0xff);
        assertEquals(128, u[0] & 0xff);
        assertEquals(128, v[0] & 0xff);
    }

    @Test
    public void argbToYuv420_black() {
        int w = 2;
        int h = 2;
        int[] black = {0xff000000, 0xff000000, 0xff000000, 0xff000000};
        byte[] y = new byte[4];
        byte[] u = new byte[1];
        byte[] v = new byte[1];
        Mp4Encoder.argbToYuv420(black, w, h, y, u, v);
        assertEquals(16, y[0] & 0xff);
        assertEquals(128, u[0] & 0xff);
        assertEquals(128, v[0] & 0xff);
    }

    @Test
    public void argbToYuv420_red() {
        int w = 2;
        int h = 2;
        int[] red = {0xffff0000, 0xffff0000, 0xffff0000, 0xffff0000};
        byte[] y = new byte[4];
        byte[] u = new byte[1];
        byte[] v = new byte[1];
        Mp4Encoder.argbToYuv420(red, w, h, y, u, v);
        assertEquals(82.0, y[0] & 0xff, 2.0);
        assertEquals(90.0, u[0] & 0xff, 2.0);
        assertEquals(240.0, v[0] & 0xff, 2.0);
    }

    @Test
    public void timestamps_accumulate() {
        long[] pts = Mp4Encoder.computePresentationTimestampsUs(new int[]{100, 200, 300}, 3);
        assertArrayEquals(new long[]{0L, 100_000L, 300_000L}, pts);
        assertEquals(600_000L, Mp4Encoder.computeDurationUs(new int[]{100, 200, 300}, 3));
    }

    @Test
    public void frameRate_fromAverageDelay() {
        assertEquals(10, Mp4Encoder.computeFrameRate(new int[]{100, 100, 100}));
        assertEquals(20, Mp4Encoder.computeFrameRate(new int[]{50, 50}));
        assertEquals(10, Mp4Encoder.computeFrameRate(new int[]{}));
    }

    @Test
    public void encode_rejectsOddDimensionsAndEmpty() {
        assertThrows(IOException.class, () -> Mp4Encoder.encode(java.util.List.of(), 2, 2, null,
                new File("x.mp4")));
        assertThrows(IOException.class, () -> Mp4Encoder.encode(
                java.util.List.of(new int[]{0}), 3, 2, null, new File("x.mp4")));
    }
}
