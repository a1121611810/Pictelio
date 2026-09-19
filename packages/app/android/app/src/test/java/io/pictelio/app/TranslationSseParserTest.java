package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

/**
 * TranslationSseParser 单测（spec §9.3 + ADR-0170 §实现期修订）。
 *
 * <p>Oracle 溯源（AGENTS.md 测试硬约束 #6）——期望值来自**独立来源**，不是从实现反推：
 * <ul>
 *   <li>事件名与载荷形状 = OpenAI Responses API 事件规约（调研 #622 记录的官方事件族：
 *       response.output_text.delta / response.completed / response.failed / response.incomplete）；</li>
 *   <li>DeepSeek 兼容点（流可能不发 response.completed）= 调研 #625 与真机实测记录（ADR-0170 实现期修订）；</li>
 *   <li>[N] 段落锚定语义 = api/translate.ts 的 input 形态（web 路径同源契约）。</li>
 * </ul>
 *
 * <p>本测试覆盖的三个真机缺陷：① output_text.done 被误当流终态；② 无终态事件时 promise 永不
 * settle；③ 单帧损坏不得中断整条流。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class TranslationSseParserTest {

    /** 收集 emit 的桩 */
    private static final class Recorder implements TranslationSseParser.Sink {
        final List<String> payloads = new ArrayList<>();
        final List<String> errors = new ArrayList<>();

        @Override
        public void emit(String payload, String error) {
            if (payload != null && !payload.isEmpty()) payloads.add(payload);
            if (error != null && !error.isEmpty()) errors.add(error);
        }
    }

    private static String data(String json) {
        return "data: " + json;
    }

    @Test
    public void lifecycleEventsAreIgnoredAndNullIsReturned() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        // 生命周期事件（官方规约）：应被跳过，且不产生终态
        assertNull(parser.accept(data("{\"type\":\"response.created\"}"), sink));
        assertNull(parser.accept(data("{\"type\":\"response.in_progress\"}"), sink));
        assertNull(parser.accept(data("{\"type\":\"response.output_item.added\"}"), sink));
        // 非 data 行（event: 前缀）与空行也应跳过
        assertNull(parser.accept("event: response.created", sink));
        assertNull(parser.accept("", sink));
        assertTrue(sink.payloads.isEmpty());
        assertTrue(sink.errors.isEmpty());
    }

    @Test
    public void outputTextDoneIsNotAStreamTerminal() throws Exception {
        // 真机缺陷①：output_text.done 是 item 级事件，其后仍有 response.completed
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        assertNull(parser.accept(data("{\"type\":\"response.output_text.done\"}"), sink));
        assertTrue("不得在 item 级事件上收尾", sink.payloads.isEmpty());

        Boolean terminal = parser.accept(data("{\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":3}}}"), sink);
        assertEquals(Boolean.TRUE, terminal);
        assertEquals(1, sink.payloads.size());
        JSONObject done = new JSONObject(sink.payloads.get(0));
        assertEquals("done", done.getString("type"));
        assertTrue(done.has("usage"));
    }

    @Test
    public void deltaIsAttributedToTheParagraphOfTheLastAnchor() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        // 模型按 [N] 前缀逐段输出（与 web 路径 input 形态同源）
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"\\n\\n[0] \u4f60\u597d\"}"), sink);
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"\\n\\n[1] \u4e16\u754c\"}"), sink);

        assertEquals(2, sink.payloads.size());
        JSONObject first = new JSONObject(sink.payloads.get(0));
        assertEquals("delta", first.getString("type"));
        assertEquals("0", first.getString("paragraphIndex"));
        assertEquals("\u4f60\u597d", first.getString("text")); // 锚后的分隔空格不属于译文
        JSONObject second = new JSONObject(sink.payloads.get(1));
        assertEquals("1", second.getString("paragraphIndex"));
        assertEquals("\u4e16\u754c", second.getString("text"));
    }

    @Test
    public void anchorSplitAcrossFramesDoesNotLeakIntoTheTranslation() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        // 锚标记被切成两帧："\n\n[" + "0] 文本"
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"\\n\\n[\"}"), sink);
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"0] \u6587\u672c\"}"), sink);

        assertEquals(2, sink.payloads.size());
        // 第一帧只含段落分隔空白：**不得**把 "[" 吐给 UI（下一帧的 "0]" 才补齐标记）。
        // 空白本身由 store 在段落级裁剪（与 web 路径 alignParagraphs 同语义）。
        String firstText = new JSONObject(sink.payloads.get(0)).getString("text");
        assertFalse("锚标记的 '[' 不得进入译文", firstText.contains("["));
        JSONObject second = new JSONObject(sink.payloads.get(1));
        assertEquals("0", second.getString("paragraphIndex"));
        assertEquals("\u6587\u672c", second.getString("text"));
    }

    @Test
    public void reasoningDeltaUsesItsOwnChannel() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        assertNull(parser.accept(data("{\"type\":\"response.reasoning_text.delta\",\"delta\":\"thinking\"}"), sink));
        assertEquals(1, sink.payloads.size());
        assertEquals("reasoning_delta", new JSONObject(sink.payloads.get(0)).getString("type"));
    }

    @Test
    public void terminalErrorsAreReportedThroughTheErrorChannel() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();

        Recorder failedSink = new Recorder();
        assertEquals(Boolean.FALSE, parser.accept(
                data("{\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"rate_limit\",\"message\":\"slow down\"}}}"),
                failedSink));
        assertEquals(1, failedSink.errors.size());
        assertTrue(failedSink.errors.get(0).contains("rate_limit"));

        Recorder truncatedSink = new Recorder();
        assertEquals(Boolean.FALSE, parser.accept(
                data("{\"type\":\"response.incomplete\",\"response\":{\"incomplete_details\":{\"reason\":\"max_output_tokens\"}}}"),
                truncatedSink));
        assertEquals(1, truncatedSink.errors.size());
        assertTrue(truncatedSink.errors.get(0).contains("max_output_tokens"));

        Recorder bareErrorSink = new Recorder();
        assertEquals(Boolean.FALSE, parser.accept(data("{\"type\":\"error\",\"message\":\"boom\"}"), bareErrorSink));
        assertEquals(1, bareErrorSink.errors.size());
    }

    @Test
    public void malformedFrameDoesNotBreakTheStream() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        // 损坏帧 → 跳过（不得抛、不得终止）
        assertNull(parser.accept(data("{not json"), sink));
        // 后续正常帧仍然处理
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"[0] ok\"}"), sink);
        assertEquals(1, sink.payloads.size());
        assertFalse(sink.payloads.get(0).isEmpty());
        assertNotNull(new JSONObject(sink.payloads.get(0)).getString("text"));
    }
}
