package io.pictelio.app;

import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

import org.junit.Test;

import io.pictelio.app.BackupCrypto.CryptoException;

/**
 * BackupCrypto 单测（spec docs/specs/webdav-backup.md §3.3）。
 * 期望值来源：OWASP Password Storage Cheat Sheet（PBKDF2-HMAC-SHA256 600k 轮
 * 推荐值）与 AES-GCM 标准行为（tag 128bit）——独立来源，非从实现反推。
 */
public class BackupCryptoTest {

    private static final char[] PASSWORD = "correct-horse-battery".toCharArray();
    private static final byte[] PLAINTEXT = "{\"format\":\"pictelio-backup\"}".getBytes();

    @Test
    public void roundtrip_encryptDecrypt() throws Exception {
        byte[] envelope = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        assertArrayEquals(PLAINTEXT, BackupCrypto.decrypt(envelope, PASSWORD));
    }

    @Test
    public void envelope_layout_matchesSpec() throws Exception {
        // 封装布局：magic(8) + salt(16) + iv(12) + ciphertext（含 16B GCM tag）
        byte[] envelope = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        // 布局：magic(13, "PICTELIO-ENC1") + salt(16) + iv(12) + ciphertext(明文长度 + 16B GCM tag)
        assertEquals(BackupCrypto.MAGIC.length + 16 + 12 + PLAINTEXT.length + 16, envelope.length);
        assertEquals(13, BackupCrypto.MAGIC.length); // "PICTELIO-ENC1"，含格式版本
        byte[] magic = BackupCrypto.MAGIC;
        for (int i = 0; i < magic.length; i++) {
            assertEquals(magic[i], envelope[i]);
        }
    }

    @Test
    public void kdf_iterations_meetOwasp2023() throws Exception {
        // OWASP Password Storage Cheat Sheet：PBKDF2-HMAC-SHA256 推荐 ≥ 600k 轮
        assertTrue(BackupCrypto.KDF_ITERATIONS >= 600_000);
        assertEquals(256, BackupCrypto.KEY_BITS);
        assertEquals(128, BackupCrypto.GCM_TAG_BITS);
    }

    @Test
    public void encrypt_twice_producesDifferentEnvelope() throws Exception {
        // 随机 salt/iv：两次加密同一明文不得同密文（nonce 复用会破坏 GCM 安全）
        byte[] a = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        byte[] b = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        org.junit.Assert.assertFalse(java.util.Arrays.equals(a, b));
    }

    @Test
    public void wrongPassword_classified() throws Exception {
        byte[] envelope = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        try {
            BackupCrypto.decrypt(envelope, "wrong-password".toCharArray());
            fail("应抛 CryptoException");
        } catch (CryptoException e) {
            assertEquals("密码错误或文件损坏", e.getMessage());
        }
    }

    @Test
    public void tamperedCiphertext_classified() throws Exception {
        byte[] envelope = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        envelope[envelope.length - 2] ^= 0x01; // 篡改密文区
        try {
            BackupCrypto.decrypt(envelope, PASSWORD);
            fail("应抛 CryptoException");
        } catch (CryptoException e) {
            assertEquals("密码错误或文件损坏", e.getMessage());
        }
    }

    @Test
    public void truncatedEnvelope_rejected() throws Exception {
        byte[] envelope = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        byte[] truncated = java.util.Arrays.copyOf(envelope, envelope.length - 5);
        try {
            BackupCrypto.decrypt(truncated, PASSWORD);
            fail("应抛 CryptoException");
        } catch (CryptoException expected) {
            // magic 匹配但长度不足 → 拒绝
        }
    }

    @Test
    public void wrongMagic_rejected() throws Exception {
        try {
            BackupCrypto.decrypt("{\"not\":\"encrypted\"}".getBytes(), PASSWORD);
            fail("应抛 CryptoException");
        } catch (CryptoException e) {
            assertTrue(e.getMessage().contains("magic"));
        }
    }

    @Test
    public void isEncrypted_detectsMagicOnly() throws Exception {
        byte[] envelope = BackupCrypto.encrypt(PLAINTEXT, PASSWORD);
        assertTrue(BackupCrypto.isEncrypted(envelope));
        assertFalse(BackupCrypto.isEncrypted(PLAINTEXT));
        assertFalse(BackupCrypto.isEncrypted(new byte[0]));
        assertFalse(BackupCrypto.isEncrypted(null));
    }
}
