// 地点检查：居民作息表里的每个活动地点、救助目标点、电梯门前，都必须能站立（不在家具里）并且能走到。
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(process.argv[2] ?? 'http://127.0.0.1:5188/');
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 90000 });
const r = await page.evaluate(() => {
  const out = [];
  const pts = [];
  for (const p of app.people.list) for (const a of p.schedule) pts.push([p.name + ' ' + a.act, a.x, a.z, a.f]);
  pts.push(['电梯一层门前', 2.75, -2.9, 0], ['电梯二层门前', 2.75, -2.9, 1], ['老人房救助点', -5.3, -1.7, 0], ['卫生间救助点', -1.6, -1.7, 0]);
  for (const [name, x, z, f] of pts) {
    const g = app.nav.grid(f); g.buildClearance(1);
    const n = g.nearestWalkable(x, z, false);
    const d = n ? Math.hypot(g.cx(n[0]) - x, g.cz(n[1]) - z) : 99;
    const path = app.nav.findPath({ x: -6.45, z: 2.4, floor: 0 }, { x, z, floor: f });
    if (d > 0.3 || !path) out.push(`${name} (${x},${z}) 偏离可站位置 ${d.toFixed(2)}m 路线${path ? '有' : '无'}`);
  }
  return [pts.length, out];
});
console.log(`检查 ${r[0]} 个地点：` + (r[1].length ? '\n' + r[1].join('\n') : '全部可站立、可到达'));
await browser.close();
