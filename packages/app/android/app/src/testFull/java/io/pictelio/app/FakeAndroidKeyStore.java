package io.pictelio.app;

import android.content.Context;

import org.robolectric.RuntimeEnvironment;

import java.security.Key;
import java.security.KeyStore;
import java.security.Provider;
import java.security.Security;
import java.util.Collections;
import java.util.Enumeration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;

/**
 * 假 {@code AndroidKeyStore} provider —— PictelioTranslate 系列 Robolectric 单测的**唯一**密钥存储夹具。
 *
 * <p><b>为什么必须是全 JVM 唯一的同一个类</b>（这是本 fixture 存在的全部理由，别拆回每类一份）：
 * <ol>
 *   <li>{@link java.security.Security} 由引导类加载器加载，provider 注册表是 **JVM 全局**的，
 *       跨 Robolectric 测试类持久（Robolectric 不重置它）；</li>
 *   <li>{@link Security#addProvider} 对**同名** provider 是**幂等空操作**（返回 -1，不替换）——
 *       实测：{@code addProvider(p1)} → 位置号；{@code addProvider(p2)}（同名同版本）→ {@code -1}，
 *       且 {@code get("KeyStore.AndroidKeyStore")} 仍是 p1 的类名；</li>
 *   <li>因此若每个测试类各自注册自己的 {@code KeyStoreSpi} 内部类，**只有第一个注册的类**会被真正
 *       绑定；后续类把密钥写进自己的（已成孤儿的）静态 map，而 {@code KeyStore.getInstance("AndroidKeyStore")}
 *       取到的是**前一个类**的 map —— 同名 alias（生产 alias 只有一个）返回前一类留下的**旧密钥**，
 *       与刚写入的密文不配对 → {@code SecureStorageCompat.getItem} 抛 GCM 校验异常
 *       （{@code AEADBadTagException}）→ {@code translateStream} 在请求构造段抛出 → 只回调
 *       {@code "请求构造失败：…"} 而不登记终态 → 测试一直轮询到 30s 超时判定失败。
 *       即 issue #657 的 Robolectric 跨类污染（S1）。</li>
 * </ol>
 *
 * <p>单一类 + 单次注册后，先跑哪个测试类都不改变绑定，密钥与密文天然配对。
 *
 * <p><b>注册顺序守卫</b>：若同名 provider 已被**别的**类抢注（未来的新夹具 / 直接调
 * {@code Security.addProvider} 的测试），本夹具的密钥存储不再生效，此时**显式抛错**而不是让调用方
 * 静默跑到 30s 超时（AGENTS.md 测试硬约束 #3「禁止静默降级」）。
 *
 * <p>生命周期：进程级安装一次，不卸载（{@code @AfterClass} 卸载会让后续类回到「无 provider」状态，
 * 反而引入顺序依赖）。
 */
public final class FakeAndroidKeyStore {

    /** provider 名：必须与 {@code SecureStorageCompat} 的 {@code KeyStore.getInstance(ANDROID_KEY_STORE)} 同名 */
    static final String PROVIDER_NAME = "AndroidKeyStore";

    /** 生产 alias（{@code SecureStorageCompat.PREFIX + key}），与 {@code PictelioTranslateModule.KEY_API_KEY} 对齐 */
    private static final String KEY_ALIAS = SecureStorageCompat.PREFIX + "translate_llm_api_key";

    private static final Map<String, Key> KEYS = new ConcurrentHashMap<>();

    private FakeAndroidKeyStore() {
    }

    /**
     * 安装假 provider（幂等）。若同名 provider 已由**别的类**注册，抛 {@link IllegalStateException}
     * —— 那意味着本夹具失效，继续跑只会得到顺序相关的假红/假绿。
     */
    public static synchronized void install() {
        Provider existing = Security.getProvider(PROVIDER_NAME);
        if (existing != null) {
            String bound = String.valueOf(existing.get("KeyStore." + PROVIDER_NAME));
            if (!Spi.class.getName().equals(bound)) {
                throw new IllegalStateException(
                        "AndroidKeyStore provider 已被 " + bound + " 抢先注册（JVM 全局注册表同名不可替换）"
                                + " → 本夹具不会生效；请让该测试类改用 FakeAndroidKeyStore");
            }
            return;
        }
        Security.addProvider(new Provider(PROVIDER_NAME, 1.0d, "Pictelio 单测假 AndroidKeyStore") {
            {
                put("KeyStore." + PROVIDER_NAME, Spi.class.getName());
            }
        });
    }

    /**
     * 写入「alias → 新生成的 AES-128 密钥」+ 对应的加密密文到生产 SharedPreferences 文件。
     *
     * <p>密钥每次调用都重新生成：与 {@code @Before} 每次执行配对，避免复用上一轮的密钥/密文组合。
     */
    public static void seed(String plaintext) throws Exception {
        install();
        Context app = RuntimeEnvironment.getApplication();
        KeyGenerator gen = KeyGenerator.getInstance("AES");
        gen.init(128);
        SecretKey key = gen.generateKey();
        KEYS.put(KEY_ALIAS, key);
        app.getSharedPreferences(SecureStorageCompat.PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .putString(KEY_ALIAS, SecureStorageCompat.encryptString(plaintext, key))
                .commit();
    }

    /**
     * KeyStoreSpi 实现（**唯一**一份，见类注释第 3 条）。
     *
     * <p>只实现生产路径用到的能力：{@code engineGetEntry} / {@code engineContainsAlias} /
     * {@code engineDeleteEntry} / {@code engineSetKeyEntry(Key, char[], Certificate[])}
     * （{@code SecureStorageCompat} 走 {@code getEntry} + {@code deleteEntry}；
     * 写入路径由测试直接注入密钥，不走 KeyStore）。
     */
    public static final class Spi extends java.security.KeyStoreSpi {

        @Override
        public Key engineGetKey(String alias, char[] password) {
            return KEYS.get(alias);
        }

        @Override
        public KeyStore.Entry engineGetEntry(String alias, KeyStore.ProtectionParameter param) {
            Key k = KEYS.get(alias);
            return k == null ? null : new KeyStore.SecretKeyEntry((SecretKey) k);
        }

        @Override
        public boolean engineContainsAlias(String alias) {
            return KEYS.containsKey(alias);
        }

        @Override
        public Enumeration<String> engineAliases() {
            return Collections.enumeration(KEYS.keySet());
        }

        @Override
        public int engineSize() {
            return KEYS.size();
        }

        @Override
        public boolean engineIsKeyEntry(String alias) {
            return KEYS.containsKey(alias);
        }

        @Override
        public boolean engineIsCertificateEntry(String alias) {
            return false;
        }

        @Override
        public java.util.Date engineGetCreationDate(String alias) {
            return null;
        }

        @Override
        public String engineGetCertificateAlias(java.security.cert.Certificate cert) {
            return null;
        }

        @Override
        public void engineDeleteEntry(String alias) {
            KEYS.remove(alias);
        }

        @Override
        public void engineStore(java.io.OutputStream out, char[] password) {
        }

        @Override
        public void engineLoad(java.io.InputStream in, char[] password) {
        }

        @Override
        public java.security.cert.Certificate engineGetCertificate(String alias) {
            return null;
        }

        @Override
        public java.security.cert.Certificate[] engineGetCertificateChain(String alias) {
            return null;
        }

        @Override
        public void engineSetKeyEntry(String alias, byte[] key, java.security.cert.Certificate[] chain) {
        }

        @Override
        public void engineSetKeyEntry(
                String alias, Key key, char[] password, java.security.cert.Certificate[] chain) {
            KEYS.put(alias, key);
        }

        @Override
        public void engineSetCertificateEntry(String alias, java.security.cert.Certificate cert) {
        }
    }
}
