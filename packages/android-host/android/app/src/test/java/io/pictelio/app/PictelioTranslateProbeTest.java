package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * 端点探测的请求体形态 + 状态判定表单测（#831）。
 *
 * <p><b>背景</b>：探测请求体曾把 {@code input} 写成裸字符串数组 {@code ["ping"]}，而 Responses API
 * 不接受该形态（DeepSeek 实测 422 {@code input: invalid input item}）。因 DeepSeek 鉴权先于路由，
 * dummy key 总是先撞 401、掩盖了报文缺陷 → 自动探测判「兼容」；而「测试连接」用真实 key，
 * 鉴权通过后缺陷立刻显形 → 报 422 并把凭据写成 failed。同一端点两条路径判定矛盾。
 *
 * <p><b>Oracle 溯源</b>（AGENTS.md 测试硬约束 #6）——期望值不取自实现：
 * <ul>
 *   <li>请求体形态 = OpenAI Responses API 规约：{@code input} 须为<b>标量字符串</b>或
 *       <b>消息数组</b>（{@code [{role, content}]}），<b>不得</b>为裸字符串数组；</li>
 *   <li>状态映射 = ADR-0173 D3 决策表的逐行条款（只改实现不改 ADR，本测试必须转红）；</li>
 *   <li>响应体样例 = 实测抓取的 DeepSeek 真实响应（resources/llm-probe/），非手写自洽字段。</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioTranslateProbeTest {

    // ───────────────────────── 请求体形态（缝 2） ─────────────────────────

    /**
     * 探测请求的 {@code input} 必须是标量字符串，不得是裸字符串数组。
     *
     * <p><b>变异验证</b>：把实现改回 {@code new JSONArray().put("ping")} 本测试立即转红
     * —— 断言锚 Responses API 规约，不是锚当前实现输出。
     */
    @Test
    public void probeRequestInputIsScalarStringNotBareStringArray() throws Exception {
        JSONObject body = PictelioTranslateModule.buildProbeRequestBody("deepseek-chat");

        // 规约：input 为标量字符串 → get() 返回 String
        assertTrue(
                "探测 input 必须是标量字符串（Responses API 规约），实际类型=" + body.get("input").getClass(),
                body.get("input") instanceof String);
        // 注：此处刻意不断言 input 的具体字面量 —— Responses API 规约只约束形态
        // （标量字符串 / 消息数组），不约束探测文本内容。断言字面量会把实现钉死。
        assertFalse(body.getString("input").isEmpty());
    }

    /**
     * 探测报文保持最小 POST 语义：单 token、不流式。
     *
     * <p>属<b>特征化（防回归）</b>而非规约断言：这两个值当前实现合理，但 Responses API
     * 规约并不规定它们。因此本用例不作为「实现正确」的证据，只锁住不被无意改动。
     */
    @Test
    public void probeRequestKeepsMinimalPostSemantics() throws Exception {
        JSONObject body = PictelioTranslateModule.buildProbeRequestBody("some-model");

        assertEquals("some-model", body.getString("model"));
        assertEquals(1, body.getInt("max_output_tokens"));
        assertFalse("探测不 stream（只要状态码，不要 SSE）", body.getBoolean("stream"));
    }

    // ───────────────────────── 状态判定表（缝 1） ─────────────────────────

    /**
     * D3 表：2xx → ok。
     *
     * <p>样例为实测抓取：修复后的探测报文 + 真实密钥，DeepSeek 返回
     * {@code object: response} / {@code status: incomplete}（incomplete 是因为
     * {@code max_output_tokens=1} 截断，属预期）。这是 #944「有效密钥点测试连接
     * 返回成功」的机器证据 —— 与 422 fixture（修复前）构成同一报文的成败对照。
     */
    @Test
    public void classify2xxIsOk() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(200, fixture("deepseek-200-completed.json"));

        assertEquals("ok", r.getString("status"));
        assertEquals(200, r.getInt("httpStatus"));
    }

    /**
     * D3 表：401 → ok + keyInvalid。
     *
     * <p>样例为实测 DeepSeek 真实响应。注意该响应体**不含**任何 invalid-key 关键词 ——
     * 走的是 401 分支而非 400 分支，这正是 #831 中dummy key 掩盖报文缺陷的那条路径。
     */
    @Test
    public void classify401IsOkWithKeyInvalid() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(401, fixture("deepseek-401-authentication-error.json"));

        assertEquals("ok", r.getString("status"));
        assertTrue("401 必须标记 keyInvalid（凭据层据此判 failed）", r.getBoolean("keyInvalid"));
        assertEquals(401, r.getInt("httpStatus"));
    }

    /** D3 表：403 同 401。 */
    @Test
    public void classify403IsOkWithKeyInvalid() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(403, "{\"error\":{\"message\":\"forbidden\"}}");

        assertEquals("ok", r.getString("status"));
        assertTrue(r.getBoolean("keyInvalid"));
    }

    /**
     * D3 表：400 + invalid-key 关键词 → ok + keyInvalid。
     *
     * <p>关键词取自 D3 表条款本身（invalid_api_key / incorrect api key / invalid api key）。
     * DeepSeek 对无效 key 返回 401 而非 400，故此行针对返回 400 形态的服务。
     */
    @Test
    public void classify400WithInvalidKeyBodyIsOkWithKeyInvalid() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(
                400, "{\"error\":{\"message\":\"Incorrect API key provided: sk-xxx\",\"code\":\"invalid_request_error\"}}");

        assertEquals("ok", r.getString("status"));
        assertTrue(r.getBoolean("keyInvalid"));
    }

    /**
     * D3 表：404 → incompatible（不是 Responses 端点）。
     *
     * <p>样例为实测抓取：真实密钥打一个构造的不存在路径，服务端回空体 404。
     * 这条与 401 fixture 构成对照 —— dummy key 对同一路径回 401（鉴权先于路由），
     * 正因如此 dummy key 永远看不到这个 404，绿灯才失去「端点存在」的证明力
     * （ADR-0173 D3 §能力边界）。
     */
    @Test
    public void classify404IsIncompatible() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(404, fixture("deepseek-404-not-found.json"));

        assertEquals("incompatible", r.getString("status"));
    }

    /** D3 表：405 → partial（仅 chat/completions）。 */
    @Test
    public void classify405IsPartial() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(405, "");

        assertEquals("partial", r.getString("status"));
    }

    /**
     * 400 但**不含** invalid-key 关键词 → unknown（不得误判为 ok）。
     *
     * <p>样例为实测 DeepSeek 真实响应：未知模型名返回 400，其body 不含任何 invalid-key 关键词。
     * 若误判为 ok，用户会拿到一个「兼容」绿灯去配一个必然失败的模型。
     */
    @Test
    public void classify400WithoutInvalidKeyBodyIsUnknown() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(400, fixture("deepseek-400-unknown-model.json"));

        assertEquals("unknown", r.getString("status"));
    }

    /**
     * 422 → unknown（#831 的实测报文形态失败）。
     *
     * <p>样例为实测 DeepSeek 真实响应。报文形态修正后该码不应再出现于合法探测，
     * 但判定表必须显式钉住它 —— 落unknown 而非误判 ok。
     */
    @Test
    public void classify422IsUnknown() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(422, fixture("deepseek-422-invalid-input-item.json"));

        assertEquals("unknown", r.getString("status"));
    }

    /**
     * 缺 model 字段的 422 同样落 unknown。
     *
     * <p>⚠️ 该fixture 来自<b>人工构造</b>的请求（探测报文恒定写入 model，应用无路径可触发
     * 「缺 model」）。保留它只为钉住「422 一律落 unknown 而非 ok」这条分流 —— 防止有人
     * 给 422 加一条「看起来像 invalid-key 就判 ok」的分支。可信度低于另外五份。
     */
    @Test
    public void classify422MissingModelIsUnknown() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(422, fixture("deepseek-422-missing-model.json"));

        assertEquals("unknown", r.getString("status"));
    }

    /** 5xx → unknown。 */
    @Test
    public void classify5xxIsUnknown() throws Exception {
        JSONObject r = PictelioTranslateModule.classifyProbe(503, "");

        assertEquals("unknown", r.getString("status"));
    }

    // ───────────────────────── responsesUrl（零覆盖补齐） ─────────────────────────

    /** baseURL 已以 /v1 结尾 → 只补 /responses（否则会拼出 /v1/v1/responses）。 */
    @Test
    public void responsesUrlDoesNotDoubleV1() {
        assertEquals(
                "https://api.deepseek.com/v1/responses",
                PictelioTranslateModule.responsesUrl("https://api.deepseek.com/v1"));
    }

    /** Azure /openai/v1 结尾 → 只补 /responses。 */
    @Test
    public void responsesUrlHandlesAzureOpenAiV1() {
        assertEquals(
                "https://x.openai.azure.com/openai/v1/responses",
                PictelioTranslateModule.responsesUrl("https://x.openai.azure.com/openai/v1"));
    }

    /** 未带 /v1 → 补 /v1/responses。 */
    @Test
    public void responsesUrlAppendsV1WhenAbsent() {
        assertEquals(
                "https://api.openai.com/v1/responses",
                PictelioTranslateModule.responsesUrl("https://api.openai.com"));
    }

    /** 尾部斜杠须先剥除，否则会拼出 //responses。 */
    @Test
    public void responsesUrlStripsTrailingSlashes() {
        assertEquals(
                "https://api.deepseek.com/v1/responses",
                PictelioTranslateModule.responsesUrl("https://api.deepseek.com/v1///"));
    }

    // ───────────────────────── fixture 读取 ─────────────────────────

    /**
     * 读实测抓取的真实响应体（测试硬约束 #2：mock 来自真实数据源，禁手写自洽字段）。
     *
     * @throws IllegalStateException fixture 缺失时抛出 —— 不静默回落到空串，否则测试会
     *         变成在断言一个空 body 的行为，掩盖真实语义。
     */
    private static String fixture(String name) throws IOException {
        try (InputStream in = PictelioTranslateProbeTest.class.getClassLoader().getResourceAsStream(
                "llm-probe/" + name)) {
            if (in == null) {
                throw new IllegalStateException("fixture 缺失: llm-probe/" + name);
            }
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[4096];
            int n;
            while ((n = in.read(buf)) != -1) {
                out.write(buf, 0, n);
            }
            return out.toString(StandardCharsets.UTF_8);
        }
    }
}
