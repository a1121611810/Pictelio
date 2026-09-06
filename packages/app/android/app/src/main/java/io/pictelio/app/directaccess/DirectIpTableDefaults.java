package io.pictelio.app.directaccess;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

/**
 * APK 内置 IP 表常量（spec #385 / ticket #387）：Pixiv 官方域名 → 自建边缘 IP 的静态映射，
 * 直连模式「开箱即用」的兜底层（三层合并中的最底层，优先级最低）。
 *
 * <p><b>溯源（oracle，探针实测值）</b>：全部取自探针报告
 * {@code prototype/pixiv-bypass-feasibility} 分支（68fbd826）的
 * {@code docs/research/pixiv-direct-access-feasibility.md}（2026-09-06 实测）：
 * <ul>
 *   <li><b>图片边缘 {@code 210.140.139.131}</b>——探测矩阵 I4：无 SNI TLS 直连
 *       {@code i.pximg.net}（钉该 IP + Host 头路由），HTTP 200 且 sha256 与经代理基线一致；</li>
 *   <li><b>API+OAuth 边缘 {@code 210.140.139.155}</b>——探测矩阵 A2/H2：无 SNI 直连下
 *       同一 IP 同时服务 {@code app-api.pixiv.net} 与 {@code oauth.secure.pixiv.net}
 *       vhost（API 端点返回结构化 OAuth 错误 = 端到端已处理，refresh_token 刷新契约通）。</li>
 * </ul>
 *
 * <p><b>两边缘必须分列（禁合并为单一 IP）</b>：边缘按 vhost 特化——同段的 pximg 边缘 IP
 * （131/134）对 API/OAuth 的 Host 返回 <b>421 Misdirected Request</b>（报告 §3.3），
 * 选错边缘拿到的不是封锁而是错配。因此图片通道与 API+刷新通道的 IP 条目按域名分列，
 * 由 {@link DirectAccessPolicy#classifyChannel} 按 host 后缀归类通道。
 *
 * <p><b>只内置实测过的条目</b>：未探测的官方 host（如 {@code s.pximg.net}）不入内置表——
 * 路由判定对「白名单内但无表条目」的 host 回退系统路线（宁走系统路线不瞎猜边缘）。
 * 更多条目经远端 JSON / 手动编辑两层注入（{@link IpTableMerger}）。
 *
 * <p><b>纯 JVM 契约</b>：零 android.* / okhttp3.* 依赖；本类只产常量与不可变条目列表，
 * 消费方为 {@link IpTableMerger#merge}（结构须与其条目校验兼容，由单测把守）。
 */
public final class DirectIpTableDefaults {

    // ── 图片边缘（*.pximg.net 域族；通道 = IMAGE） ────────────

    /** 图片边缘代表条目 host（探针 I4 的实测对象；*.pximg.net 域族中唯一经内容一致性验证的） */
    public static final String IMAGE_HOST = "i.pximg.net";

    /**
     * 图片边缘 IP（探针 I4 实测：钉此 IP + 无 SNI + Host 头路由 {@code i.pximg.net}，
     * sha256 与经代理基线一致）。
     */
    public static final String IMAGE_EDGE_IP = "210.140.139.131";

    // ── API+OAuth 边缘（*.pixiv.net 域族；通道 = API_REFRESH） ──

    /** API 边缘条目 host（探针 A2 实测对象：app-api.pixiv.net） */
    public static final String API_HOST = "app-api.pixiv.net";

    /** OAuth 边缘条目 host（探针 H2 实测对象：oauth.secure.pixiv.net，refresh_token 刷新契约通） */
    public static final String OAUTH_HOST = "oauth.secure.pixiv.net";

    /**
     * API+OAuth 边缘 IP（探针 A2/H2 实测：同一自建边缘同时服务两个 vhost；
     * 与图片边缘 IP 特化分工，见类 javadoc「两边缘必须分列」）。
     */
    public static final String API_OAUTH_EDGE_IP = "210.140.139.155";

    /** 内置表（不可变，顺序 = 图片边缘 → API 边缘 → OAuth 边缘）；唯一出口，消费方 {@link IpTableMerger} */
    private static final List<IpTableMerger.Entry> BUILT_IN = Collections.unmodifiableList(Arrays.asList(
            new IpTableMerger.Entry(IMAGE_HOST, IMAGE_EDGE_IP),
            new IpTableMerger.Entry(API_HOST, API_OAUTH_EDGE_IP),
            new IpTableMerger.Entry(OAUTH_HOST, API_OAUTH_EDGE_IP)));

    private DirectIpTableDefaults() {
        // 纯常量类，禁实例化
    }

    /**
     * 内置 IP 表条目（不可变列表；host 已小写规范形，IP 为合法 IPv4 字面量——
     * 两者由 {@link DirectIpTableDefaultsTest} 与 {@link IpTableMerger} 校验双把守）。
     */
    public static List<IpTableMerger.Entry> builtIn() {
        return BUILT_IN;
    }
}
