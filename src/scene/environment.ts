// 室外环境与光照：天空盒、太阳（主光源+阴影）、环境光、草地、道路、树木、围栏、远山、雨。
import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { mat, box, cylinder, setInfo, worldPlaneUV } from './common.js';
import { RAIN_TANK, DRIVEWAY } from './layout.js';

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
  // Fields are declared here and initialized by the existing runtime flow.
  declare beamPosts: any;
  declare envScene: any;
  declare envSky: any;
  declare envTarget: any;
  declare fence: any;
  declare group: any;
  declare hemi: any;
  declare info: any;
  declare lastEnvKey: any;
  declare pit: any;
  declare pitCover: any;
  declare pmrem: any;
  declare rain: any;
  declare rainSpeed: any;
  declare rainTank: any;
  declare renderer: any;
  declare scene: any;
  declare sky: any;
  declare state: any;
  declare streetLamps: any;
  declare sun: any;

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
    const T = RAIN_TANK, pit = { x0: T.x - 1.5, x1: T.x + 1.5, z0: T.z - 1.5, z1: T.z + 1.5 };
    this.pit = pit;
    // 草地：一整块大平面，在雨水蓄水池处挖一个洞（剖切时可以看到地下的蓄水池）
    const size = 400;
    const shape = new THREE.Shape([new THREE.Vector2(-size / 2, -size / 2), new THREE.Vector2(size / 2, -size / 2), new THREE.Vector2(size / 2, size / 2), new THREE.Vector2(-size / 2, size / 2)]);
    shape.holes.push(new THREE.Path([new THREE.Vector2(pit.x0, -pit.z0), new THREE.Vector2(pit.x0, -pit.z1), new THREE.Vector2(pit.x1, -pit.z1), new THREE.Vector2(pit.x1, -pit.z0)]));
    const geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(-Math.PI / 2); // 形状 y → 世界 -z
    const uv = geo.attributes.uv, pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / 3, pos.getZ(i) / 3);
    const ground = new THREE.Mesh(geo, mat('grass'));
    ground.receiveShadow = true;
    ground.position.y = -0.02;
    setInfo(ground, { name: '庭院草坪', category: '室外环境', func: '透水绿地，雨水就地下渗，降低热岛效应' });
    g.add(ground);
    // 洞口上的"盖板"草皮：平时盖住，剖切时隐藏
    this.pitCover = new THREE.Mesh(new THREE.PlaneGeometry(pit.x1 - pit.x0, pit.z1 - pit.z0).rotateX(-Math.PI / 2), mat('grass'));
    this.pitCover.position.set(T.x, -0.02, T.z);
    this.pitCover.receiveShadow = true;
    g.add(this.pitCover);

    const flat = (x0, x1, z0, z1, m, y = 0) => {
      const w = x1 - x0, d = z1 - z0, x = (x0 + x1) / 2, z = (z0 + z1) / 2;
      const pg = new THREE.PlaneGeometry(w, d);
      pg.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(pg, mat(m));
      const u = pg.attributes.uv, ps = pg.attributes.position, t = mat(m).map?.userData.worldSize ?? 1;
      for (let i = 0; i < ps.count; i++) u.setXY(i, (ps.getX(i) + x) / t, (ps.getZ(i) + z) / t);
      mesh.position.set(x, y, z);
      mesh.receiveShadow = true;
      g.add(mesh);
      return mesh;
    };
    // 道路、路缘石、人行道
    flat(-21.5, -14.5, -200, 200, 'asphalt', -0.005);
    for (const x of [-21.6, -14.4]) g.add(box(0.2, 0.12, 400, 'stone', x, -0.02, 0, { cast: false }));
    flat(-14.3, -13.1, -200, 200, 'paving', 0.003);
    flat(-25.5, -21.7, -200, 200, 'paving', 0.003);
    const dashGeo = new THREE.PlaneGeometry(0.15, 2.5); dashGeo.rotateX(-Math.PI / 2);
    const dashes = new THREE.InstancedMesh(dashGeo, new THREE.MeshStandardMaterial({ color: 0xf2f2e8, roughness: 0.8 }), 67);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < 67; i++) dashes.setMatrixAt(i, m4.makeTranslation(-18, 0.002, -200 + i * 6));
    g.add(dashes);
    // 入户无障碍通道、车道、露台、后门小路
    setInfo(flat(-13.1, -8.15, -1.4, 1.0, 'paving', 0.004), { name: '无障碍入户通道', category: '适老无障碍', func: '宽 2.4m，坡度 < 1:20，与室内地面无高差，轮椅可直接进入', maintain: '防滑铺装，状态良好' });
    setInfo(flat(DRIVEWAY.x0, DRIVEWAY.x1, DRIVEWAY.z0, DRIVEWAY.z1, 'paving', 0.005), { name: '车道与停车位', category: '室外环境', func: '透水砖铺装，配家用充电桩' });
    setInfo(flat(-8.3, 0.4, 5.1, 8.2, 'deck', 0.006), { name: '南向露台', category: '室外环境', func: '客厅延伸空间，也是客厅落地门疏散后的室外集合区域' });
    flat(8.15, 13, -0.9, 0.5, 'paving', 0.004);
    // 露台到蓄水池的汀步
    for (let i = 0; i < 5; i++) { const st = cylinder(0.3, 0.3, 0.03, 'stone', 1.6 + i * 1.7, 0, 7.4 + Math.sin(i) * 0.3, 16); st.receiveShadow = true; g.add(st); }
    this.buildRainTank();
  }

  // 地下雨水蓄水池：剖切显示时可以看到池体、水位和连接管
  buildRainTank() {
    const T = RAIN_TANK, p = this.pit;
    const tank = new THREE.Group();
    // 土坑四壁（剖切面）
    const soil = new THREE.MeshStandardMaterial({ color: 0x6b4f36, roughness: 1, side: THREE.DoubleSide });
    const depth = T.depth + 0.6;
    const walls = [
      [p.x1 - p.x0, depth, 0.02, T.x, -depth, p.z0], [p.x1 - p.x0, depth, 0.02, T.x, -depth, p.z1],
      [0.02, depth, p.z1 - p.z0, p.x0, -depth, T.z], [0.02, depth, p.z1 - p.z0, p.x1, -depth, T.z],
    ];
    for (const [w, h, d, x, y, z] of walls) tank.add(box(w, h, d, soil, x, y, z, { cast: false }));
    tank.add(box(p.x1 - p.x0, 0.02, p.z1 - p.z0, soil, T.x, -depth, T.z, { cast: false }));
    // 池体：切掉四分之一的混凝土圆柱壳，露出内部水位
    const shellMat = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9, side: THREE.DoubleSide });
    const shell = new THREE.Mesh(new THREE.CylinderGeometry(T.r, T.r, T.depth, 32, 1, true, Math.PI * 0.75, Math.PI * 1.5), shellMat);
    shell.position.set(T.x, -0.3 - T.depth / 2, T.z);
    tank.add(shell);
    tank.add(cylinder(T.r, T.r, 0.08, shellMat, T.x, -0.3 - T.depth - 0.08, T.z, 32));
    // 水体：高度随水位缩放
    const water = new THREE.Mesh(new THREE.CylinderGeometry(T.r - 0.05, T.r - 0.05, 1, 32), new THREE.MeshStandardMaterial({ color: 0x3d8fc6, roughness: 0.1, transparent: true, opacity: 0.75 }));
    water.position.set(T.x, -0.3 - T.depth, T.z);
    water.userData.dynamic = true;
    tank.add(water);
    // 顶盖与检修口（地面上可见）
    const lid = cylinder(0.35, 0.35, 0.05, 'darkMetal', T.x, -0.01, T.z, 20);
    this.group.add(lid);
    setInfo(lid, { name: '雨水蓄水池检修口', category: '绿色低碳', func: '地下 8m³ 蓄水池：屋面雨水经过滤后储存，用于庭院灌溉和冲厕' });
    // 进水管（从落水管接入）、出水泵
    tank.add(box(0.1, 0.1, 1.5, 'darkMetal', T.x - 0.9, -0.45, T.z - 1.4, { cast: false }));
    tank.add(box(0.3, 0.35, 0.3, 'red', T.x + 0.4, -0.3 - T.depth, T.z + 0.4));
    tank.visible = false;
    this.group.add(tank);
    this.rainTank = { group: tank, water, level: 0.35 };
    this.setTankLevel(0.35);
  }

  /** 蓄水池水位 0~1 */
  setTankLevel(v) {
    const T = RAIN_TANK, w = this.rainTank.water;
    this.rainTank.level = v;
    const h = Math.max(0.02, v * (T.depth - 0.1));
    w.scale.y = h;
    w.position.y = -0.3 - T.depth + h / 2;
  }

  getTankLevel() { return this.rainTank.level; }

  /** 剖切显示地下蓄水池 */
  showTankSection(on) {
    this.rainTank.group.visible = on;
    this.pitCover.visible = !on;
  }

  isTankSectionVisible() { return this.rainTank.group.visible; }

  /** 围栏红外对射报警：探测器指示灯变亮 */
  setPerimeterAlert(active) {
    for (const led of this.beamPosts) led.material.emissiveIntensity = active ? 4 : 1;
  }

  /** 功能页附加的室外小品（如电网接入电杆），随室外图层一起显示和隐藏 */
  addProp(...objects) { this.group.add(...objects); }

  buildGarden(nav) {
    const g = this.group;
    const block = (x0, x1, z0, z1) => nav?.blockRect(0, x0, x1, z0, z1);
    // ---- 围栏（木栅栏，实例化渲染），西侧留出入户通道和车道，东侧留小门 ----
    const fenceMat = mat('woodLight');
    const fence = new THREE.Group();
    const postMatrices: THREE.Matrix4[] = [];
    const addFence = (x0, z0, x1, z1) => {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const alongX = z0 === z1;
      const n = Math.max(1, Math.floor(len / 0.25));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const m = new THREE.Matrix4().makeRotationY(alongX ? 0 : Math.PI / 2);
        m.setPosition(x0 + (x1 - x0) * t, 0.5, z0 + (z1 - z0) * t);
        postMatrices.push(m);
      }
      for (const y of [0.3, 0.8]) fence.add(box(alongX ? len : 0.05, 0.06, alongX ? 0.05 : len, fenceMat, (x0 + x1) / 2, y, (z0 + z1) / 2, { cast: false }));
      block(Math.min(x0, x1) - 0.05, Math.max(x0, x1) + 0.05, Math.min(z0, z1) - 0.05, Math.max(z0, z1) + 0.05);
    };
    addFence(-13, -9.5, 13, -9.5);
    addFence(-13, 11, 13, 11);
    addFence(13, -9.5, 13, -1.0);
    addFence(13, 0.6, 13, 11);
    addFence(-13, -9.5, -13, -1.6);
    addFence(-13, 1.2, -13, 2.0);
    addFence(-13, 5.0, -13, 11);
    const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.0, 0.06), fenceMat, postMatrices.length);
    postMatrices.forEach((m, i) => posts.setMatrixAt(i, m));
    posts.castShadow = true; posts.receiveShadow = true;
    fence.add(posts);
    setInfo(fence, { name: '庭院围栏', category: '安全 / 室外环境', func: '木栅栏高 1.0m；围栏顶部设红外对射探测器，离家布防时检测翻越入侵' });
    g.add(fence);
    this.fence = fence;
    // 红外对射探测器（围栏四角的小立柱）
    this.beamPosts = [];
    for (const [x, z] of [[-13, -9.5], [13, -9.5], [13, 11], [-13, 11]]) {
      const p = box(0.12, 1.3, 0.12, 'darkMetal', x, 0, z);
      const led = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2020, emissiveIntensity: 1 }));
      led.position.set(x, 1.25, z);
      g.add(p, led);
      this.beamPosts.push(led);
    }

    // ---- 树木 ----
    for (const [x, z, s, type] of [
      [-11, -7.5, 1.1, 'broad'], [11, -7.8, 1, 'conifer'], [11.5, 9.5, 1.2, 'broad'], [4.5, 9.6, 0.9, 'broad'], [-11.3, 9, 1, 'conifer'],
      [0.5, -8, 0.8, 'broad'], [-6, -8.3, 0.9, 'conifer'], [6.5, -8.2, 0.85, 'conifer'], [-11.8, -4.5, 0.8, 'broad'], [7.2, 9.8, 0.7, 'conifer'],
    ]) this.addTree(x, z, s, type, nav);
    for (let z = -80; z <= 80; z += 11) { this.addTree(-23.6, z + 3, 1.1, 'broad', null); this.addTree(-12.5, z, 0.9, z % 2 ? 'broad' : 'conifer', null, z > -10 && z < 12); }

    // ---- 灌木、草丛 ----
    const shrubGeo = new THREE.IcosahedronGeometry(0.45, 1);
    const shrubs = [[1, 5.9], [4.4, 5.9], [5.6, 5.9], [6.8, 5.9], [-6, -5.9], [-4, -6.1], [2, -6], [6, -6.1], [8.9, 3], [8.9, -3.5], [-8.9, -3.2], [-8.9, 3.4]];
    shrubs.forEach(([x, z], i) => {
      const s = new THREE.Mesh(shrubGeo, mat(i % 2 ? 'leafDark' : 'leaf'));
      s.scale.set(1.2, 0.75 + (i % 3) * 0.1, 1);
      s.position.set(x, 0.28, z);
      s.castShadow = s.receiveShadow = true;
      g.add(s);
      block(x - 0.5, x + 0.5, z - 0.45, z + 0.45);
    });
    // 草丛：几千个细长锥体，实例化渲染，颜色略有差异
    const tuftGeo = new THREE.ConeGeometry(0.035, 0.28, 3);
    tuftGeo.translate(0, 0.14, 0);
    const tufts = new THREE.InstancedMesh(tuftGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }), 3500);
    const rnd = (() => { let a = 12345; return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); })();
    const col = new THREE.Color();
    let n = 0;
    while (n < 3500) {
      const x = -12.8 + rnd() * 25.6, z = -9.3 + rnd() * 20.1;
      const inHouse = x > -8.6 && x < 8.6 && z > -5.6 && z < 5.4;
      const onPath = (z > -1.5 && z < 1.1 && (x < -8 || x > 8)) || (x < -8.2 && z > 2.1 && z < 4.9) || (x > -8.4 && x < 0.5 && z > 5 && z < 8.3);
      const inPit = x > this.pit.x0 && x < this.pit.x1 && z > this.pit.z0 && z < this.pit.z1;
      if (inHouse || onPath || inPit) continue;
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, -0.02, z), new THREE.Quaternion().setFromEuler(new THREE.Euler((rnd() - 0.5) * 0.4, rnd() * 6, (rnd() - 0.5) * 0.4)), new THREE.Vector3(1, 0.6 + rnd() * 0.8, 1));
      tufts.setMatrixAt(n, m);
      tufts.setColorAt(n, col.setHSL(0.24 + rnd() * 0.06, 0.45, 0.22 + rnd() * 0.12));
      n++;
    }
    tufts.receiveShadow = true;
    g.add(tufts);

    // ---- 花坛 ----
    const flowerColors = [0xd9534f, 0xf0ad4e, 0xf7f7f7, 0xc86dd7, 0xff8fb1];
    const flowers = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 6, 4), new THREE.MeshStandardMaterial({ roughness: 0.7 }), 80);
    let fi = 0;
    for (const [bx, bz] of [[7.5, 8.3], [-3.5, -7.2]]) {
      g.add(box(3, 0.35, 1.0, 'stone', bx, 0, bz));
      g.add(box(2.8, 0.05, 0.8, 'soil', bx, 0.33, bz, { cast: false }));
      for (let i = 0; i < 40; i++, fi++) {
        flowers.setMatrixAt(fi, new THREE.Matrix4().makeTranslation(bx - 1.3 + (i % 10) * 0.29, 0.45, bz - 0.33 + Math.floor(i / 10) * 0.22));
        flowers.setColorAt(fi, new THREE.Color(flowerColors[(i + fi) % 5]));
      }
      block(bx - 1.5, bx + 1.5, bz - 0.5, bz + 0.5);
    }
    g.add(flowers);

    // ---- 露台桌椅与遮阳伞 ----
    const tx = -6.4, tz = 6.9;
    g.add(cylinder(0.5, 0.5, 0.04, 'woodLight', tx, 0.72, tz, 24), cylinder(0.04, 0.04, 0.72, 'darkMetal', tx, 0, tz, 8));
    for (const dx of [-0.85, 0.85]) {
      g.add(box(0.48, 0.45, 0.48, 'woodLight', tx + dx, 0, tz, { rounded: 0.04 }));
      g.add(box(0.48, 0.45, 0.06, 'woodLight', tx + dx, 0.45, tz + 0.22));
    }
    g.add(cylinder(0.025, 0.025, 2.3, 'metal', tx, 0.76, tz, 8));
    const umb = new THREE.Mesh(new THREE.ConeGeometry(1.4, 0.45, 8, 1, true), new THREE.MeshStandardMaterial({ color: 0xe9e2cf, roughness: 0.9, side: THREE.DoubleSide }));
    umb.position.set(tx, 2.85, tz); umb.castShadow = true;
    g.add(umb);
    block(tx - 1.2, tx + 1.2, tz - 0.4, tz + 0.5);

    // ---- 新能源汽车（停在车道上） ----
    const car = this.buildCar();
    car.position.set(-11.4, 0, (DRIVEWAY.z0 + DRIVEWAY.z1) / 2);
    g.add(car);
    block(-13.7, -9.1, DRIVEWAY.z0 + 0.3, DRIVEWAY.z1 - 0.3);

    // ---- 路灯、庭院灯 ----
    this.streetLamps = [];
    for (let z = -40; z <= 40; z += 16) {
      g.add(cylinder(0.06, 0.08, 5, 'darkMetal', -14.0, 0, z, 8), box(0.6, 0.12, 0.25, 'darkMetal', -14.3, 5, z));
      const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe2a8, emissiveIntensity: 0 });
      g.add(box(0.4, 0.03, 0.18, lampMat, -14.3, 4.98, z));
      this.streetLamps.push(lampMat);
    }
    for (const [x, z] of [[-12.2, -1.6], [-10, -1.6], [-12.2, 1.2], [-10, 1.2], [9.8, 0.7], [11.8, 0.7]]) {
      g.add(cylinder(0.05, 0.05, 0.6, 'darkMetal', x, 0, z, 8));
      const m = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 0 });
      g.add(cylinder(0.08, 0.08, 0.1, m, x, 0.6, z, 12));
      this.streetLamps.push(m);
    }

    // ---- 邻居房屋 ----
    for (const [x, z, w, d, h, color, rot] of [
      [-33, -14, 12, 9, 6.4, 0xe8dcc8, Math.PI / 2], [-33, 8, 11, 9, 6.4, 0xd9e0e6, Math.PI / 2], [-33, 30, 12, 9, 3.4, 0xf0e6d6, Math.PI / 2],
      [0, -26, 14, 9, 6.4, 0xe6e0d4, 0], [22, -24, 10, 9, 3.4, 0xdad4c6, 0], [28, 4, 12, 9, 6.4, 0xe4d8c4, -Math.PI / 2], [26, 26, 11, 9, 6.4, 0xd8dfe3, Math.PI],
    ]) g.add(this.neighborHouse(x, z, w, d, h, color, rot));
  }

  // 树：阔叶树（树干 + 分枝 + 多团树冠）或针叶树（叠放的圆锥）
  addTree(x, z, s, type, nav, skip = false) {
    if (skip) return;
    const t = new THREE.Group();
    if (type === 'conifer') {
      t.add(cylinder(0.1 * s, 0.16 * s, 1.2 * s, 'bark', 0, 0, 0, 8));
      for (let k = 0; k < 4; k++) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry((1.4 - k * 0.28) * s, 1.5 * s, 10), mat(k % 2 ? 'leafDark' : 'leaf'));
        cone.position.y = (1.3 + k * 0.85) * s;
        cone.castShadow = cone.receiveShadow = true;
        t.add(cone);
      }
    } else {
      t.add(cylinder(0.12 * s, 0.2 * s, 2.3 * s, 'bark', 0, 0, 0, 8));
      for (const [a, tilt] of [[0.3, 0.5], [2.4, 0.6], [4.2, 0.45]]) {
        const br = cylinder(0.05 * s, 0.08 * s, 1.2 * s, 'bark', 0, 0, 0, 6);
        br.position.set(Math.cos(a) * 0.25 * s, 1.9 * s, Math.sin(a) * 0.25 * s);
        br.rotation.set(Math.sin(a) * tilt, 0, -Math.cos(a) * tilt);
        t.add(br);
      }
      const blobs = [[0, 3.1, 0, 1.25], [0.8, 2.7, 0.3, 0.9], [-0.7, 2.8, -0.4, 0.95], [0.2, 3.7, -0.3, 0.9], [-0.3, 2.6, 0.7, 0.8], [0.5, 3.3, -0.8, 0.8]];
      blobs.forEach(([lx, ly, lz, r], i) => {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r * s, 1), mat(i % 3 === 0 ? 'leafDark' : 'leaf'));
        m.position.set(lx * s, ly * s, lz * s);
        m.rotation.set(i, i * 2, 0);
        m.castShadow = true; m.receiveShadow = true;
        t.add(m);
      });
    }
    t.position.set(x, 0, z);
    t.rotation.y = (x * 13 + z * 7) % 6;
    setInfo(t, { name: type === 'conifer' ? '庭院乔木（罗汉松）' : '庭院乔木（香樟）', category: '室外环境', func: '夏季遮阳降温；吸收噪声与粉尘，改善微气候' });
    this.group.add(t);
    nav?.blockRect(0, x - 0.3, x + 0.3, z - 0.3, z + 0.3);
  }

  // 邻居房屋：体块 + 立面窗户贴图 + 坡屋顶
  neighborHouse(x, z, w, d, h, color, rot) {
    const g = new THREE.Group();
    const c = document.createElement('canvas'); c.width = 256; c.height = 128;
    const cg = c.getContext('2d')!;
    cg.fillStyle = '#' + color.toString(16).padStart(6, '0'); cg.fillRect(0, 0, 256, 128);
    cg.fillStyle = '#3a4a5a';
    for (let i = 0; i < 4; i++) { cg.fillRect(24 + i * 60, 30, 34, 50); }
    cg.fillStyle = '#ffffff';
    for (let i = 0; i < 4; i++) { cg.fillRect(22 + i * 60, 82, 38, 4); }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    const floors = Math.round(h / 3.2);
    tex.repeat.set(Math.max(1, Math.round(w / 6)), floors);
    const side = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const tex2 = tex.clone(); tex2.repeat.set(Math.max(1, Math.round(d / 6)), floors); tex2.needsUpdate = true;
    const side2 = new THREE.MeshStandardMaterial({ map: tex2, roughness: 0.9 });
    const plain = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side2, side2, plain, plain, side, side]);
    body.position.y = h / 2;
    body.castShadow = body.receiveShadow = true;
    g.add(body);
    const rh = d / 2 * Math.tan(THREE.MathUtils.degToRad(28));
    const shape = new THREE.Shape([new THREE.Vector2(-d / 2 - 0.4, 0), new THREE.Vector2(d / 2 + 0.4, 0), new THREE.Vector2(0, rh + 0.2)]);
    const rg = new THREE.ExtrudeGeometry(shape, { depth: w + 0.6, bevelEnabled: false });
    rg.translate(0, 0, -(w + 0.6) / 2);
    rg.rotateY(Math.PI / 2);
    const roof = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ color: [0x7a4a3a, 0x4a4f57, 0x5b6b4f][Math.abs(Math.round(x + z)) % 3], roughness: 0.8 }));
    roof.position.y = h;
    roof.castShadow = true;
    g.add(roof);
    g.position.set(x, 0, z);
    g.rotation.y = rot;
    setInfo(g, { name: '邻居住宅', category: '室外环境', func: '周边环境建筑（简化体块模型）' });
    return g;
  }

  // 家用轿车（简化模型）
  buildCar() {
    const g = new THREE.Group();
    const paint = mat('carPaint');
    g.add(box(4.4, 0.62, 1.8, paint, 0, 0.28, 0, { rounded: 0.18 }));
    g.add(box(2.3, 0.55, 1.6, mat('glass'), -0.2, 0.84, 0, { rounded: 0.2, cast: false }));
    g.add(box(2.2, 0.06, 1.55, paint, -0.2, 1.36, 0, { rounded: 0.03 }));
    for (const [x, z] of [[1.35, 0.82], [-1.35, 0.82], [1.35, -0.82], [-1.35, -0.82]]) {
      const w = cylinder(0.33, 0.33, 0.24, 'tyre', 0, 0, 0, 20);
      w.rotation.x = Math.PI / 2;
      w.position.set(x, 0.33, z);
      g.add(w);
      const hub = cylinder(0.18, 0.18, 0.25, 'metal', 0, 0, 0, 12);
      hub.rotation.x = Math.PI / 2; hub.position.set(x, 0.33, z);
      g.add(hub);
    }
    for (const z of [0.6, -0.6]) {
      g.add(box(0.04, 0.12, 0.3, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6d8, emissiveIntensity: 0.4 }), 2.2, 0.62, z));
      g.add(box(0.04, 0.1, 0.35, new THREE.MeshStandardMaterial({ color: 0x880000, emissive: 0xff0000, emissiveIntensity: 0.3 }), -2.2, 0.66, z));
    }
    setInfo(g, { name: '新能源汽车', category: '绿色低碳', func: '纯电动汽车，停在车道上时由家用充电桩充电，可优先使用光伏余电', data: { 电池: '60 kWh' } });
    return g;
  }

  // 远山：一圈起伏的山体，填满地平线
  buildHills() {
    const segs = 96, R = 320;
    const pts: [number, number, number][] = [];
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      const h = 18 + 14 * Math.sin(a * 3.1) + 9 * Math.sin(a * 7.3 + 1) + 5 * Math.sin(a * 13.7 + 2);
      pts.push([Math.cos(a) * R, Math.sin(a) * R, h]);
    }
    const pos: number[] = [], idx: number[] = [];
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

    this.hemi.intensity = 0.5 + 0.45 * dayFactor * (0.6 + 0.4 * w.sun); // 夜间保留一些月光，关灯后也能看清室内布局
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
