# FT-5 交互回归 · 20260905-145217

| 场景 | 指标 | 值 | 判定线 | pass | 判定线出处 |
|---|---|---|---|---|---|
| coldstart | splash_first_ms | 13 | — | 记录 | 体检报告场景 1（splash 首帧=首个显著变化帧） |
| coldstart | max_stall_ms | 4650 | <1000 | **FAIL** | docs/research/ri-365-coldstart-report.md（FT-2 验收线：最长完全静止段 <1s） |
| coldstart | waittime_ms | 670 | — | 记录 | docs/research/ri-365-coldstart-report.md（暖基线 1782ms；网络/缓存波动，仅记录不设回归线） |
| coldstart | totaltime_ms | 667 | — | 记录 | docs/research/ri-365-coldstart-report.md（暖基线 1782ms；网络/缓存波动，仅记录不设回归线） |
| coldstart | chrome_cdp_ms | 6514 | — | 记录 | 体检报告场景 1 首屏帧口径的 DOM 代理（/home 路由首现） |
| coldstart | first_image_cdp_ms | 6769 | — | 记录 | 体检报告场景 1 首图帧口径的 DOM 代理（首卡 img complete） |
| detail | skeleton_ms | 10 | ≤1100 | PASS | docs/research/real-interaction-audit.md 场景 2（骨架帧 ≤1.1s） |
| detail | interactive_ms | 10 | ≤2000 | PASS | docs/research/real-interaction-audit.md 场景 2（可交互帧 ≤2s） |
| back | response_ms_max | 2 | ≤400 | PASS | docs/research/real-interaction-audit.md 场景 3（响应 ≤400ms 且 3 rep 方差 <100ms） |
| back | transition_frames_max | 17 | ≥1 | PASS | docs/research/real-interaction-audit.md 场景 3 + FT-1A（过渡动画存在 ⇒ 过渡帧数 ≥1；VFR 快动画可被压缩为单帧切换） |
| back | variance_ms | 2 | <100 | PASS | docs/research/real-interaction-audit.md 场景 3（响应 ≤400ms 且 3 rep 方差 <100ms） |
| tabs | follow_response_ms | 243 | ≤1100 | PASS | docs/research/real-interaction-audit.md 场景 4（响应 ≤1.1s） |
| tabs | follow_blank_window_max_ms | 0 | ≤500（空白窗=0） | PASS | docs/research/ri-366-shimmer-report.md（FT-3 验收线：空白窗=0；>500ms 无卡片段即 fail） |
| tabs | follow_content_ready_ms | 243 | — | 记录 | 体检报告场景 4 内容就绪（网络支配，仅记录） |
| tabs | bookmark_response_ms | 121 | ≤1100 | PASS | docs/research/real-interaction-audit.md 场景 4（响应 ≤1.1s） |
| tabs | bookmark_blank_window_max_ms | 0 | ≤500（空白窗=0） | PASS | docs/research/ri-366-shimmer-report.md（FT-3 验收线：空白窗=0；>500ms 无卡片段即 fail） |
| tabs | bookmark_content_ready_ms | 121 | — | 记录 | 体检报告场景 4 内容就绪（网络支配，仅记录） |
| scroll | scroll_slow_delta_p90_ms | 18 | ≤34 | PASS | docs/research/real-interaction-audit.md 场景 5（VFR delta p90 ≤34ms） |
| scroll | scroll_slow_stalls_over_200ms | 0 | =0 | PASS | docs/research/real-interaction-audit.md 场景 5（滚动窗内无 >200ms 停滞） |
| scroll | scroll_fling_delta_p90_ms | 18 | ≤34 | PASS | docs/research/real-interaction-audit.md 场景 5（VFR delta p90 ≤34ms） |
| scroll | scroll_fling_stalls_over_200ms | 0 | =0 | PASS | docs/research/real-interaction-audit.md 场景 5（滚动窗内无 >200ms 停滞） |
| viewer | open_ms | 0 | ≤200 | PASS | docs/research/real-interaction-audit.md 场景 6（开启占位 ≤200ms） |
| viewer | flip_max_gap_ms | 136 | ≤500 | PASS | docs/research/ri-367-viewer-report.md（FT-4 验收线：翻页释放→新页首帧 ≤500ms） |
| viewer | note | 进入的详情非多图（{"path":"/illust/149158559","pages":0,"imgOk":false}），返回重找 | | | |
| viewer | note | 进入的详情非多图（{"path":"/search","pages":0,"imgOk":true}），返回重找 | | | |

overall_pass: false
