// 智慧便捷：
//  1. 场景模式：回家 / 离家 / 睡眠 / 观影 / 自动（人体感应），多设备协同变化
//  2. 设备列表与控制：点击设备查看数据并开关、调节
//  3. 联动演示：燃气泄漏 → 报警 → 关阀 → 开窗 → 排风；室外雾霾 → 关窗 → 开新风
//  4. 数字孪生运维：建筑半透明、设备按状态着色、模拟故障并自动定位
import * as THREE from 'three';
import { ROOMS, roomById } from '../scene/layout.js';
import { STATUS_COLOR, STATUS_TEXT } from '../scene/devices.js';
import { Emitter } from '../systems/particles.js';
import { StatusPins } from '../systems/statusPins.js';
import { section, button, buttonGroup, logBox, chart, chartBase, hint, el, toast, toggle } from '../ui/ui.js';

const MODES = [
  { value: 'home', label: '🏠 回家' }, { value: 'away', label: '🚪 离家' }, { value: 'sleep', label: '🌙 睡眠' },
  { value: 'movie', label: '🎬 观影' }, { value: 'auto', label: '👣 自动感应' },
];

export class SmartFeature {
  constructor(app) {
    this.app = app;
    this.mode = 'auto';
    this.tvOn = false;
    this.presence = {};       // 房间 → 最近一次检测到人的时间
    this.time = 0;
    // 电视画面：用 Canvas 绘制动态画面
    const c = document.createElement('canvas'); c.width = 256; c.height = 144;
    this.tvCanvas = c;
    this.tvTex = new THREE.CanvasTexture(c);
    this.tvTex.colorSpace = THREE.SRGBColorSpace;
    const tv = app.furniture.handles.tv;
    tv.screenMat.emissiveMap = this.tvTex;
    tv.screenMat.map = this.tvTex;
    this.tvLight = new THREE.PointLight(0x88aaff, 0, 6, 2);
    this.tvLight.position.set(-4.2, 1.4, 2.8);
    app.scene.add(this.tvLight);
    // 燃气泄漏粒子：淡黄色半透明团雾，从灶台扩散并向上聚集
    this.gas = new Emitter(app.scene, {
      count: 700, rate: 90, life: [5, 8], size: [0.3, 1.3], alpha: [0.35, 0],
      colors: [new THREE.Color(0.95, 0.9, 0.35), new THREE.Color(0.85, 0.85, 0.55)],
      spawn: (p) => { p.x = 7.5 + (Math.random() - 0.5) * 0.4; p.y = 1.0; p.z = 1.6 + (Math.random() - 0.5) * 0.4; p.vx = -Math.random() * 0.5; p.vy = 0.3 + Math.random() * 0.3; p.vz = (Math.random() - 0.5) * 0.6; },
      force: (p, dt) => {
        if (this.gasVent) { p.vx += dt * 1.2; p.vz += dt * 0.6; } // 开窗排风后被吹向东侧窗户
        if (p.y > 2.7) { p.y = 2.7; p.vy = 0; }
        if (p.x < 4.2) { p.x = 4.2; p.vx = Math.abs(p.vx); }
        if (p.z < 0.8) { p.z = 0.8; p.vz = Math.abs(p.vz); }
        if (p.z > 4.8) { p.z = 4.8; p.vz = -Math.abs(p.vz); }
        if (p.x > 7.8 && !this.gasVent) { p.x = 7.8; p.vx = -Math.abs(p.vx); }
      },
    });
    this.gasLevel = 0;
    this.gasHistory = [];
    this.pins = new StatusPins(app.scene, app.devices, (d) => d.type !== 'presence' && d.type !== 'envSensor' && d.type !== 'exitSign' && d.type !== 'emergency');
    this.twin = false;
  }

  // ================= 场景模式 =================
  setMode(m) {
    const app = this.app, d = app.devices.byId, dev = app.devices;
    this.mode = m;
    const dark = app.sunFactor < 0.25 || app.clock.hour < 7 || app.clock.hour > 18.5;
    const curtains = dev.list.filter((x) => x.type === 'curtain');
    const acs = dev.list.filter((x) => x.type === 'ac');
    const changes = [];
    const allLights = (on) => dev.lights.forEach((l) => l.set(on));
    d['night-light'].set(false);
    d['lamp-floor'].set(false);
    this.setTV(false);
    if (m === 'home') {
      d['smart-lock'].set(false);
      setTimeout(() => { if (this.mode === 'home') d['smart-lock'].set(true); }, 5000);
      allLights(false);
      if (dark) { d['light-hall-w'].set(true, 0.8, 4000); d['light-living'].set(true, 0.85, 3500); d['light-dining'].set(true, 0.7, 3200); }
      curtains.forEach((c) => c.set(!dark));
      d['ac-living'].set(true, 26);
      d['fresh-air'].set(true, 2);
      d['gas-valve'].set(true);
      changes.push('门锁开启（5 秒后自动上锁）', dark ? '玄关、客厅、餐厅灯开启（暖白 3500K）' : '白天光线充足，灯保持关闭', dark ? '窗帘关闭' : '窗帘打开', '客厅空调 26℃', '新风 2 档');
      this.bringPeopleHome();
    } else if (m === 'away') {
      allLights(false);
      curtains.forEach((c) => c.set(false));
      acs.forEach((a) => a.set(false));
      d['fresh-air'].set(true, 1);
      d['smart-lock'].set(true);
      d['gas-valve'].set(false);
      for (const w of Object.values(app.house.windows)) if (w.op.kind === 'window') w.setOpen(false);
      d.camera.object.userData.info.data.状态 = '已布防';
      changes.push('全部灯光关闭', '窗帘、门窗关闭', '空调关闭', '新风低速 1 档', '燃气阀门关闭', '门锁上锁，摄像头布防');
      this.sendPeopleOut();
    } else if (m === 'sleep') {
      allLights(false);
      d['night-light'].set(true);
      curtains.forEach((c) => c.set(false));
      acs.forEach((a) => a.set(a.room !== 'living', 27));
      d['fresh-air'].set(true, 1);
      d['smart-lock'].set(true);
      changes.push('全部灯光关闭', '夜间感应地脚灯开启', '窗帘关闭', '卧室空调睡眠 27℃', '新风静音 1 档', '门锁上锁');
    } else if (m === 'movie') {
      allLights(false);
      d['light-living'].set(true, 0.18, 2700);
      d['lamp-floor'].set(true);
      d['curtain-living'].set(false);
      d['curtain-dining'].set(false);
      d['ac-living'].set(true, 25);
      this.setTV(true);
      changes.push('客厅主灯调暗至 18%、暖光 2700K', '落地灯开启', '客厅窗帘关闭', '电视开启', '客厅空调 25℃');
      app.rig.flyTo([-7.2, 1.7, 4.3], [-3.6, 1.3, 2.4]);
      app.setRoof(true);
    } else if (m === 'auto') {
      allLights(false);
      curtains.forEach((c) => c.set(true));
      changes.push('人体存在传感器接管灯光：有人且光线不足时开灯，人离开 3 秒后关灯', '走廊灯随人员移动依次亮起');
    }
    d.camera.object.userData.info.data.状态 = m === 'away' ? '已布防' : '在线';
    this.logBox.add(this.clock(), `切换到【${MODES.find((x) => x.value === m).label.slice(2).trim()}】模式`, 'ok');
    for (const c of changes) this.logBox.add('', '　- ' + c);
    this.modeBtns?.refresh();
    toast(`已切换到${MODES.find((x) => x.value === m).label}模式`);
  }

  clock() {
    const h = this.app.clock.hour;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  }

  sendPeopleOut() {
    for (const p of this.app.people.list) {
      if (!p.object.visible) continue;
      p.mode = 'stop'; p.activity = '出门';
      p.goTo(-10.5, -0.2, { onArrive: () => { p.object.visible = false; p.activity = '不在家'; } });
      this.app.house.doors['door-entry'].setOpen(true);
    }
    setTimeout(() => this.app.house.doors['door-entry'].setOpen(false), 12000);
  }

  bringPeopleHome() {
    const app = this.app;
    app.people.list.forEach((p, i) => {
      if (p.object.visible) return;
      p.object.visible = true;
      p.setPosition(-11, -0.2 + i * 0.5);
      app.house.doors['door-entry'].setOpen(true);
      p.activity = '回家';
      p.goTo(-6.3 + i * 1.2, 2.0, { onArrive: () => { p.mode = 'routine'; p.waitTimer = 3; } });
      setTimeout(() => app.house.doors['door-entry'].setOpen(false), 9000);
    });
    for (const p of app.people.list) if (p.mode === 'stop' && p.object.visible && !p.path.length) p.mode = 'routine';
  }

  setTV(on) {
    this.tvOn = on;
    const tv = this.app.furniture.handles.tv;
    tv.screenMat.emissiveIntensity = on ? 1.2 : 0;
    tv.screenMat.color.setHex(on ? 0xffffff : 0x050608);
    this.tvLight.intensity = on ? 3 : 0;
  }

  drawTV() {
    const g = this.tvCanvas.getContext('2d'), t = this.time;
    const grd = g.createLinearGradient(0, 0, 256, 144);
    grd.addColorStop(0, `hsl(${(t * 20) % 360},60%,35%)`);
    grd.addColorStop(1, `hsl(${(t * 20 + 120) % 360},60%,20%)`);
    g.fillStyle = grd; g.fillRect(0, 0, 256, 144);
    // 远山与月亮，像一段风景片
    g.fillStyle = 'rgba(255,255,240,0.9)';
    g.beginPath(); g.arc(200 - (t * 6) % 60, 40, 14, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 3; k++) {
      g.fillStyle = `rgba(20,30,40,${0.35 + k * 0.2})`;
      g.beginPath(); g.moveTo(0, 144);
      for (let x = 0; x <= 256; x += 8) g.lineTo(x, 95 + k * 14 + Math.sin(x / (30 + k * 10) + t * (0.3 + k * 0.2)) * (12 - k * 3));
      g.lineTo(256, 144); g.fill();
    }
    g.fillStyle = '#fff'; g.font = '12px sans-serif'; g.fillText('家庭影院 · 播放中', 8, 16);
    this.tvTex.needsUpdate = true;
    this.tvLight.color.setHSL(((t * 20) % 360) / 360, 0.5, 0.6);
  }

  // 人体感应：有人进入 → 开灯；离开 3 秒 → 关灯。只有光线不足（或无窗房间）才开灯
  presenceControl() {
    const app = this.app, now = this.time;
    const dark = app.sunFactor < 0.35 || app.clock.hour < 7 || app.clock.hour > 18;
    for (const r of ROOMS) {
      const people = app.people.list.filter((p) => p.object.visible && p.room === r.id);
      const sensor = app.devices.byId['presence-' + r.id];
      if (sensor) sensor.object.userData.info.data.检测结果 = people.length ? `有人（${people.map((p) => p.name).join('、')}）` : '无人';
      if (people.length) this.presence[r.id] = now;
      const needLight = dark || r.id === 'bath' || r.id === 'hall';
      const lights = app.devices.lights.filter((l) => l.room === r.id);
      for (const l of lights) {
        let on = needLight && now - (this.presence[r.id] ?? -99) < 3;
        // 走廊较长：只点亮人附近的那一盏灯，人走过时灯依次亮起
        if (r.id === 'hall') on = needLight && app.people.list.some((p) => p.object.visible && p.room === 'hall' && Math.abs(p.x - l.light.position.x) < 4.5);
        if (on !== l.on) l.set(on, 0.8, r.id === 'bath' ? 5000 : 4000);
      }
    }
  }

  // ================= 燃气泄漏联动 =================
  startGasLeak() {
    const app = this.app;
    this.stopGasLeak(true);
    this.gasActive = true; this.gasT = 0; this.gasLevel = 0; this.gasVent = false; this.gasSteps = new Set(); this.gasHistory = [];
    this.gas.start();
    this.logBox.add(this.clock(), '厨房燃气管道接口泄漏（模拟）', 'err');
    app.setRoof(false);
    app.rig.flyTo([3.0, 5.0, 5.5], [6.8, 1.2, 1.8]);
  }

  gasTimeline(dt) {
    const app = this.app, d = app.devices.byId, T = (this.gasT += dt);
    const once = (k, fn) => { if (!this.gasSteps.has(k) && fn.cond()) { this.gasSteps.add(k); fn.run(); } };
    // 浓度：阀门开着时持续上升，关阀后停止增加，开窗排风后快速下降
    if (d['gas-valve'].open) this.gasLevel += dt * 4.5;
    else if (this.gasVent) this.gasLevel = Math.max(0, this.gasLevel - dt * 6);
    d['gas-detector'].object.userData.info.data.甲烷浓度 = this.gasLevel.toFixed(0) + ' %LEL';
    once('warn', { cond: () => this.gasLevel >= 10, run: () => { app.devices.setStatus('gas-detector', 'warning'); this.logBox.add(this.clock(), `可燃气体探测器预警：${this.gasLevel.toFixed(0)}%LEL`, 'warn'); } });
    once('alarm', {
      cond: () => this.gasLevel >= 20,
      run: () => {
        app.devices.setStatus('gas-detector', 'fault');
        this.gasAlarm = true;
        toast('⚠ 燃气泄漏报警：厨房', 'alarm', 3500);
        this.logBox.add(this.clock(), `浓度达到 ${this.gasLevel.toFixed(0)}%LEL，声光报警，推送家属手机`, 'err');
      },
    });
    once('valve', { cond: () => this.gasSteps.has('alarm') && T > this.alarmAt(), run: () => { d['gas-valve'].set(false); app.devices.setStatus('gas-valve', 'warning'); this.logBox.add(this.clock(), '联动 1：电动阀门切断燃气', 'warn'); } });
    once('window', {
      cond: () => this.gasSteps.has('valve') && T > this.alarmAt() + 1.5,
      run: () => {
        app.house.windows['win-kitchen-e'].setOpen(true); app.house.windows['win-kitchen-s'].setOpen(true);
        this.gasVent = true;
        this.logBox.add(this.clock(), '联动 2：打开厨房外窗，启动排风（禁止开关电器，防止电火花）', 'warn');
      },
    });
    once('fresh', { cond: () => this.gasSteps.has('window') && T > this.alarmAt() + 2.5, run: () => { d['fresh-air'].set(true, 3); this.logBox.add(this.clock(), '联动 3：新风系统 3 档运行，加快换气', 'warn'); } });
    once('done', {
      cond: () => this.gasSteps.has('fresh') && this.gasLevel <= 0.5,
      run: () => {
        app.devices.setStatus('gas-detector', 'normal');
        this.gasAlarm = false;
        this.gas.stop();
        this.logBox.add(this.clock(), '燃气浓度恢复正常，报警解除；阀门保持关闭，等待人工检修', 'ok');
        toast('燃气浓度已恢复正常');
      },
    });
    if (this.gasSteps.has('alarm') && !this.alarmTime) this.alarmTime = T;
    if (this.gasHistory.length < 3000) this.gasHistory.push([+T.toFixed(1), +this.gasLevel.toFixed(1)]);
  }
  alarmAt() { return (this.alarmTime ?? 1e9) + 1; }

  stopGasLeak(silent) {
    const app = this.app;
    this.gasActive = false; this.gasAlarm = false; this.gasVent = false; this.alarmTime = null;
    this.gas.clear();
    app.devices.setStatus('gas-detector', 'normal');
    app.devices.setStatus('gas-valve', 'normal');
    app.devices.byId['gas-valve'].set(true);
    app.devices.byId['gas-detector'].object.userData.info.data.甲烷浓度 = '0 %LEL';
    for (const m of app.devices.strobeMats) m.emissiveIntensity = 0;
    if (!silent) { app.house.windows['win-kitchen-e'].setOpen(false); app.house.windows['win-kitchen-s'].setOpen(false); this.logBox.add(this.clock(), '燃气系统检修完成，复位', 'ok'); }
  }

  // ================= 空气质量联动 =================
  startHaze() {
    const app = this.app, env = app.envModel;
    env.haze = 1;
    app.setTime(app.clock.hour);
    for (const w of Object.values(app.house.windows)) if (w.op.kind === 'window') w.setOpen(true);
    app.devices.byId['fresh-air'].set(false);
    this.hazeWatch = true;
    this.logBox.add(this.clock(), '室外出现雾霾，PM2.5 升高（模拟）；当前门窗打开、新风关闭', 'warn');
    app.features.layers.setHeatmap('pm');
    app.rig.flyTo([0, 24, 10], [0, 0, 0.5]);
  }

  hazeControl() {
    const app = this.app, env = app.envModel;
    if (!this.hazeWatch) return;
    const worst = Math.max(...ROOMS.map((r) => env.rooms[r.id].pm));
    if (!this.hazeActed && worst > 60) {
      this.hazeActed = true;
      for (const w of Object.values(app.house.windows)) w.setOpen(false);
      app.devices.byId['fresh-air'].set(true, 3);
      this.logBox.add(this.clock(), `室内 PM2.5 达 ${worst.toFixed(0)} μg/m³（超过 60）→ 自动关闭门窗，新风 3 档运行（H13 高效过滤）`, 'warn');
      toast('空气质量联动：关窗 + 新风净化');
    }
    if (this.hazeActed && worst < 25) {
      this.logBox.add(this.clock(), `室内 PM2.5 降至 ${worst.toFixed(0)} μg/m³，空气质量恢复优良`, 'ok');
      this.hazeWatch = false; this.hazeActed = false;
    }
  }

  stopHaze() {
    this.app.envModel.haze = 0; this.hazeWatch = false; this.hazeActed = false;
    this.app.setTime(this.app.clock.hour);
    this.logBox.add(this.clock(), '雾霾消散', 'ok');
  }

  // ================= 数字孪生运维 =================
  setTwin(on) {
    const app = this.app;
    this.twin = on;
    this.pins.visible = on;
    if (!this.fadeMats) {
      // 收集建筑和家具用到的所有材质
      const set = new Set();
      for (const root of [app.house.root, app.furniture.root]) root.traverse((o) => { if (o.isMesh) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => set.add(m)); });
      this.fadeMats = [...set].map((m) => ({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }));
    }
    for (const f of this.fadeMats) {
      f.m.transparent = on ? true : f.transparent;
      f.m.opacity = on ? Math.min(f.opacity, 0.12) : f.opacity;
      f.m.depthWrite = on ? false : f.depthWrite;
      f.m.needsUpdate = true;
    }
    if (on) { app.setRoof(true); app.rig.flyTo([12, 13, 16], [1, 1, 0]); }
    this.twinToggle?.refresh();
  }

  simulateFault() {
    const app = this.app;
    const candidates = ['heatpump', 'fresh-air', 'inverter', 'distribution', 'ac-master'];
    const id = candidates[Math.floor(Math.random() * candidates.length)];
    const d = app.devices.byId[id];
    const faults = {
      heatpump: ['压缩机排气温度过高（E4）', '水箱温度 38℃，制热效率下降'],
      'fresh-air': ['送风机转速异常（1200 → 450 rpm）', '疑似滤网严重堵塞'],
      inverter: ['直流侧绝缘阻抗低（PV2 组串）', '发电功率下降 35%'],
      distribution: ['厨房回路漏电流 28mA（接近 30mA 保护值）', '建议检查厨房电器插座'],
      'ac-master': ['室外机通信故障（E6）', '空调停止运行'],
    }[id];
    this.setTwin(true);
    app.devices.setStatus(id, 'fault');
    d.object.userData.info.data = { ...(d.object.userData.info.data ?? {}), 故障: faults[0], 影响: faults[1] };
    d.object.userData.info.maintain = '上次维保：2026-05-12；本次故障已自动生成维修工单 #' + (1000 + Math.floor(Math.random() * 9000));
    d.object.userData.info.controls = [{ type: 'button', label: '派单维修（修复）', onClick: () => this.repair(id) }];
    this.faultId = id;
    this.logBox.add(this.clock(), `【故障】${d.info.name}：${faults[0]}`, 'err');
    this.logBox.add('', '　- 系统已自动定位故障设备并生成维修工单，其余构件透明化显示');
    toast('⚠ 设备故障：' + d.info.name, 'alarm', 3500);
    setTimeout(() => app.selection.selectDevice(id), 300);
  }

  repair(id = this.faultId) {
    if (!id) return;
    const d = this.app.devices.byId[id];
    this.app.devices.setStatus(id, 'normal');
    delete d.object.userData.info.data.故障;
    delete d.object.userData.info.data.影响;
    d.object.userData.info.maintain = '2026-09 维修完成，运行正常';
    d.object.userData.info.controls = d.info.controls;
    this.logBox.add(this.clock(), `${d.info.name} 维修完成，恢复正常`, 'ok');
    this.faultId = null;
    this.app.selection.select(d.object);
  }

  // ================= 面板 =================
  buildPanel(root) {
    const app = this.app;
    const s1 = section('场景模式', '一键切换生活场景，灯光（亮度、色温）、窗帘、空调、新风、电视、门锁协同变化。“自动感应”模式下，人体存在传感器检测到有人就开灯，走廊灯随人员移动依次点亮。');
    this.modeBtns = buttonGroup(MODES, () => this.mode, (v) => this.setMode(v));
    s1.append(this.modeBtns);
    s1.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('时间设为晚上 8 点', () => { app.setTime(20); app.syncTime(); }),
      button('时间设为上午 10 点', () => { app.setTime(10); app.syncTime(); }),
      button('全屋俯视', () => { app.setRoof(false); app.rig.flyTo([0, 22, 11], [0, 0, 0]); }),
    ));
    root.append(s1);

    const s2 = section('设备列表', '点击设备可在右侧查看实时数据并直接控制（开关、亮度、色温、温度等）。');
    this.devList = el('div', { class: 'dev-list' });
    s2.append(this.devList);
    root.append(s2);
    this.renderDevList();

    const s3 = section('联动演示');
    s3.append(el('div', { class: 'btns' },
      button('⚠ 模拟燃气泄漏', () => this.startGasLeak(), 'danger'),
      button('复位燃气', () => this.stopGasLeak()),
      button('🌫 模拟室外雾霾', () => this.startHaze(), 'primary'),
      button('雾霾消散', () => this.stopHaze()),
    ));
    this.gasChart = chart(150);
    s3.append(this.gasChart);
    root.append(s3);

    const s4 = section('数字孪生运维', '将设备运行数据映射到三维模型：绿色 = 正常，黄色 = 预警，红色 = 故障。模拟设备异常时，系统自动定位故障设备，并把其他构件透明化。');
    this.twinToggle = toggle('运维视图（建筑透明化 + 状态标记）', () => this.twin, (v) => this.setTwin(v));
    s4.append(this.twinToggle);
    s4.append(el('div', { class: 'btns' }, button('模拟设备故障', () => this.simulateFault(), 'danger'), button('派单维修', () => this.repair())));
    root.append(s4);

    const s5 = section('运行日志');
    this.logBox = logBox();
    s5.append(this.logBox);
    root.append(s5);
  }

  renderDevList() {
    const app = this.app;
    const types = ['light', 'curtain', 'ac', 'freshAir', 'lock', 'valve', 'camera', 'gateway', 'gasDetector', 'heatpump', 'inverter', 'battery', 'distribution'];
    const list = app.devices.list.filter((d) => types.includes(d.type) && d.object);
    const html = list.map((d) => {
      let st = STATUS_TEXT[d.status];
      if (d.type === 'light') st = d.on ? `开 ${Math.round(d.level * 100)}% ${d.cct}K` : '关';
      if (d.type === 'ac') st = d.on ? `运行 ${d.setpoint}℃` : '关';
      if (d.type === 'curtain') st = d.open > 0.5 ? '打开' : '关闭';
      if (d.type === 'freshAir') st = d.on ? `${d.level} 档` : '关';
      if (d.type === 'lock') st = d.locked ? '已上锁' : '已开锁';
      if (d.type === 'valve') st = d.open ? '开启' : '已切断';
      const color = '#' + STATUS_COLOR[d.status].toString(16).padStart(6, '0');
      return `<div class="dev-item" data-id="${d.id}"><span class="dot" style="background:${color}"></span><span class="name">${d.info.name}</span><span class="st">${st}</span></div>`;
    }).join('');
    if (html !== this.devHtml) {
      this.devHtml = html;
      this.devList.innerHTML = html;
      for (const item of this.devList.children) item.onclick = () => app.selection.selectDevice(item.dataset.id);
    }
  }

  enter() {
    this.app.setRoof(false);
  }
  leave() { if (this.twin) this.setTwin(false); }

  update(dt, active) {
    this.time += dt;
    if (this.tvOn) this.drawTV();
    this.gas.update(dt);
    if (this.gasActive) this.gasTimeline(dt);
    this.pins.update(this.time);
    if (this.gasAlarm) {
      const on = Math.floor(this.time * 3) % 2 === 0;
      this.app.devices.strobeMats[1].emissiveIntensity = on ? 4 : 0;
    }
  }

  slowUpdate(dt, active) {
    if (this.mode === 'auto' || this.mode === 'home') this.presenceControl();
    this.hazeControl();
    const gw = this.app.devices.byId.gateway.object.userData.info;
    gw.data.在线设备 = this.app.devices.list.filter((d) => d.object).length + ' 台';
    gw.data.当前模式 = MODES.find((m) => m.value === this.mode).label.slice(2).trim();
    if (!active) return;
    this.renderDevList();
    if (this.gasHistory.length) {
      this.gasChart.getChart().setOption({
        ...chartBase,
        title: { text: '厨房燃气浓度（%LEL）', textStyle: { fontSize: 12 }, left: 0, top: 0 },
        legend: { show: false },
        grid: { left: 36, right: 12, top: 30, bottom: 22 },
        xAxis: { type: 'value', name: '秒', nameTextStyle: { fontSize: 10 } },
        yAxis: { type: 'value', max: 40 },
        series: [{ type: 'line', data: this.gasHistory.filter((_, i) => i % 3 === 0), showSymbol: false, smooth: true, lineStyle: { color: '#d4a000' }, areaStyle: { color: 'rgba(212,160,0,0.2)' },
          markLine: { symbol: 'none', data: [{ yAxis: 10, label: { formatter: '预警 10' } }, { yAxis: 20, label: { formatter: '报警 20' } }], lineStyle: { color: '#d64541', type: 'dashed' } } }],
        animation: false,
      });
    }
  }
}
