// 悬空检查：对每件家具和设备，从可见包围盒底面向下发射射线；落在地面或其他物体上、贴墙安装或吊装在天花板上都算有支撑，
// 三者都不满足的列出来。用法：node tools/float_check.mjs [url]
import { chromium } from 'playwright';

const url = (process.argv[2] ?? 'http://127.0.0.1:5188/') + '?nomerge';
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto(url);
await page.waitForFunction(() => window.app?.renderer && !document.getElementById('loading'), null, { timeout: 120000 });
const r = await page.evaluate(() => {
  const V = app.camera.position.constructor;
  const ray = new app.selection.raycaster.constructor();
  const layers = app.sceneLayers;
  const solids = [layers.walls, layers.house, layers.furniture, layers.devices, layers.outdoor];
  const visibleBox = (o) => {
    o.updateMatrixWorld(true);
    const b = { min: new V(1e9, 1e9, 1e9), max: new V(-1e9, -1e9, -1e9) };
    o.traverseVisible((m) => {
      if (!m.isMesh || !m.geometry) return;
      m.geometry.computeBoundingBox();
      const bb = m.geometry.boundingBox;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const v = m.localToWorld(new V(x, y, z)); b.min.min(v); b.max.max(v);
      }
    });
    return b;
  };
  // 从 origin 沿 dir 发射，忽略物体自身，返回最近命中距离
  const hit = (origin, dir, self, far) => {
    ray.set(origin, dir); ray.far = far;
    for (const h of ray.intersectObjects(solids, true)) {
      let o = h.object, own = false;
      for (; o; o = o.parent) if (o === self) { own = true; break; }
      if (!own && h.object.visible) return h.distance;
    }
    return Infinity;
  };
  const items = [
    ...app.moduleHost.modules().filter((m) => m.kind === 'furniture').map((m) => ({ name: m.info.name, id: m.id, root: m.root })),
    ...app.devices.registry.all().map((d) => ({ name: d.module.info.name, id: d.id, root: d.module.root })),
  ];
  const floating = [];
  let checked = 0;
  for (const it of items) {
    const b = visibleBox(it.root);
    if (b.min.x > b.max.x) continue; // 没有可见网格
    checked++;
    const cx = (b.min.x + b.max.x) / 2, cz = (b.min.z + b.max.z) / 2, cy = (b.min.y + b.max.y) / 2;
    const down = new V(0, -1, 0);
    const corners = [[cx, cz], [b.min.x + 0.02, b.min.z + 0.02], [b.max.x - 0.02, b.min.z + 0.02], [b.min.x + 0.02, b.max.z - 0.02], [b.max.x - 0.02, b.max.z - 0.02]];
    const rests = corners.some(([x, z]) => hit(new V(x, b.min.y + 0.02, z), down, it.root, 0.08) < 0.08) || b.min.y < 0.03;
    const wall = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => {
      const half = dx ? (b.max.x - b.min.x) / 2 : (b.max.z - b.min.z) / 2;
      return hit(new V(cx, cy, cz), new V(dx, 0, dz), it.root, half + 0.06) < half + 0.06;
    });
    const ceiling = hit(new V(cx, b.max.y - 0.02, cz), new V(0, 1, 0), it.root, 0.1) < 0.1;
    if (!rests && !wall && !ceiling) floating.push(`${it.name}（${it.id}）底面 y=${b.min.y.toFixed(2)}，中心 (${cx.toFixed(2)}, ${cz.toFixed(2)})`);
  }
  return { checked, floating };
});
console.log(`检查 ${r.checked} 件家具和设备，疑似悬空 ${r.floating.length} 件` + (r.floating.length ? '：\n' + r.floating.join('\n') : ''));
await browser.close();
