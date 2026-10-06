// 绿色低碳：
//  1. 屋顶光伏发电：发电功率 = 装机容量 × 辐照强度 × 入射角余弦 × 天气系数 × 系统效率
//  2. 能量流动：光伏 → 逆变器 → 储能电池 / 家庭用电 / 电网，用"流动的发光管线"表示方向和大小
//  3. 普通方案与绿色方案对比：用电量、电费、碳排放
import * as THREE from 'three';
import { sunDirection, WEATHER } from '../scene/environment.js';
import { section, stats, chart, chartBase, toggle, button, hint, el, toast } from '../ui/ui.js';

const PV_KWP = 9.9;               // 装机容量 kWp
const BATTERY_KWH = 10;           // 电池容量
const CO2_FACTOR = 0.5703;        // 全国电网平均排放因子 kgCO₂/kWh（2022 年）
const PRICE = 0.62;               // 电价 元/kWh
const PANEL_NORMAL = new THREE.Vector3(0, Math.cos(THREE.MathUtils.degToRad(20)), Math.sin(THREE.MathUtils.degToRad(20))); // 朝南倾斜 20°

/** 光伏功率（kW）：直射部分按入射角余弦，另加少量散射光 */
export function pvPower(hour, day, weather) {
  const s = sunDirection(hour, day);
  if (s.elevation <= 0) return 0;
  const cosI = Math.max(0, PANEL_NORMAL.dot(s.dir));
  const airMass = Math.min(1, Math.sin(THREE.MathUtils.degToRad(s.elevation)) * 1.6); // 太阳低时大气衰减大
  const w = WEATHER[weather].pv;
  const direct = cosI * airMass * w;
  const diffuse = 0.12 * Math.min(1, s.elevation / 20) * (w < 1 ? 1.4 : 1);
  return PV_KWP * (direct + diffuse) * 0.85; // 0.85：逆变器、线损、温度等综合效率
}

/** 典型家庭用电曲线（kW）：早晚高峰，夜间低谷 */
function typicalLoad(hour, green) {
  const base = green ? 0.25 : 0.4;
  const peak = (c, w, a) => a * Math.exp(-((hour - c) ** 2) / (2 * w * w));
  let l = base + peak(7.5, 1, 0.9) + peak(12, 1.2, 0.6) + peak(19.5, 1.8, 1.8) + peak(14.5, 2.5, 0.8);
  if (!green) l *= 1.45; // 普通方案：电热水器、普通空调、白炽 / 荧光灯，能耗更高
  return l;
}

let dashTex = null;
function flowTexture() {
  if (dashTex) return dashTex;
  const c = document.createElement('canvas'); c.width = 128; c.height = 16;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 128, 0);
  grd.addColorStop(0, 'rgba(255,255,255,0.15)'); grd.addColorStop(0.55, 'rgba(255,255,255,0.35)'); grd.addColorStop(0.8, 'rgba(255,255,255,1)'); grd.addColorStop(1, 'rgba(255,255,255,0.15)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 16);
  dashTex = new THREE.CanvasTexture(c);
  dashTex.wrapS = THREE.RepeatWrapping;
  return dashTex;
}

/** 一条能量流管线：沿折线的管子，纹理沿管子滚动表示能量流动方向 */
class FlowLine {
  constructor(scene, pts, color) {
    const curve = new THREE.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) curve.add(new THREE.LineCurve3(new THREE.Vector3(...pts[i]), new THREE.Vector3(...pts[i + 1])));
    const len = curve.getLength();
    this.tex = flowTexture().clone();
    this.tex.needsUpdate = true;
    this.tex.repeat.x = len / 0.8;
    const geo = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 6)), 0.08, 8, false);
    this.mat = new THREE.MeshBasicMaterial({ color, map: this.tex, transparent: true, depthTest: false, opacity: 0.95 });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.renderOrder = 8;
    this.mesh.userData.noPick = true;
    scene.add(this.mesh);
    this.power = 0;
  }
  // power > 0 顺着折线方向流动，< 0 反向；功率越大流得越快、越粗
  set(power, visible) {
    this.power = power;
    this.mesh.visible = visible && Math.abs(power) > 0.02;
    this.mat.opacity = 0.5 + Math.min(0.5, Math.abs(power) / 4);
  }
  update(dt) { this.tex.offset.x -= dt * Math.sign(this.power) * (0.8 + Math.min(3, Math.abs(this.power))); }
}

export class GreenFeature {
  constructor(app) {
    this.app = app;
    this.state = { pv: 0, load: 0, soc: 55, battery: 0, grid: 0 };
    this.showFlows = true;
    this.ecoMode = false;
    this.lastHour = app.clock.hour;
    const s = app.scene;
    // 能量流管线（坐标为折线顶点）
    this.flows = {
      pv: new FlowLine(s, [[0, 3.9, 1.2], [7.9, 3.6, 1.2], [8.35, 3.3, 1.2], [8.35, 1.9, 1.2]], 0xffc53d),                  // 光伏 → 逆变器
      battery: new FlowLine(s, [[8.35, 1.3, 1.45], [8.35, 1.3, 1.85], [8.6, 1.1, 2.1]], 0x36d399),                            // 逆变器 → 电池（负值为放电）
      home: new FlowLine(s, [[8.2, 1.6, 1.0], [8.2, 2.75, 0.2], [0.5, 2.75, -0.2], [-5.9, 2.75, -0.5], [-5.9, 1.9, -0.8]], 0xff8a3d), // 逆变器 → 配电箱
      grid: new FlowLine(s, [[-6.2, 1.9, -0.8], [-6.2, 2.75, -0.5], [-8.6, 2.75, -0.5], [-14.6, 5.5, -3.5]], 0x6c8cff),       // 配电箱 → 电网（负值为从电网取电）
    };
    // 电网接入点：路边电线杆
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 7, 10), new THREE.MeshStandardMaterial({ color: 0x8a8a80, roughness: 0.9 }));
    pole.position.set(-14.6, 3.5, -3.5);
    pole.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.1, 0.1), new THREE.MeshStandardMaterial({ color: 0x555555 }));
    arm.position.set(-14.6, 6.6, -3.5);
    app.env.group.add(pole, arm);
    pole.userData.info = { name: '电网接入点（低压电杆）', category: '绿色低碳', func: '光伏余电上网 / 夜间从电网购电，双向计量电表', status: 'normal', data: {} };
    this.gridInfo = pole.userData.info;
    // 能量数值标签
    this.lbl = {
      pv: app.makeLabel('', 'energy', 0, 4.6, -0.5),
      inv: app.makeLabel('', 'energy', 9.3, 2.2, 1.2),
      bat: app.makeLabel('', 'energy', 9.3, 1.3, 2.3),
      home: app.makeLabel('', 'energy', -5.9, 2.4, -0.2),
      grid: app.makeLabel('', 'energy', -14.6, 7.3, -3.5),
    };
    this.setFlowsVisible(false);
  }

  setFlowsVisible(v) {
    this.flowsOn = v;
    for (const f of Object.values(this.flows)) f.mesh.visible = v;
    for (const l of Object.values(this.lbl)) l.visible = v;
  }

  // 当前家庭实际用电：由各设备状态累加（与智慧、舒适模块联动）
  currentLoad() {
    const d = this.app.devices;
    let kw = 0.18; // 冰箱、网关、待机设备
    for (const l of d.lights) if (l.on) kw += 0.012 + 0.02 * l.level;
    for (const x of d.list) if (x.type === 'ac' && x.on) kw += this.ecoMode ? 0.55 : 0.8;
    if (d.byId['fresh-air'].on) kw += 0.04 * d.byId['fresh-air'].level;
    if (this.app.features.smart?.tvOn) kw += 0.12;
    const h = this.app.clock.hour;
    if (h > 17 && h < 19.5) kw += 1.0; // 热泵制热水时段
    if (this.app.people.list.some((p) => p.activity.includes('做饭'))) kw += 0.6; // 抽油烟机、电饭煲
    return kw;
  }

  // 按模拟时间推进电池电量：光伏先供家用，多余充电，再多余上网；不足时先用电池，再从电网买
  step(dtHours) {
    const st = this.state, app = this.app;
    st.pv = pvPower(app.clock.hour, app.clock.day, app.clock.weather);
    st.load = this.currentLoad();
    const net = st.pv - st.load;
    let bat = 0;
    if (net > 0) bat = Math.min(net, 5, ((100 - st.soc) / 100) * BATTERY_KWH / Math.max(dtHours, 1e-3));
    else bat = -Math.min(-net, 5, ((st.soc - 10) / 100) * BATTERY_KWH / Math.max(dtHours, 1e-3));
    bat = Math.max(-5, Math.min(5, bat));
    st.battery = bat;                 // >0 充电，<0 放电
    st.grid = net - bat;              // >0 上网，<0 购电
    st.soc = Math.min(100, Math.max(10, st.soc + (bat * dtHours / BATTERY_KWH) * 100));
  }

  refreshScene() {
    const st = this.state, f = this.flows, on = this.flowsOn;
    f.pv.set(st.pv, on);
    f.battery.set(st.battery, on);
    f.home.set(st.load, on);
    f.grid.set(st.grid, on);
    const kw = (v) => Math.abs(v).toFixed(2) + ' kW';
    this.lbl.pv.element.innerHTML = `☀ 光伏发电 <b>${kw(st.pv)}</b>`;
    this.lbl.inv.element.innerHTML = `逆变器 效率 97.6%`;
    this.lbl.bat.element.innerHTML = `🔋 储能 <b>${st.soc.toFixed(0)}%</b> ${st.battery > 0.02 ? '充电 ' + kw(st.battery) : st.battery < -0.02 ? '放电 ' + kw(st.battery) : '待机'}`;
    this.lbl.home.element.innerHTML = `🏠 家庭用电 <b>${kw(st.load)}</b>`;
    this.lbl.grid.element.innerHTML = `⚡ 电网 <b>${st.grid > 0.02 ? '上网 ' + kw(st.grid) : st.grid < -0.02 ? '购电 ' + kw(st.grid) : '无交换'}</b>`;
    const dev = this.app.devices.byId;
    dev.pv.object.userData.info.data.当前功率 = kw(st.pv);
    dev.inverter.object.userData.info.data = { 输入功率: kw(st.pv), 输出功率: kw(st.pv * 0.976), 今日发电: this.todayPV().toFixed(1) + ' kWh' };
    dev.battery.object.userData.info.data = { 容量: BATTERY_KWH + ' kWh', 剩余电量: st.soc.toFixed(0) + '%', 状态: st.battery > 0.02 ? '充电' : st.battery < -0.02 ? '放电' : '待机', 功率: kw(st.battery) };
    dev.battery.socBar.scale.y = Math.max(0.05, st.soc / 100);
    dev.battery.socBar.position.y = 0.15 + 0.4 * dev.battery.socBar.scale.y;
    dev.distribution.object.userData.info.data.总电流 = (st.load * 1000 / 220).toFixed(1) + ' A';
    this.gridInfo.data = { 当前: st.grid > 0.02 ? '余电上网 ' + kw(st.grid) : st.grid < -0.02 ? '从电网购电 ' + kw(st.grid) : '无交换' };
  }

  todayPV() {
    let e = 0;
    for (let h = 0; h < this.app.clock.hour; h += 0.25) e += pvPower(h, this.app.clock.day, this.app.clock.weather) * 0.25;
    return e;
  }

  // 24 小时曲线：光伏发电与家庭用电（绿色方案 / 普通方案）
  drawDayChart() {
    const { day, weather, hour } = this.app.clock;
    const hs = [], pv = [], lg = [], ln = [];
    for (let h = 0; h <= 24; h += 0.5) { hs.push(h); pv.push(+pvPower(h, day, weather).toFixed(2)); lg.push(+typicalLoad(h, true).toFixed(2)); ln.push(+typicalLoad(h, false).toFixed(2)); }
    const sum = (a) => a.reduce((s, v) => s + v * 0.5, 0);
    this.daySum = { pv: sum(pv), green: sum(lg), normal: sum(ln) };
    this.dayChart.getChart().setOption({
      ...chartBase,
      title: { text: `24 小时发电与用电（${WEATHER[weather].name}）`, textStyle: { fontSize: 12 }, left: 0, top: 0 },
      legend: { ...chartBase.legend, top: 18, left: 0 },
      grid: { left: 36, right: 12, top: 44, bottom: 24 },
      xAxis: { type: 'value', min: 0, max: 24, interval: 4, axisLabel: { formatter: '{value}时' } },
      yAxis: { type: 'value', name: 'kW', nameTextStyle: { fontSize: 10 } },
      series: [
        { name: '光伏发电', type: 'line', data: hs.map((h, i) => [h, pv[i]]), showSymbol: false, smooth: true, areaStyle: { color: 'rgba(255,197,61,0.35)' }, lineStyle: { color: '#f0b429' }, itemStyle: { color: '#f0b429' },
          markLine: { symbol: 'none', data: [{ xAxis: hour }], lineStyle: { color: '#d64541' }, label: { formatter: '当前' } } },
        { name: '用电（绿色方案）', type: 'line', data: hs.map((h, i) => [h, lg[i]]), showSymbol: false, smooth: true, lineStyle: { color: '#2e9d57' }, itemStyle: { color: '#2e9d57' } },
        { name: '用电（普通方案）', type: 'line', data: hs.map((h, i) => [h, ln[i]]), showSymbol: false, smooth: true, lineStyle: { color: '#8a96a6', type: 'dashed' }, itemStyle: { color: '#8a96a6' } },
      ],
    }, true);
  }

  // 全年对比（估算）：普通方案无光伏、普通电器；绿色方案有保温、热泵、LED、光伏 + 储能
  drawCompare() {
    // 全年光伏发电量：用春分、夏至、秋分、冬至四天的晴天发电量近似，再乘阴雨天气折减系数 0.45（广州年日照约 1600 小时）
    let yearPV = 0;
    for (const d of [80, 172, 266, 355]) for (let h = 0; h < 24; h += 0.25) yearPV += pvPower(h, d, 'sunny') * 0.25 * 91.25 * 0.45;
    const normalUse = 7600, greenUse = 4700;
    const selfUse = Math.min(greenUse * 0.62, yearPV); // 白天自发自用 + 电池夜间放电覆盖的部分
    const greenBuy = greenUse - selfUse;
    const greenSell = Math.max(0, yearPV - selfUse);
    const r = (x) => Math.round(x);
    this.compare = { yearPV, normalUse, greenUse, greenBuy, greenSell };
    this.cmpChart.getChart().setOption({
      ...chartBase,
      title: { text: '全年对比（估算）', textStyle: { fontSize: 12 }, left: 0, top: 0 },
      legend: { ...chartBase.legend, top: 18, left: 0 },
      grid: { left: 46, right: 12, top: 46, bottom: 24 },
      tooltip: { trigger: 'axis' },
      xAxis: { type: 'category', data: ['用电量 kWh', '电网购电 kWh', '碳排放 kg', '净电费 元'] },
      yAxis: { type: 'value' },
      series: [
        { name: '普通方案', type: 'bar', data: [normalUse, normalUse, r(normalUse * CO2_FACTOR), r(normalUse * PRICE)], itemStyle: { color: '#9aa5b1' } },
        { name: '绿色方案', type: 'bar', data: [greenUse, r(greenBuy), r(greenBuy * CO2_FACTOR), r(greenBuy * PRICE - greenSell * 0.45)], itemStyle: { color: '#2e9d57' } },
      ],
    }, true);
    this.cmpText.innerHTML =
      `光伏年发电约 <b>${r(yearPV)}</b> kWh；绿色方案年用电 ${greenUse} kWh（比普通方案少 ${r((1 - greenUse / normalUse) * 100)}%），` +
      `从电网购电约 ${r(greenBuy)} kWh，余电上网约 ${r(greenSell)} kWh。<br>` +
      `年减少碳排放约 <b>${r((normalUse - greenBuy) * CO2_FACTOR)}</b> kg（排放因子 ${CO2_FACTOR} kg/kWh），净电费由 ${r(normalUse * PRICE)} 元变为 ${r(greenBuy * PRICE - greenSell * 0.45)} 元（上网电价按 0.45 元/kWh 计，负数表示卖电收入大于购电支出）。<br>` +
      `<span style="color:#8a96a6">说明：普通方案与绿色方案的年用电量为典型三口之家估算值。</span>`;
  }

  buildPanel(root) {
    const app = this.app;
    const s1 = section('屋顶光伏与能量流动', '光伏板朝南倾斜 20°，发电功率由太阳高度角、入射角和天气实时计算。发光管线表示能量流向：黄色 = 光伏发电，绿色 = 储能充放电，橙色 = 家庭用电，蓝色 = 与电网交换；流动越快表示功率越大。');
    s1.append(toggle('显示能量流动', () => this.flowsOn, (v) => this.setFlowsVisible(v)));
    this.stats = stats([
      { k: '光伏发电', v: () => this.state.pv.toFixed(2), unit: 'kW' },
      { k: '家庭用电', v: () => this.state.load.toFixed(2), unit: 'kW' },
      { k: '储能电量', v: () => this.state.soc.toFixed(0), unit: '%' },
      { k: '储能', v: () => (this.state.battery > 0.02 ? '充电 ' : this.state.battery < -0.02 ? '放电 ' : '待机 ') + Math.abs(this.state.battery).toFixed(2), unit: 'kW' },
      { k: '电网', v: () => (this.state.grid > 0.02 ? '上网 ' : this.state.grid < -0.02 ? '购电 ' : '— ') + Math.abs(this.state.grid).toFixed(2), unit: 'kW' },
      { k: '今日累计发电', v: () => this.todayPV().toFixed(1), unit: 'kWh' },
    ]);
    s1.append(this.stats);
    s1.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('晴天正午', () => { app.clock.weather = 'sunny'; app.setTime(12); app.syncTime(); }),
      button('多云下午', () => { app.clock.weather = 'cloudy'; app.setTime(15); app.syncTime(); }),
      button('雨天', () => { app.clock.weather = 'rainy'; app.setTime(11); app.syncTime(); }),
      button('夜晚（电池放电）', () => { app.clock.weather = 'sunny'; app.setTime(21); app.syncTime(); }),
      button('播放一天', () => { app.clock.playing = true; app.setTime(5); }, 'primary'),
    ));
    s1.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('查看屋顶光伏', () => { app.setRoof(true); app.rig.flyTo([14, 11, 12], [0, 3.5, -0.5]); }),
      button('查看逆变器与储能', () => { app.rig.flyTo([13.5, 2.6, 4.5], [8.3, 1.2, 1.5]); }),
      button('光伏板', () => app.selection.selectDevice('pv', false)),
    ));
    this.dayChart = chart(200);
    s1.append(this.dayChart);
    root.append(s1);

    const s2 = section('节能控制', '开启节能模式后：空调设定温度自动提高 1℃并以节能档运行，无人房间自动关灯。');
    s2.append(toggle('节能模式', () => this.ecoMode, (v) => {
      this.ecoMode = v;
      for (const d of app.devices.list) if (d.type === 'ac' && d.on) d.set(true, d.setpoint + (v ? 1 : -1));
      toast(v ? '节能模式已开启' : '节能模式已关闭');
    }));
    s2.append(hint('空气源热泵热水机（COP≈4）比电热水器节电约 75%；外墙保温、Low-E 玻璃减少空调负荷；全屋 LED 照明与人体感应控制。点击场景中的设备可查看工作原理。'));
    s2.append(el('div', { class: 'btns', style: 'margin-top:6px' }, button('空气源热泵', () => app.selection.selectDevice('heatpump')), button('储能电池', () => app.selection.selectDevice('battery')), button('智能配电箱', () => app.selection.selectDevice('distribution'))));
    root.append(s2);

    const s3 = section('普通方案 vs 绿色方案');
    this.cmpChart = chart(210);
    s3.append(this.cmpChart);
    this.cmpText = hint('');
    s3.append(this.cmpText);
    root.append(s3);

    app.onTimeChanged.push(() => { if (app.activeTab === 'green') { const n = performance.now(); if (n - (this.lastDraw ?? 0) > 500) { this.lastDraw = n; this.drawDayChart(); } } });
  }

  enter() {
    this.setFlowsVisible(true);
    this.app.setRoof(true);
    this.app.rig.flyTo([17, 12, 15], [1, 2, 0]);
    this.drawDayChart();
    this.drawCompare();
  }

  leave() { this.setFlowsVisible(false); }

  update(dt) {
    for (const f of Object.values(this.flows)) f.update(dt);
    // 热泵风扇转动
    const hp = this.app.devices.byId.heatpump;
    const h = this.app.clock.hour;
    if (h > 17 && h < 19.5) hp.fan.rotation.z += dt * 12;
  }

  slowUpdate(dt, active) {
    // 模拟时间前进了多少小时（播放时按倍速，暂停时按真实时间）
    let dh = this.app.clock.hour - this.lastHour;
    if (dh < 0) dh += 24;
    if (dh > 2) dh = 0; // 手动拖动时间条时不累计
    this.lastHour = this.app.clock.hour;
    this.step(Math.max(dh, dt / 3600));
    this.refreshScene();
    if (active) this.stats.refresh();
  }
}
