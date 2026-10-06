// 安全耐久：
//  1. 火灾报警与疏散：厨房起火 → 烟感报警 → 声光报警、切断燃气、开门解锁、应急照明、电梯迫降 → 防火门关闭
//     → A* 为每位居民（包括二楼的人）计算绕开火源的最短路线（二楼经楼梯下楼）→ 跑到室外，统计用时
//  2. 一键呼叫：老人按下按钮 → 按钮变红、房间高亮、通知家属与物业 → 家属前往（可能要从二楼下来）
//  3. 跌倒检测：毫米波雷达发现老人跌倒且长时间不动 → 报警 → 家属前往扶起
//  4. 入侵检测：离家布防时，陌生人翻越围栏 → 红外对射、摄像头识别 → 投光灯、声光报警、推送
//  5. 安全巡检与状态视图（绿 / 黄 / 红）
import * as THREE from 'three';
import { EXITS, roomById, FLOORS } from '../scene/layout.js';
import { Emitter } from '../systems/particles.js';
import { FloorPath } from '../systems/pathViz.js';
import { StatusPins } from '../systems/statusPins.js';
import { section, button, stats, logBox, toggle, el, toast } from '../ui/ui.js';

const STOVE = { x: 7.6, y: 0.95, z: 1.6 };

export class SafetyFeature {
  constructor(app) {
    this.app = app;
    this.fireActive = false;
    this.t = 0;
    this.routes = [];
    this.labels = [];
    // 火焰：加法混合，黄 → 红，向上窜
    this.flame = new Emitter(app.scene, {
      count: 700, rate: 420, life: [0.5, 1.1], size: [0.9, 0.2], alpha: [1, 0], additive: true, renderOrder: 7,
      colors: [new THREE.Color(1.0, 0.85, 0.35), new THREE.Color(0.9, 0.15, 0.02)],
      spawn: (p) => {
        p.x = STOVE.x + (Math.random() - 0.5) * 0.5; p.y = STOVE.y + 0.02; p.z = STOVE.z + (Math.random() - 0.5) * 0.35;
        p.vx = (Math.random() - 0.5) * 0.4; p.vy = 1.0 + Math.random() * 1.4; p.vz = (Math.random() - 0.5) * 0.4;
      },
    });
    // 烟雾：上升到天花板后沿天花板扩散；受厨房墙体约束，防火门关闭前可从门洞漫出
    this.smoke = new Emitter(app.scene, {
      count: 1400, rate: 140, life: [6, 10], size: [0.4, 1.6], alpha: [0.55, 0],
      colors: [new THREE.Color(0.25, 0.25, 0.25), new THREE.Color(0.55, 0.55, 0.55)],
      spawn: (p) => {
        p.x = STOVE.x + (Math.random() - 0.5) * 0.4; p.y = STOVE.y + 0.5; p.z = STOVE.z + (Math.random() - 0.5) * 0.4;
        p.vx = (Math.random() - 0.5) * 0.2; p.vy = 1.0 + Math.random() * 0.5; p.vz = (Math.random() - 0.5) * 0.2;
      },
      force: (p, dt) => {
        if (p.y > 2.6) {
          p.vy *= 0.5; p.y = Math.min(p.y, 2.85);
          const dx = p.x - STOVE.x, dz = p.z - STOVE.z, d = Math.hypot(dx, dz) || 1;
          p.vx += (dx / d) * dt * 0.8 + (Math.random() - 0.5) * dt; p.vz += (dz / d) * dt * 0.8 + (Math.random() - 0.5) * dt;
        }
        const doorOpen = this.app.house.doors['door-kitchen'].t > 0.2;
        const inDoor = p.z > 1.15 && p.z < 2.05 && p.y < 2.2 && doorOpen;
        if (p.x < 3.35 && p.x > 3.0 && !inDoor) { p.x = 3.35; p.vx = Math.abs(p.vx) * 0.3; }
        if (p.z < 0.75 && p.x > 3.2) { p.z = 0.75; p.vz = Math.abs(p.vz) * 0.3; }
        if (p.x > 7.85) { p.x = 7.85; p.vx = -Math.abs(p.vx) * 0.3; }
        if (p.z > 4.85) { p.z = 4.85; p.vz = -Math.abs(p.vz) * 0.3; }
        p.vx *= 1 - dt * 0.3; p.vz *= 1 - dt * 0.3;
      },
    });
    this.fireLamp = app.devices.lightPool.add({ position: new THREE.Vector3(STOVE.x - 0.3, 1.5, STOVE.z), color: new THREE.Color(0xff7a20), distance: 8, priority: 6 });
    this.roomGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.3, depthWrite: false }));
    this.roomGlow.rotation.x = -Math.PI / 2;
    this.roomGlow.visible = false;
    this.roomGlow.userData.noPick = true;
    app.scene.add(this.roomGlow);
    this.sos = null;
    this.fall = null;
    this.intrusion = null;
    this.pins = new StatusPins(app.scene, app.devices, (d) => /消防|安全/.test(d.info?.category ?? ''));
    // 入侵检测：陌生人周围的红色识别框
    this.detectBox = new THREE.Box3Helper(new THREE.Box3(), 0xff3030);
    this.detectBox.visible = false;
    this.detectBox.material.depthTest = false;
    app.scene.add(this.detectBox);
    this.time = 0;
  }

  now() {
    const h = this.app.clock.hour;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}+${this.t.toFixed(1)}s`;
  }

  log(text, cls) {
    this.logBox.add(this.now(), text, cls);
    this.app.log(cls === 'ok' ? 'ok' : cls === 'err' ? 'err' : 'warn', text);
  }

  highlightRoom(room) {
    this.roomGlow.scale.set(room.x1 - room.x0 - 0.2, room.z1 - room.z0 - 0.2, 1);
    this.roomGlow.position.set((room.x0 + room.x1) / 2, FLOORS[room.floor].y + 0.045, (room.z0 + room.z1) / 2);
    this.roomGlow.visible = true;
  }

  // 让离得最近的家属跑去某个位置（可能需要上下楼）
  sendHelper(target, floor, onArrive) {
    const app = this.app;
    const helpers = [app.people.mom, app.people.girl].filter((p) => p.object.visible && p.mode !== 'fallen');
    let best = null;
    for (const p of helpers) {
      const path = app.nav.findPath({ x: p.x, z: p.z, floor: p.floor }, { x: target.x, z: target.z, floor });
      if (!path) continue;
      let len = 0;
      for (let i = 1; i < path.length; i++) len += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y, path[i].z - path[i - 1].z);
      if (!best || len < best.len) best = { p, len };
    }
    if (!best) return null;
    const h = best.p;
    h.mode = 'stop';
    h.goTo(target.x, target.z, { floor, run: true, onArrive: () => onArrive(h) });
    return h;
  }

  // ================= 火灾 =================
  startFire() {
    if (this.fireActive) return;
    const app = this.app;
    this.resetFire(true);
    this.fireActive = true;
    this.t = 0;
    this.steps = new Set();
    this.evacDone = 0;
    this.evacTime = null;
    this.evacStart = undefined;
    this.logBox.clear();
    this.flame.start();
    this.smoke.start();
    app.envModel.extra.kitchen = { temp: 65, pm: 600 };
    this.labels.push(app.makeLabel('🔥 起火点：厨房灶台', 'alarm', STOVE.x, 2.2, STOVE.z));
    this.log('厨房灶台油锅起火（模拟）', 'err');
    app.viewFloor('all');
    app.features.layers.setCut(4.9);
    app.rig.flyTo([12, 16, 17], [1.5, 1.5, 0.5]);
    for (const p of app.people.list) if (p.mode !== 'fallen') p.mode = 'stop';
  }

  fireTimeline() {
    const app = this.app, registry = app.devices.registry, t = this.t, once = (k, fn) => { if (t >= k && !this.steps.has(k)) { this.steps.add(k); fn(); } };
    once(1.5, () => {
      registry.setStatus('smoke-kitchen', 'fault');
      registry.setInfoData('smoke-kitchen', '烟雾浓度', '0.35 dB/m（超限）');
      this.log('厨房感烟探测器报警（烟雾浓度超限）', 'err');
      toast('⚠ 火灾报警：一层厨房', 'alarm', 4000);
      this.alarmOn = true;
    });
    once(2.2, () => {
      registry.getValve('gas-valve')?.setOpen(false);
      registry.setStatus('gas-valve', 'warning');
      this.log('联动：切断厨房燃气阀门', 'warn');
      registry.getLock('smart-lock')?.setLocked(false);
      for (const id of ['door-entry', 'door-back', 'door-living']) app.house.doors[id].setOpen(true);
      this.log('联动：门锁解锁，入户门、后门、客厅落地门打开', 'warn');
      for (const light of registry.byType('emergency')) registry.getIndicator(light.id)?.setIntensity(3);
      for (const sign of registry.byType('exitSign')) registry.getIndicator(sign.id)?.setIntensity(1.6);
      for (const l of registry.byType('light')) if (l.room !== 'kitchen') {
        const light = registry.getLighting(l.id);
        light?.setBrightness(1); light?.setColorTemperature(5000); light?.setOn(true);
      }
      this.log('联动：点亮应急照明与疏散指示标志', 'warn');
      registry.getElevator('elevator')?.call(0);
      registry.setStatus('elevator', 'warning');
      this.log('联动：电梯迫降至一层并停止使用（火灾时不得乘电梯）', 'warn');
      this.log('推送报警：家属手机、物业消防控制室；自动拨打 119（模拟）', 'warn');
    });
    once(3.0, () => this.planEvacuation());
    if (t > 3 && !this.steps.has('door') && !app.people.list.some((p) => p.room === 'kitchen')) {
      this.steps.add('door');
      app.house.doors['door-kitchen'].setOpen(false);
      this.log('防火门自动关闭，阻止烟气蔓延到餐厅和走廊', 'warn');
    }
  }

  /** 分别计算 p 到每个安全出口的 A* 路线（avoidDanger 表示绕开火源危险区），返回最短的 { ex, path, len } */
  nearestExit(p, avoidDanger) {
    let best = null;
    for (const ex of EXITS) {
      const path = this.app.nav.findPath({ x: p.x, z: p.z, floor: p.floor }, { x: ex.x, z: ex.z, floor: 0 }, { avoidDanger });
      if (!path) continue;
      let len = 0;
      for (let k = 1; k < path.length; k++) len += Math.hypot(path[k].x - path[k - 1].x, path[k].y - path[k - 1].y, path[k].z - path[k - 1].z);
      if (!best || len < best.len) best = { ex, path, len };
    }
    return best;
  }

  planEvacuation() {
    const app = this.app;
    app.nav.setDanger(STOVE.x, STOVE.z, 1.8, 0); // 一层火源周围 1.8 米为危险区
    this.dangerRing = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.25, depthWrite: false }));
    this.dangerRing.rotation.x = -Math.PI / 2; this.dangerRing.position.set(STOVE.x, 0.05, STOVE.z);
    app.scene.add(this.dangerRing);
    this.evacStart = this.t;
    const colors = [0x2ecc71, 0x27c3e6, 0xb07cff];
    app.people.list.forEach((p, i) => {
      if (p.mode === 'fallen') p.standUp();
      let best = this.nearestExit(p, true);
      if (!best) {
        // 兜底：完全避开危险区的路线不存在时（例如人就站在火源旁），改走最短路线尽快离开
        best = this.nearestExit(p, false);
        if (best) this.log(`${p.name}：被火源阻挡，只能冒险快速穿过危险区撤离`, 'warn');
      }
      if (!best) { this.log(`${p.name}：未找到安全路线！`, 'err'); return; }
      const route = new FloorPath([{ x: p.x, y: p.floor * FLOORS[1].y, z: p.z }, ...best.path], colors[i % 3], 0.45);
      app.scene.add(route.mesh);
      this.routes.push(route);
      this.log(`${p.name}（${p.floor + 1} 层 ${roomById(p.room)?.name ?? '室外'}）→ ${best.ex.name}，路线长 ${best.len.toFixed(1)} m${p.floor ? '，经楼梯下楼' : ''}`, 'ok');
      p.mode = 'evacuate';
      p.activity = '紧急疏散中';
      // 直接使用上面算好的路线（它可能是穿过危险区的兜底路线），到达后统计用时
      p.path = best.path.slice(1);
      p.running = true;
      p.onArrive = () => {
        p.activity = '已疏散至室外';
        this.evacDone++;
        this.log(`${p.name} 已到达安全区域（${best.ex.name}外），用时 ${(this.t - this.evacStart).toFixed(1)} s`, 'ok');
        if (this.evacDone === app.people.list.length) {
          this.evacTime = this.t - this.evacStart;
          this.log(`全员疏散完毕，总用时 ${this.evacTime.toFixed(1)} s`, 'ok');
          toast(`全员疏散完毕，用时 ${this.evacTime.toFixed(1)} 秒`, '', 4000);
        }
      };
    });
    for (const ex of EXITS) this.labels.push(app.makeLabel('安全出口：' + ex.name, 'dark', ex.x, 1.2, ex.z));
  }

  resetFire(silent = false) {
    const app = this.app, dev = app.devices;
    const was = this.fireActive;
    this.fireActive = false;
    this.alarmOn = false;
    this.flame.clear(); this.smoke.clear();
    this.fireLamp.intensity = 0;
    delete app.envModel.extra.kitchen;
    Object.assign(app.envModel.rooms.kitchen, { temp: app.envModel.rooms.dining.temp + 0.5, pm: 20 });
    app.nav.setDanger(0, 0, 0, 0);
    for (const r of this.routes) r.dispose();
    this.routes = [];
    for (const l of this.labels) l.parent?.remove(l);
    this.labels = [];
    if (this.dangerRing) { app.scene.remove(this.dangerRing); this.dangerRing = null; }
    dev.registry.setStatus('smoke-kitchen', 'normal');
    dev.registry.setInfoData('smoke-kitchen', '烟雾浓度', '0.00 dB/m');
    dev.registry.setStatus('gas-valve', 'normal');
    dev.registry.setStatus('elevator', 'normal');
    dev.registry.getValve('gas-valve')?.setOpen(true);
    dev.registry.getLock('smart-lock')?.setLocked(true);
    for (const id of ['door-entry', 'door-back', 'door-living']) app.house.doors[id].setOpen(false);
    app.house.doors['door-kitchen'].setOpen(true);
    for (const light of dev.registry.byType('emergency')) dev.registry.getIndicator(light.id)?.setIntensity(0);
    for (const sign of dev.registry.byType('exitSign')) dev.registry.getIndicator(sign.id)?.setIntensity(0.4);
    for (const strobe of dev.registry.byType('strobe')) dev.registry.getIndicator(strobe.id)?.setIntensity(0);
    for (const l of dev.registry.byType('light')) dev.registry.setPower(l.id, false);
    if (!silent && was) {
      const homes = [[-6.45, 2.4, 0], [6.0, -3.4, 1], [-5.5, -2.4, 0]];
      app.people.list.forEach((p, i) => { p.mode = 'routine'; p.activity = '返回室内'; p.goTo(homes[i][0], homes[i][1], { floor: homes[i][2], onArrive: () => { p.waitTimer = 2; } }); });
      app.features.layers.setCut(9);
      this.log('火情处置完毕，系统复位', 'ok');
    }
  }

  // ================= 一键呼叫 =================
  triggerSOS(id = 'sos-elder') {
    const app = this.app;
    this.cancelSOS(true);
    const registry = app.devices.registry;
    const device = registry.require(id);
    const module = device.module;
    const sos = registry.getSos(id);
    if (!module || !sos) return;
    const room = roomById(module.info.room);
    if (!room) return;
    this.sos = { id, t: 0, room };
    sos.activate();
    registry.setStatus(id, 'fault');
    this.highlightRoom(room);
    const p = module.root.getWorldPosition(new THREE.Vector3());
    this.sosLabel = app.makeLabel(`🆘 一键呼叫：${room.name}`, 'alarm', p.x, 1.9, p.z);
    this.logBox.clear();
    this.t = 0;
    this.alarmOn = false;
    this.log(`${room.name}一键呼叫按钮被按下`, 'err');
    this.log('网关定位求助位置：' + module.info.name.replace(/.*（|）/g, ''), 'warn');
    this.log('已推送：家属手机 App、物业值班终端（弹窗 + 声音）', 'warn');
    toast(`🆘 ${room.name} 一键呼叫`, 'alarm', 4000);
    app.viewFloor(0);
    app.rig.flyTo([room.x0 - 1, 11, room.z1 + 7], [(room.x0 + room.x1) / 2, 0, (room.z0 + room.z1) / 2]);
    const target = { x: (room.x0 + room.x1) / 2 + 0.3, z: room.z1 - 0.7 };
    const h = this.sendHelper(target, 0, (helper) => {
      if (!this.sos) return;
      helper.activity = '正在' + room.name + '照看老人';
      this.log(`${helper.name}已到达${room.name}，响应用时 ${this.sos.t.toFixed(1)} s`, 'ok');
    });
    if (h) { h.activity = '前往' + room.name + '救助'; this.log(`${h.name}${h.floor ? '（在二楼，经楼梯下楼）' : ''}正在赶往${room.name}`, 'warn'); }
  }

  cancelSOS(silent = false) {
    if (!this.sos) return;
    const app = this.app, { id } = this.sos;
    app.devices.registry.getSos(id)?.deactivate();
    app.devices.registry.setStatus(id, 'normal');
    this.roomGlow.visible = false;
    this.sosLabel?.parent?.remove(this.sosLabel);
    for (const strobe of app.devices.registry.byType('strobe')) app.devices.registry.getIndicator(strobe.id)?.setIntensity(0);
    this.sos = null;
    for (const p of [app.people.mom, app.people.girl]) if (p.mode === 'stop') p.mode = 'routine';
    if (!silent) this.log('呼叫已取消 / 处理完毕', 'ok');
  }

  // ================= 跌倒检测 =================
  triggerFall() {
    const app = this.app, g = app.people.grandma;
    if (this.fall) return;
    this.logBox.clear();
    this.t = 0;
    g.fall();
    const room = roomById(g.room) ?? roomById('hall1');
    this.fall = { t: 0, room, detected: false };
    this.fallActive = true;
    this.log(`奶奶在${room.name}摔倒（模拟）`, 'err');
    app.viewFloor(0);
    app.rig.flyTo([g.x + 3, 7, g.z + 6], [g.x, 0.3, g.z]);
  }

  fallTimeline(dt) {
    const f = this.fall, app = this.app, g = app.people.grandma;
    f.t += dt; this.t = f.t;
    const sensorId = 'presence-' + f.room.id;
    if (app.devices.registry.get(sensorId)) app.devices.registry.setInfoData(sensorId, '检测结果', f.t < 3 ? '有人（姿态：倒地）' : '有人倒地，静止 ' + f.t.toFixed(0) + ' s');
    if (!f.detected && f.t > 3) {
      f.detected = true;
      if (app.devices.registry.get(sensorId)) app.devices.registry.setStatus(sensorId, 'fault');
      this.highlightRoom(f.room);
      this.fallLabel = app.makeLabel(`⚠ 跌倒报警：${f.room.name}`, 'alarm', g.x, 1.4, g.z);
      this.log('毫米波雷达检测到人体倒地且 3 秒无起身动作 → 判定跌倒', 'err');
      this.log('已推送：家属手机（语音电话）、物业值班终端；老人房声光报警', 'warn');
      toast(`⚠ 跌倒报警：${f.room.name}`, 'alarm', 4000);
      const h = this.sendHelper({ x: g.x + 0.7, z: g.z + 0.3 }, 0, (helper) => {
        if (!this.fall) return;
        helper.activity = '扶起老人';
        this.log(`${helper.name}已赶到，响应用时 ${f.t.toFixed(1)} s，正在扶起老人`, 'ok');
        setTimeout(() => this.resolveFall(), 2500);
      });
      if (h) this.log(`${h.name}${h.floor ? '（在二楼，经楼梯下楼）' : ''}正在赶来`, 'warn');
    }
  }

  resolveFall() {
    if (!this.fall) return;
    const app = this.app;
    app.people.grandma.standUp();
    const sensorId = 'presence-' + this.fall.room.id;
    if (app.devices.registry.get(sensorId)) app.devices.registry.setStatus(sensorId, 'normal');
    this.roomGlow.visible = false;
    this.fallLabel?.parent?.remove(this.fallLabel);
    for (const strobe of app.devices.registry.byType('strobe')) app.devices.registry.getIndicator(strobe.id)?.setIntensity(0);
    for (const p of [app.people.mom, app.people.girl]) if (p.mode === 'stop') p.mode = 'routine';
    this.log('老人已被扶起，报警解除', 'ok');
    this.fall = null;
    this.fallActive = false;
  }

  // ================= 入侵检测 =================
  triggerIntrusion() {
    const app = this.app, dev = app.devices, it = app.people.intruder;
    if (this.intrusion) return;
    this.logBox.clear();
    this.t = 0;
    for (const camera of dev.registry.byType('camera')) dev.registry.getCamera(camera.id)?.setArmed(true);
    this.log('离家布防：摄像头、围栏红外对射、门窗磁已布防', 'warn');
    it.object.visible = true;
    it.setPosition(15.2, -11.0, 0);
    it.activity = '在围栏外徘徊';
    // 陌生人：从东北角走到围栏边 → 翻越围栏 → 走向设备间北窗
    it.path = [{ x: 14.2, y: 0, z: -9.9 }, { x: 13.0, y: 0.9, z: -9.2 }, { x: 11.9, y: 0, z: -8.5 }, { x: 8.4, y: 0, z: -6.4 }, { x: 5.8, y: 0, z: -5.7 }];
    it.running = false;
    this.intrusion = { t: 0, stage: 0 };
    app.viewFloor('all');
    app.rig.flyTo([24, 13, 6], [10, 0.5, -7]);
  }

  intrusionTimeline(dt) {
    const I = this.intrusion, app = this.app, dev = app.devices, it = app.people.intruder;
    I.t += dt; this.t = I.t;
    if (I.stage === 0 && it.x < 13.1) {
      I.stage = 1;
      this.log('围栏红外对射被遮断（东北角）→ 入侵预警', 'warn');
      for (const led of app.env.beamPosts) led.material.emissiveIntensity = 4;
    }
    if (I.stage === 1 && it.x < 11) {
      I.stage = 2;
      this.detectBox.visible = true;
      this.detectLabel = app.makeLabel('⚠ 识别到陌生人', 'alarm', it.x, 2.2, it.z);
      dev.registry.getCamera('camera-back')?.setAlert(true);
      this.log('后院 AI 摄像头识别到人形目标（非家庭成员）→ 入侵报警', 'err');
      dev.registry.setPower('floodlight', true);
      this.alarmOn = true;
      this.log('联动：庭院投光灯全亮、声光报警器鸣响', 'warn');
      this.log('已推送：业主手机（附抓拍画面）、物业安保中心', 'warn');
      toast('⚠ 入侵报警：后院', 'alarm', 4000);
      dev.registry.setStatus('camera-back', 'fault');
    }
    if (I.stage === 2 && I.t > 7 && !it.path.length) {
      I.stage = 3;
      it.activity = '被发现后逃离';
      it.running = true;
      it.path = [{ x: 8.4, y: 0, z: -6.4 }, { x: 11.9, y: 0, z: -8.5 }, { x: 13.0, y: 0.9, z: -9.2 }, { x: 16, y: 0, z: -13 }, { x: 22, y: 0, z: -20 }];
      this.log('陌生人受到灯光与警报威慑后逃离', 'ok');
    }
    if (this.detectBox.visible) {
      this.detectBox.box.setFromObject(it.object);
      this.detectLabel?.position.set(it.x, 2.2, it.z);
    }
    if (I.stage === 3 && !it.path.length) this.resetIntrusion(true);
  }

  resetIntrusion(done = false) {
    const app = this.app, dev = app.devices, it = app.people.intruder;
    if (!this.intrusion) return;
    this.intrusion = null;
    it.object.visible = false;
    it.path = [];
    this.detectBox.visible = false;
    this.detectLabel?.parent?.remove(this.detectLabel);
    for (const camera of dev.registry.byType('camera')) { dev.registry.getCamera(camera.id)?.setArmed(false); dev.registry.getCamera(camera.id)?.setAlert(false); }
    for (const led of app.env.beamPosts) led.material.emissiveIntensity = 1;
    dev.registry.setStatus('camera-back', 'normal');
    dev.registry.setPower('floodlight', false);
    this.alarmOn = false;
    for (const strobe of dev.registry.byType('strobe')) dev.registry.getIndicator(strobe.id)?.setIntensity(0);
    this.log(done ? '目标已离开监控范围，报警解除，录像已保存' : '入侵演示已结束', 'ok');
  }

  // ================= 安全巡检 =================
  inspect() {
    const app = this.app;
    this.logBox.clear();
    this.t = 0;
    const registry = app.devices.registry;
    const list = registry.all().filter((d) => d.module && /消防|安全/.test(d.module.info.category ?? ''));
    registry.setStatus('ext-kitchen', 'warning');
    registry.setInfoData('ext-kitchen', '压力', '0.9 MPa（黄区，偏低）');
    let ok = 0;
    for (const d of list) {
      const st = registry.getStatus(d.id) ?? 'normal';
      if (st === 'normal') ok++;
      this.logBox.add(this.now(), `${d.module.info.name}：${st === 'normal' ? '正常' : st === 'warning' ? '预警' : '故障'}`, st === 'normal' ? 'ok' : 'warn');
    }
    this.log(`巡检完成：共 ${list.length} 项，正常 ${ok} 项，需关注 ${list.length - ok} 项（厨房灭火器压力偏低）`, ok === list.length ? 'ok' : 'warn');
    this.pins.visible = true;
    this.pinToggle.refresh();
    app.viewFloor(0);
    app.rig.flyTo([0, 24, 12], [0, 0, 0]);
  }

  buildPanel(root) {
    const app = this.app;
    const s1 = section('火灾报警与疏散', '模拟一层厨房油锅起火：烟雾沿天花板扩散，感烟探测器报警，系统自动切断燃气、打开疏散门、点亮应急照明、电梯迫降停用，并用 A* 算法为每位居民计算绕开火源的最短疏散路线（二楼的人经楼梯下楼）。');
    s1.append(el('div', { class: 'btns' },
      button('🔥 模拟厨房起火', () => this.startFire(), 'danger'),
      button('扑灭 / 复位', () => this.resetFire()),
      button('查看厨房', () => { app.viewFloor(0); app.rig.flyTo([5.0, 5.4, 6.6], [6.2, 0.8, 2.4]); }),
    ));
    this.fireStats = stats([
      { k: '报警响应', v: () => (this.fireActive && this.t >= 1.5 ? '1.5' : '—'), unit: 's' },
      { k: '疏散人数', v: () => `${this.evacDone ?? 0}/${app.people.list.length}` },
      { k: '疏散用时', v: () => (this.evacTime ? this.evacTime.toFixed(1) : this.fireActive && this.evacStart !== undefined ? (this.t - this.evacStart).toFixed(1) : '—'), unit: 's' },
      { k: '厨房温度', v: () => app.envModel.rooms.kitchen.temp.toFixed(0), unit: '℃' },
    ]);
    s1.append(this.fireStats);
    root.append(s1);

    const s2 = section('适老安全：一键呼叫与跌倒检测', '老人按下床头或卫生间的呼叫按钮（或拉绳），系统立即报警并通知家属；毫米波雷达检测到老人倒地且长时间不动，也会自动报警。家属会从所在位置（可能在二楼）赶来。');
    s2.append(el('div', { class: 'btns' },
      button('🆘 老人房床头呼叫', () => this.triggerSOS('sos-elder'), 'danger'),
      button('🆘 卫生间呼叫', () => this.triggerSOS('sos-bath'), 'danger'),
      button('取消呼叫', () => this.cancelSOS()),
    ));
    s2.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('⚠ 模拟老人跌倒', () => this.triggerFall(), 'danger'),
      button('扶起 / 解除', () => this.resolveFall()),
    ));
    root.append(s2);

    const s3 = section('入侵检测（离家布防）', '离家后系统自动布防：围栏红外对射、AI 摄像头、门窗磁。陌生人翻越围栏时，摄像头识别人形并联动投光灯、声光报警，推送业主和物业。');
    s3.append(el('div', { class: 'btns' }, button('🚨 模拟夜间入侵', () => { app.setTime(22); app.syncTime(); this.triggerIntrusion(); }, 'danger'), button('结束演示', () => this.resetIntrusion())));
    root.append(s3);

    const s4 = section('处置过程记录');
    this.logBox = logBox();
    this.logBox.add('--:--', '等待事件…');
    s4.append(this.logBox);
    root.append(s4);

    const s5 = section('安全设施巡检', '房屋主体、门窗、楼梯护栏、阳台栏杆、电梯、燃气、电气与消防设施均设置安全状态与维护信息；状态视图中：绿色 = 正常，黄色 = 预警，红色 = 故障。');
    this.pinToggle = toggle('显示安全状态视图', () => this.pins.visible, (v) => { this.pins.visible = v; });
    s5.append(this.pinToggle);
    s5.append(el('div', { class: 'btns' }, button('一键安全巡检', () => this.inspect(), 'primary'), button('燃气阀门', () => app.selection.selectDevice('gas-valve')), button('电梯', () => app.selection.selectDevice('elevator')), button('配电箱', () => app.selection.selectDevice('distribution'))));
    root.append(s5);
  }

  onSelect(obj) {
    const id = obj?.userData.deviceId;
    if (id === 'sos-elder' || id === 'sos-bath') {
      const info = this.app.devices.registry.getModule(id)?.info;
      if (info) info.controls = [{ type: 'button', label: '按下呼叫按钮', onClick: () => this.triggerSOS(id) }, { type: 'button', label: '取消呼叫', onClick: () => this.cancelSOS() }];
      this.app.selection.render();
    }
  }

  enter() {}
  leave() { this.pins.visible = false; this.pinToggle.refresh(); }

  update(dt) {
    this.time += dt;
    this.flame.update(dt);
    this.smoke.update(dt);
    this.pins.update(this.time);
    for (const r of this.routes) r.update(dt, 2);
    const dev = this.app.devices;
    if (this.fireActive) {
      this.t += dt;
      this.fireTimeline();
      this.fireLamp.intensity = 25 + Math.random() * 15;
    }
    if (this.fall) this.fallTimeline(dt);
    if (this.intrusion) this.intrusionTimeline(dt);
    const blinkOn = Math.floor(this.time * 3) % 2 === 0;
    if (this.alarmOn) {
      for (const strobe of dev.registry.byType('strobe')) dev.registry.getIndicator(strobe.id)?.setIntensity(blinkOn ? 4 : 0);
    }
    if (this.sos || this.fall?.detected) {
      if (this.sos) { this.sos.t += dt; this.t = this.sos.t; this.app.devices.registry.getSos(this.sos.id)?.setIndicator(blinkOn ? 3 : 0.3); }
      this.roomGlow.material.opacity = 0.18 + 0.15 * Math.abs(Math.sin(this.time * 4));
      dev.registry.getIndicator('strobe-elder')?.setIntensity(blinkOn ? 4 : 0);
    }
  }

  slowUpdate(dt, active) { if (active) this.fireStats.refresh(); }
}
