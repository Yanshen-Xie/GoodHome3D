// 用无头浏览器打开页面并截图，用于开发时检查画面
// 用法: node tools/shot.mjs <url> <输出png> [等待毫秒] [在页面中执行的js]
import { chromium } from 'playwright';
const [url, out, wait = '4000', script = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu', '--enable-features=Vulkan'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
page.on('console', (m) => console.log('[console]', m.type(), m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url);
await page.waitForTimeout(+wait);
if (script) {
  const r = await page.evaluate(script);
  if (r !== undefined) console.log('[eval]', JSON.stringify(r));
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
await browser.close();
