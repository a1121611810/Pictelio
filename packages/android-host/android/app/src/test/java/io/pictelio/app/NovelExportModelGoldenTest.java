package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * 跨语言 golden payload 契约（spec docs/specs/novel-export.md §3.3；测试硬约束 #2）。
 *
 * <p>解析由共享包 {@code buildNovelExportPayload} 真实产出的 fixture（test resources 副本），
 * 验证 Java {@link NovelExportModel} 的字段名/结构与 TS IR 不漂移。fixture 与
 * {@code packages/novel-export/tests/fixtures/sample-payload.json} 逐字节一致，由
 * {@code novelExportPayloadFixtureConsistency.test.ts} 守护；TS 侧由 {@code golden.test.ts}
 * 锁定「构建器输出 == fixture」。任一侧字段重命名都会让链路断开。纯 JVM 可跑，无需设备。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NovelExportModelGoldenTest {

    private static NovelExportModel parseGolden() throws Exception {
        try (InputStream in = NovelExportModelGoldenTest.class
                .getResourceAsStream("/novel-export-sample-payload.json")) {
            assertNotNull("缺少 golden fixture 资源（test resources）", in);
            return NovelExportModel.parse(new String(in.readAllBytes(), StandardCharsets.UTF_8));
        }
    }

    @Test
    public void parsesGoldenPayloadFromSharedPackage() throws Exception {
        NovelExportModel m = parseGolden();

        assertEquals(1, m.schema);
        assertEquals(42L, m.meta.id);
        assertEquals("Golden Novel 黄金样例", m.meta.title);
        assertEquals(456L, m.meta.authorId);
        assertEquals("作者甲", m.meta.authorName);
        assertEquals(Arrays.asList("tag1", "tag2 (标签2)"), m.meta.tags);
        assertEquals(Long.valueOf(7L), m.meta.seriesId);
        assertEquals("Sample Series", m.meta.seriesTitle);
        assertEquals("2025-01-01T00:00:00+00:00", m.meta.createDate);
        assertEquals("https://www.pixiv.net/novel/show.php?id=42", m.meta.sourceUrl);
        assertEquals("简介加粗与尾", m.meta.description);
        assertEquals(0, m.meta.xRestrict);
        assertEquals("https://i.pximg.net/novel/cover_l.jpg", m.meta.coverUrl);

        assertTrue(m.options.includeMetadata);
        assertTrue(m.options.includeCover);
        assertTrue(m.options.includeInlineImages);

        int chapters = 0;
        int texts = 0;
        int images = 0;
        int pages = 0;
        int jumps = 0;
        NovelExportModel.TextBlock firstText = null;
        NovelExportModel.ImageBlock firstImage = null;
        NovelExportModel.JumpBlock firstJump = null;
        for (NovelExportModel.Block b : m.blocks) {
            if (b instanceof NovelExportModel.ChapterBlock) {
                chapters++;
            } else if (b instanceof NovelExportModel.TextBlock) {
                texts++;
                if (firstText == null) {
                    firstText = (NovelExportModel.TextBlock) b;
                }
            } else if (b instanceof NovelExportModel.ImageBlock) {
                images++;
                firstImage = (NovelExportModel.ImageBlock) b;
            } else if (b instanceof NovelExportModel.PageBreakBlock) {
                pages++;
            } else if (b instanceof NovelExportModel.JumpBlock) {
                jumps++;
                firstJump = (NovelExportModel.JumpBlock) b;
            }
        }
        assertEquals(1, chapters);
        assertEquals(3, texts);
        assertEquals(1, images);
        assertEquals(1, pages);
        assertEquals(1, jumps);

        // 行内样式区间（TS parseInlineRuns 产出）：字段名 start/end/tag 与取值不漂移
        assertNotNull(firstText);
        assertEquals(0, firstText.index);
        assertEquals(2, firstText.inlineRuns.size());
        assertEquals("bold", firstText.inlineRuns.get(0).tag);
        assertEquals(2, firstText.inlineRuns.get(0).start);
        assertEquals(4, firstText.inlineRuns.get(0).end);
        assertEquals("italic", firstText.inlineRuns.get(1).tag);

        assertNotNull(firstImage);
        assertEquals("100", firstImage.imageId);
        assertEquals("https://i.pximg.net/img/1200/100.jpg", firstImage.url);

        assertNotNull(firstJump);
        assertEquals("illust", firstJump.kind);
        assertEquals("illust/12345", firstJump.target);
        assertEquals("https://www.pixiv.net/artworks/12345", firstJump.url);
    }
}
