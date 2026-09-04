import type { Accessor } from "solid-js";
import {
  Virtualizer,
  observeWindowRect,
  observeWindowOffset,
  windowScroll,
} from "@tanstack/solid-virtual";
import type { Virtualizer as TVirtualizer } from "@tanstack/solid-virtual";
import type { ReaderSettings } from "@/stores/readerSettingsStore";
import type { NovelBlock, TextBlock } from "@/utils/novelBlocks";
import type { NovelImageDimensions } from "@/utils/novelImageDimensions";
import {
  createNovelTextLayout,
  type NovelTextLayoutResult,
  type ParagraphLayout,
} from "./createNovelTextLayout";
import { getNovelTextLayoutCache } from "./novelTextLayoutCache";
import { isPretextSupported } from "./isPretextSupported";

interface CreateNovelVirtualLayoutOptions {
  blocks: Accessor<NovelBlock[]>;
  containerWidth: Accessor<number>;
  settings: Accessor<ReaderSettings>;
  imageDimensions: Accessor<NovelImageDimensions>;
  containerRef: (el: HTMLElement) => void;
  overscan?: number;
  novelId: Accessor<number>;
  useWindowScroll?: boolean;
  /** 译文维度标识（原文/译文布局分开缓存，防切换命中旧布局） */
  translationVariant?: Accessor<string | undefined>;
}

interface NovelVirtualLayoutResult {
  virtualizer: TVirtualizer<Window, HTMLElement>;
  totalHeight: Accessor<number>;
  visibleBlocks: Accessor<number[]>;
  scrollToCharIndex(paragraphIndex: number, charIndex: number): void;
  currentCharIndex: Accessor<{ paragraphIndex: number; charIndex: number }>;
  layoutResult: Accessor<NovelTextLayoutResult>;
  containerRef: (el: HTMLElement) => void;
  getBlockLayout(index: number): BlockLayout | undefined;
}

const DEFAULT_OVERSCAN = 5;
const IMAGE_FALLBACK_HEIGHT = 160;
const PAGEBREAK_HEIGHT_RATIO = 3;
/** 章节标题块高度（标题字号大、上下留白，约 4 倍段距） */
const CHAPTER_HEIGHT_RATIO = 4;
/** 跳转链接块高度（单行，约 2 倍段距） */
const JUMP_HEIGHT_RATIO = 2;

interface BlockLayout {
  index: number;
  offset: number;
  height: number;
  block: NovelBlock;
  textParagraph?: ParagraphLayout;
}

function buildFallbackLayout(
  paragraphs: string[],
  settings: ReaderSettings,
  paragraphSpacing: number,
): NovelTextLayoutResult {
  const lineHeightPx = settings.fontSize * settings.lineHeight;
  const charsPerLine = Math.max(1, Math.floor(settings.fontSize * 20));
  const paragraphLayouts: ParagraphLayout[] = [];
  let offset = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const text = paragraphs[i];
    const lineCount = Math.max(1, Math.ceil(text.length / charsPerLine));
    const height = lineCount * lineHeightPx;
    paragraphLayouts.push({
      index: i,
      offset,
      height,
      lineCount,
      lineRanges: [{ start: 0, end: text.length, width: 0 }],
    });
    offset += height + paragraphSpacing;
  }

  const totalHeight = paragraphs.length > 0 ? offset - paragraphSpacing : 0;

  return {
    paragraphs: paragraphLayouts,
    totalHeight,
    lineHeightPx,
    getOffsetByCharIndex: (paragraphIndex) => {
      const paragraph = paragraphLayouts[paragraphIndex];
      return paragraph ? paragraph.offset : 0;
    },
    getCharIndexByOffset: (targetOffset) => {
      for (let i = paragraphLayouts.length - 1; i >= 0; i--) {
        const paragraph = paragraphLayouts[i];
        if (targetOffset >= paragraph.offset) {
          return { paragraphIndex: i, charIndex: 0 };
        }
      }
      return { paragraphIndex: 0, charIndex: 0 };
    },
  };
}

export function createNovelVirtualLayout(
  options: CreateNovelVirtualLayoutOptions,
): NovelVirtualLayoutResult {
  const [containerEl, setContainerEl] = createSignal<HTMLElement | undefined>();

  const paragraphSpacing = createMemo(() => {
    const settings = options.settings();
    return Math.max(settings.fontSize * 0.5, 8);
  });

  const textLayoutResult = createMemo<NovelTextLayoutResult>(() => {
    const blocks = options.blocks();
    const width = options.containerWidth();
    const settings = options.settings();
    const id = options.novelId();
    const spacing = paragraphSpacing();

    const textBlocks = blocks.filter((b): b is TextBlock => b.type === "text");
    const paragraphs = textBlocks.map((b) => b.text);

    if (width <= 0) {
      return {
        paragraphs: [],
        totalHeight: 0,
        lineHeightPx: settings.fontSize * settings.lineHeight,
        getOffsetByCharIndex: () => 0,
        getCharIndexByOffset: () => ({ paragraphIndex: 0, charIndex: 0 }),
      };
    }

    if (!isPretextSupported()) {
      return buildFallbackLayout(paragraphs, settings, spacing);
    }

    const cache = getNovelTextLayoutCache();
    const variant = options.translationVariant?.() ?? "";
    const cached = cache.get(id, width, settings, variant);
    if (cached) {
      return cached;
    }

    const result = createNovelTextLayout({
      paragraphs,
      containerWidth: width,
      fontSize: settings.fontSize,
      fontWeight: settings.fontWeight,
      fontFamily: settings.fontFamily,
      lineHeight: settings.lineHeight,
      paragraphSpacing: spacing,
      textIndent: settings.fontSize * 2,
    });

    cache.set(id, width, settings, result, variant);
    return result;
  });

  const blockLayouts = createMemo<BlockLayout[]>(() => {
    const blocks = options.blocks();
    const width = options.containerWidth();
    const dimensions = options.imageDimensions();
    const spacing = paragraphSpacing();
    const textLayout = textLayoutResult();

    if (width <= 0) {
      return [];
    }

    let offset = 0;
    let textIndex = 0;
    const layouts: BlockLayout[] = [];

    for (const block of blocks) {
      let height = 0;
      let textParagraph: ParagraphLayout | undefined;

      if (block.type === "text") {
        textParagraph = textLayout.paragraphs[textIndex++];
        height = textParagraph?.height ?? 0;
      } else if (block.type === "image") {
        const dim = dimensions[block.imageId];
        if (dim && dim.width > 0 && dim.height > 0) {
          height = (width * dim.height) / dim.width;
        } else {
          height = IMAGE_FALLBACK_HEIGHT;
        }
      } else if (block.type === "chapter") {
        height = spacing * CHAPTER_HEIGHT_RATIO;
      } else if (block.type === "jump") {
        height = spacing * JUMP_HEIGHT_RATIO;
      } else {
        height = spacing * PAGEBREAK_HEIGHT_RATIO;
      }

      layouts.push({ index: layouts.length, offset, height, block, textParagraph });
      offset += height + spacing;
    }

    return layouts;
  });

  const totalHeight = createMemo(() => {
    const layouts = blockLayouts();
    if (layouts.length === 0) {
      return 0;
    }
    const last = layouts[layouts.length - 1];
    return last.offset + last.height;
  });

  // ── TanStack Virtual: native Virtualizer ──
  const instance = new Virtualizer<Window, HTMLElement>({
    count: blockLayouts().length,
    estimateSize: (i: number) => blockLayouts()[i]?.height ?? 0,
    overscan: DEFAULT_OVERSCAN,
    gap: 0,
    getItemKey: (i: number) => i,
    getScrollElement: () => (typeof window !== "undefined" ? window : null),
    observeElementRect: observeWindowRect,
    observeElementOffset: observeWindowOffset,
    scrollToFn: windowScroll,
    scrollMargin: 0,
  } as any);

  const [vItems, setVItems] = createSignal<any[]>([]);
  const [vTotalSize, setVTotalSize] = createSignal(0);

  // Sync when blockLayouts changes + init observers
  createEffect(() => {
    const layouts = blockLayouts();
    if (layouts.length === 0) {
      setVItems([]);
      setVTotalSize(0);
      return;
    }
    const sm = containerEl() ? containerEl()!.offsetTop : 0;
    const spacing = paragraphSpacing();
    // Directly set scrollRect — skip _didMount which may not exist or may override
    if (typeof window !== "undefined") {
      (instance as any).scrollRect = { width: window.innerWidth, height: window.innerHeight };
    }
    instance.setOptions({
      count: layouts.length,
      estimateSize: (i: number) => layouts[i]?.height ?? 0,
      overscan: DEFAULT_OVERSCAN,
      gap: spacing,
      getItemKey: (i: number) => i,
      getScrollElement: () => (typeof window !== "undefined" ? window : null),
      observeElementRect: observeWindowRect,
      observeElementOffset: observeWindowOffset,
      scrollToFn: windowScroll,
      scrollMargin: sm,
    } as any);
    instance.measure();
    const items = instance.getVirtualItems();
    setVItems([...items] as any);
    setVTotalSize(instance.getTotalSize());
  });

  // Scroll listener
  createEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    // 全量重算（_willUpdate + 重建虚拟窗口）单次即可达主线程长任务量级，
    // 而 scroll 事件一帧内可触发 60~120 次；合并到 rAF 每帧至多重算一次，
    // flush 时读取当下的 window.scrollY（非事件捕获旧值），保证末态正确。
    let scrollRafId = 0;
    const onScroll = () => {
      if (scrollRafId !== 0) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = 0;
        (instance as any).scrollOffset = window.scrollY;
        (instance as any)._willUpdate?.();
        setVItems([...instance.getVirtualItems()] as any);
        setVTotalSize(instance.getTotalSize());
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onCleanup(() => {
      if (scrollRafId !== 0) {
        cancelAnimationFrame(scrollRafId);
        scrollRafId = 0;
      }
      window.removeEventListener("scroll", onScroll);
    });
  });

  const visibleBlocks = createMemo<number[]>(() => vItems().map((v) => v.index));

  // Proxy for external API compat
  const virtualizer = {
    getVirtualItems: () => vItems(),
    getTotalSize: () => vTotalSize(),
    scrollToOffset: (o: number) => {
      const scrollMargin = containerEl()?.offsetTop ?? 0;
      window.scrollTo({ top: scrollMargin + o, behavior: "auto" as ScrollBehavior });
    },
    get scrollOffset() {
      return window.scrollY;
    },
    takeSnapshot: () => instance.takeSnapshot(),
  } as any as TVirtualizer<Window, HTMLElement>;

  function scrollToCharIndex(paragraphIndex: number, charIndex: number) {
    const layouts = blockLayouts();
    const textLayout = textLayoutResult();
    const textParagraph = textLayout.paragraphs[paragraphIndex];
    if (!textParagraph) {
      return;
    }

    const block = layouts.find((l) => l.block.type === "text" && l.block.index === paragraphIndex);
    if (!block || !block.textParagraph) {
      return;
    }

    const charOffset =
      textLayout.getOffsetByCharIndex(paragraphIndex, charIndex) - textParagraph.offset;
    const offset = block.offset + charOffset;
    const scrollMargin = containerEl()?.offsetTop ?? 0;
    window.scrollTo({ top: scrollMargin + offset, behavior: "auto" });
  }

  const currentCharIndex = createMemo(() => {
    const layouts = blockLayouts();
    const scrollMargin = containerEl()?.offsetTop ?? 0;
    const st = window.scrollY - scrollMargin;
    const textLayout = textLayoutResult();

    let target: BlockLayout | undefined;
    let nearest: BlockLayout | undefined;

    for (const layout of layouts) {
      if (layout.block.type !== "text" || !layout.textParagraph) {
        continue;
      }
      nearest = layout;
      if (st >= layout.offset && st < layout.offset + layout.height) {
        target = layout;
        break;
      }
    }

    const textBlock = target ?? nearest;
    if (!textBlock || !textBlock.textParagraph) {
      return { paragraphIndex: 0, charIndex: 0 };
    }

    const localOffset = st - textBlock.offset;
    const textOnlyOffset = textBlock.textParagraph.offset + localOffset;
    const { charIndex } = textLayout.getCharIndexByOffset(textOnlyOffset);
    const blockIndex = textBlock.block.type === "text" ? textBlock.block.index : 0;
    return { paragraphIndex: blockIndex, charIndex };
  });

  function containerRef(el: HTMLElement) {
    setContainerEl(el);
    options.containerRef(el);
  }

  return {
    virtualizer,
    totalHeight,
    visibleBlocks,
    scrollToCharIndex,
    currentCharIndex,
    layoutResult: textLayoutResult,
    containerRef,
    getBlockLayout: (index: number) => blockLayouts()[index],
  };
}
