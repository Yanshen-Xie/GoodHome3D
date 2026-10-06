// 乱点测试：依次点击每个功能页里的每一个按钮和开关（再打乱顺序点第二轮），检查页面是否报错、帧率是否正常。
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
page.on('console', (m) => { if (m.type() === 'error') { errors.push(m.text()); console.log('[console.error]', m.text().slice(0, 300)); } });
await page.goto(url);
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 90000 });
await page.waitForTimeout(1500);

const tabs = await page.$$eval('#tabs button', (bs) => bs.map((b) => b.textContent));
let clicks = 0, minFps = 99;
const rnd = (() => { let s = 7; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
for (const round of [1, 2]) {
  for (const t of tabs) {
    await page.click(`#tabs button:has-text("${t}")`);
    await page.waitForTimeout(300);
    // 当前面板里所有可见按钮和开关
    let items = await page.$$eval('#left > div:not([style*="none"]) button.btn, #left > div:not([style*="none"]) .switch span', (els) => els.map((e, i) => i));
    if (round === 2) items = items.sort(() => rnd() - 0.5);
    for (const i of items) {
      const el = (await page.$$('#left > div:not([style*="none"]) button.btn, #left > div:not([style*="none"]) .switch span'))[i];
      if (!el) continue;
      try { await el.scrollIntoViewIfNeeded(); await el.click({ timeout: 2000 }); clicks++; } catch { /* 被遮挡或已隐藏 */ }
      await page.waitForTimeout(round === 1 ? 700 : 250);
      // 大屏打开时会遮住左侧面板，关掉
      if (await page.evaluate(() => app.dashboard.visible)) await page.evaluate(() => app.dashboard.toggle());
      if (await page.evaluate(() => app.rig.mode === 'walk')) await page.keyboard.press('Escape');
    }
    const fps = await page.evaluate(() => app.fps);
    minFps = Math.min(minFps, fps);
    console.log(`第 ${round} 轮 ${t}：点击 ${items.length} 个控件，当前帧率 ${fps.toFixed(0)}`);
  }
}
// 视点、楼层、漫游、大屏
for (const b of await page.$$('#views button')) { await b.click(); await page.waitForTimeout(400); clicks++; }
await page.keyboard.press('Escape');
for (const b of await page.$$('.floor-switch button')) { await b.click(); await page.waitForTimeout(300); clicks++; }
await page.click('.dash-btn'); await page.waitForTimeout(800); await page.click('.dash-btn');
await page.waitForTimeout(3000);
const state = await page.evaluate(() => ({
  fps: app.fps.toFixed(0),
  people: app.people.list.map((p) => `${p.name}:${p.floor}层${p.room ?? '室外'}(${p.mode})`).join(' '),
  calls: app.renderer.info.render.calls,
  geos: app.renderer.info.memory.geometries, texs: app.renderer.info.memory.textures,
}));
console.log('最终状态', JSON.stringify(state));
console.log(`共点击 ${clicks} 次，最低帧率 ${minFps.toFixed(0)}，错误 ${errors.length} 个`);
await page.screenshot({ path: 'dev/monkey_end.png' });
await browser.close();
