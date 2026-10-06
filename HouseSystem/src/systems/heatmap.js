// 地面热力图：在室内地面上方叠加一张半透明的彩色贴图。
// 颜色映射：低 → 高 依次为 蓝 → 青 → 绿 → 黄 → 红（温度等参数"红→黄→蓝"表示从高到低）。
// 贴图用 Canvas 绘制：每个房间先填充该房间数值对应的颜色，再在空调、窗户、灶台等位置画径向渐变表示局部差异，
// 每个房间单独裁剪绘制，数值不会"穿墙"。活动热力图则由人员位置累积的密度场生成。
import * as THREE from 'three';
import { INDOOR_ROOMS, EXT, WALL_T, FLOORS } from '../scene/layout.js';
import { sectionPlane } from '../scene/common.js';

const PX = 24; // 每米多少像素

/** 数值归一化到 0~1 后映射成颜色（5 段线性插值） */
export function colorMap(t) {
  t = Math.min(1, Math.max(0, t));
  const stops = [[0, [40, 80, 220]], [0.25, [40, 190, 230]], [0.5, [60, 200, 90]], [0.75, [250, 220, 50]], [1, [230, 50, 40]]];
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0);
      return c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
    }
  }
  return stops.at(-1)[1];
}

/** 每层一张热力图（floor = 0 或 1） */
export class Heatmap {
  constructor(scene, floor = 0) {
    this.floor = floor;
    this.rooms = INDOOR_ROOMS.filter((r) => r.floor === floor);
    this.w = (EXT.x1 - EXT.x0) * PX;
    this.h = (EXT.z1 - EXT.z0) * PX;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w; this.canvas.height = this.h;
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const geo = new THREE.PlaneGeometry(EXT.x1 - EXT.x0, EXT.z1 - EXT.z0);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, opacity: 0.72, depthWrite: false, clippingPlanes: [sectionPlane] }));
    this.mesh.position.set((EXT.x0 + EXT.x1) / 2, FLOORS[floor].y + 0.035, (EXT.z0 + EXT.z1) / 2);
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    this.mesh.userData.noPick = true;
    scene.add(this.mesh);
    // 活动密度场（0.2m 一格）
    this.cell = 0.2;
    this.dw = Math.round((EXT.x1 - EXT.x0) / this.cell);
    this.dh = Math.round((EXT.z1 - EXT.z0) / this.cell);
    this.density = new Float32Array(this.dw * this.dh);
  }

  // 世界坐标 → 画布像素
  px(x) { return (x - EXT.x0) * PX; }
  pz(z) { return (z - EXT.z0) * PX; }

  roomClip(r) {
    const g = this.g;
    g.save();
    g.beginPath();
    g.rect(this.px(r.x0 + WALL_T / 2), this.pz(r.z0 + WALL_T / 2), (r.x1 - r.x0 - WALL_T) * PX, (r.z1 - r.z0 - WALL_T) * PX);
    g.clip();
  }

  /**
   * 绘制环境参数热力图。
   * values: { roomId: 数值 }；sources: [{x,z,r,value}] 局部源（空调出风口、打开的窗、灶台）
   */
  drawField(metric, values, sources) {
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    const norm = (v) => (v - metric.min) / (metric.max - metric.min);
    const css = (v, a = 1) => { const [r, gg, b] = colorMap(norm(v)); return `rgba(${r},${gg},${b},${a})`; };
    for (const r of this.rooms) {
      const v = values[r.id];
      this.roomClip(r);
      g.fillStyle = css(v);
      g.fillRect(0, 0, this.w, this.h);
      for (const s of sources) {
        if (s.room !== r.id) continue;
        const grd = g.createRadialGradient(this.px(s.x), this.pz(s.z), 0, this.px(s.x), this.pz(s.z), s.r * PX);
        grd.addColorStop(0, css(s.value, 0.95));
        grd.addColorStop(1, css(s.value, 0));
        g.fillStyle = grd;
        g.fillRect(0, 0, this.w, this.h);
      }
      g.restore();
    }
    this.texture.needsUpdate = true;
  }

  // ---------- 活动热力图 ----------
  clearDensity() { this.density.fill(0); }

  /** 在 (x,z) 处累加一个高斯"印章"，weight 为停留权重 */
  addActivity(x, z, weight = 1, radius = 0.6) {
    const c = this.cell, R = Math.ceil(radius / c * 2);
    const ci = Math.floor((x - EXT.x0) / c), cj = Math.floor((z - EXT.z0) / c);
    for (let j = cj - R; j <= cj + R; j++) for (let i = ci - R; i <= ci + R; i++) {
      if (i < 0 || j < 0 || i >= this.dw || j >= this.dh) continue;
      const dx = (i + 0.5) * c + EXT.x0 - x, dz = (j + 0.5) * c + EXT.z0 - z;
      this.density[j * this.dw + i] += weight * Math.exp(-(dx * dx + dz * dz) / (2 * radius * radius));
    }
  }

  drawDensity() {
    const g = this.g;
    g.clearRect(0, 0, this.w, this.h);
    let max = 0;
    for (const v of this.density) max = Math.max(max, v);
    if (max <= 0) { this.texture.needsUpdate = true; return; }
    // 先把密度画到一张小图上，再放大绘制（浏览器双线性插值使其平滑）
    const small = document.createElement('canvas');
    small.width = this.dw; small.height = this.dh;
    const sg = small.getContext('2d');
    const img = sg.createImageData(this.dw, this.dh);
    for (let k = 0; k < this.density.length; k++) {
      const t = Math.sqrt(this.density[k] / max); // 开方让低频区域也能看出差别
      const [r, gg, b] = colorMap(t);
      img.data.set([r, gg, b, t < 0.03 ? 0 : 150 + 105 * t], k * 4);
    }
    sg.putImageData(img, 0, 0);
    g.imageSmoothingEnabled = true;
    for (const r of this.rooms) {
      this.roomClip(r);
      g.fillStyle = 'rgba(40,80,220,0.55)';
      g.fillRect(0, 0, this.w, this.h);
      g.drawImage(small, 0, 0, this.w, this.h);
      g.restore();
    }
    this.texture.needsUpdate = true;
  }

  /** 每个房间的活动量占比（raw = true 时返回未归一化的累计量，便于两层合并） */
  roomShares(raw = false) {
    const sums = {};
    let total = 0;
    for (const r of this.rooms) sums[r.id] = 0;
    for (let j = 0; j < this.dh; j++) for (let i = 0; i < this.dw; i++) {
      const x = EXT.x0 + (i + 0.5) * this.cell, z = EXT.z0 + (j + 0.5) * this.cell;
      const r = this.rooms.find((q) => x >= q.x0 && x <= q.x1 && z >= q.z0 && z <= q.z1);
      if (r) { sums[r.id] += this.density[j * this.dw + i]; total += this.density[j * this.dw + i]; }
    }
    if (!raw) for (const k in sums) sums[k] = total ? sums[k] / total : 0;
    return sums;
  }
}
