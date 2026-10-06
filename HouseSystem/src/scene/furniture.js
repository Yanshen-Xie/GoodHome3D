// 室内家具：按房间摆放。家具都用基本几何体组合而成，餐椅、马桶、花盆来自 OBJ 模型（自写解析器加载）。
// 大件家具会登记到导航网格上作为障碍物，人物走路和疏散时会绕开。
import * as THREE from 'three';
import { mat, box, cylinder, setInfo, footprint, uniqueMat } from './common.js';
import { loadOBJ } from '../loaders/objLoader.js';
import { FLOORS } from './layout.js';
import chairObj from '../assets/models/dining_chair.obj?raw';
import chairMtl from '../assets/models/dining_chair.mtl?raw';
import toiletObj from '../assets/models/toilet.obj?raw';
import toiletMtl from '../assets/models/toilet.mtl?raw';
import potObj from '../assets/models/plant_pot.obj?raw';
import potMtl from '../assets/models/plant_pot.mtl?raw';

let objModels = null;
function models() {
  if (!objModels) objModels = { chair: loadOBJ(chairObj, chairMtl), toilet: loadOBJ(toiletObj, toiletMtl), pot: loadOBJ(potObj, potMtl) };
  return objModels;
}

// ---------------- 单件家具 ----------------
function group(...children) { const g = new THREE.Group(); children.forEach((c) => g.add(c)); return g; }

function bed(w, l, duvet) {
  const g = group(
    box(w + 0.08, 0.3, l + 0.05, 'woodLight', 0, 0, 0, { rounded: 0.03 }),
    box(w, 0.22, l - 0.05, 'fabricWhite', 0, 0.3, 0.02, { rounded: 0.06 }),
    box(w + 0.02, 0.08, l * 0.62, duvet, 0, 0.5, l * 0.18, { rounded: 0.04 }),
    box(w + 0.1, 0.85, 0.08, 'woodLight', 0, 0, -l / 2 - 0.02, { rounded: 0.03 }),
  );
  const pillows = w > 1.4 ? [-w / 4, w / 4] : [0];
  for (const x of pillows) g.add(box(Math.min(0.6, w * 0.7), 0.12, 0.38, 'fabricWhite', x, 0.52, -l / 2 + 0.3, { rounded: 0.05 }));
  return g;
}

function sofa(len, fabric = 'fabricGrey') {
  const d = 0.9;
  const g = group(
    box(len, 0.42, d, fabric, 0, 0.05, 0, { rounded: 0.06 }),
    box(len, 0.45, 0.22, fabric, 0, 0.42, -d / 2 + 0.11, { rounded: 0.08 }),
    box(0.2, 0.62, d, fabric, -len / 2 + 0.1, 0.05, 0, { rounded: 0.08 }),
    box(0.2, 0.62, d, fabric, len / 2 - 0.1, 0.05, 0, { rounded: 0.08 }),
  );
  const n = Math.round((len - 0.4) / 0.65);
  const cw = (len - 0.4) / n;
  for (let i = 0; i < n; i++) g.add(box(cw - 0.03, 0.14, d - 0.3, fabric, -len / 2 + 0.2 + cw * (i + 0.5), 0.46, 0.08, { rounded: 0.06 }));
  for (const x of [-len / 2 + 0.05, len / 2 - 0.05]) for (const z of [-d / 2 + 0.06, d / 2 - 0.06]) g.add(cylinder(0.025, 0.02, 0.05, 'darkMetal', x, 0, z, 8));
  g.add(box(0.4, 0.4, 0.14, 'fabricBeige', -len / 2 + 0.45, 0.58, -d / 2 + 0.3, { rounded: 0.06 }));
  return g;
}

function table(w, d, h, top = 'woodLight', legs = 'woodLight') {
  const g = group(box(w, 0.04, d, top, 0, h - 0.04, 0, { rounded: 0.015 }));
  const lx = w / 2 - 0.06, lz = d / 2 - 0.06;
  for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) g.add(box(0.05, h - 0.04, 0.05, legs, x, 0, z));
  return g;
}

function cabinet(w, h, d, m = 'woodWhite', doors = 2) {
  const g = group(box(w, h, d, m, 0, 0, 0, { rounded: 0.01 }));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5);
    g.add(box(0.012, h - 0.04, 0.005, 'darkMetal', x + (w / doors) / 2 - 0.003, 0.02, d / 2 + 0.002, { cast: false }));
    g.add(box(0.12, 0.02, 0.025, 'metal', x + (i % 2 ? -1 : 1) * (w / doors / 2 - 0.08), h * 0.55, d / 2 + 0.012, { cast: false }));
  }
  return g;
}

function plant(scale = 1) {
  const g = new THREE.Group();
  const pot = models().pot.clone();
  g.add(pot);
  const leafGeo = new THREE.SphereGeometry(0.16, 10, 6);
  const r = [0.3, 0.7, 0.1, 0.9, 0.5, 0.2, 0.8, 0.4];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const leaf = new THREE.Mesh(leafGeo, mat(i % 2 ? 'leaf' : 'leafDark'));
    leaf.scale.set(0.6, 1.6 + r[i], 0.35);
    leaf.position.set(Math.cos(a) * 0.1, 0.62 + r[i] * 0.3, Math.sin(a) * 0.1);
    leaf.rotation.set(Math.sin(a) * 0.5, -a, Math.cos(a) * 0.5);
    leaf.castShadow = true;
    g.add(leaf);
  }
  g.scale.setScalar(scale);
  setInfo(g, { name: '室内绿植', category: '家具', func: '调节湿度、吸附部分室内污染物（OBJ 模型：plant_pot.obj）' });
  return g;
}

function books(w) {
  const g = new THREE.Group();
  const colors = [0x8c3b3b, 0x3b5f8c, 0xd9c27a, 0x4f7a4a, 0xe0e0e0, 0x6b4c7a];
  let x = -w / 2 + 0.03, i = 0;
  while (x < w / 2 - 0.05) {
    const bw = 0.025 + ((i * 37) % 10) / 400, bh = 0.2 + ((i * 53) % 10) / 100;
    const b = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, 0.18), new THREE.MeshStandardMaterial({ color: colors[i % colors.length], roughness: 0.8 }));
    b.position.set(x + bw / 2, bh / 2, 0);
    g.add(b);
    x += bw + 0.004; i++;
  }
  return g;
}

function bookshelf(w, h) {
  const d = 0.32;
  const g = group(box(w, h, 0.02, 'woodLight', 0, 0, -d / 2 + 0.01));
  g.add(box(0.03, h, d, 'woodLight', -w / 2 + 0.015, 0, 0), box(0.03, h, d, 'woodLight', w / 2 - 0.015, 0, 0));
  const shelves = Math.round(h / 0.38);
  for (let i = 0; i <= shelves; i++) {
    const y = (i * (h - 0.03)) / shelves;
    g.add(box(w, 0.03, d, 'woodLight', 0, y, 0));
    if (i < shelves && i % 2 === 0) { const b = books(w - 0.1); b.position.set(0, y + 0.03, 0.02); g.add(b); }
  }
  return g;
}

function rug(w, d, m = 'rug') {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat(m));
  mesh.position.y = 0.018;
  mesh.receiveShadow = true;
  return mesh;
}

function armchair(fabric = 'fabricBeige') {
  return group(
    box(0.8, 0.4, 0.8, fabric, 0, 0.05, 0, { rounded: 0.08 }),
    box(0.8, 0.5, 0.18, fabric, 0, 0.4, -0.31, { rounded: 0.08 }),
    box(0.15, 0.3, 0.8, fabric, -0.33, 0.4, 0, { rounded: 0.06 }),
    box(0.15, 0.3, 0.8, fabric, 0.33, 0.4, 0, { rounded: 0.06 }),
  );
}

function officeChair() {
  const g = group(
    box(0.45, 0.06, 0.45, 'fabricBlue', 0, 0.45, 0, { rounded: 0.02 }),
    box(0.42, 0.45, 0.05, 'fabricBlue', 0, 0.55, -0.2, { rounded: 0.02 }),
    cylinder(0.025, 0.025, 0.4, 'darkMetal', 0, 0.05, 0, 8),
  );
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.add(box(0.28, 0.03, 0.04, 'darkMetal', Math.cos(a) * 0.14, 0.03, Math.sin(a) * 0.14)); g.children.at(-1).rotation.y = -a; }
  return g;
}

function grabBar(len, vertical = false) {
  const geo = new THREE.CylinderGeometry(0.018, 0.018, len, 10);
  const m = new THREE.Mesh(geo, mat('metal'));
  if (!vertical) m.rotation.z = Math.PI / 2;
  m.castShadow = true;
  return m;
}

// 靠墙安装的连续扶手（走廊、卫生间）。x0/x1 为沿墙起止，axis 为墙方向
function wallRail(g, pts, y = 0.85) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [a, b] = [pts[i], pts[i + 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, len, 10), mat('woodLight'));
    bar.position.set((a[0] + b[0]) / 2, y, (a[1] + b[1]) / 2);
    bar.rotation.z = Math.PI / 2;
    bar.rotation.y = -Math.atan2(b[1] - a[1], b[0] - a[0]);
    bar.castShadow = true;
    g.add(bar);
  }
}

// 装饰画：画框 + 用 Canvas 生成的抽象画
function painting(w, h, seed) {
  const c = document.createElement('canvas'); c.width = 256; c.height = Math.round(256 * h / w);
  const g = c.getContext('2d');
  let s = seed * 9301 + 49297;
  const r = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const palettes = [['#e9e1d3', '#c96f4a', '#2f4858', '#d9b26f'], ['#f2efe9', '#6b8f71', '#a3b18a', '#344e41'], ['#eee4da', '#355070', '#b56576', '#eaac8b']];
  const pal = palettes[seed % palettes.length];
  g.fillStyle = pal[0]; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 7; i++) {
    g.fillStyle = pal[1 + (i % 3)];
    g.globalAlpha = 0.75;
    if (i % 2) { g.beginPath(); g.arc(r() * c.width, r() * c.height, 20 + r() * 60, 0, Math.PI * 2); g.fill(); }
    else g.fillRect(r() * c.width * 0.8, r() * c.height * 0.8, 30 + r() * 90, 10 + r() * 70);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const grp = new THREE.Group();
  grp.add(box(w + 0.08, h + 0.08, 0.03, 'woodDark', 0, -0.04, 0, { cast: false }));
  const pic = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  pic.position.set(0, h / 2, 0.017);
  grp.add(pic);
  return grp;
}

function bathtub() {
  const g = new THREE.Group();
  g.add(box(1.7, 0.55, 0.75, 'ceramic', 0, 0, 0, { rounded: 0.08 }));
  const inner = box(1.5, 0.05, 0.55, mat('water'), 0, 0.42, 0, { cast: false });
  g.add(inner);
  g.add(cylinder(0.02, 0.02, 0.25, 'metal', -0.7, 0.55, -0.3, 8));
  return g;
}

function washer() {
  const g = group(box(0.6, 0.85, 0.6, 'whiteGloss', 0, 0, 0, { rounded: 0.03 }));
  const door = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 8, 24), mat('metal'));
  door.position.set(0, 0.4, 0.31); g.add(door);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), mat('glass')); glass.position.set(0, 0.4, 0.305); g.add(glass);
  g.add(box(0.5, 0.06, 0.02, 'blackPlastic', 0, 0.74, 0.3, { cast: false }));
  return g;
}

function stool() {
  return group(cylinder(0.18, 0.18, 0.05, 'leather', 0, 0.62, 0, 16), cylinder(0.025, 0.025, 0.62, 'darkMetal', 0, 0, 0, 8), cylinder(0.16, 0.16, 0.02, 'darkMetal', 0, 0, 0, 16));
}

function deskLamp() {
  const g = group(cylinder(0.07, 0.07, 0.02, 'darkMetal'), cylinder(0.01, 0.01, 0.4, 'darkMetal', 0, 0.02, 0, 6));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 16, 1, true), mat('whiteGloss'));
  shade.position.set(0, 0.45, 0); g.add(shade);
  return g;
}

// ---------------- 布置各房间 ----------------
export function buildFurniture(nav) {
  const root = new THREE.Group();
  root.name = 'furniture';
  const handles = {};

  /** 放置家具：floor 楼层，(x,z) 位置，rotDeg 朝向（度），solid 是否登记为导航障碍 */
  const put = (obj, x, z, rotDeg = 0, { floor = 0, solid = true, y = 0, info } = {}) => {
    obj.position.set(x, FLOORS[floor].y + y, z);
    obj.rotation.y = THREE.MathUtils.degToRad(rotDeg);
    root.add(obj);
    if (info) setInfo(obj, { room: undefined, ...info });
    if (solid && nav) { const f = footprint(obj); nav.blockRect(floor, f.x0, f.x1, f.z0, f.z1); }
    return obj;
  };
  const wallArt = (x, y, z, rotDeg, floor, w, h, seed) => put(painting(w, h, seed), x, z, rotDeg, { floor, y, solid: false, info: { name: '装饰画', category: '家具 / 软装', func: '墙面软装，程序生成的抽象画' } });

  // ================= 一层 =================
  // ----- 客厅 -----
  put(sofa(2.6), -7.35, 2.8, 90, { info: { name: '三人布艺沙发', category: '家具', func: '圆角设计、座高 45cm，便于老人起坐', room: 'living' } });
  put(armchair(), -5.7, 1.45, 30, { info: { name: '单人扶手椅', category: '家具', func: '带扶手，方便起身', room: 'living' } });
  put(rug(2.6, 3.2), -5.6, 2.8, 0, { y: 0.02, solid: false });
  const coffee = group(box(1.2, 0.05, 0.6, 'woodLight', 0, 0.38, 0, { rounded: 0.025 }), box(1.1, 0.03, 0.5, 'woodLight', 0, 0.1, 0, { rounded: 0.015 }));
  for (const [x, z] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) coffee.add(cylinder(0.02, 0.02, 0.38, 'darkMetal', x, 0, z, 8));
  // 茶几与沙发之间留 0.9m，人可以走到沙发前
  put(coffee, -5.45, 2.8, 90, { info: { name: '圆角茶几', category: '家具 / 适老', func: '四角 R25 圆角，防止磕碰', room: 'living' } });
  const tvWall = group(box(0.4, 0.55, 2.4, 'woodDark', 0, 0, 0, { rounded: 0.02 }), box(0.12, 1.6, 2.4, 'woodPanel', 0.14, 0.55, 0));
  put(tvWall, -3.3, 2.8, 0, { info: { name: '电视背景墙隔断', category: '家具', func: '木饰面隔断，分隔客厅与餐厅', room: 'living' } });
  const tv = new THREE.Group();
  tv.add(box(0.05, 0.9, 1.6, 'blackPlastic', 0, 0, 0));
  const screenMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.84), screenMat);
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(-0.03, 0.45, 0);
  tv.add(screen);
  put(tv, -3.26, 2.8, 0, { solid: false, y: 0.95 });
  handles.tv = { group: tv, screen, screenMat };
  put(plant(1.0), -7.4, 4.5, 0);
  put(plant(0.9), -1.5, 4.5, 0);
  const floorLamp = group(cylinder(0.15, 0.15, 0.03, 'darkMetal'), cylinder(0.015, 0.015, 1.5, 'darkMetal', 0, 0.03, 0, 8));
  const shadeMat = uniqueMat({ color: 0xf3ead8, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.9, side: THREE.DoubleSide });
  floorLamp.add(cylinder(0.14, 0.2, 0.25, shadeMat, 0, 1.45, 0));
  put(floorLamp, -7.5, 1.28, 0, { info: { name: '落地灯', category: '照明', func: '阅读照明', room: 'living' } });
  handles.floorLampShade = shadeMat;
  put(bookshelf(1.2, 1.9), -7.25, 0.9, 0, { info: { name: '书架', category: '家具', room: 'living' } });
  wallArt(-2.97, 1.3, 2.8, 90, 0, 1.4, 0.8, 1);

  // ----- 餐厅 -----
  put(table(1.6, 0.9, 0.75), 1.1, 2.9, 0, { info: { name: '实木餐桌', category: '家具', func: '四人餐桌，桌角圆润处理', room: 'dining' } });
  const chair = models().chair;
  for (const [x, z, r] of [[0.7, 2.25, 0], [1.5, 2.25, 0], [0.7, 3.55, 180], [1.5, 3.55, 180]]) put(chair.clone(), x, z, r, { solid: false, info: { name: '餐椅（OBJ 模型）', category: '家具', func: '由自写 OBJ/MTL 解析器加载：dining_chair.obj，含顶点、纹理坐标、法线和材质', room: 'dining', data: { 顶点数: chair.userData.stats.vertices, 三角形数: chair.userData.stats.triangles, 材质数: chair.userData.stats.materials } } });
  put(cabinet(2.0, 0.75, 0.42, 'woodDark', 4), 1.3, 4.65, 180, { info: { name: '餐边柜', category: '家具', room: 'dining' } });
  wallArt(3.08, 1.3, 3.6, -90, 0, 1.0, 0.7, 2);

  // ----- 厨房 -----
  const counterS = group(cabinet(3.8, 0.86, 0.6, 'woodWhite', 6), box(3.82, 0.04, 0.62, 'marble', 0, 0.86, 0));
  counterS.add(box(0.7, 0.005, 0.42, 'darkMetal', 0.2, 0.9, 0, { cast: false }));
  counterS.add(cylinder(0.015, 0.015, 0.3, 'metal', 0.2, 0.9, -0.22, 8));
  put(counterS, 6.0, 4.6, 180, { info: { name: '橱柜（南侧）+ 水槽', category: '家具', func: '台面高 90cm', room: 'kitchen' } });
  const counterE = group(cabinet(3.1, 0.86, 0.6, 'woodWhite', 5), box(3.12, 0.04, 0.62, 'marble', 0, 0.86, 0));
  put(counterE, 7.6, 2.75, 270, { info: { name: '橱柜（东侧）', category: '家具', room: 'kitchen' } });
  const cooktop = group(box(0.7, 0.02, 0.45, 'blackPlastic', 0, 0, 0));
  for (const dx of [-0.17, 0.17]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 20), mat('darkMetal')); ring.rotation.x = Math.PI / 2; ring.position.set(dx, 0.03, 0); cooktop.add(ring); }
  put(cooktop, 7.6, 1.6, 270, { solid: false, y: 0.9, info: { name: '燃气灶', category: '厨房设备 / 安全', func: '带熄火保护装置，意外熄火自动断气', room: 'kitchen', maintain: '熄火保护测试：2026-07 正常' } });
  handles.stove = { x: 7.6, z: 1.6, y: 0.95 };
  put(group(box(0.5, 0.35, 0.7, 'metal', 0, 0, 0), box(0.25, 0.6, 0.3, 'metal', 0.12, 0.35, 0)), 7.65, 1.6, 0, { solid: false, y: 1.7, info: { name: '油烟机', category: '厨房设备', room: 'kitchen' } });
  put(group(box(0.72, 1.85, 0.68, 'metal', 0, 0, 0, { rounded: 0.03 }), box(0.02, 0.6, 0.03, 'darkMetal', 0.3, 0.9, 0.35)), 3.7, 4.5, 180, { info: { name: '一级能效冰箱', category: '家电 / 节能', func: '变频压缩机，日耗电约 0.8 kWh', room: 'kitchen' } });
  put(cabinet(2.6, 0.7, 0.35, 'woodWhite', 4), 6.3, 0.9, 0, { solid: false, y: 1.6, info: { name: '吊柜', category: '家具', room: 'kitchen' } });
  const island = group(cabinet(1.6, 0.86, 0.7, 'woodDark', 2), box(1.7, 0.04, 0.8, 'marble', 0, 0.86, 0));
  // 中岛台东西向摆放，南侧与橱柜之间、西侧与墙之间都留出 ≥ 0.8m 的通道（火灾时灶台附近的人能绕开火源逃生）
  put(island, 5.2, 2.55, 0, { info: { name: '中岛台', category: '家具', func: '备餐与早餐台；四周留有 0.8m 以上通道', room: 'kitchen' } });
  for (const x of [4.8, 5.6]) put(stool(), x, 1.85, 0, { solid: false });

  // ----- 老人房 -----
  put(bed(1.2, 2.0, 'fabricBeige'), -5.5, -3.83, 0, { info: { name: '护理床', category: '家具 / 适老', func: '床高 45cm，一侧带起身扶手，可升降床头', room: 'elder' } });
  const rail = grabBar(0.9); rail.position.set(-6.2, 0.75, -3.4); rail.rotation.set(0, Math.PI / 2, Math.PI / 2); root.add(rail);
  put(cabinet(0.45, 0.5, 0.4, 'woodLight', 1), -4.45, -4.65, 0, { info: { name: '床头柜', category: '家具', room: 'elder' } });
  put(armchair('fabricGreen'), -7.3, -1.55, 90, { info: { name: '起身辅助椅', category: '家具 / 适老', func: '高座面 + 扶手，方便老人起坐', room: 'elder' } });
  put(cabinet(1.6, 2.1, 0.55, 'woodWhite', 2), -3.62, -3.6, 270, { info: { name: '衣柜', category: '家具', room: 'elder' } });
  put(plant(0.8), -7.55, -4.5, 0);

  // ----- 无障碍卫生间 -----
  const toilet = models().toilet;
  put(toilet.clone(), -2.7, -3.15, 90, { info: { name: '坐便器（OBJ 模型）', category: '卫浴', func: '由自写 OBJ/MTL 解析器加载：toilet.obj', room: 'bath1', data: { 顶点数: toilet.userData.stats.vertices, 三角形数: toilet.userData.stats.triangles } } });
  const tb = grabBar(0.7); tb.position.set(-3.08, 0.75, -2.75); tb.rotation.y = Math.PI / 2; root.add(tb);
  setInfo(tb, { name: '马桶安全抓杆', category: '适老无障碍', func: '承重 ≥ 100kg，辅助如厕起身', room: 'bath1' });
  const shower = new THREE.Group();
  shower.add(box(1.3, 0.02, 1.2, 'bathTile', 0, 0.012, 0, { cast: false }));
  shower.add(box(0.02, 2.0, 1.2, 'glass', 0.65, 0, 0, { cast: false }));
  shower.add(box(0.45, 0.04, 0.35, 'woodLight', -0.35, 0.45, -0.38), box(0.05, 0.45, 0.05, 'metal', -0.35, 0, -0.38));
  const sb = grabBar(0.8); sb.position.set(0.1, 0.9, -0.58); shower.add(sb);
  shower.add(cylinder(0.1, 0.1, 0.02, 'metal', -0.3, 2.1, -0.3), cylinder(0.01, 0.01, 0.9, 'metal', -0.3, 1.2, -0.58, 6));
  put(shower, -2.45, -4.25, 0, { solid: false, info: { name: '无障碍淋浴区', category: '适老无障碍', func: '无挡水条、折叠淋浴座椅、L 形安全抓杆、防滑地砖', room: 'bath1' } });
  nav?.blockRect(0, -3.1, -1.8, -4.9, -3.65);
  put(group(cabinet(0.8, 0.8, 0.5, 'woodWhite', 2), box(0.82, 0.04, 0.52, 'ceramic', 0, 0.8, 0), cylinder(0.18, 0.15, 0.1, 'ceramic', 0, 0.84, 0)), -0.95, -2.1, 270, { info: { name: '洗手台', category: '卫浴', func: '台下可容膝，轮椅可接近', room: 'bath1' } });
  root.add(box(0.02, 0.8, 0.7, 'mirror', -0.72, 1.2, -2.1, { cast: false }));

  // ----- 设备间 -----
  put(washer(), 3.95, -4.55, 0, { info: { name: '洗衣机', category: '家电', room: 'utility' } });
  const dryer = washer(); put(dryer, 3.95, -4.55, 0, { solid: false, y: 0.87, info: { name: '干衣机（热泵式）', category: '家电 / 节能', room: 'utility' } });
  put(group(cabinet(0.9, 0.85, 0.55, 'woodWhite', 2), box(0.92, 0.04, 0.57, 'marble', 0, 0.85, 0)), 5.0, -4.6, 0, { info: { name: '洗衣池', category: '家具', room: 'utility' } });
  const shelf = bookshelf(1.2, 1.8); put(shelf, 7.62, -1.9, 270, { info: { name: '储物架', category: '家具', room: 'utility' } });

  // ----- 门厅走廊 -----
  put(cabinet(1.2, 1.0, 0.36, 'woodLight', 2), -6.9, -0.72, 0, { info: { name: '鞋柜 + 换鞋凳', category: '家具 / 适老', func: '玄关处可坐下换鞋', room: 'hall1' } });
  const railG = new THREE.Group();
  wallRail(railG, [[-7.8, -0.86], [-7.4, -0.86]]);
  wallRail(railG, [[-6.2, -0.86], [-4.5, -0.86]]);
  wallRail(railG, [[-3.3, -0.86], [-2.3, -0.86]]);
  wallRail(railG, [[5.2, -0.86], [7.8, -0.86]]);
  setInfo(railG, { name: '走廊连续扶手', category: '适老无障碍', func: '高 85cm，沿走廊设置，老人行走时可随时扶握', room: 'hall1', maintain: '牢固度检查：2026-08 正常' });
  root.add(railG);

  // ================= 二层 =================
  // ----- 主卧 -----
  put(bed(1.8, 2.0, 'fabricBlue'), -5.4, -3.85, 0, { floor: 1, info: { name: '双人床', category: '家具', room: 'master' } });
  put(rug(2.4, 1.2), -5.4, -2.3, 0, { y: 0.02, floor: 1, solid: false });
  for (const x of [-6.65, -4.15]) put(cabinet(0.45, 0.5, 0.4, 'woodLight', 1), x, -4.65, 0, { floor: 1, info: { name: '床头柜', category: '家具', room: 'master' } });
  put(deskLamp(), -6.65, -4.65, 0, { floor: 1, y: 0.5, solid: false });
  put(deskLamp(), -4.15, -4.65, 0, { floor: 1, y: 0.5, solid: false });
  put(cabinet(1.8, 2.2, 0.6, 'woodWhite', 3), -3.0, -3.5, 270, { floor: 1, info: { name: '衣柜', category: '家具', func: '整体收纳', room: 'master' } });
  put(group(cabinet(1.0, 0.75, 0.45, 'woodLight', 2), box(0.02, 0.7, 0.5, 'mirror', -0.2, 0.9, 0)), -7.65, -1.6, 90, { floor: 1, info: { name: '梳妆台', category: '家具', room: 'master' } });
  put(plant(0.8), -7.55, -4.5, 0, { floor: 1 });

  // ----- 二层卫生间 -----
  put(bathtub(), -1.6, -4.5, 0, { floor: 1, info: { name: '浴缸', category: '卫浴', func: '防滑底面，侧边设扶手', room: 'bath2' } });
  put(toilet.clone(), -2.14, -3.4, 90, { floor: 1, info: { name: '坐便器（OBJ 模型）', category: '卫浴', room: 'bath2' } });
  put(group(cabinet(0.8, 0.8, 0.5, 'woodWhite', 2), box(0.82, 0.04, 0.52, 'ceramic', 0, 0.8, 0), cylinder(0.18, 0.15, 0.1, 'ceramic', 0, 0.84, 0)), -2.25, -2.45, 90, { floor: 1, info: { name: '洗手台', category: '卫浴', room: 'bath2' } });
  root.add(box(0.02, 0.8, 0.7, 'mirror', -2.48, FLOORS[1].y + 1.2, -2.45, { cast: false }));

  // ----- 儿童房 -----
  put(bed(1.0, 2.0, 'fabricPink'), 4.1, -3.83, 0, { floor: 1, info: { name: '儿童床（带护栏）', category: '家具 / 安全', func: '床侧防护栏，防坠落', room: 'kid' } });
  put(box(0.05, 0.3, 1.2, 'woodLight', 0, 0, 0), 4.67, -4.03, 0, { floor: 1, solid: false, y: 0.52 }); // 床侧护栏
  put(table(1.2, 0.6, 0.72, 'woodWhite', 'woodWhite'), 6.0, -4.55, 0, { floor: 1, info: { name: '学习桌', category: '家具', func: '靠窗布置，自然采光充足', room: 'kid' } });
  put(deskLamp(), 6.4, -4.6, 0, { floor: 1, y: 0.72, solid: false });
  put(officeChair(), 6.0, -3.95, 180, { floor: 1, solid: false });
  put(bookshelf(1.2, 1.6), 7.65, -1.9, 270, { floor: 1, info: { name: '儿童书架', category: '家具', room: 'kid' } });
  put(box(0.7, 0.4, 0.45, 'fabricGreen', 0, 0, 0, { rounded: 0.08 }), 5.9, -1.6, 0, { floor: 1, info: { name: '软包玩具箱', category: '家具 / 安全', func: '软包圆角，防磕碰', room: 'kid' } });
  put(rug(1.8, 1.4), 5.8, -2.7, 0, { y: 0.02, floor: 1, solid: false });

  // ----- 书房 -----
  put(table(1.4, 0.65, 0.75, 'woodDark', 'darkMetal'), -6.0, 4.5, 0, { floor: 1, info: { name: '书桌', category: '家具', func: '朝南靠窗，白天以自然光为主', room: 'study' } });
  put(deskLamp(), -5.5, 4.55, 0, { floor: 1, y: 0.75, solid: false });
  put(officeChair(), -6.0, 3.85, 0, { floor: 1, solid: false });
  put(bookshelf(1.2, 2.0), -3.87, 2.1, 270, { floor: 1, info: { name: '书柜', category: '家具', room: 'study' } });
  put(bookshelf(1.2, 2.0), -3.87, 3.4, 270, { floor: 1, info: { name: '书柜', category: '家具', room: 'study' } });
  put(armchair('leather'), -7.2, 1.5, 40, { floor: 1, info: { name: '阅读椅', category: '家具', room: 'study' } });
  wallArt(-7.88, 1.4, 1.2, 90, 1, 0.8, 0.6, 3);

  // ----- 家庭起居室 -----
  put(sofa(2.6, 'fabricBeige'), -3.05, 2.8, 90, { floor: 1, info: { name: '起居室沙发', category: '家具', room: 'family' } });
  put(rug(2.4, 3.0), -1.0, 2.8, 0, { y: 0.02, floor: 1, solid: false });
  put(coffee.clone(), -1.4, 2.8, 90, { floor: 1 });
  const tv2 = group(box(0.4, 0.5, 2.0, 'woodLight', 0, 0, 0, { rounded: 0.02 }), box(0.05, 0.8, 1.4, 'blackPlastic', 0.05, 0.9, 0));
  put(tv2, 2.9, 2.8, 0, { floor: 1, info: { name: '电视柜', category: '家具', room: 'family' } });
  put(plant(1.0), 2.8, 4.55, 0, { floor: 1 });
  put(plant(0.8), -3.2, 4.55, 0, { floor: 1 });
  wallArt(-3.48, 1.5, 2.8, 90, 1, 1.6, 0.8, 4);

  // ----- 客房 -----
  put(bed(1.5, 2.0, 'fabricGreen'), 4.35, 3.2, 90, { floor: 1, info: { name: '客床', category: '家具', room: 'guest' } });
  put(cabinet(0.45, 0.5, 0.4, 'woodLight', 1), 3.55, 4.5, 90, { floor: 1 });
  put(cabinet(1.6, 2.1, 0.6, 'woodWhite', 2), 7.0, 1.0, 0, { floor: 1, info: { name: '衣柜', category: '家具', room: 'guest' } });
  wallArt(3.32, 1.4, 3.2, 90, 1, 1.0, 0.6, 5);

  // ----- 二层走廊 -----
  put(plant(0.9), -7.5, -0.2, 0, { floor: 1 });
  wallArt(-5.2, 1.4, -0.89, 0, 1, 1.2, 0.7, 6);

  return { root, handles };
}
