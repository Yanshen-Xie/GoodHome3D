// 居民（真人角色模型）：加载 Michelle.glb，套用重定向后的行走 / 跑步 / 站立动画，
// 沿 A* 路径在房间之间走动，日常作息自动切换目的地；疏散时改为跑向安全出口。
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { retargetClip } from './retarget.js';
import { roomAt } from '../scene/layout.js';
import { setInfo } from '../scene/common.js';
import michelleUrl from '../assets/models/Michelle.glb?url';
import soldierUrl from '../assets/models/Soldier.glb?url';

// 日常活动地点：人走到这里后停留一段时间（秒），再去下一个地点
export const ACTIVITIES = [
  { x: -6.5, z: 2.2, act: '在客厅看电视', stay: 10 },
  { x: 2.0, z: 1.7, act: '在餐厅吃饭', stay: 8 },
  { x: 6.4, z: 3.8, act: '在厨房做饭', stay: 10 },
  { x: 5.6, z: 2.9, act: '在厨房准备食材', stay: 6 },
  { x: -5.5, z: -2.4, act: '在主卧休息', stay: 8 },
  { x: 1.9, z: -3.3, act: '在儿童房学习', stay: 8 },
  { x: -1.4, z: -2.6, act: '在卫生间洗漱', stay: 5 },
  { x: 5.6, z: -3.2, act: '在老人房陪伴老人', stay: 7 },
  { x: -7.0, z: -0.1, act: '在玄关换鞋', stay: 4 },
  { x: -1.5, z: 3.9, act: '在客厅整理物品', stay: 5 },
];

/**
 * 贴图换色：把色相在 fromHue 范围内、饱和度较高的像素换成 toHue（HSL 颜色空间中只改色相）。
 */
function recolorTexture(tex, fromHue, toHue) {
  const img = tex.image;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  const col = new THREE.Color(), hsl = {};
  for (let i = 0; i < d.length; i += 4) {
    col.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255);
    col.getHSL(hsl);
    const hue = hsl.h * 360;
    if (hue >= fromHue[0] && hue <= fromHue[1] && hsl.s > 0.35 && hsl.l > 0.15) {
      col.setHSL(toHue / 360, hsl.s * 0.8, hsl.l * 0.9);
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
  constructor(name, model, clips, nav, scale, tint) {
    this.name = name;
    this.nav = nav;
    this.object = SkeletonUtils.clone(model);
    this.object.scale.setScalar(scale);
    this.object.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        if (tint && o.material?.map) {
          // 换一种衣服颜色区分两个人：只把贴图中黄色（裤子）的像素改成目标色相，皮肤颜色不变
          o.material = o.material.clone();
          o.material.map = recolorTexture(o.material.map, tint.fromHue, tint.toHue);
        }
      }
    });
    this.mixer = new THREE.AnimationMixer(this.object);
    this.actions = {
      idle: this.mixer.clipAction(clips.idle),
      walk: this.mixer.clipAction(clips.walk),
      run: this.mixer.clipAction(clips.run),
    };
    this.current = null;
    this.play('idle');
    this.path = [];
    this.speed = 1.1;
    this.mode = 'routine'; // routine 日常 | evacuate 疏散 | stop 停止
    this.waitTimer = 2;
    this.activity = '休息';
    this.room = null;
    this.lastActivityIndex = -1;
    this.onArrive = null;
    setInfo(this.object, {
      name: '居民：' + name, category: '人物（真人角色模型）',
      func: '真人角色骨骼动画（行走、跑步、站立由动画重定向生成），按日常作息在房间间移动；位置用于人体感应灯光、活动热力图与疏散模拟',
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

  setPosition(x, z) { this.object.position.set(x, 0.02, z); }
  get x() { return this.object.position.x; }
  get z() { return this.object.position.z; }

  /** 规划路线并走过去 */
  goTo(x, z, { run = false, avoidDanger = false, onArrive = null } = {}) {
    const p = this.nav.findPath(this.x, this.z, x, z, { avoidDanger });
    if (!p) return false;
    this.path = p.slice(1);
    this.speed = run ? 2.6 : 1.1;
    this.running = run;
    this.onArrive = onArrive;
    return true;
  }

  update(dt) {
    this.mixer.update(dt);
    const r = roomAt(this.x, this.z);
    this.room = r ? r.id : null;
    const info = this.object.userData.info;
    info.data.当前位置 = r ? r.name : '室外';
    info.data.当前活动 = this.activity;

    if (this.path.length) {
      const target = this.path[0];
      const dx = target.x - this.x, dz = target.z - this.z;
      const d = Math.hypot(dx, dz);
      const step = this.speed * dt;
      if (d <= step) {
        this.setPosition(target.x, target.z);
        this.path.shift();
      } else {
        this.object.position.x += (dx / d) * step;
        this.object.position.z += (dz / d) * step;
      }
      // 平滑转身：模型正面朝 +z，atan2(dx,dz) 即为朝向角
      if (d > 0.01) {
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
  }

  nextActivity() {
    let i;
    do i = Math.floor(Math.random() * ACTIVITIES.length); while (i === this.lastActivityIndex);
    this.lastActivityIndex = i;
    const a = ACTIVITIES[i];
    this.activity = '走向：' + a.act.replace(/^在/, '').slice(0, 2) + '…';
    const ok = this.goTo(a.x, a.z, {
      onArrive: () => { this.activity = a.act; this.waitTimer = a.stay * (0.7 + Math.random() * 0.6); },
    });
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
    const mom = new Person('妈妈', mic.scene, clips, this.nav, 1.0, null);
    const girl = new Person('女儿', mic.scene, clips, this.nav, 0.84, { fromHue: [35, 75], toHue: 205 });
    mom.setPosition(-6.3, 2.2);
    girl.setPosition(1.9, -3.3);
    girl.waitTimer = 5;
    this.list.push(mom, girl);
    for (const p of this.list) this.scene.add(p.object);
    return this;
  }

  update(dt) {
    if (this.paused) return;
    for (const p of this.list) p.update(dt);
  }
}
