import type { Component } from "solid-js";
import { addBookmark, loadBookmarkDetail, loadUserBookmarkTags } from "../api/illust";
import type { PixivBookmarkDetail, PixivBookmarkTag, RestrictType } from "../api/types";
import { user } from "../stores/authStore";
import {
  BOOKMARK_TAG_LIMIT,
  toggleBookmarkTag,
  commitBookmarkTagToken,
} from "../utils/bookmarkTagSelection";
import { t, apiErrorMessage } from "../i18n";

interface BookmarkPanelProps {
  /** 目标插画 id（面板内所有请求的作用域；变化即重置 + 中止旧请求） */
  illustId: number;
  /** 打开时作品的已收藏态（外部快照，仅作上下文展示；真值以预填结果为准） */
  isBookmarked: boolean;
  /** 作品自带标签名列表（建议来源，spec docs/specs/bookmark-tags.md D5/D7） */
  workTags?: string[];
  isOpen: boolean;
  onClose: () => void;
  /** 保存成功回调：由宿主（IllustDetail）决定状态写入（含爆发动效）。
   * 无参——保存恒为「收藏/覆盖」方向（ADR-0160 D2），真实收藏态以宿主自身状态为准。 */
  onSaved: () => void;
}

/** 输入/选择反馈判别（文案由 i18n 渲染） */
type FeedbackKind = "limit" | "empty" | "duplicate";

/** 预填快照：保存失败回滚的还原点（spec D6：失败回预填态，禁止静默降级） */
interface PrefillSnapshot {
  selected: string[];
  restrict: RestrictType;
  bookmarked: boolean;
}

const EMPTY_PREFILL: PrefillSnapshot = { selected: [], restrict: "public", bookmarked: false };

// ─── chip 样式（Fluent token 化；选中 = 品牌填充，未选 = 描边） ───
const CHIP_BASE =
  "inline-flex items-center gap-1.5 min-h-10 px-[var(--spacingHorizontalM)] rounded-[var(--borderRadiusCircular)] [font-size:var(--fontSizeBase200)] border transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] active:scale-[0.98] select-none appearance-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]";
const CHIP_SELECTED =
  "bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] border-[var(--colorBrandBackground)] hover:bg-[var(--colorBrandBackgroundHover)] active:bg-[var(--colorBrandBackgroundPressed)]";
const CHIP_IDLE =
  "bg-transparent text-[var(--colorNeutralForeground1)] border-[var(--colorNeutralStroke2)] hover:bg-[var(--colorNeutralBackground2)]";

/** 展示层可渲染的错误形状（ApiError 结构子集，见 src/api/types.ts） */
interface DisplayError {
  message: string;
  messageKey?: string;
  params?: Record<string, string | number>;
}

function isDisplayError(e: unknown): e is DisplayError {
  // ApiError 是 client.ts 抛出的普通对象（非 Error 子类），故按 message 字段形状判定
  return (
    e !== null && typeof e === "object" && typeof (e as { message?: unknown }).message === "string"
  );
}

/**
 * 错误 → 展示文案：messageKey 优先经 i18n 渲染（src/api/types.ts ApiError 注释 /
 * ErrorDisplay.tsx 先例），普通 Error 与其他值回退快照文案（String(e)）。
 * message 快照恒为简中，英文 locale 下直用即泄漏中文，故展示层不得绕过 messageKey。
 */
function errorMessage(e: unknown): string {
  return isDisplayError(e) ? apiErrorMessage(e) : String(e);
}

/**
 * 收藏面板（长按详情页心形唤出；ADR-0160 D3/D7，spec docs/specs/bookmark-tags.md）。
 *
 * 数据源三角：预填（loadBookmarkDetail）+ 标签库（loadUserBookmarkTags，按可见性分库）
 * + 作品标签建议（props.workTags）；保存 = addBookmark 覆盖式编辑（D2）。
 *
 * 竞态防护：打开/关闭/illustId 变化经 generation gate + AbortController 中止旧请求，
 * 晚到响应按代数丢弃——快速开关面板不得串数据。
 *
 * 错误路径（测试硬约束 #3，禁止静默降级）：
 * - 预填失败 → 面板内错误提示 + 保存禁用（无真值不覆盖）；
 * - 标签库失败 → 候选区降级提示，保存不受阻；
 * - 保存失败 → console.warn + 面板内错误提示 + 状态回滚到预填态。
 */
const BookmarkPanel: Component<BookmarkPanelProps> = (props) => {
  const [detailLoading, setDetailLoading] = createSignal(true);
  const [detailError, setDetailError] = createSignal<string | null>(null);
  const [universeTags, setUniverseTags] = createSignal<PixivBookmarkTag[]>([]);
  const [universeLoading, setUniverseLoading] = createSignal(false);
  const [universeError, setUniverseError] = createSignal<string | null>(null);
  const [selected, setSelected] = createSignal<string[]>([]);
  const [restrict, setRestrict] = createSignal<RestrictType>("public");
  const [prefill, setPrefill] = createSignal<PrefillSnapshot>(EMPTY_PREFILL);
  const [input, setInput] = createSignal("");
  const [feedback, setFeedback] = createSignal<FeedbackKind | null>(null);
  const [saving, setSaving] = createSignal(false);
  const [saveError, setSaveError] = createSignal<string | null>(null);
  /** 已收藏态（预填真值；未落定前用宿主快照兜底，仅用于保存按钮文案） */
  const [bookmarked, setBookmarked] = createSignal(props.isBookmarked);

  // ─── 预填请求（detail）：generation gate + AbortController ───
  let detailGen = 0;
  let detailAbort: AbortController | null = null;

  function applyPrefill(detail: PixivBookmarkDetail | null) {
    // detail 非 null ≠ 已收藏：未收藏时服务端也返回对象（2026-09-14 真机 probe），
    // 已收藏真值看 is_bookmarked。字段缺失 = 契约破坏（禁止静默降级：显式告警，按未收藏处理，
    // 与 lynx 侧 useBookmarkPanel 同语义）——按已收藏处理会把空预填当成待保存的完整集合。
    if (detail !== null && detail.is_bookmarked === undefined) {
      console.warn("[BookmarkPanel] bookmark_detail.is_bookmarked 缺失（契约破坏），按未收藏处理");
    }
    // is_registered = 该标签已在用户标签库（勾选依据，ADR-0160 D5）；缺省宽容按未注册
    const marked = (detail?.tags ?? []).filter((tag) => tag.is_registered).map((tag) => tag.name);
    const nextRestrict: RestrictType = detail?.restrict === "private" ? "private" : "public";
    // 已收藏真值 = is_bookmarked === true；detail 为 null 是「键显式 null」的防御分支（未收藏），
    // props 快照仅作请求落定前的兜底展示
    const nextBookmarked = detail?.is_bookmarked === true;
    const snapshot: PrefillSnapshot = {
      selected: marked,
      restrict: nextRestrict,
      bookmarked: nextBookmarked,
    };
    setPrefill(snapshot);
    setSelected(marked);
    setRestrict(nextRestrict);
    setBookmarked(nextBookmarked);
  }

  // Solid 2.0 拆分效应：compute 读快照，apply 段发请求/写 signal；清理经代数 + abort 承担
  createEffect(
    () => ({ open: props.isOpen, id: props.illustId }),
    (s) => {
      detailGen++;
      detailAbort?.abort();
      detailAbort = null;
      resetState();
      if (!s.open || !s.id) {
        return;
      }
      const myGen = detailGen;
      const controller = new AbortController();
      detailAbort = controller;
      loadBookmarkDetail(s.id, controller.signal).then(
        (detail) => {
          if (myGen !== detailGen || controller.signal.aborted) return;
          applyPrefill(detail);
          setDetailLoading(false);
        },
        (e) => {
          if (myGen !== detailGen || controller.signal.aborted) return;
          console.warn(`[BookmarkPanel] bookmark detail load failed (illust=${s.id}):`, e);
          setDetailError(errorMessage(e));
          setDetailLoading(false);
        },
      );
    },
  );

  // ─── 标签库（按当前可见性分库；可见性切换即重拉，spec D7） ───
  let universeGen = 0;
  let universeAbort: AbortController | null = null;

  createEffect(
    () => ({ open: props.isOpen, restrict: restrict(), userId: user()?.id ?? 0 }),
    (s) => {
      universeGen++;
      universeAbort?.abort();
      universeAbort = null;
      setUniverseTags([]);
      setUniverseError(null);
      if (!s.open) {
        setUniverseLoading(false);
        return;
      }
      if (!s.userId) {
        // 未登录（无 userId）：显式暴露降级态，不发 user_id=0 的垃圾请求
        console.warn("[BookmarkPanel] skipped tag universe: not signed in (no userId)");
        setUniverseLoading(false);
        setUniverseError("unauthenticated");
        return;
      }
      const myGen = universeGen;
      const controller = new AbortController();
      universeAbort = controller;
      setUniverseLoading(true);
      loadUserBookmarkTags(s.userId, s.restrict, undefined, controller.signal).then(
        (res) => {
          if (myGen !== universeGen || controller.signal.aborted) return;
          const tags = res?.bookmark_tags;
          if (tags === undefined || tags === null) {
            console.warn(
              "[BookmarkPanel] 标签库响应缺 bookmark_tags 字段（契约破坏），按空候选处理",
            );
          }
          setUniverseTags(tags ?? []);
          setUniverseLoading(false);
        },
        (e) => {
          if (myGen !== universeGen || controller.signal.aborted) return;
          console.warn("[BookmarkPanel] tag universe load failed:", e);
          setUniverseTags([]);
          setUniverseError(errorMessage(e));
          setUniverseLoading(false);
        },
      );
    },
  );

  onCleanup(() => {
    detailAbort?.abort();
    universeAbort?.abort();
  });

  function resetState() {
    setDetailLoading(true);
    setDetailError(null);
    setUniverseTags([]);
    setUniverseLoading(false);
    setUniverseError(null);
    setSelected([]);
    setRestrict("public");
    setPrefill(EMPTY_PREFILL);
    setBookmarked(props.isBookmarked);
    setInput("");
    setFeedback(null);
    setSaving(false);
    setSaveError(null);
  }

  // 反馈为瞬态：2.5s 自动清除（Solid 2.0 拆分效应，清理经返回值注册）
  createEffect(
    () => feedback(),
    (fb) => {
      if (!fb) {
        return;
      }
      const timer = setTimeout(() => setFeedback(null), 2500);
      return () => clearTimeout(timer);
    },
  );

  // ─── 交互 ───

  function handleToggleTag(name: string) {
    const res = toggleBookmarkTag(selected(), name);
    setSelected(res.selected);
    if (res.rejected === "limit") {
      setFeedback("limit");
    }
  }

  function commitInput() {
    const res = commitBookmarkTagToken(selected(), input());
    if (res.error) {
      // 失败保留反馈（用户需看到拒绝原因）
      setFeedback(res.error);
      return;
    }
    setSelected(res.selected);
    setInput("");
    // 成功即清反馈（lynx 侧同语义；移除上一轮的拒绝原因，避免陈旧提示）
    setFeedback(null);
  }

  // spec D11：输入空格即提交当前 token（与服务端空格分隔语义一致）；Enter 同义提交
  function onInputKeyDown(e: KeyboardEvent) {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      commitInput();
    }
  }

  async function handleSave() {
    if (saving() || detailLoading() || detailError()) {
      return;
    }
    setSaving(true);
    setSaveError(null);
    const restrictAtSave = restrict();
    const [err] = await tryAsync(addBookmark(props.illustId, restrictAtSave, selected()));
    setSaving(false);
    if (err) {
      console.warn(`[BookmarkPanel] bookmark save failed (illust=${props.illustId}):`, err);
      setSaveError(errorMessage(err));
      // 回滚到预填态（spec D6/用户故事 12）：可见性与已选标签还原
      const snapshot = prefill();
      setSelected(snapshot.selected);
      setRestrict(snapshot.restrict);
      return;
    }
    props.onSaved();
    props.onClose();
  }

  function close() {
    props.onClose();
  }

  return (
    <Show when={props.isOpen}>
      <div class="fixed inset-0 z-50" data-testid="bookmark-panel">
        {/* Scrim */}
        <div
          class="absolute inset-0"
          style="background-color:var(--colorScrim)"
          onClick={close}
          role="button"
          aria-label={t("bookmarkPanel.closeScrimAria")}
          data-testid="bookmark-panel-scrim"
          tabindex={0}
          onKeyDown={(e) => e.key === "Enter" && close()}
        />

        {/* Sheet panel — A2 纯色卡片（与 SeriesSheet 同形态：NeutralBackground1） */}
        <div
          class="absolute bottom-0 left-0 right-0 bg-[var(--colorNeutralBackground1)] rounded-t-[var(--borderRadius3XLarge)] shadow-[var(--elevation28)]"
          style="max-height:80vh;overflow-y:auto;animation:fluent-slide-down var(--durationGentle) var(--curveDecelerateMid) both"
          data-testid="bookmark-panel-sheet"
        >
          {/* Drag handle */}
          <div class="flex justify-center pt-2 pb-1">
            <div class="w-10 h-1 rounded-[var(--borderRadiusCircular)] bg-[var(--colorNeutralStroke1)]" />
          </div>

          {/* Header */}
          <div class="flex items-center justify-between px-5 pt-1 pb-2">
            <h2 class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)]">
              {t("bookmarkPanel.title")}
            </h2>
            <button
              type="button"
              class="w-10 h-10 flex items-center justify-center rounded-[var(--borderRadiusMedium)] text-[var(--colorNeutralForeground1)] hover:bg-[var(--colorNeutralBackground2)] active:scale-95 transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] appearance-none border-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
              onClick={close}
              aria-label={t("bookmarkPanel.closeAria")}
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path
                  d="M15.14 4.86a.67.67 0 0 0-.95 0L10 9.05 5.81 4.86a.67.67 0 0 0-.95.95L9.05 10l-4.19 4.19a.67.67 0 0 0 .95.95L10 10.95l4.19 4.19a.67.67 0 0 0 .95-.95L10.95 10l4.19-4.19a.67.67 0 0 0 0-.95z"
                  fill="currentColor"
                />
              </svg>
            </button>
          </div>

          <fluent-divider style="margin-inline:var(--spacingHorizontalXL)" />

          {/* ── 预填状态（detail 加载中 / 失败禁存） ── */}
          <Show when={detailLoading()}>
            <div class="flex items-center gap-2 px-5 pt-3 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              <fluent-spinner size="tiny" />
              <span>{t("bookmarkPanel.detailLoading")}</span>
            </div>
          </Show>
          <Show when={detailError()}>
            <p
              role="alert"
              class="px-5 pt-3 [font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)]"
            >
              {t("bookmarkPanel.detailFailed", { detail: detailError() ?? "" })}
            </p>
          </Show>

          {/* ── 可见性（公开/私密分库标签库随之切换） ── */}
          <div class="px-5 pt-3">
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {t("bookmarkPanel.visibilityLabel")}
            </p>
            <div
              class="flex gap-2 mt-2"
              role="group"
              aria-label={t("bookmarkPanel.visibilityLabel")}
            >
              <button
                type="button"
                aria-pressed={restrict() === "public" ? "true" : "false"}
                class={`${CHIP_BASE} ${restrict() === "public" ? CHIP_SELECTED : CHIP_IDLE}`}
                data-testid="bookmark-panel-visibility-public"
                onClick={() => setRestrict("public")}
              >
                {t("bookmarkPanel.visibilityPublic")}
              </button>
              <button
                type="button"
                aria-pressed={restrict() === "private" ? "true" : "false"}
                class={`${CHIP_BASE} ${restrict() === "private" ? CHIP_SELECTED : CHIP_IDLE}`}
                data-testid="bookmark-panel-visibility-private"
                onClick={() => setRestrict("private")}
              >
                {t("bookmarkPanel.visibilityPrivate")}
              </button>
            </div>
          </div>

          {/* ── 已选区（chip 可移除；上限 10，spec D5） ── */}
          <div class="px-5 pt-3">
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {t("bookmarkPanel.selectedLabel", {
                count: selected().length,
                limit: BOOKMARK_TAG_LIMIT,
              })}
            </p>
            <Show when={selected().length === 0}>
              <p class="mt-2 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                {t("bookmarkPanel.selectedEmpty")}
              </p>
            </Show>
            <Show when={selected().length > 0}>
              <div class="flex flex-wrap gap-2 mt-2">
                <For each={selected()}>
                  {(name) => (
                    <button
                      type="button"
                      class={`${CHIP_BASE} ${CHIP_SELECTED}`}
                      aria-pressed="true"
                      aria-label={t("bookmarkPanel.removeTagAria", { tag: name })}
                      onClick={() => handleToggleTag(name)}
                    >
                      {name}
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 20 20"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M15.14 4.86a.67.67 0 0 0-.95 0L10 9.05 5.81 4.86a.67.67 0 0 0-.95.95L9.05 10l-4.19 4.19a.67.67 0 0 0 .95.95L10 10.95l4.19 4.19a.67.67 0 0 0 .95-.95L10.95 10l4.19-4.19a.67.67 0 0 0 0-.95z"
                          fill="currentColor"
                        />
                      </svg>
                    </button>
                  )}
                </For>
              </div>
            </Show>
          </div>

          {/* ── 内联新建（空格提交 token，spec D11） ── */}
          <div class="px-5 pt-3">
            <label
              for="bookmark-panel-tag-input"
              class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]"
            >
              {t("bookmarkPanel.newTagLabel")}
            </label>
            <div class="flex gap-2 mt-2">
              <input
                id="bookmark-panel-tag-input"
                data-testid="bookmark-panel-input"
                type="text"
                value={input()}
                onInput={(e) => setInput(e.currentTarget.value)}
                onKeyDown={onInputKeyDown}
                placeholder={t("bookmarkPanel.newTagPlaceholder")}
                aria-label={t("bookmarkPanel.newTagLabel")}
                class="flex-1 min-w-0 min-h-10 px-3 rounded-[var(--borderRadiusMedium)] border border-[var(--colorNeutralStroke2)] bg-[var(--colorNeutralBackground1)] text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase200)] appearance-none outline-none focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)] placeholder:text-[var(--colorNeutralForeground3)]"
              />
              <button
                type="button"
                class={`${CHIP_BASE} ${CHIP_IDLE}`}
                aria-label={t("bookmarkPanel.newTagAddAria")}
                data-testid="bookmark-panel-add"
                onClick={commitInput}
              >
                {t("bookmarkPanel.newTagAddAria")}
              </button>
            </div>
            <Show when={feedback()}>
              <p
                role="alert"
                class="mt-2 [font-size:var(--fontSizeBase200)] text-[var(--colorStatusWarningForeground1)]"
              >
                {feedback() === "limit"
                  ? t("bookmarkPanel.limitReached", { limit: BOOKMARK_TAG_LIMIT })
                  : feedback() === "empty"
                    ? t("bookmarkPanel.newTagEmpty")
                    : t("bookmarkPanel.newTagDuplicate")}
              </p>
            </Show>
          </div>

          {/* ── 标签库（按可见性分库；失败降级提示，保存不受阻，spec D6） ── */}
          <div class="px-5 pt-3">
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
              {t("bookmarkPanel.universeLabel")}
            </p>
            <Show when={universeLoading()}>
              <p class="mt-2 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                {t("bookmarkPanel.universeLoading")}
              </p>
            </Show>
            <Show when={universeError()}>
              <p
                role="alert"
                class="mt-2 [font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)]"
              >
                {t("bookmarkPanel.universeFailed")}
              </p>
            </Show>
            <Show when={!universeLoading() && !universeError() && universeTags().length === 0}>
              <p class="mt-2 [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                {t("bookmarkPanel.universeEmpty")}
              </p>
            </Show>
            <Show when={universeTags().length > 0}>
              <div class="flex flex-wrap gap-2 mt-2">
                <For each={universeTags()}>
                  {(tag) => {
                    const isSelected = () => selected().includes(tag.name);
                    return (
                      <button
                        type="button"
                        aria-pressed={isSelected() ? "true" : "false"}
                        aria-label={t("bookmarkPanel.universeTagAria", {
                          name: tag.name,
                          count: tag.count ?? 0,
                        })}
                        class={`${CHIP_BASE} ${isSelected() ? CHIP_SELECTED : CHIP_IDLE}`}
                        onClick={() => handleToggleTag(tag.name)}
                      >
                        {tag.name}
                        {tag.count !== undefined && (
                          <span class="[font-size:var(--fontSizeBase100)] opacity-70">
                            {tag.count}
                          </span>
                        )}
                      </button>
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>

          {/* ── 作品标签建议（建议来源，spec D5；不在任何库中） ── */}
          <Show when={(props.workTags?.length ?? 0) > 0}>
            <div class="px-5 pt-3">
              <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)]">
                {t("bookmarkPanel.suggestionsLabel")}
              </p>
              <div class="flex flex-wrap gap-2 mt-2">
                <For each={props.workTags ?? []}>
                  {(name) => {
                    const isSelected = () => selected().includes(name);
                    return (
                      <button
                        type="button"
                        aria-pressed={isSelected() ? "true" : "false"}
                        aria-label={t("bookmarkPanel.suggestionAria", { name })}
                        class={`${CHIP_BASE} ${isSelected() ? CHIP_SELECTED : CHIP_IDLE}`}
                        onClick={() => handleToggleTag(name)}
                      >
                        {name}
                      </button>
                    );
                  }}
                </For>
              </div>
            </div>
          </Show>

          {/* ── 保存（覆盖式编辑，ADR-0160 D2；预填失败禁存） ── */}
          <div class="px-5 pb-6 pt-4">
            <Show when={saveError()}>
              <p
                role="alert"
                class="mb-2 [font-size:var(--fontSizeBase200)] text-[var(--colorStatusDangerForeground1)]"
              >
                {t("bookmarkPanel.saveFailed", { detail: saveError() ?? "" })}
              </p>
            </Show>
            <button
              type="button"
              class="w-full min-h-10 rounded-[var(--borderRadiusMedium)] bg-[var(--colorBrandBackground)] text-[var(--colorNeutralForegroundOnBrand)] [font-size:var(--fontSizeBase300)] font-semibold hover:bg-[var(--colorBrandBackgroundHover)] active:bg-[var(--colorBrandBackgroundPressed)] active:scale-[0.98] transition-all duration-[var(--durationFast)] ease-[var(--curveEasyEase)] disabled:opacity-60 disabled:cursor-default select-none appearance-none border-none outline-none cursor-pointer focus-visible:outline focus-visible:outline-offset-[var(--strokeWidthThin)] focus-visible:outline-[var(--colorStrokeFocus2)]"
              disabled={saving() || detailLoading() || detailError() !== null}
              data-testid="bookmark-panel-save"
              onClick={() => void handleSave()}
            >
              {saving()
                ? t("bookmarkPanel.saving")
                : bookmarked()
                  ? t("bookmarkPanel.saveEdit")
                  : t("bookmarkPanel.save")}
            </button>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default BookmarkPanel;
