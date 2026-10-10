// 健康舒适：
//  1. 采光与日照：时间 / 日期滑块驱动太阳位置与阴影；外遮阳开关；各房间日照时长分析（射线检测）
//  2. 自然通风与新风：开关门窗、新风系统，粒子流线显示空气流动路径
//  3. 室内环境：温湿度、PM2.5、CO₂ 分布热力图与方案对比曲线
//  4. 适老无障碍：轮椅沿路线移动，检测通道宽度与回转空间
import * as THREE from 'three';
import { INDOOR_ROOMS, roomAt, roomById, FLOORS } from '../scene/layout.js';
import type { Room } from '../scene/layout.js';
import { box, cylinder, mat } from '../scene/common.js';
import { sunDirection } from '../scene/environment.js';
import { FloorPath } from '../systems/pathViz.js';
import { section, toggle, button, buttonGroup, stats, chart, chartBase, hint, el, toast } from '../ui/ui.js';
import type { OpeningHandle } from '../modules/contracts';
import type { NavPoint, XZ } from '../systems/nav.js';
import type { ComfortServices } from './services.js';

/** 一扇开着的窗户形成的气流口：室内、室外各取一个点 */
interface WindowAirway {
  readonly inside: XZ;
  readonly outside: XZ;
  readonly y: number;
  readonly facing: 'E' | 'W' | 'S' | 'N';
  readonly floor: number;
}

/** 一股气流的折线路径 */
interface AirPath {
  readonly pts: THREE.Vector3[];
  readonly color: THREE.Color;
  readonly speed: number;
  readonly spread: number;
}

// ---------------- 空气流动粒子 ----------------
class AirParticles {
  // Fields are declared here and initialized by the existing runtime flow.
  declare col: any;
  declare count: any;
  declare geo: any;
  declare p: any;
  declare paths: any;
  declare points: any;
  declare pos: any;

  constructor(scene, count = 1600) {
    this.count = count;
    this.geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(count * 3);
    this.col = new Float32Array(count * 3);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d')!;
    const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 32, 32);
    this.points = new THREE.Points(this.geo, new THREE.PointsMaterial({ size: 0.24, map: new THREE.CanvasTexture(c), vertexColors: true, transparent: true, depthWrite: false, opacity: 0.9 }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    this.points.visible = false;
    this.points.userData.noPick = true;
    scene.add(this.points);
    this.paths = [];
    this.p = []; // 每个粒子：所在路径、已走距离、偏移、速度
  }

  /** paths: [{ pts:[Vector3], color, speed, spread }] */
  setPaths(paths) {
    this.paths = paths.map((p) => {
      const cum = [0];
      for (let i = 1; i < p.pts.length; i++) cum.push(cum[i - 1] + p.pts[i].distanceTo(p.pts[i - 1]));
      return { ...p, cum, len: cum.at(-1) };
    }).filter((p) => p.len > 0.1);
    this.p = [];
    for (let i = 0; i < this.count; i++) {
      const path = this.paths[i % Math.max(1, this.paths.length)];
      this.p.push({ path, s: Math.random() * (path?.len ?? 1), ox: (Math.random() - 0.5), oy: (Math.random() - 0.5), speed: 0.7 + Math.random() * 0.6 });
    }
    this.points.visible = this.paths.length > 0;
  }

  update(dt) {
    if (!this.points.visible) return;
    const tmp = new THREE.Vector3(), dir = new THREE.Vector3();
    for (let i = 0; i < this.count; i++) {
      const q = this.p[i], path = q.path;
      q.s += dt * q.speed * path.speed;
      if (q.s > path.len) q.s -= path.len;
      // 在折线上找到第 s 米处的位置
      let k = 1;
      while (k < path.cum.length - 1 && path.cum[k] < q.s) k++;
      const a = path.pts[k - 1], b = path.pts[k];
      const f = (q.s - path.cum[k - 1]) / (path.cum[k] - path.cum[k - 1] || 1);
      tmp.lerpVectors(a, b, f);
      dir.subVectors(b, a).normalize();
      // 垂直方向随机偏移，让粒子成为一股"气流"而不是一条线
      const sp = path.spread;
      this.pos[i * 3] = tmp.x - dir.z * q.ox * sp;
      this.pos[i * 3 + 1] = tmp.y + q.oy * sp * 0.6;
      this.pos[i * 3 + 2] = tmp.z + dir.x * q.ox * sp;
      // 越接近终点越淡（颜色变暗）
      const fade = Math.min(1, (path.len - q.s) / 1.5, q.s / 0.8);
      this.col[i * 3] = path.color.r * fade; this.col[i * 3 + 1] = path.color.g * fade; this.col[i * 3 + 2] = path.color.b * fade;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}

// 轮椅模型（基本几何体组合）
function wheelchair() {
  const g = new THREE.Group();
  g.add(box(0.46, 0.06, 0.45, 'fabricBlue', 0, 0.48, 0));
  g.add(box(0.46, 0.45, 0.05, 'fabricBlue', 0, 0.52, -0.22));
  for (const s of [-1, 1]) {
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 28), mat('darkMetal'));
    wheel.rotation.y = Math.PI / 2;
    wheel.position.set(s * 0.29, 0.31, -0.05);
    g.add(wheel);
    const hand = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.01, 6, 24), mat('metal'));
    hand.rotation.y = Math.PI / 2; hand.position.set(s * 0.32, 0.31, -0.05);
    g.add(hand);
    g.add(cylinder(0.06, 0.06, 0.03, 'darkMetal', s * 0.2, 0.0, 0.3, 12).rotateZ(Math.PI / 2));
    g.add(box(0.03, 0.4, 0.03, 'metal', s * 0.22, 0.1, 0.28));
    g.add(box(0.04, 0.03, 0.4, 'metal', s * 0.24, 0.72, 0.0));
  }
  g.add(box(0.4, 0.03, 0.15, 'darkMetal', 0, 0.1, 0.35));
  return g;
}

export class ComfortFeature {
  // Fields are declared here and initialized by the existing runtime flow.
  declare accessPath: any;
  declare accessResult: any;
  declare air: any;
  declare airChart: any;
  declare airKey: any;
  declare airStats: any;
  declare airSummary: any;
  declare app: ComfortServices;
  declare curveChart: any;
  declare freshToggle: any;
  declare history: any;
  declare lastCurve: any;
  declare markers: any;
  declare metricBtns: any;
  declare shading: any;
  declare shadingOn: any;
  declare showAir: any;
  declare sunChart: any;
  declare wheel: any;
  declare wheelRoute: any;
  declare wheelS: any;
  declare winToggle: any;

  constructor(app: ComfortServices) {
    this.app = app;
    app.heatmap.onChange(() => this.metricBtns?.refresh());
    this.shadingOn = false;
    this.air = new AirParticles(app.scene);
    this.showAir = true;
    this.history = { t: [], living: [], co2: [], temp: [] };
    this.buildShading();
    this.wheel = null;
    this.accessPath = null;
    this.markers = [];
  }

  // 南向外遮阳：一、二层南窗上方的水平遮阳板（格栅）；客厅落地门东半部分已有阳台遮挡
  buildShading() {
    const g = new THREE.Group();
    for (const [x0, x1, top] of [[-6.8, -3.7, 2.55], [0.0, 2.6, 2.45], [4.4, 6.8, 2.35], [-7.2, -4.8, FLOORS[1].y + 2.35], [4.4, 6.8, FLOORS[1].y + 2.35]]) {
      const w = x1 - x0;
      g.add(box(w, 0.05, 0.9, 'frame', (x0 + x1) / 2, top + 0.2, 5.55));
      for (let k = 0; k < 6; k++) g.add(box(w, 0.02, 0.1, 'woodLight', (x0 + x1) / 2, top + 0.17, 5.18 + k * 0.15));
    }
    g.visible = false;
    this.shading = g;
    this.app.house.addFixture(g);
  }

  setShading(on) {
    this.shadingOn = on;
    this.shading.visible = on;
  }

  // ---------- 通风路径 ----------
  // 夏季主导风向为东南风：南墙、东墙上的开窗为进风口，北墙、西墙上的开窗为出风口；每层分别计算
  windowInfo(w: OpeningHandle): WindowAirway | null {
    const { center: p, normal: n } = w.getFrame();
    let inside: XZ | null = null, outside: XZ | null = null;
    for (const s of [1, -1]) {
      const q = { x: p.x + n.x * s * 0.7, z: p.z + n.z * s * 0.7 };
      const r = roomAt(q.x, q.z, w.floor);
      if (r && !r.outdoor) inside = q; else outside = { x: p.x + n.x * s * 2.0, z: p.z + n.z * s * 2.0 };
    }
    const y = p.y;
    const facing = Math.abs(n.x) > 0.5 ? (p.x > 0 ? 'E' : 'W') : (p.z > 0 ? 'S' : 'N');
    return inside && outside ? { inside, outside, y, facing, floor: w.floor } : null;
  }

  rebuildAirflow() {
    const app = this.app;
    const open = app.openings.list(['window', 'slide']).filter((w) => w.isOpen()).map((w) => this.windowInfo(w)).filter((i): i is WindowAirway => i !== null);
    const paths: AirPath[] = [];
    const fresh = new THREE.Color(0x39b4ff);
    this.airSummary = { inlets: 0, outlets: 0 };
    for (const floor of [0, 1]) {
      const fy = FLOORS[floor].y;
      const inlets = open.filter((i) => i.floor === floor && (i.facing === 'S' || i.facing === 'E'));
      const outlets = open.filter((i) => i.floor === floor && (i.facing === 'N' || i.facing === 'W'));
      this.airSummary.inlets += inlets.length; this.airSummary.outlets += outlets.length;
      for (const a of inlets) {
        let best: { b: WindowAirway; path: NavPoint[] } | null = null;
        for (const b of outlets) {
          const path = app.nav.findPath({ x: a.inside.x, z: a.inside.z, floor }, { x: b.inside.x, z: b.inside.z, floor });
          if (path && (!best || path.length < best.path.length)) best = { b, path };
        }
        if (best) {
          const pts = [new THREE.Vector3(a.outside.x, a.y, a.outside.z), ...best.path.map((p, i) => new THREE.Vector3(p.x, fy + 1.4 + Math.sin(i * 1.3) * 0.15, p.z)), new THREE.Vector3(best.b.outside.x, best.b.y, best.b.outside.z)];
          paths.push({ pts, color: fresh, speed: 1.6, spread: 0.8 });
        } else {
          // 单侧通风：空气从窗户进入、在房间内打个转再从同一扇窗出去
          const c = a.inside, n = { x: c.x - a.outside.x, z: c.z - a.outside.z };
          const L = Math.hypot(n.x, n.z); n.x /= L; n.z /= L;
          paths.push({ pts: [
            new THREE.Vector3(a.outside.x, a.y + 0.2, a.outside.z), new THREE.Vector3(c.x, a.y + 0.2, c.z),
            new THREE.Vector3(c.x + n.x * 1.8 - n.z * 0.8, fy + 1.2, c.z + n.z * 1.8 + n.x * 0.8),
            new THREE.Vector3(c.x + n.x * 1.8 + n.z * 0.8, fy + 1.0, c.z + n.z * 1.8 - n.x * 0.8),
            new THREE.Vector3(c.x, a.y - 0.2, c.z), new THREE.Vector3(a.outside.x, a.y - 0.2, a.outside.z),
          ], color: fresh, speed: 1.0, spread: 0.5 });
        }
      }
      if (!inlets.length) for (const b of outlets) {
        const c = b.inside;
        paths.push({ pts: [new THREE.Vector3(b.outside.x, b.y, b.outside.z), new THREE.Vector3(c.x, b.y, c.z), new THREE.Vector3((c.x + b.outside.x) / 2 + 0.01, b.y - 0.3, (c.z + b.outside.z) / 2)], color: fresh, speed: 0.8, spread: 0.5 });
      }
    }
    // 新风系统：新风从天花板风口送出，向下扩散到房间内
    const ventilation = app.devices.registry.getVentilation('fresh-air');
    if (ventilation?.isOn()) {
      const c = new THREE.Color(0x3ddc84);
      for (const v of ventilation.getOutlets?.() ?? []) {
        const r = roomById(v.room);
        if (!r) continue;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + 0.4;
          const tx = THREE.MathUtils.clamp(v.x + Math.cos(a) * 1.4, r.x0 + 0.3, r.x1 - 0.3);
          const tz = THREE.MathUtils.clamp(v.z + Math.sin(a) * 1.4, r.z0 + 0.3, r.z1 - 0.3);
          const fy = FLOORS[v.floor].y;
          paths.push({ pts: [new THREE.Vector3(v.x, v.y, v.z), new THREE.Vector3((v.x + tx) / 2, fy + 2.2, (v.z + tz) / 2), new THREE.Vector3(tx, fy + 0.8, tz)], color: c, speed: 0.6 * ventilation.getLevel(), spread: 0.25 });
        }
      }
    }
    this.air.setPaths(this.showAir ? paths : []);
    this.airSummary.fresh = ventilation?.isOn() ?? false;
  }

  setAllWindows(open) {
    for (const w of this.app.openings.list('window')) w.setOpen(open);
    this.rebuildAirflow();
  }

  // ---------- 日照分析 ----------
  // 每个房间取 3×3 个地面采样点，每半小时朝太阳方向发射射线，没有被墙体、屋顶、遮阳板挡住就算"被阳光直射"
  sunlightHours(day, withShading) {
    const app = this.app;
    const blockers = [...app.house.sunBlockers];
    if (withShading) blockers.push(this.shading);
    const ray = new THREE.Raycaster();
    const result = {};
    for (const r of this.sunRooms()) {
      let lit = 0;
      for (let i = 1; i <= 3; i++) for (let j = 1; j <= 3; j++) {
        const o = new THREE.Vector3(r.x0 + (r.x1 - r.x0) * i / 4, FLOORS[r.floor].y + 0.8, r.z0 + (r.z1 - r.z0) * j / 4);
        for (let hh = 5; hh <= 19.5; hh += 0.5) {
          const s = sunDirection(hh, day);
          if (s.elevation <= 2) continue;
          ray.set(o, s.dir);
          ray.far = 60;
          if (ray.intersectObjects(blockers, true).length === 0) lit++;
        }
      }
      result[r.id] = (lit / 9) * 0.5;
    }
    return result;
  }

  sunRooms() { return INDOOR_ROOMS.filter((r) => !/hall|stair|bath|utility/.test(r.id)); }

  runSunAnalysis() {
    const day = this.app.clock.day;
    const a = this.sunlightHours(day, false), b = this.sunlightHours(day, true);
    const rooms = this.sunRooms();
    const c = this.sunChart.getChart();
    c.setOption({
      ...chartBase,
      title: { text: `各房间地面日照时长（${this.dayName()}）`, textStyle: { fontSize: 12 }, left: 0, top: 0 },
      legend: { ...chartBase.legend, right: 0, left: 'auto' },
      grid: { ...chartBase.grid, top: 40, bottom: 44 },
      xAxis: { type: 'category', data: rooms.map((r) => r.name.replace('家庭', '')), axisLabel: { interval: 0, fontSize: 10, rotate: 30 } },
      yAxis: { type: 'value', name: '小时', nameTextStyle: { fontSize: 10 } },
      series: [
        { name: '无外遮阳', type: 'bar', data: rooms.map((r) => +a[r.id].toFixed(1)), itemStyle: { color: '#f0a33a' } },
        { name: '有外遮阳', type: 'bar', data: rooms.map((r) => +b[r.id].toFixed(1)), itemStyle: { color: '#8a9aa8' } },
      ],
    }, true);
    toast('日照分析完成：共发射约 ' + (rooms.length * 9 * 30 * 2) + ' 条射线');
  }

  dayName() { return { 172: '夏至', 80: '春分', 266: '秋分', 355: '冬至' }[this.app.clock.day] ?? ''; }

  drawSunCurve() {
    const day = this.app.clock.day;
    const hours: number[] = [], elev: number[] = [];
    for (let h = 4; h <= 20; h += 0.25) { hours.push(h); elev.push(+Math.max(0, sunDirection(h, day).elevation).toFixed(1)); }
    const c = this.curveChart.getChart();
    const now = this.app.clock.hour;
    c.setOption({
      ...chartBase,
      title: { text: `太阳高度角（${this.dayName()}，广州）`, textStyle: { fontSize: 12 }, left: 0, top: 0 },
      grid: { ...chartBase.grid, top: 34 },
      legend: { show: false },
      xAxis: { type: 'value', min: 4, max: 20, interval: 2, axisLabel: { formatter: (v) => v + '时' } },
      yAxis: { type: 'value', name: '度', max: 90, nameTextStyle: { fontSize: 10 } },
      series: [{ type: 'line', data: hours.map((h, i) => [h, elev[i]]), showSymbol: false, smooth: true, areaStyle: { color: 'rgba(240,163,58,0.25)' }, lineStyle: { color: '#f0a33a' },
        markLine: { symbol: 'none', data: [{ xAxis: now }], lineStyle: { color: '#d64541' }, label: { formatter: '当前' } } }],
    }, true);
  }

  // ---------- 适老无障碍 ----------
  runAccessibility() {
    const app = this.app;
    this.clearAccess();
    // 路线：老人房床边 → 卫生间（马桶前）→ 客厅沙发
    const stops = [{ x: -5.6, z: -2.4, name: '老人房床边' }, { x: -1.9, z: -2.3, name: '卫生间' }, { x: -6.3, z: 1.9, name: '客厅沙发' }];
    let pts: NavPoint[] = [];
    for (let i = 0; i < stops.length - 1; i++) {
      const p = app.nav.findPath({ x: stops[i].x, z: stops[i].z, floor: 0 }, { x: stops[i + 1].x, z: stops[i + 1].z, floor: 0 }, { radius: 1 });
      if (!p) { toast('路线规划失败'); return; }
      pts = pts.concat(i ? p.slice(1) : p);
    }
    // 把路线加密成 0.1m 一个点，逐点测量通行宽度
    const dense: XZ[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.1));
      for (let k = 0; k < n; k++) dense.push({ x: a.x + (b.x - a.x) * k / n, z: a.z + (b.z - a.z) * k / n });
    }
    dense.push(pts[pts.length - 1]);
    const widths = dense.map((p, i) => {
      const q = dense[Math.min(dense.length - 1, i + 1)], o = dense[Math.max(0, i - 1)];
      return app.nav.passWidth(p.x, p.z, q.x - o.x, q.z - o.z);
    });
    const need = 0.8; // 轮椅通行最小净宽（米）
    let minW = Infinity, minAt = 0;
    widths.forEach((w, i) => { if (w < minW) { minW = w; minAt = i; } });
    const narrow = widths.filter((w) => w < need).length;
    const red = new THREE.Color(0xe74c3c), green = new THREE.Color(0x2ecc71), yellow = new THREE.Color(0xf1c40f);
    this.accessPath = new FloorPath(dense, (i) => (widths[i] < need ? red : widths[i] < 0.95 ? yellow : green), 0.5);
    app.scene.add(this.accessPath.mesh);
    // 回转空间检查：在卫生间、老人房找一块直径 1.5m 的空地
    const turn: Record<string, { x: number; z: number } | null> = {};
    for (const id of ['elder', 'bath1', 'living']) turn[id] = this.findTurningCircle(roomById(id));
    for (const [id, c] of Object.entries(turn)) {
      if (!c) continue;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.75, 48), new THREE.MeshBasicMaterial({ color: 0x3fa9f5, transparent: true, opacity: 0.9, side: THREE.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.06, c.z);
      app.scene.add(ring);
      this.markers.push(ring);
    }
    const mp = dense[minAt];
    this.markers.push(app.makeLabel(`最窄处 ${minW.toFixed(2)} m`, minW < need ? 'alarm' : 'dark', mp.x, 1.0, mp.z));
    // 轮椅沿路线移动
    this.wheel = wheelchair();
    app.scene.add(this.wheel);
    this.wheelRoute = dense;
    this.wheelS = 0;
    const res = this.accessResult;
    res.innerHTML = `路线：${stops.map((s) => s.name).join(' → ')}，全长 ${this.accessPath.length.toFixed(1)} m<br>` +
      `最窄通行宽度：<b style="color:${minW < need ? '#d64541' : '#2e9d57'}">${minW.toFixed(2)} m</b>（要求 ≥ ${need} m）${narrow ? `，有 ${(narrow * 0.1).toFixed(1)} m 路段偏窄` : '，全程满足'}<br>` +
      `回转空间（直径 1.5 m）：${Object.entries(turn).map(([id, c]) => `${roomById(id)?.name ?? id}${c ? '✔' : '✘'}`).join('　')}<br>` +
      `地面无高差、门洞净宽 0.9–1.0 m、走廊设连续扶手、卫生间设安全抓杆与淋浴座椅。`;
    app.viewFloor(0);
    app.flyTo([-3, 18, 9], [-3, 0, -0.5]);
  }

  findTurningCircle(r: Room | undefined): XZ | null {
    if (!r) return null;
    const nav = this.app.nav;
    let best: XZ | null = null;
    for (let x = r.x0 + 0.85; x <= r.x1 - 0.85; x += 0.1) for (let z = r.z0 + 0.85; z <= r.z1 - 0.85; z += 0.1) {
      let ok = true;
      for (let a = 0; a < 16 && ok; a++) for (const rr of [0.25, 0.5, 0.75]) {
        if (!nav.isFree(x + Math.cos(a / 16 * Math.PI * 2) * rr, z + Math.sin(a / 16 * Math.PI * 2) * rr)) { ok = false; break; }
      }
      if (ok && nav.isFree(x, z)) { best = { x, z }; return best; }
    }
    return best;
  }

  clearAccess() {
    this.accessPath?.dispose(); this.accessPath = null;
    if (this.wheel) { this.app.scene.remove(this.wheel); this.wheel = null; }
    for (const m of this.markers) m.parent?.remove(m);
    this.markers = [];
  }

  // ---------- 面板 ----------
  buildPanel(root) {
    const app = this.app;
    const s1 = section('采光与日照', '拖动底部时间栏或点击“播放”，太阳位置按广州纬度实时计算，室内阴影与采光范围随之变化。外遮阳可遮挡夏季高角度阳光，冬季低角度阳光仍能照进室内。');
    s1.append(el('div', { class: 'btns' },
      button('上午 9 点', () => this.setHour(9)), button('正午', () => this.setHour(12)), button('下午 4 点', () => this.setHour(16)), button('傍晚 6 点', () => this.setHour(18)),
      button('播放一天', () => { app.setPlaying(true); this.setHour(6); }, 'primary'),
    ));
    s1.append(toggle('南向外遮阳（遮阳板格栅）', () => this.shadingOn, (v) => this.setShading(v)));
    s1.append(toggle('窗帘全部打开', () => (app.devices.registry.getCurtain('curtain-living')?.getOpenRatio() ?? 0) > 0.5, (v) => app.devices.registry.byType('curtain').forEach((d) => app.devices.registry.setCurtain(d.id, v ? 1 : 0))));
    this.curveChart = chart(160);
    s1.append(this.curveChart);
    this.sunChart = chart(200);
    s1.append(button('分析各房间日照时长（射线检测）', () => this.runSunAnalysis(), 'primary'));
    s1.append(this.sunChart);
    s1.append(el('div', { class: 'btns' }, button('客厅采光视角', () => { app.flyTo([-3.9, 2.3, 4.7], [-7.0, 0.8, 1.9]); app.viewFloor('all'); }), button('起居室采光视角', () => { app.flyTo([2.4, 5.0, 4.4], [-2.6, 3.9, 2.4]); app.viewFloor('all'); })));
    root.append(s1);

    const s2 = section('自然通风与新风', '夏季东南风：南、东侧开窗进风，北、西侧开窗出风，形成穿堂风。蓝色粒子为室外自然风，绿色粒子为新风系统送出的过滤新风。');
    this.winToggle = toggle('打开所有窗户（自然通风）', () => app.openings.list('window').some((w) => w.isOpen()), (v) => this.setAllWindows(v));
    s2.append(this.winToggle);
    this.freshToggle = toggle('新风系统', () => app.devices.registry.getVentilation('fresh-air')?.isOn() ?? false, (v) => { app.devices.registry.getVentilation('fresh-air')?.setOn(v); this.rebuildAirflow(); });
    s2.append(this.freshToggle);
    s2.append(toggle('显示气流粒子', () => this.showAir, (v) => { this.showAir = v; this.rebuildAirflow(); }));
    s2.append(el('div', { class: 'btns' },
      button('方案A：关窗、无新风', () => this.scheme('A')), button('方案B：开窗通风', () => this.scheme('B')), button('方案C：关窗 + 新风', () => this.scheme('C')),
    ));
    this.airStats = stats([
      { k: '客厅 PM2.5', v: () => app.envModel.rooms.living.pm.toFixed(0), unit: 'μg/m³' },
      { k: '客厅 CO₂', v: () => app.envModel.rooms.living.co2.toFixed(0), unit: 'ppm' },
      { k: '主卧 CO₂', v: () => app.envModel.rooms.master.co2.toFixed(0), unit: 'ppm' },
      { k: '室外 PM2.5', v: () => app.envModel.outdoor.pm.toFixed(0), unit: 'μg/m³' },
    ]);
    s2.append(this.airStats);
    this.airChart = chart(170);
    s2.append(this.airChart);
    root.append(s2);

    const s3 = section('温湿度与空气质量分布', '在地面上以颜色显示各房间的环境参数（红→黄→蓝表示从高到低），并标注数值；可对比开窗、空调、新风前后的变化。');
    this.metricBtns = buttonGroup([
      { label: '关闭', value: 'none' }, { label: '温度', value: 'temp' }, { label: '湿度', value: 'rh' }, { label: 'PM2.5', value: 'pm' }, { label: 'CO₂', value: 'co2' }, { label: '噪声', value: 'noise' },
    ], () => app.heatmap.metric, (v) => app.heatmap.setHeatmap(v));
    s3.append(this.metricBtns);
    s3.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('一层', () => app.heatmap.setHeatmap(app.heatmap.metric === 'none' ? 'temp' : app.heatmap.metric, 0)),
      button('二层', () => app.heatmap.setHeatmap(app.heatmap.metric === 'none' ? 'temp' : app.heatmap.metric, 1)),
      button('打开全部空调', () => app.devices.registry.byType('ac').forEach((d) => { const c = app.devices.registry.getClimate(d.id); c?.setSetpoint(25); c?.setOn(true); })),
      button('关闭全部空调', () => app.devices.registry.byType('ac').forEach((d) => app.devices.registry.getClimate(d.id)?.setOn(false))),
    ));
    root.append(s3);

    const s4 = section('适老无障碍检查', '轮椅沿“老人房 → 卫生间 → 客厅”的路线移动，逐点测量通道净宽（绿色 ≥ 0.95m，黄色 0.8~0.95m，红色 < 0.8m 过窄），并检查各房间是否有直径 1.5m 的轮椅回转空间（蓝色圆圈）。');
    s4.append(el('div', { class: 'btns' }, button('开始无障碍检查', () => this.runAccessibility(), 'primary'), button('清除', () => { this.clearAccess(); this.accessResult.innerHTML = '点击“开始无障碍检查”。'; })));
    this.accessResult = hint('点击“开始无障碍检查”。');
    this.accessResult.style.marginTop = '6px';
    s4.append(this.accessResult);
    s4.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('查看卫生间适老设施', () => { app.viewFloor(0); app.flyTo([-1.2, 4.6, 0.6], [-2.0, 0.5, -3.0]); }), button('查看家用电梯', () => { app.viewFloor('all'); app.flyTo([3.1, 5.0, 0.4], [2.7, 1.6, -4.0]); }),
      button('夜间感应灯', () => { const n = app.devices.registry.getPower('night-light'); if (!n) return; n.setOn(!n.isOn()); toast(n.isOn() ? '夜间感应地脚灯已点亮' : '夜间感应地脚灯已关闭'); }),
    ));
    root.append(s4);

    app.onTimeChanged(() => { if (app.activeTab === 'comfort') this.drawSunCurveThrottled(); });
  }

  drawSunCurveThrottled() {
    const now = performance.now();
    if (now - (this.lastCurve ?? 0) > 400) { this.lastCurve = now; this.drawSunCurve(); }
  }

  setHour(h) {
    this.app.setTime(h);
    this.app.viewFloor('all');
  }

  scheme(k) {
    const app = this.app;
    const ventilation = app.devices.registry.getVentilation('fresh-air');
    if (k === 'A') { this.setAllWindows(false); ventilation?.setOn(false); }
    if (k === 'B') { this.setAllWindows(true); ventilation?.setOn(false); }
    if (k === 'C') { this.setAllWindows(false); ventilation?.setLevel(2); ventilation?.setOn(true); }
    this.rebuildAirflow();
    this.winToggle.refresh(); this.freshToggle.refresh();
    toast({ A: '方案A：门窗关闭、新风关闭 —— CO₂ 与 PM2.5 将逐渐升高', B: '方案B：开窗自然通风 —— CO₂ 下降，但室外 PM2.5、噪声会进入', C: '方案C：关窗 + 新风 —— 过滤后的新风送入，CO₂ 和 PM2.5 都较低' }[k], '', 3500);
  }

  enter() {
    this.drawSunCurve();
    this.rebuildAirflow();
    this.airChart.getChart().resize();
  }

  leave() {}

  update(dt, active) {
    // 气流粒子只在“健康舒适”和“智慧便捷”页显示
    const tab = this.app.activeTab;
    this.air.points.visible = (tab === 'comfort' || tab === 'smart') && this.air.paths.length > 0;
    this.air.update(dt);
    this.accessPath?.update(dt, 0.8);
    if (this.wheel && this.wheelRoute) {
      const r = this.wheelRoute;
      this.wheelS = (this.wheelS + dt * 6) % (r.length - 1); // 每秒前进 6 个点 = 0.6 m/s
      const i = Math.floor(this.wheelS), f = this.wheelS - i;
      const a = r[i], b = r[Math.min(r.length - 1, i + 1)];
      this.wheel.position.set(a.x + (b.x - a.x) * f, 0.03, a.z + (b.z - a.z) * f);
      const c = r[Math.min(r.length - 1, i + 4)];
      if (Math.hypot(c.x - a.x, c.z - a.z) > 0.05) this.wheel.rotation.y = Math.atan2(c.x - a.x, c.z - a.z);
    }
  }

  slowUpdate(dt, active) {
    const e = this.app.envModel.rooms;
    const h = this.history;
    h.t.push(this.app.clock.hour.toFixed(2));
    h.living.push(+e.living.pm.toFixed(1)); h.co2.push(+e.living.co2.toFixed(0)); h.temp.push(+e.living.temp.toFixed(1));
    if (h.t.length > 120) for (const k in h) h[k].shift();
    // 门窗在别处被改变时，重新生成气流路径
    const ventilation = this.app.devices.registry.getVentilation('fresh-air');
    const key = this.app.openings.list(['window', 'slide']).map((w) => (w.isOpen() ? 1 : 0)).join('') + (ventilation?.isOn() ?? false) + (ventilation?.getLevel() ?? 0);
    if (key !== this.airKey) { this.airKey = key; this.rebuildAirflow(); this.winToggle?.refresh(); this.freshToggle?.refresh(); }
    if (!active) return;
    this.airStats.refresh();
    this.airChart.getChart().setOption({
      ...chartBase,
      title: { text: '客厅空气质量变化', textStyle: { fontSize: 12 }, left: 0, top: 0 },
      legend: { ...chartBase.legend, right: 0, left: 'auto' },
      grid: { left: 40, right: 44, top: 36, bottom: 22 },
      xAxis: { type: 'category', data: h.t.map((_, i) => i), show: false },
      yAxis: [{ type: 'value' }, { type: 'value', splitLine: { show: false } }],
      series: [
        { name: 'PM2.5', type: 'line', data: h.living, showSymbol: false, smooth: true, lineStyle: { color: '#e08a1f' }, itemStyle: { color: '#e08a1f' } },
        { name: 'CO₂', type: 'line', yAxisIndex: 1, data: h.co2, showSymbol: false, smooth: true, lineStyle: { color: '#3f7fd6' }, itemStyle: { color: '#3f7fd6' } },
      ],
      animation: false,
    });
  }
}
