package io.pictelio.app;

import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.security.spec.KeySpec;
import java.util.Arrays;

import javax.crypto.Cipher;
import javax.crypto.SecretKey;
import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.PBEKeySpec;
import javax.crypto.spec.SecretKeySpec;

/**
 * 备份加密封装 v1（ADR-0156 D3：Java 侧实现，双引擎共用）。
 *
 * <p>格式（spec docs/specs/webdav-backup.md §3.3）：
 * <pre>
 *   | "PICTELIO-ENC1" (13B) | salt (16B) | iv (12B) | AES-256-GCM 密文（含 16B tag） |
 * </pre>
 * 密钥 = PBKDF2-HMAC-SHA256（600k 轮，OWASP 2023 推荐值，见
 * cheatsheetseries.owasp.org Password_Storage_Cheat_Sheet #pbkdf2）从用户密码派生。
 *
 * <p>Java 侧而非 TS 的理由：SecureStorageCompat 已有 AES/GCM 先例；Lynx JS runtime
 * 的 crypto.subtle 可用性不做假设；单一实现双引擎行为必然一致。
 *
 * <p>密码错误 / 密文损坏统一抛 {@link CryptoException}（kind=BAD_PASSWORD_OR_CORRUPT），
 * 由调用层映射为用户文案「密码错误或文件损坏」（spec §6）。
 */
public class BackupCrypto {

    /** 封装头魔数（13 字节："PICTELIO-ENC1"，格式版本内嵌于 magic） */
    public static final byte[] MAGIC = "PICTELIO-ENC1".getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    public static final int SALT_LENGTH = 16;
    public static final int IV_LENGTH = 12;
    public static final int KDF_ITERATIONS = 600_000;
    public static final int KEY_BITS = 256;
    public static final int GCM_TAG_BITS = 128;

    private static final String KDF = "PBKDF2WithHmacSHA256";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final SecureRandom RANDOM = new SecureRandom();

    /** 解密失败分类：密码错误与文件损坏对调用方同义（均需用户重输密码或换档） */
    public static class CryptoException extends Exception {
        public CryptoException(String message) {
            super(message);
        }
    }

    /** 加密：明文 → 封装字节 */
    public static byte[] encrypt(byte[] plaintext, char[] password) throws CryptoException {
        try {
            byte[] salt = new byte[SALT_LENGTH];
            byte[] iv = new byte[IV_LENGTH];
            RANDOM.nextBytes(salt);
            RANDOM.nextBytes(iv);

            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.ENCRYPT_MODE, deriveKey(password, salt), new GCMParameterSpec(GCM_TAG_BITS, iv));
            byte[] ciphertext = cipher.doFinal(plaintext);

            byte[] out = new byte[MAGIC.length + SALT_LENGTH + IV_LENGTH + ciphertext.length];
            System.arraycopy(MAGIC, 0, out, 0, MAGIC.length);
            System.arraycopy(salt, 0, out, MAGIC.length, SALT_LENGTH);
            System.arraycopy(iv, 0, out, MAGIC.length + SALT_LENGTH, IV_LENGTH);
            System.arraycopy(ciphertext, 0, out, MAGIC.length + SALT_LENGTH + IV_LENGTH, ciphertext.length);
            return out;
        } catch (GeneralSecurityException e) {
            throw new CryptoException("加密失败: " + e.getMessage());
        }
    }

    /** 解密：封装字节 → 明文；密码错误或文件损坏抛 {@link CryptoException} */
    public static byte[] decrypt(byte[] envelope, char[] password) throws CryptoException {
        if (!hasMagic(envelope)) {
            throw new CryptoException("不是 Pictelio 加密备份（magic 不匹配）");
        }
        int minLength = MAGIC.length + SALT_LENGTH + IV_LENGTH + (GCM_TAG_BITS / 8);
        if (envelope.length < minLength) {
            throw new CryptoException("加密备份长度不完整");
        }
        byte[] salt = Arrays.copyOfRange(envelope, MAGIC.length, MAGIC.length + SALT_LENGTH);
        byte[] iv = Arrays.copyOfRange(envelope, MAGIC.length + SALT_LENGTH, MAGIC.length + SALT_LENGTH + IV_LENGTH);
        byte[] ciphertext = Arrays.copyOfRange(envelope, MAGIC.length + SALT_LENGTH + IV_LENGTH, envelope.length);
        try {
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.DECRYPT_MODE, deriveKey(password, salt), new GCMParameterSpec(GCM_TAG_BITS, iv));
            return cipher.doFinal(ciphertext);
        } catch (GeneralSecurityException e) {
            // AEADBadTagException（密码错）与 pad/tamper（文件损坏）统一归类
            throw new CryptoException("密码错误或文件损坏");
        }
    }

    /** 快速判定字节流是否为 Pictelio 加密备份（选档列表锁形标识用） */
    public static boolean isEncrypted(byte[] data) {
        return hasMagic(data);
    }

    private static boolean hasMagic(byte[] data) {
        if (data == null || data.length < MAGIC.length) return false;
        for (int i = 0; i < MAGIC.length; i++) {
            if (data[i] != MAGIC[i]) return false;
        }
        return true;
    }

    private static SecretKey deriveKey(char[] password, byte[] salt) throws GeneralSecurityException {
        SecretKeyFactory factory = SecretKeyFactory.getInstance(KDF);
        KeySpec spec = new PBEKeySpec(password, salt, KDF_ITERATIONS, KEY_BITS);
        byte[] keyBytes = factory.generateSecret(spec).getEncoded();
        return new SecretKeySpec(keyBytes, "AES");
    }
}
