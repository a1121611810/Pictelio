import type { Accessor, Component, JSX } from "solid-js";
import { useNavigate, useParams } from "@solidjs/router";
import PixivImage from "../components/PixivImage";
import ImageViewer from "@/components/ImageViewer";
import NovelDetailSkeleton from "../components/skeletons/NovelDetailSkeleton";
import FluentDialog from "../components/ui/FluentDialog";
import NovelSearchBar from "../components/NovelSearchBar";
import NovelTopBar from "../components/novel/NovelTopBar";
import NovelCoverCard from "../components/novel/NovelCoverCard";
import NovelFooterNav from "../components/NovelFooterNav";
import { NOVEL_INTERACTIVE_MARGIN } from "../primitives/rootMargins";
import { createScrollBehavior } from "../primitives/scroll/createScrollBehavior";
import { createScrollPosition } from "@solid-primitives/scroll";
import { createVisibilityObserver } from "@solid-primitives/intersection-observer";
import { createNovelSearch } from "../primitives/createNovelSearch";
import { createNovelVirtualLayout } from "../primitives/createNovelVirtualLayout";
import type { PixivNovel, SeriesNavigation } from "@/api/types";
import type { NovelImagesMap } from "@/api/novel";
import { getEntry, peekEntry, loadNovelEntry, type NovelCacheEntry } from "@/stores/novelCache";
import {
  readerStyle,
  fontSize,
  fontWeight,
  fontFamily,
  lineHeight,
} from "../stores/readerSettingsStore";
import {
  parseNovelBlocks,
  buildSearchText,
  getImageBlocks,
  selectInlineImageUrl,
} from "../utils/novelBlocks";
import type { NovelBlock, TextBlock, ImageBlock } from "../utils/novelBlocks";
import { loadNovelImageDimensions, type NovelImageDimensions } from "../utils/novelImageDimensions";
import ReaderSettingsSheet from "../components/ReaderSettingsSheet";
import SeriesSheet from "../components/SeriesSheet";
import PageTransition from "../components/PageTransition";
import CommentOverlay from "../components/CommentOverlay";
import { type ApiError } from "../api/types";
import ErrorDisplay from "../components/ErrorDisplay";
import { pushOverlay, popOverlay } from "../stores/backGestureStore";
import { scrollToTop } from "../utils/scrollToTop";
import { toApiError } from "../api/client";
import { recordVisit } from "../stores/historyStore";
import TranslateSheet from "../components/TranslateSheet";
import { translateNovel } from "../primitives/createNovelTranslator";
import { detectNovelLanguage } from "../utils/detectLanguage";
import { getTranslation, setTranslation, DEFAULT_TARGET_LANG } from "../utils/translationCache";
import {
  dsApiKey,
  loadDsApiKey,
  translatedParagraphs,
  setTranslatedParagraphs,
  showTranslation,
  setShowTranslation,
  translating,
  setTranslating,
  setTranslationError,
  setTranslationProgress,
  resetTranslationState,
  decideTranslatePolicy,
  translateR18,
  translateR18G,
  getR18Confirmed,
  markR18Confirmed,
  loadTranslateRestrictSettings,
  loadTierAndThinking,
  defaultTier,
  thinkingEnabled,
  TIER_MODELS,
  failedParagraphs,
  setFailedParagraphs,
  translationUsedThinking,
  setTranslationUsedThinking,
  type TranslateTier,
} from "../stores/translationStore";
import { TranslateError } from "../api/translate";
import { settings, jsonCodec, type Codec } from "@/settings";

// ── Scroll-driven hide/show constants ──
const BOTTOM_THRESHOLD = 80;

interface NovelProgress {
  paragraphIndex: number;
  charIndex: number;
  progress: number;
}

// 小说阅读进度：动态 key（novel_progress_${id}），localStorage 同步后端，
// 500ms 防抖落盘（registry debounceMs），旧数据为同一 key 的 JSON 字符串。
// validate 保持原 parseProgress 的业务校验（integer 且非负），坏数据回退默认值。
const novelProgressFactory = settings.defineFactory<NovelProgress>({
  keyPrefix: "novel_progress",
  default: { paragraphIndex: 0, charIndex: 0, progress: 0 },
  storage: "localStorage",
  debounceMs: 500,
  codec: jsonCodec as Codec<NovelProgress>,
  validate: (v): v is NovelProgress => {
    if (typeof v !== "object" || v === null) return false;
    const p = v as Record<string, unknown>;
    return (
      Number.isInteger(p.paragraphIndex) &&
      Number.isInteger(p.charIndex) &&
      (p.paragraphIndex as number) >= 0 &&
      (p.charIndex as number) >= 0 &&
      typeof p.progress === "number"
    );
  },
});

interface NovelImageBlockProps {
  block: ImageBlock;
  containerWidth: Accessor<number>;
  dimensions: Accessor<NovelImageDimensions>;
  style?: Record<string, string>;
  onClick: () => void;
}

const NovelImageBlock: Component<NovelImageBlockProps> = (props) => {
  const dim = createMemo(() => props.dimensions()[props.block.imageId]);
  const aspectRatio = createMemo(() => {
    const d = dim();
    if (d && d.width > 0 && d.height > 0) {
      return `${d.width} / ${d.height}`;
    }
    return "16 / 9";
  });

  function handleClick() {
    if (dim()) {
      props.onClick();
    }
  }

  return (
    <figure
      class="novel-image-block overflow-hidden m-0"
      classList={{ "cursor-pointer": dim() !== null && dim() !== undefined }}
      style={{ "aspect-ratio": aspectRatio() }}
      onClick={handleClick}
    >
      <Switch>
        <Match when={dim() === undefined}>
          <div
            class="w-full h-full flex flex-col items-center justify-center gap-1.5"
            style={{
              background:
                "linear-gradient(90deg, var(--colorNeutralBackground2) 25%, var(--colorNeutralBackground1) 50%, var(--colorNeutralBackground2) 75%)",
              "background-size": "200% 100%",
              animation: "fluent-shimmer var(--durationSlower) var(--curveEasyEase) infinite",
            }}
          >
            <span class="spinner w-4 h-4" />
            <span class="text-[var(--colorNeutralForegroundDisabled)] [font-size:var(--fontSizeBase100)]">
              加载中...
            </span>
          </div>
        </Match>
        <Match when={dim() === null}>
          <div
            class="w-full h-full flex flex-col items-center justify-center gap-1"
            style={{ "background-color": "var(--colorNeutralBackground2)" }}
          >
            <span class="text-[var(--colorNeutralForeground3)] text-xs">⚠</span>
            <span class="text-[var(--colorNeutralForegroundDisabled)] [font-size:var(--fontSizeBase100)]">
              图片加载失败
            </span>
          </div>
        </Match>
        <Match when={dim()}>
          {(d) => (
            <PixivImage
              src={selectInlineImageUrl(props.block.urls, props.containerWidth())}
              alt={`内嵌图片 ${props.block.imageId}`}
              width={d().width}
              height={d().height}
              loading="lazy"
              class="w-full h-full object-cover"
            />
          )}
        </Match>
      </Switch>
    </figure>
  );
};

function resetNovelProgress(id: number) {
  novelProgressFactory.forId(id).set({ paragraphIndex: 0, charIndex: 0, progress: 0 });
}

function isTextBlock(block: NovelBlock): block is TextBlock {
  return block.type === "text";
}

function isImageBlock(block: NovelBlock): block is ImageBlock {
  return block.type === "image";
}

interface NovelContentBlockProps {
  block: Accessor<NovelBlock>;
  imageBlockList: Accessor<ImageBlock[]>;
  imageDimensions: Accessor<NovelImageDimensions>;
  containerWidth: Accessor<number>;
  fontSize: Accessor<number>;
  paragraphHeight: number | undefined;
  onImageClick: (index: number) => void;
  renderParagraph: (paragraphIndex: number, text: string) => JSX.Element;
}

const NovelContentBlock: Component<NovelContentBlockProps> = (props) => {
  const block = props.block();

  if (isTextBlock(block)) {
    const minH = props.paragraphHeight;
    return (
      <p
        class="novel-text-paragraph"
        style={{
          "text-indent": `${props.fontSize() * 2}px`,
          ...(minH != null ? { "min-height": `${minH}px` } : {}),
        }}
      >
        {props.renderParagraph(block.index, block.text)}
      </p>
    );
  }

  if (isImageBlock(block)) {
    const imageIndex = props.imageBlockList().findIndex((b) => b.imageId === block.imageId);
    return (
      <NovelImageBlock
        block={block}
        containerWidth={props.containerWidth}
        dimensions={props.imageDimensions}
        style={{}}
        onClick={() => props.onImageClick(imageIndex)}
      />
    );
  }
};

const NovelDetail: Component = () => {
  const params = useParams();
  const navigate = useNavigate();

  function handleBack() {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      void navigate("/home");
    }
  }

  // 系列内切换只更新内部小说 ID，不 navigate，避免污染浏览器历史栈。
  // 入口 URL 对应的 params.id 作为初始值，后续章节/目录跳转都通过这里。
  let skipRestoreProgress = false;

  const [currentNovelId, setCurrentNovelId] = createSignal(Number(params.id));
  const novelId = currentNovelId;

  function switchNovel(id: number) {
    skipRestoreProgress = true;
    setCurrentNovelId(id);
  }

  // URL 参数变化时同步内部小说 ID（外部链接/前进后退），系列内切换不触发此效果。
  createEffect(() => {
    const paramId = Number(params.id);
    if (paramId && paramId !== currentNovelId()) {
      setCurrentNovelId(paramId);
    }
  });

  const [novelData, setNovelData] = createSignal<PixivNovel | null>(null);
  const [novelHtml, setNovelHtml] = createSignal<string | null>(null);
  const [novelImages, setNovelImages] = createSignal<NovelImagesMap>({});
  const [novelNav, setNovelNav] = createSignal<SeriesNavigation | null>(null);
  const [detailLoading, setDetailLoading] = createSignal(false);
  const [detailError, setDetailError] = createSignal<ApiError | null>(null);

  function applyEntry(entry: NovelCacheEntry) {
    batch(() => {
      setNovelData(entry.detail);
      setNovelHtml(entry.text);
      setNovelImages(entry.images ?? {});
      setNovelNav(entry.nav);
      setDetailLoading(false);
      setDetailError(null);
    });
    recordVisit(entry.detail, "novel");
  }

  let loadGeneration = 0;

  async function loadNovelById(id: number, generation: number) {
    if (!id) {
      return;
    }
    const cached = peekEntry(id);
    if (cached) {
      if (loadGeneration !== generation) return;
      applyEntry(cached);
      return;
    }
    setDetailLoading(true);
    setDetailError(null);
    const [novelErr] = await tryAsync(
      (async () => {
        const dbEntry = await getEntry(id);
        if (dbEntry) {
          if (loadGeneration !== generation) return;
          applyEntry(dbEntry);
          return;
        }
        const entry = await loadNovelEntry(id);
        if (loadGeneration !== generation) return;
        applyEntry(entry);
      })(),
    );
    if (novelErr) {
      if (loadGeneration !== generation) return;
      setDetailError(toApiError(novelErr));
      setDetailLoading(false);
    }
  }

  // 组件内加载小说数据：currentNovelId 变化时自动请求（首次加载 + 系列内切换）
  createEffect(() => {
    const id = currentNovelId();
    if (!id) {
      return;
    }
    // 已加载该 ID 的数据时跳过
    if (novelData()?.id === id) {
      return;
    }
    const gen = ++loadGeneration;
    void loadNovelById(id, gen);
  });

  const [imageDimensions, setImageDimensions] = createSignal<NovelImageDimensions>({});
  const [footerHidden, setFooterHidden] = createSignal(false);

  // 小说 ID 变化或图片映射重置时，清空已计算的内嵌图尺寸
  createEffect(() => {
    novelImages();
    setImageDimensions({});
  });

  // 加载出错时允许下次恢复阅读进度
  createEffect(() => {
    if (detailError()) {
      skipRestoreProgress = false;
    }
  });

  // 小说正文加载完成后恢复阅读进度
  createEffect(() => {
    const html = novelHtml();
    if (html && html.length > 0) {
      requestAnimationFrame(() => restoreProgress());
    }
  });

  // 获取到图片映射后，预加载每张内嵌图的真实尺寸
  createEffect(() => {
    const images = novelImages();
    const ids = Object.keys(images);
    if (ids.length === 0) {
      return;
    }

    let cancelled = false;
    loadNovelImageDimensions(images).then((dimensions) => {
      if (!cancelled) {
        setImageDimensions(dimensions);
      }
    });

    onCleanup(() => {
      cancelled = true;
    });
  });

  const [settingsOpen, setSettingsOpen] = createSignal(false);
  const [showComments, setShowComments] = createSignal(false);
  const [seriesOpen, setSeriesOpen] = createSignal(false);
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [textContainerWidth, setTextContainerWidth] = createSignal(0);

  const blocks = createMemo<NovelBlock[]>(() => {
    return parseNovelBlocks(novelHtml() ?? "", novelImages());
  });

  const searchText = createMemo(() => buildSearchText(blocks()));

  // ── AI 翻译（S1 最小闭环）──
  // 译文注入：显示译文时替换 TextBlock.text（只改文本，绝不改写 novelHtml，见代码事实核查）
  const displayBlocks = createMemo<NovelBlock[]>(() => {
    const bs = blocks();
    if (!showTranslation()) {
      return bs;
    }
    const t = translatedParagraphs();
    if (Object.keys(t).length === 0) {
      return bs;
    }
    // oxlint-disable-next-line no-map-spread -- blocks are immutable; copy-on-write required to swap in translated text
    return bs.map((b) =>
      b.type === "text" && t[b.index] !== undefined ? { ...b, text: t[b.index] } : b,
    );
  });

  // 源语言为中文时隐藏翻译入口（规格 US25）
  const canTranslate = createMemo(() => detectNovelLanguage(searchText()) !== "zh");
  const [translateOpen, setTranslateOpen] = createSignal(false);
  /** 详情页临时档位（S7）：null = 跟随设置页全局默认档；临时切换不污染全局 */
  const [translateTier, setTranslateTier] = createSignal<TranslateTier | null>(null);

  function handleSelectTier(tier: TranslateTier | null): void {
    setTranslateTier(tier);
    // 档位变化 → 旧档位译文不再适用，重置翻译状态（重新翻译；缓存按档位隔离）
    resetTranslationState();
  }

  // 竞态防护 generation counter：必须声明在引用它的 createEffect 之前（TDZ）
  let translateVersion = 0;
  /** 在途翻译的 AbortController（切章/离开中止，S2） */
  let translateAbort: AbortController | null = null;
  /** 首次翻译 R18/R18G 的风险确认弹窗（promise 化，S5） */
  const [restrictConfirm, setRestrictConfirm] = createSignal<{
    xRestrict: number;
    resolve: (ok: boolean) => void;
  } | null>(null);

  function confirmTranslateRestrict(xRestrict: number): Promise<boolean> {
    return new Promise((resolve) => setRestrictConfirm({ xRestrict, resolve }));
  }

  function resolveRestrictConfirm(ok: boolean): void {
    const c = restrictConfirm();
    if (c) {
      c.resolve(ok);
      setRestrictConfirm(null);
    }
  }

  // 挂载时恢复已保存的 API key、R18/R18G 分级开关、档位与思考开关
  // （冷启动直接进详情页也能用已存配置，避免 R18 开关已开却因内存默认 false 被误拦）
  onMount(() => {
    void loadDsApiKey();
    void loadTranslateRestrictSettings();
    void loadTierAndThinking();
  });

  // 切章 / URL 变化时重置翻译状态（防旧章译文串章污染）；
  // 必须同时递增 translateVersion + abort + 取消挂起确认弹窗 —— 在途翻译响应/挂起确认
  // 到达时版本不匹配 → 丢弃（竞态防护，含 S5 确认期间切章绕过 R18G 拦截的封堵）
  createEffect(() => {
    void currentNovelId();
    translateVersion++;
    translateAbort?.abort();
    translateAbort = null;
    resolveRestrictConfirm(false); // 挂起的 R18/R18G 确认直接取消（旧 resolve 不悬挂）
    resetTranslationState();
    onCleanup(() => {
      // 组件卸载后响应落地同样丢弃（store 是模块级全局，必须防写入）；
      // 卸载时取消挂起的 R18/R18G 确认（旧 resolve 不悬挂）
      translateVersion++;
      translateAbort?.abort();
      resolveRestrictConfirm(false);
    });
  });

  async function startTranslate(retryFailed = false): Promise<void> {
    const key = dsApiKey();
    if (!key) {
      setTranslateOpen(false);
      void navigate("/settings");
      return;
    }
    if (translating()) {
      return;
    }
    if (restrictConfirm()) {
      // 确认弹窗挂起期间重复点击：忽略（避免覆盖旧 resolve 造成 Promise 悬挂）
      return;
    }
    // version 提前递增：确认弹窗 await 期间切章 → version 不匹配 → 后续全部中止
    const version = ++translateVersion;

    // 敏感内容分级（S5）：R18/R18G 未开开关 → 客户端拦截（不发送任何内容）
    const xRestrict = novelData()?.x_restrict ?? 0;
    const policy = decideTranslatePolicy(xRestrict, translateR18(), translateR18G());
    if (policy === "block") {
      setTranslateOpen(true);
      setTranslationError(
        new TranslateError(
          "unknown",
          xRestrict === 2
            ? "未开启「翻译 R18G 内容」开关，已拦截（不发送任何内容）"
            : "未开启「翻译 R18 内容」开关，已拦截",
        ),
      );
      return;
    }
    // 首次翻译 R18/R18G 二次确认（#23：开开关 + 首次翻译各一次）
    if ((xRestrict === 1 || xRestrict === 2) && !getR18Confirmed()) {
      const ok = await confirmTranslateRestrict(xRestrict);
      if (!ok) {
        return;
      }
      await markR18Confirmed();
      // 确认期间可能切章（version 已递增）或分级开关变化：重新校验，防止旧章校验结果
      // 被新章（尤其 R18G）复用而绕过客户端拦截
      if (version !== translateVersion) {
        return;
      }
      const currentPolicy = decideTranslatePolicy(
        novelData()?.x_restrict ?? 0,
        translateR18(),
        translateR18G(),
      );
      if (currentPolicy === "block") {
        setTranslateOpen(true);
        setTranslationError(
          new TranslateError("unknown", "内容分级校验未通过，已拦截（不发送任何内容）"),
        );
        return;
      }
    }

    // 目标段落：全量翻译或补翻失败段落（S4 断点续翻）
    const allTexts = blocks()
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text);
    const allIndexes = blocks()
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.index);
    if (allTexts.length === 0) {
      return;
    }
    const failedNow = new Set<number>(failedParagraphs());
    const pairs = allTexts.map((text, i) => ({ index: allIndexes[i], text }));
    const targets = retryFailed ? pairs.filter((p) => failedNow.has(p.index)) : pairs;
    if (targets.length === 0) {
      return; // 补翻模式但没有失败段落
    }
    const texts = targets.map((t) => t.text);
    const baseIndexes = targets.map((t) => t.index);

    // 档位（S6 全局默认 + S7 详情页临时切换）：缓存维度与请求 model 统一用实际档位
    const model = TIER_MODELS[translateTier() ?? defaultTier()];
    // 缓存策略：思考模式读/写都跳过（语义污染）；补翻模式跳过读（失败块无缓存）但
    // 允许写（补翻全成功后固化完整译文，避免下次全量重翻重复计费——review 发现）
    const skipReadCache = thinkingEnabled() || retryFailed;
    const skipWriteCache = thinkingEnabled();

    // 缓存命中（决策 #24）：原文 hash 未变 → 直接读译文，不发请求（思考/补翻模式除外）
    const { default: SparkMD5 } = await import("spark-md5");
    const sourceHash = SparkMD5.hash(allTexts.join("\n"));
    const cached = skipReadCache
      ? undefined
      : await getTranslation(novelId(), DEFAULT_TARGET_LANG, model, sourceHash);
    if (cached && cached.length > 0) {
      const map: Record<number, string> = {};
      for (let i = 0; i < cached.length && i < allIndexes.length; i++) {
        map[allIndexes[i]] = cached[i];
      }
      batch(() => {
        setTranslatedParagraphs(map);
        setShowTranslation(true);
        setTranslationError(null); // 清掉上次失败的错误提示
      });
      return;
    }

    // 分块管线（S2）：AbortController 取消 + 渐进注入
    translateAbort = new AbortController();
    const controller = translateAbort;
    setTranslating(true);
    setTranslationError(null);
    setTranslationProgress({ done: 0, total: 0 });
    if (thinkingEnabled()) {
      // 本章发生过思考翻译 → 后续任何写缓存都必须跳过（防思考译文混入非思考缓存）
      setTranslationUsedThinking(true);
    }
    try {
      const sourceLang = detectNovelLanguage(allTexts.join("\n"));
      const priorityParagraph = virtualLayout.currentCharIndex()?.paragraphIndex;
      let fallbackBlocks = 0; // 回退原文块（段数不足，阻止缓存固化）
      await translateNovel(
        texts,
        {
          apiKey: key,
          model,
          sourceLang: sourceLang === "other" ? undefined : sourceLang,
          signal: controller.signal,
          priorityParagraph,
          thinking: thinkingEnabled(), // S6：思考开关（默认关）
        },
        (p) => {
          if (version !== translateVersion) {
            return;
          }
          if (p.fallback) {
            fallbackBlocks++;
          }
          setTranslationProgress({ done: p.done, total: p.total });
          if (p.paragraphs.length === 0) {
            // 失败块：该区间段落标记「未翻译」（相对 index → 全局），供补翻
            for (let i = p.start; i < p.end; i++) {
              failedNow.add(baseIndexes[i]);
            }
            return;
          }
          // 回退原文段（段数不足）同样标记「未翻译」（相对 → 全局）
          const fallbackRel = new Set(p.fallbackIndexes ?? []);
          for (const rel of fallbackRel) {
            failedNow.add(baseIndexes[rel]);
          }
          // 成功块：译文并入（相对 → 全局），并从失败集合移除（补翻成功；
          // 注意：回退段需排除——它们的 text 是原文占位，不能被误判为补翻成功）
          batch(() => {
            setTranslatedParagraphs((prev) => {
              const next = { ...prev };
              for (const para of p.paragraphs) {
                const global = baseIndexes[para.index];
                next[global] = para.text;
                if (!fallbackRel.has(para.index)) {
                  failedNow.delete(global);
                }
              }
              return next;
            });
          });
          if (!showTranslation()) {
            setShowTranslation(true);
          }
        },
      );
      if (version !== translateVersion) {
        return;
      }
      setFailedParagraphs(new Set(failedNow));
      setShowTranslation(true);
      // 全部目标块成功、无失败/回退 → 写全量缓存（半成品不写，决策 #24；
      // 本章用过思考翻译 → 跳过（思考译文不得混入非思考缓存，review 决策））
      const complete = failedNow.size === 0 && fallbackBlocks === 0;
      if (!skipWriteCache && complete && !translationUsedThinking()) {
        const fullMap = translatedParagraphs();
        const allCovered = allIndexes.every((idx) => fullMap[idx] !== undefined);
        if (allCovered) {
          await setTranslation(
            novelId(),
            DEFAULT_TARGET_LANG,
            model,
            sourceHash,
            allTexts.map((_, i) => fullMap[allIndexes[i]] ?? allTexts[i]),
          );
        }
      }
    } catch (err) {
      if (version !== translateVersion || controller.signal.aborted) {
        return;
      }
      setTranslationError(
        err instanceof TranslateError ? err : new TranslateError("unknown", "翻译失败，请重试"),
      );
    } finally {
      if (version === translateVersion) {
        setTranslating(false);
        setTranslationProgress(null);
      }
    }
  }

  const virtualLayout = createNovelVirtualLayout({
    blocks: displayBlocks,
    containerWidth: textContainerWidth,
    settings: () => ({
      fontSize: fontSize(),
      fontWeight: fontWeight(),
      fontFamily: fontFamily(),
      fontColor: "",
      lineHeight: lineHeight(),
      bgColor: "",
    }),
    imageDimensions,
    containerRef: () => {},
    novelId,
    useWindowScroll: true,
    translationVariant: () => (showTranslation() ? "translated" : undefined),
  });

  // 将 pretext 计算的段落高度注入 block 对象——数组引用变化后 <For> 自动重 render。
  const blocksWithHeights = createMemo(() => {
    const layout = virtualLayout.layoutResult();
    const h: Record<number, number> = {};
    for (const p of layout.paragraphs) {
      h[p.index] = p.height;
    }
    // oxlint-disable-next-line no-map-spread -- blocks are immutable; we need shallow copies to trigger <For> re-render
    return displayBlocks().map((b) => ({
      ...b,
      ph: b.type === "text" ? h[(b as TextBlock).index] : undefined,
    }));
  });

  const search = createNovelSearch(searchText, { debounceMs: 150 });

  function renderParagraphWithHighlights(paragraphIndex: number, text: string): JSX.Element {
    const matches = search.getMatchesForParagraph(paragraphIndex);
    const activeIndex = search.activeIndex();
    const allMatches = search.matches();
    const activeMatch =
      activeIndex >= 0 && activeIndex < allMatches.length ? allMatches[activeIndex] : null;

    if (matches.length === 0) {
      return <>{text}</>;
    }

    const nodes: JSX.Element[] = [];
    let lastEnd = 0;

    for (const match of matches) {
      if (match.start > lastEnd) {
        nodes.push(text.slice(lastEnd, match.start));
      }
      const isActive =
        activeMatch != null &&
        match.paragraphIndex === activeMatch.paragraphIndex &&
        match.start === activeMatch.start &&
        match.end === activeMatch.end;
      nodes.push(
        <mark class="novel-search-match" classList={{ "novel-search-match-active": isActive }}>
          {text.slice(match.start, match.end)}
        </mark>,
      );
      lastEnd = match.end;
    }

    if (lastEnd < text.length) {
      nodes.push(text.slice(lastEnd));
    }

    return <>{nodes}</>;
  }

  /**
   * 渲染段落：包装高亮渲染，译文模式下失败段落追加「未翻译」标记（S4）。
   * 失败段落 map 无译文 → text 为原文；标记引导用户知晓该段未翻译、可补翻。
   */
  function renderParagraph(paragraphIndex: number, text: string): JSX.Element {
    const isFailed = showTranslation() && failedParagraphs().has(paragraphIndex);
    const content = renderParagraphWithHighlights(paragraphIndex, text);
    if (!isFailed) {
      return content;
    }
    return (
      <>
        {content}
        <span class="[font-size:var(--fontSizeBase100)] text-[var(--colorStatusDangerForeground1)] ml-1 align-super">
          〔未翻译〕
        </span>
      </>
    );
  }

  // ── 阅读进度持久化 ──
  // 外层 setTimeout 防抖：effect 触发时只调度，不在响应式求值中同步读布局（避免自激循环）；
  // 落盘侧的 500ms 合并由 settings registry 的 debounceMs 负责。
  let progressSaveTimer: ReturnType<typeof setTimeout> | undefined;
  function saveProgress() {
    if (progressSaveTimer) {
      clearTimeout(progressSaveTimer);
    }
    progressSaveTimer = setTimeout(() => {
      const current = virtualLayout.currentCharIndex();
      const layout = virtualLayout.layoutResult();
      const layoutParagraphs = layout.paragraphs;
      const totalChars = layoutParagraphs.reduce(
        (sum, p) =>
          sum + p.lineRanges.reduce((lineSum, line) => lineSum + (line.end - line.start), 0),
        0,
      );
      const currentOffset =
        layoutParagraphs
          .slice(0, current.paragraphIndex)
          .reduce(
            (sum, p) =>
              sum + p.lineRanges.reduce((lineSum, line) => lineSum + (line.end - line.start), 0),
            0,
          ) + current.charIndex;
      const progress = totalChars > 0 ? currentOffset / totalChars : 0;
      novelProgressFactory.forId(novelId()).set({
        paragraphIndex: current.paragraphIndex,
        charIndex: current.charIndex,
        progress,
      });
    }, 500);
  }

  function restoreProgress() {
    if (skipRestoreProgress) {
      skipRestoreProgress = false;
      return;
    }
    const progressHandle = novelProgressFactory.forId(novelId());
    // 同步读已存进度（localStorage 同步后端；factory handle 懒创建，首次需手动读）
    progressHandle.syncInit();
    const saved = progressHandle.value();
    // 默认值（无记录或初始进度）不恢复
    if (saved.paragraphIndex === 0 && saved.charIndex === 0 && saved.progress === 0) {
      return;
    }
    const layout = virtualLayout.layoutResult();
    const layoutParagraphs = layout.paragraphs;
    if (saved.paragraphIndex >= layoutParagraphs.length) {
      return;
    }
    const paragraph = layoutParagraphs[saved.paragraphIndex];
    if (!paragraph) {
      return;
    }
    const maxCharIndex =
      paragraph.lineRanges[paragraph.lineRanges.length - 1]?.end ?? paragraph.height;
    if (saved.charIndex > maxCharIndex) {
      return;
    }
    virtualLayout.scrollToCharIndex(saved.paragraphIndex, saved.charIndex);
  }

  // 滚动停止 500ms 后保存阅读进度
  createEffect(() => {
    virtualLayout.currentCharIndex();
    saveProgress();
  });

  function onTextContainerRef(el: HTMLElement) {
    if (!el) {
      return;
    }
    setTextContainerWidth(el.clientWidth);
    virtualLayout.containerRef(el);

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setTextContainerWidth(entry.contentRect.width);
      }
    });
    ro.observe(el);

    onCleanup(() => ro.disconnect());
  }

  // 将阅读设置面板状态注册到 overlay 栈
  createEffect(() => {
    if (settingsOpen()) {
      pushOverlay("readerSettingsSheet", () => setSettingsOpen(false));
      onCleanup(() => {
        popOverlay("readerSettingsSheet");
      });
    }
  });

  // 将系列目录面板状态注册到 overlay 栈
  createEffect(() => {
    if (seriesOpen()) {
      pushOverlay("seriesSheet", () => setSeriesOpen(false));
      onCleanup(() => {
        popOverlay("seriesSheet");
      });
    }
  });

  // 将评论面板状态注册到 overlay 栈
  createEffect(() => {
    if (showComments()) {
      pushOverlay("commentSheet", () => setShowComments(false));
      onCleanup(() => {
        popOverlay("commentSheet");
      });
    }
  });

  // ── Scroll-driven bottom toolbar hide/show ──
  const { direction: scrollDirection, reset: resetScrollDirection } = createScrollBehavior({
    directionThreshold: 30,
    accumulate: true,
  });
  const scroll = createScrollPosition();
  createEffect(() => {
    const y = scroll.y;
    const atBottom =
      window.innerHeight + y >= document.documentElement.scrollHeight - BOTTOM_THRESHOLD;
    if (atBottom) {
      setFooterHidden(false);
      return;
    }
    const d = scrollDirection();
    if (d === "down") setFooterHidden(true);
    else if (d === "up") setFooterHidden(false);
  });

  function openSearch() {
    setSearchOpen(true);
  }

  function closeSearch() {
    setSearchOpen(false);
    search.clearSearch();
  }

  // 切换小说时自动关闭搜索、清空高亮，并滚动到页面顶部，重置底部栏显隐状态
  createEffect(() => {
    currentNovelId();
    closeSearch();
    scrollToTop();
    setFooterHidden(false);
    untrack(() => resetScrollDirection());
  });

  const [titleEl, setTitleEl] = createSignal<HTMLHeadingElement | undefined>();
  const titleVisible = createVisibilityObserver({ rootMargin: NOVEL_INTERACTIVE_MARGIN })(() =>
    titleEl(),
  );
  const showHeaderTitle = createMemo(() => !titleVisible());
  const [imageViewerOpen, setImageViewerOpen] = createSignal(false);
  const [imageViewerIndex, setImageViewerIndex] = createSignal(0);

  // 将图片查看器状态注册到 overlay 栈
  createEffect(() => {
    if (imageViewerOpen()) {
      pushOverlay("viewer", () => setImageViewerOpen(false));
      onCleanup(() => {
        popOverlay("viewer");
      });
    }
  });

  const imageBlockList = createMemo(() => getImageBlocks(blocks()));
  const imageViewerUrls = createMemo(() => imageBlockList().map((block) => block.urls.original));

  // ── 正文渲染（虚拟化逻辑）──
  const renderBody = () => (
    <>
      <Show when={novelHtml()}>
        <div
          class="novel-text"
          ref={onTextContainerRef}
          style={{
            ...readerStyle(),
          }}
        >
          {/* 虚拟滚动：只渲染视口 ±5 段内的块，上下用撑杆占位保持滚动条正确 */}
          {(() => {
            const all = blocksWithHeights();
            const vis = virtualLayout.visibleBlocks();
            if (vis.length === 0 || all.length === 0) {
              return null;
            }
            const first = virtualLayout.getBlockLayout(vis[0]);
            const last = virtualLayout.getBlockLayout(vis[vis.length - 1]);
            const topH = first?.offset ?? 0;
            const bottomH = last ? virtualLayout.totalHeight() - (last.offset + last.height) : 0;
            return (
              <>
                <div style={{ height: `${Math.max(0, topH)}px` }} aria-hidden="true" />
                <For each={vis}>
                  {(idx) => {
                    const block = all[idx];
                    if (!block) {
                      return null;
                    }
                    return (
                      <NovelContentBlock
                        block={() => block}
                        imageBlockList={imageBlockList}
                        imageDimensions={imageDimensions}
                        containerWidth={textContainerWidth}
                        fontSize={fontSize}
                        paragraphHeight={block.ph}
                        onImageClick={(imageIndex) => {
                          setImageViewerIndex(imageIndex);
                          setImageViewerOpen(true);
                        }}
                        renderParagraph={renderParagraph}
                      />
                    );
                  }}
                </For>
                <div style={{ height: `${Math.max(0, bottomH)}px` }} aria-hidden="true" />
              </>
            );
          })()}
        </div>
      </Show>
      <Show when={detailLoading() && !novelHtml()}>
        <div class="space-y-3 animate-pulse">
          {Array.from({ length: 6 }).map(() => (
            <div class="h-4 bg-[var(--colorNeutralBackground2)] rounded-[var(--borderRadiusSmall)]" />
          ))}
        </div>
      </Show>
    </>
  );

  // ── 底部导航 props ──
  const footerNavProps = () => ({
    novel: novelData()!,
    novelNav: novelNav(),
    footerHidden: footerHidden(),
    onPrevChapter: (id: number) => switchNovel(id),
    onNextChapter: (id: number) => switchNovel(id),
    onOpenSeries: () => setSeriesOpen(true),
    onOpenSettings: () => setSettingsOpen(true),
    showTranslateEntry: canTranslate(),
    translated: Object.keys(translatedParagraphs()).length > 0,
    showTranslation: showTranslation(),
    onToggleTranslate: () => {
      if (Object.keys(translatedParagraphs()).length > 0) {
        setShowTranslation((v) => !v);
      } else {
        setTranslateOpen(true);
      }
    },
  });

  return (
    <PageTransition>
      <div class="min-h-screen bg-[var(--colorNeutralBackground2)]">
        {/* ── 顶部栏 — A2 卡片式（ADR-0072）── */}
        <NovelTopBar
          title={novelData()?.title ?? ""}
          showTitle={showHeaderTitle}
          searchOpen={searchOpen}
          onBack={handleBack}
          onOpenSearch={openSearch}
          onDoubleClick={() => {
            resetNovelProgress(novelId());
            scrollToTop();
          }}
          searchBar={
            <NovelSearchBar
              query={search.query}
              setQuery={search.setQuery}
              matchCount={search.matchCount}
              activeIndex={search.activeIndex}
              onPrev={search.prevMatch}
              onNext={search.nextMatch}
              onClose={closeSearch}
            />
          }
        />

        {/* ── Loading state：全页骨架屏 ── */}
        <Show when={detailLoading() && !novelData()}>
          <NovelDetailSkeleton />
        </Show>

        {/* ── Error state ── */}
        <Show when={detailError()}>
          <ErrorDisplay error={detailError()!} onRetry={() => window.location.reload()} />
        </Show>

        {/* ── Content ── */}
        <Show when={novelData()}>
          {(novel) => (
            <>
              <NovelCoverCard
                novel={novel()}
                onAuthorClick={() => void navigate(`/user/${novel().user.id}`)}
                onSeriesClick={() => setSeriesOpen(true)}
                onCommentsClick={() => setShowComments(true)}
                onTitleRef={setTitleEl}
              />

              {/* ── Text content（renderBody）── */}
              <div class="px-4 py-6 max-w-2xl mx-auto pb-[64px]">{renderBody()}</div>

              {/* 底部导航 — A2 卡片条（NovelFooterNav 自带，ADR-0072） */}
              <NovelFooterNav {...footerNavProps()} />
            </>
          )}
        </Show>

        {/* ── 浮层（页面级：阅读设置/翻译/系列/评论/查看器）── */}

        <ReaderSettingsSheet isOpen={settingsOpen()} onClose={() => setSettingsOpen(false)} />

        <TranslateSheet
          isOpen={translateOpen()}
          onClose={() => setTranslateOpen(false)}
          onStartTranslate={(retryFailed) => void startTranslate(retryFailed ?? false)}
          tier={translateTier()}
          defaultTier={defaultTier()}
          onSelectTier={handleSelectTier}
        />

        {/* 首次翻译 R18/R18G 风险确认（S5，决策 #23） */}
        <Show when={restrictConfirm()}>
          {(c) => (
            <FluentDialog
              open
              onClose={() => resolveRestrictConfirm(false)}
              aria-label={c().xRestrict === 2 ? "翻译 R18G 内容？" : "翻译 R18 内容？"}
            >
              <h3 slot="title">
                {c().xRestrict === 2 ? "翻译 R18G 内容？（法律红线）" : "翻译 R18 内容？"}
              </h3>
              <Show
                when={c().xRestrict === 2}
                fallback={
                  <p>
                    该作品包含 R18 内容。翻译需将正文发送至你选择的 AI 服务商，可能：①
                    被内容审核拒绝（失败段落保留原文）；② 违反服务商使用条款，导致你的 API
                    账号被警告、暂停或封禁；③
                    内容可能被去标识化后用于模型训练。所有风险由你自行承担。
                  </p>
                }
              >
                <p>
                  该作品包含 R18G（极端）内容。除上述风险外，此类内容违反法律法规红线，可能导致你的
                  API 账号被关闭，服务商可能向主管部门/执法机构报告。App
                  提供方不承担由此产生的任何责任。
                </p>
              </Show>
              <fluent-button
                slot="actions"
                appearance="secondary"
                on:click={() => resolveRestrictConfirm(false)}
              >
                取消
              </fluent-button>
              <fluent-button
                slot="actions"
                appearance="primary"
                on:click={() => resolveRestrictConfirm(true)}
              >
                我已了解并继续
              </fluent-button>
            </FluentDialog>
          )}
        </Show>

        <Show when={novelData()?.series?.id}>
          <SeriesSheet
            seriesId={novelData()!.series!.id}
            seriesTitle={novelData()!.series!.title}
            authorName={novelData()!.user.name}
            authorId={novelData()!.user.id}
            isOpen={seriesOpen()}
            onClose={() => setSeriesOpen(false)}
            onNovelSelect={(id) => switchNovel(id)}
            onAuthorClick={() => void navigate(`/user/${novelData()!.user.id}`)}
            activeNovelId={currentNovelId()}
          />
        </Show>

        <Show when={imageViewerOpen() && imageViewerUrls().length > 0}>
          <ImageViewer
            imageUrls={imageViewerUrls()}
            initialPage={imageViewerIndex()}
            onClose={() => setImageViewerOpen(false)}
          />
        </Show>

        <CommentOverlay
          type="novel"
          targetId={novelData()!.id}
          isOpen={showComments()}
          onClose={() => setShowComments(false)}
        />
      </div>
    </PageTransition>
  );
};

export default NovelDetail;
