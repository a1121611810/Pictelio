import { createSignal, type Accessor } from "solid-js";

/**
 * 收藏面板全局状态（#545）：面板唯一实例挂 __root（BookmarkPanelHost），
 * 调用方（详情页 / feed 卡片 / 搜索卡片）经 openBookmarkPanel 唤起。
 *
 * seam 选择：调用方 ≥3 且横跨路由，props 钻透会污染 VirtualFeed 泛型接口，
 * 各路由自挂则同一面板多套宿主——模块级 store 收敛接线知识到一处。
 *
 * onSaved 无参契约（ADR-0160 D2）：保存恒为「收藏/覆盖」方向，真实收藏态
 * 以调用方自身状态为准——详情页写 illust 快照，卡片置本地 signal + 爆发动效。
 */

/** 面板打开请求：目标作品上下文 + 保存成功回调（由调用方闭包） */
export interface BookmarkPanelRequest {
  /** 目标插画 id（面板内所有请求的作用域；换目标重开由面板 generation gate 兜竞态） */
  illustId: number;
  /** 打开时作品的已收藏态快照（仅上下文展示；真值以面板预填结果为准） */
  isBookmarked: boolean;
  /** 作品自带标签名列表（建议来源，spec D5/D7） */
  workTags?: string[];
  /** 保存成功回调（宿主在保存成功后调用；无参，调用方闭包决定状态写入） */
  onSaved: () => void;
}

const [request, setRequest] = createSignal<BookmarkPanelRequest | null>(null);
const [isOpen, setIsOpen] = createSignal(false);

/** 打开收藏面板。重复调用即换目标：request 更新，面板 illustId 变化自行重置 + 中止旧请求。 */
export function openBookmarkPanel(req: BookmarkPanelRequest): void {
  setRequest(req);
  setIsOpen(true);
}

/** 关闭面板。保留 request（关闭动画期间 illustId 不得闪空），isOpen 驱动可见性。 */
export function closeBookmarkPanel(): void {
  setIsOpen(false);
}

/** 当前面板目标（null = 从未打开；关闭后保留最后一次，供关闭动画） */
export const bookmarkPanelRequest: Accessor<BookmarkPanelRequest | null> = request;
/** 面板可见性 */
export const bookmarkPanelOpen: Accessor<boolean> = isOpen;
