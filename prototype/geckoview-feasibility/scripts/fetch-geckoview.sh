#!/usr/bin/env bash
# 手动获取 GeckoView AAR 进工程内本地 maven 仓库。
# 背景：Gradle 直连 maven.mozilla.org 下载 90MB AAR 失败（curl 可达，疑 Gradle TLS/超时问题），
# 故用 curl 下载后按 maven layout 落位（settings.gradle 已把 local-maven 置于最优先）。
set -euo pipefail

VERSION="${1:-155.0.20260903215306}"
ARTIFACT="geckoview-arm64-v8a"   # 模拟器 sdk_gphone64_arm64 → arm64；真机同为 arm64
BASE="https://maven.mozilla.org/maven2/org/mozilla/geckoview"

DIR="$(cd "$(dirname "$0")/../android-proto" && pwd)/local-maven/org/mozilla/geckoview/$ARTIFACT/$VERSION"
mkdir -p "$DIR"

if [ -f "$DIR/$ARTIFACT-$VERSION.aar" ]; then
  echo "已存在: $DIR/$ARTIFACT-$VERSION.aar"
  exit 0
fi

echo "下载 $BASE/$ARTIFACT/$VERSION/$ARTIFACT-$VERSION.aar"
curl -fL --retry 3 -o "$DIR/$ARTIFACT-$VERSION.aar" \
  "$BASE/$ARTIFACT/$VERSION/$ARTIFACT-$VERSION.aar"

cat > "$DIR/$ARTIFACT-$VERSION.pom" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>org.mozilla.geckoview</groupId>
  <artifactId>$ARTIFACT</artifactId>
  <version>$VERSION</version>
  <packaging>aar</packaging>
</project>
EOF

# 原型补丁：GeckoView 155/154 的 AAR metadata 要求 minCompileSdk=37（本机拿不到
# android-37 平台），降到 36 仅为构建期门槛——运行时 API 34 模拟器实测正常。
# 生产采纳时应直接升 compileSdk，不做此补丁。
WORK="$(mktemp -d)"
unzip -o -q "$DIR/$ARTIFACT-$VERSION.aar" META-INF/com/android/build/gradle/aar-metadata.properties -d "$WORK"
sed -i '' 's/minCompileSdk=37/minCompileSdk=36/; s/minCompileMinorSdk=1/minCompileMinorSdk=0/' \
  "$WORK/META-INF/com/android/build/gradle/aar-metadata.properties"
(cd "$WORK" && zip -q "$DIR/$ARTIFACT-$VERSION.aar" META-INF/com/android/build/gradle/aar-metadata.properties)
rm -rf "$WORK"

echo "落位完成: $DIR"
