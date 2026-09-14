package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import com.lynx.react.bridge.Callback;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.util.Arrays;
import java.util.Collections;

/**
 * PictelioWebDavModule 桥契约测试（spec docs/specs/webdav-backup.md §4；ADR-0156 D1）。
 *
 * <p>测桥的<b>数据契约</b>（JS 侧 utils/webDavBridge.ts 的解析面），不测协议逻辑
 * （协议由 WebDavClientTest 覆盖）。oracle = TS 桥源码 + spec §5 错误分类：
 * <ul>
 *   <li>失败 payload = JSON 对象，键恰为 kind / statusCode / message</li>
 *   <li>kind 取值 ∈ WebDavClient.Kind 名 + CRYPTO（TS 桥 WEBDAV_ERROR_KINDS 同集）</li>
 *   <li>条目 JSON 键 = href / isCollection / contentLength（null 时序列化为 JSON null）</li>
 *   <li>Callback 契约：错误 payload 永不为 null（CallbackImpl 对 null 崩）</li>
 * </ul>
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class PictelioWebDavModuleTest {

    @Test
    public void errorJson_shapeMatchesTsBridge() throws Exception {
        String json = PictelioWebDavModule.errorJson("AUTH_FAILED", 401, "认证失败");
        JSONObject o = new JSONObject(json);
        // 键集合恰好为 TS 桥读取的三个字段（多/少键都是契约破坏）
        assertEquals(3, o.length());
        assertEquals("AUTH_FAILED", o.getString("kind"));
        assertEquals(401, o.getInt("statusCode"));
        assertEquals("认证失败", o.getString("message"));
    }

    @Test
    public void errorJson_nullMessage_normalizedToEmpty() throws Exception {
        // Callback 对 null 参数崩（真机实测）——payload message 必须归一为非 null 字符串
        JSONObject o = new JSONObject(PictelioWebDavModule.errorJson("SERVER", -1, null));
        assertEquals("", o.getString("message"));
    }

    // ── Callback 边界行为（M2：用真实 run() 驱动，而非只测 errorJson）──

    /** 记录 invoke 实参的假 Callback（Lynx Callback 契约：invoke(Object...)） */
    private static final class RecordingCallback implements Callback {
        private final java.util.concurrent.CountDownLatch latch =
                new java.util.concurrent.CountDownLatch(1);
        volatile Object[] args;

        @Override
        public void invoke(Object... objects) {
            this.args = objects;
            latch.countDown();
        }

        Object[] await() throws InterruptedException {
            if (!latch.await(5, java.util.concurrent.TimeUnit.SECONDS)) {
                throw new AssertionError("Callback 未在 5s 内被调用");
            }
            return args;
        }
    }

    @Test
    public void run_success_invokesCode0WithNonNullPayload() throws Exception {
        RecordingCallback cb = new RecordingCallback();
        PictelioWebDavModule.run(cb, () -> "payload");
        Object[] args = cb.await();
        assertEquals(2, args.length);
        assertEquals(0, args[0]);
        assertEquals("payload", args[1]);
        assertNotNull(args[1]); // Callback 对 null 崩 + 失败分支读 payload 字符串
    }

    @Test
    public void run_davException_invokesCode1WithErrorJson() throws Exception {
        RecordingCallback cb = new RecordingCallback();
        PictelioWebDavModule.run(cb, () -> {
            throw new WebDavClient.DavException(WebDavClient.Kind.QUOTA_EXCEEDED, 507, "配额不足");
        });
        Object[] args = cb.await();
        assertEquals(1, args[0]);
        JSONObject err = new JSONObject((String) args[1]);
        assertEquals("QUOTA_EXCEEDED", err.getString("kind"));
        assertEquals(507, err.getInt("statusCode"));
        assertEquals("配额不足", err.getString("message"));
    }

    @Test
    public void run_cryptoException_classifiedAsCrypto() throws Exception {
        RecordingCallback cb = new RecordingCallback();
        PictelioWebDavModule.run(cb, () -> {
            throw new BackupCrypto.CryptoException("密码错误或文件损坏");
        });
        Object[] args = cb.await();
        assertEquals(1, args[0]);
        assertEquals("CRYPTO", new JSONObject((String) args[1]).getString("kind"));
    }

    @Test
    public void run_unexpectedException_classifiedAsServerNeverNull() throws Exception {
        RecordingCallback cb = new RecordingCallback();
        PictelioWebDavModule.run(cb, () -> {
            throw new IllegalStateException("boom");
        });
        Object[] args = cb.await();
        assertEquals(1, args[0]);
        JSONObject err = new JSONObject((String) args[1]);
        assertEquals("SERVER", err.getString("kind"));
        assertNotNull(err.getString("message"));
    }

    @Test
    public void entryToJson_shapeAndNullLength() throws Exception {
        JSONObject withLen = PictelioWebDavModule.entryToJson(
                new WebDavClient.DavEntry("/dav/a.json", false, 123L));
        assertEquals("/dav/a.json", withLen.getString("href"));
        assertFalse(withLen.getBoolean("isCollection"));
        assertEquals(123L, withLen.getLong("contentLength"));

        // 服务器缺 getcontentlength（自托管差异）→ JSON null（TS 桥 WebDavEntry.contentLength: null）
        JSONObject noLen = PictelioWebDavModule.entryToJson(
                new WebDavClient.DavEntry("/dav/", true, null));
        assertTrue(noLen.getBoolean("isCollection"));
        assertTrue(noLen.isNull("contentLength"));
    }

    @Test
    public void entriesToJson_arrayContract() throws Exception {
        String json = PictelioWebDavModule.entriesToJson(Arrays.asList(
                new WebDavClient.DavEntry("/dav/", true, null),
                new WebDavClient.DavEntry("/dav/f.json", false, 9L)));
        JSONArray arr = new JSONArray(json);
        assertEquals(2, arr.length());
        assertEquals("/dav/", arr.getJSONObject(0).getString("href"));
        assertEquals(9L, arr.getJSONObject(1).getLong("contentLength"));
        // 空列表合法（TS 桥 .map 空数组）
        assertEquals(0, new JSONArray(PictelioWebDavModule.entriesToJson(Collections.emptyList())).length());
    }

    @Test
    public void errorKindNames_matchWebDavClientEnumPlusCrypto() {
        // kind 取值集合 = Java Kind 枚举名 + CRYPTO（密码错误或文件损坏，spec §6）
        String[] fromEnum = Arrays.stream(WebDavClient.Kind.values()).map(Enum::name).toArray(String[]::new);
        assertEquals(7, fromEnum.length); // AUTH_FAILED/FORBIDDEN/NOT_FOUND/QUOTA_EXCEEDED/CONFLICT/NETWORK/SERVER
        for (String name : fromEnum) {
            String json = PictelioWebDavModule.errorJson(name, 0, "x");
            try {
                assertEquals(name, new JSONObject(json).getString("kind"));
            } catch (Exception e) {
                throw new AssertionError("kind 序列化失败: " + name, e);
            }
        }
    }
}
