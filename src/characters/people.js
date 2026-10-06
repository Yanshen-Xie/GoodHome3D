// 居民（真人角色模型）：加载 Michelle.glb，套用重定向后的行走 / 跑步 / 站立动画，
// 沿 A* 路径在房间和楼层之间走动（上下楼梯），按各自作息切换活动地点；疏散时改为跑向安全出口。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { retargetClip } from './retarget.js';
import { roomAt, floorOfY } from '../scene/layout.js';
import { setInfo, sectionPlane } from '../scene/common.js';
import michelleUrl from '../assets/models/Michelle.glb?url';
import soldierUrl from '../assets/models/Soldier.glb?url';

// 各人的日常活动地点：楼层、位置、活动内容、停留时间（秒）
const MOM = [
  { f: 0, x: 6.4, z: 3.9, act: '在厨房做饭', stay: 12 }, { f: 0, x: 5.2, z: 3.55, act: '在厨房准备食材', stay: 6 },
  { f: 0, x: 1.1, z: 1.8, act: '在餐厅吃饭', stay: 8 }, { f: 0, x: -6.45, z: 2.4, act: '在客厅看电视', stay: 10 },
  { f: 0, x: 5.2, z: -3.6, act: '在设备间洗衣服', stay: 6 }, { f: 1, x: -5.4, z: -2.4, act: '在主卧休息', stay: 8 },
  { f: 1, x: -0.4, z: 2.1, act: '在起居室看书', stay: 8 }, { f: 1, x: -6.0, z: 3.4, act: '在书房办公', stay: 10 },
  { f: 0, x: -5.5, z: -2.5, act: '在老人房陪伴老人', stay: 6 },
];
const GIRL = [
  { f: 1, x: 6.0, z: -3.4, act: '在儿童房学习', stay: 12 }, { f: 1, x: 5.0, z: -2.6, act: '在儿童房玩耍', stay: 6 },
  { f: 1, x: -0.6, z: 2.2, act: '在起居室看电视', stay: 8 }, { f: 1, x: -0.4, z: 5.8, act: '在阳台晒太阳', stay: 6 },
  { f: 1, x: -1.55, z: -2.45, act: '在二层卫生间洗漱', stay: 5 }, { f: 0, x: 1.5, z: 1.8, act: '在餐厅吃饭', stay: 8 },
  { f: 0, x: -4.6, z: 3.7, act: '在客厅玩耍', stay: 6 },
];
const GRANDMA = [
  { f: 0, x: -5.5, z: -2.5, act: '在老人房休息', stay: 14 }, { f: 0, x: -6.45, z: 3.2, act: '在客厅看电视', stay: 12 },
  { f: 0, x: 0.7, z: 1.8, act: '在餐厅吃饭', stay: 8 }, { f: 0, x: -1.9, z: -2.0, act: '在卫生间', stay: 5 },
  { f: 0, x: -5.4, z: -0.2, act: '在走廊散步', stay: 4 },
];

/**
 * 贴图换色：把色相在 fromHue 范围内、饱和度较高的像素换成 toHue（HSL 颜色空间中只改色相和亮度）。
 */
function recolorTexture(tex, fromHue, toHue, lightMul = 0.9) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const col = new THREE.Color(), hsl = {};
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    col.getHSL(hsl);
    const hue = hsl.h * 360;
    if (hue >= fromHue[0] && hue <= fromHue[1] && hsl.s > 0.35 && hsl.l > 0.15) {
      col.setHSL(toHue / 360, hsl.s * 0.8, hsl.l * lightMul);
      d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255;
    }
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = tex.flipY;
  t.colorSpace = tex.colorSpace;
  return t;
}

class Person {
  constructor(name, model, clips, nav, { scale = 1, tint = null, speed = 1.1, schedule = [], role = '' } = {}) {
    this.name = name;
    this.nav = nav;
    this.schedule = schedule;
    this.walkSpeed = speed;
    // object：负责位置和朝向；body：模型本体（跌倒时绕脚部旋转它）
    this.object = new THREE.Group();
    this.body = SkeletonUtils.clone(model);
    this.body.scale.setScalar(scale);
    this.object.add(this.body);
    this.body.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        o.material = o.material.clone();
        if (tint && o.material.map) o.material.map = recolorTexture(o.material.map, tint.fromHue, tint.toHue, tint.light);
        o.material.clippingPlanes = [sectionPlane]; // 分层查看时，上层的人物也会被剖切隐藏
      }
    });
    this.mixer = new THREE.AnimationMixer(this.body);
    this.actions = { idle: this.mixer.clipAction(clips.idle), walk: this.mixer.clipAction(clips.walk), run: this.mixer.clipAction(clips.run) };
    this.current = null;
    this.play('idle');
    this.path = [];
    this.mode = 'routine'; // routine 日常 | evacuate 疏散 | stop 停止 | fallen 跌倒
    this.waitTimer = 2 + Math.random() * 3;
    this.activity = '休息';
    this.floor = 0;
    this.room = null;
    this.lastIndex = -1;
    this.onArrive = null;
    this.fallT = 0; this.fallTarget = 0;
    setInfo(this.object, {
      name: '居民：' + name, category: '人物（真人角色模型）',
      func: (role ? role + '。' : '') + '真人角色骨骼动画（行走、跑步、站立由动画重定向生成），按日常作息在房间和楼层间移动；位置用于人体感应灯光、活动热力图、跌倒检测与疏散模拟',
      data: { 当前位置: '—', 当前活动: '—' },
    });
  }

  play(name, fade = 0.3) {
    const next = this.actions[name];
    if (this.current === next) return;
    next.reset().play();
    if (this.current) next.crossFadeFrom(this.current, fade, false);
    this.current = next;
  }

  setPosition(x, z, floor = this.floor, y) {
    this.floor = floor;
    this.object.position.set(x, (y ?? floor * 3.2) + 0.02, z);
  }
  get x() { return this.object.position.x; }
  get z() { return this.object.position.z; }

  /** 规划路线并走过去；floor 为目标楼层 */
  goTo(x, z, { floor = this.floor, run = false, avoidDanger = false, onArrive = null } = {}) {
    const p = this.nav.findPath({ x: this.x, z: this.z, floor: this.floor }, { x, z, floor }, { avoidDanger });
    if (!p) return false;
    this.path = p.slice(1);
    this.running = run;
    this.onArrive = onArrive;
    return true;
  }

  /** 跌倒 / 起身（绕脚部旋转成躺倒姿势，并冻结动画） */
  fall() { this.mode = 'fallen'; this.path = []; this.fallTarget = 1; this.activity = '跌倒！'; }
  standUp() { this.fallTarget = 0; this.activity = '已被扶起'; setTimeout(() => { if (this.mode === 'fallen') { this.mode = 'routine'; this.waitTimer = 3; } }, 1500); }

  update(dt) {
    // 跌倒动画：身体绕 x 轴倒下，同时略微抬高避免陷进地面
    if (this.fallTarget !== this.fallT) {
      this.fallT += Math.sign(this.fallTarget - this.fallT) * Math.min(Math.abs(this.fallTarget - this.fallT), dt * 2.2);
      this.body.rotation.x = -Math.PI / 2 * this.fallT * 0.95;
      this.body.position.y = 0.12 * this.fallT;
    }
    if (this.mode === 'fallen') { this.mixer.update(0); this.updateInfo(); return; }
    this.mixer.update(dt);
    this.updateInfo();
    if (this.path.length) {
      const target = this.path[0];
      const p = this.object.position;
      const dx = target.x - p.x, dy = target.y + 0.02 - p.y, dz = target.z - p.z;
      const d = Math.hypot(dx, dy, dz);
      const onStairs = Math.abs(dy) > 0.01;
      const speed = (this.running ? 2.4 : this.walkSpeed) * (onStairs ? 0.6 : 1);
      const step = speed * dt;
      if (d <= step) {
        p.set(target.x, target.y + 0.02, target.z);
        this.path.shift();
      } else {
        p.x += (dx / d) * step; p.y += (dy / d) * step; p.z += (dz / d) * step;
      }
      this.floor = floorOfY(p.y);
      const hd = Math.hypot(dx, dz);
      if (hd > 0.01) {
        const want = Math.atan2(dx, dz);
        let diff = want - this.object.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        this.object.rotation.y += diff * Math.min(1, dt * 8);
      }
      this.play(this.running ? 'run' : 'walk');
      if (!this.path.length) {
        this.play('idle');
        const cb = this.onArrive; this.onArrive = null;
        cb?.();
      }
      return;
    }
    this.play('idle');
    if (this.mode === 'routine') {
      this.waitTimer -= dt;
      if (this.waitTimer <= 0) this.nextActivity();
    }
    // 兜底：人停着没事做（"停止"状态、没有路线）超过 30 秒，自动恢复日常活动，避免一直站着不动
    if (this.mode === 'stop' && this.object.visible && this.schedule.length) {
      this.idleStop = (this.idleStop ?? 0) + dt;
      if (this.idleStop > 30) { this.idleStop = 0; this.mode = 'routine'; this.waitTimer = 0; }
    } else this.idleStop = 0;
  }

  updateInfo() {
    const r = roomAt(this.x, this.z, this.floor);
    this.room = r ? r.id : null;
    const info = this.object.userData.info;
    info.data.当前位置 = (this.object.visible ? (r ? `${this.floor + 1} 层 ${r.name}` : '室外') : '不在家');
    info.data.当前活动 = this.activity;
  }

  nextActivity() {
    if (!this.schedule.length) return;
    let i;
    do i = Math.floor(Math.random() * this.schedule.length); while (i === this.lastIndex && this.schedule.length > 1);
    this.lastIndex = i;
    const a = this.schedule[i];
    // 例："在阳台晒太阳" → "前往二楼阳台（晒太阳）"
    const m = a.act.match(/^在(.+?(房|厅|间|室|台|廊|卫生间))(.*)$/);
    const place = m ? m[1] : a.act.replace(/^在/, ''), what = m && m[3] ? `（${m[3]}）` : '';
    this.activity = '前往' + (a.f !== this.floor ? (a.f ? '二楼' : '一楼') : '') + place + what;
    const ok = this.goTo(a.x, a.z, { floor: a.f, onArrive: () => { this.activity = a.act; this.waitTimer = a.stay * (0.7 + Math.random() * 0.6); } });
    if (!ok) this.waitTimer = 1;
  }
}

export class People {
  constructor(scene, nav) {
    this.scene = scene;
    this.nav = nav;
    this.list = [];
    this.paused = false;
  }

  async load() {
    const loader = new GLTFLoader();
    const [mic, sol] = await Promise.all([loader.loadAsync(michelleUrl), loader.loadAsync(soldierUrl)]);
    const clip = (g, name) => g.animations.find((a) => a.name === name);
    const tposeSrc = clip(sol, 'TPose'), tposeTgt = clip(mic, 'TPose');
    // 源模型（Soldier）朝 -z，目标模型（Michelle）朝 +z，相差 180°
    const clips = {
      walk: retargetClip(sol.scene, clip(sol, 'Walk'), tposeSrc, mic.scene, tposeTgt, Math.PI),
      run: retargetClip(sol.scene, clip(sol, 'Run'), tposeSrc, mic.scene, tposeTgt, Math.PI),
      idle: retargetClip(sol.scene, clip(sol, 'Idle'), tposeSrc, mic.scene, tposeTgt, Math.PI),
    };
    this.mom = new Person('妈妈', mic.scene, clips, this.nav, { schedule: MOM, role: '家庭主要成员，活动范围覆盖两层' });
    this.girl = new Person('女儿', mic.scene, clips, this.nav, { scale: 0.84, tint: { fromHue: [35, 75], toHue: 205 }, schedule: GIRL, role: '主要在二层儿童房、起居室活动' });
    this.grandma = new Person('奶奶', mic.scene, clips, this.nav, { scale: 0.95, speed: 0.7, tint: { fromHue: [35, 75], toHue: 285, light: 0.7 }, schedule: GRANDMA, role: '行动较慢，只在一层活动（适老设计的主要服务对象）' });
    this.intruder = new Person('陌生人', mic.scene, clips, this.nav, { scale: 1.02, tint: { fromHue: [35, 75], toHue: 220, light: 0.35 }, schedule: [], role: '入侵检测演示用的陌生人' });
    this.mom.setPosition(-6.45, 2.4, 0);
    this.girl.setPosition(6.0, -3.4, 1);
    this.grandma.setPosition(-5.5, -2.4, 0);
    this.intruder.setPosition(16, -12, 0);
    this.intruder.mode = 'stop';
    this.intruder.object.visible = false;
    this.list.push(this.mom, this.girl, this.grandma);
    this.all = [...this.list, this.intruder];
    for (const p of this.all) this.scene.add(p.object);
    return this;
  }

  update(dt) {
    if (this.paused) return;
    for (const p of this.all) p.update(dt);
  }
}
