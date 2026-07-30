import { type Component } from "solid-js";
import PageTransition from "../components/PageTransition";
import FluentIcon from "../components/ui/FluentIcon";

// ── Data model ──
interface AboutRow {
  label: string;
  value: string;
  icon: Parameters<typeof FluentIcon>[0]["name"];
  url?: string;
}

interface AboutSection {
  title: string;
  rows: AboutRow[];
}

const sections: AboutSection[] = [
  {
    title: "免责声明",
    rows: [
      { label: "第三方客户端", value: "与 Pixiv 官方无关", icon: "info" },
      { label: "内容来源", value: "Pixiv 公开 API", icon: "info" },
      { label: "版权", value: "归原作者所有", icon: "info" },
      { label: "年龄限制", value: "未成年请在监护人指导下使用", icon: "info" },
    ],
  },
  {
    title: "应用信息",
    rows: [{ label: "应用版本", value: APP_VERSION, icon: "info" }],
  },
  {
    title: "致谢",
    rows: [
      {
        label: "SolidJS",
        value: "响应式 UI 框架",
        icon: "wrench",
        url: "https://www.solidjs.com/",
      },
      {
        label: "Capacitor",
        value: "跨平台原生运行时",
        icon: "wrench",
        url: "https://capacitorjs.com/",
      },
      {
        label: "TypeScript",
        value: "类型安全 JavaScript",
        icon: "wrench",
        url: "https://www.typescriptlang.org/",
      },
      {
        label: "Vite",
        value: "下一代前端构建工具",
        icon: "wrench",
        url: "https://vitejs.dev/",
      },
      {
        label: "Fluent Design 2",
        value: "Microsoft 设计语言",
        icon: "info",
        url: "https://fluent2.microsoft.design/",
      },
      {
        label: "Fluent UI Icons",
        value: "微软开源图标库",
        icon: "info",
        url: "https://github.com/microsoft/fluentui-system-icons",
      },
      {
        label: "Fluent UI Web Components",
        value: "基于 FAST 的 Fluent Web 组件库",
        icon: "wrench",
        url: "https://github.com/microsoft/fluentui/tree/master/packages/web-components",
      },
      {
        label: "Microsoft FAST",
        value: "自适应 Web Component 引擎",
        icon: "info",
        url: "https://github.com/microsoft/fast",
      },
      {
        label: "pixivts",
        value: "Pixiv API 封装 (book000)",
        icon: "wrench",
        url: "https://github.com/book000/pixivts",
      },
    ],
  },
  // 后续扩展只需在此数组 push 新 section 或 row
];

// ── Component ──
const About: Component = () => {
  const navigate = useNavigate();

  return (
    <PageTransition>
      <div class="min-h-screen pb-16">
        {/* Sticky header — same pattern as PersonalCenter */}
        <header class="sticky top-0 z-20 surface-appbar h-12 flex items-center px-4 gap-3">
          <fluent-button
            appearance="subtle"
            aria-label="返回"
            on:click={() => navigate(-1)}
            class="w-8 h-8 p-0 min-w-8"
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15.53 4.22a.75.75 0 0 1 0 1.06L8.81 12l6.72 6.72a.75.75 0 1 1-1.06 1.06l-7.25-7.25a.75.75 0 0 1 0-1.06l7.25-7.25a.75.75 0 0 1 1.06 0z"
                fill="currentColor"
              />
            </svg>
          </fluent-button>
          <h1 class="[font-size:var(--fontSizeBase400)] font-semibold text-[var(--colorNeutralForeground1)] flex-1">
            关于
          </h1>
        </header>

        {/* ── Brand area ── */}
        <div class="flex flex-col items-center pt-10 pb-6 gap-3">
          {/* Pictelio logo */}
          <img
            src="/logo-192x192.png"
            alt="Pictelio"
            class="w-16 h-16 rounded-[var(--borderRadiusXLarge)]"
          />

          <div class="text-center">
            <p class="[font-size:var(--fontSizeBase500)] font-semibold text-[var(--colorNeutralForeground1)] leading-snug">
              Pictelio
            </p>
            <p class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug mt-0.5">
              第三方插画浏览器
            </p>
          </div>
        </div>

        {/* ── Info sections ── */}
        {sections.map((section) => (
          <section class="mb-1">
            <p class="px-5 py-2 [font-size:var(--fontSizeBase200)] font-semibold text-[var(--colorNeutralForeground2)] uppercase tracking-wide">
              {section.title}
            </p>
            <div class="mx-4 surface-card">
              {section.rows.map((row, idx, arr) => {
                const inner = (
                  <div
                    class="flex items-center justify-between px-4 min-h-11 py-3"
                    classList={{
                      "cursor-pointer hover:bg-[var(--colorNeutralBackground1Hover)] active:scale-[0.98] transition-transform duration-[var(--durationFast)]":
                        !!row.url,
                    }}
                  >
                    <div class="flex items-center gap-3 min-w-0 flex-1">
                      <div class="w-5 h-5 flex-shrink-0 text-[var(--colorNeutralForeground2)] flex items-center justify-center">
                        <FluentIcon name={row.icon} size={20} />
                      </div>
                      <span class="[font-size:var(--fontSizeBase300)] text-[var(--colorNeutralForeground1)] leading-snug">
                        {row.label}
                      </span>
                    </div>
                    <div class="flex items-center gap-1 flex-shrink-0 ml-3">
                      <span class="[font-size:var(--fontSizeBase200)] text-[var(--colorNeutralForeground3)] leading-snug text-right">
                        {row.value}
                      </span>
                      {row.url && (
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          aria-hidden="true"
                          class="text-[var(--colorNeutralForegroundDisabled)] flex-shrink-0"
                        >
                          <path
                            d="M8.22 4.22a.75.75 0 0 1 1.06 0l7.25 7.25a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06-1.06L15.19 12 8.22 5.28a.75.75 0 0 1 0-1.06z"
                            fill="currentColor"
                          />
                        </svg>
                      )}
                    </div>
                  </div>
                );

                return (
                  <>
                    {row.url ? (
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        class="block focus-visible:outline focus-visible:outline-[length:var(--strokeWidthThick)] focus-visible:outline-offset-[var(--strokeWidthThick)] focus-visible:outline-[color:var(--colorStrokeFocus2)] rounded-[var(--borderRadiusMedium)]"
                      >
                        {inner}
                      </a>
                    ) : (
                      inner
                    )}
                    {idx < arr.length - 1 && (
                      <fluent-divider class="mx-[var(--spacingHorizontalL)]"></fluent-divider>
                    )}
                  </>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </PageTransition>
  );
};

export default About;
