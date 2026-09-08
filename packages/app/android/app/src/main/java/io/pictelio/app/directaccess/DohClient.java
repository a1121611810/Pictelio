package io.pictelio.app.directaccess;

import android.util.Log;

import java.io.IOException;
import java.net.InetAddress;
import java.net.UnknownHostException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;

/**
 * DoH（DNS over HTTPS）解析客户端——pictelio-pure-client-direct-access T4。
 *
 * <p><b>定位：辅助工具，非运行时依赖</b>。
 * 本项目禁止远程代理路线（CF Worker / HibiAPI / 公共镜像），但 DoH 端点本身是「IP 形式」
 * 的公共 DNS 服务（Quad9、Cloudflare 1.0.0.1），属于网络基础设施而非项目级远程代理——
 * 故允许作为「用户主动点刷新按钮」时的辅助查询手段，不作为运行时 PinnedDns 的必选路径。
 *
 * <p><b>端点优先级</b>（基于 2026-09-08 沙箱探针 + 仓库实证）：
 * <ol>
 *   <li><b>Quad9 (https://9.9.9.9/dns-query)</b>——主。无日志、无 ECS、隐私友好；
 *       用户首选；</li>
 *   <li><b>Cloudflare 1.0.0.1 (https://1.0.0.1/dns-query)</b>——备。1.1.1.1 已知 GFW 污染
 *       （仓库探针报告 docs/research/pixiv-gfw-blocking-and-bypass.md 实证），1.0.0.1 作
 *       CF 边缘备用（GFW 时代两个端点封锁策略独立，1.0.0.1 可用概率高）；</li>
 *   <li><b>Cloudflare 1.1.1.1 (https://1.1.1.1/dns-query)</b>——不列（已知污染）；</li>
 *   <li><b>Google 8.8.8.8 (https://8.8.8.8/dns-query)</b>——不列（GFW 时代可达性不稳定）。</li>
 * </ol>
 *
 * <p><b>失败语义</b>：
 * <ul>
 *   <li>所有端点超时 / TLS 失败 / 响应非 JSON / 解析为明显污染 IP（0.0.0.0 / 127.0.0.1 /
 *       RFC1918 内网）→ {@link #resolve} 抛 {@link IOException}，主端点失败时每端点各打
 *       一行 warn（禁静默降级硬约束）；</li>
 *   <li>解析成功但返回空 / 全部为污染 IP → 也视为失败，抛 IOException + warn。</li>
 * </ul>
 *
 * <p><b>线程安全</b>：{@link #client} 不可变，可跨线程共享；调用方自行决定并发模型。
 *
 * <p><b>生产装配纪律</b>：{@code OkHttpClient} 必须使用独立短超时（避免阻塞调用方），
 * 推荐 {@code connectTimeout=5s / callTimeout=8s / readTimeout=8s}——DoH 仅响应体小
 * （< 4KB），长等待无意义。
 */
public final class DohClient {

    private static final String TAG = "[DohClient]";

    /** 主端点：Quad9（用户首选，无 ECS） */
    private static final String PRIMARY_ENDPOINT = "https://9.9.9.9/dns-query";

    /** 备端点：Cloudflare 1.0.0.1（1.1.1.1 已知污染，1.0.0.1 备用） */
    private static final String FALLBACK_ENDPOINT = "https://1.0.0.1/dns-query";

    /** Accept 头：application/dns-json（JSON API 形式，兼容性优于 wireformat） */
    private static final String ACCEPT_JSON = "application/dns-json";

    private final OkHttpClient client;
    private final List<String> endpoints;

    /**
     * 默认构造：使用默认 OkHttpClient（共享连接池/线程池；调用方按需配置超时）。
     */
    public DohClient() {
        this(new OkHttpClient.Builder()
                .connectTimeout(5_000, java.util.concurrent.TimeUnit.MILLISECONDS)
                .callTimeout(8_000, java.util.concurrent.TimeUnit.MILLISECONDS)
                .readTimeout(8_000, java.util.concurrent.TimeUnit.MILLISECONDS)
                .build());
    }

    /**
     * 包可见注入构造（测试可注入 mock client）。
     */
    DohClient(OkHttpClient client) {
        this(client, Arrays.asList(PRIMARY_ENDPOINT, FALLBACK_ENDPOINT));
    }

    /** 全注入构造：测试可自定义端点列表（如注入 mock server） */
    DohClient(OkHttpClient client, List<String> endpoints) {
        this.client = client;
        this.endpoints = new ArrayList<>(endpoints);
    }

    /**
     * 解析 hostname → IP 列表（去重 + 过滤明显污染 IP）。
     *
     * @param hostname 要解析的主机名（如 {@code i.pximg.net}）
     * @return 不重复的 IPv4 字面量列表
     * @throws IOException 所有端点失败时抛出（每端点失败 warn 一行）
     */
    public List<String> resolve(String hostname) throws IOException {
        if (hostname == null || hostname.isEmpty()) {
            Log.w(TAG, "resolve 收到空 hostname，拒绝请求");
            throw new IOException("hostname 不能为空");
        }

        // 已是 IP 字面量：直接返回（避免无谓查询）
        if (isIpv4Literal(hostname)) {
            return Arrays.asList(hostname);
        }

        IOException lastError = null;
        for (String endpoint : endpoints) {
            try {
                List<String> ips = queryOnce(endpoint, hostname);
                if (ips != null && !ips.isEmpty()) {
                    return ips;
                }
                // 解析为空或全为污染：视同失败，继续尝试下一端点
                Log.w(TAG, endpoint + " 解析 " + hostname + " 结果为空或全污染，尝试下一端点");
            } catch (IOException e) {
                Log.w(TAG, endpoint + " 解析 " + hostname + " 失败，尝试下一端点: " + e.getMessage());
                lastError = e;
            }
        }

        // 所有端点均失败：抛最后一个异常（保留现场）
        throw new IOException("所有 DoH 端点失败，hostname=" + hostname,
                lastError);
    }

    /**
     * 单端点查询：GET application/dns-json，返回 A 记录 IP 列表（已过滤污染）。
     *
     * @return 非空 IP 列表；端点可达但返回空记录时返回 null（让调用方继续尝试下一端点）
     */
    private List<String> queryOnce(String endpoint, String hostname) throws IOException {
        String url = endpoint + "?name=" + hostname + "&type=A";
        Request request = new Request.Builder()
                .url(url)
                .header("Accept", ACCEPT_JSON)
                .header("User-Agent", "pictelio-doh/1.0")
                .build();

        try (Response response = client.newCall(request).execute()) {
            if (!response.isSuccessful()) {
                throw new IOException("HTTP " + response.code() + ": " + endpoint);
            }
            String body = response.body() != null ? response.body().string() : "";
            return parseDnsJson(body);
        }
    }

    /**
     * 解析 DoH JSON 响应：提取 Answer 中 type=1（A 记录）的 data 字段。
     * 格式：{@code {"Status":0,"Answer":[{"name":"...","type":1,"TTL":...,"data":"1.2.3.4"}]}}
     *
     * <p>本实现不引入 JSON 依赖：手解析够用（响应体 < 4KB，结构稳定）。
     * 找不到 Answer 或 A 记录 → 返回 null（让调用方继续尝试下一端点）。
     */
    static List<String> parseDnsJson(String body) {
        if (body == null || body.isEmpty()) {
            return null;
        }
        // 极简手解析：找所有 "data":"X.X.X.X" 出现位置
        List<String> ips = new ArrayList<>();
        int idx = 0;
        while ((idx = body.indexOf("\"data\":", idx)) != -1) {
            int quoteStart = body.indexOf('"', idx + 7);
            if (quoteStart == -1) break;
            int quoteEnd = body.indexOf('"', quoteStart + 1);
            if (quoteEnd == -1) break;
            String data = body.substring(quoteStart + 1, quoteEnd);
            // 仅接受 IPv4 字面量，过滤污染 IP
            if (isIpv4Literal(data) && !isPolluted(data)) {
                if (!ips.contains(data)) ips.add(data);
            }
            idx = quoteEnd + 1;
        }
        return ips.isEmpty() ? null : ips;
    }

    /** 是否为合法 IPv4 字面量 */
    static boolean isIpv4Literal(String s) {
        if (s == null) return false;
        String[] parts = s.split("\\.");
        if (parts.length != 4) return false;
        for (String p : parts) {
            if (p.isEmpty() || p.length() > 3) return false;
            try {
                int n = Integer.parseInt(p);
                if (n < 0 || n > 255) return false;
            } catch (NumberFormatException e) {
                return false;
            }
        }
        return true;
    }

    /** 是否为典型污染 IP（GFW 时代 0.0.0.0 / 127.0.0.0/8 / 169.254.0.0/16 / RFC1918 含 172.16.0.0/12） */
    static boolean isPolluted(String ip) {
        if (ip == null || ip.isEmpty()) return true;
        if (ip.equals("0.0.0.0") || ip.startsWith("127.") || ip.startsWith("10.")
                || ip.startsWith("192.168.") || ip.startsWith("169.254.")) {
            return true;
        }
        // 172.16.0.0/12 = 172.16-172.31（手解析避免 startsWith 漏掉 .31）
        if (ip.startsWith("172.")) {
            int dot = ip.indexOf('.', 4);
            if (dot == -1) return true;
            int second;
            try {
                second = Integer.parseInt(ip.substring(4, dot));
            } catch (NumberFormatException e) {
                return true;
            }
            if (second >= 16 && second <= 31) return true;
        }
        return false;
    }

    /**
     * 校验解析出的 IP 是否为合法 InetAddress（防御性：捕获 InetAddress 拒绝的字符串，
     * 避免上层 byte[] 构造崩溃）。
     */
    public static boolean isResolvableIp(String ip) {
        if (!isIpv4Literal(ip)) return false;
        try {
            InetAddress.getByName(ip);
            return true;
        } catch (UnknownHostException e) {
            return false;
        }
    }
}