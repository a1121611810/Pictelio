package io.pictelio.app.directaccess;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 本地 TCP 分片代理（prototype/tcp-fragment-proxy）——
 * GFW 对 TCP 流重组后做 TLS 指纹识别。将 ClientHello 第 1 字节拆为
 * 独立 TCP segment 发送，破坏 DPI 的流重组 → 指纹读取失败 → 放行。
 *
 * 原理参考：GoodbyeDPI / Zapret（Linux/Windows 同类工具，已验证有效）。
 *
 * 流量路径：
 *   App (OkHttp/Conscrypt)
 *     → 127.0.0.1:listenPort（本代理）
 *     → 分片首包后透传
 *     → Pixiv 真实 IP:443
 *
 * 透传是字节级的：TLS 握手由 App 的 Conscrypt 与远端 Pixiv 完成，
 * 本代理只改 TCP 分片时序，不改任何 TLS 内容。
 */
public final class TlsFragmentingProxy {

    private final int listenPort;
    private final String upstreamHost;
    private final int upstreamPort;
    private final AtomicBoolean running = new AtomicBoolean(false);
    private ServerSocket serverSocket;
    private ExecutorService executor;

    /** 分片偏移量：第 1 字节单独发，剩余跟随。可调参用于实验。 */
    private final int fragmentOffset;

    public TlsFragmentingProxy(int listenPort, String upstreamHost, int upstreamPort, int fragmentOffset) {
        this.listenPort = listenPort;
        this.upstreamHost = upstreamHost;
        this.upstreamPort = upstreamPort;
        this.fragmentOffset = fragmentOffset;
    }

    /**
     * 启动代理（非阻塞）。调用 {@link #stop()} 停止。
     * @return 实际监听端口（可能与请求端口不同，如果端口被占用则系统分配）
     */
    public int start() throws IOException {
        serverSocket = new ServerSocket(listenPort);
        int actualPort = serverSocket.getLocalPort();
        running.set(true);
        executor = Executors.newCachedThreadPool(r -> {
            Thread t = new Thread(r, "tls-frag-proxy");
            t.setDaemon(true);
            return t;
        });
        executor.execute(this::acceptLoop);
        return actualPort;
    }

    public void stop() {
        running.set(false);
        if (serverSocket != null && !serverSocket.isClosed()) {
            try { serverSocket.close(); } catch (IOException ignored) {}
        }
        if (executor != null) executor.shutdownNow();
    }

    private void acceptLoop() {
        while (running.get()) {
            try {
                Socket client = serverSocket.accept();
                executor.execute(() -> handle(client));
            } catch (IOException e) {
                if (running.get()) e.printStackTrace();
                return; // listener closed
            }
        }
    }

    private void handle(Socket client) {
        Socket upstream = null;
        try {
            upstream = new Socket(InetAddress.getByName(upstreamHost), upstreamPort);
            client.setSoTimeout(30_000);
            upstream.setSoTimeout(30_000);
            client.setTcpNoDelay(true);
            upstream.setTcpNoDelay(true);

            InputStream clientIn = client.getInputStream();
            OutputStream clientOut = client.getOutputStream();
            OutputStream upstreamOut = upstream.getOutputStream();
            InputStream upstreamIn = upstream.getInputStream();

            // ── 分片阶段：读取 ClientHello 前缀，分片转发 ──
            // 读 fragmentOffset 字节（通常 = 1），单独发送后 flush
            byte[] firstChunk = new byte[fragmentOffset];
            int read = 0;
            while (read < fragmentOffset) {
                int n = clientIn.read(firstChunk, read, fragmentOffset - read);
                if (n < 0) { // client closed early
                    client.close();
                    upstream.close();
                    return;
                }
                read += n;
            }
            upstreamOut.write(firstChunk, 0, read);
            upstreamOut.flush(); // ← 关键：flush 确保第 1 字节独立成 TCP segment

            // ── 透传阶段：双向字节泵（剩余 ClientHello + 全部后续数据） ──
            Thread downstream = new Thread(() -> {
                try {
                    pump(upstreamIn, clientOut);
                } catch (IOException ignored) {}
                try { client.close(); } catch (IOException ignored) {}
            });
            downstream.setDaemon(true);
            downstream.start();
            pump(clientIn, upstreamOut);
            downstream.join(30_000);
        } catch (Exception e) {
            // 连接异常（GFW RST / 超时等）：静默关闭两端
        } finally {
            try { client.close(); } catch (IOException ignored) {}
            if (upstream != null) {
                try { upstream.close(); } catch (IOException ignored) {}
            }
        }
    }

    private void pump(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
            out.flush();
        }
    }
}
