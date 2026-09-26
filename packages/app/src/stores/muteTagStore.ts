/**
 * 静音标签集合 —— 本地标签词表过滤（ADR-0187，webview 侧）。
 *
 * 账号级共享键 `mute_tags_${uid}`（ADR-0103 契约，键名与 app-lynx 逐字一致）：
 * 元素为 trim 后的原始标签名（string[] JSON）。机制沿用 settingsStore 的
 * defineFactory（对齐 show_r18_${uid} 路径）；读失败/损坏由 registry report
 * 管线 console.warn 可见并回退空集合（禁静默降级）。
 * 匹配语义（ADR-0187 D2）：trim 后对原始 tag.name 精确相等——无大小写折叠、
 * 无全半角归一、不匹配 translated_name。
 */
import { createSignal } from "solid-js";
import { settings } from "@/settings";
// codec 从子路径导入而非 "@/settings" 桶文件（同 settingsStore：避免击穿测试对桶文件的 mock）
import { jsonCodec } from "@/settings/codecs";
import { user } from "@/stores/authStore";

const PREF_KEY_MUTE_TAGS = "mute_tags";

/** 当前登录账号 ID（未登录 null） */
const uid = () => user()?.id ?? null;

const muteTagsFactory = settings.defineFactory<string[]>({
  keyPrefix: PREF_KEY_MUTE_TAGS,
  default: [],
  codec: jsonCodec,
  validate: (v): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string"),
});

/** 静音标签集合快照（响应式 accessor，整集快照读；未登录返回空集合） */
export const mutedTags = (): Set<string> => {
  const id = uid();
  return id !== null ? new Set(muteTagsFactory.forId(id).value()) : new Set();
};

/** 从存储装载当前账号的静音标签（未登录 no-op；经 loadAccountR18 在 auth 就绪后调用） */
export async function loadMuteTags(): Promise<void> {
  const id = uid();
  if (id === null) return;
  await muteTagsFactory.forId(id).hydrate();
}

/**
 * 静音标签并持久化（trim、幂等）。未登录不落盘（账号级语义）。
 * 写入结果：handle.set 为同步 void、持久化 `void persistNow(...)` fire-and-forget（registry
 * 契约不回传落盘结果）→ 轻提示在写入发起后即展示；落盘失败可见性经 registry warn 管线
 * （`[settings] write mute_tags_42`，禁静默），spec 边界 #7 的 UI 失败提示挂账。
 */
export async function muteTag(name: string): Promise<void> {
  const id = uid();
  if (id === null) return;
  const trimmed = name.trim();
  if (trimmed === "") return;
  const handle = muteTagsFactory.forId(id);
  if (!handle.value().includes(trimmed)) {
    handle.set([...handle.value(), trimmed]);
  }
  // 轻提示（ADR-0187 D5）：长按必有反馈，已静音重复长按同样提示
  setMuteTagHint({ name: trimmed });
}

/** 取消静音并持久化。未静音时 no-op。 */
export async function unmuteTag(name: string): Promise<void> {
  const id = uid();
  if (id === null) return;
  const handle = muteTagsFactory.forId(id);
  if (!handle.value().includes(name)) return;
  handle.set(handle.value().filter((t) => t !== name));
}

/** 判断标签是否已静音 */
export function isTagMuted(name: string): boolean {
  return mutedTags().has(name);
}

/** 清空静音标签（并持久化空集合） */
export function resetMuteTags(): void {
  const id = uid();
  if (id === null) return;
  muteTagsFactory.forId(id).set([]);
}

// ── 静音成功轻提示（ADR-0187 D5）──
// 无全局 toast 原语：信号存纯数据（标签名），由 __root 宿主的 MuteTagHint
// 以 Fluent 令牌浮层展示（exitHint 同位先例），文案经 t() 渲染（store 不快照文案）。
export interface MuteTagHint {
  /** 触发提示的标签名（已 trim） */
  name: string;
}

const [muteTagHint, setMuteTagHint] = createSignal<MuteTagHint | null>(null);

/** 当前待展示的静音提示（null = 无） */
export const currentMuteTagHint = muteTagHint;

/** 提示宿主展示完毕后清除 */
export function clearMuteTagHint(): void {
  setMuteTagHint(null);
}
