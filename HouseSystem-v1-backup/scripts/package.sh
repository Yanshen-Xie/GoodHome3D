#!/usr/bin/env bash
# 编译并打包：
#   release/好房子三维可视化系统.html   可直接双击运行的单文件程序
#   release/HouseSystem-源代码.zip      源代码（不含 node_modules）
set -e
cd "$(dirname "$0")/.."
npx vite build
mkdir -p release
cp dist/index.html "release/好房子三维可视化系统.html"
rm -f release/HouseSystem-源代码.zip
zip -qr release/HouseSystem-源代码.zip index.html package.json package-lock.json vite.config.js README.md src tools scripts docs -x "docs/screenshots/*"
ls -la release
