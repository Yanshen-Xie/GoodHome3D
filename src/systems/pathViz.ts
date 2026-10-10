// 地面路线可视化：沿路线生成一条贴地的带状网格，贴上箭头纹理并让纹理滚动，形成"流动的箭头"。
// 每个顶点可以有不同颜色（如无障碍检查时，过窄的路段显示为红色）。
import * as THREE from 'three';
import { sectionPlane } from '../scene/common.js';
import type { XZ } from './nav.js';

let arrowTex: THREE.CanvasTexture | null = null;
function arrowTexture(): THREE.CanvasTexture {
  if (arrowTex) return arrowTex;
  const c = document.createElement('canvas');
  c.width = 128; c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.55)';
  g.fillRect(0, 0, 128, 64);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(30, 10); g.lineTo(80, 32); g.lineTo(30, 54); g.lineTo(45, 32); g.closePath();
  g.fill();
  const texture = new THREE.CanvasTexture(c);
  texture.wrapS = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  arrowTex = texture;
  return texture;
}

export class FloorPath {
  // Fields are declared here and initialized by the existing runtime flow.
  declare length: any;
  declare mesh: any;
  declare texture: any;

  /**
   * @param points [{x,z}] 路线点
   * @param color  颜色，或函数 (i, 累计长度) => THREE.Color
   * @param width  带宽（米）
   */
  constructor(points: readonly (XZ & { y?: number })[], color: number | ((index: number, distance: number) => THREE.Color) = 0x2ecc71, width = 0.35, y = 0.05) {
    const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
    let dist = 0;
    const c = new THREE.Color();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      // 该点处的方向：取前后两段方向的平均，拐角处带子不断开
      const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
      let dx = b.x - a.x, dz = b.z - a.z;
      const L = Math.hypot(dx, dz) || 1; dx /= L; dz /= L;
      const nx = -dz * width / 2, nz = dx * width / 2;
      if (i > 0) dist += Math.hypot(p.x - points[i - 1].x, p.z - points[i - 1].z);
      const py = (p.y ?? 0) + y; // 路点带高度时（上下楼梯）带子也跟着升降
      pos.push(p.x + nx, py, p.z + nz, p.x - nx, py, p.z - nz);
      uv.push(dist / (width * 2), 1, dist / (width * 2), 0);
      if (typeof color === 'function') c.copy(color(i, dist)); else c.set(color);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      if (i > 0) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    this.texture = arrowTexture().clone();
    this.texture.needsUpdate = true;
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: this.texture, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [sectionPlane] }));
    this.mesh.renderOrder = 4;
    this.mesh.userData.noPick = true;
    this.length = dist;
  }

  update(dt, speed = 1.2) { this.texture.offset.x -= dt * speed; }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
