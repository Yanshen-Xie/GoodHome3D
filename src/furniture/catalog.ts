// 室内家具：按房间摆放。家具都用基本几何体组合而成，餐椅、马桶、花盆来自 OBJ 模型（自写解析器加载）。
// 大件家具会登记到导航网格上作为障碍物，人物走路和疏散时会绕开。
import * as THREE from 'three';
import { mat, box, cylinder, setInfo, uniqueMat, markSharedResources } from '../scene/common.js';
import { loadOBJ } from '../loaders/objLoader.js';
import type { FurnitureFactoryConfig } from './types';

import chairObj from '../assets/models/dining_chair.obj?raw';
import chairMtl from '../assets/models/dining_chair.mtl?raw';
import toiletObj from '../assets/models/toilet.obj?raw';
import toiletMtl from '../assets/models/toilet.mtl?raw';
import potObj from '../assets/models/plant_pot.obj?raw';
import potMtl from '../assets/models/plant_pot.mtl?raw';

export type FurnitureKind = keyof typeof furnitureFactories;

export interface FurnitureModuleConfig {
  kind: FurnitureKind;
  args?: unknown[];
}

let objModels = null;
export function models() {
  if (!objModels) objModels = {
    chair: markSharedResources(loadOBJ(chairObj, chairMtl)),
    toilet: markSharedResources(loadOBJ(toiletObj, toiletMtl)),
    pot: markSharedResources(loadOBJ(potObj, potMtl)),
  };
  return objModels;
}

// ---------------- 单件家具 ----------------
export function group(...children) { const g = new THREE.Group(); children.forEach((c) => g.add(c)); return g; }

export function bed(w, l, duvet) {
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

export function sofa(len, fabric = 'fabricGrey') {
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

export function table(w, d, h, top = 'woodLight', legs = 'woodLight') {
  const g = group(box(w, 0.04, d, top, 0, h - 0.04, 0, { rounded: 0.015 }));
  const lx = w / 2 - 0.06, lz = d / 2 - 0.06;
  for (const [x, z] of [[-lx, -lz], [lx, -lz], [-lx, lz], [lx, lz]]) g.add(box(0.05, h - 0.04, 0.05, legs, x, 0, z));
  return g;
}

export function cabinet(w, h, d, m = 'woodWhite', doors = 2) {
  const g = group(box(w, h, d, m, 0, 0, 0, { rounded: 0.01 }));
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + (w / doors) * (i + 0.5);
    g.add(box(0.012, h - 0.04, 0.005, 'darkMetal', x + (w / doors) / 2 - 0.003, 0.02, d / 2 + 0.002, { cast: false }));
    g.add(box(0.12, 0.02, 0.025, 'metal', x + (i % 2 ? -1 : 1) * (w / doors / 2 - 0.08), h * 0.55, d / 2 + 0.012, { cast: false }));
  }
  return g;
}

export function plant(scale = 1) {
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

export function books(w) {
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

export function bookshelf(w, h) {
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

export function rug(w, d, m = 'rug') {
  const geo = new THREE.PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat(m));
  mesh.position.y = 0.018;
  mesh.receiveShadow = true;
  return mesh;
}

export function armchair(fabric = 'fabricBeige') {
  return group(
    box(0.8, 0.4, 0.8, fabric, 0, 0.05, 0, { rounded: 0.08 }),
    box(0.8, 0.5, 0.18, fabric, 0, 0.4, -0.31, { rounded: 0.08 }),
    box(0.15, 0.3, 0.8, fabric, -0.33, 0.4, 0, { rounded: 0.06 }),
    box(0.15, 0.3, 0.8, fabric, 0.33, 0.4, 0, { rounded: 0.06 }),
  );
}

export function officeChair() {
  const g = group(
    box(0.45, 0.06, 0.45, 'fabricBlue', 0, 0.45, 0, { rounded: 0.02 }),
    box(0.42, 0.45, 0.05, 'fabricBlue', 0, 0.55, -0.2, { rounded: 0.02 }),
    cylinder(0.025, 0.025, 0.4, 'darkMetal', 0, 0.05, 0, 8),
  );
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; g.add(box(0.28, 0.03, 0.04, 'darkMetal', Math.cos(a) * 0.14, 0.03, Math.sin(a) * 0.14)); g.children.at(-1).rotation.y = -a; }
  return g;
}

export function grabBar(len, vertical = false) {
  const geo = new THREE.CylinderGeometry(0.018, 0.018, len, 10);
  const m = new THREE.Mesh(geo, mat('metal'));
  if (!vertical) m.rotation.z = Math.PI / 2;
  m.castShadow = true;
  return m;
}

// 靠墙安装的连续扶手（走廊、卫生间）。x0/x1 为沿墙起止，axis 为墙方向
export function wallRail(g, pts, y = 0.85) {
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

export function continuousHallwayRail() {
  const g = new THREE.Group();
  for (const pts of [
    [[-7.8, -0.86], [-7.4, -0.86]],
    [[-6.2, -0.86], [-4.5, -0.86]],
    [[-3.3, -0.86], [-2.3, -0.86]],
    [[5.2, -0.86], [7.8, -0.86]],
  ]) wallRail(g, pts);
  return g;
}

// 装饰画：画框 + 用 Canvas 生成的抽象画
export function painting(w, h, seed) {
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

export function bathtub() {
  const g = new THREE.Group();
  g.add(box(1.7, 0.55, 0.75, 'ceramic', 0, 0, 0, { rounded: 0.08 }));
  const inner = box(1.5, 0.05, 0.55, mat('water'), 0, 0.42, 0, { cast: false });
  g.add(inner);
  g.add(cylinder(0.02, 0.02, 0.25, 'metal', -0.7, 0.55, -0.3, 8));
  return g;
}

export function washer() {
  const g = group(box(0.6, 0.85, 0.6, 'whiteGloss', 0, 0, 0, { rounded: 0.03 }));
  const door = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.03, 8, 24), mat('metal'));
  door.position.set(0, 0.4, 0.31); g.add(door);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), mat('glass')); glass.position.set(0, 0.4, 0.305); g.add(glass);
  g.add(box(0.5, 0.06, 0.02, 'blackPlastic', 0, 0.74, 0.3, { cast: false }));
  return g;
}

export function stool() {
  return group(cylinder(0.18, 0.18, 0.05, 'leather', 0, 0.62, 0, 16), cylinder(0.025, 0.025, 0.62, 'darkMetal', 0, 0, 0, 8), cylinder(0.16, 0.16, 0.02, 'darkMetal', 0, 0, 0, 16));
}

export function deskLamp() {
  const g = group(cylinder(0.07, 0.07, 0.02, 'darkMetal'), cylinder(0.01, 0.01, 0.4, 'darkMetal', 0, 0.02, 0, 6));
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.12, 16, 1, true), mat('whiteGloss'));
  shade.position.set(0, 0.45, 0); g.add(shade);
  return g;
}

/** Prebuilt compound items keep geometry construction out of the house layout. */
export function coffeeTable() {
  const g = group(
    box(1.2, 0.05, 0.6, 'woodLight', 0, 0.38, 0, { rounded: 0.025 }),
    box(1.1, 0.03, 0.5, 'woodLight', 0, 0.1, 0, { rounded: 0.015 }),
  );
  for (const [x, z] of [[-0.55, -0.25], [0.55, -0.25], [-0.55, 0.25], [0.55, 0.25]]) g.add(cylinder(0.02, 0.02, 0.38, 'darkMetal', x, 0, z, 8));
  return g;
}

export function tvPartition() {
  return group(
    box(0.4, 0.55, 2.4, 'woodDark', 0, 0, 0, { rounded: 0.02 }),
    box(0.12, 1.6, 2.4, 'woodPanel', 0.14, 0.55, 0),
  );
}

export function southKitchenCounter() {
  const g = group(cabinet(3.8, 0.86, 0.6, 'woodWhite', 6), box(3.82, 0.04, 0.62, 'marble', 0, 0.86, 0));
  g.add(box(0.7, 0.005, 0.42, 'darkMetal', 0.2, 0.9, 0, { cast: false }));
  g.add(cylinder(0.015, 0.015, 0.3, 'metal', 0.2, 0.9, -0.22, 8));
  return g;
}

export function eastKitchenCounter() {
  return group(cabinet(3.1, 0.86, 0.6, 'woodWhite', 5), box(3.12, 0.04, 0.62, 'marble', 0, 0.86, 0));
}

export function cooktop() {
  const g = group(box(0.7, 0.02, 0.45, 'blackPlastic'));
  for (const dx of [-0.17, 0.17]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.012, 6, 20), mat('darkMetal'));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(dx, 0.03, 0);
    g.add(ring);
  }
  return g;
}

export function rangeHood() {
  return group(box(0.5, 0.35, 0.7, 'metal'), box(0.25, 0.6, 0.3, 'metal', 0.12, 0.35, 0));
}

export function refrigerator() {
  return group(
    box(0.72, 1.85, 0.68, 'metal', 0, 0, 0, { rounded: 0.03 }),
    box(0.02, 0.6, 0.03, 'darkMetal', 0.3, 0.9, 0.35),
  );
}

export function kitchenUpperCabinet() { return cabinet(2.6, 0.7, 0.35, 'woodWhite', 4); }

export function kitchenIsland() {
  return group(cabinet(1.6, 0.86, 0.7, 'woodDark', 2), box(1.7, 0.04, 0.8, 'marble', 0, 0.86, 0));
}

export function showerZone() {
  const g = new THREE.Group();
  g.add(box(1.3, 0.02, 1.2, 'bathTile', 0, 0.012, 0, { cast: false }));
  g.add(box(0.02, 2.0, 1.2, 'glass', 0.65, 0, 0, { cast: false }));
  g.add(box(0.45, 0.04, 0.35, 'woodLight', -0.35, 0.45, -0.38), box(0.05, 0.45, 0.05, 'metal', -0.35, 0, -0.38));
  const safetyBar = grabBar(0.8);
  safetyBar.position.set(0.1, 0.9, -0.58);
  g.add(safetyBar);
  g.add(cylinder(0.1, 0.1, 0.02, 'metal', -0.3, 2.1, -0.3), cylinder(0.01, 0.01, 0.9, 'metal', -0.3, 1.2, -0.58, 6));
  return g;
}

export function bathroomVanity() {
  return group(
    cabinet(0.8, 0.8, 0.5, 'woodWhite', 2),
    box(0.82, 0.04, 0.52, 'ceramic', 0, 0.8, 0),
    cylinder(0.18, 0.15, 0.1, 'ceramic', 0, 0.84, 0),
  );
}

export function laundrySink() {
  return group(cabinet(0.9, 0.85, 0.55, 'woodWhite', 2), box(0.92, 0.04, 0.57, 'marble', 0, 0.85, 0));
}

export function vanityWithMirror() {
  return group(cabinet(1.0, 0.75, 0.45, 'woodLight', 2), box(0.02, 0.7, 0.5, 'mirror', -0.2, 0.9, 0));
}

export function familyTvStand() {
  return group(box(0.4, 0.5, 2.0, 'woodLight'), box(0.05, 0.8, 1.4, 'blackPlastic', 0.05, 0.9, 0));
}

export function bedGuard() { return box(0.05, 0.3, 1.2, 'woodLight'); }
export function toyBox() { return box(0.7, 0.4, 0.45, 'fabricGreen', 0, 0, 0, { rounded: 0.08 }); }
export function wallMirror() { return box(0.02, 0.8, 0.7, 'mirror', 0, 0, 0, { cast: false }); }



export const furnitureFactories = {
  bed, sofa, table, cabinet, plant, books, bookshelf, rug, armchair, officeChair,
  grabBar, wallRail: (pts, y) => { const g = new THREE.Group(); wallRail(g, pts, y); return g; },
  painting, bathtub, washer, stool, deskLamp,
  coffeeTable, tvPartition, southKitchenCounter, eastKitchenCounter, cooktop, rangeHood, refrigerator,
  kitchenUpperCabinet, kitchenIsland, showerZone, bathroomVanity, laundrySink, vanityWithMirror,
  familyTvStand, bedGuard, toyBox, wallMirror, continuousHallwayRail,
  diningChair: () => models().chair.clone(),
  toilet: () => models().toilet.clone(),
};

/** Representative arguments for every public furniture factory, used by the standalone inspector. */
export const furniturePreviewSamples: ReadonlyArray<{
  kind: FurnitureKind;
  label: string;
  args: unknown[];
}> = [
  { kind: 'bed', label: '床', args: [1.6, 2, 'fabricBlue'] },
  { kind: 'sofa', label: '沙发', args: [2.6] },
  { kind: 'table', label: '桌子', args: [1.4, 0.8, 0.75] },
  { kind: 'cabinet', label: '柜体', args: [1.2, 1.8, 0.45] },
  { kind: 'plant', label: '绿植', args: [1] },
  { kind: 'books', label: '书本', args: [1] },
  { kind: 'bookshelf', label: '书架', args: [1.2, 1.8] },
  { kind: 'rug', label: '地毯', args: [2, 1.4] },
  { kind: 'armchair', label: '扶手椅', args: [] },
  { kind: 'officeChair', label: '办公椅', args: [] },
  { kind: 'grabBar', label: '安全抓杆', args: [0.9] },
  { kind: 'wallRail', label: '墙面扶手', args: [[[0, 0], [1.2, 0]], 0.85] },
  { kind: 'painting', label: '装饰画', args: [1.2, 0.8, 1] },
  { kind: 'bathtub', label: '浴缸', args: [] },
  { kind: 'washer', label: '洗衣机', args: [] },
  { kind: 'stool', label: '凳子', args: [] },
  { kind: 'deskLamp', label: '台灯', args: [] },
  { kind: 'diningChair', label: '餐椅', args: [] },
  { kind: 'toilet', label: '坐便器', args: [] },
  { kind: 'coffeeTable', label: '茶几', args: [] },
  { kind: 'tvPartition', label: '电视背景墙隔断', args: [] },
  { kind: 'southKitchenCounter', label: '南侧橱柜与水槽', args: [] },
  { kind: 'eastKitchenCounter', label: '东侧橱柜', args: [] },
  { kind: 'cooktop', label: '燃气灶', args: [] },
  { kind: 'rangeHood', label: '油烟机', args: [] },
  { kind: 'refrigerator', label: '冰箱', args: [] },
  { kind: 'kitchenUpperCabinet', label: '吊柜', args: [] },
  { kind: 'kitchenIsland', label: '中岛台', args: [] },
  { kind: 'showerZone', label: '无障碍淋浴区', args: [] },
  { kind: 'bathroomVanity', label: '洗手台', args: [] },
  { kind: 'laundrySink', label: '洗衣池', args: [] },
  { kind: 'vanityWithMirror', label: '梳妆台', args: [] },
  { kind: 'familyTvStand', label: '电视柜', args: [] },
  { kind: 'bedGuard', label: '床侧护栏', args: [] },
  { kind: 'toyBox', label: '软包玩具箱', args: [] },
  { kind: 'wallMirror', label: '墙镜', args: [] },
  { kind: 'continuousHallwayRail', label: '走廊连续扶手', args: [] },
];

const previewKinds = new Set(furniturePreviewSamples.map((sample) => sample.kind));
const missingFurniturePreviews = Object.keys(furnitureFactories).filter((kind) => !previewKinds.has(kind as FurnitureKind));
if (missingFurniturePreviews.length || previewKinds.size !== furniturePreviewSamples.length) {
  throw new Error(`Furniture catalog preview coverage mismatch: ${missingFurniturePreviews.join(', ') || 'duplicate sample kind'}`);
}

export function createFurnitureGeometry(kind: FurnitureKind | string, config: FurnitureFactoryConfig = {}) {
  const factory = furnitureFactories[kind];
  if (!factory) throw new Error(`Unknown furniture factory: ${kind}`);
  return factory(...(config.args ?? []));
}
