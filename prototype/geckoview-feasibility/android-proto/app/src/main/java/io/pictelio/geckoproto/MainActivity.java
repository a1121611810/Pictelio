package io.pictelio.geckoproto;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.widget.FrameLayout;

import androidx.appcompat.app.AppCompatActivity;

import org.json.JSONObject;
import org.mozilla.geckoview.GeckoResult;
import org.mozilla.geckoview.GeckoRuntime;
import org.mozilla.geckoview.GeckoRuntimeSettings;
import org.mozilla.geckoview.GeckoSession;
import org.mozilla.geckoview.GeckoView;
import org.mozilla.geckoview.WebExtension;
import org.mozilla.geckoview.WebExtensionController;

/**
 * GeckoView 宿主（可行性原型，throwaway）。
 *
 * 职责：启动内嵌网关服务器 → GeckoRuntime → Session 加载 SPA → 安装内置 WebExtension
 * （native messaging 桥；扩展内 webRequest 注入是否可用由模拟器实测裁决——
 * GV 155 已无 app 侧 WebRequestDelegate，javap 字节码确认）→ 全程 logcat 打点（GVPROTO）。
 *
 * 签名核对基线：geckoview-arm64-v8a 155.0.20260903215306 classes.jar（javap）。
 *
 * Intent extra：refresh_token（可选）——内容脚本经桥拉取后自动填充登录页。
 */
public class MainActivity extends AppCompatActivity {

    private static final String TAG = "GVPROTO";
    private static final String START_URL = "http://127.0.0.1:" + ProtoServer.PORT + "/";
    private static final String NATIVE_MESSAGING_NAME = "pictelio_proto";

    /** 注入的登录 token（内容脚本经 getToken 桥消息拉取） */
    public static volatile String injectedRefreshToken = "";

    /** NavigationDelegate.onCanGoBack 回调缓存（GV 155 无 session.canGoBack 同步 API） */
    private static volatile boolean sCanGoBack = false;

    private ProtoServer protoServer;
    private GeckoRuntime runtime;
    private GeckoSession session;
    private volatile boolean extReady = false;

    /** 会话启动时刻（冷启动打点基准） */
    private long tOnCreate;

    /** bench 用：intent extra "url" 可覆盖起始 URL（探针页面 ?__probe= / ?__ping=1 / ?__tls=1） */
    private String overrideStartUrl = null;

    private String startUrl() {
        return overrideStartUrl != null ? overrideStartUrl : START_URL;
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        tOnCreate = System.nanoTime();
        Log.i(TAG, "[boot] activity onCreate");

        Intent intent = getIntent();
        if (intent != null) {
            String token = intent.getStringExtra("refresh_token");
            if (token != null && !token.isEmpty()) {
                injectedRefreshToken = token;
            }
            String url = intent.getStringExtra("url");
            if (url != null && !url.isEmpty()) {
                overrideStartUrl = url;
            }
        }

        FrameLayout root = new FrameLayout(this);
        GeckoView geckoView = new GeckoView(this);
        root.addView(geckoView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // 1. 内嵌服务器（先起，loadUri 前必须已监听）
        protoServer = new ProtoServer(getApplicationContext());
        try {
            protoServer.start();
        } catch (Exception e) {
            Log.e(TAG, "[srv] 启动失败", e);
        }

        // 2. GeckoRuntime + Session
        // tuned 口径（intent extra --ez tuned true）：嵌入式场景调参——关 Fission 多内容进程
        // （内存大头）、MSAA 降档、关 consoleOutput（logcat 噪音+开销）。未指定时保持
        // Firefox 浏览器级默认（与首轮测试同口径，便于 A/B）。
        boolean tuned = intent != null && intent.getBooleanExtra("tuned", false);
        GeckoRuntimeSettings.Builder rb = new GeckoRuntimeSettings.Builder()
                .remoteDebuggingEnabled(true)
                .consoleOutput(!tuned)      // 页面/扩展 console → logcat（155 无 ConsoleDelegate）
                .aboutConfigEnabled(true);
        if (tuned) {
            rb.fissionEnabled(false)
                    .glMsaaLevel(0)
                    .debugLogging(false);
            Log.i(TAG, "[boot] TUNED profile: fission=off msaa=0 consoleOutput=off");
        }
        runtime = GeckoRuntime.create(this, rb.build());

        session = new GeckoSession();
        session.open(runtime);
        installDelegates();
        geckoView.setSession(session);

        installExtension();

        waitServerAndLoad(0);
    }

    private void waitServerAndLoad(int attempt) {
        // 双条件：服务器就绪 && 扩展装完（否则内容脚本错过 document_start，页面加载中途
        // 装扩展不会回溯注入——实测首次启动内容脚本全丢）
        if (protoServer != null && protoServer.isReady() && extReady) {
            Log.i(TAG, "[boot] loadUri " + startUrl()
                    + " (t+" + ((System.nanoTime() - tOnCreate) / 1_000_000) + "ms)");
            session.loadUri(startUrl());
            return;
        }
        if (attempt > 200) {
            Log.e(TAG, "[boot] 服务器/扩展始终未就绪，仍尝试加载（extReady=" + extReady + "）");
            session.loadUri(startUrl());
            return;
        }
        new android.os.Handler(android.os.Looper.getMainLooper())
                .postDelayed(() -> waitServerAndLoad(attempt + 1), 10);
    }

    private void installDelegates() {
        session.setProgressDelegate(new GeckoSession.ProgressDelegate() {
            @Override
            public void onPageStart(GeckoSession s, String url) {
                Log.i(TAG, "[page] onPageStart " + url
                        + " (t+" + ((System.nanoTime() - tOnCreate) / 1_000_000) + "ms)");
            }

            @Override
            public void onPageStop(GeckoSession s, boolean success) {
                Log.i(TAG, "[page] onPageStop success=" + success
                        + " (t+" + ((System.nanoTime() - tOnCreate) / 1_000_000) + "ms)");
            }

            @Override
            public void onProgressChange(GeckoSession s, int progress) {
                if (progress == 100) {
                    Log.i(TAG, "[page] onProgressChange 100 (t+"
                            + ((System.nanoTime() - tOnCreate) / 1_000_000) + "ms)");
                }
            }
        });

        session.setContentDelegate(new GeckoSession.ContentDelegate() {
            @Override
            public void onFirstContentfulPaint(GeckoSession s) {
                Log.i(TAG, "[boot] FIRST_CONTENTFUL_PAINT (t+"
                        + ((System.nanoTime() - tOnCreate) / 1_000_000) + "ms)");
            }

            @Override
            public void onTitleChange(GeckoSession s, String title) {
                Log.i(TAG, "[page] title=" + title);
            }

            @Override
            public void onKill(GeckoSession s) {
                Log.w(TAG, "[page] onKill（内容进程被杀）");
            }
        });

        session.setNavigationDelegate(new GeckoSession.NavigationDelegate() {
            @Override
            public void onCanGoBack(GeckoSession s, boolean canGoBack) {
                sCanGoBack = canGoBack;
            }

            @Override
            public void onLocationChange(GeckoSession s, String url,
                                         java.util.List<GeckoSession.PermissionDelegate.ContentPermission> perms,
                                         Boolean hasUserGesture) {
                Log.i(TAG, "[nav] " + url);
            }

            @Override
            public GeckoResult<String> onLoadError(GeckoSession s, String uri,
                                                   org.mozilla.geckoview.WebRequestError error) {
                Log.w(TAG, "[nav] onLoadError uri=" + uri
                        + " category=" + error.category + " code=" + error.code);
                return null;
            }
        });
    }

    // ── WebExtension 安装与消息桥 ──

    private void installExtension() {
        WebExtensionController controller = runtime.getWebExtensionController();
        GeckoResult<WebExtension> result = controller.installBuiltIn(
                "resource://android/assets/gv-ext/");
        result.accept(ext -> {
            if (ext == null) {
                Log.e(TAG, "[ext] install 返回 null");
                return;
            }
            Log.i(TAG, "[ext] installed: " + ext.id);
            ExtBridge bridge = new ExtBridge();
            // 全局级（background 页消息）+ 会话级（内容脚本消息）双注册：
            // 实测内容脚本 sendNativeMessage 只路由到 session 级 delegate
            ext.setMessageDelegate(bridge, NATIVE_MESSAGING_NAME);
            session.getWebExtensionController().setMessageDelegate(ext, bridge, NATIVE_MESSAGING_NAME);
            extReady = true;
        }, e -> Log.e(TAG, "[ext] install 失败", e));
    }

    // ── 生命周期 ──

    @Override
    protected void onResume() {
        super.onResume();
        if (session != null) session.setActive(true);
    }

    @Override
    protected void onPause() {
        if (session != null) session.setActive(false);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (session != null) session.close();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (session != null && sCanGoBack) {
            session.goBack();
        } else {
            super.onBackPressed();
        }
    }

    /**
     * 消息桥（native messaging）：ping RTT 基准 / getToken 登录注入 / log 落 logcat。
     * 内容脚本侧：browser.runtime.sendNativeMessage("pictelio_proto", msg)。
     */
    private static final class ExtBridge implements WebExtension.MessageDelegate {
        @Override
        public GeckoResult<Object> onMessage(String nativeName, Object message,
                                             WebExtension.MessageSender sender) {
            try {
                JSONObject msg = message instanceof JSONObject
                        ? (JSONObject) message
                        : new JSONObject(String.valueOf(message));
                String type = msg.optString("type");
                Log.i(TAG, "[ext] onMessage type=" + type + " env=" + sender.environmentType);
                switch (type) {
                    case "ping": {
                        // 回包用 JSON 字符串：实测 JSONObject 直接 fromValue 回程序列化失败
                        // （15s 后 JS 侧报 "An unexpected error occurred"）
                        JSONObject reply = new JSONObject();
                        reply.put("type", "pong");
                        reply.put("t0", msg.optLong("t0"));
                        reply.put("tNative", System.nanoTime());
                        return GeckoResult.fromValue((Object) reply.toString());
                    }
                    case "getToken": {
                        JSONObject reply = new JSONObject();
                        reply.put("type", "token");
                        String token = injectedRefreshToken;
                        reply.put("token", token != null ? token : "");
                        return GeckoResult.fromValue((Object) reply.toString());
                    }
                    case "log": {
                        Log.i(TAG, "[js] " + msg.optString("msg"));
                        return null; // 不回复
                    }
                    default:
                        Log.w(TAG, "[js] 未知消息类型: " + type);
                        return null;
                }
            } catch (Exception e) {
                Log.e(TAG, "[ext] 消息处理失败", e);
                return null;
            }
        }
    }
}
