package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import java.nio.charset.StandardCharsets;

import org.junit.Test;

/**
 * OtaSignatureVerifier JVM 单测（#248）。
 *
 * oracle 溯源（仓库测试硬约束 6）：
 * 1. RFC 8032 §7.1 官方测试向量（TEST 1 / TEST 2）——防实现漂移的权威语料
 * 2. Node 侧差分 fixture——由 scripts 发布端同款算法（node:crypto Ed25519，
 *    域分隔前缀 + SHA-256(manifest)）用项目真实 OTA 私钥生成，两端互验
 * 3. SHA-256("abc") = NIST FIPS 180-4 已知答案向量
 * 4. isApkVersionAtLeast 期望值 = 规格语义（宿主版本 ≥ bundle 声明的 minApkVersion），
 *    数值序而非字典序（4.9.9 < 4.10.0），与 packages/update-check isNewer 口径一致
 */
public class OtaSignatureVerifierTest {

    // ── RFC 8032 §7.1 官方向量 ──

    /** TEST 1（空消息）：pk/msg/sig 均为 RFC 原文 hex */
    private static final String RFC1_PK =
            "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a";
    private static final byte[] RFC1_MSG = new byte[0];
    private static final String RFC1_SIG =
            "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e06522490155"
                    + "5fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b";

    /** TEST 2（单字节 0x72） */
    private static final String RFC2_PK =
            "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c";
    private static final byte[] RFC2_MSG = new byte[] { 0x72 };
    private static final String RFC2_SIG =
            "92a009a9f0d4cab8720e820b5f642540a2b27b5416503f8fb3762223ebdb69da"
                    + "085ac1e43e15996e458f3613d0f11d8c387b2eaeb4302aeeb00d291612bb0c00";

    @Test
    public void rfc8032_test1_validSignature() {
        assertTrue(OtaSignatureVerifier.verify(RFC1_MSG, hex(RFC1_SIG), hex(RFC1_PK)));
    }

    @Test
    public void rfc8032_test1_tamperedSignatureRejected() {
        byte[] sig = hex(RFC1_SIG);
        sig[0] ^= 0x01;
        assertFalse(OtaSignatureVerifier.verify(RFC1_MSG, sig, hex(RFC1_PK)));
    }

    @Test
    public void rfc8032_test1_tamperedMessageRejected() {
        byte[] msg = new byte[] { 0x00 }; // 与空消息差一个字节
        assertFalse(OtaSignatureVerifier.verify(msg, hex(RFC1_SIG), hex(RFC1_PK)));
    }

    @Test
    public void rfc8032_test2_validSignature() {
        assertTrue(OtaSignatureVerifier.verify(RFC2_MSG, hex(RFC2_SIG), hex(RFC2_PK)));
    }

    @Test
    public void malformedInputsFailClosed() {
        byte[] sig = hex(RFC1_SIG);
        byte[] pk = hex(RFC1_PK);
        assertFalse("公钥长度非 32", OtaSignatureVerifier.verify(RFC1_MSG, sig, new byte[31]));
        assertFalse("签名长度非 64", OtaSignatureVerifier.verify(RFC1_MSG, new byte[63], pk));
        assertFalse("公钥为 null", OtaSignatureVerifier.verify(RFC1_MSG, sig, null));
        assertFalse("签名为 null", OtaSignatureVerifier.verify(RFC1_MSG, null, pk));
    }

    // ── Node 侧差分 fixture（项目真实 OTA key，node:crypto 生成） ──

    /** 项目 OTA 公钥（raw 32B base64，= BuildConfig.OTA_ED25519_PUBLIC_KEY_B64 注入值） */
    private static final String PROJECT_PUB_B64 = "ST/sQxNxrrZXOWwiuKdqqp79p3njn6MvIMWwJQTXWQY=";

    /** manifest JSON 字节（node:crypto 签名时的原文） */
    private static final String FIXTURE_MANIFEST =
            "{\"version\":\"4.21.0\",\"minApkVersion\":\"4.20.0\",\"size\":123456,"
                    + "\"sha256\":\"" + "a".repeat(64) + "\"}";
    /** sig = PureEdDSA(DOMAIN_PREFIX || SHA-256(manifest))，node:crypto 侧生成 */
    private static final String FIXTURE_SIG_HEX =
            "dff6c0f68d7350154cefea95695c1b6742157cc128ab84fa4e631ece93f173bb"
                    + "3a9dc7bf0c23e09aa5d674fd1db9fdd7293ac56c047ccc0cd5c618ac27f7c406";

    @Test
    public void nodeDifferential_verifyManifest() {
        byte[] manifest = FIXTURE_MANIFEST.getBytes(StandardCharsets.UTF_8);
        assertTrue(
                "Node 签名的 manifest 必须通过 Java 验签（差分互验）",
                OtaSignatureVerifier.verifyManifest(manifest, hex(FIXTURE_SIG_HEX), PROJECT_PUB_B64));
    }

    @Test
    public void nodeDifferential_tamperedManifestRejected() {
        // 篡改 manifest 一个字节（4.21.0 → 4.21.1）
        byte[] tampered = FIXTURE_MANIFEST.getBytes(StandardCharsets.UTF_8);
        tampered[tampered.length - 1 - 25] ^= 0x01;
        assertFalse(
                "manifest 被篡改必须拒绝",
                OtaSignatureVerifier.verifyManifest(tampered, hex(FIXTURE_SIG_HEX), PROJECT_PUB_B64));
    }

    @Test
    public void nodeDifferential_tamperedSignatureRejected() {
        byte[] sig = hex(FIXTURE_SIG_HEX);
        sig[10] ^= 0x10;
        assertFalse(
                OtaSignatureVerifier.verifyManifest(
                        FIXTURE_MANIFEST.getBytes(StandardCharsets.UTF_8), sig, PROJECT_PUB_B64));
    }

    @Test
    public void nodeDifferential_wrongKeyRejected() {
        // 另一把合法 Ed25519 公钥（RFC1 的 pk）——签名与 key 绑定校验
        assertFalse(
                OtaSignatureVerifier.verifyManifest(
                        FIXTURE_MANIFEST.getBytes(StandardCharsets.UTF_8), hex(FIXTURE_SIG_HEX),
                        toB64(hex(RFC1_PK))));
    }

    // ── SHA-256 已知答案（NIST FIPS 180-4） ──

    @Test
    public void sha256KnownAnswer() throws Exception {
        assertEquals(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                OtaSignatureVerifier.sha256Hex("abc".getBytes(StandardCharsets.UTF_8)));
    }

    // ── isApkVersionAtLeast（G2 逆向门槛比较） ──

    @Test
    public void versionComparison_semantics() {
        assertTrue(OtaSignatureVerifier.isApkVersionAtLeast("4.21.0", "4.20.0"));
        assertTrue(OtaSignatureVerifier.isApkVersionAtLeast("4.21.0", "4.21.0"));
        assertFalse(OtaSignatureVerifier.isApkVersionAtLeast("4.20.0", "4.21.0"));
        // 数值序而非字典序
        assertFalse(OtaSignatureVerifier.isApkVersionAtLeast("4.9.9", "4.10.0"));
        assertTrue(OtaSignatureVerifier.isApkVersionAtLeast("4.10.0", "4.9.9"));
        // 缺位补 0
        assertTrue(OtaSignatureVerifier.isApkVersionAtLeast("4.21", "4.21.0"));
        // 可选 v 前缀 / 空白
        assertTrue(OtaSignatureVerifier.isApkVersionAtLeast(" v4.21.0 ", "4.20.0"));
        // 脏输入不崩溃（按 0）
        assertFalse(OtaSignatureVerifier.isApkVersionAtLeast("abc", "1.0.0"));
        assertTrue(OtaSignatureVerifier.isApkVersionAtLeast("1.0.0", "abc"));
        // build metadata 忽略
        assertTrue(OtaSignatureVerifier.isApkVersionAtLeast("4.21.0+build1", "4.21.0"));
    }

    // ── 工具 ──

    private static byte[] hex(String hex) {
        int len = hex.length();
        byte[] out = new byte[len / 2];
        for (int i = 0; i < out.length; i++) {
            out[i] = (byte) Integer.parseInt(hex.substring(i * 2, i * 2 + 2), 16);
        }
        return out;
    }

    private static String toB64(byte[] data) {
        return java.util.Base64.getEncoder().encodeToString(data);
    }
}
