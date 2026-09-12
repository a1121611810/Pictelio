import type { Component } from "solid-js";
import { resolveImageUrl } from "../utils/imageLoader";
import { t } from "../i18n";
import PageTransition from "../components/PageTransition";

const DebugImage: Component = () => {
  const [testUrl, setTestUrl] = createSignal("");
  const [result, setResult] = createSignal("");
  const [imgSrc, setImgSrc] = createSignal("");

  async function testFetch() {
    const url = testUrl();
    if (!url) {
      return;
    }

    const proxyUrl = resolveImageUrl(url);
    // i18n: set 时快照（瞬态）
    setResult(t("debug.probing", { url, proxy: proxyUrl }));

    const [fetchErr] = await tryAsync(
      (async () => {
        const resp = await fetch(proxyUrl);
        const blob = await resp.blob();
        if (resp.ok && blob.size > 0) {
          // i18n: set 时快照（瞬态）
          setResult(
            t("debug.probeSuccess", {
              status: resp.status,
              size: blob.size,
              type: blob.type,
            }),
          );
          const objUrl = URL.createObjectURL(blob);
          setImgSrc(objUrl);
        } else {
          // i18n: set 时快照（瞬态）
          setResult(t("debug.probeFailed", { status: resp.status, size: blob.size }));
        }
      })(),
    );
    if (fetchErr) {
      // i18n: set 时快照（瞬态）；{{message}} 为 Error 数据渲染
      setResult(t("debug.networkError", { message: (fetchErr as Error).message }));
    }
  }

  return (
    <PageTransition>
      <div class="page p-6">
        <h1 class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase600)] font-semibold mb-4">
          {t("debug.title")}
        </h1>

        <fluent-textarea
          style="--inline-size:100%"
          placeholder={t("debug.urlPlaceholder")}
          value={testUrl()}
          ref={fluentOn("input", (e: Event) => setTestUrl((e.target as any).value))}
        ></fluent-textarea>

        <fluent-button appearance="primary" ref={fluentOn("click", testFetch)}>
          {t("debug.testLoad")}
        </fluent-button>

        <pre class="surface-card p-3 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] mb-4 whitespace-pre-wrap">
          {result()}
        </pre>

        {imgSrc() && (
          <div>
            <p class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)] mb-2">
              {t("debug.preview")}
            </p>
            <img src={imgSrc()} class="max-w-full rounded-[var(--borderRadiusMedium)]" />
          </div>
        )}
      </div>
    </PageTransition>
  );
};

export default DebugImage;
