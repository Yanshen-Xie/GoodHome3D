// 房屋主体（两层）：地面与楼板、墙体（自动开门窗洞、踢脚线、勒脚、窗套）、门窗、楼梯、电梯井、阳台、坡屋顶、檐沟与落水管。
import * as THREE from 'three';
import { ROOMS, WALLS, WALL_T, EXT, FLOORS, FLOOR_H, SLAB_T, EAVE_Y, ROOF_PITCH, STAIR, ELEVATOR, roomAt } from './layout.js';
import { mat, box, cylinder, setInfo, tileOf } from './common.js';

/**
 * 按世界坐标设置 UV（平面投影）：法线朝 ±y 的面用 (x,z)，朝 ±x 的用 (z,y)，其余用 (x,y)。
 * 同一面墙被门窗切成几块后，纹理在各块之间仍然连续；任意几何体都适用。
 * tileOf(i) 返回第 i 个材质组的贴图尺寸。
 */
function projectUV(mesh, tileOfGroup) {
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry;
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  const v = new THREE.Vector3(), n = new THREE.Vector3();
  const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  const groupOf = new Int32Array(pos.count);
  if (geo.groups.length) for (const g of geo.groups) {
    const idx = geo.index;
    for (let k = g.start; k < g.start + g.count; k++) groupOf[idx ? idx.getX(k) : k] = g.materialIndex;
  }
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    n.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize();
    const t = tileOfGroup(groupOf[i]);
    if (Math.abs(n.y) > 0.6) uv.setXY(i, v.x / t, v.z / t);
    else if (Math.abs(n.x) > Math.abs(n.z)) uv.setXY(i, v.z / t, v.y / t);
    else uv.setXY(i, v.x / t, v.y / t);
  }
  uv.needsUpdate = true;
}

// 墙面某一侧朝向哪里，决定这一侧用什么材质
function sideMaterial(px, pz, floor) {
  const r = roomAt(px, pz, floor);
  if (!r || r.outdoor) return floor === 0 ? 'wallExterior' : 'wallRender';
  if (r.id === 'kitchen' || r.id.startsWith('bath')) return 'wallKitchen';
  if (r.id === 'living' || r.id === 'master' || r.id === 'family') return 'wallPaint';
  return 'wallPaint';
}

export function buildHouse(nav) {
  const root = new THREE.Group();
  root.name = 'house';
  const walls = new THREE.Group(); walls.name = 'walls';
  const floors = new THREE.Group(); floors.name = 'floors';
  const openingsGroup = new THREE.Group(); openingsGroup.name = 'openings';
  const details = new THREE.Group(); details.name = 'details';
  root.add(walls, floors, openingsGroup, details);
  const windows: Record<string, any> = {}, doors: Record<string, any> = {};

  // ---------------- 地面（每个房间一块，二层楼梯厅开洞） ----------------
  for (const r of ROOMS) {
    const y0 = FLOORS[r.floor].y;
    const m = mat(r.fl);
    let geo;
    const shape = new THREE.Shape([new THREE.Vector2(r.x0, r.z0), new THREE.Vector2(r.x1, r.z0), new THREE.Vector2(r.x1, r.z1), new THREE.Vector2(r.x0, r.z1)]);
    if (r.id === 'stair2') {
      // 楼梯洞口和电梯井不铺地面
      const h = STAIR.hole, e = ELEVATOR;
      shape.holes.push(new THREE.Path([new THREE.Vector2(h.x0, h.z0), new THREE.Vector2(h.x0, h.z1), new THREE.Vector2(h.x1, h.z1), new THREE.Vector2(h.x1, h.z0)]));
      shape.holes.push(new THREE.Path([new THREE.Vector2(e.x0, e.z0), new THREE.Vector2(e.x0, e.z1), new THREE.Vector2(e.x1, e.z1), new THREE.Vector2(e.x1, e.z0)]));
    }
    if (r.id === 'stair1') {
      const e = ELEVATOR;
      shape.holes.push(new THREE.Path([new THREE.Vector2(e.x0, e.z0), new THREE.Vector2(e.x0, e.z1), new THREE.Vector2(e.x1, e.z1), new THREE.Vector2(e.x1, e.z0)]));
    }
    geo = new THREE.ShapeGeometry(shape);
    geo.rotateX(Math.PI / 2); // 形状在 xy 平面，转到 xz 平面（shape 的 y → 世界 z）
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.y = y0 + 0.012;
    const uv = geo.attributes.uv, pos = geo.attributes.position, t = tileOf(m);
    for (let i = 0; i < pos.count; i++) uv.setXY(i, pos.getX(i) / t, -pos.getZ(i) / t);
    mesh.material = m.clone(); mesh.material.side = THREE.DoubleSide; // ShapeGeometry 旋转后法线朝下，用双面材质
    mesh.material.clippingPlanes = m.clippingPlanes;
    mesh.receiveShadow = true;
    mesh.userData.room = r.id;
    setInfo(mesh, { name: r.name + '地面', category: '地面', room: r.id, func: r.fl === 'bathTile' ? '防滑地砖，与相邻房间无高差，便于轮椅通行' : '同层地面无门槛、无高差，便于轮椅和助行器通行', maintain: '地面平整，无破损' });
    floors.add(mesh);
  }
  // 一层地基（勒脚以下）
  floors.add(box(EXT.x1 - EXT.x0 + 0.4, 0.3, EXT.z1 - EXT.z0 + 0.4, 'plinth', 0, -0.29, 0, { cast: false }));

  // ---------------- 楼板：二层楼板（开楼梯洞、电梯井洞）、二层顶板 ----------------
  const slabShape = (withHoles) => {
    const s = new THREE.Shape([new THREE.Vector2(EXT.x0 - 0.1, EXT.z0 - 0.1), new THREE.Vector2(EXT.x1 + 0.1, EXT.z0 - 0.1), new THREE.Vector2(EXT.x1 + 0.1, EXT.z1 + 0.1), new THREE.Vector2(EXT.x0 - 0.1, EXT.z1 + 0.1)]);
    if (withHoles) {
      const h = STAIR.hole, e = ELEVATOR;
      s.holes.push(new THREE.Path([new THREE.Vector2(h.x0, h.z0), new THREE.Vector2(h.x0, h.z1), new THREE.Vector2(h.x1, h.z1), new THREE.Vector2(h.x1, h.z0)]));
      s.holes.push(new THREE.Path([new THREE.Vector2(e.x0, e.z0), new THREE.Vector2(e.x0, e.z1), new THREE.Vector2(e.x1, e.z1), new THREE.Vector2(e.x1, e.z0)]));
    }
    return s;
  };
  const makeSlab = (y, withHoles, name) => {
    const geo = new THREE.ExtrudeGeometry(slabShape(withHoles), { depth: SLAB_T, bevelEnabled: false });
    geo.rotateX(Math.PI / 2); // 挤出方向 +z → 世界 -y；形状 y → 世界 z
    const m = new THREE.Mesh(geo, [mat('ceiling'), mat('concrete')]);
    m.position.y = y + SLAB_T; // 顶面在 y + SLAB_T
    projectUV(m, () => 1);
    m.castShadow = m.receiveShadow = true;
    setInfo(m, { name, category: '主体结构', func: '现浇钢筋混凝土楼板，厚 200mm，楼板下方为吊顶', maintain: '结构检测：良好' });
    return m;
  };
  floors.add(makeSlab(FLOOR_H - SLAB_T, true, '二层楼板'));
  const topSlab = makeSlab(EAVE_Y - SLAB_T, false, '二层顶板（屋面层）');
  floors.add(topSlab);

  // ---------------- 墙体 ----------------
  // 墙体按"楼层 + 内/外墙"分成 4 组，每组一条信息（点击任何一块墙都显示所在组的信息）
  const wallGroups = {};
  const wallGroup = (floor, ext) => {
    const k = floor + (ext ? 'e' : 'i');
    if (!wallGroups[k]) {
      const g = new THREE.Group();
      setInfo(g, {
        name: (floor ? '二层' : '一层') + (ext ? (floor ? '外墙（保温涂料）' : '外墙（石材幕墙 + 保温）') : '内墙（隔声墙体）'),
        category: '主体结构', func: ext ? '承重与围护结构，内含 80mm 岩棉保温层，提升隔热性能' : '轻质隔声墙，隔声量 ≥ 45dB',
        maintain: '结构检测：良好（2026-06）', data: { 墙厚: '200 mm', 耐火极限: '≥ 2.0 h' },
      });
      walls.add(g);
      wallGroups[k] = g;
    }
    return wallGroups[k];
  };
  WALLS.forEach((wd, index) => {
    const alongX = wd.z1 === wd.z2;
    const isExt = !!wd.exterior;
    const fy = FLOORS[wd.floor].y;
    let a0 = alongX ? Math.min(wd.x1, wd.x2) : Math.min(wd.z1, wd.z2);
    let a1 = alongX ? Math.max(wd.x1, wd.x2) : Math.max(wd.z1, wd.z2);
    if (isExt && alongX) { a0 -= WALL_T / 2; a1 += WALL_T / 2; }
    if (isExt && !alongX) { a0 += WALL_T / 2; a1 -= WALL_T / 2; }
    if (wd.extendStart) a0 -= WALL_T / 2;
    const H = FLOOR_H - (index % 16) * 0.0007; // 高度差一点点，避免墙顶重叠处闪烁
    const c = alongX ? wd.z1 : wd.x1;

    const add = (s0, s1, y0, y1) => {
      if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
      const [x0, x1, z0, z1] = alongX ? [s0, s1, c - WALL_T / 2, c + WALL_T / 2] : [c - WALL_T / 2, c + WALL_T / 2, s0, s1];
      const piece = wallPiece(x0, x1, fy + y0, fy + y1, z0, z1, wd.floor);
      piece.userData.wall = wd.id;
      wallGroup(wd.floor, isExt).add(piece);
      if (y0 < 0.5) {
        nav?.blockRect(wd.floor, x0, x1, z0, z1);
        addSkirting(details, x0, x1, z0, z1, fy, wd.floor, alongX);
        if (isExt && wd.floor === 0) addPlinth(details, x0, x1, z0, z1, wd.exterior);
      }
    };

    const ops = [...wd.openings].sort((p, q) => p.a - q.a);
    let cur = a0;
    for (const op of ops) {
      add(cur, op.a, 0, H);
      add(op.a, op.b, 0, op.bottom);
      add(op.a, op.b, op.top, H);
      cur = op.b;
      const o = buildOpening(wd, op, alongX, c, fy);
      openingsGroup.add(o.group);
      if (op.kind === 'window' || op.kind === 'slide') windows[op.id] = o;
      if (op.kind === 'door' || op.kind === 'slide') doors[op.id] = o;
    }
    add(cur, a1, 0, H);
  });

  // 一、二层之间的外墙腰线
  const band = (w, d, x, z) => details.add(box(w, 0.2, d, 'trim', x, FLOOR_H - 0.12, z, { cast: false }));
  band(EXT.x1 - EXT.x0 + 0.36, 0.08, 0, EXT.z0 - 0.14);
  band(EXT.x1 - EXT.x0 + 0.36, 0.08, 0, EXT.z1 + 0.14);
  band(0.08, EXT.z1 - EXT.z0 + 0.2, EXT.x0 - 0.14, 0);
  band(0.08, EXT.z1 - EXT.z0 + 0.2, EXT.x1 + 0.14, 0);

  // ---------------- 楼梯、电梯井、阳台 ----------------
  const stairs = buildStairs(details, nav);
  const elevator = buildElevatorShaft(details, nav);
  buildBalcony(details, nav);

  // ---------------- 屋顶 ----------------
  const roof = buildRoof();
  root.add(roof.group);

  // 入口雨棚与立柱
  const canopy = new THREE.Group();
  canopy.add(box(1.6, 0.14, 2.6, 'frame', -8.9, 2.62, -0.2));
  canopy.add(box(1.55, 0.02, 2.55, 'glass', -8.9, 2.77, -0.2, { cast: false }));
  for (const z of [-1.35, 0.95]) canopy.add(cylinder(0.06, 0.06, 2.62, 'frame', -9.55, 0, z, 12));
  setInfo(canopy, { name: '入口雨棚', category: '主体结构', func: '钢结构玻璃雨棚，入户时遮雨；与无障碍坡道配合' });
  root.add(canopy);

  // 二层外墙开口处（非洞口）都已生成；最后统计各层阻挡
  blockOutsideSecondFloor(nav);

  return { root, walls, floors, roof: roof.group, roofParts: roof, windows, doors, stairs, elevator, topSlab };
}

/** 创建一块实心墙体（轴对齐）：每个面按朝向的房间选择材质，UV 按世界坐标 */
function wallPiece(x0, x1, y0, y1, z0, z1, floor) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const names = [
    sideMaterial(x1 + 0.15, cz, floor), sideMaterial(x0 - 0.15, cz, floor),
    'wallPaint', 'wallPaint',
    sideMaterial(cx, z1 + 0.15, floor), sideMaterial(cx, z0 - 0.15, floor),
  ];
  const ext = names.find((n) => n === 'wallExterior' || n === 'wallRender');
  names[2] = names[3] = ext ?? 'wallPaint';
  const mats = names.map(mat);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  mesh.position.set(cx, cy, cz);
  projectUV(mesh, (g) => tileOf(mats[g]));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

// 踢脚线：沿墙体底部、朝向室内的两个侧面各贴一条 8cm 高的木线
function addSkirting(group, x0, x1, z0, z1, fy, floor, alongX) {
  const hgt = 0.08, t = 0.012;
  if (alongX) {
    for (const [z, s] of [[z0 - t / 2, -1], [z1 + t / 2, 1]]) {
      const r = roomAt((x0 + x1) / 2, z + s * 0.2, floor);
      if (r && !r.outdoor) group.add(box(x1 - x0, hgt, t, 'skirting', (x0 + x1) / 2, fy + 0.012, z, { cast: false }));
    }
  } else {
    for (const [x, s] of [[x0 - t / 2, -1], [x1 + t / 2, 1]]) {
      const r = roomAt(x + s * 0.2, (z0 + z1) / 2, floor);
      if (r && !r.outdoor) group.add(box(t, hgt, z1 - z0, 'skirting', x, fy + 0.012, (z0 + z1) / 2, { cast: false }));
    }
  }
}

// 勒脚：一层外墙底部 0.45m 高的深色花岗岩，略凸出墙面
function addPlinth(group, x0, x1, z0, z1, side) {
  const h = 0.45, t = 0.04;
  if (side === '-z') group.add(box(x1 - x0, h, t, 'plinth', (x0 + x1) / 2, 0, z0 - t / 2, { cast: false }));
  if (side === '+z') group.add(box(x1 - x0, h, t, 'plinth', (x0 + x1) / 2, 0, z1 + t / 2, { cast: false }));
  if (side === '-x') group.add(box(t, h, z1 - z0, 'plinth', x0 - t / 2, 0, (z0 + z1) / 2, { cast: false }));
  if (side === '+x') group.add(box(t, h, z1 - z0, 'plinth', x1 + t / 2, 0, (z0 + z1) / 2, { cast: false }));
}

// 二层导航网格：只有楼板覆盖的区域能走（楼梯洞、电梯井、外墙以外都不能走；阳台除外）
function blockOutsideSecondFloor(nav) {
  if (!nav) return;
  const g = nav.grid(1);
  for (let j = 0; j < g.nz; j++) for (let i = 0; i < g.nx; i++) {
    const x = g.cx(i), z = g.cz(j);
    const inside = x > EXT.x0 && x < EXT.x1 && z > EXT.z0 && z < EXT.z1;
    const balcony = x > -3.5 && x < 3.1 && z >= EXT.z1 && z < 6.45;
    if (!inside && !balcony) g.blocked[g.idx(i, j)] = 1;
  }
  const h = STAIR.hole;
  nav.blockRect(1, h.x0, h.x1, h.z0, h.z1);
  // 一层楼梯下方（第二跑下面）不能走，第一跑由楼梯路点负责
  nav.blockRect(0, h.x0, h.x1, h.z0, h.z1);
}

// ---------------- 楼梯 ----------------
function buildStairs(group, nav) {
  const g = new THREE.Group();
  const { flight1: f1, flight2: f2, zLow, zHigh, landing, steps } = STAIR;
  const run = (zLow - zHigh) / steps, rise = 1.6 / steps;
  const tread = mat('woodFloor'), riser = mat('trim');
  for (let i = 0; i < steps; i++) {
    // 第一跑：实心台阶（下面是实心的）
    const z1 = zLow - i * run, z0 = z1 - run;
    const hTop = (i + 1) * rise;
    g.add(box(f1.x1 - f1.x0, hTop, run, [riser, riser, tread, riser, riser, riser], (f1.x0 + f1.x1) / 2, 0, (z0 + z1) / 2));
    // 第二跑：悬挑踏步板（从平台向南逐级升高）
    const zz1 = zHigh + (i + 1) * run, zz0 = zz1 - run;
    const top2 = 1.6 + (i + 1) * rise;
    g.add(box(f2.x1 - f2.x0, 0.06, run + 0.02, tread, (f2.x0 + f2.x1) / 2, top2 - 0.06, (zz0 + zz1) / 2));
    g.add(box(f2.x1 - f2.x0, rise - 0.06, 0.02, riser, (f2.x0 + f2.x1) / 2, top2 - rise, zz0 + 0.01));
  }
  // 第二跑下方的斜梁（钢板）
  const len = Math.hypot(zLow - zHigh, 1.6);
  const beam = box(f2.x1 - f2.x0, 0.12, len, 'frame', 0, 0, 0);
  beam.geometry.translate(0, -0.06, 0);
  beam.position.set((f2.x0 + f2.x1) / 2, 1.6 + 0.8 - 0.25, (zLow + zHigh) / 2);
  beam.rotation.x = -Math.atan2(1.6, zLow - zHigh); // 第二跑向南升高
  g.add(beam);
  // 休息平台
  g.add(box(f2.x1 - f1.x0, 0.2, landing.z1 - landing.z0, [riser, riser, tread, mat('ceiling'), riser, riser], (f1.x0 + f2.x1) / 2, 1.4, (landing.z0 + landing.z1) / 2));
  g.add(box(f2.x1 - f2.x0, 1.4, 0.15, 'concrete', (f2.x0 + f2.x1) / 2, 0, landing.z1 - 0.08)); // 平台下的支撑墙
  // 扶手：两跑之间的中间扶手 + 外侧靠墙扶手（斜向）
  const rail = (x, zA, yA, zB, yB) => {
    const L = Math.hypot(zB - zA, yB - yA);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, L, 10), mat('woodLight'));
    bar.position.set(x, (yA + yB) / 2 + 0.9, (zA + zB) / 2);
    bar.rotation.x = Math.atan2(zB - zA, yB - yA);
    bar.castShadow = true;
    g.add(bar);
    const n = Math.max(2, Math.round(L / 0.5));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      g.add(cylinder(0.012, 0.012, 0.9, 'metal', x, yA + (yB - yA) * t, zA + (zB - zA) * t, 6));
    }
  };
  const mid = (f1.x1 + f2.x0) / 2;
  rail(mid, zLow, 0, zHigh, 1.6);
  rail(mid, zHigh, 1.6, zLow, 3.2);
  rail(f1.x0 + 0.05, zLow, 0, zHigh, 1.6);
  // 二层洞口护栏（高 1.1m）
  const guard = (x0, z0, x1, z1) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const top = box(x1 === x0 ? 0.05 : L, 0.05, x1 === x0 ? L : 0.05, 'woodLight', (x0 + x1) / 2, FLOOR_H + 1.05, (z0 + z1) / 2, { cast: false });
    g.add(top);
    const glass = box(x1 === x0 ? 0.02 : L, 1.0, x1 === x0 ? L : 0.02, 'glass', (x0 + x1) / 2, FLOOR_H + 0.05, (z0 + z1) / 2, { cast: false });
    g.add(glass);
  };
  guard(STAIR.hole.x0, STAIR.hole.z1, f1.x1 + 0.05, STAIR.hole.z1);
  guard(STAIR.hole.x1, STAIR.hole.z1 - 0.2, STAIR.hole.x1, ELEVATOR.z1);
  setInfo(g, { name: 'U 形楼梯', category: '主体结构 / 安全', func: '踏步宽 0.27m、高 0.18m，两侧连续扶手，二层洞口设 1.1m 高玻璃护栏；火灾时作为二层疏散通道', maintain: '防滑条检查：2026-08 正常', data: { 梯段宽: '1.1 m', 每跑: '9 级' } });
  group.add(g);
  return g;
}

// ---------------- 电梯井（玻璃井道） ----------------
function buildElevatorShaft(group, nav) {
  const e = ELEVATOR;
  const g = new THREE.Group();
  const h = EAVE_Y - 0.2;
  const w = e.x1 - e.x0, d = e.z1 - e.z0;
  // 四角立柱 + 玻璃围护（南面是门）
  for (const [x, z] of [[e.x0, e.z0], [e.x1, e.z0], [e.x0, e.z1], [e.x1, e.z1]]) g.add(box(0.08, h, 0.08, 'frame', x, 0, z));
  g.add(box(w, h, 0.02, 'glass', (e.x0 + e.x1) / 2, 0, e.z0, { cast: false }));
  g.add(box(0.02, h, d, 'glass', e.x0, 0, (e.z0 + e.z1) / 2, { cast: false }));
  for (const fy of [0, FLOOR_H]) {
    g.add(box(0.25, 2.3, 0.02, 'glass', e.x0 + 0.125, fy, e.z1, { cast: false }));
    g.add(box(0.25, 2.3, 0.02, 'glass', e.x1 - 0.125, fy, e.z1, { cast: false }));
    g.add(box(w, 0.2, 0.08, 'frame', (e.x0 + e.x1) / 2, fy + 2.3, e.z1));
  }
  group.add(g);
  nav?.blockRect(0, e.x0 - 0.05, e.x1 + 0.05, e.z0, e.z1);
  nav?.blockRect(1, e.x0 - 0.05, e.x1 + 0.05, e.z0, e.z1);
  return g;
}

// ---------------- 阳台 ----------------
function buildBalcony(group, nav) {
  const x0 = -3.6, x1 = 3.2, z0 = EXT.z1, z1 = 6.6;
  group.add(box(x1 - x0, SLAB_T, z1 - z0, [mat('concrete'), mat('concrete'), mat('deck'), mat('ceiling'), mat('concrete'), mat('concrete')], (x0 + x1) / 2, FLOOR_H - SLAB_T, (z0 + z1) / 2));
  // 玻璃栏杆（高 1.1m）：底部金属边框、玻璃栏板、顶部扶手
  const rail = new THREE.Group();
  const seg = (ax, az, bx, bz) => {
    const alongX = az === bz, L = alongX ? Math.abs(bx - ax) : Math.abs(bz - az);
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    rail.add(box(alongX ? L : 0.06, 1.0, alongX ? 0.02 : L, 'glass', cx, FLOOR_H + 0.05, cz, { cast: false }));
    rail.add(box(alongX ? L + 0.06 : 0.07, 0.06, alongX ? 0.07 : L + 0.06, 'metal', cx, FLOOR_H + 1.05, cz));
    rail.add(box(alongX ? L : 0.06, 0.05, alongX ? 0.06 : L, 'frame', cx, FLOOR_H, cz));
  };
  seg(x0 + 0.05, z1 - 0.05, x1 - 0.05, z1 - 0.05);
  seg(x0 + 0.05, z0, x0 + 0.05, z1 - 0.05);
  seg(x1 - 0.05, z0, x1 - 0.05, z1 - 0.05);
  setInfo(rail, { name: '阳台玻璃栏杆', category: '安全', func: '钢化夹胶玻璃栏板，栏杆高 1.1m（≥ 规范 1.05m），防止坠落；顶部不锈钢扶手', maintain: '玻璃与扶手固定件检查：2026-07 正常', data: { 高度: '1.10 m', 安全状态: '正常' } });
  group.add(rail);
  // 阳台下方立柱（兼作一层南侧门廊）
  for (const x of [x0 + 0.15, x1 - 0.15]) group.add(cylinder(0.1, 0.1, FLOOR_H - SLAB_T, 'trim', x, 0, z1 - 0.2, 16));
  nav?.blockRect(0, x0, x0 + 0.3, z1 - 0.35, z1 - 0.05);
  nav?.blockRect(0, x1 - 0.3, x1, z1 - 0.35, z1 - 0.05);
}

// ---------------- 坡屋顶 ----------------
function buildRoof() {
  const group = new THREE.Group();
  group.name = 'roof';
  const tan = Math.tan(THREE.MathUtils.degToRad(ROOF_PITCH));
  const overhangZ = 0.6, overhangX = 0.5;
  const halfD = EXT.z1 + overhangZ;                 // 屋脊到檐口的水平距离
  const ridgeY = EAVE_Y + EXT.z1 * tan + 0.1;        // 屋面在外墙线处正好落在墙顶
  const L = halfD / Math.cos(THREE.MathUtils.degToRad(ROOF_PITCH));
  const W = EXT.x1 - EXT.x0 + overhangX * 2;
  const slopes = [];
  for (const s of [1, -1]) {
    const mats = ['fascia', 'fascia', 'roofTiles', 'fascia', 'fascia', 'fascia'].map(mat);
    const geo = new THREE.BoxGeometry(W, 0.2, L);
    const m = new THREE.Mesh(geo, mats);
    // BoxGeometry 顶面 UV：u 沿 x，v 沿坡向，按真实尺寸缩放
    const uv = geo.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * W / tileOf(mats[2]), uv.getY(i) * L / tileOf(mats[2]));
    m.position.set(0, ridgeY - (halfD / 2) * tan, (s * halfD) / 2);
    m.rotation.x = s * THREE.MathUtils.degToRad(ROOF_PITCH);
    m.castShadow = m.receiveShadow = true;
    setInfo(m, { name: s > 0 ? '南坡屋面（光伏）' : '北坡屋面', category: '主体结构', func: '坡度 25° 的保温坡屋面：挂瓦 + 防水卷材 + 100mm 挤塑板保温，排水快、隔热好', maintain: '瓦面与防水层检查：2026-05 正常', data: { 传热系数: '0.30 W/(m²·K)' } });
    group.add(m);
    slopes.push(m);
  }
  // 屋脊
  const ridge = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, W, 12), mat('roofTiles'));
  ridge.rotation.z = Math.PI / 2;
  ridge.position.set(0, ridgeY + 0.08, 0);
  group.add(ridge);
  // 山墙（东西两侧三角形墙）
  for (const x of [EXT.x0, EXT.x1]) {
    const shape = new THREE.Shape([new THREE.Vector2(EXT.z0 - 0.1, 0), new THREE.Vector2(EXT.z1 + 0.1, 0), new THREE.Vector2(0, ridgeY - EAVE_Y - 0.05)]);
    const geo = new THREE.ExtrudeGeometry(shape, { depth: WALL_T, bevelEnabled: false });
    geo.rotateY(Math.PI / 2); // 形状转到 yz 平面（三角形左右对称，方向不影响）
    const m = new THREE.Mesh(geo, mat('wallRender'));
    m.position.set(x - WALL_T / 2, EAVE_Y, 0);
    projectUV(m, () => tileOf(mat('wallRender')));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  // 檐沟（沿南北檐口）和四角落水管
  const gutterY = EAVE_Y - overhangZ * tan + 0.02;
  const gutters = [];
  for (const s of [1, -1]) {
    const gut = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, W, 12, 1, false, 0, Math.PI), mat('darkMetal'));
    gut.rotation.z = Math.PI / 2;
    gut.rotation.y = s > 0 ? 0 : Math.PI;
    gut.position.set(0, gutterY, s * (halfD + 0.05));
    group.add(gut);
    gutters.push(gut);
  }
  const downpipes = [];
  for (const [x, z] of [[EXT.x1 + 0.35, halfD + 0.05], [EXT.x0 - 0.35, halfD + 0.05], [EXT.x1 + 0.35, -halfD - 0.05], [EXT.x0 - 0.35, -halfD - 0.05]]) {
    const p = cylinder(0.05, 0.05, gutterY, 'darkMetal', x, 0, z, 10);
    group.add(p);
    downpipes.push({ x, z, top: gutterY });
  }
  setInfo(gutters[0], { name: '檐沟与落水管', category: '绿色低碳', func: '收集屋面雨水，经落水管、初期弃流过滤器进入地下雨水蓄水池' });
  return { group, slopes, ridgeY, halfD, tan, gutterY, downpipes, W };
}

// ---------------- 门窗 ----------------
function toWorld(alongX, c, s, n, y) {
  return alongX ? new THREE.Vector3(s, y, c + n) : new THREE.Vector3(c + n, y, s);
}

function buildOpening(wd, op, alongX, c, fy) {
  const group = new THREE.Group();
  const w = op.b - op.a, h = op.top - op.bottom, mid = (op.a + op.b) / 2;
  const frameT = 0.06;
  group.position.copy(toWorld(alongX, c, mid, 0, fy + op.bottom));
  if (!alongX) group.rotation.y = -Math.PI / 2;
  group.name = op.id;
  const ext = !!wd.exterior;
  // 外墙朝外的一侧在局部坐标中是 +z 还是 -z
  const outSign = ext ? ((wd.exterior === '+z' || wd.exterior === '-x') ? 1 : -1) : 0;

  const frame = mat('frame');
  const fr = (fw, fh, x, y) => { const m = box(fw, fh, WALL_T + 0.02, frame, x, y, 0); m.castShadow = false; group.add(m); };
  fr(w, frameT, 0, h - frameT);
  if (op.bottom > 0) fr(w, frameT, 0, 0);
  fr(frameT, h, -w / 2 + frameT / 2, 0);
  fr(frameT, h, w / 2 - frameT / 2, 0);

  // 外墙门窗的窗套（白色线脚，凸出墙面 5cm）
  if (ext) {
    const tz = outSign * (WALL_T / 2 + 0.025), tw = 0.12;
    group.add(box(w + tw * 2, tw, 0.05, 'trim', 0, h, tz, { cast: false }));
    group.add(box(tw, h + (op.bottom > 0 ? tw : 0), 0.05, 'trim', -w / 2 - tw / 2, op.bottom > 0 ? -tw : 0, tz, { cast: false }));
    group.add(box(tw, h + (op.bottom > 0 ? tw : 0), 0.05, 'trim', w / 2 + tw / 2, op.bottom > 0 ? -tw : 0, tz, { cast: false }));
    if (op.bottom > 0) group.add(box(w + tw * 2 + 0.06, 0.06, 0.14, 'trim', 0, -0.06, outSign * (WALL_T / 2 + 0.06)));
  }
  // 室内门洞两侧门套
  if (!ext || op.kind === 'door') {
    for (const sgn of ext ? [-outSign] : [1, -1]) {
      const tz = sgn * (WALL_T / 2 + 0.01);
      group.add(box(0.07, h, 0.02, 'trim', -w / 2 - 0.035, 0, tz, { cast: false }));
      group.add(box(0.07, h, 0.02, 'trim', w / 2 + 0.035, 0, tz, { cast: false }));
      group.add(box(w + 0.14, 0.07, 0.02, 'trim', 0, h, tz, { cast: false }));
    }
  }

  const result: any = { group, op, isOpen: false, alongX, wallC: c, width: w, floor: wd.floor };

  if (op.kind === 'window' || op.kind === 'slide') {
    const pw = (w - 2 * frameT) / 2 + 0.03, ph = h - 2 * frameT + (op.bottom > 0 ? 0 : frameT);
    const y0 = op.bottom > 0 ? frameT : 0;
    const makeSash = () => {
      const s = new THREE.Group();
      const g = new THREE.Mesh(new THREE.PlaneGeometry(pw - 0.06, ph - 0.06), mat('glass'));
      g.position.y = ph / 2; g.renderOrder = 2;
      s.add(g);
      const bar = (bw, bh, x, y) => { const m = box(bw, bh, 0.05, frame, x, y, 0); m.castShadow = false; s.add(m); };
      bar(pw, 0.04, 0, 0); bar(pw, 0.04, 0, ph - 0.04);
      bar(0.04, ph, -pw / 2 + 0.02, 0); bar(0.04, ph, pw / 2 - 0.02, 0);
      if (op.kind === 'slide') bar(0.03, 0.25, pw / 2 - 0.08, ph / 2 - 0.12);
      return s;
    };
    const fixed = makeSash(); fixed.position.set(-pw / 2 + 0.03 + frameT / 2, y0, -0.035);
    const moving = makeSash(); moving.position.set(pw / 2 - 0.03 - frameT / 2, y0, 0.035);
    moving.userData.dynamic = true; // 会滑动的窗扇，不参与静态合并
    group.add(fixed, moving);
    result.sash = moving;
    result.closedX = moving.position.x;
    result.openX = moving.position.x - pw + 0.08;
    result.target = 0; result.t = 0;
    result.setOpen = (open) => { result.isOpen = open; result.target = open ? 1 : 0; };
    if (op.bottom > 0) group.add(box(w + 0.1, 0.04, WALL_T + 0.1, 'marble', 0, -0.04, 0));
    // 夜间窗户透光：外墙窗户内侧放一块只朝外的暖色发光面，房间开灯且天黑时从室外看窗户是亮的
    if (ext) {
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.16, h - 0.16), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, depthWrite: false, toneMapped: false }));
      glow.position.set(0, h / 2, outSign * 0.07); // 在玻璃外侧一点点，避免被深色玻璃压暗
      if (outSign < 0) glow.rotation.y = Math.PI;
      glow.userData.noPick = true; glow.userData.dynamic = true;
      glow.renderOrder = 3;
      group.add(glow);
      result.glow = glow;
    }
    const names = { 'door-living': '客厅落地推拉门', 'door-balcony': '阳台推拉门' };
    setInfo(group, {
      name: names[op.id] ?? '断桥铝合金推拉窗',
      category: op.kind === 'slide' ? '门窗' : '门窗 / 安全',
      func: op.kind === 'slide' ? '双层中空 Low-E 玻璃推拉门，隔热、隔声' : '双层中空 Low-E 玻璃，气密性 6 级；开启扇设限位器（开启 ≤ 10cm 时锁定），防止儿童坠落；窗磁传感器监测开关状态',
      room: op.room, maintain: '密封条检查：2026-04 正常', data: { 窗宽: w.toFixed(1) + ' m', 状态: '关闭', 安全状态: '限位器正常' },
      controls: [{ type: 'toggle', label: '开关窗', get: () => result.isOpen, set: (v) => result.setOpen(v) }],
    });
    result.update = (dt) => {
      result.t += Math.sign(result.target - result.t) * Math.min(Math.abs(result.target - result.t), dt * 1.5);
      moving.position.x = THREE.MathUtils.lerp(result.closedX, result.openX, result.t);
      if (group.userData.info) group.userData.info.data.状态 = result.isOpen ? '开启' : '关闭';
    };
  } else if (op.kind === 'door') {
    const dw = w - 2 * frameT, dh = h - frameT;
    const hingeX = op.hinge === 'a' ? -w / 2 + frameT : w / 2 - frameT;
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, 0);
    pivot.userData.dynamic = true; // 会转动的门扇
    const dir = op.hinge === 'a' ? 1 : -1;
    const leafMat = op.fireDoor ? mat('darkMetal') : ext ? mat('woodDark') : mat('woodWhite');
    pivot.add(box(dw, dh, 0.05, leafMat, dir * dw / 2, 0.01, 0));
    // 门板装饰线（室内门）
    if (!op.fireDoor) for (const zz of [0.027, -0.027]) {
      pivot.add(box(dw - 0.2, 0.012, 0.004, 'trim', dir * dw / 2, 0.55, zz, { cast: false }));
      pivot.add(box(dw - 0.2, 0.012, 0.004, 'trim', dir * dw / 2, 1.7, zz, { cast: false }));
    }
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), mat('metal'));
    handle.rotation.z = Math.PI / 2;
    handle.position.set(dir * (dw - 0.1), 1.0, 0.05);
    pivot.add(handle);
    const handle2 = handle.clone(); handle2.position.z = -0.05; pivot.add(handle2);
    if (op.fireDoor) pivot.add(box(0.5, 0.12, 0.052, 'red', dir * dw / 2, 1.6, 0));
    group.add(pivot);
    const openAngle = dir * (op.swing ?? 1) * THREE.MathUtils.degToRad(85);
    result.pivot = pivot;
    result.openAngle = openAngle;
    result.t = ext ? 0 : 1; result.target = result.t; result.isOpen = !ext;
    result.setOpen = (open) => { result.isOpen = open; result.target = open ? 1 : 0; };
    result.update = (dt) => {
      result.t += Math.sign(result.target - result.t) * Math.min(Math.abs(result.target - result.t), dt * 1.2);
      pivot.rotation.y = openAngle * result.t;
      if (group.userData.info) group.userData.info.data.状态 = result.isOpen ? '开启' : '关闭';
    };
    result.update(0);
    const doorNames = { 'door-entry': '入户门（智能门锁）', 'door-back': '后门（安全出口）', 'door-kitchen': '厨房防火门（常开式）' };
    setInfo(group, {
      name: doorNames[op.id] ?? '室内门（无障碍宽门洞）',
      category: op.fireDoor ? '消防设施' : op.exit ? '门窗 / 安全出口' : '门窗',
      func: op.fireDoor ? '乙级防火门，平时常开，火灾时由消防联动自动关闭，阻止烟火蔓延' : op.exit ? '安全出口，净宽 ≥ 0.9 m，向外开启' : '净宽 0.9 m 以上，满足轮椅通行；无门槛',
      room: op.room, maintain: op.fireDoor ? '闭门器、释放器检测：2026-08 正常' : '五金件检查：正常',
      data: { 门宽: w.toFixed(2) + ' m', 状态: result.isOpen ? '开启' : '关闭' },
      controls: [{ type: 'toggle', label: '开/关门', get: () => result.isOpen, set: (v) => result.setOpen(v) }],
    });
  } else {
    // 敞开门洞：只有门套
    result.update = () => {};
    result.setOpen = () => {};
  }
  return result;
}
