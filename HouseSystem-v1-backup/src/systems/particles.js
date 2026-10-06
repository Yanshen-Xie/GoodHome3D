// 通用粒子发射器：用于火焰、烟雾、燃气扩散。
// 每个粒子有位置、速度、寿命、大小、颜色、透明度；每帧按速度移动、按寿命插值颜色和大小。
// 渲染用自定义着色器：点精灵大小随距离缩小（透视），片元中按到中心的距离做圆形柔边。
import * as THREE from 'three';

const vertexShader = /* glsl */ `
  attribute float size;
  attribute vec4 rgba;
  varying vec4 vColor;
  void main() {
    vColor = rgba;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (420.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const fragmentShader = /* glsl */ `
  varying vec4 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = vColor.a * (1.0 - d * d);
    gl_FragColor = vec4(vColor.rgb, a);
  }`;

export class Emitter {
  /**
   * opts: { count, rate(每秒发射数), life:[min,max], spawn(p) 设置初始位置和速度,
   *         size:[起始,结束], colors:[起始 Color, 结束 Color], alpha:[起始,结束], additive, force(p,dt) 额外受力 }
   */
  constructor(scene, opts) {
    this.o = { count: 400, rate: 100, life: [1, 2], size: [0.2, 0.5], alpha: [1, 0], additive: false, ...opts };
    const n = this.o.count;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(1e9);
    this.life = new Float32Array(n).fill(1);
    this.size = new Float32Array(n);
    this.rgba = new Float32Array(n * 4);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('rgba', new THREE.BufferAttribute(this.rgba, 4));
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader, fragmentShader, transparent: true, depthWrite: false,
      blending: this.o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = this.o.renderOrder ?? 6; // 火焰要画在烟雾之后，才不会被烟挡住
    this.points.userData.noPick = true;
    scene.add(this.points);
    this.active = false;
    this.acc = 0;
    this.next = 0;
    this.c = new THREE.Color();
  }

  start() { this.active = true; this.points.visible = true; }
  stop() { this.active = false; }            // 停止发射，已有粒子自然消失
  clear() { this.active = false; this.age.fill(1e9); this.points.visible = false; }

  update(dt) {
    if (!this.points.visible) return;
    const o = this.o, n = o.count;
    if (this.active) {
      this.acc += dt * o.rate;
      while (this.acc >= 1) {
        this.acc -= 1;
        const i = this.next; this.next = (this.next + 1) % n;
        const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
        o.spawn(p);
        this.pos.set([p.x, p.y, p.z], i * 3);
        this.vel.set([p.vx, p.vy, p.vz], i * 3);
        this.age[i] = 0;
        this.life[i] = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      }
    }
    const [c0, c1] = o.colors;
    let alive = 0;
    const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 };
    for (let i = 0; i < n; i++) {
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) { this.size[i] = 0; this.rgba[i * 4 + 3] = 0; continue; }
      alive++;
      if (o.force) {
        p.x = this.pos[i * 3]; p.y = this.pos[i * 3 + 1]; p.z = this.pos[i * 3 + 2];
        p.vx = this.vel[i * 3]; p.vy = this.vel[i * 3 + 1]; p.vz = this.vel[i * 3 + 2];
        o.force(p, dt, t);
        this.vel[i * 3] = p.vx; this.vel[i * 3 + 1] = p.vy; this.vel[i * 3 + 2] = p.vz;
      }
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.size[i] = o.size[0] + (o.size[1] - o.size[0]) * t;
      this.c.copy(c0).lerp(c1, t);
      this.rgba.set([this.c.r, this.c.g, this.c.b, o.alpha[0] + (o.alpha[1] - o.alpha[0]) * t], i * 4);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
    g.attributes.rgba.needsUpdate = true;
    if (!this.active && alive === 0) this.points.visible = false;
  }
}
