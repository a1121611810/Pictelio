package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import android.app.Application;
import android.content.Context;
import android.util.DisplayMetrics;

import androidx.test.core.app.ApplicationProvider;

import com.lynx.react.bridge.Callback;
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
import java.util.concurrent.atomic.AtomicReference;

import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.SocketPolicy;

/**
 * {@link PictelioTranslateModule#abortStream} 取消通道的可达性 + 状态清理守卫
 * （issue #642 / #649 / #653，wayfinder #644）。
 *
 * <p><b>Oracle 溯源</b>（AGENTS.md 测试硬约束 #6）：
 * <ul>
 *   <li><b>正向</b>（活流）：{@link PictelioTranslateModule}:714-732 abortStream 在 in-flight 流上
 *       触发 {@code call.cancel()} → translateStream catch 块见 {@link PictelioTranslateModule#USER_ABORTED}
 *       → {@code registerTerminal("aborted")}（{@link PictelioTranslateModule}:443-447）。真机事实：
 *       JS 侧 #653 修复后该路径可达。</li>
 *   <li><b>反向</b>（无活 worker）：abortStream 对未注册 streamId 必须**自行清理** USER_ABORTED
 *       （{@link PictelioTranslateModule}:722-730），否则内存泄漏 + 同名 id 后续流被误判 abort
 *       （{@link PictelioTranslateAbortStreamTest} 已钉住）。</li>
 *   <li><b>幂等</b>：同一 streamId 多次 abortStream 不抛错、不污染 USER_ABORTED（ADR-0170 §D7 幂等）。</li>
 * </ul>
 *
 * <p>本测试与 {@link PictelioTranslateAbortStreamTest} 的关系：
 * <ul>
 *   <li>{@link PictelioTranslateAbortStreamTest} = 无活 worker 路径的反向清理（#653 修复的回归守卫）；</li>
 *   <li>本测试 = 活流可达性 + 已 done 流的 abort 容忍 + 多次幂等（覆盖 #649 跨流串段可达性）。</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class PictelioTranslateModuleCancelTest {

    private static final class TestLynxContext extends LynxContext {
        TestLynxContext(Context base) { super(base, new DisplayMetrics()); }
        @Override public void handleException(Exception e) { }
    }

    private MockWebServer server;
    private PictelioTranslateModule module;

    @Before
    public void setUp() throws Exception {
        FakeAndroidKeyStore.seed("sk-test-cancel-0123456789");
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

    @SuppressWarnings("unchecked")
    private static void clearStaticBuffer(String fieldName) throws Exception {
        java.lang.reflect.Field f = PictelioTranslateModule.class.getDeclaredField(fieldName);
        f.setAccessible(true);
        java.util.Map<String, ?> m = (java.util.Map<String, ?>) f.get(null);
        m.clear();
    }

    private static void clearUserAborted() throws Exception {
        java.lang.reflect.Field f = PictelioTranslateModule.class.getDeclaredField("USER_ABORTED");
        f.setAccessible(true);
        java.util.Set<?> s = (java.util.Set<?>) f.get(null);
        s.clear();
    }

    private static String request(String baseUrl, String id) {
        return "{\"baseURL\":\"" + baseUrl + "\",\"model\":\"gpt-5\",\"input\":[\"段落一\"],"
                + "\"_abortToken\":\"" + id + "\"}";
    }

    private JSONObject waitTerminal(String id) throws Exception {
        java.lang.reflect.Field tf = PictelioTranslateModule.class.getDeclaredField("STREAM_TERMINAL");
        tf.setAccessible(true);
        @SuppressWarnings("unchecked")
        java.util.Map<String, String> terminals = (java.util.Map<String, String>) tf.get(null);
        for (int i = 0; i < 300; i++) {
            String t = terminals.get(id);
            if (t != null) return new JSONObject(t);
            Thread.sleep(50);
        }
        throw new AssertionError("15s 内未登记终态");
    }

    private static Callback recordError(AtomicReference<String> errRef) {
        return (args) -> {
            if (args != null && args.length >= 2 && args[1] != null) {
                String err = String.valueOf(args[1]);
                if (!err.isEmpty()) errRef.set(err);
            }
        };
    }

    /**
     * 活流 abortStream 必须能到达终态为 "aborted" 的 JSON 帧。
     *
     * <p>驱动方式：MockWebServer {@code SocketPolicy.NO_RESPONSE} 让服务端永不响应 →
     * OkHttp call 阻塞 → 主线程有充足时间调 abortStream(id) →
     * call.cancel() 触发 catch 块 → 见 USER_ABORTED → registerTerminal("aborted")。
     *
     * <p>为什么用 NO_RESPONSE：DISCONNECT_AFTER_REQUEST 让 catch 块几乎立即触发，abortStream
     * 与 USER_ABORTED.add() 之间存在竞争窗口，CI 负载下 flaky。
     *
     * <p>Oracle = ADR-0170 §D7 幂等 + :442-447 catch 分支显式以 "aborted" 字符串构造终态。
     */
    @Test
    public void abortStreamOnLiveCall_terminatesOkHttp() throws Exception {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        // 等 call.execute() 进入阻塞；轮询 STREAM_TERMINAL 不存在说明仍在飞行
        Thread.sleep(300);
        module.abortStream(id, (args) -> {});

        JSONObject terminal = waitTerminal(id);
        assertEquals("活流 abortStream 后终态 type 必须为 error（oracle: catch 分支 :443-447）",
                "error", terminal.optString("type"));
        assertEquals("活流 abortStream 后终态 message 必须为 'aborted'（oracle: ADR-0170 §D7 中断语义）",
                "aborted", terminal.optString("message"));
        assertEquals("终态必须盖 streamId 章", id, terminal.optString("streamId"));
    }

    /**
     * 已 done 的流 abort 不报错。abortStream 调 ACTIVE_CALLS.remove 返回 null（流已退出 worker
     * 的 finally 清掉）→ 进入 else 分支显式 USER_ABORTED.remove → cb("", "") 成功。
     *
     * <p>Oracle = {@link PictelioTranslateModule}:725-731 注释「无活 worker」分支 + ADR-0170 §D7 幂等。
     */
    @Test
    public void abortAfterCompletion_noOp() throws Exception {
        // 短流：1 帧 delta + completed，让 translateStream 自然收敛
        String sseBody =
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"[0] ok\"}\n\n"
                + "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}}\n\n";
        server.enqueue(new MockResponse()
                .setResponseCode(200)
                .addHeader("Content-Type", "text/event-stream")
                .setBody(sseBody));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});
        JSONObject terminal = waitTerminal(id);
        assertEquals("前置条件：流必须已 done", "done", terminal.optString("type"));

        // 现在 abort 已 done 的流 —— 必须 cb("", "") 成功
        AtomicReference<String> errRef = new AtomicReference<>();
        module.abortStream(id, recordError(errRef));

        assertNull("已 done 的流 abort 必须 cb('', '') 成功（ADR-0170 §D7 幂等）",
                errRef.get());
        java.lang.reflect.Field f = PictelioTranslateModule.class.getDeclaredField("USER_ABORTED");
        f.setAccessible(true);
        assertTrue("USER_ABORTED 必须为空", ((java.util.Set<?>) f.get(null)).isEmpty());
    }

    /**
     * 未启动的 streamId abort 不报错（反向清理守卫）。
     *
     * <p>Oracle = ADR-0170 §D7 幂等 + {@link PictelioTranslateModule}:722-731 「无活 worker」分支
     * 显式 USER_ABORTED.remove —— {@link PictelioTranslateAbortStreamTest} 已钉住同一行为，
     * 本用例作为 ticket #642 范围内的\"未启动场景\"覆盖。
     */
    @Test
    public void abortBeforeStart_noOp() {
        AtomicReference<String> errRef = new AtomicReference<>();
        Callback cb = recordError(errRef);

        // 从未调过 translateStream
        module.abortStream("never-started-" + System.nanoTime(), cb);

        assertNull("未启动的 streamId abort 必须 cb('', '') 成功（ADR-0170 §D7 幂等）",
                errRef.get());
    }

    /**
     * 同一 token 多次 abortStream 必须幂等，且 USER_ABORTED 不得残留。
     *
     * <p>Oracle = ADR-0170 §D7 幂等 + :722-731 「无活 worker」else 分支显式 remove（idempotency
     * 关键：USER_ABORTED.add → remove → add → remove，每次循环都平衡）。
     */
    @Test
    public void multipleAbortSameToken_idempotent() throws Exception {
        String streamId = "repeated-" + System.nanoTime();

        for (int i = 0; i < 5; i++) {
            AtomicReference<String> errRef = new AtomicReference<>();
            module.abortStream(streamId, recordError(errRef));
            assertNull("第 " + (i + 1) + " 次 abort 必须 cb('', '') 成功",
                    errRef.get());
        }

        java.lang.reflect.Field f = PictelioTranslateModule.class.getDeclaredField("USER_ABORTED");
        f.setAccessible(true);
        assertTrue("连续 abort 同一 id 必须保持 USER_ABORTED 为空",
                ((java.util.Set<?>) f.get(null)).isEmpty());
    }
}