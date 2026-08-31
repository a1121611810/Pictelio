package io.pictelio.app;

import io.pictelio.app.config.OAuthConfig;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import java.net.URI;
import java.util.HashMap;
import java.util.Map;

import org.junit.Test;

/**
 * {@link OAuthPlugin#buildLoginUrl} 纯 JVM 单测。
 *
 * <p>契约来源（oracle 溯源，AGENTS.md 测试硬约束 6）：
 * 1. Pixiv web PKCE 登录现行规范——2026-08-31 模拟器 + curl 实测：
 *    旧规范（client_id + response_type + redirect_uri）被服务器 400「不正なリクエストです」拒绝；
 *    新规范仅三参数（code_challenge / code_challenge_method=S256 / client=pixiv-android），
 *    服务器 302 → accounts.pixiv.net/login 登录页。
 * 2. 上游独立实现（差分测试）：Gallery-dl OAuthPixiv
 *    （gallery_dl/extractor/oauth.py 第 427-433 行参数 dict）与 pixez-flutter
 *    （lib/network/oauth_client.dart 第 152 行字面量 URL）均用此三参数——两实现互证，非本实现反推。
 *
 * <p>期望值锚定：参数值来自上游规范（S256 / pixiv-android），BASE 来自 OAuthConfig.LOGIN_URL
 * （credentials.json5 单一事实源自动生成）。
 */
public class OAuthPluginLoginUrlTest {

    /** 解析 query 参数为 map（重复 key 取首个）。 */
    private static Map<String, String> queryParams(String rawQuery) {
        Map<String, String> out = new HashMap<>();
        if (rawQuery == null) return out;
        for (String pair : rawQuery.split("&")) {
            int eq = pair.indexOf('=');
            if (eq < 0) {
                out.put(pair, "");
            } else {
                out.put(pair.substring(0, eq), pair.substring(eq + 1));
            }
        }
        return out;
    }

    @Test
    public void loginUrl_containsNewSpecParams() {
        String url = OAuthPlugin.buildLoginUrl("abc123_DEF-_~456");
        Map<String, String> q = queryParams(URI.create(url).getRawQuery());

        // 值锚定上游规范（Gallery-dl / pixez-flutter 差分互证）
        assertEquals("abc123_DEF-_~456", q.get("code_challenge"));
        assertEquals("S256", q.get("code_challenge_method"));
        assertEquals("pixiv-android", q.get("client"));
    }

    @Test
    public void loginUrl_excludesLegacyParams() {
        // 旧规范参数必须完全退出（服务器对这些组合一律 400，实测）
        String url = OAuthPlugin.buildLoginUrl("abc123");
        Map<String, String> q = queryParams(URI.create(url).getRawQuery());

        assertFalse("client_id 已弃用", q.containsKey("client_id"));
        assertFalse("response_type 已弃用", q.containsKey("response_type"));
        assertFalse("redirect_uri 已弃用", q.containsKey("redirect_uri"));
    }

    @Test
    public void loginUrl_baseIsOAuthConfigLoginUrl() {
        assertTrue(OAuthPlugin.buildLoginUrl("x").startsWith(
                OAuthConfig.LOGIN_URL + "?code_challenge="));
    }

    @Test
    public void loginUrl_hasExactlyThreeParams() {
        // 新规范恰好三个参数——多了任何参数都可能触发服务器 400
        String url = OAuthPlugin.buildLoginUrl("challenge0");
        Map<String, String> q = queryParams(URI.create(url).getRawQuery());

        assertEquals(3, q.size());
        assertTrue(q.containsKey("code_challenge"));
        assertTrue(q.containsKey("code_challenge_method"));
        assertTrue(q.containsKey("client"));
    }

    @Test
    public void loginUrl_rejectsEmptyChallenge() {
        IllegalArgumentException e = assertThrows(
                IllegalArgumentException.class,
                () -> OAuthPlugin.buildLoginUrl(""));
        assertEquals("codeChallenge must not be empty", e.getMessage());
    }
}
