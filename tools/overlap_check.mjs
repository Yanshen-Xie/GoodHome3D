// 穿插检查：计算每件家具的包围盒（只算可见网格，隐藏的喷射效果、展开状态等不计入），找出两两重叠、或嵌进墙体的家具（放在其他家具上面的小物件除外）。
import { chromium } from 'playwright';
const browser = await chromium.launch({ args: ['--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.goto((process.argv[2] ?? 'http://127.0.0.1:5188/') + '?nomerge');
await page.waitForFunction(() => window.app && !document.getElementById('loading'), null, { timeout: 90000 });
const r = await page.evaluate(() => {
  const box = (o) => { o.updateMatrixWorld(true); const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] }; o.traverseVisible((m) => { if (!m.isMesh || !m.geometry) return; m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const v = m.localToWorld(new m.position.constructor(x, y, z)); const a = v.toArray(); for (let k = 0; k < 3; k++) { b.min[k] = Math.min(b.min[k], a[k]); b.max[k] = Math.max(b.max[k], a[k]); } } }); return b; };
  const items = (app.sceneLayers?.furniture ?? app.furniture.root).children.map((o) => ({ name: o.userData.info?.name ?? ('未命名' + o.type + '@' + o.position.toArray().map((v) => v.toFixed(1)).join(',')), b: box(o) })).filter((it) => it.b.max[1] - it.b.min[1] > 0.06);
  const inter = (a, b, k) => Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k]);
  const out = [];
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].b, b = items[j].b;
    const dx = inter(a, b, 0), dy = inter(a, b, 1), dz = inter(a, b, 2);
    if (dx > 0.04 && dy > 0.04 && dz > 0.04) out.push(`${items[i].name} × ${items[j].name}：重叠 ${dx.toFixed(2)}×${dy.toFixed(2)}×${dz.toFixed(2)} m @(${((Math.max(a.min[0], b.min[0]) + Math.min(a.max[0], b.max[0])) / 2).toFixed(1)}, ${((Math.max(a.min[1], b.min[1]))).toFixed(1)}, ${((Math.max(a.min[2], b.min[2]) + Math.min(a.max[2], b.max[2])) / 2).toFixed(1)})`);
  }
  // 与墙体重叠：墙体按块取包围盒
  const walls = [];
  (app.sceneLayers?.walls ?? app.house.walls).traverse((m) => { if (m.isMesh) walls.push(box(m)); });
  for (const it of items) for (const w of walls) {
    const dx = inter(it.b, w, 0), dy = inter(it.b, w, 1), dz = inter(it.b, w, 2);
    if (dx > 0.04 && dy > 0.04 && dz > 0.04) { out.push(`${it.name} 嵌入墙体 ${Math.min(dx, dz).toFixed(2)} m @(${it.b.min[0].toFixed(1)},${it.b.min[1].toFixed(1)},${it.b.min[2].toFixed(1)})`); break; }
  }
  // 设备与家具：挂墙 / 落地设备不能插进家具里（吊顶上的灯、烟感、传感器、光伏、室外设备除外）
  const skip = new Set(['light', 'smoke', 'presence', 'pv', 'freshAir', 'curtain', 'lamp', 'nightLight', 'rain', 'flood', 'elevator']);
  for (const d of app.devices.registry.all()) {
    if (skip.has(d.type) || d.room == null) continue;
    const db = box(d.module.root);
    for (const it of items) {
      const dx = inter(db, it.b, 0), dy = inter(db, it.b, 1), dz = inter(db, it.b, 2);
      if (dx > 0.02 && dy > 0.02 && dz > 0.02) out.push(`设备「${d.module.info.name ?? d.id}」与家具「${it.name}」重叠 ${dx.toFixed(2)}×${dy.toFixed(2)}×${dz.toFixed(2)} m`);
    }
  }
  return [items.length, out];
});
console.log(`检查 ${r[0]} 件家具，发现 ${r[1].length} 处重叠：`);
console.log(r[1].join('\n'));
await browser.close();
