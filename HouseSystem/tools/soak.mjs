// 长时间运行测试：时间快速播放，人物自由走动，定期检查报错、卡住、穿墙、悬空、内存增长。
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://127.0.0.1:5188/';
const minutes = +(process.argv[3] ?? 4);
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => { errors.push(e.message); console.log('[pageerror]', e.message); });
await page.goto(url);
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 90000 });
await page.evaluate(() => { app.clock.speed = 1200; app.clock.playing = true; app.activateTab('smart'); app.features.smart.setMode('auto'); app.rig.flyTo([24, 16, 28], [0, 3, 0], 0.1); });
const last = {};
const still = {};
const problems = [];
const t0 = Date.now();
let checks = 0, fpsMin = 99, fpsSum = 0;
while (Date.now() - t0 < minutes * 60000) {
  await page.waitForTimeout(10000);
  const s = await page.evaluate(() => {
    const { stairHeight } = window.__layout ?? {};
    return {
      hour: app.clock.hour.toFixed(1), fps: app.fps,
      geos: app.renderer.info.memory.geometries, texs: app.renderer.info.memory.textures,
      heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : -1,
      people: app.people.list.map((p) => ({
        n: p.name, x: +p.x.toFixed(2), y: +p.object.position.y.toFixed(2), z: +p.z.toFixed(2), f: p.floor, room: p.room, mode: p.mode, act: p.activity, path: p.path.length,
        // 站的位置是否是障碍（墙、家具）：只检查不在楼梯上、没在走路的人
        blocked: p.path.length === 0 && !app.nav.grid(p.floor).isFree(p.x, p.z),
        badY: Math.abs(p.object.position.y - 0.02 - p.floor * 3.2) > 0.05 && p.path.length === 0,
      })),
    };
  });
  checks++; fpsMin = Math.min(fpsMin, s.fps); fpsSum += s.fps;
  for (const p of s.people) {
    const k = p.n, pos = `${p.x},${p.y},${p.z}`;
    still[k] = last[k] === pos ? (still[k] ?? 0) + 1 : 0;
    last[k] = pos;
    if (still[k] >= 5) problems.push(`${s.hour}时 ${k} 连续 50 秒没动（${p.mode} ${p.act}）`);
    if (p.blocked) problems.push(`${s.hour}时 ${k} 站在障碍物里 (${p.x},${p.z}) ${p.f}层`);
    if (p.badY) problems.push(`${s.hour}时 ${k} 高度异常 y=${p.y} 楼层=${p.f}`);
  }
  console.log(`${s.hour}时 fps ${s.fps.toFixed(0)} 几何体 ${s.geos} 纹理 ${s.texs} 内存 ${s.heap}MB | ` + s.people.map((p) => `${p.n}:${p.f + 1}层${p.room ?? '室外'} ${p.act}`).join(' | '));
}
console.log(`检查 ${checks} 次，平均帧率 ${(fpsSum / checks).toFixed(0)}，最低 ${fpsMin.toFixed(0)}，报错 ${errors.length} 个，异常 ${problems.length} 个`);
for (const p of problems) console.log('  ' + p);
await browser.close();
