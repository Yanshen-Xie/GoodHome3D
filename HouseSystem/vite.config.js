import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// 打包成一个独立的 HTML 文件（模型、贴图、脚本都内嵌），双击即可在浏览器中运行
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 100 * 1024 * 1024,
    chunkSizeWarningLimit: 20000,
  },
  server: { host: '127.0.0.1', port: 5188, strictPort: true },
  preview: { host: '127.0.0.1', port: 5189, strictPort: true },
});
