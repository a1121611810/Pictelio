package io.pictelio.app;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.KeyStore;
import java.security.KeyStore.SecretKeyEntry;
import java.security.spec.AlgorithmParameterSpec;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * refresh_token 加密存储核心 —— 逐字段对齐 {@code @aparajita/capacitor-secure-storage}
 * （ADR-0050 契约），保证 lynx client 与 webview client 登录态共享。
 *
 * 契约（与 SecureStorage.java v8.0.0 一致，勿改）：
 * <ul>
 *   <li>AES/GCM/NoPadding，AndroidKeyStore，alias = prefixedKey（每 key 独立 AES 密钥，
 *       PURPOSE_ENCRYPT|DECRYPT + BLOCK_MODE_GCM + ENCRYPTION_PADDING_NONE）</li>
 *   <li>SharedPreferences 文件 {@code "WSSecureStorageSharedPreferences"}（MODE_PRIVATE）</li>
 *   <li>存储 key {@code "capacitor-storage_" + key} → 本项目 {@code "capacitor-storage_refresh_token"}</li>
 *   <li>密文格式 {@code Base64(ciphertext) + "\u0010" + Base64(iv)}（NO_PADDING + NO_WRAP）</li>
 * </ul>
 */
public class SecureStorageCompat {

    public static final String PREFIX = "capacitor-storage_";
    public static final String PREFS_NAME = "WSSecureStorageSharedPreferences";

    private static final String ANDROID_KEY_STORE = "AndroidKeyStore";
    private static final String CIPHER_TRANSFORMATION = "AES/GCM/NoPadding";
    private static final char DATA_IV_SEPARATOR = '\u0010';
    private static final int BASE64_FLAGS = Base64.NO_PADDING + Base64.NO_WRAP;

    private final Context context;
    private KeyStore keyStore;

    public SecureStorageCompat(Context context) {
        this.context = context;
    }

    /** JS 端 key → 存储/密钥 alias：{@code "capacitor-storage_" + key} */
    public static String prefixedKey(String key) {
        return PREFIX + key;
    }

    // ── 密文格式（静态、密钥注入 → JVM/Robolectric 可单测） ──

    /** {@code Base64(ciphertext) + "\u0010" + Base64(iv)}，对齐 @aparajita encryptString */
    public static String encryptString(String plaintext, SecretKey secretKey)
            throws GeneralSecurityException {
        Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, secretKey);
        byte[] iv = cipher.getIV();
        byte[] encrypted = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(encrypted, BASE64_FLAGS)
                + DATA_IV_SEPARATOR
                + Base64.encodeToString(iv, BASE64_FLAGS);
    }

    /**
     * 解密 {@link #encryptString} 产物；密文格式非法（非两段）抛 {@link IllegalArgumentException}
     * （对应 @aparajita invalidData），GCM 认证失败抛 {@code GeneralSecurityException}。
     */
    public static String decryptString(String ciphertext, SecretKey secretKey)
            throws GeneralSecurityException {
        String[] parts = ciphertext.split(Character.toString(DATA_IV_SEPARATOR));
        if (parts.length != 2) {
            throw new IllegalArgumentException(
                    "invalid ciphertext format: expected 2 parts separated by \\u0010, got " + parts.length);
        }
        byte[] encrypted = Base64.decode(parts[0], BASE64_FLAGS);
        byte[] iv = Base64.decode(parts[1], BASE64_FLAGS);
        Cipher cipher = Cipher.getInstance(CIPHER_TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, secretKey, new GCMParameterSpec(128, iv));
        return new String(cipher.doFinal(encrypted), StandardCharsets.UTF_8);
    }

    // ── AndroidKeyStore 密钥管理（生产路径，原生环境验证） ──

    /** 获取或生成 prefixedKey 的独立 AES 密钥，对齐 @aparajita getSecretKey */
    public SecretKey getOrCreateSecretKey(String prefixedKey) throws GeneralSecurityException, IOException {
        KeyStore ks = getKeyStore();
        SecretKeyEntry entry;
        try {
            entry = (SecretKeyEntry) ks.getEntry(prefixedKey, null);
        } catch (java.security.UnrecoverableKeyException e) {
            entry = null; // 密钥失效（备份还原场景）→ 重新生成
        }
        if (entry == null) {
            KeyGenerator generator = KeyGenerator.getInstance("AES", ANDROID_KEY_STORE);
            AlgorithmParameterSpec spec = new KeyGenParameterSpec.Builder(
                    prefixedKey,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .build();
            generator.init(spec);
            return generator.generateKey();
        }
        return entry.getSecretKey();
    }

    private KeyStore getKeyStore() throws GeneralSecurityException, IOException {
        if (keyStore == null) {
            keyStore = KeyStore.getInstance(ANDROID_KEY_STORE);
            keyStore.load(null);
        }
        return keyStore;
    }

    private SharedPreferences getPrefs() {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    // ── 实例 API（LynxModule 调用） ──

    /** 加密并写入（apply 异步落盘，与 @aparajita 一致） */
    public void setItem(String key, String data) throws GeneralSecurityException, IOException {
        String pk = prefixedKey(key);
        getPrefs().edit().putString(pk, encryptString(data, getOrCreateSecretKey(pk))).apply();
    }

    /** 返回明文；无值或密钥条目不存在返回 null（对齐 @aparajita） */
    public String getItem(String key) throws GeneralSecurityException, IOException {
        String pk = prefixedKey(key);
        String raw = getPrefs().getString(pk, null);
        if (raw == null) {
            return null;
        }
        SecretKeyEntry entry = (SecretKeyEntry) getKeyStore().getEntry(pk, null);
        if (entry == null) {
            return null;
        }
        return decryptString(raw, entry.getSecretKey());
    }

    /** 删除密钥条目与密文；返回是否确有删除（对齐 @aparajita removeAlias） */
    public boolean removeItem(String key) throws GeneralSecurityException, IOException {
        String pk = prefixedKey(key);
        KeyStore ks = getKeyStore();
        if (ks.containsAlias(pk)) {
            ks.deleteEntry(pk);
            getPrefs().edit().remove(pk).apply();
            return true;
        }
        return false;
    }
}
