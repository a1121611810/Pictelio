package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.After;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.UnknownHostException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.TimeUnit;

import javax.net.ssl.ExtendedSSLSession;
import javax.net.ssl.HandshakeCompletedEvent;
import javax.net.ssl.HandshakeCompletedListener;
import javax.net.ssl.SNIServerName;
import javax.net.ssl.SSLSession;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;

import io.pictelio.app.directaccess.DirectAccessPolicy.SwitchState;
import okhttp3.Dns;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.mockwebserver.MockResponse;
import okhttp3.mockwebserver.MockWebServer;
import okhttp3.mockwebserver.RecordedRequest;
import okhttp3.mockwebserver.SocketPolicy;
import okhttp3.tls.HandshakeCertificates;
import okhttp3.tls.HeldCertificate;

/**
 * DirectAccessTransport 单测（#389）——OkHttp 接线三件套全链路 + 归因口径。
 *
 * <p><b>Oracle 溯源（spec #376 测试硬约束 #6）</b>——期望值全部来自独立来源：
 * <ul>
 *   <li>钉定 host/IP（i.pximg.net → 127.0.0.1）：测试自建钉定表（manual 层覆盖内置），
 *       期望值 = 测试自己写入 manual 的字面量；「请求到达 MockWebServer」本身即钉定命中的
 *       最强证据（URL host 是 i.pximg.net，系统解析不可能得到 127.0.0.1）——等价于
 *       RecordingDns 对照断言且更强（端到端建连事实）；</li>
 *   <li>Host 头 = 官方域名 + 端口：OkHttp 线缆格式（Host: host:port，非默认端口必带端口），
 *       由服务端 RecordedRequest 逐字节断言——URL/Host 恒不改写不变量的独立观测点；</li>
 *   <li>SNI 剥离期望（钉定连接 requestedServerNames 为空 / 系统路线携带 SNI）：
 *       JDK TLS 协议行为（客户端 ExtendedSSLSession.getRequestedServerNames = JDK 从
 *       createSocket host 参数派生的 ClientHello SNI 决策结果，与服务端 wire 观测同源）
 *       ——观测点在客户端会话，握手完成后同步可读（2026-09-07 由服务端异步监听器改造：
 *       CI 慢机上异步落账竞态曾致误报，观测语义不变）；</li>
 *   <li>熔断口径（3 连败 open / 冷却后半开单探 / 成功恢复清零 / 失败重开 / 421 计失败 /
 *       body 断流不计 / 其余 4xx 5xx 计传输成功）：spec #385 实施决策原文 +
 *       ChannelCircuitBreaker 契约 1-4 + ticket #389「421 无条件计边缘错配；连接/握手/
 *       响应头阶段失败计入；body 读取阶段失败不计；其余 4xx/5xx = 应用层失败不计」——
 *       内部计数器不可直接观测，用<b>阈值算术</b>（预置 N 次 recordFailure 后观察相位
 *       是否翻转）把差异外显（详见各用例注释）；</li>
 *   <li>白名单外零扰动（localhost host 恒系统路线）：Policy 白名单门
 *       （ImageHostConfig.isOfficialDomain）语义 + spec「镜像 URL / GitHub / OTA 天然走
 *       系统路线」；对照基准 = 未 install 的裸 client 同请求行为；</li>
 *   <li>冷却 60_000ms / 阈值 3：{@link ChannelCircuitBreaker} 公开常量（spec 拍板值的
 *       唯一事实源），拨钟推进量 = 常量 + 1ms（钉住「冷却到期即半开」边界语义）。</li>
 * </ul>
 *
 * <p><b>全链路钉定原理（密闭，零真实 DNS 依赖）</b>：manual 表把 {@code i.pximg.net} 钉到
 * {@code 127.0.0.1}，URL 写作 {@code http(s)://i.pximg.net:<mockPort>/}——Dns 返回钉定 IP
 * 后 OkHttp 直连本机 MockWebServer，服务端按 Host 头收到官方域名请求（无需 hosts 文件、
 * 无真实 DNS）；系统路线对照用 {@code localhost}/{@code 127.0.0.1}（宿主机自解析）。
 * 熔断计数类用例关闭 {@code retryOnConnectionFailure}（一次调用 = 恰好一次连接尝试，
 * 记账口径确定）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class DirectAccessTransportTest {

    private static final long T0 = 1_000_000_000L;
    private static final String PINNED_HOST = "i.pximg.net";
    /** 测试钉定 IP = 本机回环（manual 层字面量，非探针值——见类 javadoc oracle 说明） */
    private static final String LOOPBACK_IP = "127.0.0.1";

    // ── 测试 harness：拨钟 / fake 拉取器 / 可变 raw / 收集告警 ──

    private static final class MutableClock implements ChannelCircuitBreaker.Clock {
        long now = T0;

        @Override
        public long nowMillis() {
            return now;
        }
    }

    /** 恒成功空表拉取器：让 ensureFreshTable 的 TTL 单飞安静落地（Runnable::run 同步执行） */
    private static final class FakeFetcher implements IpTableFetcher {
        @Override
        public String fetchJson() {
            return "{\"version\":1,\"entries\":[]}";
        }
    }

    private static final class Harness {
        final StringBuilder raw = new StringBuilder();
        final MutableClock clock = new MutableClock();
        final List<String> warns = Collections.synchronizedList(new ArrayList<>());
        final DirectAccessConfig config;

        Harness() {
            config = new DirectAccessConfig(
                    () -> raw.length() == 0 ? null : raw.toString(),
                    clock, new FakeFetcher(), Runnable::run, warns::add, null);
        }

        /** 打开直连开关并把 i.pximg.net 钉到 127.0.0.1（manual 层逐条覆盖内置探针值） */
        void pinPinnedHostToLoopback() {
            raw.setLength(0);
            raw.append("{\"enabled\":true,\"manual\":[{\"host\":\"")
                    .append(PINNED_HOST).append("\",\"ip\":\"").append(LOOPBACK_IP).append("\"}]}");
        }
    }

    private final Harness h = new Harness();
    private MockWebServer server;

    @Before
    public void setUp() throws IOException {
        server = new MockWebServer();
        server.start();
    }

    @After
    public void tearDown() throws IOException {
        server.shutdown();
    }

    // ── client / 请求构造辅助 ────────────────────────────────

    /** 钉定全链路 client（生产 2-arg install 入口；默认重试——单钉定路由一次成功，无重试面） */
    private OkHttpClient pinnedClient() {
        OkHttpClient.Builder b = baseBuilder();
        DirectAccessTransport.install(b, h.config);
        return b.build();
    }

    /** 裸对照 client（未 install）：白名单外零扰动的逐字节对照基准 */
    private OkHttpClient bareClient() {
        return baseBuilder().build();
    }

    private static OkHttpClient.Builder baseBuilder() {
        return new OkHttpClient.Builder()
                .connectTimeout(2, TimeUnit.SECONDS)
                .readTimeout(5, TimeUnit.SECONDS)
                // 测试密闭：显式直连，绕开开发机注入 JVM 的 http(s).proxyHost 环境代理
                // （代理路径不咨询 Dns，钉定语义会被旁路；对 bare/installed 两侧同等生效，
                // 白名单外零扰动对照的公平性不受影响）
                .proxy(java.net.Proxy.NO_PROXY);
    }

    /**
     * 熔断计数专用 client（重试关闭）：一次调用 = 恰好一次连接尝试/一次授凭，记账口径确定
     * （默认 retryOnConnectionFailure 会把路由失败放大成多次内部重试 = 多次授凭）。
     */
    private OkHttpClient retryOffPinnedClient() {
        OkHttpClient.Builder b = baseBuilder().connectTimeout(1, TimeUnit.SECONDS);
        b.retryOnConnectionFailure(false);
        DirectAccessTransport.install(b, h.config);
        return b.build();
    }

    /** URL 宿主用官方域、端口指向本机 MockWebServer（钉定命中后直达本机） */
    private HttpUrl pinnedUrl(boolean tls, String path) {
        return HttpUrl.parse((tls ? "https://" : "http://") + PINNED_HOST + ":" + server.getPort() + path);
    }

    private HttpUrl localUrl(boolean tls, String path) {
        return HttpUrl.parse((tls ? "https://" : "http://") + "localhost:" + server.getPort() + path);
    }

    /** 预置 N 次连败（把不可见的内部计数器推到阈值边缘，供阈值算术断言） */
    private static void seedFailures(ChannelCircuitBreaker breaker, ChannelCircuitBreaker.Channel ch, int n) {
        for (int i = 0; i < n; i++) {
            breaker.recordFailure(ch);
        }
    }

    /** 容错 DNS 对照（系统解析结果环境相关——可能成功也可能 UHE；两侧一致即证明委托） */
    private static Object lookupTolerant(Dns dns, String host) {
        try {
            return dns.lookup(host);
        } catch (UnknownHostException e) {
            return "UHE:" + host; // 哨兵：两侧同抛视为同值（相等性来自同一系统解析源）
        }
    }

    // ── 三件套 1：钉定 Dns（纯单测） ─────────────────────────

    @Test
    public void dns_pinnedWhitelistedHost_returnsSinglePinnedIpLiteral() throws Exception {
        // oracle: manual 表字面量 + 「字面量地址零 DNS 依赖」JDK 契约。getHostName 断言不钉——
        // 未标签回环地址的 getHostName 由 JDK 内置字面量缓存返回（如 "localhost"），
        // 属 JDK 行为非被测契约；地址字节才是本层钉定语义。
        h.pinPinnedHostToLoopback();
        DirectAccessTransport.PinnedDns dns = new DirectAccessTransport.PinnedDns(
                () -> SwitchState.ON, h.config::currentTable, h.config.breaker(), h.warns::add);
        List<InetAddress> result = dns.lookup(PINNED_HOST);
        assertEquals("钉定解析返回且仅返回单个地址", 1, result.size());
        assertEquals("地址 = 钉定 IP 字面量", LOOPBACK_IP, result.get(0).getHostAddress());
        assertTrue("地址字节 = 钉定 IP 字面量（IPv4 四字节）",
                Arrays.equals(new byte[]{127, 0, 0, 1}, result.get(0).getAddress()));
        assertTrue("纯 Dns 单测不允许告警", h.warns.isEmpty());
    }

    @Test
    public void dns_nonWhitelistedHost_delegatesToSystemDns() {
        // oracle: Policy 白名单门（localhost 不在 *.pixiv.net / *.pximg.net → SYSTEM）
        DirectAccessTransport.PinnedDns dns = new DirectAccessTransport.PinnedDns(
                () -> SwitchState.ON, h.config::currentTable, h.config.breaker(), h.warns::add);
        assertEquals("非白名单 host 逐字节委托系统 Dns（结果或 UHE 同源一致）",
                lookupTolerant(Dns.SYSTEM, "localhost"), lookupTolerant(dns, "localhost"));
    }

    @Test
    public void dns_switchOff_delegatesEvenForWhitelistedHost() {
        // oracle: spec「独立开关（默认关）」——OFF 时白名单内 host 也必须走系统路线
        h.raw.append("{\"enabled\":false}");
        DirectAccessTransport.PinnedDns dns = new DirectAccessTransport.PinnedDns(
                () -> h.config.switchState(), h.config::currentTable, h.config.breaker(), h.warns::add);
        assertEquals(lookupTolerant(Dns.SYSTEM, PINNED_HOST), lookupTolerant(dns, PINNED_HOST));
    }

    @Test
    public void dns_breakerOpen_imageChannel_delegatesToSystem() {
        // oracle: spec「连续 3 次传输失败 → 该通道本会话切系统路线」；字面量 3 = 熔断阈值常量
        h.pinPinnedHostToLoopback();
        ChannelCircuitBreaker breaker = h.config.breaker();
        seedFailures(breaker, ChannelCircuitBreaker.Channel.IMAGE, 3);
        DirectAccessTransport.PinnedDns dns = new DirectAccessTransport.PinnedDns(
                () -> SwitchState.ON, h.config::currentTable, breaker, h.warns::add);
        assertEquals("熔断 open 后白名单 host 委托系统 Dns（Dns 委托即系统路线）",
                lookupTolerant(Dns.SYSTEM, PINNED_HOST), lookupTolerant(dns, PINNED_HOST));
    }

    @Test
    public void dns_pinnedIpLiteralMalformed_defensiveFallback_recordsFailureOnceAndDelegates() {
        // oracle: 防御兜底契约（DirectAccessTransport javadoc「钉定 IP 字面量构造地址失败 →
        // recordFailure 回收凭据 + warn + 系统路线」）。表内 IP 本应被 Merger 拦截——此处绕过
        // Merger 手工构造非法快照（Snapshot 包可见构造器），直达防御分支验证「凭据不灭失 +
        // 禁静默 + 恰好一次」。
        IpTableMerger.Snapshot badTable = new IpTableMerger.Snapshot(
                Collections.singletonList(new IpTableMerger.Entry(PINNED_HOST, "999.999.999.999")));
        ChannelCircuitBreaker breaker = new ChannelCircuitBreaker(new MutableClock());
        DirectAccessTransport.PinnedDns dns = new DirectAccessTransport.PinnedDns(
                () -> SwitchState.ON, () -> badTable, breaker, h.warns::add);
        assertEquals("防御兜底回退系统路线", lookupTolerant(Dns.SYSTEM, PINNED_HOST),
                lookupTolerant(dns, PINNED_HOST));
        assertFalse("降级必须可见（禁静默）", h.warns.isEmpty());
        // 阈值算术（oracle = 熔断阈值 3）：恰好记 1 次失败 → 再补 2 次达 3 熔断；
        // 若防御分支漏记账（0 次）→ 2 次不得熔断；若多记（≥2 次）→ 提前熔断
        seedFailures(breaker, ChannelCircuitBreaker.Channel.IMAGE, 2);
        assertEquals("防御兜底恰好记一次失败（1+2=3 触发 open）",
                ChannelCircuitBreaker.Phase.OPEN, breaker.phase(ChannelCircuitBreaker.Channel.IMAGE));
    }

    // ── EventListener 归因口径（纯单测，grant 经 PinnedDns 真实挂载） ──

    @Test
    public void eventListener_grantScopedAttribution_systemRouteZeroAndBodyStageGuarded()
            throws Exception {
        // oracle: ticket #389 记账口径——「失败归因只对直连尝试；系统路线失败零记账；
        // body 读取阶段失败不计入」。grant 用 PinnedDns 真实挂载（不走 mock——归因判定
        // 消费的就是 Dns 挂的同一个 ThreadLocal 请求作用域对象）。
        h.pinPinnedHostToLoopback();
        ChannelCircuitBreaker breaker = h.config.breaker();
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        DirectAccessTransport.PinnedDns dns = new DirectAccessTransport.PinnedDns(
                () -> SwitchState.ON, h.config::currentTable, breaker, h.warns::add);
        DirectAccessTransport.AttributionEventListener listener =
                new DirectAccessTransport.AttributionEventListener(breaker);
        InetSocketAddress pinnedAddr = new InetSocketAddress(InetAddress.getByName(LOOPBACK_IP), 443);
        // 非钉定 IP 字面量（任意公网样例，仅作 ∈/∉ 对照，不发起连接）
        InetSocketAddress foreignAddr = new InetSocketAddress(InetAddress.getByName("93.184.216.34"), 443);

        // (a) 系统路线（无 grant）：connectFailed / callFailed 全部零记账
        dns.lookup("localhost"); // SYSTEM → grant 置 null
        listener.connectFailed(null, pinnedAddr, Proxy.NO_PROXY, null, new IOException("sys"));
        listener.callFailed(null, new IOException("sys"));
        seedFailures(breaker, image, 2);
        assertEquals("系统路线失败零记账（2 保持 closed；误记则 3 open）",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));

        // (b) 钉定 grant + connectFailed(对端 IP 匹配) → 恰好 1 次失败（CAS 去重双保险）
        dns.lookup(PINNED_HOST); // 新 grant（i.pximg.net → 127.0.0.1）
        listener.connectFailed(null, pinnedAddr, Proxy.NO_PROXY, null, new IOException("tls"));
        listener.connectFailed(null, pinnedAddr, Proxy.NO_PROXY, null, new IOException("again"));
        assertEquals("两次 connectFailed 只记一次（2+1=3 open）",
                ChannelCircuitBreaker.Phase.OPEN, breaker.phase(image));

        // (c) body 阶段守卫：grant → 响应头到达 → callFailed 不得记账
        breaker.reset(image);
        dns.lookup(PINNED_HOST); // 新 grant
        listener.connectFailed(null, foreignAddr, Proxy.NO_PROXY, null, new IOException("nope")); // IP 不匹配零记账
        listener.responseHeadersStart(null); // headersArrived = true
        listener.callFailed(null, new IOException("mid-body")); // body 阶段失败不计入
        seedFailures(breaker, image, 2);
        assertEquals("对端不匹配零记账 + body 阶段失败被 headersArrived 守卫拦截"
                        + "（2 保持 closed；任一失守则 3 open）",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));
    }

    // ── 全链路：钉定命中 + Host 头 + 证书校验（ticket 验收 1） ─

    @Test
    public void fullLink_pinnedHttpsRequest_reachesMockWithOfficialHostHeader_andCertValidated()
            throws Exception {
        // oracle: ticket #389 验收「钉 IP 命中 / Host 头为官方域名 / 证书校验通过路径」。
        // 证书 SAN 含 i.pximg.net（okhttp-tls HeldCertificate，测试自建 CA）——PKIX 证书链
        // 校验 + OkHttp 主机名校验（按真实 URL 域名）照常执行，仅信任根为测试 CA；
        // SNI 剥离不得破坏证书校验路径。
        HeldCertificate cert = testCertificate();
        enableTls(cert);
        h.pinPinnedHostToLoopback();
        server.enqueue(new MockResponse().setBody("pictelio-direct-ok"));

        OkHttpClient client = pinnedTlsClient(cert);
        Request request = new Request.Builder().url(pinnedUrl(true, "/v1/pictelio-test?x=1")).build();
        try (Response response = client.newCall(request).execute()) {
            assertEquals("钉定连接全链路 200（Dns 钉定命中 + TLS 默认校验通过）", 200, response.code());
            assertEquals("响应体原样透传", "pictelio-direct-ok", response.body().string());
        }
        RecordedRequest recorded = server.takeRequest(5, TimeUnit.SECONDS);
        assertNotNull(recorded);
        assertEquals("路径与查询串恒不改写", "/v1/pictelio-test?x=1", recorded.getPath());
        assertEquals("Host 头为官方域名 + 端口（h2 记 :authority 伪头，h1 记 Host，域:端口恒不改写）",
                PINNED_HOST + ":" + server.getPort(), recordedAuthority(recorded));
        assertTrue("钉定全链路不允许告警", h.warns.isEmpty());
    }

    /** 请求宿主观测（协议无关）：h1 = Host 头，h2 = :authority 伪头 */
    private static String recordedAuthority(RecordedRequest recorded) {
        String host = recorded.getHeader("Host");
        return host != null ? host : recorded.getHeader(":authority");
    }

    // ── 全链路：SNI 剥离决策（ticket 验收 1，客户端同步观测） ──

    /**
     * 建立一条真实 TLS 连接（对端 = 本机 MockWebServer 的 TLS 端点）并完成握手，
     * 返回<b>客户端会话</b>观测到的 requestedServerNames（即 JDK 从对端 host 参数派生的
     * ClientHello SNI——服务端 wire 观测的同一决策源，但同步可读零竞态）。
     * pinned=true 时先经 PinnedDns 挂载 grant（与线缆路径同源的钉定语义）。
     *
     * <p>历史注记（2026-09-07）：原实现用服务端 HandshakeCompletedListener 异步捕获 +
     * 5s 轮询等待，CI 2 核慢机上钉定握手的监听器落账竞态曾致 IndexOutOfBoundsException；
     * 本观测点改为客户端同步读取后消除竞态（观测语义不变：同为 ExtendedSSLSession
     * 的 requestedServerNames，JDK 以 createSocket 的 host 参数为派生源）。
     */
    private List<String> handshakeAndObserve(SSLSocketFactory wrapped, DirectAccessTransport.PinnedDns dns,
                                             boolean pinned) throws Exception {
        if (pinned) {
            dns.lookup(PINNED_HOST); // grant 挂载到当前线程（ThreadLocal，与线缆路径同源）
        } else {
            dns.lookup("localhost"); // 非白名单 → SYSTEM → grant 置 null（与线缆路径同源）
        }
        try (Socket raw = new Socket()) {
            raw.connect(new InetSocketAddress(InetAddress.getByAddress(new byte[]{127, 0, 0, 1}),
                    server.getPort()), 2000);
            SSLSocket tls = (SSLSocket) wrapped.createSocket(raw, PINNED_HOST, server.getPort(), true);
            try {
                tls.startHandshake();
                SSLSession session = tls.getSession(); // 握手已完成，同步可读
                if (!(session instanceof ExtendedSSLSession)) {
                    throw new AssertionError(
                            "客户端会话不可观测（非 ExtendedSSLSession）: " + session.getClass());
                }
                List<String> names = new ArrayList<>();
                for (SNIServerName name : ((ExtendedSSLSession) session).getRequestedServerNames()) {
                    names.add(new String(name.getEncoded(), StandardCharsets.UTF_8));
                }
                return names;
            } finally {
                tls.close();
            }
        }
    }

    @Test
    public void fullLink_sni_strippedForPinnedConnection_sentForNonPinned() throws Exception {
        // oracle: ticket #389「钉定连接剥 SNI；非钉定连接 SNI 照常」+ JDK TLS 行为
        // （客户端 ExtendedSSLSession.getRequestedServerNames = JDK 从 createSocket host
        // 参数派生的 ClientHello SNI 决策结果；钉定 grant 经 PinnedDns 真实挂载，与线缆
        // 路径同源）。服务端单证书双 SAN——不按 SNI 选证书，剥离与否不影响握手成败。
        HeldCertificate cert = testCertificate();
        server.useHttps(serverCerts(cert).sslSocketFactory(), false);
        h.pinPinnedHostToLoopback();
        DirectAccessTransport.PinnedDns dns = new DirectAccessTransport.PinnedDns(
                () -> SwitchState.ON, h.config::currentTable, h.config.breaker(), h.warns::add);
        SSLSocketFactory wrapped = new DirectAccessTransport.SniStrippingSSLSocketFactory(
                clientCerts(cert).sslSocketFactory(), h.warns::add);

        // ① 非钉定连接（无 grant）：真实握手 → ClientHello 携带 SNI（JDK 默认行为，零扰动）
        List<String> sent = handshakeAndObserve(wrapped, dns, false);
        assertEquals("非钉定连接 ClientHello 携带 SNI（JDK 默认形态，零扰动对照）",
                Collections.singletonList(PINNED_HOST), sent);
        // ② 钉定连接（grant 在场）：ClientHello 不携带 SNI（剥离生效）
        List<String> stripped = handshakeAndObserve(wrapped, dns, true);
        assertEquals("钉定连接 ClientHello 不携带 SNI（剥离生效）",
                Collections.emptyList(), stripped);
    }

    // ── 全链路：熔断闭环（ticket 验收 2） ────────────────────

    @Test
    public void fullLink_circuit_threeConnectFailuresOpen_cooldownHalfOpenProbe_recoverThenRetrip()
            throws Exception {
        // oracle: spec 状态机 CLOSED --3 连败--> OPEN --60s--> 半开单探 --成功--> CLOSED（清零）
        // / --失败--> OPEN。字面量 3 / 60_000 = ChannelCircuitBreaker 公开常量（spec 拍板值）。
        ChannelCircuitBreaker breaker = h.config.breaker();
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        h.pinPinnedHostToLoopback();
        OkHttpClient client = retryOffPinnedClient();

        // ① 3 次连接失败（封闭端口 ECONNREFUSED，本机密闭）→ IMAGE open（归因点：connectFailed）
        int closedPort = closedLocalPort();
        for (int i = 0; i < ChannelCircuitBreaker.FAILURE_THRESHOLD; i++) {
            try {
                client.newCall(new Request.Builder()
                        .url(HttpUrl.parse("http://" + PINNED_HOST + ":" + closedPort + "/dead")).build())
                        .execute();
                fail("钉定封闭端口必须连接失败");
            } catch (IOException expected) {
                // 连接失败（传输层口径）
            }
        }
        assertEquals("3 连败熔断", ChannelCircuitBreaker.Phase.OPEN, breaker.phase(image));

        // ② 冷却到期 + 钉定端口切到存活 mock → 半开单探成功 → 恢复 closed（Breaker 契约）
        server.enqueue(new MockResponse().setBody("probe-recovered"));
        h.clock.now += ChannelCircuitBreaker.COOLDOWN_MILLIS + 1;
        try (Response r = client.newCall(new Request.Builder()
                .url(pinnedUrl(false, "/probe")).build()).execute()) {
            assertEquals("半开探针直连存活边缘成功", 200, r.code());
            assertEquals("probe-recovered", r.body().string());
        }
        assertEquals("探针成功恢复 closed", ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));

        // ③ 恢复后新连接失败恰好记一次（归因点：拦截器 catch，响应头前失败）——
        // 先清池（探针成功会入池；池命中不触发 Dns/grant，会污染记账口径）
        client.connectionPool().evictAll();
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START));
        try {
            client.newCall(new Request.Builder().url(pinnedUrl(false, "/trip")).build()).execute();
            fail("DISCONNECT_AT_START 必须 IO 失败");
        } catch (IOException expected) {
            // 归因点：拦截器 catch
        }
        assertEquals("单次失败不熔断", ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));
        // 阈值算术：若响应头前失败已记 1 次 → 补 2 次达 3 熔断；若漏记 → 2 次不熔断（可区分）
        seedFailures(breaker, image, 2);
        assertEquals("响应头前失败恰好记一次（1+2=3 open）",
                ChannelCircuitBreaker.Phase.OPEN, breaker.phase(image));

        // ④ 冷却到期 + 探针失败（mock 断流）→ 半开重开并重启冷却
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START));
        h.clock.now += ChannelCircuitBreaker.COOLDOWN_MILLIS + 1;
        try {
            client.newCall(new Request.Builder().url(pinnedUrl(false, "/retrip")).build()).execute();
            fail("半开探针失败必须 IO 失败");
        } catch (IOException expected) {
            // 半开探针失败（归因点：拦截器 catch）
        }
        assertEquals("探针失败重开", ChannelCircuitBreaker.Phase.OPEN, breaker.phase(image));

        // ⑤ open 持续期间请求 → Dns 委托系统路线（机制单测见 dns_breakerOpen_*）——
        // 系统路线结果环境相关（真实解析或 UHE），只断言失败后零记账、相位保持
        h.clock.now += 1000; // 远小于冷却：单探资格未授予
        int closedPort2 = closedLocalPort();
        try {
            client.newCall(new Request.Builder()
                    .url(HttpUrl.parse("http://" + PINNED_HOST + ":" + closedPort2 + "/still-open")).build())
                    .execute();
            fail("系统路线连封闭端口必须失败（或 DNS 失败同义）");
        } catch (IOException expected) {
            // 系统路线失败：零记账（grant 不在场）
        }
        assertEquals("OPEN 态持续（冷却未到不半开）", ChannelCircuitBreaker.Phase.OPEN, breaker.phase(image));
    }

    /** 分配后立即释放的本机端口（连接 → ECONNREFUSED，密闭无网络依赖） */
    private static int closedLocalPort() throws IOException {
        try (ServerSocket socket = new ServerSocket(0)) {
            return socket.getLocalPort();
        }
    }

    // ── 全链路：421 计失败 + 响应原样返回（ticket 验收 4） ───

    @Test
    public void fullLink_421_recordedAsFailureExactlyOnce_responseReturnedAsIs() throws Exception {
        // oracle: ticket #389「421 无条件计为边缘错配」+「421 响应仍照常返回调用方」。
        // 阈值算术：预置 2 次失败——若 421 恰好记 1 次失败 → 3 熔断；若成功与失败都记账
        // （响应头先记 success 清零再记 failure → 净 1）→ 不熔断——断言可区分（恰好一次）。
        ChannelCircuitBreaker breaker = h.config.breaker();
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        h.pinPinnedHostToLoopback();
        OkHttpClient client = retryOffPinnedClient();
        seedFailures(breaker, image, 2);
        server.enqueue(new MockResponse().setResponseCode(421).setBody("misdirected"));

        try (Response response = client.newCall(new Request.Builder()
                .url(pinnedUrl(false, "/api")).build()).execute()) {
            assertEquals("421 响应原样返回（熔断内部消化，不引入新异常）", 421, response.code());
            assertEquals("misdirected", response.body().string());
        }
        assertEquals("421 恰好记一次失败（2+1=3 open）",
                ChannelCircuitBreaker.Phase.OPEN, breaker.phase(image));
    }

    // ── 全链路：body 阶段失败不计入（ticket 验收 4） ─────────

    @Test
    public void fullLink_bodyStageDisconnect_notCounted_successStillAccounted() throws Exception {
        // oracle: ticket #389「body 读取阶段失败不计入（大 zip 流式中途断流不误熔断）」。
        // 阈值算术：预置 2 次失败——响应头到达记 success（清零）→ body 断流不计 →
        // 补 1 次失败 = 1 → closed；若 success 未记 → 2+1=3 open（可区分）。
        ChannelCircuitBreaker breaker = h.config.breaker();
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        h.pinPinnedHostToLoopback();
        OkHttpClient client = retryOffPinnedClient();
        seedFailures(breaker, image, 2);

        byte[] bigBody = new byte[512 * 1024];
        Arrays.fill(bigBody, (byte) 'x');
        server.enqueue(new MockResponse()
                .setBody(new okio.Buffer().write(bigBody))
                .throttleBody(64 * 1024, 20, TimeUnit.MILLISECONDS)
                .setSocketPolicy(SocketPolicy.DISCONNECT_DURING_RESPONSE_BODY));

        Request request = new Request.Builder().url(pinnedUrl(false, "/big-zip")).build();
        try (Response response = client.newCall(request).execute()) {
            assertEquals("响应头正常到达（execute 不抛）", 200, response.code());
            try {
                response.body().source().readByteArray(); // 流式读满 → 中途断流
                fail("服务端中途断流必须 IO 失败");
            } catch (IOException expected) {
                // body 阶段失败：不计传输层口径（禁误熔断）
            }
        }
        seedFailures(breaker, image, 1);
        assertEquals("响应头到达已记 success 清零 + body 断流未记账（1 → closed；"
                        + "success 漏记则 3 → open）",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));
    }

    // ── 全链路：4xx/5xx（非 421）计传输成功不引进失败（ticket 验收 4） ──

    @Test
    public void fullLink_4xx5xx_countedAsTransportSuccess_notFailure() throws Exception {
        // oracle: ticket #389「其余 4xx/5xx = 应用层失败不计（传输口径）」+「响应头到达 =
        // recordSuccess（Breaker 契约 4 成功清零）」。阈值算术：预置 2 次失败 → 500/404 →
        // success 清零 → 补 2 次失败 = 2 → closed；若任一响应被误记 failure → ≥3 → open。
        ChannelCircuitBreaker breaker = h.config.breaker();
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        h.pinPinnedHostToLoopback();
        OkHttpClient client = retryOffPinnedClient();
        seedFailures(breaker, image, 2);
        server.enqueue(new MockResponse().setResponseCode(500).setBody("boom"));
        server.enqueue(new MockResponse().setResponseCode(404).setBody("gone"));

        try (Response response = client.newCall(new Request.Builder()
                .url(pinnedUrl(false, "/err500")).build()).execute()) {
            assertEquals("500 原样返回", 500, response.code());
        }
        try (Response response = client.newCall(new Request.Builder()
                .url(pinnedUrl(false, "/err404")).build()).execute()) {
            assertEquals("404 原样返回", 404, response.code());
        }
        seedFailures(breaker, image, 2);
        assertEquals("应用层失败不影响传输口径（success 清零后 2 次不熔断）",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));
    }

    // ── 全链路：连接失败恰好记一次（Breaker 契约 1） ─────────

    @Test
    public void fullLink_connectFailure_accountedExactlyOnce() throws Exception {
        // oracle: Breaker 契约 1「PINNED 调用方必须 recordSuccess/recordFailure 恰好一次」。
        // 阈值算术：1 次连接失败 + 补 1 次 = 2 → closed；若 connectFailed 与 callFailed
        // 双记（2）+1 = 3 → open——断言区分单记/双记。
        ChannelCircuitBreaker breaker = h.config.breaker();
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        h.pinPinnedHostToLoopback();
        OkHttpClient client = retryOffPinnedClient();
        int closedPort = closedLocalPort();
        try {
            client.newCall(new Request.Builder()
                    .url(HttpUrl.parse("http://" + PINNED_HOST + ":" + closedPort + "/dead")).build())
                    .execute();
            fail("钉定封闭端口必须连接失败");
        } catch (IOException expected) {
            // 归因点：connectFailed
        }
        seedFailures(breaker, image, 1);
        assertEquals("连接失败恰好记一次（1+1=2 closed；双记则 3 open）",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));
    }

    // ── 全链路：池命中零记账（无授凭无义务） ─────────────────

    @Test
    public void fullLink_poolReuse_noGrantConsumed_zeroAccounting() throws Exception {
        // oracle: Breaker 契约 1 的镜像（无 allowDirect 授凭 = 无记账义务）——连接池命中
        // 不触发 Dns/policy（OkHttp 按地址复用），grant 恒 null，421 也不得记账。
        // 阈值算术：预置 2 → 首连 success 清零 → 池命中 421（应零记账）→ 补 2 次 = 2 →
        // closed；若池命中 421 被误记 → 1+2 = 3 → open。
        ChannelCircuitBreaker breaker = h.config.breaker();
        ChannelCircuitBreaker.Channel image = ChannelCircuitBreaker.Channel.IMAGE;
        h.pinPinnedHostToLoopback();
        OkHttpClient client = retryOffPinnedClient();
        seedFailures(breaker, image, 2);
        server.enqueue(new MockResponse().setBody("fresh")); // ① 新建钉定连接（success 清零）
        server.enqueue(new MockResponse().setResponseCode(421)); // ② 池命中（应零记账）

        String url = pinnedUrl(false, "/pool").toString();
        try (Response r = client.newCall(new Request.Builder().url(url).build()).execute()) {
            assertEquals(200, r.code());
        }
        try (Response r = client.newCall(new Request.Builder().url(url).build()).execute()) {
            assertEquals("同路由立即复用 = 连接池命中", 421, r.code());
        }
        seedFailures(breaker, image, 2);
        assertEquals("池命中请求零记账（2 → closed；误记则 3 → open）",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(image));
    }

    // ── 全链路：白名单外零扰动 + 系统路线失败零记账（ticket 验收 3） ──

    @Test
    public void fullLink_nonWhitelistedHost_cableIdenticalToBareClient_zeroAccounting() throws Exception {
        // oracle: ticket #389 验收「白名单外 host（镜像 URL、GitHub）经 install 后行为与
        // 未 install 逐字节一致」+「系统路线失败零记账」。对照基准 = 裸 client（未 install）。
        h.pinPinnedHostToLoopback(); // 开关 ON——白名单外 host 必须仍走系统路线
        ChannelCircuitBreaker breaker = h.config.breaker();

        server.enqueue(new MockResponse().setBody("plain-ok"));
        server.enqueue(new MockResponse().setBody("plain-ok"));

        OkHttpClient bare = bareClient();
        OkHttpClient installed = pinnedClient();
        Request bareReq = new Request.Builder().url(localUrl(false, "/plain?x=1")).build();
        Request instReq = new Request.Builder().url(localUrl(false, "/plain?x=1")).build();

        try (Response r1 = bare.newCall(bareReq).execute();
             Response r2 = installed.newCall(instReq).execute()) {
            assertEquals("裸 client 基线", 200, r1.code());
            assertEquals("install 后非白名单 host 行为一致", 200, r2.code());
            assertEquals("响应体逐字节一致", r1.body().string(), r2.body().string());
        }
        assertNotNull(server.takeRequest(5, TimeUnit.SECONDS));
        RecordedRequest recorded = server.takeRequest(5, TimeUnit.SECONDS);
        assertEquals("路径不改写", "/plain?x=1", recorded.getPath());
        assertEquals("Host 头不改写", "localhost:" + server.getPort(), recorded.getHeader("Host"));

        // 系统路线失败零记账：断流失败后双通道必须仍 closed（阈值算术区分误记）。
        // 用重试关闭的确定性 client（DISCONNECT_AT_START + 默认重试的交互不确定，
        // 会把记账口径搅浑；重试策略不影响「grant 不在场则零记账」的被测契约）。
        server.enqueue(new MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START));
        seedFailures(breaker, ChannelCircuitBreaker.Channel.IMAGE, 2);
        seedFailures(breaker, ChannelCircuitBreaker.Channel.API_REFRESH, 2);
        OkHttpClient retryOff = retryOffPinnedClient();
        try {
            retryOff.newCall(new Request.Builder().url(localUrl(false, "/system-fail")).build()).execute();
            fail("系统路线断流必须 IO 失败");
        } catch (IOException expected) {
            // 归因点全集都要求 grant 在场——系统路线恒零记账
        }
        assertEquals("IMAGE 零记账（2 保持 closed；误记则 3 open）",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(ChannelCircuitBreaker.Channel.IMAGE));
        assertEquals("API_REFRESH 零记账",
                ChannelCircuitBreaker.Phase.CLOSED, breaker.phase(ChannelCircuitBreaker.Channel.API_REFRESH));
    }

    // ── install 幂等 + newBuilder 继承（ticket 验收 5） ──────

    @Test
    public void install_idempotent_andNewBuilderDerivedClientInherits() throws Exception {
        // oracle: ticket #389 验收「install 幂等；newBuilder 派生 client（镜像预算 client）
        // 自动继承机制且行为正确」。幂等观测点 = 应用拦截器列表（install 原子装配的唯一
        // 可枚举件）；行为继承观测点 = 派生 client 钉定全链路仍命中（Dns/SSF/监听器全套）。
        h.pinPinnedHostToLoopback();
        HeldCertificate cert = testCertificate();
        enableTls(cert); // TLS 下验证派生 client 的 Dns+SSF+监听器全套继承

        OkHttpClient.Builder builder = baseBuilder();
        builder.sslSocketFactory(clientCerts(cert).sslSocketFactory(), clientTrustManager(cert));
        DirectAccessTransport.install(builder, h.config);
        int afterFirst = builder.interceptors().size();
        DirectAccessTransport.install(builder, h.config);
        DirectAccessTransport.install(builder, h.config);
        assertEquals("重复 install 幂等（恰好一个标记拦截器）", afterFirst, builder.interceptors().size());
        assertEquals(1, builder.interceptors().size());

        OkHttpClient client = builder.build();
        OkHttpClient.Builder derivedBuilder = client.newBuilder();
        DirectAccessTransport.install(derivedBuilder, h.config); // 已继承 → 幂等短路
        assertEquals("派生 builder 不重复安装", 1, derivedBuilder.interceptors().size());

        server.enqueue(new MockResponse().setBody("derived"));
        OkHttpClient derived = derivedBuilder.build();
        try (Response response = derived.newCall(new Request.Builder()
                .url(pinnedUrl(true, "/derived")).build()).execute()) {
            assertEquals("派生 client 钉定全链路仍命中（Dns/SSF/拦截器/监听器全套继承）",
                    200, response.code());
            assertEquals("derived", response.body().string());
        }
        RecordedRequest recorded = server.takeRequest(5, TimeUnit.SECONDS);
        assertEquals("派生 client Host 头仍为官方域名（h2 记 :authority）",
                PINNED_HOST + ":" + server.getPort(), recordedAuthority(recorded));
    }

    // ── TLS 装配辅助 ─────────────────────────────────────────

    /**
     * 服务端/客户端共用测试证书（测试自建，okhttp-tls HeldCertificate）：SAN 同时覆盖
     * {@code i.pximg.net}（钉定请求）与 {@code localhost}（系统路线对照）——单证书双 SAN，
     * 服务端不按 SNI 选证书，SNI 剥离与否不影响握手成败，SNI 观测独立成立。
     */
    private static HeldCertificate testCertificate() {
        return new HeldCertificate.Builder()
                .addSubjectAlternativeName(PINNED_HOST)
                .addSubjectAlternativeName("localhost")
                .build();
    }

    private static HandshakeCertificates serverCerts(HeldCertificate cert) {
        return new HandshakeCertificates.Builder().heldCertificate(cert).build();
    }

    private void enableTls(HeldCertificate cert) {
        server.useHttps(serverCerts(cert).sslSocketFactory(), false);
    }

    /**
     * TLS 钉定 client：install <b>前</b>给 builder 预置「信任测试 CA」的 TLS 组件——
     * install 的契约是保留 builder 现有 TLS 形态（生产不预置 = 平台默认信任保留），
     * 证书链 PKIX 校验与 OkHttp 主机名校验照常执行，仅信任根换成测试 CA。
     */
    private OkHttpClient pinnedTlsClient(HeldCertificate cert) {
        OkHttpClient.Builder b = baseBuilder();
        b.sslSocketFactory(clientCerts(cert).sslSocketFactory(), clientTrustManager(cert));
        DirectAccessTransport.install(b, h.config);
        return b.build();
    }

    /** 客户端形态 TLS 组件（信任测试 CA——与只含服务端证书的 serverCerts 形态不同） */
    private static HandshakeCertificates clientCerts(HeldCertificate cert) {
        return new HandshakeCertificates.Builder()
                .addTrustedCertificate(cert.certificate())
                .build();
    }

    /** 信任测试 CA 的 TrustManager（客户端侧信任根，PKIX 链照常构建与校验） */
    private static javax.net.ssl.X509TrustManager clientTrustManager(HeldCertificate cert) {
        return new HandshakeCertificates.Builder()
                .addTrustedCertificate(cert.certificate())
                .build()
                .trustManager();
    }
}
