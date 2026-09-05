# FT-5 交互回归 · 20260905-141959

| 场景 | 指标 | 值 | 判定线 | pass | 判定线出处 |
|---|---|---|---|---|---|
| coldstart | error | Command failed: python3 analyze_rec.py /Users/lilianda/develop/pixivizer/scripts/audit-real-interaction/regression-out/20260905-141959/coldstart/coldstart.mp4 --out /Users/lilianda/develop/pixivizer/scripts/audit-real-interaction/regression-out/20260905-141959/coldstart/coldstart.frames.json | | **FAIL** | |
| detail | skeleton_ms | 9 | ≤1100 | PASS | docs/research/real-interaction-audit.md 场景 2（骨架帧 ≤1.1s） |
| detail | interactive_ms | 707 | ≤2000 | PASS | docs/research/real-interaction-audit.md 场景 2（可交互帧 ≤2s） |
| back | response_ms_max | 201 | ≤400 | PASS | docs/research/real-interaction-audit.md 场景 3（响应 ≤400ms 且 3 rep 方差 <100ms） |
| back | transition_frames_max | 0 | ≥1 | **FAIL** | docs/research/real-interaction-audit.md 场景 3 + FT-1A（过渡动画存在 ⇒ 过渡帧数 ≥1；VFR 快动画可被压缩为单帧切换） |
| back | variance_ms | 18 | <100 | PASS | docs/research/real-interaction-audit.md 场景 3（响应 ≤400ms 且 3 rep 方差 <100ms） |
| tabs | follow_response_ms | 126 | ≤1100 | PASS | docs/research/real-interaction-audit.md 场景 4（响应 ≤1.1s） |
| tabs | follow_blank_window_max_ms | 0 | ≤500（空白窗=0） | PASS | docs/research/ri-366-shimmer-report.md（FT-3 验收线：空白窗=0；>500ms 无卡片段即 fail） |
| tabs | follow_content_ready_ms | 126 | — | 记录 | 体检报告场景 4 内容就绪（网络支配，仅记录） |
| tabs | bookmark_response_ms | 125 | ≤1100 | PASS | docs/research/real-interaction-audit.md 场景 4（响应 ≤1.1s） |
| tabs | bookmark_blank_window_max_ms | 0 | ≤500（空白窗=0） | PASS | docs/research/ri-366-shimmer-report.md（FT-3 验收线：空白窗=0；>500ms 无卡片段即 fail） |
| tabs | bookmark_content_ready_ms | 373 | — | 记录 | 体检报告场景 4 内容就绪（网络支配，仅记录） |
| scroll | scroll_slow_delta_p90_ms | 18 | ≤34 | PASS | docs/research/real-interaction-audit.md 场景 5（VFR delta p90 ≤34ms） |
| scroll | scroll_slow_stalls_over_200ms | 0 | =0 | PASS | docs/research/real-interaction-audit.md 场景 5（滚动窗内无 >200ms 停滞） |
| scroll | scroll_fling_delta_p90_ms | 18 | ≤34 | PASS | docs/research/real-interaction-audit.md 场景 5（VFR delta p90 ≤34ms） |
| scroll | scroll_fling_stalls_over_200ms | 0 | =0 | PASS | docs/research/real-interaction-audit.md 场景 5（滚动窗内无 >200ms 停滞） |
| viewer | open_ms | 0 | ≤200 | PASS | docs/research/real-interaction-audit.md 场景 6（开启占位 ≤200ms） |
| viewer | flip_max_gap_ms | 148 | ≤500 | PASS | docs/research/ri-367-viewer-report.md（FT-4 验收线：翻页释放→新页首帧 ≤500ms） |
| viewer | note | 进入的详情非多图（{"path":"/illust/149158559","pages":0,"imgOk":false}），返回重找 | | | |
| viewer | note | 进入的详情非多图（{"path":"/search","pages":0,"imgOk":true}），返回重找 | | | |

overall_pass: false
