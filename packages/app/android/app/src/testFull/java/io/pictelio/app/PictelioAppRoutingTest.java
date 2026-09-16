package io.pictelio.app;

import static org.junit.Assert.assertEquals;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;

import androidx.test.core.app.ApplicationProvider;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

import io.pictelio.app.engine.EnginePrefs;

/**
 * PictelioApp 预热 × 引擎路由集成测试（Robolectric，ADR-0164 决策 3：预热与
 * MainActivity 路由共用 {@link io.pictelio.app.engine.EngineRouting#resolve}，
 * 每次 onCreate 发布生效状态快照——「预热与路由不再各读一次键」的唯一集成事实）。
 *
 * <p>oracle 溯源：快照格式 = spec §3（{@code preferred=<kind> effective=<kind|none>
 * reason=<code>}）；矩阵落点 = spec §4。Robolectric 环境与真机的落点差异（确定性，非时序）：
 * <ul>
 *   <li>真机：Lynx native 库可加载 → 缺省（无键）落 S1（effective=lynx reason=preferred）；</li>
 *   <li>Robolectric：liblynx.so 无法加载 → {@code LynxEnv.isNativeLibraryLoaded()}==false
 *       → L=false；W 经 {@code WebViewAvailability} fail-open（探测失败放行）=true
 *       → 落 <strong>S2</strong>（effective=webview reason=lynx_unavailable）。</li>
 * </ul>
 *
 * <p>执行方式：每个用例先显式设置 prefs，再手动调用 {@code app.onCreate()} 重新执行
 * 路由（onCreate 幂等：resolve 覆写快照、预热可重复），不依赖 Robolectric bootstrap
 * 与 @Before 的先后顺序（@Config application 在 @Before 之前创建，手动重跑消除时序耦合）。
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 28, application = PictelioApp.class)
public class PictelioAppRoutingTest {

    private Application app() {
        return ApplicationProvider.getApplicationContext();
    }

    private SharedPreferences prefs() {
        return app().getSharedPreferences(EnginePrefs.PREFS_FILE, Context.MODE_PRIVATE);
    }

    @Test
    public void onCreate_defaultPrefs_publishesS2Snapshot_underRobolectric() {
        // 缺省（无键 = 从未显式选择，ADR-0164 决策 1）：preferred 归一化为 lynx；
        // Robolectric 下 Lynx native 不可加载 → S2 预检降级（真机等价落点为 S1，
        // 见类注释）。清空保证自足（不依赖前序用例/沙箱残留）。
        prefs().edit().clear().commit();
        app().onCreate();

        assertEquals("preferred=lynx effective=webview reason=lynx_unavailable",
                prefs().getString(EnginePrefs.KEY_STATE, null));
    }

    @Test
    public void onCreate_seededWebview_publishesS9Snapshot() {
        // E1：显式 webview → S9 首选 webview 照旧（不探 L，真机/Robolectric 同落点）。
        prefs().edit().clear().commit();
        prefs().edit().putString(EnginePrefs.KEY_PREFERRED_KIND, "webview").commit();
        app().onCreate();

        assertEquals("preferred=webview effective=webview reason=preferred",
                prefs().getString(EnginePrefs.KEY_STATE, null));
    }
}
