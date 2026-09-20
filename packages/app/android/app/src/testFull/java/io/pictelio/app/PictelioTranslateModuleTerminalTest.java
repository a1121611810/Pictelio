package io.pictelio.app;

import static org.junit.Assert.assertEquals;
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
import okhttp3.mockwebserver.SocketPolicy;

/**
 * {@link PictelioTranslateModule#translateStream} 4 条终态路径的契约守卫（issue #642 / wayfinder #644）。
 *
 * <p>Oracle 溯源（AGENTS.md 测试硬约束 #6）：每条用例的期望值来自三处独立证据——字段注释 + ADR-0170/0174 + 真机事实：
 * <ol>
 *   <li><b>类型</b>：终态帧必须是 {@code {"type":"error",...}} —— {@link PictelioTranslateModule#registerTerminal}
 *       `:510` 显式置 {@code type="error"}；</li>
 *   <li><b>归属</b>：必须带 {@code streamId} 与 {@code seq} —— ADR-0170 §「跨端信封契约」表格的 streamId/seq 两行；</li>
 *   <li><b>可解析</b>：{@code new JSONObject(payload)} 不抛 ——「裸文本终态 = 永久 UI 挂起」的历史缺陷（ADR-0170 §实现期修订）。</li>
 * </ol>
 *
 * <p><b>M1 变异</b>（{@code registerTerminal} 改回裸文本 {@code put}）：本测试 4 用例应**全红**——
 * {@code new JSONObject(terminal)} 在 {@link #pollUntilTerminal} 内抛 JSONException。
 * （详见 ADR-0174 D3 + research #646 §1.3。）
 *
 * <p><b>测试基础设施</b>：复用 #654 落地的 {@code TestLynxContext}（参见 ADR-0174 D2.1 / D2.2）
 * + 共享假密钥存储 {@link FakeAndroidKeyStore}（**全 JVM 唯一一份**，ADR-0174 D4.1：每类各注册一份
 * 同名 provider 会让后注册的类拿到前一个类的旧密钥 → {@code AEADBadTagException} → 跨类假红）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = Application.class)
public class PictelioTranslateModuleTerminalTest {

    /** LynxContext 唯一抽象方法 = handleException(Exception)（#646 §2.1 javap 实证）。 */
    private static final class TestLynxContext extends LynxContext {
        TestLynxContext(Context base) { super(base, new DisplayMetrics()); }
        @Override public void handleException(Exception e) { }
    }

    private MockWebServer server;
    private PictelioTranslateModule module;

    @Before
    public void setUp() throws Exception {
        FakeAndroidKeyStore.seed("sk-test-terminal-0123456789");
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

    /** 反射清 USER_ABORTED：translateStream 终态走 finally 会自动 remove，但 abort 早于 put 的极端时序可能残留。 */
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

    /** 轮询直到 STREAM_TERMINAL 已登记（生产拉取通道），直接读寄存器跳过中间帧噪声。 */
    private JSONObject pollUntilTerminal(String id) throws Exception, JSONException {
        java.lang.reflect.Field tf = PictelioTranslateModule.class.getDeclaredField("STREAM_TERMINAL");
        tf.setAccessible(true);
        @SuppressWarnings("unchecked")
        java.util.Map<String, String> terminals = (java.util.Map<String, String>) tf.get(null);
        for (int i = 0; i < 300; i++) {
            String terminal = terminals.get(id);
            if (terminal != null) return new JSONObject(terminal);
            Thread.sleep(50);
        }
        throw new AssertionError("15s 内未登记终态");
    }

    /** 终态帧的 4 项共性断言：可解析 JSON + type=error + streamId + seq。 */
    private void assertErrorEnvelope(JSONObject terminal, String id, String messageSubstring) {
        assertNotNull("终态必须存在", terminal);
        assertEquals("终态 type 必须为 error（registerTerminal :510 显式置 type='error'）",
                "error", terminal.optString("type"));
        assertTrue("终态 message 必须含 '" + messageSubstring + "'（oracle: 字段注释 + 收尾分支注释 + 真机事实）",
                terminal.optString("message").contains(messageSubstring));
        assertEquals("终态必须盖 streamId 章（ADR-0170 信封契约 §streamId）",
                id, terminal.optString("streamId"));
        assertTrue("终态必须盖 seq 章（ADR-0170 信封契约 §seq；registerTerminal :518 调用 withSeq）",
                terminal.has("seq"));
    }

    /**
     * 路径 1（HTTP 非 2xx）：MockWebServer 429 → translateStream 走 :376-385 分支
     * （{@code !resp.isSuccessful()}） → registerTerminal → JSON 终态。
     *
     * <p>Oracle：{@code parseHttpError} 拼出 {@code "HTTP 429: <body>"}，registerTerminal 把它包成
     * {@code {"type":"error","message":"HTTP 429: ..."}}。
     *
     * <p>M1 变异下应转红（{@code new JSONObject(terminal)} 抛 JSONException）。
     */
    @Test
    public void httpNon2xxTerminalIsJsonNotRawText() throws Exception {
        server.enqueue(new MockResponse()
                .setResponseCode(429)
                .addHeader("Content-Type", "application/json")
                .setBody("{\"error\":\"rate limit\"}"));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        assertErrorEnvelope(pollUntilTerminal(id), id, "HTTP 429");
    }

    /**
     * 路径 2（网络异常）：baseURL 指向 {@code http://127.0.0.1:1}（loopback 白名单允许，见 :324-326），
     * 端口 1 无监听 → OkHttp connect 拒绝 → catch 块 → registerTerminal("网络错误：" + msg)。
     *
     * <p>Oracle：{@link PictelioTranslateModule}:442-453 catch 分支显式以 "网络错误：" 前缀构造消息。
     *
     * <p>M1 变异下应转红。
     */
    @Test
    public void networkErrorTerminalIsJson() throws Exception {
        String id = UUID.randomUUID().toString();
        module.translateStream(request("http://127.0.0.1:1", id), (args) -> {});

        assertErrorEnvelope(pollUntilTerminal(id), id, "网络错误");
    }

    /**
     * 路径 3（用户 abort）：MockWebServer SocketPolicy.NO_RESPONSE 让服务端永不响应，
     * 主线程有时间在 call.execute() 阻塞期间调 abortStream → call.cancel() → catch 块见
     * USER_ABORTED → registerTerminal("aborted")。
     *
     * <p>为什么用 NO_RESPONSE 而不是 DISCONNECT_AFTER_REQUEST：后者会让 catch 块**几乎立即**触发，
     * abortStream 与 USER_ABORTED.add() 之间存在竞争窗口，CI 负载下 flaky。NO_RESPONSE 让 call
     * 永久阻塞，给 abortStream 充足时间。
     *
     * <p>Oracle：{@link PictelioTranslateModule}:442-447 catch + USER_ABORTED 分支显式以 "aborted"
     * 字符串构造终态（语义 = 用户主动中断，与失败区分，ADR-0170 §D7）。
     *
     * <p>M1 变异下应转红。
     */
    @Test
    public void abortedStreamTerminalIsJson() throws Exception {
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE));

        String id = UUID.randomUUID().toString();
        module.translateStream(request(server.url("/").toString(), id), (args) -> {});

        // 等 call.execute() 进入阻塞；轮询 STREAM_TERMINAL 不存在说明仍在飞行
        Thread.sleep(300);
        module.abortStream(id, (args) -> {});

        assertErrorEnvelope(pollUntilTerminal(id), id, "aborted");
    }

    /**
     * 路径 4（参数校验）：translateStream 收 baseURL 为空 → :313-315 走 failStream → registerTerminal。
     *
     * <p>Oracle：{@link PictelioTranslateModule}:313-315 显式以 "baseURL 不能为空" 字符串构造终态。
     *
     * <p>M1 变异下应转红。
     */
    @Test
    public void parameterValidationFailsWithJsonError() throws Exception {
        // 仅 baseURL 缺省 + 显式 _abortToken；model/input 校验在 baseURL 之后，不会触发
        String id = UUID.randomUUID().toString();
        String req = "{\"baseURL\":\"\",\"_abortToken\":\"" + id + "\"}";
        module.translateStream(req, (args) -> {});

        assertErrorEnvelope(pollUntilTerminal(id), id, "baseURL 不能为空");
    }

    /**
     * 请求构造异常路径必须**登记终态 + 发布事件总线**（不只是 callback）。
     *
     * <p>Oracle：{@code failStream} 自身的 javadoc（「失败终态必须也走事件总线：轮询通道实测
     * 回调 0/158」）+ ADR-0170（callback 通道不可靠）。此前该 catch 只 {@code callback.invoke}
     * → 真机可达（Keystore 重建 / 密文失配使读 apiKey 抛异常）时 JS 侧只能轮询到 POLL_MAX
     * 才超时，UI 长时间停在「n% 翻译中」。
     *
     * <p>构造触发方式：{@code model} 给一个 JSON 类型错（数字而非字符串）→
     * {@code req.getString("instructions")} 之类的强取不会触发，但 {@code buildRequestBody}
     * 里 {@code inputArr} 非数组会走 failStream；这里用**类型错的 input** 触发构造段异常
     * （{@code optJSONArray} 返回 null → 走 "input 不能为空数组" 分支），故改用
     * {@code max_output_tokens} 为字符串触发 {@code req.getInt} 抛异常 —— 那在
     * buildRequestBody 内部，属于「请求构造失败」catch。
     */
    @Test
    public void requestConstructionFailureRegistersTerminal() throws Exception {
        String id = UUID.randomUUID().toString();
        // max_output_tokens 给字符串 → buildRequestBody 内 req.getInt("max_output_tokens") 抛
        String req = "{\"baseURL\":\"https://api.example.com\",\"model\":\"m\","
                + "\"input\":[\"p1\"],\"max_output_tokens\":\"not-a-number\","
                + "\"_abortToken\":\"" + id + "\"}";
        module.translateStream(req, (args) -> {});

        // 关键断言：终态**被登记**（此前只 callback → 这里会 15s 超时变红）
        assertErrorEnvelope(pollUntilTerminal(id), id, "请求构造失败");
    }
}