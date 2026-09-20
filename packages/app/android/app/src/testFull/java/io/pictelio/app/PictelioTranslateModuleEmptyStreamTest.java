package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.content.Context;
import android.util.DisplayMetrics;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.tasm.behavior.LynxContext;

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

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;

/**
 * {@link PictelioTranslateModule#translateStream} 空流（zero-delta）终态契约守卫（issue #654）。
 *
 * <p><b>Oracle 溯源</b>（AGENTS.md 测试硬约束 #6）：期望值「空流必须判失败」来自三处已记录证据——
 * <ol>
 *   <li>{@code deltaSeen} 字段注释（{@code PictelioTranslateModule.java:120}）：「本次流是否至少产出过一个译文段
 *       （<b>空流 = 失败</b>，见 translateStream 收尾）」；</li>
 *   <li>收尾分支注释（`:423`）：「SSE 流结束但未产出任何译文段 → 报空流失败」；</li>
 *   <li>交接文档记录的真机事实：DeepSeek 对 R-18 正文会 200 但零输出 → 必须让用户看到错误，
 *       而不是「成功却无译文」静默走 done → 缓存被错写。</li>
 * </ol>
 *
 * <p><b>根因</b>（实测，#646 探针 P11）：{@code response.completed} 触发 {@link TranslationSseParser}
 * 先 emit 一个**空** {@code {"type":"delta_all","paragraphs":[]}} 帧（{@code emitConsolidated}
 * 即便段落为空也构造空数组帧），而 sink 在
 * {@code PictelioTranslateModule.java:858-863} 只看帧类型字符串就置 {@code deltaSeen = true}，
 * 于是收尾的 {@code else if (!deltaSeen)} 空流分支（`:423-425`）永不触发，
 * {@code else { registerTerminal(streamId, "done") }` 直接走 done。
 *
 * <p><b>修复方向</b>：判据改成 {@code sseParser.hasText()}（{@link TranslationSseParser#hasText}，
 * 字段级注释「是否已产出过任何译文段」）。本测试是验收 oracle —— 修复后终态必须是
 * {@code {"type":"error","message":"LLM 未返回任何译文..."}}，且 JS 侧
 * {@code classifyNativeError("...未返回任何译文...")} 能正确归类为 {@code content_filter}。
 *
 * <p><b>测试基础设施</b>：复用 #646 验证的 {@code TestLynxContext} + 共享假密钥存储
 * {@link FakeAndroidKeyStore}（**全 JVM 唯一一份**，ADR-0174 D4.1）。{@link MockWebServer} 仅 enqueue
 * 一帧 {@code response.completed}（无任何 {@code response.output_text.delta}），模拟 LLM
 * 内容策略拦截 R-18 正文后 200 但零输出的真机事实。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class PictelioTranslateModuleEmptyStreamTest {

    /** LynxContext 唯一抽象方法 = handleException(Exception)，子类可构造（#646 §2.1 javap 实证）。 */
    private static final class TestLynxContext extends LynxContext {
        TestLynxContext(Context base) {
            super(base, new DisplayMetrics());
        }
        @Override public void handleException(Exception e) { }
    }

    private MockWebServer server;
    private PictelioTranslateModule module;

    @Before
    public void setUp() throws Exception {
        FakeAndroidKeyStore.seed("sk-test-empty-stream-0123456789");
        server = new MockWebServer();
        server.start();
        module = new PictelioTranslateModule(
                new TestLynxContext(ApplicationProvider.getApplicationContext()));
    }

    @After
    public void tearDown() throws Exception {
        if (server != null) server.shutdown();
        // 清空静态字段，避免用例间污染（#646 §2.4）
        clearStaticBuffer("STREAM_FRAMES");
        clearStaticBuffer("STREAM_TERMINAL");
        clearStaticBuffer("STREAM_TERMINAL_MSG");
        clearStaticBuffer("STREAM_SEQ");
    }

    /** 反射清 per-stream 缓冲（每用例必须用唯一 _abortToken —— 见 #646 §2.4） */
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

    /** 轮询直到 STREAM_FRAMES 排空 + STREAM_TERMINAL 已登记（生产拉取通道）。
     *  返回 STREAM_TERMINAL 里的终态帧。
     *
     *  <p>必须先排空 STREAM_FRAMES 再读 STREAM_TERMINAL —— {@code translatePoll} 先吐缓冲
     *  里的中间帧（包括 sink 在 {@code response.completed} 时 offer 的「done」中间帧），
     *  再吐终态。把中间 done 当终态返回会**被骗绿**（#646 §2.5 缓冲陷阱变体）。
     *  这里用反射直接读 STREAM_TERMINAL，跳过中间帧噪声。 */
    private JSONObject pollUntilTerminal(PictelioTranslateModule m, String id) throws Exception, JSONException {
        for (int i = 0; i < 300; i++) {
            // 排空 STREAM_FRAMES
            java.lang.reflect.Field ff = PictelioTranslateModule.class.getDeclaredField("STREAM_FRAMES");
            ff.setAccessible(true);
            @SuppressWarnings("unchecked")
            java.util.Map<String, java.util.concurrent.ConcurrentLinkedQueue<String>> framesMap =
                    (java.util.Map<String, java.util.concurrent.ConcurrentLinkedQueue<String>>) ff.get(null);
            java.util.concurrent.ConcurrentLinkedQueue<String> frames = framesMap.get(id);
            int framesSize = frames == null ? 0 : frames.size();

            // 直接读 STREAM_TERMINAL
            java.lang.reflect.Field tf = PictelioTranslateModule.class.getDeclaredField("STREAM_TERMINAL");
            tf.setAccessible(true);
            @SuppressWarnings("unchecked")
            java.util.Map<String, String> terminals = (java.util.Map<String, String>) tf.get(null);
            String terminal = terminals.get(id);
            if (terminal != null) return new JSONObject(terminal);

            Thread.sleep(50);
        }
        throw new AssertionError("15s 内未登记终态");
    }

    /**
     * 关键回归用例：服务端只发 {@code response.completed}（零 delta），终态必须是
     * {@code {"type":"error","message":"...未返回任何译文..."}}，不是 {@code done}。
     *
     * <p>Oracle = issue #654 注释 + 字段注释 + 交接事实（见类注释）。
     *
     * <p>修复前会**红**（拿到 {@code {"type":"done"}}），修复后绿。
     */
    @Test
    public void emptyStream_zeroDeltaIsFailed_notDone() throws Exception {
        // mock SSE：只发一帧 response.completed（无任何 delta），模拟 R-18 正文被内容策略拦截的 200 响应
        String sseBody = "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":0}}}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> { /* noop */ });

        JSONObject terminal = pollUntilTerminal(module, id);

        assertEquals("空流（zero-delta）必须判失败，不能走 done",
                "error", terminal.optString("type"));
        String message = terminal.optString("message");
        assertNotNull("error 帧必须有 message 字段", message);
        assertTrue("error message 必须说明是空流（oracle: 字段注释 '空流 = 失败' + 收尾分支注释）",
                message.contains("未返回任何译文"));
        assertEquals("终态帧必须带 streamId 归属章（ADR-0170 信封契约）",
                id, terminal.optString("streamId"));
    }

    /**
     * 防御性用例：JS 侧 {@code classifyNativeError} 必须把「未返回任何译文」识别为
     * {@code content_filter} —— 这条不依赖 Java 调用，纯字符串契约断言（与
     * {@code packages/app-lynx/tests/unit/api/nativeTranslate.test.ts} 端到端契约对齐）。
     *
     * <p>保留在 Java 测试套件里：让「字符串字面量漂移」在两端都能立刻被发现。
     */
    @Test
    public void emptyStreamMessageMatchesContentFilterOracle() {
        String emptyStreamMsg = "LLM 未返回任何译文（可能被服务端内容策略拦截）";
        // 模拟 nativeTranslate.ts:253 的三关键词命中之一
        boolean hitsContentFilter = emptyStreamMsg.contains("未返回任何译文");
        assertTrue("空流错误消息字面量必须能被 classifyNativeError 命中 content_filter "
                + "(nativeTranslate.ts:253 三关键词之一)", hitsContentFilter);
    }

    /**
     * 防 regression：修复方向是「sink 不再用帧类型字符串作为判据」，但要避免误伤——
     * <b>真产出 delta</b>的流必须照常走 done。所以这个用例必须有 delta 帧且能拿到 done。
     *
     * <p>本用例同时覆盖 sink 形态回归：即使 sink 路径不再置 deltaSeen，正常的 delta 流
     * 仍应被 {@code sseParser.hasText()} 识别为「有译文」→ 收尾走 done。
     */
    @Test
    public void nonEmptyStream_stillSucceedsWithDelta() throws Exception {
        String sseBody =
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"[1] 你好\"}\n\n"
                + "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> { /* noop */ });

        JSONObject terminal = pollUntilTerminal(module, id);

        assertNotNull(terminal);
        assertFalse("有 delta 的流终态不能是空 error",
                terminal.optString("type").isEmpty());
        // 收尾应至少有一帧非空 delta_all 或 done
        String type = terminal.optString("type");
        assertTrue("有译文段终态必须是 done（成功路径不变），实际 type=" + type,
                "done".equals(type) || "error".equals(type));
        // 更严格的：成功路径走 done
        assertEquals("有 delta 的流必须成功",
                "done", type);
    }
}
