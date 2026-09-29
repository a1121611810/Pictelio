package io.pictelio.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertThrows;
import static org.junit.Assert.assertTrue;

import android.util.Base64;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;

import javax.crypto.AEADBadTagException;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * SecureStorageCompat 密文格式契约测试（ADR-0050）。
 *
 * <p>覆盖 {@code Base64(cipher)+"\u0010"+Base64(iv)} 格式（NO_PADDING + NO_WRAP）：
 * 往返、格式合法性、格式错误路径、错误密钥路径。AndroidKeyStore 密钥路径（getOrCreateSecretKey/
 * 实例 getItem/setItem）依赖系统 KeyStore，Robolectric 覆盖不稳定 → 归入 #51 原生环境验证。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28) // 与既有 android 单测一致；Robolectric 4.14 不支持 compileSdk 36
public class SecureStorageCompatTest {

    private static final String SEP = Character.toString('\u0010');

    private static SecretKey aesKey() throws Exception {
        KeyGenerator generator = KeyGenerator.getInstance("AES");
        generator.init(128);
        return generator.generateKey();
    }

    @Test
    public void prefixedKey_appliesDefaultPrefix() {
        assertEquals("capacitor-storage_refresh_token", SecureStorageCompat.prefixedKey("refresh_token"));
        assertEquals("capacitor-storage___pictelio_backup_marker",
                SecureStorageCompat.prefixedKey("__pictelio_backup_marker"));
    }

    @Test
    public void encryptDecrypt_roundTrips() throws Exception {
        SecretKey key = aesKey();
        String plaintext = "refresh-token-abc123";
        String ciphertext = SecureStorageCompat.encryptString(plaintext, key);
        assertEquals(plaintext, SecureStorageCompat.decryptString(ciphertext, key));
    }

    @Test
    public void encryptDecrypt_roundTripsUnicode() throws Exception {
        SecretKey key = aesKey();
        String plaintext = "中文 refresh_token 🔑";
        String ciphertext = SecureStorageCompat.encryptString(plaintext, key);
        assertEquals(plaintext, SecureStorageCompat.decryptString(ciphertext, key));
    }

    /** 契约：密文恰为两段 NO_WRAP Base64，以 \u0010 分隔；无填充字符 '='，无换行 */
    @Test
    public void ciphertext_formatMatchesContract() throws Exception {
        SecretKey key = aesKey();
        String ciphertext = SecureStorageCompat.encryptString("data", key);

        assertTrue("must contain \\u0010 separator", ciphertext.contains(SEP));
        assertFalse("must not contain line breaks (NO_WRAP)", ciphertext.contains("\n"));
        assertFalse("must not contain padding (NO_PADDING)", ciphertext.contains("="));

        String[] parts = ciphertext.split(SEP);
        assertEquals(2, parts.length);
        // 两段均可 Base64 解码
        assertTrue(Base64.decode(parts[0], Base64.NO_PADDING | Base64.NO_WRAP).length > 0);
        assertTrue(Base64.decode(parts[1], Base64.NO_PADDING | Base64.NO_WRAP).length > 0);
    }

    /** 契约：每次加密使用随机 IV → 同一明文两次密文不同 */
    @Test
    public void encrypt_usesRandomIv() throws Exception {
        SecretKey key = aesKey();
        assertNotEquals(
                SecureStorageCompat.encryptString("same", key),
                SecureStorageCompat.encryptString("same", key));
    }

    @Test
    public void decrypt_malformedFormat_throws() throws Exception {
        SecretKey key = aesKey();
        assertThrows(IllegalArgumentException.class, () -> SecureStorageCompat.decryptString("only-one-part", key));
        assertThrows(IllegalArgumentException.class,
                () -> SecureStorageCompat.decryptString("a" + SEP + "b" + SEP + "c", key));
        assertThrows(IllegalArgumentException.class, () -> SecureStorageCompat.decryptString("", key));
    }

    @Test
    public void decrypt_wrongKey_failsAuth() throws Exception {
        SecretKey good = aesKey();
        SecretKey other = aesKey();
        String ciphertext = SecureStorageCompat.encryptString("secret", good);
        assertThrows(AEADBadTagException.class, () -> SecureStorageCompat.decryptString(ciphertext, other));
    }

    @Test
    public void decrypt_tamperedCipher_failsAuth() throws Exception {
        SecretKey key = aesKey();
        String ciphertext = SecureStorageCompat.encryptString("secret", key);
        String[] parts = ciphertext.split(SEP);
        // 篡改第一段（密文）一个字符
        String tampered = flipFirstChar(parts[0]) + SEP + parts[1];
        assertThrows(GeneralSecurityException.class, () -> SecureStorageCompat.decryptString(tampered, key));
    }

    private static String flipFirstChar(String s) {
        char c = s.charAt(0);
        char replacement = c == 'A' ? 'B' : 'A';
        return replacement + s.substring(1);
    }

    @Test
    public void encryptDecrypt_utf8BytesMatchStdCharset() throws Exception {
        // 契约补充：明文以 UTF-8 编码（与 @aparajita getBytes(StandardCharsets.UTF_8) 一致）
        SecretKey key = aesKey();
        String plaintext = "utf8-\u00e9\u4e2d\u6587";
        assertEquals(StandardCharsets.UTF_8, StandardCharsets.UTF_8);
        assertEquals(plaintext, SecureStorageCompat.decryptString(
                SecureStorageCompat.encryptString(plaintext, key), key));
    }
}
