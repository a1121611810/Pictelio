package io.pictelio.app;

import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.lynx.tasm.LynxView;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * 运行时 UI 树导出（T0 最小验证；spec {@code docs/specs/app-lynx-ui-tree-dump-t0.md}）。
 *
 * <p><b>这条通道解决什么</b>：本仓在模拟器/真机上<b>拿不到</b>运行时 UI 节点树——
 * Lynx 4.0.1 不暴露无障碍树节点（全仓 199 处 {@code accessibility-element} 标注也不出节点），
 * {@code uiautomator dump} 在 {@code pictelio_ui} 上必被 SIGKILL（exit 137）。
 * 于是三处 e2e spec（{@code transition-matrix} / {@code fab-hit-testing-regression} /
 * {@code lynx-bookmark-tags}）只能整体退到截图 + 像素分析。引擎自带的
 * {@code getLynxElementRoot} + {@code toJSONString} 是一条绕开 a11y 树与 uiautomator 的
 * <b>第三条观测通道</b>，本仓此前从未接线。
 *
 * <p><b>能力边界（不要误期待）</b>：拿不到<b>源码位置</b>。官方 UI source map 的构建期打标
 * （{@code enableUiSourceMap}）是 <b>React-only</b>——该开关只存在于
 * {@code @lynx-js/react-rsbuild-plugin}，打标端是 {@code @lynx-js/react} 的 React-JSX 专用
 * SWC 插件；vue-lynx 无等价实现，其 main-thread 变换不保留任何位置信息。
 * ⇒ 本通道只给「结构 + 几何 + 事件」，不给「这个节点来自哪个 .vue」。
 *
 * <p><b>门禁</b>：整段以 {@code BuildConfig.DEBUG} 包裹。release 变体里该字段是字面量
 * {@code false}（常量表达式 → javac 内联）⇒ 分支恒 false、整块成死代码、被 R8 移除，
 * 生产 APK 不含任何导出能力（与 ADR-0136 benchNav / {@code pictelio_dev_*} 通道同范式）。
 *
 * <p><b>时机</b>：<b>不做</b>「等 JS 侧首载落定」——落定是逐页面属性（12 个页面/组件各自持有
 * {@code settled}，仓库无全局汇聚点），做成中央层需 12 处改动，超出本票边界。改为
 * <b>连拍多份</b>（见 {@link #SAMPLE_DELAYS_MS}）：一次触发在三个时刻各抓一份，
 * 由人挑那份「渲染完整」的。间隔取自仓库既有的「四次投递 1.5/3/4.5/6s」防挂载竞态思路
 * （ADR-0136 / ADR-0220）——{@code onLoadSuccess} 时 JS 未必渲染完，早拍会拿到空树或半棵树。
 */
final class UiTreeDump {

    private static final String TAG = "UiTreeDump";

    /** intent extra 键：值为非空串即触发（与 benchNav 的 extra 风格一致）。 */
    static final String EXTRA_TRIGGER = "uiTreeDump";

    /** 落盘子目录名（应用专属外部目录内）。 */
    static final String DIR_NAME = "ui-tree";

    /**
     * 连拍间隔（ms）：同一触发在这些时刻各抓一份。
     *
     * <p>为什么不是「只拍一张」：引擎回调到达时页面可能还在骨架态——拍到的树少了内容，
     * 而「少了内容」恰好是要诊断的现象本身，早拍会把它误当成结论。拍多份把「时机」
     * 变成可挑的，而不是猜的。
     */
    static final long[] SAMPLE_DELAYS_MS = {0L, 1500L, 4000L};

    /**
     * 写盘 I/O 线程池。
     *
     * <p>为什么必须有：官方文档明确「两个 callback 都会回调到 UI 线程（主线程）」，
     * 且 UI 线程上序列化大树本身已有卡顿风险；落盘是几 MB 的阻塞写，绝不能占 UI 线程。
     */
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    /** 进程内递增序号：文件名不互相覆盖（同毫秒多次触发也不撞）。 */
    private static final AtomicInteger SEQ = new AtomicInteger();

    private UiTreeDump() {}

    /**
     * 触发判定（纯函数，无 Android 依赖 ⇒ 可直接 JVM 单测）。
     *
     * @param debugBuild 构建类型闸门（调用方传 {@code BuildConfig.DEBUG}）
     * @param triggerValue intent extra 的原始值（{@code null} 表示 extra 不存在）
     * @return 是否应当抓取
     */
    static boolean shouldDump(boolean debugBuild, String triggerValue) {
        if (!debugBuild) return false; // release 恒 false：整块成死代码，被 R8 移除
        return triggerValue != null && !triggerValue.isEmpty();
    }

    /**
     * 入口：判定是否该抓 → 安排连拍。
     *
     * <p>触发点有两处（都在 {@code LynxActivity}）：冷启动的 {@code onLoadSuccess}、
     * 热启动的 {@code onNewIntent}。后者是本通道的主要用法——「App 已在跑时再拍一张」，
     * 也让人自己掌握拍树时机（自动等落定的替代品）。
     *
     * @param debugBuild 构建类型闸门（调用方传 {@code BuildConfig.DEBUG}）
     */
    static void scheduleIfRequested(Context context, LynxView lynxView, Intent intent, boolean debugBuild) {
        String trigger = (intent == null) ? null : intent.getStringExtra(EXTRA_TRIGGER);
        if (!shouldDump(debugBuild, trigger)) return; // 未请求 ⇒ 静默（正常路径，不是降级）
        if (lynxView == null) {
            // 请求到了但没有可抓的视图：显式告警（区分「没触发」与「触发了但失败」）
            Log.w(TAG, "UI 树抓取请求已受理，但 LynxView 未就绪（跳过本次抓取）");
            return;
        }
        Log.i(TAG, "UI 树抓取请求已受理，连拍 " + SAMPLE_DELAYS_MS.length + " 份（间隔 " + java.util.Arrays.toString(SAMPLE_DELAYS_MS) + " ms）");
        for (long delay : SAMPLE_DELAYS_MS) {
            new Handler(Looper.getMainLooper()).postDelayed(() -> capture(context, lynxView, delay), delay);
        }
    }

    /**
     * 抓一棵树。
     *
     * <p>两条失败路径<b>分开</b>报错，不合并成一句「失败」：根元素为 null（视图没渲染出根）
     * 与序列化为 null（引擎侧没给出内容）是不同的故障面，合并会让人无法定位。
     */
    private static void capture(Context context, LynxView lynxView, long delayMs) {
        final long t0 = System.currentTimeMillis();
        try {
            lynxView.getLynxElementRoot(root -> {
                if (root == null) {
                    Log.w(TAG, "UI 树抓取失败（延迟 " + delayMs + "ms）：getLynxElementRoot 回调根元素为 null");
                    return;
                }
                root.toJSONString(json -> {
                    if (json == null) {
                        Log.w(TAG, "UI 树抓取失败（延迟 " + delayMs + "ms）：toJSONString 回调为 null");
                        return;
                    }
                    final long elapsed = System.currentTimeMillis() - t0;
                    persist(context, json, delayMs, elapsed);
                });
            });
        } catch (Throwable t) {
            Log.w(TAG, "UI 树抓取异常（延迟 " + delayMs + "ms）", t);
        }
    }

    /** 落盘（移交 I/O 线程：引擎回调在 UI 线程，几 MB 写盘不能占 UI 线程）。 */
    private static void persist(Context context, String json, long delayMs, long elapsedMs) {
        IO.execute(() -> {
            try {
                File dir = resolveOutputDir(context);
                if (dir == null) {
                    Log.w(TAG, "UI 树落盘失败：getExternalFilesDir 返回 null（无可用外部存储）");
                    return;
                }
                if (!dir.exists() && !dir.mkdirs()) {
                    Log.w(TAG, "UI 树落盘失败：目录创建失败 " + dir.getAbsolutePath());
                    return;
                }
                File target = new File(dir, fileName(SEQ.incrementAndGet(), System.currentTimeMillis()));
                writeAtomically(target, json);
                Log.i(TAG, "UI 树已落盘 " + target.getName()
                        + " 字节=" + target.length()
                        + " 序列化耗时=" + elapsedMs + "ms"
                        + " 采样延迟=" + delayMs + "ms"
                        + " 路径=" + target.getAbsolutePath());
            } catch (Throwable t) {
                Log.w(TAG, "UI 树落盘异常", t);
            }
        });
    }

    /**
     * 落盘根目录：应用专属外部目录下的 {@code ui-tree/}。
     *
     * <p>为什么不用 app 私有目录：私有目录要 {@code run-as} 才能读（仅 debug 包），
     * 真机取证不便；专属外部目录 {@code adb pull} 直接可拉，且随应用卸载自动清理。
     */
    static File resolveOutputDir(Context context) {
        File base = context.getExternalFilesDir(null);
        return base == null ? null : new File(base, DIR_NAME);
    }

    /** 文件名：序号 + 时间戳 ⇒ 多次触发不覆盖。 */
    static String fileName(int seq, long timestampMillis) {
        return "ui-tree-" + seq + "-" + timestampMillis + ".json";
    }

    /**
     * 原子写：先写临时文件再 rename。
     *
     * <p>为什么：{@code adb pull} 可能与写盘并发，rename 之前的目标文件是不完整的
     * ⇒ 拉回半截 JSON。rename 在同一目录内是原子的。
     */
    static void writeAtomically(File target, String content) throws IOException {
        File tmp = new File(target.getParentFile(), target.getName() + ".tmp");
        try (OutputStream out = new FileOutputStream(tmp)) {
            out.write(content.getBytes(StandardCharsets.UTF_8));
            out.flush();
        }
        if (!tmp.renameTo(target)) {
            // rename 失败：清临时文件 + 抛错（禁静默降级：不能让调用方以为写成功了）
            //noinspection ResultOfMethodCallIgnored
            tmp.delete();
            throw new IOException("rename 失败: " + tmp.getAbsolutePath() + " -> " + target.getAbsolutePath());
        }
    }
}
