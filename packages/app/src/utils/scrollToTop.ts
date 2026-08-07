export function scrollToTop(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.scrollTo?.({ top: 0, behavior: "auto" });
  document.documentElement.scrollTop = 0;
  if (document.body) {
    document.body.scrollTop = 0;
  }
}
