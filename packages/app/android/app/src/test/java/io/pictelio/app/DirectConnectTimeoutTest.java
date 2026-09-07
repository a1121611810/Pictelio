package io.pictelio.app;

import static org.junit.Assert.assertEquals;

import okhttp3.OkHttpClient;
import org.junit.Test;

/**
 * ADR-0145 D2 分层超时钉住：共享 client 的连接预算 5s（候选序列快速推进/系统路线
 * 可达性判定），读/整体预算维持 OAuthConfig 现值。oracle = ADR-0145 D2 拍板值。
 */
public class DirectConnectTimeoutTest {

    @Test
    public void sharedClient_connectTimeout_is5s_layeredBudget() {
        OkHttpClient client = PixivApiCore.getSharedClient();
        assertEquals(5_000, client.connectTimeoutMillis());
        // 整体预算维持现值（connect 15s + read 30s = 45s），分层只动 connect 段
        assertEquals(io.pictelio.app.config.OAuthConfig.TIMEOUT_CONNECT
                        + io.pictelio.app.config.OAuthConfig.TIMEOUT_READ,
                client.callTimeoutMillis());
    }
}
