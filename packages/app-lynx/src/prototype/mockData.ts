// ─── PROTOTYPE（throwaway）：评论区 UI 形态验证 mock 数据 ───
// 模仿 PixivComment 结构（见 packages/app/src/api/types.ts），不走任何 API。
// 本目录为原型验证代码，验证完成后整体移入 throwaway branch，不入 main。

export interface MockCommentUser {
  id: number
  name: string
}

export interface MockParentComment {
  id: number
  user: { name: string }
  comment: string
}

export interface MockComment {
  id: number
  user: MockCommentUser
  comment: string
  created_at: string
  has_replies: boolean
  reply_count?: number
  parent_comment?: MockParentComment | null
}

/** mock 插画详情（占位宿主内容） */
export const mockIllust = {
  id: 123456,
  title: '夏夜的花火大会',
  userName: '紺野りんご',
  width: 1200,
  height: 800,
  totalComments: 128,
}

/** mock 根评论（含楼中楼回复、长文本、表情符号场景） */
export const mockComments: MockComment[] = [
  {
    id: 1,
    user: { id: 101, name: '夕凪さん' },
    comment: '这张的色彩太美了！烟花和夜空的对比很有氛围感 ✨',
    created_at: '3 分钟前',
    has_replies: true,
    reply_count: 5,
  },
  {
    id: 2,
    user: { id: 102, name: 'みやこ' },
    comment: '老师最近的画风越来越好了，光影处理特别舒服',
    created_at: '12 分钟前',
    has_replies: false,
  },
  {
    id: 3,
    user: { id: 103, name: 'KuroNeko' },
    comment: '构图好棒！可以求一下这个视角的教程吗，想学怎么把近景和背景层次拉开',
    created_at: '25 分钟前',
    has_replies: true,
    reply_count: 2,
  },
  {
    id: 4,
    user: { id: 104, name: '阿白' },
    comment: '壁纸已保存，感谢分享！',
    created_at: '40 分钟前',
    has_replies: false,
  },
  {
    id: 5,
    user: { id: 105, name: 'サクラ' },
    comment:
      '第一眼以为是实拍，细看才发现是画出来的，细节量太恐怖了。衣服的褶皱、烟花的倒影、还有远处人群的剪影，每一个地方都经得起放大看。收藏了！期待老师的下一张作品，希望可以画个续篇或者系列。',
    created_at: '1 小时前',
    has_replies: true,
    reply_count: 8,
  },
  {
    id: 6,
    user: { id: 106, name: '夜行猫' },
    comment: '路过，赞一个',
    created_at: '2 小时前',
    has_replies: false,
  },
  {
    id: 7,
    user: { id: 107, name: '星野ゆう' },
    comment: '河边的灯笼和天上的烟花呼应得好妙，整张画有一种流动感',
    created_at: '3 小时前',
    has_replies: true,
    reply_count: 1,
  },
  {
    id: 8,
    user: { id: 108, name: 'pencil_duck' },
    comment: '画集什么时候出！这个系列我每一张都收进收藏夹了',
    created_at: '5 小时前',
    has_replies: false,
  },
  {
    id: 9,
    user: { id: 109, name: 'もちもち' },
    comment: '背景的房屋群细节好喜欢，很有夏天的味道',
    created_at: '8 小时前',
    has_replies: false,
  },
  {
    id: 10,
    user: { id: 110, name: 'Lin' },
    comment: '关注很久了，从第一张画追到现在，进步真的肉眼可见！',
    created_at: '昨天',
    has_replies: true,
    reply_count: 3,
  },
]

/** mock 楼层回复（parent_comment 演示） */
export const mockReplies: Record<number, MockComment[]> = {
  1: [
    {
      id: 1011,
      user: { id: 111, name: '路人甲' },
      comment: '同感！最喜欢烟花炸开那一瞬间的光晕',
      created_at: '2 分钟前',
      has_replies: false,
      parent_comment: { id: 1, user: { name: '夕凪さん' }, comment: '这张的色彩太美了！…' },
    },
    {
      id: 1012,
      user: { id: 112, name: '咲' },
      comment: '老师这张用了什么笔刷呀，光晕好自然',
      created_at: '1 分钟前',
      has_replies: false,
      parent_comment: { id: 1, user: { name: '夕凪さん' }, comment: '这张的色彩太美了！…' },
    },
  ],
  3: [
    {
      id: 1031,
      user: { id: 113, name: 'KuroNeko' },
      comment: '补充：主要是想知道前景灯笼是怎么压暗的',
      created_at: '20 分钟前',
      has_replies: false,
      parent_comment: { id: 3, user: { name: 'KuroNeko' }, comment: '构图好棒！…' },
    },
  ],
}
