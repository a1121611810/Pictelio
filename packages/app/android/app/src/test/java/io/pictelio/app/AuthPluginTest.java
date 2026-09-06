package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import com.getcapacitor.JSObject;

import org.json.JSONException;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * AuthPlugin OAuth 交换响应解析契约单测（#386）——
 * 对 {@link AuthPlugin#parseTokenResponse(String)}（从 refreshToken 的 onResponse
 * 原样提取的包可见静态解析核心）做纯 JVM 验证，不发起任何网络请求。
 *
 * <p><b>Oracle 溯源（测试硬约束 #6：期望值出处可追溯）</b>——期望值全部来自独立来源，
 * 禁止从被测实现反推：
 * <ul>
 *   <li><b>成功形态</b>（{@code response} 包裹的 {@code access_token / refresh_token /
 *       user{id, name, account, profile_image_urls.px_170x170}}）：Pixiv OAuth 端点真实
 *       响应契约——独立参照 {@link PixivApiCore#oauthTokenExchange} 对同一形态的解析
 *       （{@code optJSONObject("response")} 包裹分支 + 同名 opt* 字段提取），双实现同构
 *       即差分 oracle；</li>
 *   <li><b>失败形态 1</b>（字符串 error 的 {@code has_error} 载荷，字面引用）：
 *       {@code packages/app/CONTEXT.md}「OAuth Token 400 错误」节（一手来源
 *       pixivpy#374、gallery-dl#9331，探针报告 H2 实测）；</li>
 *   <li><b>失败形态 2</b>（对象 error 载荷，{@code message} 含 OAuth / invalid_request
 *       子串）：同上来源（CONTEXT.md 以省略号记录该形态，fixture 按 message 含
 *       "OAuth"+"invalid_request" 子串构造）；</li>
 *   <li><b>失败形态的宽松降级断言</b>：生产路径上这两种形态以 HTTP 400 到达，被
 *       refreshToken 的 {@code !response.isSuccessful()} 分支以
 *       "OAuth failed (HTTP xxx): ..." reject 短路（JS 侧
 *       {@code authStore.isAuthErrorPermanent} 依赖该消息中 "HTTP 40" 子串做永久/瞬时
 *       分类，见 {@code packages/app/src/stores/authStore.ts}），不会进入解析核心——
 *       本组断言钉住解析核心对无 access_token 载荷的宽松默认（optString 空串 /
 *       optInt 0），任何未来收紧都是显式契约变更；</li>
 *   <li><b>无包裹回退分支</b>（{@code response} 缺失时取根对象）：与
 *       {@link PixivApiCore#oauthTokenExchange} 的 {@code resp == null → resp = json}
 *       回退语义同构（防御分支，独立参照双实现一致性）。</li>
 * </ul>
 *
 * <p>harness 对齐 {@link ImageHostConfigTest}（Robolectric + sdk 28，org.json 由
 * Robolectric 提供，非 android.jar stub）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class AuthPluginTest {

    // ── 真实响应形态 fixture（oracle 见类头注释） ──────────────

    /** 成功形态：Pixiv OAuth 真实契约（response 包裹 + user 四字段，px_170x170 头像 URL） */
    private static final String SUCCESS_BODY =
            "{\"response\":{\"access_token\":\"abc\",\"refresh_token\":\"def\","
                    + "\"user\":{\"id\":123,\"name\":\"测试用户\",\"account\":\"tester\","
                    + "\"profile_image_urls\":{\"px_170x170\":\"https://i.pximg.net/x.jpg\"}}}}";

    /** 失败形态 1：refresh_token 无效（HTTP 400，字符串 error 载荷）——字面引用 CONTEXT.md */
    private static final String HAS_ERROR_BODY =
            "{\"has_error\":true,\"errors\":{\"system\":{\"message\":\"Invalid refresh token\","
                    + "\"code\":1508}},\"error\":\"invalid_grant\"}";

    /** 失败形态 2：对象 error 载荷（HTTP 400，message 含 OAuth/invalid_request 子串） */
    private static final String ERROR_OBJECT_BODY =
            "{\"error\":{\"message\":\"Error: OAuth failed. The request is missing a required "
                    + "parameter, includes an invalid parameter value: invalid_request\"}}";

    // ── 成功形态（oracle = Pixiv OAuth 真实契约 × PixivApiCore.oauthTokenExchange 同构） ──

    @Test
    public void parse_successShape_extractsTokensUserAndProfileImageUrls() throws Exception {
        JSObject result = AuthPlugin.parseTokenResponse(SUCCESS_BODY);
        assertEquals("abc", result.getString("accessToken"));
        assertEquals("def", result.getString("refreshToken"));
        assertEquals(123, result.getInt("userId"));
        assertEquals("测试用户", result.getString("userName"));
        assertEquals("tester", result.getString("userAccount"));
        assertEquals("https://i.pximg.net/x.jpg",
                result.getJSONObject("profileImageUrls").getString("px_170x170"));
    }

    @Test
    public void parse_withoutResponseEnvelope_fallsBackToRootObject() throws Exception {
        // oracle：PixivApiCore.oauthTokenExchange 的 resp == null → resp = json 同款回退分支
        JSObject result = AuthPlugin.parseTokenResponse(
                "{\"access_token\":\"abc\",\"refresh_token\":\"def\","
                        + "\"user\":{\"id\":1,\"name\":\"u\",\"account\":\"a\"}}");
        assertEquals("abc", result.getString("accessToken"));
        assertEquals("def", result.getString("refreshToken"));
        assertEquals(1, result.getInt("userId"));
        assertEquals("u", result.getString("userName"));
        assertEquals("a", result.getString("userAccount"));
    }

    // ── 失败形态（生产路径 HTTP 400 被 isSuccessful 分支短路，不进入解析核心；钉住宽松降级） ──

    @Test
    public void parse_failureShapeHasError_lenientDefaults_noThrow() throws Exception {
        // oracle：CONTEXT.md「OAuth Token 400 错误」字符串形态（pixivpy#374 / gallery-dl#9331）
        JSObject result = AuthPlugin.parseTokenResponse(HAS_ERROR_BODY);
        // has_error 载荷无 response 包裹、无 access_token/user → 回退根对象后全取宽松默认值
        assertEquals("", result.getString("accessToken"));
        assertEquals("", result.getString("refreshToken"));
        assertEquals(0, result.getInt("userId"));
        assertEquals("", result.getString("userName"));
        assertEquals("", result.getString("userAccount"));
        assertFalse(result.has("profileImageUrls"));
    }

    @Test
    public void parse_failureShapeErrorObject_lenientDefaults_noThrow() throws Exception {
        // oracle：CONTEXT.md「OAuth Token 400 错误」对象形态（message 含 OAuth/invalid_request 子串）
        JSObject result = AuthPlugin.parseTokenResponse(ERROR_OBJECT_BODY);
        assertEquals("", result.getString("accessToken"));
        assertEquals("", result.getString("refreshToken"));
        assertEquals(0, result.getInt("userId"));
        assertEquals("", result.getString("userName"));
        assertEquals("", result.getString("userAccount"));
        assertFalse(result.has("profileImageUrls"));
    }

    // ── 非法 JSON（可判别信号：JSONException → "Failed to parse OAuth response" reject） ──

    @Test
    public void parse_malformedJson_throwsJSONException() {
        // 可判别信号 = JSONException：refreshToken 的 catch 块原样映射为
        // "Failed to parse OAuth response: ..." reject（提取前后同一条 catch 路径）
        assertThrows(JSONException.class, () -> AuthPlugin.parseTokenResponse("not-json"));
        assertThrows(JSONException.class, () -> AuthPlugin.parseTokenResponse("{broken"));
    }

    // ── 跨端 reject 消息契约（#386 code-review 审计一机器防线） ──

    @Test
    public void oauthRejectMessage_permanentClassificationPrefix_pinned() {
        // oracle：packages/app/src/stores/authStore.ts isAuthErrorPermanent 对消息做
        // includes("OAuth failed (HTTP 40") 子串匹配（400–409 → 永久失效触发 logout；
        // 其余瞬时保留 token）——Java 生产者是该跨端契约唯一来源，钉住前缀形态。
        String m400 = AuthPlugin.oauthRejectMessage(400, "body");
        assertTrue("400 命中永久分类子串: " + m400, m400.contains("OAuth failed (HTTP 40"));
        assertEquals("消息形态 = 前缀 + 状态码 + 截断 body",
                "OAuth failed (HTTP 400): body", m400);
        assertTrue("409 同在 400-409 永久区间",
                AuthPlugin.oauthRejectMessage(409, "b").contains("OAuth failed (HTTP 40"));
        // 300 字符截断（长 body 不撑爆 JSBridge 消息，与提取前行为一致）
        String longBody = "x".repeat(400);
        assertEquals("OAuth failed (HTTP 500): " + "x".repeat(300),
                AuthPlugin.oauthRejectMessage(500, longBody));
    }

}
