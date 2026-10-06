// 场景搭建的公共工具：材质库、按世界尺寸设置 UV、快速创建盒子、给物体登记"可点击信息"。
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { getTexture, getNormal } from './textures.js';

// 剖切平面：只保留 y < constant 的部分。分层查看时修改 constant 就能"切掉"房屋上半部分看内部
export const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100);

/**
 * 按世界尺寸设置盒子的 UV：BoxGeometry 默认每个面的 UV 都是 0~1，
 * 贴到长 5 米和长 0.5 米的面上纹理大小会差 10 倍（被拉伸）。
 * 这里把每个面的 UV 乘以该面的真实边长 / 贴图代表的边长，使纹理密度处处相同。
 * BoxGeometry 的 6 个面依次是 +x, -x, +y, -y, +z, -z，每个面 4 个顶点。
 */
export function worldBoxUV(geo, w, h, d, tile = 1) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  const faceSize = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const perFace = uv.count / 6;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < perFace; k++) {
      const i = f * perFace + k;
      uv.setXY(i, uv.getX(i) * faceSize[f][0] / tile, uv.getY(i) * faceSize[f][1] / tile);
    }
  }
  uv.needsUpdate = true;
  return geo;
}

/** 平面（PlaneGeometry）的 UV 同样按真实尺寸缩放 */
export function worldPlaneUV(geo, w, h, tile = 1) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tile);
  uv.needsUpdate = true;
  return geo;
}

// ---------------- 材质库 ----------------
// name -> 参数。map 是 textures.js 里的纹理名，它自带 worldSize，用来算 UV 缩放。
const defs = {
  wallPaint: { map: 'wallPaint', color: 0xffffff, roughness: 0.92, section: true },
  wallExterior: { map: 'exteriorWall', normal: 3, color: 0xffffff, roughness: 0.85, section: true },
  wallRender: { map: 'render', normal: 1.2, color: 0xffffff, roughness: 0.9, section: true },
  plinth: { map: 'granite', normal: 1.5, color: 0xffffff, roughness: 0.6, section: true },
  roofTiles: { map: 'roofTiles', normal: 4, color: 0xffffff, roughness: 0.75, section: true },
  fascia: { color: 0xf2efe8, roughness: 0.6, section: true },
  trim: { color: 0xf4f2ec, roughness: 0.5, section: true },
  skirting: { color: 0x7a5a40, roughness: 0.6, section: true },
  woodPanel: { map: 'woodPanel', normal: 1.5, color: 0xffffff, roughness: 0.6, section: true },
  leather: { map: 'leather', color: 0x6b4630, roughness: 0.5 },
  concrete: { color: 0xb9b5ae, roughness: 0.95, section: true },
  carPaint: { color: 0x9c1f24, roughness: 0.25, metalness: 0.6 },
  tyre: { color: 0x1a1a1a, roughness: 0.9 },
  wallKitchen: { map: 'bathTile', normal: 2, color: 0xf4f1ea, roughness: 0.4, section: true },
  woodFloor: { map: 'woodFloor', normal: 1.5, color: 0xffffff, roughness: 0.55 },
  tileFloor: { map: 'tileFloor', normal: 1, color: 0xffffff, roughness: 0.3 },
  bathTile: { map: 'bathTile', normal: 2, color: 0xffffff, roughness: 0.45 },
  grass: { map: 'grass', color: 0xc9d3b4, roughness: 1 },
  paving: { map: 'paving', normal: 3, color: 0xffffff, roughness: 0.9 },
  deck: { map: 'deck', normal: 2, color: 0xffffff, roughness: 0.8 },
  asphalt: { map: 'asphalt', color: 0xffffff, roughness: 0.95 },
  roof: { map: 'roof', color: 0xffffff, roughness: 0.9, section: true },
  slab: { color: 0xd8d4cc, roughness: 0.9, section: true },
  ceiling: { color: 0xf7f5f0, roughness: 1, section: true },
  frame: { color: 0x3a3d42, roughness: 0.4, metalness: 0.6, section: true },
  woodLight: { map: 'woodGrain', color: 0xd9b48a, roughness: 0.6 },
  woodDark: { map: 'woodGrain', color: 0x7a5236, roughness: 0.55 },
  woodWhite: { map: 'woodGrain', color: 0xf0ebe3, roughness: 0.5 },
  fabricGrey: { map: 'fabric', color: 0x8d9299, roughness: 0.95 },
  fabricBeige: { map: 'fabric', color: 0xd8c9ad, roughness: 0.95 },
  fabricBlue: { map: 'fabric', color: 0x5d7ea8, roughness: 0.95 },
  fabricWhite: { map: 'fabric', color: 0xf5f3ee, roughness: 0.95 },
  fabricPink: { map: 'fabric', color: 0xe8b7b5, roughness: 0.95 },
  fabricGreen: { map: 'fabric', color: 0x8fae8b, roughness: 0.95 },
  curtain: { map: 'fabric', color: 0xcbbfa6, roughness: 0.95, side: THREE.DoubleSide },
  rug: { map: 'rug', color: 0xffffff, roughness: 1 },
  marble: { map: 'marble', color: 0xffffff, roughness: 0.25 },
  metal: { color: 0xb8bcc2, roughness: 0.3, metalness: 0.9 },
  darkMetal: { color: 0x2b2e33, roughness: 0.4, metalness: 0.7 },
  whiteGloss: { color: 0xf4f4f2, roughness: 0.2 },
  ceramic: { color: 0xfafafa, roughness: 0.12 },
  plastic: { color: 0xeeeeee, roughness: 0.5 },
  blackPlastic: { color: 0x1b1c1e, roughness: 0.35 },
  red: { color: 0xc4231c, roughness: 0.4 },
  leaf: { color: 0x4d7a3a, roughness: 0.8 },
  leafDark: { color: 0x365c2c, roughness: 0.85 },
  bark: { map: 'bark', normal: 3, color: 0xffffff, roughness: 1 },
  soil: { color: 0x4a3526, roughness: 1 },
  solar: { map: 'solarPanel', color: 0xffffff, roughness: 0.18, metalness: 0.3 },
  mirror: { color: 0xdfe8ee, roughness: 0.02, metalness: 1 },
  glass: { color: 0xa9c9d8, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false, section: true, side: THREE.DoubleSide },
  water: { color: 0x3d7ea6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8 },
  stone: { map: 'exteriorWall', normal: 3, color: 0xbdb6aa, roughness: 0.9 },
};
const mats = new Map();
const sharedMaterials = new WeakSet();
const sharedGeometries = new WeakSet();
const sharedTextures = new WeakSet();

/** 取材质（同名共享一个实例）。带 section 标记的建筑材质会被剖切平面裁剪 */
export function mat(name) {
  if (mats.has(name)) return mats.get(name);
  const d = defs[name];
  if (!d) throw new Error('未知材质: ' + name);
  const { map, section, normal, ...rest } = d;
  const m = new THREE.MeshStandardMaterial(rest);
  if (map) { m.map = getTexture(map); sharedTextures.add(m.map); }
  if (map && normal) { m.normalMap = getNormal(map, normal); sharedTextures.add(m.normalMap); } // 法线贴图：凹凸质感
  if (section) {
    m.clippingPlanes = [sectionPlane];
    m.side = THREE.DoubleSide; // 剖切后能看到墙体内侧，截面看起来是实心的
  }
  m.name = name;
  sharedMaterials.add(m);
  mats.set(name, m);
  return m;
}

/** Mark cached model resources as shared so disposing one clone cannot break other instances. */
export function markSharedResources(root) {
  root.traverse((object) => {
    if (object.geometry) sharedGeometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) {
      if (material) {
        sharedMaterials.add(material);
        for (const value of Object.values(material)) if (value?.isTexture) sharedTextures.add(value);
      }
    }
  });
  return root;
}

export function markSharedTexture(texture) {
  if (texture) sharedTextures.add(texture);
  return texture;
}

export function isSharedMaterial(material) { return sharedMaterials.has(material); }
export function isSharedGeometry(geometry) { return sharedGeometries.has(geometry); }
export function isSharedTexture(texture) { return sharedTextures.has(texture); }

/** 该材质贴图对应的世界尺寸（米），没有贴图时返回 1 */
export function tileOf(material) {
  return material.map?.userData.worldSize ?? 1;
}

/** 新建一个不共享的材质（需要单独改颜色/亮度的物体，如灯、状态灯） */
export function uniqueMat(params) {
  return new THREE.MeshStandardMaterial(params);
}

/**
 * 创建盒子。x,y,z 是盒子"底面中心"的位置（摆家具时更直观），材质可以是名字或材质对象，
 * 也可以是 6 个面的材质数组。
 */
export function box(w, h, d, material, x = 0, y = 0, z = 0, { rounded = 0, cast = true, receive = true } = {}) {
  const m = Array.isArray(material) ? material.map((k) => (typeof k === 'string' ? mat(k) : k)) : typeof material === 'string' ? mat(material) : material;
  const first = Array.isArray(m) ? m[0] : m;
  const geo = rounded > 0 ? new RoundedBoxGeometry(w, h, d, 2, Math.min(rounded, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  if (!rounded) worldBoxUV(geo, w, h, d, tileOf(first));
  else scaleAllUV(geo, Math.max(w, d) / tileOf(first), h / tileOf(first));
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
}

function scaleAllUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** 圆柱。x,y,z 为底面中心 */
export function cylinder(rTop, rBottom, h, material, x = 0, y = 0, z = 0, seg = 24) {
  const m = typeof material === 'string' ? mat(material) : material;
  const geo = new THREE.CylinderGeometry(rTop, rBottom, h, seg);
  scaleAllUV(geo, (Math.PI * 2 * Math.max(rTop, rBottom)) / tileOf(m), h / tileOf(m));
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y + h / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/**
 * 给物体登记"可点击信息"。点击场景中的物体时，会沿父节点向上找到第一个带 info 的对象并显示。
 * info: { name, category, func, status: 'normal'|'warning'|'fault', maintain, room, data, controls }
 */
export function setInfo(obj, info) {
  obj.userData.info = { status: 'normal', ...info };
  return obj;
}

/** 物体的包围盒底面投影（用于导航网格标记障碍） */
export function footprint(obj, pad = 0) {
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  return { x0: b.min.x - pad, x1: b.max.x + pad, z0: b.min.z - pad, z1: b.max.z + pad, y0: b.min.y, y1: b.max.y };
}
