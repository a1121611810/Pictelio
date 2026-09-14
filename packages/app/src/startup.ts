/** 在 SolidJS 渲染前恢复启动所需的持久化偏好。 */
export async function initializeStartupPreferences(): Promise<void> {
  // 启动时不需要提前加载偏好，
  // 明暗主题在 __root.tsx 中恢复
}
