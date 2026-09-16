package io.pictelio.app.engine;

/**
 * 引擎决策的持久化状态输入（{@link EnginePrefs#read} 产出，{@code EngineRouting.decide} 消费）。
 *
 * <p>纯值对象：preferred 恒非空（经 clientKinds 归一化）；knownBad = 失败记忆与当前
 * versionCode 精确相等；autoFallback = 运行时自动跳开关（缺省开）。
 */
public final class EngineState {

    /** 首选引擎（已按本包 CLIENT_KINDS 归一化，恒非空）。 */
    public final Engine preferred;

    /** Lynx 失败记忆命中（仅当前版本失败过；应用升级自动遗忘）。 */
    public final boolean knownBad;

    /** 运行时硬错误自动回退开关（缺省 true；只管运行时跳转，不管预检降级）。 */
    public final boolean autoFallback;

    public EngineState(Engine preferred, boolean knownBad, boolean autoFallback) {
        this.preferred = preferred;
        this.knownBad = knownBad;
        this.autoFallback = autoFallback;
    }
}
