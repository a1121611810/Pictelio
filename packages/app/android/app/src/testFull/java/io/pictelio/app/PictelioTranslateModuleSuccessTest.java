package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.content.Context;
import android.util.DisplayMetrics;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.tasm.behavior.LynxContext;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentLinkedQueue;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * {@link PictelioTranslateModule#translateStream} 成功路径 + 信封契约的契约守卫（issue #642 / wayfinder #644）。
 *
 * <p>Oracle 溯源（AGENTS.md 测试硬约束 #6）：期望值来自 ADR-0170「跨端信封契约」表格
 * （{@code docs/adr/ADR-0170-lynx-translate-nativemodule-bridge.md} §「跨端信封契约（单一事实源）」），
 * 每条字段均有 ADR 条款作为独立来源（不从实现反推）：
 * <ul>
 *   <li>{@code type:"delta_all"} + {@code paragraphs:[{index,text}]} —— ADR-0170 表第 1-2 行；</li>
 *   <li>{@code type:"done"} + 可选 {@code usage} —— ADR-0170 表第 3 行（{@code usage} 透传自
 *       {@code response.completed.response.usage}）；</li>
 *   <li>{@code streamId} + {@code seq} —— ADR-0170 表第 6-7 行（seq 在帧入缓冲时盖一次，复审实测）。</li>
 * </ul>
 *
 * <p>本测试与 {@link PictelioTranslateModuleEmptyStreamTest} 互补：空流用例证明「无译文 = 失败」；
 * 本测试证明「有译文 = done 且各字段按 ADR 契约」。
 *
 * <p><b>M1 变异</b>（{@code registerTerminal} 改回裸文本 {@code put}）：{@link #successStreamEmitsDeltaAndDone}
 * 的终态断言应转红（{@code new JSONObject(terminal)} 抛 JSONException）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class PictelioTranslateModuleSuccessTest {

    private static final class TestLynxContext extends LynxContext {
        TestLynxContext(Context base) { super(base, new DisplayMetrics()); }
        @Override public void handleException(Exception e) { }
    }

    private MockWebServer server;
    private PictelioTranslateModule module;

    @Before
    public void setUp() throws Exception {
        FakeAndroidKeyStore.seed("sk-test-success-0123456789");
        server = new MockWebServer();
        server.start();
        module = new PictelioTranslateModule(
                new TestLynxContext(ApplicationProvider.getApplicationContext()));
    }

    @After
    public void tearDown() throws Exception {
        if (server != null) server.shutdown();
        clearStaticBuffer("STREAM_FRAMES");
        clearStaticBuffer("STREAM_TERMINAL");
        clearStaticBuffer("STREAM_TERMINAL_MSG");
        clearStaticBuffer("STREAM_SEQ");
        clearUserAborted();
    }

    /** 反射清 USER_ABORTED：与 TerminalTest/CancelTest 对齐，避免 CancelTest 残留影响。 */
    private static void clearUserAborted() throws Exception {
        java.lang.reflect.Field f = PictelioTranslateModule.class.getDeclaredField("USER_ABORTED");
        f.setAccessible(true);
        java.util.Set<?> s = (java.util.Set<?>) f.get(null);
        s.clear();
    }

    @SuppressWarnings("unchecked")
    private static void clearStaticBuffer(String fieldName) throws Exception {
        java.lang.reflect.Field f = PictelioTranslateModule.class.getDeclaredField(fieldName);
        f.setAccessible(true);
        java.util.Map<String, ?> m = (java.util.Map<String, ?>) f.get(null);
        m.clear();
    }

    private static String request(String baseUrl, String id) {
        return "{\"baseURL\":\"" + baseUrl + "\",\"model\":\"gpt-5\",\"input\":[\"段落一\"],"
                + "\"_abortToken\":\"" + id + "\"}";
    }

    /** 读 STREAM_FRAMES 队列（不 poll）—— 验证入缓冲时的盖章形态。 */
    @SuppressWarnings("unchecked")
    private ConcurrentLinkedQueue<String> streamFrames(String id) throws Exception {
        java.lang.reflect.Field ff = PictelioTranslateModule.class.getDeclaredField("STREAM_FRAMES");
        ff.setAccessible(true);
        java.util.Map<String, ConcurrentLinkedQueue<String>> framesMap =
                (java.util.Map<String, ConcurrentLinkedQueue<String>>) ff.get(null);
        return framesMap.get(id);
    }

    private String streamTerminal(String id) throws Exception {
        java.lang.reflect.Field tf = PictelioTranslateModule.class.getDeclaredField("STREAM_TERMINAL");
        tf.setAccessible(true);
        @SuppressWarnings("unchecked")
        java.util.Map<String, String> terminals = (java.util.Map<String, String>) tf.get(null);
        return terminals.get(id);
    }

    /** 等待 STREAM_TERMINAL 登记（成功路径必到达该分支）。30s 超时防止 full suite 跑慢时假阳。 */
    private JSONObject waitTerminal(String id) throws Exception {
        for (int i = 0; i < 600; i++) {
            String t = streamTerminal(id);
            if (t != null) return new JSONObject(t);
            Thread.sleep(50);
        }
        throw new AssertionError("30s 内未登记终态");
    }

    /**
     * 成功路径基本形态：delta + completed → STREAM_FRAMES 内有 2 帧（delta_all + 解析器的 done），
     * STREAM_TERMINAL 内有 done 终态帧。
     *
     * <p>Oracle：{@link TranslationSseParser#accept} 在 {@code response.completed} 触发时
     * emit 一个 {@code {"type":"done"}} payload（{@code TranslationSseParserTest#outputTextDoneIsNotAStreamTerminal}
     * 已钉住），加上收尾整章 {@code delta_all} = 共 2 缓冲帧。
     *
     * <p>为什么不只看 STREAM_TERMINAL 里的 done：因为该 done 是 {@link PictelioTranslateModule#registerTerminal}
     * 构造的「终态标记」，{@code usage} 不在它身上；解析器 emit 的 done 才带 usage（Test 详）。
     */
    @Test
    public void successStreamEmitsDeltaAndDone() throws Exception {
        String sseBody =
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"[0] 你好\"}\n\n"
                + "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        JSONObject terminal = waitTerminal(id);
        assertEquals("终态 type 必须为 done（成功路径）",
                "done", terminal.optString("type"));
        assertEquals("终态必须盖 streamId 章",
                id, terminal.optString("streamId"));

        ConcurrentLinkedQueue<String> frames = streamFrames(id);
        assertNotNull("STREAM_FRAMES 必须有缓冲", frames);
        // 收尾单帧（delta_all）+ 解析器在 completed 时 emit 的 done = 2 帧
        assertEquals("成功路径缓冲应有 2 帧（delta_all + 解析器 done）",
                2, frames.size());

        // 第一帧 = delta_all，携带段落
        JSONObject deltaAll = new JSONObject(frames.poll());
        assertEquals("第一帧 type=delta_all（ADR-0170 信封契约）",
                "delta_all", deltaAll.optString("type"));
        JSONArray paragraphs = deltaAll.getJSONArray("paragraphs");
        assertEquals(1, paragraphs.length());

        // 第二帧 = 解析器 emit 的 done，带 usage
        JSONObject parserDone = new JSONObject(frames.poll());
        assertEquals("解析器 done 帧 type=done",
                "done", parserDone.optString("type"));
        assertTrue("done 帧必须透传 usage（oracle: ADR-0170 表第 3 行 usage?）",
                parserDone.has("usage"));
        assertEquals("usage.input_tokens 透传",
                1, parserDone.getJSONObject("usage").getInt("input_tokens"));
    }

    /**
     * 「无 delta = 失败」的镜像断言。{@link PictelioTranslateModuleEmptyStreamTest#nonEmptyStream_stillSucceedsWithDelta}
     * 已钉住「有 delta → done」；本用例显式锚「无 delta → error」，与 #654 互为二象。
     *
     * <p>Oracle：{@link PictelioTranslateModule}:424-431 收尾分支 {@code !hasText} → registerTerminal("LLM 未返回任何译文")。
     */
    @Test
    public void successPathRequiresNonEmptyStream() throws Exception {
        // 仅 completed，零 delta —— 模拟内容策略拦截的真机事实
        String sseBody = "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        JSONObject terminal = waitTerminal(id);
        assertEquals("无 delta 流的终态必须为 error（oracle: 收尾分支注释 + 字段注释「空流 = 失败」）",
                "error", terminal.optString("type"));
        assertTrue("终态 message 必须含 '未返回任何译文'（oracle: #654 收尾分支 :431）",
                terminal.optString("message").contains("未返回任何译文"));
    }

    /**
     * 解析器 emit 的 done 帧携带 usage（oracle: ADR-0170 信封契约表第 3 行「可带 usage」）。
     * STREAM_TERMINAL 里的 done 终态是 {@link PictelioTranslateModule#registerTerminal} 构造的「终态标记」，
     * 用法上**不带** usage —— 本断言明确区分这两类 done 帧，避免后续重构把两者混淆。
     */
    @Test
    public void doneFrameCarriesUsageFromResponseCompleted() throws Exception {
        String sseBody =
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"[0] 测试\"}\n\n"
                + "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":7,\"output_tokens\":3}}}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        // 等终态 —— 终态登记说明流已收尾，frames 入缓冲完毕
        waitTerminal(id);

        ConcurrentLinkedQueue<String> frames = streamFrames(id);
        assertNotNull(frames);
        // 找到带 usage 的 done 帧（第二帧）
        JSONObject done = new JSONObject(frames.stream()
                .filter(s -> s.contains("\"type\":\"done\""))
                .findFirst()
                .orElseThrow(() -> new AssertionError("缓冲内必须存在 done 帧（解析器在 completed 时 emit）")));
        assertTrue("done 帧必须透传 usage（ADR-0170 信封契约表第 3 行）",
                done.has("usage"));
        JSONObject usage = done.getJSONObject("usage");
        assertEquals("usage.input_tokens 透传", 7, usage.getInt("input_tokens"));
        assertEquals("usage.output_tokens 透传", 3, usage.getInt("output_tokens"));
    }

    /**
     * delta_all 帧的 paragraphs 数组形态（oracle: ADR-0170 信封契约表第 2 行
     * {@code {index:number, text:string}[]} + 段落级 trim）。
     */
    @Test
    public void deltaAllHasParagraphsIndexAndText() throws Exception {
        // 两段：第二段带前导空白（"[0] 一" + "\n\n[1] 二"），验证段落级 trim
        String sseBody =
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"[0] 一\"}\n\n"
                + "data: {\"type\":\"response.output_text.delta\",\"delta\":\"\\n\\n[1] 二\"}\n\n"
                + "data: {\"type\":\"response.completed\"}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        waitTerminal(id);

        ConcurrentLinkedQueue<String> frames = streamFrames(id);
        JSONObject deltaAll = new JSONObject(frames.stream()
                .filter(s -> s.contains("\"type\":\"delta_all\""))
                .findFirst()
                .orElseThrow(() -> new AssertionError("缓冲内必须存在 delta_all 帧")));
        JSONArray paragraphs = deltaAll.getJSONArray("paragraphs");
        assertEquals("两段输入 → paragraphs.length()=2", 2, paragraphs.length());
        assertEquals("第0段 index=0", 0, paragraphs.getJSONObject(0).getInt("index"));
        assertEquals("第0段 text=一（段落级 trim）", "一", paragraphs.getJSONObject(0).getString("text"));
        assertEquals("第1段 index=1", 1, paragraphs.getJSONObject(1).getInt("index"));
        assertEquals("第1段 text=二（段落级 trim）", "二", paragraphs.getJSONObject(1).getString("text"));
    }

    /**
     * seq 在入缓冲时盖章（oracle: ADR-0170 §seq「实现期修订」—— 入缓冲时盖一次章，
     * 接收侧按 (streamId, seq) 去重）。
     *
     * <p>验证方法：读 STREAM_FRAMES 内每一帧 → 必须有 seq 字段；sterminal 也必须有 seq；
     * 各帧 seq 严格单调递增（从 0 起）。
     */
    @Test
    public void seqInjectionAppliesAtBufferTime() throws Exception {
        String sseBody =
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"[0] ok\"}\n\n"
                + "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        waitTerminal(id);

        ConcurrentLinkedQueue<String> frames = streamFrames(id);
        assertNotNull(frames);
        int frameCount = frames.size();
        assertEquals("成功路径缓冲应有 2 帧（delta_all + done）", 2, frameCount);

        int lastSeq = -1;
        for (String frame : frames) {
            JSONObject f = new JSONObject(frame);
            assertTrue("每帧必须盖 seq 章（ADR-0170 §seq 入缓冲盖章）", f.has("seq"));
            int seq = f.getInt("seq");
            assertEquals("seq 必须严格递增", lastSeq + 1, seq);
            assertEquals("streamId 必须盖章", id, f.getString("streamId"));
            lastSeq = seq;
        }

        // 终态帧的 seq = lastSeq + 1
        String terminalRaw = streamTerminal(id);
        assertNotNull("STREAM_TERMINAL 必须登记 done 终态", terminalRaw);
        JSONObject terminal = new JSONObject(terminalRaw);
        assertTrue("终态也必须盖 seq 章", terminal.has("seq"));
        assertEquals("终态 seq = 缓冲最后一帧 seq + 1", lastSeq + 1, terminal.getInt("seq"));
        assertEquals("终态 streamId 必须盖章", id, terminal.getString("streamId"));
    }
}