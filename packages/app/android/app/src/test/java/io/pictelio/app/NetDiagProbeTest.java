package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.RuntimeEnvironment;
import org.robolectric.annotation.Config;

@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28)
public class NetDiagProbeTest {

    private static JSONObject byId(JSONArray arr, String id) throws Exception {
        for (int i = 0; i < arr.length(); i++) {
            JSONObject o = arr.getJSONObject(i);
            if (id.equals(o.getString("id"))) return o;
        }
        return null;
    }

    @Test
    public void dnsFailureYieldsOnlyDnsProbe() throws Exception {
        NetDiagProbe.Timed net = new NetDiagProbe.Timed();
        net.failedStage = "dns";
        net.rawError = "timeout";
        JSONArray probes = NetDiagProbe.assembleProbes(net, okEdge(), null);
        assertEquals(2, probes.length());
        JSONObject dns = byId(probes, "dns");
        assertFalse(dns.getBoolean("ok"));
        assertEquals("timeout", dns.getString("errorClass"));
        // tcp/tls not attempted -> omitted (skipped downstream)
        assertEquals(null, byId(probes, "tcp"));
        assertEquals(null, byId(probes, "tls"));
    }

    @Test
    public void dnsOkTcpFailYieldsDnsOkTcpFail() throws Exception {
        NetDiagProbe.Timed net = new NetDiagProbe.Timed();
        net.dnsDone = true;
        net.dnsMs = 12;
        net.failedStage = "connect";
        net.rawError = "Connection reset";
        JSONArray probes = NetDiagProbe.assembleProbes(net, okEdge(), null);
        assertTrue(byId(probes, "dns").getBoolean("ok"));
        JSONObject tcp = byId(probes, "tcp");
        assertFalse(tcp.getBoolean("ok"));
        assertEquals("connect", tcp.getString("errorClass"));
        assertEquals(null, byId(probes, "tls"));
    }

    @Test
    public void fullSuccessYieldsAllNetworkProbes() throws Exception {
        NetDiagProbe.Timed net = new NetDiagProbe.Timed();
        net.dnsDone = true;
        net.dnsMs = 10;
        net.connectDone = true;
        net.connectMs = 20;
        net.tlsDone = true;
        net.tlsMs = 30;
        NetDiagProbe.Timed edge = new NetDiagProbe.Timed();
        edge.reached = true;
        edge.ttfbMs = 40;
        JSONObject http = NetDiagProbe.okProbe("http", 55);
        JSONArray probes = NetDiagProbe.assembleProbes(net, edge, http);
        assertEquals(5, probes.length());
        assertTrue(byId(probes, "dns").getBoolean("ok"));
        assertTrue(byId(probes, "tcp").getBoolean("ok"));
        assertTrue(byId(probes, "tls").getBoolean("ok"));
        assertTrue(byId(probes, "http").getBoolean("ok"));
        assertTrue(byId(probes, "edge").getBoolean("ok"));
    }

    @Test
    public void authFailureCarriesHttpStatus() throws Exception {
        JSONObject http = NetDiagProbe.failProbe("http", "auth", 401, "HTTP 401");
        assertEquals(401, http.getInt("httpStatus"));
        assertEquals("auth", http.getString("errorClass"));
    }

    @Test
    public void errorClassPrefersTimeout() {
        NetDiagProbe.Timed t = new NetDiagProbe.Timed();
        t.failedStage = "connect";
        t.rawError = "timeout";
        assertEquals("timeout", t.errorClass());
    }

    @Test
    public void deviceInfoNeverExposesSsidAndReportsNoNetwork() throws Exception {
        JSONObject d = NetDiagProbe.deviceInfo(RuntimeEnvironment.getApplication());
        assertTrue(d.has("transports"));
        assertTrue(d.has("validated"));
        assertTrue(d.has("captivePortal"));
        assertTrue(d.has("metered"));
        assertFalse(d.has("ssid"));
    }

    private static NetDiagProbe.Timed okEdge() {
        NetDiagProbe.Timed edge = new NetDiagProbe.Timed();
        edge.reached = true;
        edge.ttfbMs = 5;
        return edge;
    }
}
