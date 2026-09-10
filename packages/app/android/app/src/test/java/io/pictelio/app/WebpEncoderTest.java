package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertThrows;

import org.junit.Test;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * WebpEncoder 容器组装与帧抽取单测（spec docs/specs/download-manager.md §6）。
 * oracle = WebP 容器规范（RIFF/WEBP + VP8X + ANIM + ANMF 字段布局），测试内独立解析校验。
 * Bitmap 压缩路径（设备内置 libwebp）由设备批次验收。
 */
public class WebpEncoderTest {

    private static byte[] chunk(String cc, byte[] data) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write(cc.getBytes(StandardCharsets.US_ASCII));
        int n = data.length;
        out.write(n & 0xff);
        out.write((n >> 8) & 0xff);
        out.write((n >> 16) & 0xff);
        out.write((n >> 24) & 0xff);
        out.write(data);
        if ((n & 1) == 1) {
            out.write(0);
        }
        return out.toByteArray();
    }

    private static byte[] singleFrameWebp(byte[]... chunks) throws IOException {
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        body.write(chunk("VP8X", new byte[10]));
        for (byte[] c : chunks) {
            body.write(c);
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        out.write("RIFF".getBytes(StandardCharsets.US_ASCII));
        int size = 4 + body.size();
        out.write(size & 0xff);
        out.write((size >> 8) & 0xff);
        out.write((size >> 16) & 0xff);
        out.write((size >> 24) & 0xff);
        out.write("WEBP".getBytes(StandardCharsets.US_ASCII));
        body.writeTo(out);
        return out.toByteArray();
    }

    private static String fourcc(byte[] b, int off) {
        return new String(b, off, 4, StandardCharsets.US_ASCII);
    }

    private static int u32(byte[] b, int off) {
        return (b[off] & 0xff) | ((b[off + 1] & 0xff) << 8) | ((b[off + 2] & 0xff) << 16)
                | ((b[off + 3] & 0xff) << 24);
    }

    private static int u24(byte[] b, int off) {
        return (b[off] & 0xff) | ((b[off + 1] & 0xff) << 8) | ((b[off + 2] & 0xff) << 16);
    }

    @Test
    public void buildAnimatedWebp_structure() throws Exception {
        byte[] p0 = chunk("VP8 ", new byte[]{1, 2, 3, 4});
        byte[] p1 = chunk("VP8L", new byte[]{9, 8, 7});
        byte[] webp = WebpEncoder.buildAnimatedWebp(Arrays.asList(p0, p1), 4, 2,
                new int[]{100, 250});

        assertEquals("RIFF", fourcc(webp, 0));
        assertEquals("WEBP", fourcc(webp, 8));
        assertEquals(webp.length - 8, u32(webp, 4));

        List<String> ccs = new ArrayList<>();
        List<byte[]> datas = new ArrayList<>();
        int off = 12;
        while (off + 8 <= webp.length) {
            String cc = fourcc(webp, off);
            int size = u32(webp, off + 4);
            ccs.add(cc);
            datas.add(Arrays.copyOfRange(webp, off + 8, off + 8 + size));
            off += 8 + size + ((size & 1) == 1 ? 1 : 0);
        }
        assertEquals(Arrays.asList("VP8X", "ANIM", "ANMF", "ANMF"), ccs);
        assertEquals(0x02, datas.get(0)[0] & 0xff);
        assertEquals(3, u24(datas.get(0), 4));
        assertEquals(1, u24(datas.get(0), 7));
        assertEquals(0, (datas.get(1)[4] & 0xff) | ((datas.get(1)[5] & 0xff) << 8));

        byte[] anmf0 = datas.get(2);
        assertEquals(0, u24(anmf0, 0));
        assertEquals(3, u24(anmf0, 6));
        assertEquals(1, u24(anmf0, 9));
        assertEquals(100, u24(anmf0, 12));
        assertArrayEquals(p0, Arrays.copyOfRange(anmf0, 16, anmf0.length));
        assertEquals(250, u24(datas.get(3), 12));
    }

    @Test
    public void extractFramePayload_keepsAlphaAndVp8WithHeaders() throws Exception {
        byte[] alph = chunk("ALPH", new byte[]{5, 6, 7});
        byte[] vp8 = chunk("VP8 ", new byte[]{1, 2, 3, 4, 5});
        byte[] payload = WebpEncoder.extractFramePayload(singleFrameWebp(alph, vp8));
        ByteArrayOutputStream expected = new ByteArrayOutputStream();
        expected.write(alph);
        expected.write(vp8);
        assertArrayEquals(expected.toByteArray(), payload);
    }

    @Test
    public void extractFramePayload_vp8lOnly() throws Exception {
        byte[] vp8l = chunk("VP8L", new byte[]{(byte) 0x2f, 0, 0, 0, 0});
        assertArrayEquals(vp8l, WebpEncoder.extractFramePayload(singleFrameWebp(vp8l)));
    }

    @Test
    public void extractFramePayload_rejectsNonRiff() {
        assertThrows(IOException.class, () -> WebpEncoder.extractFramePayload(new byte[]{1, 2, 3, 4}));
    }
}
