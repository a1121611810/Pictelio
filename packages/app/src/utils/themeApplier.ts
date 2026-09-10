/**
 * 管理 <html> 上的明暗类（.dark）。
 */
export function applyDarkClass(isDark: boolean): void {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("dark", isDark);
}
