// 摄像机控制：
//  1. 轨道模式（默认）：左键拖动旋转、滚轮缩放、右键拖动平移（OrbitControls）
//  2. 预设视点：点击按钮后摄像机平滑飞到指定位置
//  3. 漫游模式：第一人称，WASD / 方向键移动，鼠标拖动转头，会被墙和家具挡住
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export const VIEWPOINTS = [
  { id: 'overview', name: '整体鸟瞰', pos: [20, 16, 24], target: [0, 1, 0] },
  { id: 'top', name: '户型俯视', pos: [0, 26, 9], target: [0, 0, 0.5], cutaway: true },
  { id: 'entry', name: '入户视角', pos: [-15, 2.2, 3.5], target: [-8, 1.3, -0.2] },
  { id: 'living', name: '客厅', pos: [-3.9, 2.3, 4.7], target: [-7.0, 0.7, 1.9], cutaway: true },
  { id: 'kitchen', name: '厨房', pos: [5.0, 5.4, 6.6], target: [6.2, 0.8, 2.4], cutaway: true },
  { id: 'bedroom', name: '卧室', pos: [-3.6, 2.5, -1.4], target: [-6.0, 0.8, -3.8], cutaway: true },
  { id: 'elder', name: '老人房', pos: [5.2, 5.0, 1.2], target: [6.3, 0.6, -3.2], cutaway: true },
  { id: 'roof', name: '屋顶光伏', pos: [14, 11, 12], target: [0, 3.5, -0.5] },
];

export class CameraRig {
  constructor(camera, dom, nav) {
    this.camera = camera;
    this.dom = dom;
    this.nav = nav;
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.49; // 不能转到地面以下
    this.controls.minDistance = 1.5;
    this.controls.maxDistance = 120;
    this.controls.screenSpacePanning = false;     // 平移时保持在水平面内
    this.tween = null;
    this.mode = 'orbit';
    this.walk = { yaw: 0, pitch: 0, keys: new Set(), dragging: false, lastX: 0, lastY: 0 };
    this.onModeChange = null;
    this.bindWalkEvents();
  }

  /** 平滑飞到指定位置（三次缓动插值） */
  flyTo(pos, target, duration = 1.2) {
    if (this.mode === 'walk') this.setMode('orbit');
    this.tween = {
      t: 0, duration,
      fromPos: this.camera.position.clone(), toPos: new THREE.Vector3(...pos),
      fromTarget: this.controls.target.clone(), toTarget: new THREE.Vector3(...target),
    };
  }

  /** 对准某个物体：根据包围盒大小决定距离 */
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
      // 从当前位置附近的室内起点开始漫游（入户门内）
      this.camera.position.set(-7.0, 1.6, -0.1);
      this.walk.yaw = -Math.PI / 2; // 面向 +x（东）
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
    const e = new THREE.Euler(this.walk.pitch, this.walk.yaw, 0, 'YXZ');
    this.camera.quaternion.setFromEuler(e);
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

  // 漫游时判断能否站在 (x,z)：检查人体周围 4 个点，都不是障碍才能走
  canStand(x, z) {
    const r = 0.18;
    return [[r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dz]) => this.nav.isFree(x + dx, z + dz));
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const k = tw.t < 0.5 ? 4 * tw.t ** 3 : 1 - (-2 * tw.t + 2) ** 3 / 2; // easeInOutCubic
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, k);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, k);
      if (tw.t >= 1) this.tween = null;
    }
    if (this.mode === 'walk') {
      const k = this.walk.keys;
      const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const s = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      if (k.has('KeyQ')) { this.walk.yaw += dt * 1.5; this.applyWalkRotation(); }
      if (k.has('KeyE')) { this.walk.yaw -= dt * 1.5; this.applyWalkRotation(); }
      if (f || s) {
        const speed = (k.has('ShiftLeft') ? 3.2 : 1.6) * dt;
        const yaw = this.walk.yaw;
        const dx = (-Math.sin(yaw) * f + Math.cos(yaw) * s) * speed;
        const dz = (-Math.cos(yaw) * f - Math.sin(yaw) * s) * speed;
        const p = this.camera.position;
        // 分别尝试 x、z 方向，碰到墙时可以沿墙滑动
        if (this.canStand(p.x + dx, p.z)) p.x += dx;
        if (this.canStand(p.x, p.z + dz)) p.z += dz;
      }
    } else {
      this.controls.update();
    }
  }
}
