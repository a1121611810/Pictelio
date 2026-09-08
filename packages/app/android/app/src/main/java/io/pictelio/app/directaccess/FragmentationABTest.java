package io.pictelio.app.directaccess;

import android.util.Log;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.io.IOException;
import java.net.InetAddress;
import java.net.Socket;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

/**
 * [PROTOTYPE prototype/tcp-fragment-proxy] ClientHello 分片 A/B 对比测试。
 *
 * 在设备上自动执行：
 *   A 组：直连 .155:443（无分片）→ 预期被 RST
 *   B 组：经分片代理连 .155:443 → 验证分片是否让 DPI 失效
 *
 * 结果输出到 logcat tag "FRAG-AB-TEST"。
 * 仅用于原型验证，验证完毕后删除。
 */
public final class FragmentationABTest {

    private static final String TAG = "FRAG-AB-TEST";
    private static final String PIXIV_IP = "210.140.139.155";

    public static void run() {
        new Thread(() -> {
            try {
                Log.w(TAG, "=== 分片 A/B 测试开始 ===");

                // A 组：直连（无分片）
                String resultA = tryDirectHandshake();
                Log.w(TAG, "A组（直连无分片）: " + resultA);

                // B 组：经分片代理
                String resultB = tryFragmentedHandshake(1);
                Log.w(TAG, "B组（分片 offset=1）: " + resultB);

                // C 组：不同分片偏移
                String resultC = tryFragmentedHandshake(5);
                Log.w(TAG, "C组（分片 offset=5）: " + resultC);

                Log.w(TAG, "=== 分片 A/B 测试结束 ===");
            } catch (Exception e) {
                Log.w(TAG, "AB test error", e);
            }
        }, "frag-ab-test").start();
    }

    private static String tryDirectHandshake() {
        long start = System.currentTimeMillis();
        try {
            Socket s = new Socket(InetAddress.getByName(PIXIV_IP), 443);
            s.setSoTimeout(8000);
            SSLSocket ssl = createTls(s, PIXIV_IP);
            ssl.startHandshake();
            long elapsed = System.currentTimeMillis() - start;
            ssl.close();
            return "SUCCESS (" + elapsed + "ms)";
        } catch (Exception e) {
            long elapsed = System.currentTimeMillis() - start;
            return "FAILED (" + elapsed + "ms) " + rootMessage(e);
        }
    }

    private static String tryFragmentedHandshake(int offset) {
        long start = System.currentTimeMillis();
        TlsFragmentingProxy proxy = new TlsFragmentingProxy(0, PIXIV_IP, 443, offset);
        try {
            int port = proxy.start();
            Socket s = new Socket(InetAddress.getByName("127.0.0.1"), port);
            s.setSoTimeout(8000);
            SSLSocket ssl = createTls(s, PIXIV_IP);
            ssl.startHandshake();
            long elapsed = System.currentTimeMillis() - start;
            ssl.close();
            return "SUCCESS (" + elapsed + "ms)";
        } catch (Exception e) {
            long elapsed = System.currentTimeMillis() - start;
            return "FAILED (" + elapsed + "ms) " + rootMessage(e);
        } finally {
            proxy.stop();
        }
    }

    private static SSLSocket createTls(Socket raw, String peerHost) throws Exception {
        SSLSocketFactory factory = SSLContext.getDefault().getSocketFactory();
        return (SSLSocket) factory.createSocket(raw, peerHost, 443, true);
    }

    private static String rootMessage(Throwable t) {
        Throwable cur = t;
        while (cur.getCause() != null) cur = cur.getCause();
        String msg = cur.getMessage();
        return msg != null ? msg.substring(0, Math.min(80, msg.length())) : cur.getClass().getSimpleName();
    }
}
