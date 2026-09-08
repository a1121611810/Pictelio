package io.pictelio.app;

import static org.junit.Assert.assertEquals;

import android.content.Context;

import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

/**
 * ApiEndpoints 单测（ADR-0146 D3）——「API 反代地址」设置的 Java 读取面。
 *
 * <p><b>oracle 溯源</b>：
 * <ul>
 *   <li>官方回退端点 = OAuthConfig.AUTH_URL / PixivApiCore.API_BASE 常量（现状行为）；</li>
 *   <li>反代映射 = ADR-0146 D2 合约：{@code <base>/api} → app-api、
 *       {@code <base>/oauth/auth/token} → oauth.secure（Worker 前缀路由对偶）；</li>
 *   <li>非法输入（明文 http / 空 host）= normalize 拍板「回退官方 + 可见」。</li>
 * </ul>
 *
 * <p>harness：Robolectric 真实 SharedPreferences（等值缓存跨用例静态存活 →
 * 每用例 clear + 重写覆盖，与 ImageHostConfigTest 的 Context 键控同源纪律）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class ApiEndpointsTest {

    private Context ctx;

    @Before
    public void setUp() {
        ctx = RuntimeEnvironment.getApplication();
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit().clear().commit();
        ApiEndpoints.bind(ctx);
    }

    private void write(String raw) {
        ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE)
                .edit().putString("api_proxy_base", raw).commit();
    }

    @Test
    public void 未配置_回退官方域名() {
        write(null);
        ApiEndpoints.refresh();
        assertEquals("https://app-api.pixiv.net", ApiEndpoints.apiBase());
        assertEquals("https://oauth.secure.pixiv.net/auth/token", ApiEndpoints.oauthTokenUrl());
    }

    @Test
    public void 反代配置_按合约映射两上游() {
        write("https://x.y.workers.dev/p/"); // 尾斜杠归一化
        ApiEndpoints.refresh();
        assertEquals("https://x.y.workers.dev/p/api", ApiEndpoints.apiBase());
        assertEquals("https://x.y.workers.dev/p/oauth/auth/token", ApiEndpoints.oauthTokenUrl());
    }

    @Test
    public void 明文http_非法_回退官方() {
        write("http://insecure.example/p");
        ApiEndpoints.refresh();
        assertEquals("https://app-api.pixiv.net", ApiEndpoints.apiBase());
        assertEquals("https://oauth.secure.pixiv.net/auth/token", ApiEndpoints.oauthTokenUrl());
    }

    @Test
    public void 配置变更_等值缓存重检测() {
        write("https://a.workers.dev/p");
        ApiEndpoints.refresh();
        assertEquals("https://a.workers.dev/p/api", ApiEndpoints.apiBase());
        write("https://b.workers.dev/p");
        ApiEndpoints.refresh();
        assertEquals("https://b.workers.dev/p/api", ApiEndpoints.apiBase());
    }
}
