package io.pictelio.app;

// ────────────────────────────────────────────────────────────
// PROTOTYPE — throwaway（原生模式渐进播放可行性：Java 流式边下边解压写盘 + 分批回调）
// 验证问题（原型技能 LOGIC 分支）：
//   1. ZipInputStream 能否在不读完全量字节时按序产出条目（流式顺序读，不依赖中央目录）
//   2. 「边读边写盘、每批 N 帧交付一次」的首批水位（已读字节/总字节）——渐进收益
//   3. 流式产出与全量 map 解压（现有 ugoiraExtractCore 语义）逐字节一致
// 数据：构造 store zip（200 帧，模拟 Pixiv 事实形态）+ 真实 zip 旁证（/tmp，存在时）
// 运行：cd packages/app/android && GRADLE_USER_HOME=$(pwd)/.gradle ./gradlew testFullDebugUnitTest --tests "io.pictelio.app.PictelioUgoiraStreamProtoTest"
// ────────────────────────────────────────────────────────────
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.CRC32;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;
import java.util.zip.ZipOutputStream;

/** 流式顺序读计数（记录底层已消费字节，含 ZipInputStream 缓冲预读——真实网络缓冲行为） */
class CountingInputStream extends InputStream {
    final InputStream in;
    long read = 0;

    CountingInputStream(InputStream in) {
        this.in = in;
    }

    @Override
    public int read() throws IOException {
        int b = in.read();
        if (b >= 0) read++;
        return b;
    }

    @Override
    public int read(byte[] buf, int off, int len) throws IOException {
        int n = in.read(buf, off, len);
        if (n > 0) read += n;
        return n;
    }
}

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioUgoiraStreamProtoTest {

    @Rule
    public TemporaryFolder tmp = new TemporaryFolder();

    /** 构造 store 模式 zip（帧字节原样存储，与 Pixiv ugoira 一致） */
    static byte[] buildStoreZip(List<String> names, List<byte[]> frames) throws IOException {
        ByteArrayOutputStream bos = new ByteArrayOutputStream();
        try (ZipOutputStream zos = new ZipOutputStream(bos)) {
            for (int i = 0; i < names.size(); i++) {
                byte[] data = frames.get(i);
                ZipEntry e = new ZipEntry(names.get(i));
                e.setMethod(ZipEntry.STORED);
                e.setSize(data.length);
                CRC32 crc = new CRC32();
                crc.update(data);
                e.setCrc(crc.getValue());
                zos.putNextEntry(e);
                zos.write(data);
                zos.closeEntry();
            }
        }
        return bos.toByteArray();
    }

    /** 流式解压写盘 + 分批交付：返回每批事件（批号/已读字节/批次帧数/已读占比） */
    static List<long[]> streamExtractBatches(byte[] zip, List<String> names, int batchSize, File dir)
            throws IOException {
        CountingInputStream counting = new CountingInputStream(new ByteArrayInputStream(zip));
        List<long[]> batches = new ArrayList<>();
        try (ZipInputStream zis = new ZipInputStream(counting)) {
            ZipEntry entry;
            int frameIdx = 0;
            int inBatch = 0;
            byte[] buf = new byte[16 * 1024];
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                ByteArrayOutputStream frameOut = new ByteArrayOutputStream();
                int n;
                while ((n = zis.read(buf)) != -1) {
                    frameOut.write(buf, 0, n);
                }
                try (FileOutputStream fos = new FileOutputStream(new File(dir, names.get(frameIdx)))) {
                    fos.write(frameOut.toByteArray());
                }
                frameIdx++;
                inBatch++;
                if (inBatch == batchSize) {
                    batches.add(new long[]{batches.size(), counting.read, inBatch,
                            Math.round(counting.read * 1000.0 / zip.length)});
                    inBatch = 0;
                }
            }
            if (inBatch > 0) {
                batches.add(new long[]{batches.size(), counting.read, inBatch,
                        Math.round(counting.read * 1000.0 / zip.length)});
            }
        }
        return batches;
    }

    /** 全量 map 解压（现有 ugoiraExtractCore 的 scanZip 语义）→ 逐帧字节对照 */
    static Map<String, byte[]> fullMapExtract(byte[] zip) throws IOException {
        Map<String, byte[]> map = new HashMap<>();
        try (ZipInputStream zis = new ZipInputStream(new ByteArrayInputStream(zip))) {
            ZipEntry entry;
            byte[] buf = new byte[16 * 1024];
            while ((entry = zis.getNextEntry()) != null) {
                if (entry.isDirectory()) continue;
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                int n;
                while ((n = zis.read(buf)) != -1) {
                    out.write(buf, 0, n);
                }
                map.put(entry.getName(), out.toByteArray());
            }
        }
        return map;
    }

    static List<String> names(int count) {
        List<String> names = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            names.add(String.format("%06d.jpg", i));
        }
        return names;
    }

    static List<byte[]> frames(int count) {
        List<byte[]> frames = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            int size = 2048 + (i % 7) * 512; // 2KB~5KB 递增扰动
            byte[] b = new byte[size];
            for (int k = 0; k < size; k++) b[k] = (byte) ((k + i) % 251);
            frames.add(b);
        }
        return frames;
    }

    @Test
    public void streaming_batchTimeline_andByteConsistency() throws Exception {
        int frameCount = 200;
        List<String> names = names(frameCount);
        List<byte[]> frameBytes = frames(frameCount);
        byte[] zip = buildStoreZip(names, frameBytes);
        File dir = tmp.newFolder("frames");
        int batchSize = 10;

        List<long[]> batches = streamExtractBatches(zip, names, batchSize, dir);
        // 20 批（200/10）
        assertEquals(frameCount / batchSize, batches.size());
        // 首批（帧 0-9）交付时已读字节占比：帧均 ~3.5KB → 前 10 帧 ~35KB + 缓冲
        long firstPct = batches.get(0)[3];
        System.out.println("[PROTO] 首批(10帧)交付时已读占比: " + firstPct / 10.0 + "% ("
                + batches.get(0)[1] + "B/" + zip.length + "B)");
        System.out.println("[PROTO] 第5批交付时已读占比: " + batches.get(5)[3] / 10.0 + "%");
        System.out.println("[PROTO] 末批交付时已读占比: " + batches.get(batches.size() - 1)[3] / 10.0 + "%");
        // 首批占比必须 < 10%（远小于全量）
        assertTrue("首批占比应远小于全量: " + firstPct, firstPct < 100);

        // 字节一致性：流式写盘 vs 全量 map 解压
        Map<String, byte[]> reference = fullMapExtract(zip);
        for (String name : names) {
            byte[] written = java.nio.file.Files.readAllBytes(new File(dir, name).toPath());
            assertEquals("帧字节一致: " + name, reference.get(name).length, written.length);
            assertTrue("帧字节一致: " + name, java.util.Arrays.equals(reference.get(name), written));
        }
    }

    @Test
    public void realZip_batchTimeline() throws Exception {
        // 真实样本旁证（本机 2026-08-31 下载；CI 无此文件则跳过）
        File real = new File("/tmp/ugoira_148861562.zip");
        if (!real.isFile()) {
            System.out.println("[PROTO] 真实样本缺失，跳过旁证");
            return;
        }
        byte[] zip = java.nio.file.Files.readAllBytes(real.toPath());
        List<String> names = names(52);
        File dir = tmp.newFolder("real");
        List<long[]> batches = streamExtractBatches(zip, names, 5, dir);
        System.out.println("[PROTO-REAL] 批次: " + batches.size());
        for (long[] b : batches) {
            System.out.println("[PROTO-REAL] 批" + b[0] + " 已读占比 " + b[3] / 10.0 + "% (" + b[1] + "B)");
        }
        Map<String, byte[]> reference = fullMapExtract(zip);
        for (String name : names) {
            byte[] written = java.nio.file.Files.readAllBytes(new File(dir, name).toPath());
            assertTrue("真实 zip 帧字节一致: " + name,
                    java.util.Arrays.equals(reference.get(name), written));
        }
    }
}
