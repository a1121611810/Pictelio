package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import java.io.IOException;
import java.util.Arrays;
import java.util.Collections;

/**
 * GifEncoder 单测（spec docs/specs/download-manager.md §6）。
 * oracle = 独立实现的 {@link GifDecode}（差分验证：编码器 vs 规范解码器）。
 */
public class GifEncoderTest {

    @Test
    public void encode_roundTripsViaDecoder() throws Exception {
        int w = 4;
        int h = 4;
        int[] red = new int[w * h];
        Arrays.fill(red, 0xffff0000);
        int[] green = new int[w * h];
        Arrays.fill(green, 0xff00ff00);
        int[] blue = new int[w * h];
        Arrays.fill(blue, 0xff0000ff);
        blue[0] = 0x00000000; // 透明像素

        byte[] gif = GifEncoder.encode(Arrays.asList(red, green, blue), w, h,
                new int[]{100, 200, 300});
        assertEquals("GIF89a", new String(gif, 0, 6, "US-ASCII"));

        GifDecode.Result r = GifDecode.decode(gif);
        assertEquals(w, r.width);
        assertEquals(h, r.height);
        assertEquals(3, r.frames.size());
        assertEquals(0xffff0000, r.frames.get(0)[0]);
        assertEquals(0xff00ff00, r.frames.get(1)[0]);
        assertEquals(0x00000000, r.frames.get(2)[0] & 0xff000000);
        // 延时单位 = 1/100s：100ms→10，200ms→20，300ms→30
        assertEquals(Integer.valueOf(10), r.delays.get(0));
        assertEquals(Integer.valueOf(20), r.delays.get(1));
        assertEquals(Integer.valueOf(30), r.delays.get(2));
    }

    @Test
    public void encode_rejectsEmptyFrames() {
        try {
            GifEncoder.encode(Collections.emptyList(), 1, 1, null);
            fail("应拒绝空帧");
        } catch (IOException e) {
            assertTrue(e.getMessage().contains("无帧"));
        }
    }
}
