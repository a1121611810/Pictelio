package io.pictelio.app;

import android.content.Context;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import okhttp3.OkHttpClient;

/**
 * 小说导出编码器测试共享夹具（T6/T7/T8）。
 *
 * <p><b>期望值来源（oracle）</b>：载荷字段名与 {@link NovelExporterTest} 逐字一致，
 * 对齐 spec docs/specs/novel-export.md §3.3 与共享包 {@code @pictelio/novel-export} 的 IR
 * （不是为实现编造的自洽 mock）。取图假件同 {@link NovelExporterTest} 的覆盖
 * {@link PixivImageLoader#loadBytes} 模式，并额外记录请求 URL 以断言取图调用。
 */
final class NovelExportTestData {

    static final String COVER_URL = "https://i.pximg.net/c/1200x1200/img/cover.jpg";
    static final String IMAGE_URL =
            "https://i.pximg.net/img-original/img/2024/01/01/00/00/00/999_p0.png";

    private NovelExportTestData() {}

    /** 测试假件：按 URL 返回预置字节；缺失即抛（导出侧应跳过）；记录请求序列。 */
    static final class FakeImageLoader extends PixivImageLoader {
        private final Map<String, byte[]> store = new HashMap<>();
        private final List<String> requested = new ArrayList<>();

        FakeImageLoader(Context context) {
            super(context, new OkHttpClient.Builder().build(), 1 << 20);
        }

        void put(String url, byte[] bytes) {
            store.put(url, bytes);
        }

        List<String> requested() {
            return requested;
        }

        @Override
        public byte[] loadBytes(String url) throws IOException {
            requested.add(url);
            byte[] bytes = store.get(url);
            if (bytes == null) {
                throw new IOException("fake 未提供图片: " + url);
            }
            return bytes;
        }
    }

    /** 与 NovelExporterTest#buildPayload 同一现实多块载荷。 */
    static String buildPayload(boolean metadata, boolean cover, boolean inlineImages)
            throws Exception {
        JSONObject root = new JSONObject();
        root.put("schema", 1);

        JSONObject meta = new JSONObject();
        meta.put("id", 123456);
        meta.put("title", "夜行 & <测试>");
        meta.put("authorId", 42);
        meta.put("authorName", "作者\"甲\"");
        meta.put("tags", new JSONArray().put("tag1").put("标签二"));
        meta.put("seriesId", 999);
        meta.put("seriesTitle", "系列 <一>");
        meta.put("createDate", "2024-01-02T03:04:05+09:00");
        meta.put("sourceUrl", "https://www.pixiv.net/novel/show.php?id=123456");
        meta.put("description", "简介 & <说明>");
        meta.put("xRestrict", 0);
        meta.put("coverUrl", COVER_URL);
        root.put("meta", meta);

        JSONObject options = new JSONObject();
        options.put("includeMetadata", metadata);
        options.put("includeCover", cover);
        options.put("includeInlineImages", inlineImages);
        root.put("options", options);

        JSONArray blocks = new JSONArray();
        blocks.put(new JSONObject().put("type", "chapter").put("title", "第一章 <起始>"));

        JSONObject para = new JSONObject();
        para.put("type", "text");
        para.put("index", 0);
        para.put("text", "普通段落 & <标记> \"引号\" '单引' 结束。");
        JSONArray runs = new JSONArray();
        runs.put(new JSONObject().put("start", 0).put("end", 2).put("tag", "bold"));
        runs.put(new JSONObject().put("start", 3).put("end", 5).put("tag", "italic"));
        para.put("inlineRuns", runs);
        blocks.put(para);

        // ruby：共享包 parseInlineRuns 把 [ruby:漢字:かんじ] 还原为主文本「漢字」+ 剥离注音
        JSONObject ruby = new JSONObject();
        ruby.put("type", "text");
        ruby.put("index", 1);
        ruby.put("text", "漢字です");
        blocks.put(ruby);

        blocks.put(new JSONObject().put("type", "pageBreak"));

        blocks.put(new JSONObject().put("type", "image").put("imageId", "img-1").put("url",
                IMAGE_URL));

        blocks.put(new JSONObject().put("type", "jump").put("kind", "illust").put("target", "123")
                .put("url", "https://www.pixiv.net/artworks/123"));
        root.put("blocks", blocks);

        return root.toString();
    }

    /** 两章载荷：用于断言「按 ChapterBlock 分章」。 */
    static String buildTwoChapterPayload() throws Exception {
        JSONObject root = new JSONObject(new JSONObject(buildPayload(true, true, true)).toString());
        JSONArray blocks = new JSONArray();
        blocks.put(new JSONObject().put("type", "chapter").put("title", "第一话"));
        blocks.put(new JSONObject().put("type", "text").put("index", 0).put("text", "甲段"));
        blocks.put(new JSONObject().put("type", "chapter").put("title", "第二话"));
        blocks.put(new JSONObject().put("type", "text").put("index", 1).put("text", "乙段"));
        root.put("blocks", blocks);
        return root.toString();
    }
}
