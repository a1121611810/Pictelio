package io.pictelio.app.directaccess;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import java.net.InetAddress;
import java.net.Socket;

import static org.junit.Assert.assertTrue;

/**
 * 分片代理原型验证——问题：「ClientHello 第 1 字节独立 TCP segment 能否让 GFW DPI 失效？」
 *
 * 在 JVM 环境无法模拟 GFW 的 RST 行为（需要真实 GFW 在路径上）。
 * 此测试只验证代理的机械正确性：分片后 TLS 握手仍能完成（功能不破坏）。
 * GFW 对抗效果需在真机/模拟器上实测（RST 窗口内对比分片前后的通过率）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class TlsFragmentingProxyTest {

    @Test
    public void fragmentationProxy_tlsHandshakeCompletesThroughProxy() throws Exception {
        String upstreamHost = "www.google.com";
        int upstreamPort = 443;

        TlsFragmentingProxy proxy = new TlsFragmentingProxy(0, upstreamHost, upstreamPort, 1);
        int proxyPort = proxy.start();
        try {
            SSLSocketFactory factory = SSLContext.getDefault().getSocketFactory();
            Socket raw = new Socket(InetAddress.getByName("127.0.0.1"), proxyPort);
            SSLSocket tls = (SSLSocket) factory.createSocket(
                    raw, upstreamHost, upstreamPort, true);
            tls.startHandshake();
            assertTrue("TLS 握手应通过分片代理完成", tls.getSession().isValid());
            tls.close();
            raw.close();
        } finally {
            proxy.stop();
        }
    }

    @Test
    public void fragmentationProxy_fragmentOffsetIsConfigurable() throws Exception {
        String upstreamHost = "www.google.com";
        int upstreamPort = 443;
        for (int offset : new int[]{0, 1, 5}) {
            TlsFragmentingProxy proxy = new TlsFragmentingProxy(0, upstreamHost, upstreamPort, offset);
            int proxyPort = proxy.start();
            try {
                SSLSocketFactory factory = SSLContext.getDefault().getSocketFactory();
                Socket raw = new Socket(InetAddress.getByName("127.0.0.1"), proxyPort);
                SSLSocket tls = (SSLSocket) factory.createSocket(
                        raw, upstreamHost, upstreamPort, true);
                tls.startHandshake();
                assertTrue("offset=" + offset + " 握手应完成", tls.getSession().isValid());
                tls.close();
                raw.close();
            } finally {
                proxy.stop();
            }
        }
    }
}
