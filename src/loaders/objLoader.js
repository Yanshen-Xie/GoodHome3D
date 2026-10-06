// 自己实现的 OBJ / MTL 模型解析器。
// OBJ 是文本格式，每行一条记录：
//   v  x y z        顶点坐标
//   vt u v          纹理坐标
//   vn x y z        法线
//   f  a/b/c ...    一个多边形面，每个角写成 "顶点号/纹理号/法线号"（从 1 开始，负数表示倒数第几个）
//   usemtl 名称     之后的面使用哪个材质
//   o / g 名称      物体 / 分组名
// MTL 是配套的材质文件：newmtl 名称、Kd 漫反射颜色、Ks 高光颜色、Ns 高光指数、d 透明度、map_Kd 颜色贴图。
import * as THREE from 'three';
import { getTexture } from '../scene/textures.js';

/** 解析 MTL 文本，返回 { 材质名: {Kd, Ks, Ns, d, map_Kd} } */
export function parseMTL(text) {
  const out = {};
  let cur = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'newmtl') { cur = out[rest[0]] = { name: rest[0] }; continue; }
    if (!cur) continue;
    if (key === 'Kd' || key === 'Ks' || key === 'Ka') cur[key] = rest.map(Number);
    else if (key === 'Ns' || key === 'd') cur[key] = Number(rest[0]);
    else if (key === 'Tr') cur.d = 1 - Number(rest[0]);
    else if (key === 'map_Kd') cur.map_Kd = rest.join(' ');
  }
  return out;
}

/**
 * 把 MTL 材质转换成 three.js 的 PBR 材质。
 * Phong 模型的高光指数 Ns（0~1000）越大表面越光滑，这里换算成粗糙度 roughness = sqrt(2/(Ns+2))。
 * 贴图文件名（如 woodGrain.png）映射到本系统的程序化纹理。
 */
export function toMaterial(m) {
  const params = {
    color: new THREE.Color().setRGB(...(m.Kd ?? [0.8, 0.8, 0.8]), THREE.SRGBColorSpace),
    roughness: Math.min(1, Math.sqrt(2 / ((m.Ns ?? 10) + 2))),
    metalness: m.Ks && m.Ks[0] > 0.9 && (m.Ns ?? 0) > 300 ? 0.9 : 0,
  };
  if (m.d !== undefined && m.d < 1) { params.transparent = true; params.opacity = m.d; }
  const mat = new THREE.MeshStandardMaterial(params);
  if (m.map_Kd) {
    const name = m.map_Kd.replace(/\.[a-z]+$/i, '');
    try { mat.map = getTexture(name); } catch { /* 找不到对应纹理就只用颜色 */ }
  }
  mat.name = m.name;
  return mat;
}

/**
 * 解析 OBJ 文本，返回一个 Group，每种材质生成一个 Mesh。
 * 多边形面按"扇形"拆成三角形：(v0,v1,v2), (v0,v2,v3), ...
 */
export function parseOBJ(text, mtl = {}) {
  const P = [], T = [], N = [];
  const buckets = new Map(); // 材质名 -> { pos:[], uv:[], nor:[] }
  let current = 'default';
  const bucket = () => {
    if (!buckets.has(current)) buckets.set(current, { pos: [], uv: [], nor: [] });
    return buckets.get(current);
  };
  const ref = (s, arrLen) => { const i = parseInt(s, 10); return i < 0 ? arrLen + i : i - 1; };

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0];
    if (key === 'v') P.push(+parts[1], +parts[2], +parts[3]);
    else if (key === 'vt') T.push(+parts[1], +parts[2]);
    else if (key === 'vn') N.push(+parts[1], +parts[2], +parts[3]);
    else if (key === 'usemtl') current = parts[1];
    else if (key === 'f') {
      const corners = parts.slice(1).map((c) => {
        const [v, t, n] = c.split('/');
        return {
          v: ref(v, P.length / 3),
          t: t ? ref(t, T.length / 2) : -1,
          n: n ? ref(n, N.length / 3) : -1,
        };
      });
      const b = bucket();
      for (let k = 1; k + 1 < corners.length; k++) {
        for (const c of [corners[0], corners[k], corners[k + 1]]) {
          b.pos.push(P[c.v * 3], P[c.v * 3 + 1], P[c.v * 3 + 2]);
          if (c.t >= 0) b.uv.push(T[c.t * 2], T[c.t * 2 + 1]); else b.uv.push(0, 0);
          if (c.n >= 0) b.nor.push(N[c.n * 3], N[c.n * 3 + 1], N[c.n * 3 + 2]);
        }
      }
    }
  }

  const group = new THREE.Group();
  for (const [name, b] of buckets) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    // 文件里给了法线就用文件的（每个顶点一个），否则按三角形自动计算
    if (b.nor.length === b.pos.length) geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
    else geo.computeVertexNormals();
    const material = mtl[name] ? toMaterial(mtl[name]) : new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  group.userData.stats = { vertices: P.length / 3, triangles: [...buckets.values()].reduce((s, b) => s + b.pos.length / 9, 0), materials: buckets.size };
  return group;
}

/** 加载一个 OBJ 模型（OBJ 文本 + MTL 文本），返回可反复 clone 的模板 */
export function loadOBJ(objText, mtlText) {
  return parseOBJ(objText, parseMTL(mtlText ?? ''));
}
