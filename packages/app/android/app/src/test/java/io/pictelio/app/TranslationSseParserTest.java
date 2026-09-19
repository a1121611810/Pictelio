package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.ArrayList;
import java.util.List;

/**
 * TranslationSseParser 单测。
 *
 * <p>Oracle 溯源（AGENTS.md 测试硬约束 #6）——期望值来自独立来源，不是从实现反推：
 * <ul>
 *   <li>事件名与载荷形状 = OpenAI Responses API 事件规约（response.output_text.delta /
 *       response.completed / response.failed / response.incomplete）；</li>
 *   <li>[N] 段落锚定语义 = api/translate.ts 的 input 形态（web 路径同源契约）。</li>
 * </ul>
 *
 * <p><b>交付形态</b>：解析期累积、收尾时整章作为**单帧**
 * {@code {type:"delta_all", paragraphs:[{index,text}]}} 下发。该信封是**跨端契约**，
 * 单一事实源 = ADR-0170「跨端信封契约」节；本测试的输出侧断言锚该节条款（不是从
 * TranslationSseParser 的实现输出抄写）—— 只改实现信封、不按 ADR 改契约会让本测试红。
 *
 * <p>背景（ADR-0170「交付通道实测」）：NativeModule 的 callback 通道在一条流内至多投递
 * 一帧，故必须整章单帧交付。
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

    /** 取单帧交付里的段落数组 */
    private static JSONArray paragraphsOf(String payload) throws Exception {
        JSONObject frame = new JSONObject(payload);
        assertEquals("delta_all", frame.getString("type"));
        return frame.getJSONArray("paragraphs");
    }

    @Test
    public void lifecycleEventsAreIgnoredAndNullIsReturned() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        assertNull(parser.accept(data("{\"type\":\"response.created\"}"), sink));
        assertNull(parser.accept(data("{\"type\":\"response.in_progress\"}"), sink));
        assertNull(parser.accept(data("{\"type\":\"response.output_item.added\"}"), sink));
        assertNull(parser.accept("event: response.created", sink));
        assertNull(parser.accept("", sink));
        assertTrue("生命周期事件不得下发任何帧", sink.payloads.isEmpty());
        assertTrue(sink.errors.isEmpty());
    }

    @Test
    public void outputTextDoneIsNotAStreamTerminal() throws Exception {
        // 真机缺陷①：output_text.done 是 item 级事件，其后仍有 response.completed
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        assertNull(parser.accept(data("{\"type\":\"response.output_text.done\"}"), sink));
        assertTrue("不得在 item 级事件上收尾", sink.payloads.isEmpty());

        // 有译文时：收尾先整章单帧、随后 done 帧
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"[0] 你好\"}"), sink);
        Boolean terminal = parser.accept(
                data("{\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":3}}}"), sink);
        assertEquals(Boolean.TRUE, terminal);
        assertEquals(2, sink.payloads.size());
        assertEquals("delta_all", new JSONObject(sink.payloads.get(0)).getString("type"));
        JSONObject done = new JSONObject(sink.payloads.get(1));
        assertEquals("done", done.getString("type"));
        assertTrue("usage 应透传", done.has("usage"));
    }

    @Test
    public void deltaIsAttributedToTheParagraphOfTheLastAnchor() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        // 模型按 [N] 前缀逐段输出（与 web 路径 input 形态同源）
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"\\n\\n[0] 你好\"}"), sink);
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"\\n\\n[1] 世界\"}"), sink);
        parser.emitConsolidated(sink);

        assertEquals(1, sink.payloads.size());
        JSONArray arr = paragraphsOf(sink.payloads.get(0));
        assertEquals(2, arr.length());
        assertEquals(0, arr.getJSONObject(0).getInt("index"));
        assertEquals("你好", arr.getJSONObject(0).getString("text"));
        assertEquals(1, arr.getJSONObject(1).getInt("index"));
        assertEquals("世界", arr.getJSONObject(1).getString("text"));
    }

    @Test
    public void anchorSplitAcrossFramesDoesNotLeakIntoTheTranslation() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        // 锚标记被切成两帧："\n\n[" + "0] 文本"
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"\\n\\n[\"}"), sink);
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"0] 文本\"}"), sink);
        parser.emitConsolidated(sink);

        JSONArray arr = paragraphsOf(sink.payloads.get(0));
        assertEquals(1, arr.length());
        assertEquals(0, arr.getJSONObject(0).getInt("index"));
        assertEquals("文本", arr.getJSONObject(0).getString("text"));
        assertFalse("锚标记的 bracket 不得进入译文",
                arr.getJSONObject(0).getString("text").contains("["));
    }

    @Test
    public void reasoningDeltaUsesItsOwnChannel() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        assertNull(parser.accept(
                data("{\"type\":\"response.reasoning_text.delta\",\"delta\":\"thinking\"}"), sink));
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
        assertEquals(Boolean.FALSE,
                parser.accept(data("{\"type\":\"error\",\"message\":\"boom\"}"), bareErrorSink));
        assertEquals(1, bareErrorSink.errors.size());
    }

    @Test
    public void terminalErrorIsRecordedSoPartialTextIsNotReportedAsSuccess() throws Exception {
        // 回归：已产出译文后收到失败终态，若只看「有没有译文」会判成功 → 半截译文写进缓存
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"[0] 半截译文\"}"), sink);
        assertEquals(null, parser.terminalError());

        parser.accept(
                data("{\"type\":\"response.failed\",\"response\":{\"error\":{\"code\":\"server_error\",\"message\":\"boom\"}}}"),
                sink);
        assertTrue("终态错误必须被记录", parser.terminalError() != null);
        assertTrue(parser.terminalError().contains("server_error"));
        assertTrue("已产出的译文仍在（由调用方决定是否丢弃）", parser.hasText());
    }

    @Test
    public void cleanCompletionHasNoTerminalError() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"[0] ok\"}"), sink);
        parser.accept(data("{\"type\":\"response.completed\"}"), sink);
        assertEquals(null, parser.terminalError());
    }

    @Test
    public void malformedFrameDoesNotBreakTheStream() throws Exception {
        TranslationSseParser parser = new TranslationSseParser();
        Recorder sink = new Recorder();

        // 损坏帧 → 跳过（不得抛、不得终止）
        assertNull(parser.accept(data("{not json"), sink));
        // 后续正常帧仍然处理
        parser.accept(data("{\"type\":\"response.output_text.delta\",\"delta\":\"[0] ok\"}"), sink);
        parser.emitConsolidated(sink);

        JSONArray arr = paragraphsOf(sink.payloads.get(0));
        assertEquals(1, arr.length());
        assertEquals("ok", arr.getJSONObject(0).getString("text"));
    }
}
