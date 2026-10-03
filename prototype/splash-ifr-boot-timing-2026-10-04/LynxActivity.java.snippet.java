// PROTOTYPE / THROWAWAY —— 原生分段计时探针（2026-10-04 原型，测完即删）
//
// 贴进 packages/android-host/android/app/src/lynx/java/io/pictelio/app/LynxActivity.java。
// 这是本原型**唯一实际生效**的判据通道（JS LoadBundleEntry 那条是死的）。
//
// 为什么 FIRST_DRAW 用 ViewTreeObserver 而不是 Lynx 回调：
//   LynxViewClient 的 onLoadSuccess / onFirstScreen 都是**派发顺序可读、
//   墙钟间隔不可读**（两者都由 C++ 触发，Java 字节码只给得出顺序）——
//   这也是本原型一开始踩的坑。OnDrawListener 是「绘制真正发生」的独立信号。
//
// ⚠️ 曾经据此得出「首帧不被 splash gate、押到首帧再撤可行」的结论，**是错的**：
//    OnDrawListener 在 splash 压着时**根本不触发**（实测延迟 10,085ms，
//    等 10s 超时把 splash 撤掉它才触发）。详见 README「死锁实验」。

private static final String PROTO_TAG = "PICO_PROTO";
private static long protoT0 = 0;
private static final java.util.concurrent.atomic.AtomicBoolean protoFirstDrawSeen =
        new java.util.concurrent.atomic.AtomicBoolean(false);
private final android.view.ViewTreeObserver.OnDrawListener mDrawListener =
        new android.view.ViewTreeObserver.OnDrawListener() {
            @Override
            public void onDraw() {
                if (protoFirstDrawSeen.compareAndSet(false, true)) {
                    proto("lynxView_FIRST_DRAW");
                }
            }
        };

static void proto(String event) {
    long t = android.os.SystemClock.uptimeMillis();
    Log.i(PROTO_TAG, "EVENT " + event + " @" + (protoT0 == 0 ? -1 : t - protoT0)
            + "ms uptime=" + t);
}

// ── onCreate 入口 ────────────────────────────────────────────────
if (protoT0 == 0) protoT0 = android.os.SystemClock.uptimeMillis();
proto("onCreate_enter sdk=" + android.os.Build.VERSION.SDK_INT);

// ── setContentView(lynxView) 之后 ───────────────────────────────
if (!protoFirstDrawSeen.get()) {
    lynxView.getViewTreeObserver().addOnDrawListener(mDrawListener);
}
proto("setContentView_done");

// ── LynxViewClient.onLoadSuccess ────────────────────────────────
proto("onLoadSuccess");

// ── renderTemplateUrl 前后 ──────────────────────────────────────
proto("renderTemplateUrl_CALL");
lynxView.renderTemplateUrl("main.lynx.bundle", "");
proto("renderTemplateUrl_RETURN");

// ── PictelioTemplateProvider.loadTemplate 内（证明在主线程）──────
long t0 = android.os.SystemClock.uptimeMillis();
LynxActivity.proto("templateProvider_ENTER thread=" + Thread.currentThread().getName());
// ... 原有读取逻辑 ...
LynxActivity.proto("templateProvider_READ_DONE bytes=" + bytes.length
        + " cost=" + (android.os.SystemClock.uptimeMillis() - t0) + "ms");
