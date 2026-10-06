// 室外环境与光照：天空盒、太阳（主光源+阴影）、环境光、草地、道路、树木、围栏、远山、雨。
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mat, box, cylinder, setInfo, worldPlaneUV } from './common.js';

const LATITUDE = 23.1; // 广州纬度

/**
 * 太阳位置（简化的天文公式）：
 *   赤纬角 δ = 23.44°·sin(360°·(284+n)/365)，n 为一年中的第几天
 *   时角   ω = 15°·(t−12)，t 为当地太阳时
 *   高度角 sin h = sinφ·sinδ + cosφ·cosδ·cosω
 *   方位角 A（从正南起算，向西为正）= atan2(sinω, cosω·sinφ − tanδ·cosφ)
 * 返回指向太阳的单位向量（x 东、y 上、z 南）以及高度角、方位角（度）。
 */
export function sunDirection(hour, dayOfYear) {
  const rad = THREE.MathUtils.degToRad;
  const phi = rad(LATITUDE);
  const delta = rad(23.44 * Math.sin((2 * Math.PI * (284 + dayOfYear)) / 365));
  const omega = rad(15 * (hour - 12));
  const sinH = Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.cos(omega);
  const h = Math.asin(sinH);
  const A = Math.atan2(Math.sin(omega), Math.cos(omega) * Math.sin(phi) - Math.tan(delta) * Math.cos(phi));
  const dir = new THREE.Vector3(-Math.cos(h) * Math.sin(A), Math.sin(h), Math.cos(h) * Math.cos(A));
  return { dir, elevation: THREE.MathUtils.radToDeg(h), azimuth: THREE.MathUtils.radToDeg(A) };
}

export const WEATHER = {
  sunny: { name: '晴', sun: 1, turbidity: 2.5, rayleigh: 3.0, pv: 1 },
  cloudy: { name: '多云', sun: 0.35, turbidity: 12, rayleigh: 3.5, pv: 0.45 },
  rainy: { name: '雨', sun: 0.08, turbidity: 20, rayleigh: 4, pv: 0.12 },
};

export class Environment {
  constructor(scene, renderer, nav) {
    this.scene = scene;
    this.renderer = renderer;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    scene.add(this.group);

    // ---- 天空盒：基于大气散射的程序化天空，太阳位置与主光源同步 ----
    this.sky = new Sky();
    this.sky.scale.setScalar(4000);
    Environment.dimSky(this.sky, 0.4);
    const u = this.sky.material.uniforms;
    u.mieCoefficient.value = 0.003;
    u.mieDirectionalG.value = 0.85;
    scene.add(this.sky);

    // ---- 主光源：太阳（平行光 + 软阴影） ----
    this.sun = new THREE.DirectionalLight(0xfff2e0, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 16; sc.bottom = -16; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun, this.sun.target);

    // ---- 环境光：半球光（天空色 + 地面反射色） ----
    this.hemi = new THREE.HemisphereLight(0xcfe3ff, 0x6b5b45, 0.9);
    scene.add(this.hemi);

    // 环境贴图：由当前天空生成，用于玻璃、金属的反射
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(100);
    Environment.dimSky(this.envSky, 0.4);
    this.envScene.add(this.envSky);
    this.envTarget = null;
    this.lastEnvKey = '';

    scene.fog = new THREE.Fog(0xb9cde0, 140, 700);

    this.buildGround(nav);
    this.buildGarden(nav);
    this.buildHills();
    this.buildRain();

    this.state = { hour: 10, day: 172, weather: 'sunny' };
    this.info = sunDirection(10, 172);
  }

  /**
   * 天空着色器输出的亮度很高，经过 ACES 色调映射后会发白。
   * 这里在着色器编译前插入一个亮度系数，只降低天空本身的亮度，使天空保持蓝色。
   */
  static dimSky(sky, gain) {
    sky.material.uniforms.skyGain = { value: gain };
    sky.material.onBeforeCompile = (shader) => {
      shader.uniforms.skyGain = sky.material.uniforms.skyGain;
      shader.fragmentShader = 'uniform float skyGain;\n' + shader.fragmentShader.replace('gl_FragColor = vec4( retColor, 1.0 );', 'gl_FragColor = vec4( retColor * skyGain, 1.0 );');
    };
  }

  buildGround(nav) {
    const g = this.group;
    // 草地
    const size = 400;
    const geo = new THREE.PlaneGeometry(size, size);
    worldPlaneUV(geo, size, size, 3);
    geo.rotateX(-Math.PI / 2);
    const ground = new THREE.Mesh(geo, mat('grass'));
    ground.receiveShadow = true;
    ground.position.y = -0.02;
    setInfo(ground, { name: '庭院草坪', category: '室外环境', func: '透水绿地，雨水就地下渗，降低热岛效应' });
    g.add(ground);

    const flat = (w, d, m, x, z, y = 0) => {
      const pg = new THREE.PlaneGeometry(w, d);
      pg.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(pg, mat(m));
      const uv = pg.attributes.uv, pos = pg.attributes.position, t = mat(m).map.userData.worldSize;
      for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + x) / t, (pos.getZ(i) + z) / t);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // 道路（西侧南北向）与路缘石
    flat(7, 400, 'asphalt', -18, 0, -0.005);
    for (let k = -1; k <= 1; k += 2) g.add(box(0.2, 0.12, 400, 'stone', -18 + k * 3.6, -0.02, 0, { cast: false }));
    // 道路中心虚线
    // 大量相同的小物体用"实例化渲染"（InstancedMesh）：一次绘制调用画出全部，减少 CPU 开销
    const dashGeo = new THREE.PlaneGeometry(0.15, 2.5); dashGeo.rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(dashGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.8 }), 50);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 50; i++) dashes.setMatrixAt(i, m4.makeTranslation(-18, 0.002, -150 + i * 6));
    dashes.receiveShadow = true;
    g.add(dashes);
    // 入户小路（无障碍：与室内地面平齐，无台阶）
    setInfo(flat(6.2, 2.4, 'paving', -11.1, -0.2, 0.004), { name: '无障碍入户通道', category: '适老无障碍', func: '宽 2.4m，坡度 < 1:20，与室内地面无高差，轮椅可直接进入', maintain: '防滑铺装，状态良好' });
    // 南侧露台
    setInfo(flat(8.4, 3, 'deck', -4, 6.6, 0.006), { name: '南向露台', category: '室外环境', func: '客厅延伸空间，兼作落地门疏散后的室外集合区域' });
    // 后门小路
    flat(3, 1.6, 'paving', 9.5, -0.2, 0.004);
  }

  buildGarden(nav) {
    const g = this.group;
    // 围栏（木质矮栅栏），西侧留出入口
    const fenceMat = mat('woodLight');
    const fence = new THREE.Group();
    const postMatrices = [];
    const addFence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = z0 === z1;
      const n = Math.floor(len / 0.25);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const m = new THREE.Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2);
        m.setPosition(x0 + (x1 - x0) * t, 0.5, z0 + (z1 - z0) * t);
        postMatrices.push(m);
      }
      for (const y of [0.3, 0.8]) {
        const rail = box(alongX ? len : 0.05, 0.06, alongX ? 0.05 : len, fenceMat, (x0 + x1) / 2, y, (z0 + z1) / 2, { cast: false });
        fence.add(rail);
      }
      nav?.blockRect(Math.min(x0, x1) - 0.05, Math.max(x0, x1) + 0.05, Math.min(z0, z1) - 0.05, Math.max(z0, z1) + 0.05);
    };
    addFence(-13, -9.5, 13, -9.5);
    addFence(-13, 11, 13, 11);
    addFence(13, -9.5, 13, 11);
    addFence(-13, -9.5, -13, -1.6);
    addFence(-13, 1.2, -13, 11);
    // 栅栏竖条：几百根相同的木条，用实例化渲染
    const postGeo = new THREE.BoxGeometry(0.08, 1.0, 0.06);
    const posts = new THREE.InstancedMesh(postGeo, fenceMat, postMatrices.length);
    postMatrices.forEach((m, i) => posts.setMatrixAt(i, m));
    posts.castShadow = true; posts.receiveShadow = true;
    fence.add(posts);
    g.add(fence);

    // 树木：树干 + 若干个球形树冠
    const addTree = (x, z, s = 1) => {
      const t = new THREE.Group();
      t.add(cylinder(0.12 * s, 0.18 * s, 2.2 * s, 'bark', 0, 0, 0, 8));
      const leaves = [[0, 2.9, 0, 1.3], [0.6, 2.5, 0.3, 0.9], [-0.5, 2.6, -0.3, 1.0], [0.1, 3.5, -0.2, 0.9]];
      leaves.forEach(([lx, ly, lz, r], i) => {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), mat(i % 2 ? 'leafDark' : 'leaf'));
        m.position.set(lx * s, ly * s, lz * s);
        m.castShadow = true; m.receiveShadow = true;
        t.add(m);
      });
      t.position.set(x, 0, z);
      setInfo(t, { name: '庭院乔木（香樟）', category: '室外环境', func: '夏季遮阳降温，冬季落叶后不遮挡阳光；吸收噪声与粉尘' });
      g.add(t);
      nav?.blockRect(x - 0.3, x + 0.3, z - 0.3, z + 0.3);
    };
    addTree(-11, -7.5, 1.1); addTree(11, -7.8, 1); addTree(11.2, 9, 1.2);
    addTree(4, 9.3, 0.9); addTree(-11.3, 8.8, 1); addTree(0.5, -8, 0.8);
    // 更远处的行道树
    for (let z = -60; z <= 60; z += 12) addTree(-23, z, 1.2);

    // 灌木：沿房屋南侧和北侧
    const shrubGeo = new THREE.SphereGeometry(0.45, 12, 8);
    const shrubs = [[1, 5.8], [2.2, 5.9], [3.4, 5.8], [5.2, 5.8], [6.6, 5.9], [-6, -6], [-4, -6.1], [2, -6], [6, -6.1], [8.8, 3], [8.8, -3.5]];
    for (const [x, z] of shrubs) {
      const s = new THREE.Mesh(shrubGeo, mat('leafDark'));
      s.scale.set(1.2, 0.8, 1);
      s.position.set(x, 0.3, z);
      s.castShadow = s.receiveShadow = true;
      g.add(s);
      nav?.blockRect(x - 0.5, x + 0.5, z - 0.45, z + 0.45);
    }
    // 花坛
    const bed = box(3, 0.35, 1.0, 'stone', 7.5, 0, 8.3);
    g.add(bed);
    g.add(box(2.8, 0.05, 0.8, 'soil', 7.5, 0.33, 8.3, { cast: false }));
    const flowerColors = [0xd9534f, 0xf0ad4e, 0xf7f7f7, 0xc86dd7];
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshStandardMaterial({ roughness: 0.7 }), 40);
    for (let i = 0; i < 40; i++) {
      flowers.setMatrixAt(i, new THREE.Matrix4().makeTranslation(6.2 + (i % 10) * 0.27, 0.45, 7.95 + Math.floor(i / 10) * 0.22));
      flowers.setColorAt(i, new THREE.Color(flowerColors[i % 4]));
    }
    g.add(flowers);
    nav?.blockRect(6, 9, 7.8, 8.8);

    // 露台桌椅
    g.add(cylinder(0.45, 0.45, 0.04, 'woodLight', -2.5, 0.72, 6.8));
    g.add(cylinder(0.04, 0.04, 0.72, 'darkMetal', -2.5, 0, 6.8, 8));
    for (const dx of [-0.8, 0.8]) {
      g.add(box(0.45, 0.45, 0.45, 'woodLight', -2.5 + dx, 0, 6.8, { rounded: 0.04 }));
      g.add(box(0.45, 0.45, 0.06, 'woodLight', -2.5 + dx, 0.45, 7.02));
    }
    nav?.blockRect(-3.6, -1.4, 6.3, 7.3);

    // 路灯（沿道路）
    for (let z = -24; z <= 24; z += 16) {
      const pole = cylinder(0.06, 0.08, 5, 'darkMetal', -14, 0, z, 8);
      const head = box(0.6, 0.12, 0.25, 'darkMetal', -14.3, 5, z);
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2a8, emissiveIntensity: 0 });
      const bulb = box(0.4, 0.03, 0.18, lampMat, -14.3, 4.98, z);
      this.streetLamps = this.streetLamps || [];
      this.streetLamps.push(lampMat);
      g.add(pole, head, bulb);
    }
  }

  // 远山：一圈起伏的山体，填满地平线
  buildHills() {
    const segs = 96, R = 320;
    const pts = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const h = 18 + 14 * Math.sin(a * 3.1) + 9 * Math.sin(a * 7.3 + 1) + 5 * Math.sin(a * 13.7 + 2);
      pts.push([Math.cos(a) * R, Math.sin(a) * R, h]);
    }
    const pos = [], idx = [];
    pts.forEach(([x, z, h], i) => { pos.push(x, -1, z, x * 1.05, h, z * 1.05); if (i < segs) idx.push(i * 2, i * 2 + 2, i * 2 + 1, i * 2 + 1, i * 2 + 2, i * 2 + 3); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const hills = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x5f7a5a, roughness: 1, side: THREE.DoubleSide }));
    this.group.add(hills);
  }

  // 雨：大量短线段组成的粒子，下雨天显示
  buildRain() {
    const n = 4000;
    const pos = new Float32Array(n * 6);
    this.rainSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 60, y = Math.random() * 25, z = (Math.random() - 0.5) * 60;
      pos.set([x, y, z, x + 0.03, y - 0.45, z], i * 6);
      this.rainSpeed[i] = 14 + Math.random() * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.rain = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xaabbcc, transparent: true, opacity: 0.45 }));
    this.rain.visible = false;
    this.rain.frustumCulled = false;
    this.scene.add(this.rain);
  }

  /** 设置时间（小时，可带小数）、日期（一年中第几天）、天气 */
  set(hour, day, weather) {
    this.state = { hour, day, weather };
    const w = WEATHER[weather];
    const s = sunDirection(hour, day);
    this.info = s;
    const elev = s.elevation;
    // 太阳在地平线附近时逐渐变暗、变暖
    const dayFactor = THREE.MathUtils.smoothstep(elev, -4, 8);
    const warm = THREE.MathUtils.smoothstep(elev, 0, 25);

    this.sun.position.copy(s.dir).multiplyScalar(60);
    this.sun.target.position.set(0, 0, 0);
    this.sun.intensity = 3.2 * dayFactor * w.sun;
    this.sun.color.setRGB(1, 0.72 + 0.26 * warm, 0.5 + 0.42 * warm);
    this.sun.castShadow = this.sun.intensity > 0.05;

    this.hemi.intensity = 0.32 + 0.6 * dayFactor * (0.6 + 0.4 * w.sun); // 夜间保留一点月光，便于观察
    this.hemi.color.setRGB(0.45 + 0.4 * dayFactor, 0.52 + 0.4 * dayFactor, 0.8 + 0.2 * dayFactor);

    const u = this.sky.material.uniforms;
    u.sunPosition.value.copy(s.dir);
    u.turbidity.value = w.turbidity;
    u.rayleigh.value = w.rayleigh;
    const fogDay = new THREE.Color(0xb9cde0).multiplyScalar(0.12 + 0.88 * dayFactor * (weather === 'sunny' ? 1 : 0.8));
    this.scene.fog.color.copy(fogDay);
    this.rain.visible = weather === 'rainy';
    for (const m of this.streetLamps) m.emissiveIntensity = dayFactor < 0.3 ? 3 : 0;

    // 天空变化较大时才重新生成环境贴图（比较耗时）
    const key = `${Math.round(hour * 2)}_${day}_${weather}`;
    if (key !== this.lastEnvKey) {
      this.lastEnvKey = key;
      const eu = this.envSky.material.uniforms;
      eu.sunPosition.value.copy(s.dir); eu.turbidity.value = w.turbidity; eu.rayleigh.value = w.rayleigh;
      eu.mieCoefficient.value = 0.005; eu.mieDirectionalG.value = 0.8;
      const old = this.envTarget;
      this.envTarget = this.pmrem.fromScene(this.envScene);
      this.scene.environment = this.envTarget.texture;
      this.scene.environmentIntensity = 0.25 + 0.35 * dayFactor;
      old?.dispose();
    }
    return s;
  }

  update(dt, camera) {
    if (this.rain.visible) {
      const p = this.rain.geometry.attributes.position;
      const a = p.array;
      for (let i = 0; i < this.rainSpeed.length; i++) {
        const dy = this.rainSpeed[i] * dt;
        a[i * 6 + 1] -= dy; a[i * 6 + 4] -= dy;
        if (a[i * 6 + 4] < 0) { a[i * 6 + 1] += 25; a[i * 6 + 4] += 25; }
      }
      p.needsUpdate = true;
      this.rain.position.set(Math.round(camera.position.x), 0, Math.round(camera.position.z));
    }
  }
}
