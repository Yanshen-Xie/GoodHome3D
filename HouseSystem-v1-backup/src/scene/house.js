// 房屋主体：地面、墙体（自动在门窗处开洞）、门窗、屋顶。
import * as THREE from 'three';
import { ROOMS, WALLS, WALL_H, WALL_T, EXT, roomAt } from './layout.js';
import { mat, box, setInfo, tileOf, worldPlaneUV } from './common.js';

/**
 * 按世界坐标设置 UV（"平面投影"）：朝 ±z 的面用 (x,y)，朝 ±x 的面用 (z,y)，朝 ±y 的面用 (x,z)。
 * 这样同一面墙被门窗切成好几块时，纹理在各块之间也是连续的。
 * tiles[i] 是第 i 个面所用材质的贴图尺寸。
 */
function projectUV(mesh, tiles) {
  mesh.updateMatrixWorld(true);
  const geo = mesh.geometry;
  const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
  const v = new THREE.Vector3();
  const perFace = pos.count / 6;
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i));
    const t = tiles[Math.floor(i / perFace)];
    if (ny > 0.5) uv.setXY(i, v.x / t, v.z / t);
    else if (nx > 0.5) uv.setXY(i, v.z / t, v.y / t);
    else uv.setXY(i, v.x / t, v.y / t);
  }
  uv.needsUpdate = true;
}

// 墙面某一侧朝向哪个房间，决定这一侧用什么材质
function sideMaterial(px, pz) {
  const r = roomAt(px, pz);
  if (!r) return 'wallExterior';
  if (r.id === 'kitchen' || r.id === 'bath') return 'wallKitchen';
  return 'wallPaint';
}

/** 创建一块实心墙体（轴对齐），x0..x1, y0..y1, z0..z1 */
function wallPiece(x0, x1, y0, y1, z0, z1) {
  const w = x1 - x0, h = y1 - y0, d = z1 - z0;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  // 6 个面：+x, -x, +y, -y, +z, -z。向外偏移 0.15 米取样，判断这个面对着哪个房间
  const names = [
    sideMaterial(x1 + 0.15, cz), sideMaterial(x0 - 0.15, cz),
    'wallPaint', 'wallPaint',
    sideMaterial(cx, z1 + 0.15), sideMaterial(cx, z0 - 0.15),
  ];
  // 墙顶面：外墙顶用外墙材质，避免剖切时颜色突兀
  names[2] = names[0] === 'wallExterior' || names[1] === 'wallExterior' || names[4] === 'wallExterior' || names[5] === 'wallExterior' ? 'wallExterior' : 'wallPaint';
  const mats = names.map(mat);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats);
  mesh.position.set(cx, cy, cz);
  projectUV(mesh, mats.map(tileOf));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function buildHouse(nav) {
  const root = new THREE.Group();
  root.name = 'house';
  const walls = new THREE.Group(); walls.name = 'walls';
  const floors = new THREE.Group(); floors.name = 'floors';
  const openingsGroup = new THREE.Group(); openingsGroup.name = 'openings';
  root.add(walls, floors, openingsGroup);

  const windows = {};
  const doors = {};

  // ---------- 地面 ----------
  for (const r of ROOMS) {
    const w = r.x1 - r.x0, d = r.z1 - r.z0;
    const m = mat(r.floor);
    const geo = new THREE.PlaneGeometry(w, d);
    geo.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set((r.x0 + r.x1) / 2, 0.012, (r.z0 + r.z1) / 2);
    // 地面 UV 同样按世界坐标，走廊、客厅、餐厅的瓷砖缝能对齐
    const uv = geo.attributes.uv, pos = geo.attributes.position, t = tileOf(m);
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (pos.getX(i) + mesh.position.x) / t, -(pos.getZ(i) + mesh.position.z) / t);
    mesh.receiveShadow = true;
    mesh.userData.room = r.id;
    setInfo(mesh, { name: r.name + '地面', category: '地面', func: r.floor === 'bathTile' ? '防滑地砖，室内无高差，便于轮椅通行' : '地面材料，室内无高差，便于轮椅和助行器通行', room: r.id, maintain: '地面平整，无破损' });
    floors.add(mesh);
  }
  // 地基（略高出草地，形成房屋的"底座"）
  const base = box(EXT.x1 - EXT.x0 + 0.4, 0.3, EXT.z1 - EXT.z0 + 0.4, 'stone', 0, -0.29, 0, { cast: false });
  floors.add(base);

  // ---------- 墙体 ----------
  WALLS.forEach((wd, index) => {
    const alongX = wd.z1 === wd.z2;
    const isExt = !!wd.exterior;
    // 墙两端的处理（避免相邻墙重叠产生闪烁）：南北外墙两端各伸出半个墙厚包住转角，东西外墙两端各缩进半个墙厚
    let a0 = alongX ? Math.min(wd.x1, wd.x2) : Math.min(wd.z1, wd.z2);
    let a1 = alongX ? Math.max(wd.x1, wd.x2) : Math.max(wd.z1, wd.z2);
    if (isExt && alongX) { a0 -= WALL_T / 2; a1 += WALL_T / 2; }
    if (isExt && !alongX) { a0 += WALL_T / 2; a1 -= WALL_T / 2; }
    if (wd.id === 'wKit') a0 -= WALL_T / 2; // 厨房西墙与北墙成 L 形转角，补上转角
    const H = WALL_H - index * 0.0007; // 每面墙高度差一点点，避免墙顶重叠处闪烁
    const c = alongX ? wd.z1 : wd.x1;

    const add = (s0, s1, y0, y1) => {
      if (s1 - s0 < 0.005 || y1 - y0 < 0.005) return;
      const piece = alongX
        ? wallPiece(s0, s1, y0, y1, c - WALL_T / 2, c + WALL_T / 2)
        : wallPiece(c - WALL_T / 2, c + WALL_T / 2, y0, y1, s0, s1);
      piece.userData.wall = wd.id;
      setInfo(piece, { name: isExt ? '外墙（保温一体化）' : '内墙（隔声墙体）', category: '主体结构', func: isExt ? '承重与围护结构，外贴石材、内含 80mm 保温层，提升隔热性能' : '轻质隔声墙，隔声量 ≥ 45dB', maintain: '结构检测：良好（2026-06）', data: { 墙厚: '200 mm', 耐火极限: '≥ 2.0 h' } });
      walls.add(piece);
      if (y0 < 0.5) nav?.blockRect(alongX ? s0 : c - WALL_T / 2, alongX ? s1 : c + WALL_T / 2, alongX ? c - WALL_T / 2 : s0, alongX ? c + WALL_T / 2 : s1);
    };

    const ops = [...wd.openings].sort((p, q) => p.a - q.a);
    let cur = a0;
    for (const op of ops) {
      add(cur, op.a, 0, H);            // 洞口左侧整段墙
      add(op.a, op.b, 0, op.bottom);   // 窗下墙
      add(op.a, op.b, op.top, H);      // 洞口上方过梁
      cur = op.b;
      const o = buildOpening(wd, op, alongX, c);
      openingsGroup.add(o.group);
      if (op.kind === 'window' || op.kind === 'slide') windows[op.id] = o;
      if (op.kind === 'door' || op.kind === 'slide') doors[op.id] = o;
    }
    add(cur, a1, 0, H);
  });

  // ---------- 屋顶 ----------
  const roof = new THREE.Group(); roof.name = 'roof';
  const roofW = EXT.x1 - EXT.x0 + 0.6, roofD = EXT.z1 - EXT.z0 + 0.6;
  const slabMats = ['slab', 'slab', 'roof', 'ceiling', 'slab', 'slab'].map(mat);
  const slab = new THREE.Mesh(new THREE.BoxGeometry(roofW, 0.25, roofD), slabMats);
  slab.position.set(0, WALL_H + 0.125, 0);
  projectUV(slab, slabMats.map(tileOf));
  slab.castShadow = slab.receiveShadow = true;
  setInfo(slab, { name: '屋面（种植/光伏复合屋面）', category: '主体结构', func: '钢筋混凝土屋面板 + 挤塑板保温 + 防水层，上方布置光伏阵列', maintain: '防水层检查：2026-05 正常', data: { 传热系数: '0.35 W/(m²·K)' } });
  roof.add(slab);
  // 女儿墙（屋顶四周的矮墙，兼作防护栏杆）
  const pH = 0.5, pT = 0.15, top = WALL_H + 0.25;
  roof.add(box(roofW, pH, pT, 'wallExterior', 0, top, -roofD / 2 + pT / 2));
  roof.add(box(roofW, pH, pT, 'wallExterior', 0, top, roofD / 2 - pT / 2));
  roof.add(box(pT, pH, roofD - 2 * pT, 'wallExterior', -roofW / 2 + pT / 2, top, 0));
  roof.add(box(pT, pH, roofD - 2 * pT, 'wallExterior', roofW / 2 - pT / 2, top, 0));
  root.add(roof);

  // 入口雨棚（入户门上方）
  const canopy = box(1.4, 0.12, 2.2, 'frame', -8.8, 2.55, -0.2);
  root.add(canopy);
  const canopyGlass = box(1.35, 0.02, 2.15, 'glass', -8.8, 2.67, -0.2);
  root.add(canopyGlass);

  return { root, walls, floors, roof, windows, doors };
}

// ---------------- 门窗 ----------------
// 把"沿墙坐标 s、垂直墙偏移 n、高度 y"转成世界坐标
function toWorld(alongX, c, s, n, y) {
  return alongX ? new THREE.Vector3(s, y, c + n) : new THREE.Vector3(c + n, y, s);
}

function buildOpening(wd, op, alongX, c) {
  const group = new THREE.Group();
  const w = op.b - op.a, h = op.top - op.bottom, mid = (op.a + op.b) / 2;
  const frameT = 0.06;
  // 局部坐标系：原点在洞口底部中心，x 沿墙方向，z 垂直墙
  group.position.copy(toWorld(alongX, c, mid, 0, op.bottom));
  if (!alongX) group.rotation.y = -Math.PI / 2; // 使局部 x 指向世界 +z
  group.name = op.id;

  // 门窗框（洞口四周）
  const frame = mat('frame');
  const fr = (fw, fh, x, y) => { const m = box(fw, fh, WALL_T + 0.02, frame, x, y, 0); m.castShadow = false; group.add(m); };
  fr(w, frameT, 0, h - frameT);
  if (op.bottom > 0) fr(w, frameT, 0, 0);
  fr(frameT, h, -w / 2 + frameT / 2, 0);
  fr(frameT, h, w / 2 - frameT / 2, 0);

  const result = { group, op, isOpen: false, alongX, wallC: c, width: w };
  const ext = !!wd.exterior;

  if (op.kind === 'window' || op.kind === 'slide') {
    // 两扇推拉窗：左扇固定，右扇可以滑到左扇后面（开窗通风）
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
      if (op.kind === 'slide') bar(0.03, 0.25, pw / 2 - 0.08, ph / 2 - 0.12); // 推拉门把手
      return s;
    };
    const fixed = makeSash(); fixed.position.set(-pw / 2 + 0.03 + frameT / 2, y0, -0.035);
    const moving = makeSash(); moving.position.set(pw / 2 - 0.03 - frameT / 2, y0, 0.035);
    group.add(fixed, moving);
    result.sash = moving;
    result.closedX = moving.position.x;
    result.openX = moving.position.x - pw + 0.08;
    result.target = 0; result.t = 0;
    result.setOpen = (open) => { result.isOpen = open; result.target = open ? 1 : 0; };
    // 窗台
    if (op.bottom > 0) group.add(box(w + 0.1, 0.04, WALL_T + 0.1, 'marble', 0, -0.04, 0));
    setInfo(group, {
      name: op.kind === 'slide' ? '客厅落地推拉门' : '断桥铝合金推拉窗',
      category: op.kind === 'slide' ? '门窗 / 安全出口' : '门窗',
      func: op.kind === 'slide' ? '通往南侧露台，兼作第二安全出口；双层中空 Low-E 玻璃' : '双层中空 Low-E 玻璃，气密性 6 级，可开启通风；外窗设限位器防坠落',
      room: op.room, maintain: '密封条检查：2026-04 正常', data: { 窗宽: w.toFixed(1) + ' m', 状态: '关闭' },
      controls: [{ type: 'toggle', label: '开关窗', get: () => result.isOpen, set: (v) => result.setOpen(v) }],
    });
    result.update = (dt) => {
      result.t += Math.sign(result.target - result.t) * Math.min(Math.abs(result.target - result.t), dt * 1.5);
      moving.position.x = THREE.MathUtils.lerp(result.closedX, result.openX, result.t);
      if (group.userData.info) group.userData.info.data.状态 = result.isOpen ? '开启' : '关闭';
    };
  } else if (op.kind === 'door') {
    // 平开门：门扇绕铰链一侧旋转
    const dw = w - 2 * frameT, dh = h - frameT;
    const hingeX = op.hinge === 'a' ? -w / 2 + frameT : w / 2 - frameT;
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, 0);
    const dir = op.hinge === 'a' ? 1 : -1;
    const leafMat = op.fireDoor ? mat('darkMetal') : ext ? mat('woodDark') : mat('woodWhite');
    const leaf = box(dw, dh, 0.05, leafMat, dir * dw / 2, 0.01, 0);
    pivot.add(leaf);
    const handle = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8), mat('metal'));
    handle.rotation.z = Math.PI / 2;
    handle.position.set(dir * (dw - 0.1), 1.0, 0.05);
    pivot.add(handle);
    const handle2 = handle.clone(); handle2.position.z = -0.05; pivot.add(handle2);
    if (op.fireDoor) {
      // 防火门上的红色标识条
      pivot.add(box(0.5, 0.12, 0.052, 'red', dir * dw / 2, 1.6, 0));
    }
    group.add(pivot);
    // 门扇的开启角度：swing 决定往墙哪一侧开
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
      func: op.fireDoor ? '乙级防火门，平时常开，火灾时由消防联动自动关闭，阻止烟火蔓延至餐厅和走廊' : op.exit ? '安全出口，净宽 ≥ 0.9 m，向外疏散' : '净宽 0.9 m，满足轮椅通行；无门槛',
      room: op.room, maintain: op.fireDoor ? '闭门器、释放器检测：2026-08 正常' : '五金件检查：正常',
      data: { 门宽: w.toFixed(2) + ' m', 状态: result.isOpen ? '开启' : '关闭' },
      controls: [{ type: 'toggle', label: '开/关门', get: () => result.isOpen, set: (v) => result.setOpen(v) }],
    });
  }
  return result;
}
