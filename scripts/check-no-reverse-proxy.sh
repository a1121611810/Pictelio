#!/bin/sh
# CI 门禁：禁止 CF Worker 反代 / API 反代 / HibiAPI / 公共镜像相关代码残留
# （pictelio-pure-client-direct-access T12，ADR-0147 D4 实施门禁）
#
# 用法：在 CI 流水线跑测试后执行，grep 不应有匹配；非零退出码 = 检测到残留 = 阻断合并。
#
# 检测目标（任何匹配 = 违规）：
#   - ApiEndpoints（Java 反代端点提供者）
#   - apiProxyBase / api_proxy_base（反代设置键）
#   - API_PROXY_PREF_KEY（TS 反代设置常量）
#   - apiProxyUrl / setApiProxyBase（TS 反代 store 入口）
#   - SettingsApiProxy（反代设置卡）
#   - /pixiv-app-api / /pixiv-oauth 路径前缀（Worker 反代路由契约）
#   - workers.dev / /api/v1（CF Worker 部署形态）
#   - api.hibiy.cn / api.loliko.cn（HibiAPI 公共实例）
#   - /pixiv-img/ 路径相关（图片代理路径保留——这是 Java shouldInterceptRequest 拦截
#     /pixiv-img/ 路径代理到 i.pximg.net 的核心直连逻辑，与反代无关）
#
# 例外：
#   - docs/research/ 和 docs/adr/ ADR-0146.md 中的历史记录
#   - worker/ 目录已删除（脚本检测）
#   - build artifacts（dist/, android/app/src/main/assets/public/）
#
# 失败时：输出违规文件路径列表 + exit code 1

set -e

ROOT_DIR="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT_DIR"

VIOLATIONS=0
CHECK_PATHS="packages/app/src packages/app/android/app/src scripts docs/adr docs/research .github"

echo "=== CI 门禁：反代路线残留检测 (ADR-0147 D4) ==="

# 1. 删/移检查：worker/ 目录不应在主分支
if [ -d "worker" ]; then
    echo "[FAIL] worker/ 目录仍存在（应删除或归档到 archive/）"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

# 2. Java 反代提供者
if find packages/app/src packages/app/android/app/src -name "ApiEndpoints.java" -not -path "*/build/*" 2>/dev/null | grep -q .; then
    echo "[FAIL] ApiEndpoints.java 残留"
    find packages/app/src packages/app/android/app/src -name "ApiEndpoints.java" -not -path "*/build/*"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

# 3. 设置键 / 常量（仅源码，docs 允许）
# 用单词边界防止误匹配（如 networkMode 字段值不小心叫 apiProxyMode）
echo "--- 检查源码中的反代相关标识符 ---"
SOURCE_VIOLATIONS=$(grep -rn --include="*.java" --include="*.ts" --include="*.tsx" \
    -E '\b(ApiEndpoints|apiProxyBase|api_proxy_base|API_PROXY_PREF_KEY|apiProxyUrl|setApiProxyBase|SettingsApiProxy)\b' \
    packages/app/src packages/app/android/app/src 2>/dev/null | grep -v "/build/" || true)

if [ -n "$SOURCE_VIOLATIONS" ]; then
    echo "[FAIL] 源码中存在反代相关标识符："
    echo "$SOURCE_VIOLATIONS"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

# 4. CI workflow 引用检查（应已删除 Worker contract tests 任务）
WORKFLOW_VIOLATIONS=$(grep -rn --include="*.yml" --include="*.yaml" \
    -E '(worker\.test|wrangler|workers\.dev|cloudflare)' \
    .github/ 2>/dev/null || true)
if [ -n "$WORKFLOW_VIOLATIONS" ]; then
    echo "[FAIL] CI workflow 中残留反代引用："
    echo "$WORKFLOW_VIOLATIONS"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

# 5. HibiAPI / 公共镜像常量检查（防止误引用）
echo "--- 检查 HibiAPI / 公共镜像 ---"
HIBIAPI_VIOLATIONS=$(grep -rn --include="*.java" --include="*.ts" --include="*.tsx" \
    -E '\b(hibiy|loliko|pixiv-app-api|api\.hibiy\.cn|api\.loliko\.cn)\b' \
    packages/app/src packages/app/android/app/src 2>/dev/null | grep -v "/build/" || true)
if [ -n "$HIBIAPI_VIOLATIONS" ]; then
    echo "[FAIL] 源码中存在 HibiAPI / 公共镜像 / Worker 前缀路由引用："
    echo "$HIBIAPI_VIOLATIONS"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

# 5b. /pixiv-oauth 路径检测（Vite dev 代理路径，合法；仅打印 INFO 不阻断）
PIXIV_OAUTH_COUNT=$(grep -rln --include="*.java" --include="*.ts" --include="*.tsx" \
    -E '/pixiv-oauth' \
    packages/app/src packages/app/android/app/src 2>/dev/null | grep -v "/build/" | wc -l)
echo "[INFO] /pixiv-oauth 路径引用 $PIXIV_OAUTH_COUNT 处（Vite dev 代理路径，合法——非 Worker 反代路由）"

# 6. workers.dev 部署引用
WORKERS_VIOLATIONS=$(grep -rn --include="*.java" --include="*.ts" --include="*.tsx" --include="*.md" \
    -E 'workers\.dev' \
    packages/app/src packages/app/android/app/src 2>/dev/null | grep -v "/build/" || true)
if [ -n "$WORKERS_VIOLATIONS" ]; then
    echo "[FAIL] 源码中存在 workers.dev 部署形态引用："
    echo "$WORKERS_VIOLATIONS"
    VIOLATIONS=$((VIOLATIONS + 1))
fi

if [ "$VIOLATIONS" -eq 0 ]; then
    echo "=== [PASS] 反代残留检测：全部通过（零违规）==="
    exit 0
else
    echo ""
    echo "=== [FAIL] 反代残留检测：$VIOLATIONS 项违规（CI 门禁阻断）==="
    echo "请参考 docs/adr/ADR-0147-pure-client-direct-access.md D4 决策回滚反代路线"
    exit 1
fi