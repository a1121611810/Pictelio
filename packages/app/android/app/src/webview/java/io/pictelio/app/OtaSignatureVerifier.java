package io.pictelio.app;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters;
import org.bouncycastle.crypto.signers.Ed25519Signer;

/**
 * OTA web bundle 验签纯函数（#248）：无 Android 依赖，JVM 单测可跑
 * （oracle = RFC 8032 §7.1 官方向量 + Wycheproof ed25519 边界向量 + Node 侧
 * node:crypto 差分互验——见 OtaSignatureVerifierTest）。
 *
 * 签名方案（docs/specs/ota-web-bundle.md「选型与架构」，#242 裁决）：
 * signature = PureEdDSA_Ed25519(DOMAIN_PREFIX || SHA-256(manifest 字节))
 *
 * 选 bcprov lightweight API（Ed25519Signer）而非 java.security：AOSP javadoc 标注
 * Ed25519 "API 33+"，但实测 Android 15 仍抛 NoSuchAlgorithmException（Conscrypt
 * 2025-01 才实现，docs/research/ota-ed25519-android.md §2）——minSdk 28 下捆绑库是必需。
 * lightweight API 不经过 JCA provider 体系，与 Android 内置裁剪版 BC 零冲突。
 */
public final class OtaSignatureVerifier {

    /** 域分隔前缀：把签名唯一绑定到本 OTA 体系，防跨协议签名重用（#242 §5） */
    public static final String DOMAIN_PREFIX = "Pictelio-OTA-bundle-v1\n";

    private OtaSignatureVerifier() {
    }

    /**
     * 通用 Ed25519 验签（PureEdDSA 原语义，消息即被签内容）。
     *
     * @param message   被签消息字节
     * @param signature 64 字节 Ed25519 签名
     * @param publicKey raw 32 字节公钥
     */
    public static boolean verify(byte[] message, byte[] signature, byte[] publicKey) {
        if (publicKey == null || publicKey.length != 32) {
            return false;
        }
        if (signature == null || signature.length != 64) {
            return false;
        }
        try {
            Ed25519Signer verifier = new Ed25519Signer();
            verifier.init(false, new Ed25519PublicKeyParameters(publicKey, 0));
            verifier.update(message, 0, message.length);
            return verifier.verifySignature(signature);
        } catch (RuntimeException e) {
            // 公钥/签名内容非法（非曲线点等）：按验签失败处理，不向上抛
            return false;
        }
    }

    /**
     * OTA manifest 验签（本体系的域分隔 hash-then-sign 语义）。
     * 期望签名 = PureEdDSA(DOMAIN_PREFIX || SHA-256(manifest))。
     *
     * @param manifestBytes manifest JSON 原始字节（发布端签的就是这些字节）
     * @param signature     64 字节签名
     * @param publicKeyB64  raw 32 字节公钥的 base64（BuildConfig 注入口径）
     */
    public static boolean verifyManifest(byte[] manifestBytes, byte[] signature, String publicKeyB64) {
        byte[] pub;
        try {
            pub = java.util.Base64.getDecoder().decode(publicKeyB64);
        } catch (RuntimeException e) {
            return false;
        }
        // 签名对象 = DOMAIN_PREFIX || SHA-256(manifest)（域分隔在 hash 之外，#242 §5）
        byte[] digest = sha256(manifestBytes);
        byte[] message = concat(DOMAIN_PREFIX.getBytes(StandardCharsets.UTF_8), digest);
        return verify(message, signature, pub);
    }

    /** SHA-256 hex 小写（与 manifest.sha256 / Node 侧口径一致） */
    public static String sha256Hex(byte[] data) throws Exception {
        byte[] digest = MessageDigest.getInstance("SHA-256").digest(data);
        StringBuilder sb = new StringBuilder(digest.length * 2);
        for (byte b : digest) {
            sb.append(Character.forDigit((b >> 4) & 0xF, 16));
            sb.append(Character.forDigit(b & 0xF, 16));
        }
        return sb.toString();
    }

    /**
     * 宿主 APK 版本是否满足 bundle 声明的最低要求（G2 逆向门槛判定，纯函数）。
     * 三段数值比较（major.minor.patch）：缺位补 0、非数字段按 0（防御脏输入不崩溃）、
     * 容忍可选 v/V 前缀与首尾空白。语义对齐 packages/update-check 的 isNewer 口径。
     */
    public static boolean isApkVersionAtLeast(String hostVersion, String requiredMinVersion) {
        long[] host = parseParts(hostVersion);
        long[] required = parseParts(requiredMinVersion);
        for (int i = 0; i < 3; i++) {
            if (host[i] < required[i]) {
                return false;
            }
            if (host[i] > required[i]) {
                return true;
            }
        }
        return true; // equal
    }

    private static long[] parseParts(String version) {
        long[] parts = new long[3];
        if (version == null) {
            return parts;
        }
        String core = version.trim().replaceFirst("^[vV]", "");
        // 截掉 build metadata（+ 后缀，与 isNewer 口径一致）
        int plus = core.indexOf('+');
        if (plus >= 0) {
            core = core.substring(0, plus);
        }
        String[] segments = core.split("\\.");
        for (int i = 0; i < Math.min(segments.length, 3); i++) {
            try {
                parts[i] = Long.parseLong(segments[i].trim());
            } catch (NumberFormatException e) {
                parts[i] = 0;
            }
        }
        return parts;
    }

    private static byte[] concat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    private static byte[] sha256(byte[] data) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(data);
        } catch (Exception e) {
            // SHA-256 在所有 JVM 必然存在；包装为非法参数仅为了让方法签名免 checked throws
            throw new IllegalStateException("SHA-256 unavailable", e);
        }
    }
}
