package io.pictelio.app.directaccess;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.List;
import java.util.ArrayList;
import java.util.Collections;

/**
 * DirectIpTableDefaults 单测（#387）。
 *
 * <p><b>Oracle 溯源（spec #376 测试硬约束 #6：期望值出处可追溯，禁自洽 mock/同义反复）</b>
 * ——期望值全部来自独立来源：
 * <ul>
 *   <li>两个边缘 IP 字面量（210.140.139.133 / 210.140.139.155）：探针报告实测值，
 *       {@code prototype/pixiv-bypass-feasibility} 分支（68fbd826）
 *       {@code docs/research/pixiv-direct-access-feasibility.md} 探测矩阵
 *       I4（图片钉 131 直连 sha256 与基线一致）/ A2、H2（API+OAuth 边缘 155 双 vhost 打通）；</li>
 *   <li>三条目 host 集合（i.pximg.net / app-api.pixiv.net / oauth.secure.pixiv.net）：
 *       探针矩阵被测对象 + Pictelio 实际请求面（图片 CDN / API / 401 静默刷新）；</li>
 *   <li>「两边缘 IP 必须不同」：探针报告 §3.3 边缘 vhost 特化（pximg 边缘对 API Host
 *       返回 421 Misdirected Request）——合并为单一 IP 会造成系统性边缘错配；</li>
 *   <li>「只内置实测过的 3 条」：报告只验证了这三个 host 的直连通路（§3.2 证伪
 *       s.pximg.net 换 host 取 i.pximg.net 内容，故 s.pximg.net 不入内置表）。</li>
 * </ul>
 */
public class DirectIpTableDefaultsTest {

    // ── 常量 ≡ 探针实测值（防回归漂移） ──────────────────────

    @Test
    public void imageEdgeIp_isProbeMeasuredValue() {
        // oracle: 探针矩阵 I4（无 SNI TLS 直连 i.pximg.net 钉 210.140.139.133，sha256 与基线一致）
        assertEquals("210.140.139.133", DirectIpTableDefaults.IMAGE_EDGE_IP);
        assertEquals("i.pximg.net", DirectIpTableDefaults.IMAGE_HOST);
    }

    @Test
    public void apiOauthEdgeIp_isProbeMeasuredValue() {
        // oracle: 探针矩阵 A2/H2（210.140.139.155 同时服务 app-api 与 oauth.secure vhost）
        assertEquals("210.140.139.155", DirectIpTableDefaults.API_OAUTH_EDGE_IP);
        assertEquals("app-api.pixiv.net", DirectIpTableDefaults.API_HOST);
        assertEquals("oauth.secure.pixiv.net", DirectIpTableDefaults.OAUTH_HOST);
    }

    @Test
    public void twoEdges_areDistinctIps() {
        // oracle: 探针报告 §3.3 —— 边缘按 vhost 特化（421 错配），
        // 图片边缘与 API+OAuth 边缘是不同边缘集群，禁止收敛为同一常量
        assertNotEquals(DirectIpTableDefaults.IMAGE_EDGE_IP, DirectIpTableDefaults.API_OAUTH_EDGE_IP);
    }

    // ── 内置表结构（Merger 消费契约） ────────────────────────

    @Test
    public void builtIn_hasExactlyThreeProbedEntries() {
        // oracle: 只内置实测过的条目（报告 §3.2 s.pximg.net 证伪 → 不入表）
        List<IpTableMerger.Entry> builtIn = DirectIpTableDefaults.builtIn();
        assertEquals(3, builtIn.size());
        assertEquals(new IpTableMerger.Entry("i.pximg.net", "210.140.139.133"), builtIn.get(0));
        assertEquals(new IpTableMerger.Entry("app-api.pixiv.net", "210.140.139.155"), builtIn.get(1));
        assertEquals(new IpTableMerger.Entry("oauth.secure.pixiv.net", "210.140.139.155"), builtIn.get(2));
    }

    @Test
    public void builtIn_isUnmodifiable() {
        List<IpTableMerger.Entry> builtIn = DirectIpTableDefaults.builtIn();
        try {
            builtIn.add(new IpTableMerger.Entry("x.example", "1.2.3.4"));
            throw new AssertionError("内置表必须不可变");
        } catch (UnsupportedOperationException expected) {
            // 预期
        }
    }

    @Test
    public void builtIn_hostsAreLowercaseNormalized() {
        // host 必须是小写规范形（Policy/Snapshot 大小写不敏感查询依赖规范化 key）
        for (IpTableMerger.Entry e : DirectIpTableDefaults.builtIn()) {
            assertEquals(e.host(), e.host().toLowerCase());
        }
    }

    @Test
    public void builtIn_allEntriesPassMergerValidation_withoutWarn() {
        // 跨类契约：内置表必须被 IpTableMerger 全量接受（零告警零跳过）——
        // 结构漂移（如 host 出现空白/IP 非法）在此被拦截
        List<String> warns = Collections.synchronizedList(new ArrayList<String>());
        IpTableMerger.Snapshot snapshot =
                new IpTableMerger(warns::add).merge(null, null, DirectIpTableDefaults.builtIn());
        assertTrue("内置表不允许产生任何告警，实际: " + warns, warns.isEmpty());
        assertEquals(3, snapshot.entries().size());
        assertEquals("210.140.139.133", snapshot.ipFor("i.pximg.net"));
        assertEquals("210.140.139.155", snapshot.ipFor("app-api.pixiv.net"));
        assertEquals("210.140.139.155", snapshot.ipFor("oauth.secure.pixiv.net"));
        assertFalse(snapshot.isEmpty());
    }
}
