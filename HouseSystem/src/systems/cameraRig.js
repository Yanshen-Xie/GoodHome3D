// 摄像机控制：
//  1. 轨道模式（默认）：左键拖动旋转、滚轮缩放、右键拖动平移（OrbitControls）
//  2. 预设视点：点击按钮后摄像机平滑飞到指定位置，同时切换显示的楼层
//  3. 漫游模式：第一人称，WASD / 方向键移动，鼠标拖动转头；会被墙和家具挡住，可以走楼梯上下楼
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { stairHeight, FLOORS } from '../scene/layout.js';

// view：显示哪一层（'all' 全部，0 只看一层，1 只看到二层）
export const VIEWPOINTS = [
  { id: 'overview', name: '整体鸟瞰', pos: [24, 16, 28], target: [0, 3, 0], view: 'all' },
  { id: 'f1', name: '一层俯视', pos: [0, 24, 10], target: [0, 0, 0.5], view: 0 },
  { id: 'f2', name: '二层俯视', pos: [0, 27, 10], target: [0, 3.2, 0.5], view: 1 },
  { id: 'entry', name: '入户视角', pos: [-17, 2.2, 4], target: [-8, 1.6, -0.2], view: 'all' },
  { id: 'living', name: '客厅', pos: [-3.9, 2.3, 4.7], target: [-7.0, 0.8, 1.9], view: 'all' },
  { id: 'kitchen', name: '厨房', pos: [5.0, 5.4, 6.6], target: [6.2, 0.8, 2.4], view: 0 },
  { id: 'elder', name: '老人房', pos: [-4.2, 5.2, 1.4], target: [-5.6, 0.6, -3.2], view: 0 },
  { id: 'stair', name: '楼梯电梯', pos: [3.1, 5.0, 0.4], target: [0.9, 1.6, -3.2], view: 'all' },
  { id: 'master', name: '主卧', pos: [-3.8, 8.4, 1.2], target: [-5.4, 3.8, -3.2], view: 1 },
  { id: 'family', name: '起居室', pos: [2.4, 5.0, 4.4], target: [-2.6, 3.9, 2.4], view: 'all' },
  { id: 'roof', name: '屋顶光伏', pos: [16, 14, 17], target: [0, 6, 0], view: 'all' },
];

const EYE = 1.6;      // 眼睛高度
const STEP = 0.45;    // 能迈上的最大高度差

export class CameraRig {
  constructor(camera, dom, nav) {
    this.camera = camera;
    this.dom = dom;
    this.nav = nav;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 140;
    this.controls.screenSpacePanning = false;
    this.tween = null;
    this.mode = 'orbit';
    this.walk = { yaw: 0, pitch: 0, keys: new Set(), dragging: false, lastX: 0, lastY: 0, ground: 0 };
    this.onModeChange = null;
    this.bindWalkEvents();
  }

  flyTo(pos, target, duration = 1.2) {
    if (this.mode === 'walk') this.setMode('orbit');
    this.tween = {
      t: 0, duration,
      fromPos: this.camera.position.clone(), toPos: new THREE.Vector3(...pos),
      fromTarget: this.controls.target.clone(), toTarget: new THREE.Vector3(...target),
    };
  }

  focus(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(0.6, box.getSize(new THREE.Vector3()).length());
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const pos = c.clone().add(dir.multiplyScalar(Math.max(4, r * 1.6 + 1.5)));
    pos.y = Math.max(pos.y, c.y + 0.5);
    this.flyTo(pos.toArray(), c.toArray(), 0.9);
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'walk') {
      this.tween = null;
      this.controls.enabled = false;
      this.walk.ground = 0;
      this.camera.position.set(-7.0, EYE, -0.1); // 从入户门内开始
      this.walk.yaw = -Math.PI / 2;
      this.walk.pitch = -0.05;
      this.applyWalkRotation();
    } else {
      this.controls.enabled = true;
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.controls.target.copy(this.camera.position).add(dir.multiplyScalar(4));
    }
    this.onModeChange?.(mode);
  }

  applyWalkRotation() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.walk.pitch, this.walk.yaw, 0, 'YXZ'));
  }

  bindWalkEvents() {
    const w = this.walk;
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      w.keys.add(e.code);
      if (e.code === 'Escape' && this.mode === 'walk') this.setMode('orbit');
    });
    window.addEventListener('keyup', (e) => w.keys.delete(e.code));
    this.dom.addEventListener('pointerdown', (e) => { if (this.mode === 'walk') { w.dragging = true; w.lastX = e.clientX; w.lastY = e.clientY; } });
    window.addEventListener('pointerup', () => { w.dragging = false; });
    window.addEventListener('pointermove', (e) => {
      if (this.mode !== 'walk' || !w.dragging) return;
      w.yaw -= (e.clientX - w.lastX) * 0.004;
      w.pitch = THREE.MathUtils.clamp(w.pitch - (e.clientY - w.lastY) * 0.004, -1.2, 1.2);
      w.lastX = e.clientX; w.lastY = e.clientY;
      this.applyWalkRotation();
    });
  }

  /**
   * (x,z) 处可以站立的地面高度：候选有一层地面、二层楼面、楼梯踏步，
   * 选与当前高度最接近、且高差不超过 STEP 的那个；都不行返回 null（被挡住）。
   */
  surfaceAt(x, z, curY) {
    const cands = [];
    for (const f of FLOORS) if (this.nav.isFree(x, z, f.id)) cands.push(f.y);
    const s = stairHeight(x, z);
    if (s !== null) cands.push(s);
    let best = null;
    for (const y of cands) if (Math.abs(y - curY) <= STEP && (best === null || Math.abs(y - curY) < Math.abs(best - curY))) best = y;
    return best;
  }

  // 人体有宽度：中心和周围 4 个点都要能站
  canStand(x, z, curY) {
    const y = this.surfaceAt(x, z, curY);
    if (y === null) return null;
    const r = 0.18;
    for (const [dx, dz] of [[r, 0], [-r, 0], [0, r], [0, -r]]) if (this.surfaceAt(x + dx, z + dz, y) === null) return null;
    return y;
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2;
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) this.tween = null;
    }
    if (this.mode === 'walk') {
      const k = this.walk.keys, w = this.walk;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (k.has('KeyQ')) { w.yaw += dt * 1.5; this.applyWalkRotation(); }
      if (k.has('KeyE')) { w.yaw -= dt * 1.5; this.applyWalkRotation(); }
      const p = this.camera.position;
      if (f || s) {
        const speed = (k.has('ShiftLeft') ? 3.2 : 1.6) * dt;
        const dx = (-Math.sin(w.yaw) * f + Math.cos(w.yaw) * s) * speed;
        const dz = (-Math.cos(w.yaw) * f - Math.sin(w.yaw) * s) * speed;
        // 分别尝试 x、z 方向，碰到墙时可以沿墙滑动
        let y = this.canStand(p.x + dx, p.z, w.ground);
        if (y !== null) { p.x += dx; w.ground = y; }
        y = this.canStand(p.x, p.z + dz, w.ground);
        if (y !== null) { p.z += dz; w.ground = y; }
      }
      // 眼睛高度平滑跟随地面（上下楼梯时不会一顿一顿的）
      p.y += (w.ground + EYE - p.y) * Math.min(1, dt * 10);
    } else {
      this.controls.update();
    }
  }
}
