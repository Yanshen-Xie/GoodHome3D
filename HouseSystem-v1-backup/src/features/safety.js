// 安全耐久：
//  1. 火灾报警与疏散：厨房起火 → 烟感报警 → 声光报警、切断燃气、开门解锁、应急照明 → 防火门关闭
//     → A* 计算避开火源的最短疏散路线 → 居民沿路线跑到室外安全出口，统计疏散用时
//  2. 一键呼叫：老人按下床头按钮 → 按钮变红、房间高亮、通知家属与物业 → 家属前往
//  3. 安全巡检与状态视图：用颜色区分正常 / 预警 / 故障
import * as THREE from 'three';
import { EXITS, roomById } from '../scene/layout.js';
import { Emitter } from '../systems/particles.js';
import { FloorPath } from '../systems/pathViz.js';
import { StatusPins } from '../systems/statusPins.js';
import { section, button, stats, logBox, hint, toggle, el, toast } from '../ui/ui.js';

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
    // 烟雾：先上升到天花板，再沿天花板向四周扩散；防火门关闭前会从门洞漫到餐厅
    this.smoke = new Emitter(app.scene, {
      count: 1400, rate: 140, life: [6, 10], size: [0.4, 1.6], alpha: [0.55, 0],
      colors: [new THREE.Color(0.25, 0.25, 0.25), new THREE.Color(0.55, 0.55, 0.55)],
      spawn: (p) => {
        p.x = STOVE.x + (Math.random() - 0.5) * 0.4; p.y = STOVE.y + 0.5; p.z = STOVE.z + (Math.random() - 0.5) * 0.4;
        p.vx = (Math.random() - 0.5) * 0.2; p.vy = 1.0 + Math.random() * 0.5; p.vz = (Math.random() - 0.5) * 0.2;
      },
      force: (p, dt) => {
        if (p.y > 2.6) { // 碰到天花板：竖直速度衰减，水平向外扩散
          p.vy *= 0.5; p.y = Math.min(p.y, 2.85);
          const dx = p.x - STOVE.x, dz = p.z - STOVE.z, d = Math.hypot(dx, dz) || 1;
          p.vx += (dx / d) * dt * 0.8 + (Math.random() - 0.5) * dt; p.vz += (dz / d) * dt * 0.8 + (Math.random() - 0.5) * dt;
        }
        // 厨房墙体限制：防火门关上后烟雾不能越过 x=4.1；门开着时只能从门洞 (z 1.1~2.1) 漫出
        const doorOpen = this.app.house.doors['door-kitchen'].t > 0.2;
        const inDoor = p.z > 1.15 && p.z < 2.05 && p.y < 2.2 && doorOpen;
        if (p.x < 4.15 && p.x > 3.8 && !inDoor) { p.x = 4.15; p.vx = Math.abs(p.vx) * 0.3; }
        if (p.z < 0.75 && p.x > 4) { p.z = 0.75; p.vz = Math.abs(p.vz) * 0.3; }
        if (p.x > 7.85) { p.x = 7.85; p.vx = -Math.abs(p.vx) * 0.3; }
        if (p.z > 4.85) { p.z = 4.85; p.vz = -Math.abs(p.vz) * 0.3; }
        p.vx *= 1 - dt * 0.3; p.vz *= 1 - dt * 0.3;
      },
    });
    this.fireLight = new THREE.PointLight(0xff7a20, 0, 8, 2);
    this.fireLight.position.set(STOVE.x - 0.3, 1.5, STOVE.z);
    app.scene.add(this.fireLight);
    // 一键呼叫时房间地面高亮
    this.roomGlow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xff3030, transparent: true, opacity: 0.3, depthWrite: false }));
    this.roomGlow.rotation.x = -Math.PI / 2;
    this.roomGlow.visible = false;
    this.roomGlow.userData.noPick = true;
    app.scene.add(this.roomGlow);
    this.sos = null;
    this.pins = new StatusPins(app.scene, app.devices, (d) => /消防|安全/.test(d.info?.category ?? ''));
    this.time = 0;
  }

  now() {
    const h = this.app.clock.hour;
    return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}+${this.t.toFixed(1)}s`;
  }

  log(text, cls) { this.logBox.add(this.now(), text, cls); }

  // ================= 火灾 =================
  startFire() {
    if (this.fireActive) return;
    const app = this.app;
    this.resetFire(true);
    this.fireActive = true;
    this.t = 0;
    this.steps = new Set();
    this.evacDone = 0;
    this.logBox.clear();
    this.flame.start();
    this.smoke.start();
    app.envModel.extra.kitchen = { temp: 65, pm: 600 };
    this.labels.push(app.makeLabel('🔥 起火点：厨房灶台', 'alarm', STOVE.x, 2.2, STOVE.z));
    this.log('厨房灶台油锅起火（模拟）', 'err');
    app.setRoof(false);
    app.rig.flyTo([1.5, 13, 11], [3.5, 0, 0.5]);
    for (const p of app.people.list) { p.mode = 'stop'; }
  }

  // 按时间推进的处置流程
  fireTimeline() {
    const app = this.app, dev = app.devices, t = this.t, once = (k, fn) => { if (t >= k && !this.steps.has(k)) { this.steps.add(k); fn(); } };
    once(1.5, () => {
      dev.setStatus('smoke-kitchen', 'fault');
      dev.byId['smoke-kitchen'].object.userData.info.data.烟雾浓度 = '0.35 dB/m（超限）';
      this.log('厨房感烟探测器报警（烟雾浓度超限）', 'err');
      toast('⚠ 火灾报警：厨房', 'alarm', 4000);
      this.alarmOn = true;
    });
    once(2.2, () => {
      dev.byId['gas-valve'].set(false);
      dev.setStatus('gas-valve', 'warning');
      this.log('联动：切断厨房燃气阀门', 'warn');
      dev.byId['smart-lock'].set(false);
      for (const id of ['door-entry', 'door-back', 'door-living']) app.house.doors[id].setOpen(true);
      this.log('联动：智能门锁解锁，入户门、后门、客厅落地门打开', 'warn');
      for (const m of dev.emergencyMats) m.emissiveIntensity = 3;
      for (const m of dev.exitMats) m.emissiveIntensity = 1.6;
      for (const l of dev.lights) if (l.room !== 'kitchen') l.set(true, 1, 5000);
      this.log('联动：点亮应急照明与安全出口标志', 'warn');
      this.log('推送报警：家属手机、物业消防控制室；自动拨打 119（模拟）', 'warn');
    });
    once(3.0, () => this.planEvacuation());
    // 厨房里没人后自动关闭防火门
    if (t > 3 && !this.steps.has('door') && !app.people.list.some((p) => p.room === 'kitchen')) {
      this.steps.add('door');
      app.house.doors['door-kitchen'].setOpen(false);
      dev.setStatus('door-kitchen', 'warning');
      this.log('防火门自动关闭，阻止烟气蔓延到餐厅和走廊', 'warn');
    }
  }

  planEvacuation() {
    const app = this.app;
    app.nav.setDanger(STOVE.x, STOVE.z, 1.8); // 火源周围 1.8 米为危险区，路线必须绕开
    this.dangerRing = new THREE.Mesh(new THREE.CircleGeometry(1.8, 48), new THREE.MeshBasicMaterial({ color: 0xff3b1f, transparent: true, opacity: 0.25, depthWrite: false }));
    this.dangerRing.rotation.x = -Math.PI / 2; this.dangerRing.position.set(STOVE.x, 0.05, STOVE.z);
    app.scene.add(this.dangerRing);
    this.evacStart = this.t;
    const colors = [0x2ecc71, 0x27c3e6];
    app.people.list.forEach((p, i) => {
      // 分别计算到每个安全出口的路线，选最短的
      let best = null;
      for (const ex of EXITS) {
        const path = app.nav.findPath(p.x, p.z, ex.x, ex.z, { avoidDanger: true });
        if (!path) continue;
        let len = 0;
        for (let k = 1; k < path.length; k++) len += Math.hypot(path[k].x - path[k - 1].x, path[k].z - path[k - 1].z);
        if (!best || len < best.len) best = { ex, path, len };
      }
      if (!best) { this.log(`${p.name}：未找到安全路线！`, 'err'); return; }
      const route = new FloorPath([{ x: p.x, z: p.z }, ...best.path], colors[i % 2], 0.45);
      app.scene.add(route.mesh);
      this.routes.push(route);
      this.log(`${p.name}（${roomById(p.room)?.name ?? '室外'}）→ ${best.ex.name}，路线长 ${best.len.toFixed(1)} m`, 'ok');
      p.mode = 'evacuate';
      p.activity = '紧急疏散中';
      p.goTo(best.ex.x, best.ex.z, {
        run: true, avoidDanger: true,
        onArrive: () => {
          p.activity = '已疏散至室外';
          this.evacDone++;
          this.log(`${p.name} 已到达安全区域（${best.ex.name}外），用时 ${(this.t - this.evacStart).toFixed(1)} s`, 'ok');
          if (this.evacDone === app.people.list.length) {
            this.evacTime = this.t - this.evacStart;
            this.log(`全员疏散完毕，总用时 ${this.evacTime.toFixed(1)} s`, 'ok');
            toast(`全员疏散完毕，用时 ${this.evacTime.toFixed(1)} 秒`, '', 4000);
          }
        },
      });
    });
    for (const ex of EXITS) this.labels.push(this.app.makeLabel('安全出口：' + ex.name, 'dark', ex.x, 1.2, ex.z));
  }

  resetFire(silent = false) {
    const app = this.app, dev = app.devices;
    this.fireActive = false;
    this.alarmOn = false;
    this.flame.clear(); this.smoke.clear();
    this.fireLight.intensity = 0;
    delete app.envModel.extra.kitchen;
    Object.assign(app.envModel.rooms.kitchen, { temp: app.envModel.rooms.dining.temp + 0.5, pm: 20 });
    app.nav.setDanger(0, 0, 0);
    for (const r of this.routes) r.dispose();
    this.routes = [];
    for (const l of this.labels) l.parent?.remove(l);
    this.labels = [];
    if (this.dangerRing) { app.scene.remove(this.dangerRing); this.dangerRing = null; }
    dev.setStatus('smoke-kitchen', 'normal');
    dev.byId['smoke-kitchen'].object.userData.info.data.烟雾浓度 = '0.00 dB/m';
    dev.setStatus('gas-valve', 'normal');
    dev.setStatus('door-kitchen', 'normal');
    dev.byId['gas-valve'].set(true);
    dev.byId['smart-lock'].set(true);
    for (const id of ['door-entry', 'door-back', 'door-living']) app.house.doors[id].setOpen(false);
    app.house.doors['door-kitchen'].setOpen(true);
    for (const m of dev.emergencyMats) m.emissiveIntensity = 0;
    for (const m of dev.exitMats) m.emissiveIntensity = 0.4;
    for (const m of dev.strobeMats) m.emissiveIntensity = 0;
    dev.alarmLight.intensity = 0;
    for (const l of dev.lights) l.set(false);
    if (!silent) {
      // 居民回到室内，恢复日常活动
      const homes = [[-6.3, 2.2], [1.9, -3.3]];
      app.people.list.forEach((p, i) => { p.mode = 'routine'; p.activity = '返回室内'; p.goTo(...homes[i], { onArrive: () => { p.waitTimer = 2; } }); });
      this.log('火情处置完毕，系统复位', 'ok');
    }
  }

  // ================= 一键呼叫 =================
  triggerSOS(id = 'sos-elder') {
    const app = this.app;
    this.cancelSOS(true);
    const dev = app.devices.byId[id];
    const room = roomById(dev.room);
    this.sos = { id, t: 0, dev, room };
    dev.active = true;
    dev.object.userData.info.data.状态 = '呼叫中';
    app.devices.setStatus(id, 'fault');
    this.roomGlow.scale.set(room.x1 - room.x0 - 0.2, room.z1 - room.z0 - 0.2, 1);
    this.roomGlow.position.set((room.x0 + room.x1) / 2, 0.045, (room.z0 + room.z1) / 2);
    this.roomGlow.visible = true;
    const p = dev.object.getWorldPosition(new THREE.Vector3());
    this.sosLabel = app.makeLabel(`🆘 一键呼叫：${room.name}`, 'alarm', p.x, 1.9, p.z);
    this.logBox.clear();
    this.t = 0;
    this.log(`${room.name}一键呼叫按钮被按下`, 'err');
    this.log('网关定位求助位置：' + dev.info.name.replace(/.*（|）/g, ''), 'warn');
    this.log('已推送：家属手机 App、物业值班终端（弹窗 + 声音）', 'warn');
    toast(`🆘 ${room.name} 一键呼叫`, 'alarm', 4000);
    app.setRoof(false);
    app.rig.flyTo([room.x0 - 1, 9, room.z1 + 6], [(room.x0 + room.x1) / 2, 0, (room.z0 + room.z1) / 2]);
    // 最近的家属前往求助位置
    const target = { x: (room.x0 + room.x1) / 2, z: room.z1 - 0.6 };
    const helper = app.people.list[0];
    helper.mode = 'stop';
    helper.activity = '前往' + room.name + '救助';
    helper.goTo(target.x, target.z, {
      run: true,
      onArrive: () => {
        if (!this.sos) return;
        helper.activity = '正在' + room.name + '照看老人';
        this.sos.arrived = true;
        this.log(`家属已到达${room.name}，响应用时 ${this.sos.t.toFixed(1)} s`, 'ok');
      },
    });
  }

  cancelSOS(silent = false) {
    if (!this.sos) return;
    const app = this.app, dev = this.sos.dev;
    dev.active = false;
    dev.btnMat.emissiveIntensity = 0.15;
    dev.object.userData.info.data.状态 = '待机';
    app.devices.setStatus(dev.id, 'normal');
    this.roomGlow.visible = false;
    this.sosLabel?.parent?.remove(this.sosLabel);
    for (const m of app.devices.strobeMats) m.emissiveIntensity = 0;
    this.sos = null;
    app.people.list[0].mode = 'routine';
    if (!silent) this.log('呼叫已取消 / 处理完毕', 'ok');
  }

  // ================= 安全巡检 =================
  inspect() {
    const app = this.app;
    this.logBox.clear();
    this.t = 0;
    const list = app.devices.list.filter((d) => d.object && /消防|安全/.test(d.info?.category ?? ''));
    // 模拟：厨房灭火器压力偏低（预警），其余正常
    app.devices.setStatus('ext-kitchen', 'warning');
    app.devices.byId['ext-kitchen'].object.userData.info.data.压力 = '0.9 MPa（黄区，偏低）';
    let ok = 0;
    for (const d of list) {
      const st = d.status;
      if (st === 'normal') ok++;
      this.log(`${d.info.name}：${st === 'normal' ? '正常' : st === 'warning' ? '预警' : '故障'}`, st === 'normal' ? 'ok' : 'warn');
    }
    this.log(`巡检完成：共 ${list.length} 项，正常 ${ok} 项，需关注 ${list.length - ok} 项`, ok === list.length ? 'ok' : 'warn');
    this.pins.visible = true;
    this.pinToggle.refresh();
    app.setRoof(false);
    app.rig.flyTo([0, 22, 12], [0, 0, 0]);
  }

  buildPanel(root) {
    const app = this.app;
    const s1 = section('火灾报警与疏散', '模拟厨房油锅起火：烟雾上升并沿天花板扩散，感烟探测器报警，系统自动切断燃气、打开疏散门、点亮应急照明，并用 A* 算法为每位居民计算绕开火源的最短疏散路线。');
    s1.append(el('div', { class: 'btns' },
      button('🔥 模拟厨房起火', () => this.startFire(), 'danger'),
      button('扑灭 / 复位', () => this.resetFire()),
      button('查看厨房', () => { app.setRoof(false); app.rig.flyTo([2.4, 2.6, 4.2], [6.8, 1.0, 2.0]); }),
    ));
    this.fireStats = stats([
      { k: '报警响应', v: () => (this.fireActive ? (this.t >= 1.5 ? '1.5' : '—') : '—'), unit: 's' },
      { k: '疏散人数', v: () => `${this.evacDone ?? 0}/${app.people.list.length}` },
      { k: '疏散用时', v: () => (this.evacTime ? this.evacTime.toFixed(1) : this.fireActive && this.evacStart !== undefined ? (this.t - this.evacStart).toFixed(1) : '—'), unit: 's' },
      { k: '厨房温度', v: () => app.envModel.rooms.kitchen.temp.toFixed(0), unit: '℃' },
    ]);
    s1.append(this.fireStats);
    root.append(s1);

    const s2 = section('一键呼叫（适老）', '老人在床头或卫生间遇到紧急情况时，按下按钮或拉动拉绳，系统立即报警并通知家属和物业，三维场景高亮求助者所在房间。也可以直接点击场景中的红色呼叫按钮。');
    s2.append(el('div', { class: 'btns' },
      button('🆘 老人房床头呼叫', () => this.triggerSOS('sos-elder'), 'danger'),
      button('🆘 卫生间呼叫', () => this.triggerSOS('sos-bath'), 'danger'),
      button('取消呼叫', () => this.cancelSOS()),
    ));
    root.append(s2);

    const s3 = section('处置过程记录');
    this.logBox = logBox();
    this.logBox.add('--:--', '等待事件…');
    s3.append(this.logBox);
    root.append(s3);

    const s4 = section('安全设施巡检', '房屋主体、门窗、燃气、电气与消防设施均设置安全状态与维护信息；点击构件可查看。状态视图中：绿色 = 正常，黄色 = 预警，红色 = 故障。');
    this.pinToggle = toggle('显示安全状态视图', () => this.pins.visible, (v) => { this.pins.visible = v; if (v) app.setRoof(false); });
    s4.append(this.pinToggle);
    s4.append(el('div', { class: 'btns' }, button('一键安全巡检', () => this.inspect(), 'primary'), button('查看燃气阀门', () => app.selection.selectDevice('gas-valve')), button('查看配电箱', () => app.selection.selectDevice('distribution'))));
    root.append(s4);
  }

  // 点击场景中的一键呼叫按钮时也能触发
  onSelect(obj) {
    const id = obj?.userData.deviceId;
    if (id === 'sos-elder' || id === 'sos-bath') {
      const info = obj.userData.info;
      info.controls = [{ type: 'button', label: '按下呼叫按钮', onClick: () => this.triggerSOS(id) }, { type: 'button', label: '取消呼叫', onClick: () => this.cancelSOS() }];
      this.app.selection.render();
    }
  }

  enter() { this.app.setRoof(false); }
  leave() { this.pins.visible = false; this.pinToggle.refresh(); }

  update(dt, active) {
    this.time += dt;
    this.flame.update(dt);
    this.smoke.update(dt);
    this.pins.update(this.time);
    for (const r of this.routes) r.update(dt, 2);
    const dev = this.app.devices;
    if (this.fireActive) {
      this.t += dt;
      this.fireTimeline();
      this.fireLight.intensity = 25 + Math.random() * 15;
    }
    // 报警时声光报警器闪烁（红光一亮一灭）
    const blinkOn = Math.floor(this.time * 3) % 2 === 0;
    if (this.alarmOn) {
      for (const m of dev.strobeMats) m.emissiveIntensity = blinkOn ? 4 : 0;
      dev.alarmLight.intensity = blinkOn ? 12 : 0;
    }
    if (this.sos) {
      this.sos.t += dt;
      this.t = this.sos.t;
      this.sos.dev.btnMat.emissiveIntensity = blinkOn ? 3 : 0.3;
      this.roomGlow.material.opacity = 0.18 + 0.15 * Math.abs(Math.sin(this.time * 4));
      dev.strobeMats[2].emissiveIntensity = blinkOn ? 4 : 0;
    }
  }

  slowUpdate(dt, active) { if (active) this.fireStats.refresh(); }
}
