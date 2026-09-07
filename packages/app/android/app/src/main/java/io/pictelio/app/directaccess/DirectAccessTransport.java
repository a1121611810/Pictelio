package io.pictelio.app.directaccess;

import android.util.Log;

import java.io.IOException;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Proxy;
import java.net.Socket;
import java.net.UnknownHostException;
import java.util.Collections;
import java.util.List;
import java.util.function.Consumer;

import javax.net.ssl.SSLParameters;
import javax.net.ssl.SSLSocket;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.X509TrustManager;

import io.pictelio.app.directaccess.DirectAccessPolicy.Decision;
import io.pictelio.app.directaccess.DirectAccessPolicy.SwitchState;
import okhttp3.Call;
import okhttp3.EventListener;
import okhttp3.Interceptor;
import okhttp3.Dns;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Response;

/**
 * 直连传输层接线（spec #385 / ticket #389 T4）：把 {@link DirectAccessPolicy#decide} 的
 * 路线决策落到共享 OkHttp client 的线缆三件套上——本包<b>唯一知道 OkHttp 的类</b>。
 *
 * <p><b>三件套职责</b>（{@link #install} 一次性装配，四点原子安装）：
 * <ol>
 *   <li><b>自定义 Dns</b>（{@link PinnedDns}）：官方域且 IP 表有钉定值且熔断放行 →
 *       返回钉定 IP 字面量地址（纯字面量 {@code InetAddress.getByAddress(bytes)}，绝不触发
 *       DNS 解析/反向解析）；其余一切情况 → 委托 {@link Dns#SYSTEM}（系统路线逐字节现状）。
 *       PINNED 决策即消耗一枚熔断半开授凭（Policy 门序契约），返回钉定地址的同时把
 *       「请求作用域凭据」挂到 {@link #GRANT}（ThreadLocal）——OkHttp 用 Dns 结果建连，
 *       单次调用的整条执行链（拦截器 → 路由选择 → Dns → 建连 → TLS 握手 → 响应头 →
 *       拦截器返回）<b>在单线程内完成</b>（sync = 调用方线程，async = dispatcher 线程，
 *       OkHttp 4 不在调用中途换线程），ThreadLocal 是请求作用域传递的最小不坏解；</li>
 *   <li><b>自定义 SSLSocketFactory</b>（{@link SniStrippingSSLSocketFactory}）：包裹默认
 *       工厂（TrustManager 原样透传——证书链校验与主机名校验完全保留，无 SNI 直连下边缘
 *       按 Host 头路由并出示 *.pixiv.net 泛域名证书，OkHttp 按真实 URL 域名校验直接通过）。
 *       仅当 socket 的<b>已连接对端 IP == 本次 Dns 钉定 IP</b>（grant 比对）才剥 SNI——
 *       主机制 = 向底层工厂传钉定 IP <b>字面量</b>作为对端 host（JDK/Conscrypt 对字面量
 *       地址不派生 SNI，唯一可靠的按连接剥离手段，JDK 21 上空 serverNames 列表实测无效），
 *       副机制 = 空 {@code SSLParameters.serverNames}（尊重该语义的栈双保险）；判定用对端
 *       地址而非 host 参数，因为 Dns 返回的钉定 IP 与 SSF 看到的对端地址天然一致（OkHttp
 *       用 Dns 结果建连），而非钉定连接（系统路线/镜像/GitHub）grant 为 null 或 IP 不匹配
 *       → 零扰动；</li>
 *   <li><b>EventListener</b>（{@link AttributionEventListener}，经 Factory 每调用一实例）：
 *       只做传输层失败的兜底归因（见下「记账恰好一次」），钉定失败记账点同步经 warnSink
 *       输出一行告警（#395 禁静默可观测性）；连接成功本身不记账——
 *       传输层成功口径 = <b>响应头到达</b>（ {@code responseHeadersStart} 只标记边界，
 *       成功记账归拦截器，因为 EventListener 拿不到状态码）；</li>
 *   <li><b>应用拦截器</b>（{@link PinnedAccountingInterceptor}）：响应阶段记账的唯一归属——
 *       {@code code == 421 && 直连} → {@code recordFailure} + warn 一行（含 host/ip，
 *       #395 可观测性；421 = 边缘错配，探针实测 pximg 边缘对 API Host 恒 421，spec 421
 *       特化）；其余状态码 → {@code recordSuccess}
 *       （响应头到达 = 传输层成功；4xx/5xx 是应用层失败，不计传输层口径）。421 响应
 *       <b>原样返回调用方</b>（熔断内部消化，不引入新异常类型）；finally 清理 grant
 *       （请求作用域生命周期锚点，防 dispatcher 线程复用串味）。</li>
 * </ol>
 *
 * <p><b>记账恰好一次（Breaker 契约 1 的履行机制）</b>：每次 {@code Dns.lookup} 产出
 * PINNED 决策 = 消耗一枚授凭 = 生成一个新 {@link PinnedGrant}（含 {@code ip}、{@code channel}、
 * CAS 记账闩 {@code accounted}、body 阶段边界标记 {@code headersArrived}），挂 ThreadLocal。
 * 同一调用内的多次连接重试，每次重试前 OkHttp 都会重新做路由选择 → 重新触发
 * {@code lookup} → 生成<b>新 grant</b>（钉定路线只返回单个 IP，路由耗尽必然重查）——
 * 即「一枚凭据 ↔ 一次连接尝试 ↔ 恰好一次成败记账」。四个归因点全部经
 * {@link PinnedGrant#tryAccount} CAS 去重，多记任何一次都是 no-op：
 * <ol>
 *   <li>{@code connectFailed}（连接/握手失败，监听器先于异常传播触发，grant 在场）→ 失败；</li>
 *   <li>拦截器 {@code catch}（连接后、响应头前的失败——请求写入断流等；proceed 抛出即
 *       必然响应头未达，无 body 误计面）→ 失败；</li>
 *   <li>{@code callFailed} 兜底（防御前两者均未触发的罕见路径；{@code headersArrived}
 *       为真 = body 阶段失败，<b>不计入</b>——大 zip 流式中途断流不误熔断）→ 失败；</li>
 *   <li>拦截器 proceed 返回后（响应头已达）：421 → 失败；其余 → 成功。</li>
 * </ol>
 * 失败/421 记账点在 CAS 赢得记账权的同时经 warnSink 输出一行告警（host / 钉定 IP /
 * 通道 / 异常类名，#395 禁静默可观测性），与记账严格 1:1（同一 CAS 闸门去重，无重复噪音）；
 * body 阶段失败与系统路线失败零记账亦零告警。
 * 凭据不灭失论证：PINNED 决策后到记账前的每条路径（建连失败 / 握手失败 / 写请求失败 /
 * 响应头前断流 / 正常响应 / 421）恰好被上述四点之一覆盖并 CAS 成功一次。钉定 IP 字面量
 * 构造地址失败的防御兜底（理论不可达：{@link IpTableMerger} 已校验严格 IPv4）当场
 * {@code recordFailure} 回收凭据 + warn，不静默走失。
 *
 * <p><b>竞态面（ThreadLocal 方案的前提与边界）</b>：
 * <ul>
 *   <li><b>线程亲和不变量</b>：归因依赖「单次调用单线程执行」。该不变量由 OkHttp 4 的
 *       执行模型保证（同步调用在调用方线程，异步调用在取出任务的 dispatcher 线程，
 *       全链路不换线程）。若未来 OkHttp 改为中途换线程执行，此机制失效——失败形态是
 *       凭据丢失（熔断滞留半开直至手动重置），不会误熔断；</li>
 *   <li><b>串味防护</b>：grant 在 Dns.lookup 入口先清残留 + 拦截器 finally 必清。
 *       连接池命中路径不触发 Dns（零凭据消耗 → 零记账义务，与 Breaker 契约一致），
 *       此时 grant 恒 null，响应/失败零记账；</li>
 *   <li><b>多 client 共存</b>：共享 client 与 newBuilder 派生 client 共享同一 static
 *       ThreadLocal——线程同一时刻至多执行一个调用，grant 挂取在同一调用的生命周期内，
 *       无跨调用并发面。</li>
 * </ul>
 *
 * <p><b>不变量（测试钉住，违反视为契约破坏）</b>：
 * <ul>
 *   <li>白名单外 host（镜像 URL、GitHub、OTA）经 install 后行为与未 install 逐字节一致：
 *       Dns 委托系统解析、SSF 零判定（grant null）、拦截器透传、监听器零记账；</li>
 *   <li>URL 与 Host 头恒不改写（拦截器只读状态码，不触碰请求/响应）；无重派、无循环
 *       守卫（本类零 OkHttp client 构造——IP 表拉取器的专用不路由 client 归属
 *       {@link DirectAccessConfig}，装配面天然分离）；</li>
 *   <li>install 幂等；{@code newBuilder()} 派生 client（镜像预算 client）自动继承全部
 *       四点安装（OkHttp newBuilder 全量复制，拦截器标记随之复制 → 重复 install 直接短路）；</li>
 *   <li>失败归因只对直连尝试：系统路线失败（grant null 或对端 IP 非钉定值）零记账零告警
 *       （logcat 零日志，系统路线零扰动）。</li>
 * </ul>
 *
 * <p><b>线程安全</b>：三件套实例无共享可变态（grant 走 ThreadLocal；熔断器自身 CAS）。
 * install 只应在 client 构建期调用一次（幂等防御重复调用）。
 */
public final class DirectAccessTransport {

    private static final String TAG = "[DirectAccessTransport]";

    /**
     * 请求作用域钉定凭据（ThreadLocal）。
     *
     * <p>生命周期：{@link PinnedDns#lookup} 产出 PINNED 决策时 set（其余一切路径 set null）；
     * {@link PinnedAccountingInterceptor#intercept} finally 必清。入口先清 + 出口必清双保险，
     * dispatcher 线程复用与池命中路径均无残留串味面（竞态面论证见类 javadoc）。
     */
    private static final ThreadLocal<PinnedGrant> GRANT = new ThreadLocal<>();

    private DirectAccessTransport() {
        // 纯静态装配类，禁实例化
    }

    /**
     * 把直连三件套装进 client builder（生产入口；warn 走 {@link Log#w}）。
     * public：跨包调用方 = PixivApiCore.getClient（io.pictelio.app 主包，#390 接线）。
     *
     * <p><b>幂等防御</b>：以应用拦截器列表中的 {@link PinnedAccountingInterceptor} 标记
     * 判定已安装——install 是四点原子装配，查一即查全；{@code newBuilder()} 派生 builder
     * 复制拦截器列表，标记随之在场，对派生 builder 重复 install 直接短路（行为已继承）。
     *
     * @return 同一 builder（链式）；已安装时原样返回、零改动
     */
    public static OkHttpClient.Builder install(OkHttpClient.Builder builder, DirectAccessConfig config) {
        return install(builder, config, msg -> Log.w(TAG, msg));
    }

    /**
     * 带告警出口的装配（包可见：测试注入收集器断言禁静默纪律；生产经
     * {@link #install(OkHttpClient.Builder, DirectAccessConfig)} 固定接 Log.w）。
     */
    static OkHttpClient.Builder install(OkHttpClient.Builder builder, DirectAccessConfig config,
                                        Consumer<String> warnSink) {
        for (Interceptor i : builder.interceptors()) {
            if (i instanceof PinnedAccountingInterceptor) {
                return builder; // 已安装（含 newBuilder 派生继承），幂等短路
            }
        }
        if (config == null) {
            // 装配缺失（DirectAccessInitProvider 未跑，如 JVM 单测/极端时序）：builder 原样
            // 返回 = 纯系统路线零改动（spec #385 降级契约——T5 接线方 PixivApiCore 以
            // isInstantiated() 探测后可能仍传 null，此处是契约的最终守门）。
            return builder;
        }
        ChannelCircuitBreaker breaker = config.breaker();
        // 一次性探针 client：只为提取平台默认 TLS 组件（默认 SSLSocketFactory + 默认
        // TrustManager），证书链校验完全保留默认。probe 不做任何请求，用后即弃。
        OkHttpClient probe = builder.build();
        java.util.concurrent.ConcurrentHashMap<ChannelCircuitBreaker.Channel, String> lastGoodByChannel =
                new java.util.concurrent.ConcurrentHashMap<>();
        builder.dns(new PinnedDns(config, breaker, warnSink, lastGoodByChannel));
        SSLSocketFactory base = probe.sslSocketFactory();
        X509TrustManager trustManager = probe.x509TrustManager();
        if (base != null && trustManager != null) {
            builder.sslSocketFactory(new SniStrippingSSLSocketFactory(base, warnSink), trustManager);
        } else {
            // 平台默认 TLS 组件缺失（理论不可达）：降级为无 SNI 剥离装配，warn 可见。
            // 直连决策与记账不受影响；钉定 TLS 连接将因带 SNI 被边缘错配（421 → 记账回退），
            // 不会比现状更坏。
            warnSink.accept(TAG + " 平台默认 TLS 组件缺失（sslSocketFactory/trustManager 为 null），"
                    + "SNI 剥离停用（直连决策与熔断记账不受影响）");
        }
        builder.eventListenerFactory(call -> new AttributionEventListener(breaker, warnSink));
        builder.addInterceptor(new PinnedAccountingInterceptor(breaker, warnSink, lastGoodByChannel));
        return builder;
    }

    // ── 请求作用域凭据 ───────────────────────────────────────

    /**
     * 请求作用域凭据（= 一次 {@code Dns.lookup} 的 PINNED 决策 = 一次 Breaker
     * {@code allowDirect} 授凭）。ADR-0145 D1：凭据携带<b>候选 IP 列表</b>（主条目 +
     * 重试位 + 同通道其余表条目 + last-good），任一候选上的连接/握手事件均归因本凭据。
     * 记账闩 {@code accounted}：失败归因 CAS 恰好一次（多候选多次失败只记一次）；
     * 最终成功由拦截器幂等 {@code recordSuccess 清零——多候选下「前序 route 失败、
     * 末序成功」的保守误计被成功清零覆盖（ADR-0145 D3）。
     * {@code headersArrived} 划出 body 阶段边界——之后的失败属流式读取断流，不计
     * 传输层口径（禁大 zip 中途断流误熔断）。
     */
    private static final class PinnedGrant {
        /** 表主条目 IP（日志/last-good 记账用） */
        final String primaryIp;
        /** 候选 IP 列表（有序：last-good → 主条目 → 重试位 → 同通道其余；任一即归因本凭据） */
        final java.util.List<String> candidateIps;
        final ChannelCircuitBreaker.Channel channel;
        final java.util.concurrent.atomic.AtomicBoolean accounted =
                new java.util.concurrent.atomic.AtomicBoolean(false);
        volatile boolean headersArrived;

        PinnedGrant(String primaryIp, java.util.List<String> candidateIps,
                    ChannelCircuitBreaker.Channel channel) {
            this.primaryIp = primaryIp;
            this.candidateIps = java.util.Collections.unmodifiableList(candidateIps);
            this.channel = channel;
        }

        /** 对端是否为本凭据的候选之一（SSF 剥 SNI 判定 / 失败归因共用） */
        boolean matchesPeerAddress(String hostAddress) {
            return candidateIps.contains(hostAddress);
        }

        /** @return {@code true} = 本次调用赢得唯一一次失败记账权 */
        boolean tryAccount() {
            return accounted.compareAndSet(false, true);
        }
    }

    // ── 三件套 1：钉定 Dns ───────────────────────────────────

    /**
     * 白名单 host 钉定解析器：PINNED 决策 → 返回单个钉定 IP 地址（字面量构造，零 DNS 查询，
     * {@code getByAddress} 不触发反向解析）；SYSTEM 决策 → 委托 {@link Dns#SYSTEM}。
     *
     * <p>地址形态契约：<b>纯字面量地址</b>（不带主机名标签）。URL 与 Host 头由 OkHttp 按
     * 原始域名生成（域名恒不改写），连接层只需 IP；若给回环字面量挂上官方域主机名标签，
     * JVM 的 SOCKS 层（{@code socksProxyHost} 存在时）会按主机名把回环连接转发给本地代理，
     * 钉定直连被旁路——纯字面量地址在代理型 JVM 上按回环字面量短路，钉定语义不被劫持。
     *
     * <p>凭据挂载点：PINNED 即生成新 {@link PinnedGrant} 挂 ThreadLocal（连接尝试与记账
     * 义务同生）；SYSTEM 即清残留（本调用内后续归因点全部零记账，防同线程早前调用的
     * 残留凭据串味——拦截器 finally 是第二道防线）。
     */
    static final class PinnedDns implements Dns {

        /** 配置接缝（接口即测试面，ADR-0143 先例）：生产绑 Config 的两个只读快照入口 */
        private final java.util.function.Supplier<SwitchState> switchState;
        private final java.util.function.Supplier<IpTableMerger.Snapshot> table;
        private final ChannelCircuitBreaker breaker;
        private final Consumer<String> warnSink;
        /** 通道 → 最近成功候选（ADR-0145 D1 last-good 优先位；拦截器成功时写入） */
        private final java.util.concurrent.ConcurrentHashMap<ChannelCircuitBreaker.Channel, String> lastGood;

        PinnedDns(DirectAccessConfig config, ChannelCircuitBreaker breaker, Consumer<String> warnSink,
                  java.util.concurrent.ConcurrentHashMap<ChannelCircuitBreaker.Channel, String> lastGood) {
            this(config::switchState, config::currentTable, breaker, warnSink, lastGood);
        }

        /** 全注入构造（包可见：测试直测钉定/委托分支，无需装配完整 Config） */
        PinnedDns(java.util.function.Supplier<SwitchState> switchState,
                  java.util.function.Supplier<IpTableMerger.Snapshot> table,
                  ChannelCircuitBreaker breaker, Consumer<String> warnSink,
                  java.util.concurrent.ConcurrentHashMap<ChannelCircuitBreaker.Channel, String> lastGood) {
            this.switchState = switchState;
            this.table = table;
            this.breaker = breaker;
            this.warnSink = warnSink;
            this.lastGood = lastGood;
        }

        @Override
        public List<InetAddress> lookup(String hostname) throws UnknownHostException {
            GRANT.set(null); // 入口清残留（竞态面见类 javadoc「串味防护」）
            IpTableMerger.Snapshot snapshot = table.get();
            Decision decision = DirectAccessPolicy.decide(hostname, switchState.get(), breaker, snapshot);
            if (!decision.isDirect()) {
                return Dns.SYSTEM.lookup(hostname); // 系统路线：零记账、逐字节现状
            }
            // 候选序列（ADR-0145 D1）：主条目 ×(1+重试预算) → 同通道其余表条目 → last-good 优先位。
            // OkHttp RouteSelector 对地址列表逐 route 重试——概率性 RST 被同请求内原生握手重试吸收。
            ChannelCircuitBreaker.Channel channel = decision.channel();
            List<String> candidates = new java.util.ArrayList<>();
            String last = lastGood.get(channel);
            if (last != null && !last.equals(decision.ip())) {
                candidates.add(last); // last-good 优先位（跨通道互不串扰：按通道分槽）
            }
            candidates.add(decision.ip());
            candidates.add(decision.ip()); // 重试预算 ×1：概率性 RST 的同请求吸收
            if (snapshot != null) {
                for (java.util.Map.Entry<String, String> e : snapshot.entries().entrySet()) {
                    if (e.getValue().equals(decision.ip())) continue;
                    if (DirectAccessPolicy.classifyChannel(e.getKey()) != channel) continue;
                    if (!candidates.contains(e.getValue())) candidates.add(e.getValue());
                }
            }
            List<InetAddress> addresses = new java.util.ArrayList<>(candidates.size());
            for (String ip : candidates) {
                try {
                    // 严格 IPv4 字面量 → getByName 仅做字面量合法性检查，绝不发起 DNS 查询；
                    // getByAddress(bytes) 按字节构造地址，主机名回落为字面量本身——
                    // 不做反向解析，也不携带伪造主机名标签（带主机名标签的回环字面量会被
                    // JVM 的 SOCKS 层按主机名转发给本地代理，绕开钉定直连，见 lookup javadoc）
                    addresses.add(InetAddress.getByAddress(InetAddress.getByName(ip).getAddress()));
                } catch (UnknownHostException e) {
                    // 理论不可达（Merger/Config 已校验严格 IPv4；此处防御禁静默）：
                    // 凭据已被 Policy 消耗（门序契约），当场 recordFailure 回收记账义务，
                    // 再回退系统路线——不失凭据、不失可见性
                    breaker.recordFailure(channel);
                    warnSink.accept(TAG + " 钉定 IP 字面量构造地址失败（防御兜底，已按传输失败记账并回退"
                            + "系统路线）: host=" + hostname + " ip=" + ip + " (" + e + ")");
                    return Dns.SYSTEM.lookup(hostname);
                }
            }
            GRANT.set(new PinnedGrant(decision.ip(), candidates, channel));
            return addresses;
        }
    }

    // ── 三件套 2：SNI 剥离 SSLSocketFactory ──────────────────

    /**
     * 包裹默认工厂的 SNI 剥离层：<b>仅当</b> socket 的已连接对端 IP 等于本次请求的钉定 IP
     * （grant 比对）时，在 TLS 握手前剥空 SNI；其余一切 socket（系统路线、镜像、GitHub、
     * OTA、池外新建的非钉定连接）原样透传——线缆形态与未安装时逐字节一致。
     *
     * <p><b>剥离机制（双保险，实测钉死）</b>：
     * <ol>
     *   <li><b>主机制 = 字面量对端</b>：向底层工厂传「钉定 IP 字面量」而非 URL 域名作为
     *       SSL socket 的对端 host——JDK/Conscrypt 的 SNI 派生对字面量地址恒短路
     *       （字面量没有合法主机名形态，ClientHello 不携带 SNI 扩展）。实测 JDK 21 上
     *       {@code SSLParameters.setServerNames(空列表)} <b>不生效</b>（参数存入但
     *       ClientHello 仍按对端主机名派生 SNI，独立诊断钉死），字面量对端是唯一可靠的
     *       按连接剥离手段，Android 同族行为一致；</li>
     *   <li><b>副机制 = 空 serverNames</b>：握手前再置空 {@code SSLParameters.serverNames}
     *       ——在尊重空列表语义的 TLS 栈上双保险生效，在 JDK 21 上为无害 no-op。</li>
     * </ol>
     *
     * <p>判定依据 = 对端地址而非 host 参数：OkHttp 用 Dns 结果建连，SSF 看到的对端地址与
     * Dns 返回的钉定 IP 天然一致；host 参数（URL 域名）只用于日志/会话缓存，不参与判定。
     * TrustManager 透传默认（证书链校验保留）；主机名校验由 OkHttp 按真实 URL 域名执行
     * （{@code OkHostnameVerifier} 用自己的 hostname 参数查证书，与 SSL socket 的对端
     * host 无关），泛域名证书直接过。
     *
     * <p>无已连接对端的重载（{@code createSocket(host, port)} 系）不在 OkHttp 直连建连
     * 路径上（{@code connectTls} 恒走 {@code createSocket(rawSocket, host, port, autoClose)}），
     * 原样委托、零判定。
     */
    static final class SniStrippingSSLSocketFactory extends SSLSocketFactory {

        private final SSLSocketFactory delegate;
        private final Consumer<String> warnSink;

        SniStrippingSSLSocketFactory(SSLSocketFactory delegate, Consumer<String> warnSink) {
            this.delegate = delegate;
            this.warnSink = warnSink;
        }

        @Override
        public Socket createSocket(Socket s, String host, int port, boolean autoClose) throws IOException {
            // 对端 host 的改写决策必须发生在底层工厂创建 socket 之前（host 是构造入参）
            String peerHost = host;
            PinnedGrant grant = pinnedGrantFor(s);
            if (grant != null) {
                // 钉定连接（ADR-0145 D1 多候选）：peer = socket 实际连上的字面量候选地址
                //（host 参数可能是调用方传入的主机名形态，不可作字面量对端——否则 SNI
                // 从主机名派生，剥离失效）
                peerHost = s.getInetAddress().getHostAddress();
            }
            Socket socket = delegate.createSocket(s, peerHost, port, autoClose);
            if (grant != null) {
                stripServerNames(socket); // 副机制：空 serverNames（对尊重该语义的栈双保险）
            }
            return socket;
        }

        @Override
        public Socket createSocket(String host, int port) throws IOException {
            return delegate.createSocket(host, port);
        }

        @Override
        public Socket createSocket(String host, int port, InetAddress localHost, int localPort)
                throws IOException {
            return delegate.createSocket(host, port, localHost, localPort);
        }

        @Override
        public Socket createSocket(InetAddress host, int port) throws IOException {
            return delegate.createSocket(host, port);
        }

        @Override
        public Socket createSocket(InetAddress address, int port, InetAddress localAddress, int localPort)
                throws IOException {
            return delegate.createSocket(address, port, localAddress, localPort);
        }

        @Override
        public String[] getDefaultCipherSuites() {
            return delegate.getDefaultCipherSuites();
        }

        @Override
        public String[] getSupportedCipherSuites() {
            return delegate.getSupportedCipherSuites();
        }

        /**
         * 剥离判定（pre-createSocket）：底层 socket 的已连接对端 IP 等于本次钉定值 →
         * 返回 grant（需要剥离）；否则 null（零扰动）。remote null / grant null 均 = 不剥离。
         */
        private static PinnedGrant pinnedGrantFor(Socket socket) {
            if (socket == null || socket.getInetAddress() == null) {
                return null; // 无已连接对端（不在直连建连路径上）
            }
            PinnedGrant grant = GRANT.get();
            if (grant == null || !grant.matchesPeerAddress(socket.getInetAddress().getHostAddress())) {
                return null; // 非钉定连接：零扰动（系统路线/镜像/GitHub 逐字节现状）
            }
            return grant;
        }

        /**
         * 副机制：置空 serverNames（对尊重空列表语义的 TLS 栈双保险；JDK 21 实测 no-op，
         * 主机制 = 字面量对端恒生效）。失败 warn 但不阻断握手——降级可见，边缘可能按
         * SNI 错配 → 421 → 记账回退，不会比现状更坏。
         */
        private void stripServerNames(Socket socket) {
            try {
                SSLSocket sslSocket = (SSLSocket) socket;
                SSLParameters params = sslSocket.getSSLParameters();
                params.setServerNames(Collections.emptyList());
                sslSocket.setSSLParameters(params);
            } catch (Exception e) {
                warnSink.accept(TAG + " SNI 副机制置空 serverNames 失败"
                        + "（主机制字面量对端不受影响，保留原 TLS 参数继续握手）: " + e);
            }
        }
    }

    // ── 三件套 3：失败归因 EventListener ─────────────────────

    /**
     * 传输层失败兜底归因器（经 {@code EventListener.Factory} 每<b>调用</b>一实例；
     * 实例本身无状态——归因锚点是 ThreadLocal 凭据，实例化只是 OkHttp 工厂形态要求）。
     *
     * <p>职责边界（恰好一次论证见类 javadoc）：
     * <ul>
     *   <li>{@code connectFailed}：连接/握手失败的<b>主归因点</b>（先于异常传播触发，
     *       凭据在场）；对端 IP 与凭据不匹配（非钉定路线）→ 零记账零告警；记账成功同步
     *       warn 一行（钉定 IP / 通道 / 异常，#395 可观测性；钉定路线 host 恒同 ip，不重复输出）；</li>
     *   <li>{@code responseHeadersStart}：只标记 body 阶段边界（{@code headersArrived}），
     *       <b>不记账</b>——EventListener 拿不到状态码，421 与 200 在此无法区分，
     *       响应阶段成败归拦截器（421 特化）；</li>
     *   <li>{@code callFailed}：兜底归因（前两点均未覆盖的罕见失败路径；warn 一行，
     *       仅 ip/通道/异常——无地址入参故无 host 字段）；{@code headersArrived} 已置位 = body 阶段失败，
     *       <b>不计入不告警</b>（禁大 zip 断流噪音）。</li>
     *   <li>{@code connectEnd}/{@code connectStart}：不重写——连接成功不是成功口径
     *       （口径 = 响应头到达，归拦截器），连接开始无任何可观测义务。</li>
     * </ul>
     */
    static final class AttributionEventListener extends EventListener {

        private final ChannelCircuitBreaker breaker;
        private final Consumer<String> warnSink;

        AttributionEventListener(ChannelCircuitBreaker breaker, Consumer<String> warnSink) {
            this.breaker = breaker;
            this.warnSink = warnSink;
        }

        @Override
        public void connectFailed(Call call, InetSocketAddress inetSocketAddress, Proxy proxy,
                                  Protocol protocol, IOException ioe) {
            PinnedGrant grant = GRANT.get();
            if (grant != null && matchesPinnedAddress(inetSocketAddress, grant)) {
                if (grant.tryAccount()) {
                    breaker.recordFailure(grant.channel);
                    // 禁静默（#395）：钉定连接失败必须 logcat 可见；与记账同一 CAS 闸门，
                    // 恰好一行、无重复噪音；ip 记本次 route 的字面量候选（可能是重试位/
                    // 同通道备用，不必等于主条目）
                    java.net.InetAddress peer = inetSocketAddress.getAddress();
                    String peerIp = peer == null ? "unresolved" : peer.getHostAddress();
                    warnSink.accept(TAG + " 钉定连接失败（connectFailed，已按传输失败记账）: ip="
                            + peerIp + " channel=" + grant.channel + " error=" + ioe);
                }
            }
        }

        @Override
        public void responseHeadersStart(Call call) {
            PinnedGrant grant = GRANT.get();
            if (grant != null) {
                grant.headersArrived = true; // body 阶段边界：之后的失败不计传输层口径
            }
        }

        @Override
        public void callFailed(Call call, IOException ioe) {
            PinnedGrant grant = GRANT.get();
            if (grant != null && !grant.headersArrived) {
                if (grant.tryAccount()) {
                    breaker.recordFailure(grant.channel);
                    // 禁静默（#395）：兜底归因点告警，与记账同一 CAS 闸门（1:1）；
                    // body 阶段失败已在上方守卫拦截（不记账不告警）
                    warnSink.accept(TAG + " 钉定调用失败（callFailed 兜底，已按传输失败记账）: ip="
                            + grant.primaryIp + " channel=" + grant.channel + " error=" + ioe);
                }
            }
        }

        /** 对端 IP 精确匹配凭据（∈/∉ 钉定集判定；未解析地址防御为不匹配 → 零记账）。 */
        private static boolean matchesPinnedAddress(InetSocketAddress address, PinnedGrant grant) {
            InetAddress remote = address.getAddress();
            return remote != null && grant.matchesPeerAddress(remote.getHostAddress());
        }
    }

    // ── 三件套 4：421 特化 + 响应阶段记账拦截器 ──────────────

    /**
     * 应用拦截器：响应阶段记账的唯一归属 + finally 凭据清理。
     *
     * <ul>
     *   <li>proceed 正常返回（响应头已达）：凭据在场 → 421 = 边缘错配
     *       {@code recordFailure} + warn 一行（host/ip，#395 可观测性；spec 421 特化）；
     *       其余状态码（含 4xx/5xx）= 传输层成功 {@code recordSuccess}（应用层失败不计
     *       传输口径）；421 响应<b>原样返回</b>，不改写不抛异常；</li>
     *   <li>proceed 抛出（连接后、响应头前的失败——请求写入断流等；proceed 一旦抛出即
     *       必然响应头未达，无 body 误计面）→ {@code recordFailure} 后原样上抛；</li>
     *   <li>finally 清理 ThreadLocal 凭据：请求作用域终点（连接池命中路径不触发 Dns、
     *       凭据恒 null、零记账——与 Breaker「无授凭无义务」契约一致）。</li>
     * </ul>
     *
     * <p>标记类：{@code install} 的幂等判定锚点（见 install javadoc）。
     */
    static final class PinnedAccountingInterceptor implements Interceptor {

        private final ChannelCircuitBreaker breaker;
        private final Consumer<String> warnSink;
        /** 通道 → 最近成功候选（ADR-0145 D1 last-good；与 PinnedDns 共享同一 map 实例） */
        private final java.util.concurrent.ConcurrentHashMap<ChannelCircuitBreaker.Channel, String> lastGood;

        PinnedAccountingInterceptor(ChannelCircuitBreaker breaker, Consumer<String> warnSink,
                                    java.util.concurrent.ConcurrentHashMap<ChannelCircuitBreaker.Channel, String> lastGood) {
            this.breaker = breaker;
            this.warnSink = warnSink;
            this.lastGood = lastGood;
        }

        @Override
        public Response intercept(Chain chain) throws IOException {
            try {
                Response response = chain.proceed(chain.request());
                PinnedGrant grant = GRANT.get();
                if (grant != null) {
                    if (response.code() == 421) {
                        // 边缘错配：CAS 恰好一次记账 + warn（ADR-0145：候选序列部分失败同理）
                        if (grant.tryAccount()) {
                            breaker.recordFailure(grant.channel); // 边缘错配：传输层失败证据
                            // 禁静默（#395）：421 错配记账点 warn 可见（host/ip 定位错配边缘）
                            warnSink.accept(TAG + " 直连边缘错配（HTTP 421，已按传输失败记账）: host="
                                    + chain.request().url().host() + " ip=" + grant.primaryIp
                                    + " channel=" + grant.channel);
                        }
                    } else {
                        // 非错配响应头到达 = 传输层成功（ADR-0145 D3）：幂等 recordSuccess
                        // 无条件清零——覆盖「候选序列前序 route 失败已记账、末序成功」的保守误计；
                        // 并记 last-good（候选序列首位优先位）
                        breaker.recordSuccess(grant.channel);
                        lastGood.put(grant.channel, grant.primaryIp);
                    }
                }
                return response;
            } catch (IOException | RuntimeException e) {
                PinnedGrant grant = GRANT.get();
                if (grant != null && grant.tryAccount()) {
                    breaker.recordFailure(grant.channel); // 响应头前失败（proceed 抛出 ⇒ 头未达）
                }
                throw e;
            } finally {
                GRANT.remove(); // 请求作用域终点：防 dispatcher 线程复用串味
            }
        }
    }
}
