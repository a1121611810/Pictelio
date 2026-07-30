import type { Component } from "solid-js";
import { resolveImageUrl } from "../utils/imageLoader";
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
    setResult(`测试: ${url}\n代理: ${proxyUrl}\n请求中...`);

    const [fetchErr] = await tryAsync(
      (async () => {
        const resp = await fetch(proxyUrl);
        const blob = await resp.blob();
        if (resp.ok && blob.size > 0) {
          setResult(`✅ 成功! HTTP ${resp.status}, 大小: ${blob.size} bytes, 类型: ${blob.type}`);
          const objUrl = URL.createObjectURL(blob);
          setImgSrc(objUrl);
        } else {
          setResult(`❌ 失败: HTTP ${resp.status}, 大小: ${blob.size}`);
        }
      })(),
    );
    if (fetchErr) {
      setResult(`❌ 网络错误: ${(fetchErr as Error).message}`);
    }
  }

  return (
    <PageTransition>
      <div class="page p-6">
        <h1 class="text-[var(--colorNeutralForeground1)] [font-size:var(--fontSizeBase600)] font-semibold mb-4">
          图片加载调试
        </h1>

        <fluent-textarea
          style="--inline-size:100%"
          placeholder="粘贴 i.pximg.net 图片 URL..."
          value={testUrl()}
          on:input={(e: Event) => setTestUrl((e.target as any).value)}
        ></fluent-textarea>

        <fluent-button appearance="primary" on:click={testFetch}>
          测试加载
        </fluent-button>

        <pre class="surface-card p-3 rounded-[var(--borderRadiusMedium)] [font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground2)] mb-4 whitespace-pre-wrap">
          {result()}
        </pre>

        {imgSrc() && (
          <div>
            <p class="text-[var(--colorNeutralForeground3)] [font-size:var(--fontSizeBase200)] mb-2">
              图片预览：
            </p>
            <img src={imgSrc()} class="max-w-full rounded-[var(--borderRadiusMedium)]" />
          </div>
        )}
      </div>
    </PageTransition>
  );
};

export default DebugImage;
