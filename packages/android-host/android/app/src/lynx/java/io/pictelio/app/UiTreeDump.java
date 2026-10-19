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

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * 运行时 UI 树导出（T0 最小验证；spec {@code docs/specs/app-lynx-ui-tree-dump-t0.md}，
 * 决策与能力边界见 ADR-0223）。
 *
 * <p><b>这条通道解决什么</b>：本仓在模拟器/真机上<b>拿不到</b>运行时 UI 节点树——
 * Lynx 4.0.1 不暴露无障碍树节点（全仓 {@code .vue} 源码 220 处 {@code accessibility-element}
 * 标注也不出节点；口径 {@code grep -rn accessibility-element packages --include=*.vue | wc -l}），
 * {@code uiautomator dump} 在 {@code pictelio_ui} 上必被 SIGKILL（exit 137）。
 * 引擎自带的 {@code getLynxElementRoot} + {@code toJSONString} 是一条绕开 a11y 树与
 * uiautomator 的<b>第三条观测通道</b>，本仓此前从未接线。
 *
 * <p><b>能力边界（不要误期待）</b>：拿不到<b>源码位置</b>。官方 UI source map 的构建期打标
 * （{@code enableUiSourceMap}）是 <b>React-only</b>——该开关只存在于
 * {@code @lynx-js/react-rsbuild-plugin}，打标端是 {@code @lynx-js/react} 的 React-JSX 专用
 * SWC 插件；vue-lynx 无等价实现，其 main-thread 变换不保留任何位置信息。
 * ⇒ 本通道只给「结构 + 几何 + 事件」，不给「这个节点来自哪个 .vue」。
 *
 * <p><b>门禁</b>：整段以 {@code BuildConfig.DEBUG} 包裹。release 变体里该字段是字面量
 * {@code false}（常量表达式 → javac 内联）⇒ 分支恒 false、整块成死代码，
 * <b>预期</b>被 R8 移除、生产 APK 不含任何导出能力（与 ADR-0136 benchNav /
 * {@code pictelio_dev_*} 通道同范式）。⚠️ <b>口径</b>：可执行门禁
 * {@code verifyReleaseBuildConfig} <b>只证取值</b>（release 变体的
 * {@code BuildConfig.DEBUG} 为 {@code false}），<b>证不到 R8 确实移除了本类</b>——
 * 那需要 dex 级断言，本仓目前没有（ADR-0223 §3.3 已登记该缺口）。
 *
 * <p><b>时机</b>：<b>不做</b>「等 JS 侧首载落定」——落定是逐页面属性（各页面/组件各自持有
 * {@code settled}，仓库无全局汇聚点），做成中央层需逐页改动，超出本票边界。改为
 * <b>连拍多份</b>（见 {@link #SAMPLE_DELAYS_MS}）：一次触发在三个时刻各抓一份，
 * 由人挑那份「渲染完整」的。间隔取自仓库既有的「四次投递 1.5/3/4.5/6s」防挂载竞态思路
 * （ADR-0136 / ADR-0220）——{@code onLoadSuccess} 时 JS 未必渲染完，早拍会拿到空树或半棵树。
 */
final class UiTreeDump {

    /** 日志 tag（package-private：JVM 单测用 {@code ShadowLog.getLogsForTag} 断言告警）。 */
    static final String TAG = "UiTreeDump";

    /** intent extra 键：值为非空串即触发（与 benchNav 的 extra 风格一致）。 */
    static final String EXTRA_TRIGGER = "uiTreeDump";

    /** 落盘子目录名（应用专属外部目录内）。 */
    static final String DIR_NAME = "ui-tree";

    /**
     * 产物文件名前缀。
     *
     * <p>与 {@link #FILE_SUFFIX} 同理：诊断脚本要按产物名反解「采样点 + 采样档位」，
     * 两侧必须写同一个前缀——而它们是 Java/Node 两套运行时、无共享代码，只能各写各的字面量。
     * 故由 {@code UiTreeDumpProtocolContractTest} 做两侧逐字比对。
     */
    static final String FILE_PREFIX = "ui-tree-";

    /**
     * 产物文件名后缀。
     *
     * <p>抽成常量的理由：诊断脚本要按后缀筛产物（{@code adb ls} 的输出里混着临时文件
     * {@code .json.tmp}），两侧必须写同一个后缀——而它们是 Java/Node 两套运行时、
     * 无共享代码，只能各写各的字面量。故由 {@code UiTreeDumpProtocolContractTest}
     * 做两侧逐字比对（先例：{@code TranslateEventContractTest} 的事件名比对）。
     */
    static final String FILE_SUFFIX = ".json";

    /** 采样点标识：冷启动（{@code onLoadSuccess} 触发的那一轮）。 */
    static final String POINT_COLD = "cold";

    /** 采样点标识：热启动（{@code onNewIntent} 触发的那一轮）。 */
    static final String POINT_HOT = "hot";

    /**
     * 连拍间隔（ms）：同一触发在这些时刻各抓一份。
     *
     * <p>为什么不是「只拍一张」：引擎回调到达时页面可能还在骨架态——拍到的树少了内容，
     * 而「少了内容」恰好是要诊断的现象本身，早拍会把它误当成结论。拍多份把「时机」
     * 变成可挑的，而不是猜的。
     *
     * <p>这组档位同时是<b>跨端协议</b>：诊断脚本要按档位判断「哪一份才是完整树」
     * （4000ms 那份），并据此等齐（见 {@code UiTreeDumpProtocolContractTest} 的
     * 两侧逐字比对）。
     */
    static final long[] SAMPLE_DELAYS_MS = {0L, 1500L, 4000L};

    /**
     * 采样档位集合的 CSV 形态（跨端协议要素，诊断脚本侧同名常量必须逐字一致）。
     *
     * <p>为什么另开一个 CSV 常量而不是直接比对数组：两侧是不同语言，
     * 数组字面量的打印形态不同（Java {@code [0, 1500, 4000]} vs JS {@code [0,1500,4000]}），
     * 逐字比对会因格式差异假红。CSV 是两侧都能拼出同一串的形式。
     *
     * <p>本常量由 {@link #SAMPLE_DELAYS_MS} 派生 ⇒ 改档位只改一处，不会两处失配。
     */
    static final String SAMPLE_DELAYS_CSV = csv(SAMPLE_DELAYS_MS);

    /** 采样点标识集合的 CSV 形态（跨端协议要素，诊断脚本侧同名常量必须逐字一致）。 */
    static final String POINT_IDS_CSV = POINT_COLD + "," + POINT_HOT;

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

    /** 把 long 数组拼成 CSV（跨端协议比对用的唯一形态来源）。 */
    private static String csv(long[] values) {
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < values.length; i++) {
            if (i > 0) sb.append(',');
            sb.append(values[i]);
        }
        return sb.toString();
    }

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
     * <p><b>命中几个采样点取决于进程怎么死的</b>（2026-10-20 模拟器三场景实测，不是推演）：
     * <ul>
     *   <li>App <b>正在跑</b>（intent 投给已运行实例）⇒ 只走 {@code onNewIntent} ⇒ <b>hot 3 份</b>；</li>
     *   <li>进程已死、<b>任务记录还在</b>（覆盖安装、进程被系统回收后重开）⇒ {@code onCreate}
     *       与 {@code onNewIntent} 都走 ⇒ <b>cold + hot 共 6 份</b>；</li>
     *   <li>{@code am force-stop}（任务记录也清）⇒ 只走 {@code onCreate} ⇒ <b>cold 3 份</b>。</li>
     * </ul>
     * 这不是 bug 而是把「命中哪些采样点」显式化——产物名带采样点，人一眼能分。
     *
     * @param debugBuild 构建类型闸门（调用方传 {@code BuildConfig.DEBUG}）
     * @param point 采样点标识（{@link #POINT_COLD} / {@link #POINT_HOT}），进产物名与日志
     */
    static void scheduleIfRequested(
            Context context, LynxView lynxView, Intent intent, boolean debugBuild, String point) {
        String trigger = (intent == null) ? null : intent.getStringExtra(EXTRA_TRIGGER);
        if (!shouldDump(debugBuild, trigger)) return; // 未请求 ⇒ 静默（正常路径，不是降级）
        if (lynxView == null) {
            // 请求到了但没有可抓的视图：显式告警（区分「没触发」与「触发了但失败」）
            Log.w(TAG, "UI 树抓取请求已受理，但 LynxView 未就绪（跳过本次抓取，采样点=" + point + "）");
            return;
        }
        Log.i(TAG, "UI 树抓取请求已受理，采样点=" + point + "，连拍 " + SAMPLE_DELAYS_MS.length
                + " 份（间隔 " + SAMPLE_DELAYS_CSV + " ms）");
        for (long delay : SAMPLE_DELAYS_MS) {
            new Handler(Looper.getMainLooper())
                    .postDelayed(() -> capture(context, lynxView, delay, point), delay);
        }
    }

    /**
     * 抓一棵树。
     *
     * <p>两条失败路径<b>分开</b>报错，不合并成一句「失败」：根元素为 null（视图没渲染出根）
     * 与序列化为 null（引擎侧没给出内容）是不同的故障面，合并会让人无法定位。
     */
    private static void capture(Context context, LynxView lynxView, long delayMs, String point) {
        final long t0 = System.currentTimeMillis();
        try {
            lynxView.getLynxElementRoot(root -> {
                if (root == null) {
                    Log.w(TAG, "UI 树抓取失败（采样点=" + point + "，延迟 " + delayMs
                            + "ms）：getLynxElementRoot 回调根元素为 null");
                    return;
                }
                root.toJSONString(json -> {
                    if (json == null) {
                        Log.w(TAG, "UI 树抓取失败（采样点=" + point + "，延迟 " + delayMs
                                + "ms）：toJSONString 回调为 null");
                        return;
                    }
                    final long elapsed = System.currentTimeMillis() - t0;
                    persist(context, json, delayMs, elapsed, point);
                });
            });
        } catch (Throwable t) {
            Log.w(TAG, "UI 树抓取异常（采样点=" + point + "，延迟 " + delayMs + "ms）", t);
        }
    }

    /** 落盘（移交 I/O 线程：引擎回调在 UI 线程，几 MB 写盘不能占 UI 线程）。 */
    private static void persist(Context context, String json, long delayMs, long elapsedMs, String point) {
        IO.execute(() -> writeArtifactTo(context, json, delayMs, elapsedMs, point));
    }

    /**
     * 落盘入口（<b>可测 seam</b>：把「取目录」与「写文件」接起来，让「目录拿不到」这条失败路径
     * 也能被 JVM 单测钉住）。
     *
     * <p>为什么把「目录为 null」这条分支也做成可测：它是 IO 边界的**失败路径**之一
     * （测试硬约束 #1 要求成功 + 失败双路径都有单测）。原先这条分支藏在
     * {@code persist} 的后台任务里 ⇒ 测不到 ⇒ 「拿不到外部存储 ⇒ 什么都不发生」
     * 这一形态是静默的。
     *
     * @return 成功返回 {@code null}；失败返回失败原因（同时已打 WARN 日志）
     */
    static String writeArtifactTo(
            Context context, String json, long delayMs, long elapsedMs, String point) {
        File dir = resolveOutputDir(context);
        if (dir == null) {
            String reason = "getExternalFilesDir 返回 null（无可用外部存储）";
            Log.w(TAG, "UI 树落盘失败：" + reason);
            return reason;
        }
        return writeArtifact(dir, json, delayMs, elapsedMs, point);
    }

    /**
     * 把一份树写进指定目录（<b>可测 seam</b>：失败路径的告警在这里，可被 JVM 单测钉住）。
     *
     * <p>为什么拆出来：落盘是外部 IO，按测试硬约束 #1 必须有成功 + 失败双路径单测；
     * 而「失败若被吞，用户看到的是『目录里没有文件』，而真相是『写盘失败』」——
     * 两者指向完全不同的排查方向（禁静默降级，测试硬约束 #3）。
     *
     * @return 成功返回 {@code null}；失败返回失败原因（同时已打 WARN 日志）
     */
    static String writeArtifact(File dir, String json, long delayMs, long elapsedMs, String point) {
        try {
            if (!dir.exists() && !dir.mkdirs()) {
                String reason = "目录创建失败 " + dir.getAbsolutePath();
                Log.w(TAG, "UI 树落盘失败：" + reason);
                return reason;
            }
            File target = new File(dir, fileName(point, delayMs, SEQ.incrementAndGet(),
                    System.currentTimeMillis()));
            writeAtomically(target, json);
            int nodes = countNodes(json);
            Log.i(TAG, "UI 树已落盘 " + target.getName()
                    + " 字节=" + target.length()
                    + " 节点数=" + (nodes >= 0 ? String.valueOf(nodes) : "解析失败")
                    + " 抓取往返耗时=" + elapsedMs + "ms"
                    + " 采样点=" + point
                    + " 采样延迟=" + delayMs + "ms"
                    + " 路径=" + target.getAbsolutePath());
            return null;
        } catch (Throwable t) {
            Log.w(TAG, "UI 树落盘异常（采样点=" + point + "，延迟 " + delayMs + "ms）", t);
            return "写盘异常：" + t.getClass().getSimpleName();
        }
    }

    /**
     * 数一棵树的节点数。
     *
     * <p><b>为什么宿主侧也要数</b>：spec US4 与 issue #1045 的 T0-2 都承诺
     * 「logcat 里留下体积 / 耗时 / **节点数**」——节点数是判断「这条通道在真机上是否可用」
     * 的关键量（树越大 ⇒ 序列化越慢、文件越大）。而摘要脚本给的节点数要**拉回文件后**才看得到，
     * 现场判断时手边只有 logcat。
     *
     * <p><b>为什么放在 I/O 线程</b>：解析一棵大树是毫秒级操作，而引擎回调落在 UI 线程
     * ⇒ 计数一律在落盘线程做，绝不占 UI 线程。
     *
     * <p><b>口径与脚本侧一致</b>：根节点算 1 个；只沿 {@code children} 递归。
     * （脚本侧 {@code summarize} 是同一口径 ⇒ 两边数字可互校。）
     *
     * @return 节点数；JSON 解析失败返回 {@code -1}（调用方据此打「解析失败」而非假数字）
     */
    static int countNodes(String json) {
        try {
            Object root = new JSONTokener(json).nextValue();
            return countJsonNodes(root);
        } catch (JSONException e) {
            return -1;
        }
    }

    /** 递归计数（口径：根算 1，只沿 children 下探）。 */
    private static int countJsonNodes(Object value) {
        if (!(value instanceof JSONObject)) return 0;
        JSONObject node = (JSONObject) value;
        int count = 1;
        JSONArray children = node.optJSONArray("children");
        if (children != null) {
            for (int i = 0; i < children.length(); i++) {
                count += countJsonNodes(children.opt(i));
            }
        }
        return count;
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

    /**
     * 文件名：采样点 + 采样档位 + 序号 + 时间戳 ⇒ 多次触发不覆盖，且人一眼看出「哪一份」。
     *
     * <p>形如 {@code ui-tree-cold-4000ms-3-1700000000000.json}：
     * 采样点让人分辨「冷启动那轮 / 热启动那轮」，档位让人分辨「早拍还是晚拍」——
     * 实测 4s 那份才是完整树（8KB → 9KB → 61KB），没有档位就只能靠体积猜。
     */
    static String fileName(String point, long delayMs, int seq, long timestampMillis) {
        return FILE_PREFIX + point + "-" + delayMs + "ms-" + seq + "-" + timestampMillis + FILE_SUFFIX;
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
