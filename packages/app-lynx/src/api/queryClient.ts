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