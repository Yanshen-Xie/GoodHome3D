// 智能设备与安全设施：灯具、窗帘、空调、新风、传感器、消防设施、光伏系统等。
// 每个设备都登记在 devices 表中（按 id 查找），并带有可点击的信息与控制项。
import * as THREE from 'three';
import { mat, box, cylinder, setInfo, uniqueMat } from './common.js';
import { textTexture } from './textures.js';
import { WALL_H } from './layout.js';

export const STATUS_COLOR = { normal: 0x2ecc71, warning: 0xf1c40f, fault: 0xe74c3c, off: 0x7f8c8d };
export const STATUS_TEXT = { normal: '正常', warning: '预警', fault: '故障', off: '关闭' };

/**
 * 色温 → RGB（常用的近似公式，适用于 1000K~40000K）。
 * 暖光约 2700K（偏黄），中性光 4000K，冷光 6500K（偏白蓝）。
 */
export function kelvinToColor(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; } else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.52 * Math.log(t - 10) - 305.04;
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}

// 小圆点状态灯：绿=正常，黄=预警，红=故障
function statusLed(r = 0.025) {
  const m = uniqueMat({ color: 0x111111, emissive: STATUS_COLOR.normal, emissiveIntensity: 2 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m);
  return led;
}

// 挂墙物体朝向：让物体局部 +z 指向 facing 方向
const FACING = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': 0, '-z': Math.PI };

export function buildDevices(house, furnitureHandles) {
  const root = new THREE.Group();
  root.name = 'devices';
  const byId = {};
  const list = [];

  const register = (dev) => {
    byId[dev.id] = dev;
    list.push(dev);
    dev.status = dev.status ?? 'normal';
    if (dev.object) {
      dev.object.userData.deviceId = dev.id;
      setInfo(dev.object, { ...dev.info, status: dev.status, deviceId: dev.id });
    }
    return dev;
  };

  /** 修改设备状态，并同步状态灯颜色、信息面板 */
  const setStatus = (id, status) => {
    const d = byId[id];
    if (!d) return;
    d.status = status;
    if (d.led) d.led.material.emissive.setHex(STATUS_COLOR[status]);
    if (d.object?.userData.info) d.object.userData.info.status = status;
  };

  const wallMount = (obj, x, y, z, facing) => {
    obj.position.set(x, y, z);
    obj.rotation.y = FACING[facing];
    root.add(obj);
    return obj;
  };

  // ================= 照明 =================
  // 每个房间一盏吸顶灯（点光源），可调亮度与色温
  const lightDefs = [
    ['light-master', 'master', '主卧吸顶灯', -5.5, -3.0],
    ['light-bath', 'bath', '卫生间灯', -1.9, -2.2],
    ['light-kid', 'kid', '儿童房吸顶灯', 1.75, -3.0],
    ['light-elder', 'elder', '老人房吸顶灯', 6.0, -3.0],
    ['light-hall-w', 'hall', '走廊灯（西）', -4.5, -0.2],
    ['light-hall-e', 'hall', '走廊灯（东）', 3.5, -0.2],
    ['light-living', 'living', '客厅主灯', -5.3, 2.8],
    ['light-dining', 'dining', '餐厅吊灯', 2.0, 2.9],
    ['light-kitchen', 'kitchen', '厨房灯', 6.0, 2.8],
  ];
  const lights = [];
  for (const [id, room, name, x, z] of lightDefs) {
    const pendant = id === 'light-dining';
    const y = pendant ? 2.1 : WALL_H - 0.04;
    const shade = uniqueMat({ color: 0xf8f6f0, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
    const g = new THREE.Group();
    if (pendant) {
      g.add(cylinder(0.005, 0.005, WALL_H - y, 'darkMetal', 0, 0, 0, 4));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.25, 24, 1, true), shade);
      cone.position.y = -0.05;
      g.add(cone);
      g.position.set(x, y, z);
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(id.startsWith('light-hall') || id === 'light-bath' ? 0.18 : 0.3, 0.3, 0.05, 32), shade);
      g.add(disc);
      g.position.set(x, y, z);
    }
    root.add(g);
    const light = new THREE.PointLight(0xffffff, 0, 9, 2);
    light.position.set(x, pendant ? y - 0.2 : WALL_H - 0.3, z);
    root.add(light);
    const dev = {
      id, room, type: 'light', object: g, light, shade, on: false, level: 0.8, cct: 4000,
      apply() {
        const col = kelvinToColor(this.cct);
        this.light.color.copy(col);
        this.light.intensity = this.on ? this.level * (room === 'living' ? 26 : room === 'hall' ? 10 : 16) : 0;
        this.shade.emissive.copy(col);
        this.shade.emissiveIntensity = this.on ? 0.6 + this.level * 2 : 0;
        const info = this.object.userData.info;
        if (info) { info.data.状态 = this.on ? '开' : '关'; info.data.亮度 = Math.round(this.level * 100) + '%'; info.data.色温 = this.cct + ' K'; }
      },
      set(on, level = this.level, cct = this.cct) { this.on = on; this.level = level; this.cct = cct; this.apply(); },
      info: {
        name, category: '智能照明', room, func: '可调亮度与色温（2700K 暖光 ~ 6500K 冷光），支持人体感应自动开关和场景联动',
        data: { 状态: '关', 亮度: '80%', 色温: '4000 K' },
      },
    };
    dev.info.controls = [
      { type: 'toggle', label: '开关', get: () => dev.on, set: (v) => dev.set(v) },
      { type: 'range', label: '亮度', min: 0.1, max: 1, step: 0.05, get: () => dev.level, set: (v) => dev.set(dev.on, v) },
      { type: 'range', label: '色温 (K)', min: 2700, max: 6500, step: 100, get: () => dev.cct, set: (v) => dev.set(dev.on, dev.level, v) },
    ];
    register(dev);
    dev.apply();
    lights.push(dev);
  }
  // 落地灯只有发光效果（不额外增加光源，节省性能）
  register({
    id: 'lamp-floor', room: 'living', type: 'lamp', object: null, on: false,
    set(on) { this.on = on; furnitureHandles.floorLampShade.emissiveIntensity = on ? 1.5 : 0; },
  });

  // 夜间感应灯：老人房床边到门口、走廊的地脚灯带
  const nightMat = uniqueMat({ color: 0x333333, emissive: 0xffb866, emissiveIntensity: 0 });
  const nightStrip = new THREE.Group();
  for (const [x0, x1, z] of [[5.6, 6.1, -2.6], [4.6, 5.4, -1.15], [-7.5, 7.6, -0.88]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.02, 0.02), nightMat);
    m.position.set((x0 + x1) / 2, 0.25, z);
    nightStrip.add(m);
  }
  root.add(nightStrip);
  register({
    id: 'night-light', room: 'elder', type: 'nightLight', object: nightStrip, on: false,
    set(on) { this.on = on; nightMat.emissiveIntensity = on ? 2.5 : 0; },
    info: { name: '夜间感应地脚灯', category: '适老无障碍 / 智能照明', func: '夜间起床时自动点亮床边至卫生间的低位灯带，亮度柔和不刺眼', room: 'elder' },
  });

  // ================= 窗帘 =================
  // 窗帘用起伏的平面表示褶皱；两片窗帘从中间向两侧收拢（缩放 x）
  const curtainDefs = [
    ['curtain-master', 'master', '主卧窗帘', 'z', -4.84, -6.5, -4.5],
    ['curtain-kid', 'kid', '儿童房窗帘', 'z', -4.84, 0.7, 2.7],
    ['curtain-elder', 'elder', '老人房窗帘', 'z', -4.84, 5.0, 7.0],
    ['curtain-living', 'living', '客厅电动窗帘', 'z', 4.84, -6.4, -2.4],
    ['curtain-dining', 'dining', '餐厅窗帘', 'z', 4.84, 0.6, 3.4],
  ];
  const curtainMat = mat('curtain');
  for (const [id, room, name, , c, a, b] of curtainDefs) {
    const w = b - a + 0.4, h = 2.65;
    const g = new THREE.Group();
    const halves = [];
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(w / 2, h, 30, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 28) * 0.035);
      geo.computeVertexNormals();
      // 以窗帘外侧边缘为原点：左片覆盖 [0, w/2]，右片覆盖 [-w/2, 0]，缩放 x 时向外侧收拢
      geo.translate(-side * w / 4, h / 2, 0);
      const pivot = new THREE.Group();
      pivot.position.x = side * w / 2;
      const holder = new THREE.Group();
      const mesh = new THREE.Mesh(geo, curtainMat);
      mesh.castShadow = true;
      holder.add(mesh);
      pivot.add(holder);
      g.add(pivot);
      halves.push({ holder, side });
    }
    // 窗帘轨道
    g.add(box(w + 0.1, 0.04, 0.06, 'darkMetal', 0, h + 0.02, 0));
    g.position.set((a + b) / 2, 0.02, c);
    if (c > 0) g.rotation.y = Math.PI;
    root.add(g);
    const dev = {
      id, room, type: 'curtain', object: g, open: 1, target: 1,
      set(v) { this.target = v ? 1 : 0; },
      update(dt) {
        this.open += Math.sign(this.target - this.open) * Math.min(Math.abs(this.target - this.open), dt * 0.8);
        const s = 1 - 0.8 * this.open; // 打开时每片压缩到 20% 宽度
        for (const hh of halves) hh.holder.scale.x = s;
        const info = this.object.userData.info;
        if (info) info.data.开合度 = Math.round(this.open * 100) + '%';
      },
      info: { name, category: '智能家居', room, func: '电动窗帘，可按场景自动开合；遮光面料，隔热降噪', data: { 开合度: '100%' } },
    };
    dev.info.controls = [{ type: 'toggle', label: '打开', get: () => dev.target > 0.5, set: (v) => dev.set(v) }];
    register(dev);
    dev.update(10);
  }

  // ================= 空调 =================
  const acDefs = [
    ['ac-living', 'living', '客厅空调', -7.86, 2.45, 2.8, '+x'],
    ['ac-master', 'master', '主卧空调', -3.14, 2.45, -2.1, '-x'],
    ['ac-kid', 'kid', '儿童房空调', -0.36, 2.45, -2.4, '+x'],
    ['ac-elder', 'elder', '老人房空调', 4.14, 2.45, -2.1, '+x'],
  ];
  for (const [id, room, name, x, y, z, facing] of acDefs) {
    const g = new THREE.Group();
    g.add(box(0.9, 0.28, 0.2, 'whiteGloss', 0, 0, 0.1, { rounded: 0.04 }));
    g.add(box(0.75, 0.02, 0.01, 'darkMetal', 0, 0.04, 0.2, { cast: false }));
    const led = statusLed(0.012); led.position.set(0.35, 0.2, 0.205); g.add(led);
    wallMount(g, x, y, z, facing);
    const dev = {
      id, room, type: 'ac', object: g, led, on: false, setpoint: 26, mode: '制冷',
      set(on, sp = this.setpoint) { this.on = on; this.setpoint = sp; led.material.emissive.setHex(on ? 0x3fa9f5 : STATUS_COLOR.off); const i = this.object.userData.info; if (i) { i.data.状态 = on ? '运行' : '关闭'; i.data.设定温度 = sp + ' ℃'; } },
      info: { name, category: '空调 / 节能', room, func: '一级能效变频空调，与门窗联动：开窗时自动暂停', maintain: '滤网清洗：2026-06', data: { 状态: '关闭', 设定温度: '26 ℃', 能效等级: '1 级' } },
    };
    dev.info.controls = [
      { type: 'toggle', label: '开关', get: () => dev.on, set: (v) => dev.set(v) },
      { type: 'range', label: '设定温度', min: 16, max: 30, step: 1, get: () => dev.setpoint, set: (v) => dev.set(dev.on, v) },
    ];
    register(dev);
    dev.set(false);
  }

  // ================= 新风系统 =================
  const ventPositions = [[-6.2, -2.2, 'master'], [1.0, -2.2, 'kid'], [6.8, -2.0, 'elder'], [-4.0, 1.5, 'living'], [1.0, 1.6, 'dining'], [-1.6, -3.9, 'bath']];
  const ventGroup = new THREE.Group();
  const vents = [];
  for (const [x, z, room] of ventPositions) {
    const v = box(0.35, 0.02, 0.35, 'plastic', x, WALL_H - 0.03, z, { cast: false });
    const grille = box(0.28, 0.005, 0.28, 'darkMetal', x, WALL_H - 0.035, z, { cast: false });
    ventGroup.add(v, grille);
    vents.push({ x, z, room });
  }
  const freshUnit = box(0.9, 0.16, 0.6, 'whiteGloss', 0.5, WALL_H - 0.17, -0.2);
  ventGroup.add(freshUnit);
  const freshLed = statusLed(0.02); freshLed.position.set(0.96, WALL_H - 0.1, -0.2); ventGroup.add(freshLed);
  root.add(ventGroup);
  const fresh = register({
    id: 'fresh-air', room: 'hall', type: 'freshAir', object: ventGroup, led: freshLed, on: false, level: 2, vents,
    set(on, level = this.level) { this.on = on; this.level = level; freshLed.material.emissive.setHex(on ? STATUS_COLOR.normal : STATUS_COLOR.off); const i = this.object.userData.info; if (i) { i.data.状态 = on ? '运行' : '关闭'; i.data.风量档位 = level + ' 档'; } },
    info: { name: '全热交换新风系统', category: '健康舒适 / 智慧', room: 'hall', func: '室外新风经 H13 过滤后送入各卧室和客厅，同时排出室内污浊空气；热回收效率 75%', maintain: '滤芯更换：2026-05', data: { 状态: '关闭', 风量档位: '2 档', 额定风量: '250 m³/h' } },
  });
  fresh.info.controls = [
    { type: 'toggle', label: '开关', get: () => fresh.on, set: (v) => fresh.set(v) },
    { type: 'range', label: '风量档位', min: 1, max: 3, step: 1, get: () => fresh.level, set: (v) => fresh.set(fresh.on, v) },
  ];
  fresh.set(false);

  // ================= 传感器 =================
  // 每个房间：温湿度传感器（墙上小盒）+ 人体存在传感器（天花板小圆球）
  const sensorRooms = [['master', -3.12, -3.95, '-x'], ['kid', -0.38, -3.9, '+x'], ['elder', 7.88, -1.6, '-x'], ['living', -0.1, 1.2, '-x'], ['kitchen', 4.12, 3.8, '+x'], ['bath', -0.62, -4.3, '-x'], ['dining', 3.88, 3.8, '-x'], ['hall', 7.88, 0.45, '-x']];
  for (const [room, x, z, facing] of sensorRooms) {
    const g = new THREE.Group();
    g.add(box(0.08, 0.08, 0.025, 'plastic', 0, 0, 0.012));
    const led = statusLed(0.008); led.position.set(0, 0.06, 0.026); g.add(led);
    wallMount(g, x, 1.5, z, facing);
    register({
      id: 'env-' + room, room, type: 'envSensor', object: g, led,
      info: { name: '温湿度 / PM2.5 传感器', category: '智慧 / 传感器', room, func: '每 10 秒上报温度、湿度、PM2.5、CO₂', data: {} },
    });
  }
  const presencePos = { master: [-4.0, -1.6], kid: [3.4, -4.4], elder: [4.6, -1.6], living: [-1.0, 1.0], kitchen: [4.6, 1.1], bath: [-0.8, -1.5], dining: [3.5, 4.5], hall: [-1.0, -0.3] };
  for (const [room, [x, z]] of Object.entries(presencePos)) {
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('plastic'));
    s.rotation.x = Math.PI;
    s.position.set(x, WALL_H - 0.01, z);
    root.add(s);
    register({ id: 'presence-' + room, room, type: 'presence', object: s, detected: false, info: { name: '人体存在传感器（毫米波）', category: '智慧 / 传感器', room, func: '检测房间内是否有人及人的位置，用于灯光联动和跌倒检测', data: { 检测结果: '无人' } } });
  }

  // ================= 安全设施 =================
  // 烟雾探测器
  const smokeRooms = { master: [-5.0, -2.2], kid: [2.4, -2.2], elder: [6.4, -2.0], living: [-2.0, 3.8], kitchen: [5.6, 2.3], hall: [-1.5, -0.2], dining: [2.9, 1.3] };
  for (const [room, [x, z]] of Object.entries(smokeRooms)) {
    const g = new THREE.Group();
    g.add(cylinder(0.07, 0.08, 0.04, 'plastic', 0, 0, 0, 20));
    const led = statusLed(0.01); led.position.set(0.04, -0.005, 0); g.add(led);
    g.position.set(x, WALL_H - 0.045, z);
    root.add(g);
    register({ id: 'smoke-' + room, room, type: 'smoke', object: g, led, info: { name: '光电感烟火灾探测器', category: '消防设施', room, func: '检测烟雾浓度，超限时本地声光报警并上报物业消防控制中心', maintain: '月度自检：2026-09 正常', data: { 烟雾浓度: '0.00 dB/m' } } });
  }
  // 可燃气体探测器 + 燃气管道 + 电动切断阀
  const gasDet = new THREE.Group();
  gasDet.add(box(0.12, 0.16, 0.04, 'plastic', 0, 0, 0.02));
  const gasLed = statusLed(0.012); gasLed.position.set(0, 0.12, 0.042); gasDet.add(gasLed);
  wallMount(gasDet, 7.88, 2.55, 1.05, '-x');
  register({ id: 'gas-detector', room: 'kitchen', type: 'gasDetector', object: gasDet, led: gasLed, info: { name: '可燃气体探测器', category: '安全 / 智慧', room: 'kitchen', func: '安装在燃气灶上方靠近天花板处（天然气比空气轻），浓度超标时联动关阀、开窗、启动排风', maintain: '标定：2026-03', data: { 甲烷浓度: '0 %LEL' } } });
  const pipe = new THREE.Group();
  const pv = cylinder(0.02, 0.02, WALL_H - 1.25, 'metal', 0, 1.25, 0, 10);
  pipe.add(pv);
  const valveBody = box(0.12, 0.1, 0.1, 'darkMetal', 0, 1.2, 0.04);
  const actuator = box(0.1, 0.12, 0.12, 'red', 0, 1.3, 0.08);
  const valveHandle = box(0.16, 0.02, 0.025, 'red', 0, 1.24, 0.12);
  pipe.add(valveBody, actuator, valveHandle);
  const hpipe = cylinder(0.015, 0.015, 0.6, 'metal', 0, 0, 0, 8); hpipe.rotation.x = Math.PI / 2; hpipe.position.set(0, 1.1, 0.3); pipe.add(hpipe);
  const valveLed = statusLed(0.015); valveLed.position.set(0, 1.39, 0.12); pipe.add(valveLed);
  wallMount(pipe, 7.88, 0, 1.05, '-x');
  const valve = register({
    id: 'gas-valve', room: 'kitchen', type: 'valve', object: pipe, led: valveLed, open: true, handle: valveHandle,
    set(open) { this.open = open; this.handle.rotation.z = open ? 0 : Math.PI / 2; const i = this.object.userData.info; if (i) i.data.阀门 = open ? '开启' : '已切断'; },
    info: { name: '燃气管道 + 电动切断阀', category: '安全 / 智慧', room: 'kitchen', func: '检测到燃气泄漏或火灾时自动切断气源；可远程控制', maintain: '管道气密性检测：2026-04 合格', data: { 阀门: '开启', 管道压力: '2.0 kPa' } },
  });
  valve.info.controls = [{ type: 'toggle', label: '阀门开启', get: () => valve.open, set: (v) => valve.set(v) }];

  // 灭火器 + 灭火毯
  const extinguisher = (x, z, room) => {
    const g = new THREE.Group();
    g.add(cylinder(0.08, 0.08, 0.45, 'red', 0, 0, 0, 16));
    g.add(cylinder(0.03, 0.05, 0.08, 'darkMetal', 0, 0.45, 0, 8));
    g.add(box(0.12, 0.02, 0.03, 'blackPlastic', 0.04, 0.53, 0));
    g.position.set(x, 0.02, z);
    root.add(g);
    return g;
  };
  register({ id: 'ext-kitchen', room: 'kitchen', type: 'extinguisher', object: extinguisher(4.35, 2.35, 'kitchen'), info: { name: '干粉灭火器（2kg）', category: '消防设施', room: 'kitchen', func: '可扑救初期固体、液体、气体火灾', maintain: '压力正常，有效期至 2029-06', data: { 压力: '1.2 MPa（绿区）' } } });
  register({ id: 'ext-hall', room: 'hall', type: 'extinguisher', object: extinguisher(-7.75, 0.45, 'hall'), info: { name: '干粉灭火器（4kg）', category: '消防设施', room: 'hall', func: '玄关处配置，疏散时可就近取用', maintain: '有效期至 2029-06', data: { 压力: '1.2 MPa（绿区）' } } });
  const blanket = box(0.3, 0.35, 0.08, 'red', 0, 0, 0);
  wallMount(blanket, 4.14, 1.3, 2.6, '+x');
  register({ id: 'fire-blanket', room: 'kitchen', type: 'blanket', object: blanket, info: { name: '灭火毯', category: '消防设施', room: 'kitchen', func: '覆盖油锅起火，隔绝空气灭火' } });

  // 声光报警器（走廊、厨房）+ 报警红光
  const strobeMats = [];
  const strobe = (x, y, z, facing, id, room) => {
    const m = uniqueMat({ color: 0x661111, emissive: 0xff2020, emissiveIntensity: 0, transparent: true, opacity: 0.95 });
    strobeMats.push(m);
    const g = new THREE.Group();
    g.add(box(0.14, 0.14, 0.05, 'plastic', 0, 0, 0.025));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
    dome.rotation.x = Math.PI / 2; dome.position.set(0, 0.07, 0.05);
    g.add(dome);
    wallMount(g, x, y, z, facing);
    register({ id, room, type: 'strobe', object: g, info: { name: '壁挂式声光报警器', category: '消防设施', room, func: '火灾、燃气泄漏、一键呼叫时发出声光警报', maintain: '2026-09 测试正常' } });
  };
  strobe(-7.88, 2.4, 0.45, '+x', 'strobe-hall', 'hall');
  strobe(4.12, 2.4, 3.2, '+x', 'strobe-kitchen', 'kitchen');
  strobe(7.88, 2.2, -1.6, '-x', 'strobe-elder', 'elder');
  const alarmLight = new THREE.PointLight(0xff2020, 0, 12, 2);
  alarmLight.position.set(0, 2.6, -0.2);
  root.add(alarmLight);

  // 安全出口标志 + 应急照明
  const exitTex = textTexture(['安全出口', 'EXIT'], { w: 256, h: 110, bg: '#0f7a3a', font: 'bold 40px "Microsoft YaHei", sans-serif' });
  const exitMats = [];
  const exitSign = (x, y, z, facing, name) => {
    const m = new THREE.MeshStandardMaterial({ map: exitTex, emissive: 0xffffff, emissiveMap: exitTex, emissiveIntensity: 0.4 });
    exitMats.push(m);
    const g = new THREE.Group();
    g.add(box(0.42, 0.2, 0.03, 'plastic', 0, 0, 0.015));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.17), m);
    face.position.z = 0.032; face.position.y = 0.1;
    g.add(face);
    wallMount(g, x, y, z, facing);
    register({ id: 'exit-' + name, room: 'hall', type: 'exitSign', object: g, info: { name: '安全出口标志（' + name + '）', category: '消防设施', func: '自带蓄电池，断电后持续点亮 ≥ 90 分钟', maintain: '2026-09 巡检正常' } });
  };
  exitSign(-7.88, 2.45, -0.2, '+x', '入户门');
  exitSign(7.88, 2.45, -0.2, '-x', '后门');
  exitSign(-4.4, 2.72, 4.88, '-z', '客厅落地门');
  const emergencyMats = [];
  for (const x of [-6, 0, 5.5]) {
    const m = uniqueMat({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 });
    emergencyMats.push(m);
    const g = box(0.3, 0.08, 0.1, m, x, WALL_H - 0.1, -0.84);
    root.add(g);
    register({ id: 'emergency-' + x, room: 'hall', type: 'emergency', object: g, info: { name: '应急照明灯', category: '消防设施', room: 'hall', func: '火灾或停电时自动点亮，照亮疏散通道' } });
  }

  // 一键呼叫按钮（老人房床头、卫生间马桶旁）
  const sosButton = (id, room, x, y, z, facing, name) => {
    const g = new THREE.Group();
    g.add(box(0.12, 0.12, 0.03, 'plastic', 0, 0, 0.015));
    const m = uniqueMat({ color: 0xcc2222, emissive: 0xff0000, emissiveIntensity: 0.15 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), m);
    btn.rotation.x = Math.PI / 2; btn.position.set(0, 0.06, 0.035);
    g.add(btn);
    // 拉绳（跌倒在地时也能够到）
    g.add(cylinder(0.003, 0.003, 0.6, 'plastic', 0, -0.55, 0.03, 4));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat('red')).translateY(-0.56).translateZ(0.03));
    wallMount(g, x, y, z, facing);
    const dev = register({ id, room, type: 'sos', object: g, btnMat: m, active: false, info: { name, category: '安全 / 适老', room, func: '紧急情况下按下按钮或拉绳，立即向家属手机和物业值班终端发送求助信息', data: { 状态: '待机' } } });
    return dev;
  };
  sosButton('sos-elder', 'elder', 7.6, 0.85, -4.88, '+z', '一键呼叫按钮（老人房床头）');
  sosButton('sos-bath', 'bath', -2.88, 0.85, -2.45, '+x', '一键呼叫按钮（卫生间）');

  // 水浸传感器（卫生间地面）
  const leak = box(0.08, 0.02, 0.08, 'plastic', -1.4, 0.015, -4.6, { cast: false });
  root.add(leak);
  register({ id: 'leak-bath', room: 'bath', type: 'leak', object: leak, info: { name: '水浸传感器', category: '安全 / 智慧', room: 'bath', func: '检测地面积水，联动关闭进水总阀' } });

  // 配电箱 + 家庭网关 + 可视对讲 + 智能门锁 + 摄像头
  const panel = new THREE.Group();
  panel.add(box(0.45, 0.55, 0.12, 'whiteGloss', 0, 0, 0.06));
  const panelLed = statusLed(0.015); panelLed.position.set(0.17, 0.5, 0.125); panel.add(panelLed);
  wallMount(panel, -5.9, 1.35, -0.9, '+z');
  register({ id: 'distribution', room: 'hall', type: 'distribution', object: panel, led: panelLed, info: { name: '智能配电箱', category: '安全 / 绿色', room: 'hall', func: '漏电保护、过载保护；分回路计量用电，数据接入能源管理系统', maintain: '绝缘测试：2026-07 合格', data: { 总电流: '—', 漏电流: '2 mA' } } });
  const gateway = new THREE.Group();
  gateway.add(box(0.2, 0.2, 0.04, 'whiteGloss', 0, 0, 0.02, { rounded: 0.01 }));
  const gwLed = statusLed(0.01); gwLed.position.set(0, 0.15, 0.042); gateway.add(gwLed);
  wallMount(gateway, -5.3, 1.5, -0.9, '+z');
  register({ id: 'gateway', room: 'hall', type: 'gateway', object: gateway, led: gwLed, info: { name: '家庭智能网关', category: '智慧', room: 'hall', func: '连接全屋传感器与设备（Zigbee / Wi-Fi），执行场景联动规则，上报物业平台', data: { 在线设备: '—' } } });
  const intercom = new THREE.Group();
  intercom.add(box(0.18, 0.26, 0.03, 'blackPlastic', 0, 0, 0.015));
  const icScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1), uniqueMat({ color: 0x111111, emissive: 0x4488ff, emissiveIntensity: 0.3 }));
  icScreen.position.set(0, 0.16, 0.031); intercom.add(icScreen);
  wallMount(intercom, -7.88, 1.4, 0.48, '+x');
  register({ id: 'intercom', room: 'hall', type: 'intercom', object: intercom, info: { name: '可视对讲室内机', category: '智慧 / 安防', room: 'hall', func: '查看门口访客画面，远程开门' } });
  const doorLeaf = house.doors['door-entry'].pivot;
  const lockG = new THREE.Group();
  lockG.add(box(0.07, 0.28, 0.04, 'blackPlastic', 0, 0, 0));
  const lockLed = statusLed(0.01); lockLed.position.set(0, 0.22, 0.022); lockG.add(lockLed);
  lockG.position.set(0.85, 0.95, 0.045);
  doorLeaf.add(lockG);
  const lock = register({
    id: 'smart-lock', room: 'hall', type: 'lock', object: lockG, led: lockLed, locked: true,
    set(locked) { this.locked = locked; lockLed.material.emissive.setHex(locked ? 0x3fa9f5 : STATUS_COLOR.normal); const i = this.object.userData.info; if (i) i.data.状态 = locked ? '已上锁' : '已开锁'; },
    info: { name: '智能门锁', category: '智慧 / 安防', room: 'hall', func: '指纹 / 人脸 / 手机开锁；火灾时自动解锁便于疏散', data: { 状态: '已上锁', 电量: '86%' } },
  });
  lock.info.controls = [{ type: 'toggle', label: '上锁', get: () => lock.locked, set: (v) => lock.set(v) }];
  lock.set(true);
  const cam = new THREE.Group();
  cam.add(box(0.1, 0.1, 0.2, 'whiteGloss', 0, 0, 0.1, { rounded: 0.02 }));
  cam.add(cylinder(0.03, 0.03, 0.02, 'blackPlastic', 0, -0.01, 0.2, 12).rotateX(Math.PI / 2));
  wallMount(cam, -8.12, 2.45, 0.8, '-x');
  register({ id: 'camera', room: 'hall', type: 'camera', object: cam, info: { name: '门口摄像头', category: '智慧 / 安防', func: '离家模式下自动布防，检测到陌生人徘徊时推送提醒', data: { 状态: '在线' } } });

  // ================= 绿色能源设施 =================
  // 屋顶光伏：3 排 × 10 块，每块 1.0m × 1.7m、约 330W，朝南倾斜 20°
  const pvGroup = new THREE.Group();
  pvGroup.name = 'pv';
  const panelGeo = new THREE.BoxGeometry(1.0, 0.04, 1.7);
  const solarMat = mat('solar');
  const pvPanels = [];
  for (const zc of [-3.4, -0.4, 2.6]) for (let i = 0; i < 10; i++) {
    const x = -5.2 + i * 1.08;
    const p = new THREE.Mesh(panelGeo, solarMat);
    p.position.set(x, WALL_H + 0.25 + 0.55, zc);
    p.rotation.x = THREE.MathUtils.degToRad(20); // 绕 x 轴转 20°，南侧（+z）低、北侧高，板面朝南
    p.castShadow = true; p.receiveShadow = true;
    pvGroup.add(p);
    pvPanels.push(p);
    pvGroup.add(box(0.04, 0.78, 0.04, 'metal', x, WALL_H + 0.25, zc - 0.7));
    pvGroup.add(box(0.04, 0.3, 0.04, 'metal', x, WALL_H + 0.25, zc + 0.7));
  }
  root.add(pvGroup);
  register({ id: 'pv', room: null, type: 'pv', object: pvGroup, info: { name: '屋顶光伏阵列', category: '绿色低碳', func: '30 块单晶硅组件，装机 9.9 kWp，朝南倾角 20°。光伏发电 → 逆变器 → 家庭用电 / 储能电池 / 余电上网', maintain: '组件清洗：2026-08', data: { 装机容量: '9.9 kWp', 当前功率: '—' } } });
  // 逆变器（东外墙）、储能电池柜、空气源热泵
  const inv = new THREE.Group();
  inv.add(box(0.5, 0.6, 0.2, 'whiteGloss', 0, 0, 0.1, { rounded: 0.02 }));
  const invScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), uniqueMat({ color: 0x111111, emissive: 0x33ff99, emissiveIntensity: 0.6 }));
  invScreen.position.set(0, 0.42, 0.201); inv.add(invScreen);
  const invLed = statusLed(0.015); invLed.position.set(0.18, 0.52, 0.2); inv.add(invLed);
  wallMount(inv, 8.1, 1.3, 1.2, '+x');
  register({ id: 'inverter', room: null, type: 'inverter', object: inv, led: invLed, info: { name: '光伏逆变器', category: '绿色低碳', func: '把光伏板的直流电转换为 220V 交流电，最大转换效率 98%', maintain: '2026-09 运行正常', data: {} } });
  const bat = new THREE.Group();
  bat.add(box(0.6, 1.1, 0.4, 'whiteGloss', 0, 0, 0, { rounded: 0.03 }));
  const socBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.01), uniqueMat({ color: 0x113311, emissive: 0x2ecc71, emissiveIntensity: 1 }));
  socBar.position.set(0.31, 0.55, 0); socBar.rotation.y = Math.PI / 2; bat.add(socBar);
  bat.position.set(8.55, 0, 2.1);
  bat.rotation.y = Math.PI / 2;
  root.add(bat);
  register({ id: 'battery', room: null, type: 'battery', object: bat, socBar, info: { name: '家用储能电池', category: '绿色低碳', func: '白天储存多余光伏电量，夜间放电供家庭使用，减少从电网购电', data: { 容量: '10 kWh' } } });
  const hp = new THREE.Group();
  hp.add(box(0.95, 0.75, 0.4, 'whiteGloss', 0, 0, 0, { rounded: 0.02 }));
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 24), mat('darkMetal'));
  fanRing.position.set(-0.15, 0.38, 0.21); hp.add(fanRing);
  const fan = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.01), mat('darkMetal'));
  fan.position.set(-0.15, 0.38, 0.21); hp.add(fan);
  hp.position.set(9.2, 0, -4.2);
  hp.rotation.y = Math.PI / 2;
  root.add(hp);
  register({ id: 'heatpump', room: null, type: 'heatpump', object: hp, fan, info: { name: '空气源热泵热水机', category: '绿色低碳', func: '从空气中吸热制取生活热水，能效比 COP≈4，比电热水器省电约 75%', data: { COP: '4.1', 水箱温度: '52 ℃' } } });

  return { root, byId, list, lights, setStatus, strobeMats, alarmLight, exitMats, emergencyMats, nightStrip };
}
