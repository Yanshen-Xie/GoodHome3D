#!/usr/bin/env bash
# 编译并打包：
#   release/好房子三维可视化系统.html   可直接双击运行的单文件程序
#   release/操作说明.pdf                由 docs/操作说明.typ 生成（需要 Typst；可用环境变量 TYPST 指定可执行文件）
#   release/HouseSystem-源代码.zip      源代码（不含 node_modules）
set -euo pipefail
cd "$(dirname "$0")/.."

npm run -s typecheck
npx vite build
mkdir -p release
cp dist/index.html "release/好房子三维可视化系统.html"

TYPST="${TYPST:-typst}"
if command -v "$TYPST" >/dev/null 2>&1; then
  "$TYPST" compile --root . --pdf-standard a-2b docs/操作说明.typ release/操作说明.pdf
else
  echo "未找到 Typst（可设置 TYPST=/path/to/typst），跳过 release/操作说明.pdf" >&2
fi

# 源代码包：逐个确认文件存在（zip 遇到缺失文件只会静默跳过），保证收到的人能重新编译
SOURCES=(index.html package.json package-lock.json tsconfig.json vite.config.ts README.md TODO.md src tools scripts docs)
for f in "${SOURCES[@]}"; do
  [ -e "$f" ] || { echo "打包失败：缺少 $f" >&2; exit 1; }
done
rm -f release/HouseSystem-源代码.zip
zip -qr release/HouseSystem-源代码.zip "${SOURCES[@]}" -x "docs/screenshots/*"
ls -la release
