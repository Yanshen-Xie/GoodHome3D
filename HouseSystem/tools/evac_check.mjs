// 疏散全覆盖检查：厨房起火（火源周围 1.8m 为危险区）时，从两层所有可站立位置出发，检查能否绕开危险区到达安全出口。
import { chromium } from 'playwright';
const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(url);
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 90000 });
const r = await page.evaluate(() => {
  const nav = app.nav, S = app.features.safety;
  nav.setDanger(7.6, 1.6, 1.8, 0);
  const res = { total: 0, ok: 0, inDanger: 0, fail: [] };
  for (const floor of [0, 1]) {
    const g = nav.grid(floor);
    g.buildClearance(1);
    for (let x = -7.7; x <= 7.7; x += 0.6) for (let z = -4.7; z <= 4.7; z += 0.6) {
      const i = g.ix(x), j = g.iz(z);
      if (!g.walkable(i, j, false)) continue;           // 家具、墙里的点跳过
      res.total++;
      if (floor === 0 && Math.hypot(x - 7.6, z - 1.6) < 1.8) { res.inDanger++; continue; }
      const best = S.nearestExit({ x, z, floor }, true);
      if (best) res.ok++; else res.fail.push(`${floor + 1}层 (${x.toFixed(1)}, ${z.toFixed(1)})`);
    }
  }
  nav.setDanger(0, 0, 0, 0);
  return res;
});
console.log(`检查 ${r.total} 个位置：能安全疏散 ${r.ok} 个，位于火源危险区内 ${r.inDanger} 个（走兜底路线），无法疏散 ${r.fail.length} 个`);
if (r.fail.length) console.log(r.fail.join('\n'));
await browser.close();
