// ─── 全局 QueryClient 单例（ADR-0141 D4 + R1 修订）───
// 默认配置：
// - staleTime: 0 → 挂载即 refetch（项目约定「悲观刷新」，与 createMixFeed 等 instance primitive 一致）
// - gcTime: 30s → 短时缓存覆盖「详情 → 返回列表」高频场景（避免每次订阅都重新 fetch）
// - retry: false → 401 由 apiClient.execWithAuthRetry 处理；4xx/5xx 业务不重试（让用户感知错误后手动 retry）
// - refetchOnWindowFocus: false → lynx 无 window focus 事件（vue-lynx 0.5.1 / web-core 0.23.1），默认 true 是噪音
// - refetchOnReconnect: true → 网络重连时刷新
// - placeholderData: keepPreviousData → 翻页保留旧数据，避免 pending ↔ success 闪烁
// - structuralSharing: true → 默认；JSON 兼容数据保持引用相等
//
// per-query override：详情 / 用户主页 / ugoira 元数据可设 gcTime: 5*60*1000（稳定数据）
//
// 注意：401 单飞锁不放进 queryClient（破坏 Java 侧 PixivApiCore.synchronized 契约），
// queryFn 调 apiClient.get/post 即可。
import { QueryClient, keepPreviousData } from '@tanstack/vue-query'
import { queryKeys } from './queryKeys'

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 0,
        gcTime: 30 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        refetchOnMount: true,
        placeholderData: keepPreviousData,
        structuralSharing: true,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

/** 全局默认单例（每个 app 启动周期共用一个） */
export const queryClient: QueryClient = createAppQueryClient()

// ─── per-query override（ADR-0141 D4）───
//
// 详情 / 用户主页 / ugoira 元数据属于「稳定数据」——5 分钟内不需要重新 fetch。
// setQueryDefaults 命中 queryKey 前缀匹配，避免在每个 useQuery call 重复声明。
//
// ⚠️ 注意 setQueryDefaults 注册顺序：通用前缀（illusts）必须先注册，
// 特定前缀（illusts.detail）后注册以正确合并。
// （query-core 内部按从宽到窄顺序匹配 + 后注册覆盖前注册。）

// 1) 详情类稳定数据：gcTime 5min（默认 30s 太短）
queryClient.setQueryDefaults(
  queryKeys.illusts.all, // 前缀 ['pictelio', 'illusts']
  { gcTime: 5 * 60 * 1000 },
)
// 2) 用户主页稳定数据
queryClient.setQueryDefaults(
  queryKeys.users.all, // 前缀 ['pictelio', 'users']
  { gcTime: 5 * 60 * 1000 },
)
// 3) 小说详情 / 小说系列：stable content
queryClient.setQueryDefaults(
  queryKeys.novels.all,
  { gcTime: 5 * 60 * 1000 },
)
// 4) 推荐 / 关注 / 搜索 / 追更：低 gcTime（避免脏读，参考项目「悲观刷新」约定）
queryClient.setQueryDefaults(
  queryKeys.illusts.recommended(),
  { gcTime: 0 },
)
queryClient.setQueryDefaults(
  queryKeys.illusts.follow('public'),
  { gcTime: 0 },
)
queryClient.setQueryDefaults(
  queryKeys.novels.recommended(),
  { gcTime: 0 },
)
queryClient.setQueryDefaults(
  queryKeys.novels.follow('public'),
  { gcTime: 0 },
)
queryClient.setQueryDefaults(
  queryKeys.search.all,
  { gcTime: 0 }, // 搜索结果时效性高
)