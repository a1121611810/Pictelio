// ─── 作品标题归一化（issue #893）───
//
// 「无标题」作品的 `title` 由 **Pixiv API 侧**填成字面串 `"no title"`，不是本仓的文案。
// 直接插值渲染 ⇒ 详情页与四类卡片的标题位出现**未本地化的英文兜底串**
// （真机 emulator-5554 实测；沉浸态图片正下方，恢复 chrome 后第一眼可见）。
//
// 本仓的硬约束是「UI 文案必须进 i18n 词典」，故 API 返回的占位串必须**在渲染前**
// 换成词典里的本地化占位，而不是靠各页面各自 `v-if` 挡一下。
//
// ── 匹配口径（刻意大小写敏感）───
// 只认 API 的**逐字小写** `no title`。用户自己把作品命名为「No Title」「NO TITLE」是
// 合法且存在的，若按小写折叠匹配会把**真实标题**误判成占位 —— 那是更坏的缺陷
// （把有标题的作品显示成「无标题」）。API 侧该哨兵串稳定为小写，故精确匹配即足够。
// 另：空白串同样按无标题处理（`title` 可能为 `""` 或全空格）。
//
// 消费方（改动这些模板时须同步，保持「标题归一化只有一个出口」）：
//   - pages/IllustDetail.vue   标题行
//   - pages/Recommended.vue    综合推荐流卡片
//   - pages/IllustList.vue     插画分类流卡片
//   - pages/Following.vue      关注流卡片
//   - components/RankingEntryCard.vue 排行榜条目卡片
import { t } from '../i18n'

/** Pixiv 对无标题作品返回的字面哨兵串（API 侧兜底，未本地化） */
const PIXIV_UNTITLED = 'no title'

/**
 * 作品标题 → 可直接渲染的文案。
 * 空 / 空白 / API 哨兵串 ⇒ 本地化占位；其余原样返回（仅去首尾空白）。
 */
export function artworkTitle(raw: string | null | undefined): string {
  const value = (raw ?? '').trim()
  return value === '' || value === PIXIV_UNTITLED ? t('artworkTitle.untitled') : value
}
