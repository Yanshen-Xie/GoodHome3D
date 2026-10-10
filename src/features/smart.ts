// 智慧便捷：
//  1. 场景模式：回家 / 离家 / 睡眠 / 观影 / 自动（人体感应），多设备协同变化
//  2. 设备列表与控制：点击设备查看数据并开关、调节
//  3. 联动演示：燃气泄漏 → 报警 → 关阀 → 开窗 → 排风；室外雾霾 → 关窗 → 开新风
//  4. 数字孪生运维：建筑半透明、设备按状态着色、模拟故障并自动定位
import * as THREE from 'three';
import { INDOOR_ROOMS as ROOMS, roomById, FLOORS } from '../scene/layout.js';
import { STATUS_COLOR, STATUS_TEXT } from '../scene/devices.js';
import { Emitter } from '../systems/particles.js';
import { StatusPins } from '../systems/statusPins.js';
import { section, button, buttonGroup, logBox, chart, chartBase, hint, el, toast, toggle } from '../ui/ui.js';
import type { SmartServices } from './services.js';

const MODES = [
  { value: 'home', label: '🏠 回家' }, { value: 'away', label: '🚪 离家' }, { value: 'sleep', label: '🌙 睡眠' },
  { value: 'movie', label: '🎬 观影' }, { value: 'auto', label: '👣 自动感应' },
];

const modeLabel = (value: string) => MODES.find((x) => x.value === value)?.label ?? value;

export class SmartFeature {
  // Fields are declared here and initialized by the existing runtime flow.
  declare alarmTime: any;
  declare app: SmartServices;
  declare autoRainClose: any;
  declare devHtml: any;
  declare devList: any;
  declare fadeMats: any;
  declare faultId: any;
  declare faultOriginalControls: any;
  declare gas: any;
  declare gasActive: any;
  declare gasAlarm: any;
  declare gasChart: any;
  declare gasHistory: any;
  declare gasLevel: any;
  declare gasSteps: any;
  declare gasT: any;
  declare gasVent: any;
  declare hazeActed: any;
  declare hazeWatch: any;
  declare leak: any;
  declare logBox: any;
  declare mode: any;
  declare modeBtns: any;
  declare pins: any;
  declare presence: any;
  declare puddle: any;
  declare time: any;
  declare tvCanvas: any;
  declare tvLight: any;
  declare tvOn: any;
  declare tvTex: any;
  declare twin: any;
  declare twinToggle: any;

  constructor(app: SmartServices) {
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
    app.devices.registry.getDisplay('tv')?.setTexture(this.tvTex);
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
        if (p.x < 3.4) { p.x = 3.4; p.vx = Math.abs(p.vx); }
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
    const app = this.app, devices = app.devices, registry = app.devices.registry;
    this.mode = m;
    const dark = app.sunFactor < 0.25 || app.clock.hour < 7 || app.clock.hour > 18.5;
    const curtains = registry.byType('curtain');
    const acs = registry.byType('ac');
    const changes: string[] = [];
    const allLights = (on) => registry.byType('light').forEach((light) => registry.setPower(light.id, on));
    registry.setPower('night-light', false);
    registry.setPower('lamp-floor', false);
    this.setTV(false);
    // 除"离家"外，其他模式都表示家里有人：如果家人不在家或正在出门，把他们叫回来
    if (m !== 'away') this.bringPeopleHome();
    if (m === 'home') {
      registry.getLock('smart-lock')?.setLocked(false);
      this.app.later(() => { if (this.mode === 'home') registry.getLock('smart-lock')?.setLocked(true); }, 5000);
      allLights(false);
      if (dark) {
        for (const [id, brightness, kelvin] of [['light-hall1-w', 0.8, 4000], ['light-living', 0.85, 3500], ['light-dining', 0.7, 3200], ['light-stair', 0.6, 3500]] as const) {
          const light = registry.getLighting(id);
          light?.setBrightness(brightness); light?.setColorTemperature(kelvin); light?.setOn(true);
        }
      }
      curtains.forEach((c) => registry.setCurtain(c.id, dark ? 0 : 1));
      const livingClimate = registry.getClimate('ac-living');
      livingClimate?.setSetpoint(26); livingClimate?.setOn(true);
      const ventilation = registry.getVentilation('fresh-air');
      ventilation?.setLevel(2); ventilation?.setOn(true);
      registry.getValve('gas-valve')?.setOpen(true);
      changes.push('门锁开启（5 秒后自动上锁）', dark ? '玄关、客厅、餐厅灯开启（暖白 3500K）' : '白天光线充足，灯保持关闭', dark ? '窗帘关闭' : '窗帘打开', '客厅空调 26℃', '新风 2 档');
    } else if (m === 'away') {
      allLights(false);
      curtains.forEach((c) => registry.setCurtain(c.id, 0));
      acs.forEach((a) => registry.getClimate(a.id)?.setOn(false));
      const ventilation = registry.getVentilation('fresh-air');
      ventilation?.setLevel(1); ventilation?.setOn(true);
      registry.getLock('smart-lock')?.setLocked(true);
      registry.getValve('gas-valve')?.setOpen(false);
      for (const w of app.openings.list('window')) w.setOpen(false);
      registry.setInfoData('camera', '状态', '已布防');
      changes.push('全部灯光关闭', '窗帘、门窗关闭', '空调关闭', '新风低速 1 档', '燃气阀门关闭', '门锁上锁，摄像头布防');
      this.sendPeopleOut();
    } else if (m === 'sleep') {
      allLights(false);
      registry.setPower('night-light', true);
      curtains.forEach((c) => registry.setCurtain(c.id, 0));
      acs.forEach((a) => { const climate = registry.getClimate(a.id); climate?.setSetpoint(27); climate?.setOn(['master', 'kid', 'elder'].includes(a.room ?? '')); });
      const ventilation = registry.getVentilation('fresh-air');
      ventilation?.setLevel(1); ventilation?.setOn(true);
      registry.getLock('smart-lock')?.setLocked(true);
      changes.push('全部灯光关闭', '夜间感应地脚灯开启', '窗帘关闭', '卧室空调睡眠 27℃（主卧、儿童房、老人房）', '新风静音 1 档', '门锁上锁');
    } else if (m === 'movie') {
      allLights(false);
      const livingLight = registry.getLighting('light-living');
      livingLight?.setBrightness(0.18); livingLight?.setColorTemperature(2700); livingLight?.setOn(true);
      registry.setPower('lamp-floor', true);
      registry.setCurtain('curtain-living', 0);
      registry.setCurtain('curtain-dining', 0);
      const movieClimate = registry.getClimate('ac-living');
      movieClimate?.setSetpoint(25); movieClimate?.setOn(true);
      this.setTV(true);
      changes.push('客厅主灯调暗至 18%、暖光 2700K', '落地灯开启', '客厅窗帘关闭', '电视开启', '客厅空调 25℃');
      app.flyTo([-7.3, 1.7, 4.4], [-3.4, 1.3, 2.5]);
      app.viewFloor('all');
    } else if (m === 'auto') {
      allLights(false);
      curtains.forEach((c) => registry.setCurtain(c.id, 1));
      changes.push('人体存在传感器接管灯光：有人且光线不足时开灯，人离开 3 秒后关灯', '走廊灯随人员移动依次亮起');
    }
    registry.setInfoData('camera', '状态', m === 'away' ? '已布防' : '在线');
    this.logBox.add(this.clock(), `切换到【${modeLabel(m).slice(2).trim()}】模式`, 'ok');
    for (const c of changes) this.logBox.add('', '　- ' + c);
    this.modeBtns?.refresh();
    toast(`已切换到${modeLabel(m)}模式`);
  }

  clock() {
    const h = this.app.clock.hour;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  }

  sendPeopleOut() {
    for (const p of this.app.people.list) {
      if (!p.object.visible) continue;
      p.mode = 'stop'; p.activity = '出门';
      // 走到门外时如果还是"离家"模式就隐藏；中途切换了模式则留在原地，由 bringPeopleHome 叫回
      p.goTo(-10.5, -0.2, { floor: 0, onArrive: () => { if (this.mode === 'away') { p.object.visible = false; p.activity = '不在家'; } } });
    }
    const entry = this.app.openings.require('door-entry');
    entry.setOpen(true);
    this.app.later(() => entry.setOpen(false), 25000);
  }

  bringPeopleHome() {
    const app = this.app, entry = app.openings.require('door-entry');
    app.people.list.forEach((p, i) => {
      const leaving = p.activity === '出门' || p.activity === '不在家';
      if (p.object.visible && !leaving) return;
      if (!p.object.visible) { p.object.visible = true; p.setPosition(-11 - i * 0.8, -0.2 + i * 0.3, 0); }
      entry.setOpen(true);
      p.mode = 'stop';
      p.activity = '回家';
      p.goTo(-6.3 + i * 1.2, 2.0, { floor: 0, onArrive: () => { p.mode = 'routine'; p.waitTimer = 3; } });
      this.app.later(() => entry.setOpen(false), 9000);
    });
    for (const p of app.people.list) if (p.mode === 'stop' && p.object.visible && !p.path.length) p.mode = 'routine';
  }

  setTV(on) {
    this.tvOn = on;
    this.app.devices.registry.setPower('tv', on);
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
      if (r.id.startsWith('stair')) continue;
      const sensorId = 'presence-' + r.id;
      if (app.devices.registry.get(sensorId)) app.devices.registry.setInfoData(sensorId, '检测结果', people.length ? `有人（${people.map((p) => p.name).join('、')}）` : '无人');
      if (people.length) this.presence[r.id] = now;
      const needLight = dark || r.id.startsWith('bath') || r.id.startsWith('hall') || r.id === 'utility';
      const lights = app.devices.registry.byType('light').filter((l) => l.room === r.id);
      for (const l of lights) {
        let on = needLight && now - (this.presence[r.id] ?? -99) < 3;
        // 走廊较长：只点亮人附近的那一盏灯，人走过时灯依次亮起
        if (r.id.startsWith('hall')) {
          const source = app.devices.registry.getLighting(l.id)?.getSourcePosition?.();
          on = needLight && app.people.list.some((p) => p.object.visible && p.room === r.id && Math.abs(p.x - (source?.x ?? 0)) < 4.5);
        }
        const power = app.devices.registry.getPower(l.id);
        if (power && on !== power.isOn()) {
          const light = app.devices.registry.getLighting(l.id);
          light?.setBrightness(0.8); light?.setColorTemperature(r.id.startsWith('bath') ? 5000 : 4000); power.setOn(on);
        }
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
    app.viewFloor(0);
    app.flyTo([3.4, 5.2, 5.8], [6.8, 1.2, 1.8]);
  }

  gasTimeline(dt) {
    const app = this.app, registry = app.devices.registry, T = (this.gasT += dt);
    const gasSensor = registry.getGasSensor('gas-detector');
    const once = (k, fn) => { if (!this.gasSteps.has(k) && fn.cond()) { this.gasSteps.add(k); fn.run(); } };
    // 浓度：阀门开着时持续上升，关阀后停止增加，开窗排风后快速下降
    if (registry.getValve('gas-valve')?.isOpen()) this.gasLevel = Math.min(100, this.gasLevel + dt * 4.5);
    else if (this.gasVent) this.gasLevel = Math.max(0, this.gasLevel - dt * 6);
    gasSensor?.setValue(this.gasLevel);
    once('warn', { cond: () => this.gasLevel >= (gasSensor?.getAlarmThreshold() ?? 10), run: () => { this.logBox.add(this.clock(), `可燃气体探测器预警：${this.gasLevel.toFixed(0)}%LEL`, 'warn'); } });
    once('alarm', {
      cond: () => this.gasLevel >= (gasSensor?.getFaultThreshold?.() ?? 20),
      run: () => {
        this.gasAlarm = true;
        registry.getFireAlarm('strobe-kitchen')?.activate();
        toast('⚠ 燃气泄漏报警：厨房', 'alarm', 3500);
        this.logBox.add(this.clock(), `浓度达到 ${this.gasLevel.toFixed(0)}%LEL，声光报警，推送家属手机`, 'err');
      },
    });
    once('valve', { cond: () => this.gasSteps.has('alarm') && T > this.alarmAt(), run: () => { registry.getValve('gas-valve')?.setOpen(false); registry.setStatus('gas-valve', 'warning'); this.logBox.add(this.clock(), '联动 1：电动阀门切断燃气', 'warn'); } });
    once('window', {
      cond: () => this.gasSteps.has('valve') && T > this.alarmAt() + 1.5,
      run: () => {
        for (const id of ['w-kitchen-e', 'w-kitchen-s']) app.openings.require(id).setOpen(true);
        this.gasVent = true;
        this.logBox.add(this.clock(), '联动 2：打开厨房外窗，启动排风（禁止开关电器，防止电火花）', 'warn');
      },
    });
    once('fresh', { cond: () => this.gasSteps.has('window') && T > this.alarmAt() + 2.5, run: () => { const ventilation = registry.getVentilation('fresh-air'); ventilation?.setLevel(3); ventilation?.setOn(true); this.logBox.add(this.clock(), '联动 3：新风系统 3 档运行，加快换气', 'warn'); } });
    once('done', {
      cond: () => this.gasSteps.has('fresh') && this.gasLevel <= 0.5,
      run: () => {
        gasSensor?.setValue(0);
        this.gasAlarm = false;
        registry.getFireAlarm('strobe-kitchen')?.deactivate();
        this.gas.stop();
        this.logBox.add(this.clock(), '燃气浓度恢复正常，报警解除；阀门保持关闭，等待人工检修', 'ok');
        toast('燃气浓度已恢复正常');
      },
    });
    if (this.gasSteps.has('alarm') && !this.alarmTime) this.alarmTime = T;
    if (this.gasHistory.length < 3000) this.gasHistory.push([+T.toFixed(1), +this.gasLevel.toFixed(1)]);
  }
  alarmAt() { return (this.alarmTime ?? 1e9) + 1; }

  stopGasLeak(silent = false) {
    const app = this.app;
    this.gasActive = false; this.gasAlarm = false; this.gasVent = false; this.alarmTime = null;
    this.gas.clear();
    app.devices.registry.getGasSensor('gas-detector')?.setValue(0);
    app.devices.registry.setStatus('gas-valve', 'normal');
    app.devices.registry.getValve('gas-valve')?.setOpen(true);
    app.devices.registry.getFireAlarm('strobe-kitchen')?.deactivate();
    if (!silent) { for (const id of ['w-kitchen-e', 'w-kitchen-s']) app.openings.require(id).setOpen(false); this.logBox.add(this.clock(), '燃气系统检修完成，复位', 'ok'); }
  }

  // 夜间窗户透光：窗户所在房间开着灯时，外侧发光面变亮（亮度跟随灯的亮度和色温）
  windowGlow() {
    const app = this.app, dark = app.sunFactor < 0.3, registry = app.devices.registry;
    for (const w of app.openings.list(['window', 'slide'])) {
      if (!w.setNightGlow) continue;
      const lamps = registry.byType('light').filter((l) => l.room === w.room && registry.getPower(l.id)?.isOn());
      const level = dark && lamps.length ? Math.max(...lamps.map((l) => registry.getLighting(l.id)?.getBrightness() ?? 0)) : 0;
      const color = lamps[0] && registry.getLighting(lamps[0].id)?.getSourceColor?.();
      w.setNightGlow(Math.min(0.95, 0.35 + level * 0.65) * (level > 0 ? 1 : 0), color ? color.clone().lerp(new THREE.Color(0xffc070), 0.4) : undefined);
    }
  }

  // ================= 雨天自动关窗、水浸联动 =================
  rainControl() {
    const app = this.app;
    if (!this.autoRainClose || app.clock.weather !== 'rainy') return;
    const open = app.openings.list('window').filter((w) => w.isOpen());
    if (!open.length) return;
    for (const w of open) w.setOpen(false);
    this.logBox.add(this.clock(), `雨量传感器检测到下雨 → 自动关闭 ${open.length} 扇外窗`, 'warn');
    app.log('warn', `下雨自动关窗（${open.length} 扇）`);
    toast('🌧 检测到下雨，已自动关窗');
  }

  startLeak() {
    const app = this.app;
    if (this.leak) return;
    this.leak = { t: 0, stage: 0 };
    const r = roomById('bath2');
    this.puddle = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshStandardMaterial({ color: 0x4a90c8, transparent: true, opacity: 0.6, roughness: 0.05, metalness: 0.2 }));
    this.puddle.rotation.x = -Math.PI / 2;
    this.puddle.position.set(-1.1, FLOORS[1].y + 0.025, -3.4);
    this.puddle.scale.setScalar(0.05);
    this.puddle.userData.noPick = true;
    app.scene.add(this.puddle);
    this.logBox.add(this.clock(), '二层卫生间洗手台下水管接口漏水（模拟）', 'err');
    app.viewFloor(1);
    app.flyTo([0.6, 8.2, -0.6], [-1.4, 3.3, -3.2]);
  }

  leakTimeline(dt) {
    const L = this.leak, app = this.app, registry = app.devices.registry;
    L.t += dt;
    if (L.stage < 2) this.puddle.scale.setScalar(Math.min(0.8, 0.05 + L.t * 0.12));
    if (L.stage === 0 && L.t > 2) {
      L.stage = 1;
      registry.setStatus('leak-bath2', 'fault');
      this.logBox.add(this.clock(), '二层卫生间水浸传感器报警', 'err');
      app.log('err', '二层卫生间漏水报警');
      toast('💧 漏水报警：二层卫生间', 'alarm', 3500);
    }
    if (L.stage === 1 && L.t > 3.2) {
      L.stage = 2;
      registry.getValve('water-valve')?.setOpen(false);
      registry.setStatus('water-valve', 'warning');
      this.logBox.add(this.clock(), '联动：关闭自来水进水总阀（设备间），推送家属手机', 'warn');
    }
  }

  stopLeak() {
    const app = this.app, registry = app.devices.registry;
    if (!this.leak) return;
    this.leak = null;
    this.puddle?.parent?.remove(this.puddle);
    registry.setStatus('leak-bath2', 'normal');
    registry.setStatus('water-valve', 'normal');
    registry.getValve('water-valve')?.setOpen(true);
    this.logBox.add(this.clock(), '漏水已修复，进水总阀重新开启', 'ok');
  }

  // ================= 空气质量联动 =================
  startHaze() {
    const app = this.app, env = app.envModel;
    env.haze = 1;
    app.setTime(app.clock.hour);
    for (const w of app.openings.list('window')) w.setOpen(true);
    app.devices.registry.getVentilation('fresh-air')?.setOn(false);
    this.hazeWatch = true;
    this.logBox.add(this.clock(), '室外出现雾霾，PM2.5 升高（模拟）；当前门窗打开、新风关闭', 'warn');
    app.heatmap.setHeatmap('pm', 0);
  }

  hazeControl() {
    const app = this.app, env = app.envModel;
    if (!this.hazeWatch) return;
    const worst = Math.max(...ROOMS.map((r) => env.rooms[r.id].pm));
    if (!this.hazeActed && worst > 60) {
      this.hazeActed = true;
      for (const w of app.openings.list(['window', 'slide'])) w.setOpen(false);
      const ventilation = app.devices.registry.getVentilation('fresh-air');
      ventilation?.setLevel(3); ventilation?.setOn(true);
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
      const set = new Set<THREE.Material>(), outdoor = new Set<THREE.Material>();
      // 室外环境（树、草地）也用到了一些相同的材质，这些材质不做透明化，否则树冠会一起"消失"
      app.sceneLayers.outdoor.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => outdoor.add(m)); });
      for (const root of [app.sceneLayers.house, app.sceneLayers.furniture]) root.traverse((o) => { const mesh = o as THREE.Mesh; if (mesh.isMesh) (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => { if (!outdoor.has(m)) set.add(m); }); });
      this.fadeMats = [...set].map((m) => ({ m, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite }));
    }
    for (const f of this.fadeMats) {
      f.m.transparent = on ? true : f.transparent;
      f.m.opacity = on ? Math.min(f.opacity, 0.12) : f.opacity;
      f.m.depthWrite = on ? false : f.depthWrite;
      f.m.needsUpdate = true;
    }
    if (on) { app.viewFloor(1); app.flyTo([14, 16, 18], [1, 1.5, 0]); }
    this.twinToggle?.refresh();
  }

  simulateFault() {
    const app = this.app;
    const registry = app.devices.registry;
    const candidates = ['heatpump', 'fresh-air', 'inverter', 'distribution', 'ac-master', 'elevator'];
    const id = candidates[Math.floor(Math.random() * candidates.length)];
    const device = registry.require(id);
    const module = device.module;
    if (!module) return;
    const info = module.info;
    const faultTable: Record<string, [string, string]> = {
      heatpump: ['压缩机排气温度过高（E4）', '水箱温度 38℃，制热效率下降'],
      'fresh-air': ['送风机转速异常（1200 → 450 rpm）', '疑似滤网严重堵塞'],
      inverter: ['直流侧绝缘阻抗低（PV2 组串）', '发电功率下降 35%'],
      distribution: ['厨房回路漏电流 28mA（接近 30mA 保护值）', '建议检查厨房电器插座'],
      'ac-master': ['室外机通信故障（E6）', '空调停止运行'],
      elevator: ['轿厢门锁回路异常，电梯停在 1 层', '已自动停梯，禁止使用，老人上下楼请走楼梯（有人陪同）'],
    };
    const faults = faultTable[id];
    this.setTwin(true);
    registry.setStatus(id, 'fault');
    registry.mergeInfoData(id, { 故障: faults[0], 影响: faults[1] });
    info.maintain = '上次维保：2026-05-12；本次故障已自动生成维修工单 #' + (1000 + Math.floor(Math.random() * 9000));
    this.faultOriginalControls ??= info.controls;
    info.controls = [{ type: 'button', label: '派单维修（修复）', onClick: () => this.repair(id) }];
    this.faultId = id;
    this.logBox.add(this.clock(), `【故障】${info.name}：${faults[0]}`, 'err');
    this.logBox.add('', '　- 系统已自动定位故障设备并生成维修工单，其余构件透明化显示');
    toast('⚠ 设备故障：' + info.name, 'alarm', 3500);
    this.app.later(() => {
      app.selection.selectDevice(id, false);
      const p = module.root.getWorldPosition(new THREE.Vector3());
      app.flyTo([p.x + 7, p.y + 8, p.z + 9], p.toArray()); // 镜头飞到故障设备附近（保持一定距离，能看到周围）
    }, 300);
  }

  repair(id = this.faultId) {
    if (!id) return;
    const registry = this.app.devices.registry;
    const module = registry.getModule(id);
    if (!module) return;
    registry.setStatus(id, 'normal');
    registry.deleteInfoData(id, '故障');
    registry.deleteInfoData(id, '影响');
    module.info.maintain = '2026-09 维修完成，运行正常';
    module.info.controls = this.faultOriginalControls;
    this.faultOriginalControls = null;
    this.logBox.add(this.clock(), `${module.info.name} 维修完成，恢复正常`, 'ok');
    this.faultId = null;
    this.app.selection.select(module.root);
  }

  // ================= 面板 =================
  buildPanel(root) {
    const app = this.app;
    const s1 = section('场景模式', '一键切换生活场景，灯光（亮度、色温）、窗帘、空调、新风、电视、门锁协同变化。“自动感应”模式下，人体存在传感器检测到有人就开灯，走廊灯随人员移动依次点亮。');
    this.modeBtns = buttonGroup(MODES, () => this.mode, (v) => this.setMode(v));
    s1.append(this.modeBtns);
    s1.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('时间设为晚上 8 点', () => app.setTime(20)),
      button('时间设为上午 10 点', () => app.setTime(10)),
      button('一层俯视', () => { app.viewFloor(0); app.flyTo([0, 24, 10], [0, 0, 0.5]); }),
      button('二层俯视', () => { app.viewFloor(1); app.flyTo([0, 27, 10], [0, 3.2, 0.5]); }),
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
    s3.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('💧 模拟卫生间漏水', () => this.startLeak(), 'danger'),
      button('修复漏水', () => this.stopLeak()),
      button('🌧 开窗后下雨', () => { for (const w of app.openings.list('window')) w.setOpen(true); this.app.later(() => app.setWeather('rainy'), 2500); app.viewFloor('all'); app.flyTo([20, 9, 22], [0, 3, 0]); }),
    ));
    this.autoRainClose = true;
    s3.append(toggle('下雨自动关窗（雨量传感器 + 窗磁）', () => this.autoRainClose, (v) => { this.autoRainClose = v; }));
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
    const types = ['light', 'curtain', 'ac', 'freshAir', 'lock', 'valve', 'camera', 'gateway', 'gasDetector', 'elevator', 'charger', 'heatpump', 'inverter', 'battery', 'distribution'];
    const registry = app.devices.registry;
    const list = registry.all().filter((d) => types.includes(d.type) && d.module);
    const html = list.map((d) => {
      const status = registry.getStatus(d.id) ?? 'normal';
      let st: string = STATUS_TEXT[status];
      if (d.type === 'light') { const power = registry.getPower(d.id); const light = registry.getLighting(d.id); st = power?.isOn() ? `开 ${Math.round((light?.getBrightness() ?? 0) * 100)}% ${light?.getColorTemperature() ?? 4000}K` : '关'; }
      if (d.type === 'ac') { const climate = registry.getClimate(d.id); st = climate?.isOn() ? `运行 ${climate.getSetpoint()}℃` : '关'; }
      if (d.type === 'curtain') st = (registry.getCurtain(d.id)?.getOpenRatio() ?? 0) > 0.5 ? '打开' : '关闭';
      if (d.type === 'freshAir') { const ventilation = registry.getVentilation(d.id); st = ventilation?.isOn() ? `${ventilation.getLevel()} 档` : '关'; }
      if (d.type === 'lock') st = registry.getLock(d.id)?.isLocked() ? '已上锁' : '已开锁';
      if (d.type === 'valve') st = registry.getValve(d.id)?.isOpen() ? '开启' : '已切断';
      const color = '#' + STATUS_COLOR[status].toString(16).padStart(6, '0');
      return `<div class="dev-item" data-id="${d.id}"><span class="dot" style="background:${color}"></span><span class="name">${d.module.info.name}</span><span class="st">${st}</span></div>`;
    }).join('');
    if (html !== this.devHtml) {
      this.devHtml = html;
      this.devList.innerHTML = html;
      for (const item of this.devList.children) item.onclick = () => app.selection.selectDevice(item.dataset.id);
    }
  }

  enter() {}
  leave() { if (this.twin) this.setTwin(false); }

  update(dt, active) {
    this.time += dt;
    if (this.tvOn) this.drawTV();
    this.gas.update(dt);
    if (this.gasActive) this.gasTimeline(dt);
    if (this.leak) this.leakTimeline(dt);
    this.pins.update(this.time);
  }

  slowUpdate(dt, active) {
    if (this.mode === 'auto' || this.mode === 'home') this.presenceControl();
    this.hazeControl();
    this.rainControl();
    this.windowGlow();
    this.app.devices.registry.mergeInfoData('gateway', {
      在线设备: this.app.devices.registry.all().filter((d) => d.module).length + ' 台',
      当前模式: modeLabel(this.mode).slice(2).trim(),
    });
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
