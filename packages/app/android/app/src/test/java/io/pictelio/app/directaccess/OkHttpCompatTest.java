package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * OkHttpCompat 单测（T13）：
 *   - version() 探测当前 OkHttp 版本字符串
 *   - supportsEch() 当前 OkHttp 4.12.0 返回 false（OkHttp 5.x 才有 ECH）
 *   - supportsQuic() 当前 OkHttp 4.12.0 返回 false
 *   - summary() 输出包含关键字段
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class OkHttpCompatTest {

    @Test
    public void version_returnsNonNull() {
        assertNotNull(OkHttpCompat.version());
    }

    @Test
    public void supportsEch_returnsFalseOnOkHttp4x() {
        // 当前项目 OkHttp 4.12.0 不支持 ECH（5.x 才支持）
        // 未来升级 OkHttp 5.x 时此测试会标红，提醒重新评估 ECH 启用
        assertFalse("OkHttp 4.12.0 不支持 ECH", OkHttpCompat.supportsEch());
    }

    @Test
    public void supportsQuic_returnsFalseByDefault() {
        // OkHttp 4.x 默认不含 QUIC（需 Cronet 或显式 protocol 配置）
        assertFalse("OkHttp 4.12.0 默认不支持 QUIC", OkHttpCompat.supportsQuic());
    }

    @Test
    public void summary_includesKeyFields() {
        String summary = OkHttpCompat.summary();
        assertNotNull(summary);
        assertTrue("summary 应包含 OkHttp", summary.contains("OkHttp"));
        assertTrue("summary 应包含 ECH 标记", summary.contains("ECH"));
        assertTrue("summary 应包含 QUIC 标记", summary.contains("QUIC"));
    }

    @Test
    public void versionIsStable_acrossInvocations() {
        // version() 是静态常量，多次调用应返回相同值（不变性）
        String v1 = OkHttpCompat.version();
        String v2 = OkHttpCompat.version();
        assertEquals(v1, v2);
    }
}