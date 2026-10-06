// 静态几何合并：减少绘制调用（draw call）。
// 一件家具通常由十几个盒子、圆柱组成，每个都是一次绘制调用；把"同一件物体里、使用同一种材质"的网格
// 合并成一个网格后，绘制调用数量大幅减少，而每件物体仍然是独立的对象，点击选择、信息卡片都不受影响。
// 会运动的物体（门扇、窗扇、窗帘、电梯、人物）不合并。
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// 取出多材质网格中某一个材质组对应的那部分几何体（转成非索引几何体后按顶点范围截取）
function subGeometry(geo, start, count) {
  const g = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'uv']) {
    const a = geo.attributes[name];
    if (!a) continue;
    g.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return g;
}

function normalizeAttrs(g) {
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  return g;
}

/** 把 unit 下面的所有网格按材质合并，合并后的网格挂在 unit 下 */
export function mergeUnit(unit) {
  unit.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(unit.matrixWorld).invert();
  const buckets = new Map(); // 材质 → { geos, cast, receive }
  const remove = [];
  const found = [];
  // 递归收集：会运动的部分（dynamic）、实例化网格、隐藏的网格整棵跳过，保持原样
  const collect = (o) => {
    for (const c of o.children) {
      if (c.userData.dynamic || c.isSkinnedMesh || c.isPoints || c.isLine || c.isInstancedMesh || !c.visible) continue;
      if (c.isMesh) found.push(c);
      collect(c);
    }
  };
  collect(unit);
  for (const o of found) {
    const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    const base = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    const parts = Array.isArray(o.material)
      ? (o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: base.attributes.position.count, materialIndex: 0 }]).map((gr) => [o.material[gr.materialIndex], subGeometry(base, gr.start, gr.count)])
      : [[o.material, base]];
    for (const [mat, g] of parts) {
      normalizeAttrs(g).applyMatrix4(m);
      if (!buckets.has(mat)) buckets.set(mat, { geos: [], cast: false, receive: false, order: o.renderOrder });
      const b = buckets.get(mat);
      b.geos.push(g); b.cast ||= o.castShadow; b.receive ||= o.receiveShadow;
    }
    remove.push(o);
  }
  if (remove.length < 2) return 0;
  // 被合并的网格如果还有子物体（如会动的部件），把子物体保留下来挂到原父节点上
  for (const o of remove) {
    for (const c of [...o.children]) o.parent.attach(c);
    o.parent.remove(o);
  }
  for (const [mat, b] of buckets) {
    const merged = mergeGeometries(b.geos, false);
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = b.receive; mesh.renderOrder = b.order;
    unit.add(mesh);
  }
  return remove.length - buckets.size;
}

/**
 * 在 root 下找"可合并的单元"：带信息（可点击）的物体，或者没有信息的普通分组。
 * 单元内部不能再嵌套带信息的物体，也不能有会运动的部分。
 */
export function mergeStatic(root) {
  let saved = 0;
  const hasInfoInside = (o) => { let f = false; o.traverse((c) => { if (c !== o && c.userData.info) f = true; }); return f; };
  const visit = (o) => {
    if (o.userData.dynamic) return;
    if ((o.userData.info || o.isGroup) && o !== root && !hasInfoInside(o) && o.children.length > 1) { saved += mergeUnit(o); return; }
    for (const c of [...o.children]) visit(c);
    // 这一层直接挂着的零散小网格（没有信息，如踢脚线、窗套）按材质合并成一组
    const loose = o.children.filter((c) => c.isMesh && !c.userData.info && !c.userData.dynamic && c.children.length === 0 && c.visible);
    if (loose.length > 1) {
      const g = new THREE.Group();
      o.add(g);
      for (const c of loose) g.attach(c);
      saved += mergeUnit(g);
    }
  };
  visit(root);
  return saved;
}
