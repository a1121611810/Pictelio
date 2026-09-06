#!/usr/bin/env bash
# 构建 SPA bundle（development 语义）并拷入原型 assets。
# 关键：NODE_ENV=development 使 import.meta.env.DEV=true → 登录链路（_oauthFetch，含
# __CREDENTIALS__）保留进 bundle。仅 `--mode development` 不够（Rolldown 仍按 production
# 消除 DEV 分支，实测 2026-09-07）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

cd "$ROOT/packages/app"
rm -rf dist
NODE_ENV=development vp build --mode development

TARGET="$ROOT/prototype/geckoview-feasibility/android-proto/app/src/main/assets/public"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cp -r dist/. "$TARGET/"
echo "SPA bundle → $TARGET ($(du -sh "$TARGET" | cut -f1))"
