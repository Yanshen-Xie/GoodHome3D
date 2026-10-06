// 分层查看：屋顶显隐、剖切高度、图层开关、环境参数热力图、活动热力图。
import * as THREE from 'three';
import { ROOMS, roomCenter, roomAt } from '../scene/layout.js';
import { sectionPlane } from '../scene/common.js';
import { METRICS } from '../systems/envModel.js';
import { colorMap } from '../systems/heatmap.js';
import { section, toggle, slider, buttonGroup, button, hint, el } from '../ui/ui.js';

// “三口之家 + 老人”一天的典型作息：[成员, 地点(x,z), 小时, 是否睡眠]
// 睡眠时基本不走动，按较低权重计入活动热力
const FAMILY_DAY = [
  ['爸爸', [-5.5, -3.2], 8, 'sleep'], ['爸爸', [2.0, 1.9], 1.5], ['爸爸', [-6.5, 2.4], 2.5], ['爸爸', [-1.4, -2.6], 0.8], ['爸爸', [-7.0, -0.1], 0.3],
  ['妈妈', [-5.5, -3.2], 8, 'sleep'], ['妈妈', [6.4, 3.8], 2.2], ['妈妈', [5.6, 2.9], 1.0], ['妈妈', [2.0, 3.6], 1.5], ['妈妈', [-6.5, 2.4], 2.0], ['妈妈', [-1.4, -2.6], 0.8], ['妈妈', [-1.5, 3.9], 1.0],
  ['孩子', [0.1, -3.9], 9, 'sleep'], ['孩子', [1.9, -3.9], 3], ['孩子', [2.4, 2.2], 1.5], ['孩子', [-5.8, 2.2], 2.0], ['孩子', [-1.4, -2.6], 0.6],
  ['老人', [6.8, -3.5], 10, 'sleep'], ['老人', [5.4, -2.5], 2.5], ['老人', [-6.5, 3.2], 3], ['老人', [1.6, 3.6], 1.5], ['老人', [-1.4, -2.6], 1.0], ['老人', [-4.4, 6.5], 1.5],
];

export class LayersFeature {
  constructor(app) {
    this.app = app;
    this.metric = 'none';
    this.cut = 3.4;
    this.valueLabels = ROOMS.map((r) => {
      const c = roomCenter(r);
      const l = app.makeLabel('', 'room', c.x, 0.4, c.z);
      l.visible = false;
      return l;
    });
    this.legend = document.getElementById('legend');
    this.buildFamilyActivity();
  }

  // 用典型作息生成活动密度：在每个活动地点按停留时长累加；相邻地点之间沿 A* 路径累加"走动"
  buildFamilyActivity() {
    const hm = this.app.heatmap;
    hm.clearDensity();
    const nav = this.app.nav;
    let prev = {};
    for (const [who, [x, z], hours, sleep] of FAMILY_DAY) {
      hm.addActivity(x, z, hours * (sleep ? 0.5 : 3), sleep ? 0.45 : 0.7);
      const p = prev[who];
      if (p) {
        const path = nav.findPath(p[0], p[1], x, z);
        if (path) for (let i = 0; i < path.length - 1; i++) {
          const a = path[i], b = path[i + 1];
          const n = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3);
          for (let k = 0; k <= n; k++) hm.addActivity(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n, 0.5, 0.35);
        }
      }
      prev[who] = [x, z];
    }
  }

  setCut(h) {
    this.cut = h;
    if (h < 3.3) this.app.setRoof(false);
    this.applySection();
  }

  /**
   * 剖切平面高度：拖动滑块时用滑块的值；没有剖切但隐藏了屋顶时切在 2.8m，
   * 把贴在天花板上的灯具、探测器等一起隐去，俯视时不会"漂浮"在房间上方。
   */
  applySection() {
    const roofOn = this.app.house.roof.visible;
    sectionPlane.constant = this.cut < 3.35 ? this.cut : roofOn ? 100 : 2.8;
  }

  /** 选择热力图：none | temp | rh | pm | co2 | noise | activity */
  setHeatmap(metric) {
    this.metric = metric;
    const hm = this.app.heatmap;
    hm.mesh.visible = metric !== 'none';
    for (const l of this.valueLabels) l.visible = metric !== 'none' && metric !== 'activity';
    if (metric !== 'none') this.app.setRoof(false);
    this.drawLegend();
    this.redraw();
    this.groupBtns?.refresh();
    this.app.features.comfort?.metricBtns?.refresh();
  }

  drawLegend() {
    const lg = this.legend;
    if (this.metric === 'none') { lg.classList.remove('show'); return; }
    const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => `rgb(${colorMap(t).join(',')}) ${t * 100}%`).join(',');
    let title, lo, hi, mid;
    if (this.metric === 'activity') { title = '活动热力（停留与走动频率）'; lo = '低频'; hi = '高频'; mid = ''; }
    else { const m = METRICS[this.metric]; title = `${m.name}（${m.unit}）  舒适范围 ${m.good[0]}~${m.good[1]}`; lo = m.min; hi = m.max; mid = (m.min + m.max) / 2; }
    lg.innerHTML = `<div>${title}</div><div class="bar" style="background:linear-gradient(90deg,${stops})"></div><div class="ticks"><span>${lo}</span><span>${mid}</span><span>${hi}</span></div>`;
    lg.classList.add('show');
  }

  // 局部差异源：空调出风口、开着的窗户、灶台、有人的位置……
  sources(metric) {
    const app = this.app, env = app.envModel, out = [];
    const room = (x, z) => roomAt(x, z)?.id;
    for (const d of app.devices.list) {
      if (d.type === 'ac' && d.on && metric === 'temp') {
        const p = d.object.position;
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(d.object.quaternion);
        const x = p.x + n.x * 1.2, z = p.z + n.z * 1.2;
        out.push({ x, z, r: 2.4, value: d.setpoint - 1, room: room(x, z) });
      }
    }
    for (const w of Object.values(app.house.windows)) {
      if (!w.isOpen) continue;
      const p = w.group.position;
      const n = new THREE.Vector3(0, 0, 1).applyQuaternion(w.group.quaternion);
      for (const s of [1, -1]) {
        const x = p.x + n.x * s * 0.7, z = p.z + n.z * s * 0.7, r = room(x, z);
        if (!r) continue;
        const v = { temp: env.outdoor.temp, rh: env.outdoor.rh, pm: env.outdoor.pm, co2: 430, noise: env.outdoor.noise - 5 }[metric];
        out.push({ x, z, r: 2.0, value: v, room: r });
      }
    }
    if (app.people.list.some((p) => p.activity.includes('做饭')) || app.features.safety?.fireActive) {
      const fire = app.features.safety?.fireActive;
      const v = { temp: fire ? 60 : env.rooms.kitchen.temp + 4, rh: env.rooms.kitchen.rh + 10, pm: fire ? 500 : env.rooms.kitchen.pm + 60, co2: 1400, noise: 55 }[metric];
      out.push({ x: 7.3, z: 1.6, r: fire ? 3.5 : 1.6, value: v, room: 'kitchen' });
    }
    if (metric === 'co2' || metric === 'noise') {
      for (const p of app.people.list) if (p.room) out.push({ x: p.x, z: p.z, r: 1.4, value: metric === 'co2' ? env.rooms[p.room].co2 + 350 : env.rooms[p.room].noise + 8, room: p.room });
    }
    if (metric === 'pm' && app.devices.byId['fresh-air'].on) {
      for (const v of app.devices.byId['fresh-air'].vents) out.push({ x: v.x, z: v.z, r: 1.3, value: 3, room: v.room });
    }
    if (metric === 'temp' && app.sun.elevation > 5 && app.clock.weather !== 'rainy' && !app.features.comfort?.shadingOn) {
      // 阳光透过南窗照到的地面温度略高
      for (const [x, room] of [[-4.4, 'living'], [2.0, 'dining'], [6.2, 'kitchen']]) out.push({ x, z: 4.2, r: 1.6, value: env.rooms[room].temp + 2.5 * app.sunFactor, room });
    }
    return out;
  }

  redraw() {
    const m = this.metric, app = this.app;
    if (m === 'none') return;
    if (m === 'activity') { app.heatmap.drawDensity(); return; }
    const metric = METRICS[m];
    const values = {};
    for (const r of ROOMS) values[r.id] = app.envModel.rooms[r.id][m];
    app.heatmap.drawField(metric, values, this.sources(m));
    ROOMS.forEach((r, i) => {
      const v = values[r.id];
      const ok = v >= metric.good[0] && v <= metric.good[1];
      this.valueLabels[i].element.innerHTML = `${r.name} <b style="color:${ok ? '#2e9d57' : '#d64541'}">${v.toFixed(metric.digits)}</b>${metric.unit}`;
    });
  }

  buildPanel(root) {
    const app = this.app;
    const s1 = section('剖面与图层', '隐藏屋顶或降低剖切高度，可以直观看到各房间的空间关系与内部布置。剖切使用裁剪平面实现：高于该高度的墙体、门窗不绘制。');
    s1.append(toggle('显示屋顶（含光伏）', () => app.house.roof.visible, (v) => app.setRoof(v)));
    this.cutSlider = slider('剖切高度', 0.6, 3.4, 0.05, () => this.cut, (v) => this.setCut(v), (v) => (v >= 3.4 ? '不剖切' : v.toFixed(2) + ' m'));
    s1.append(this.cutSlider);
    const layer = (label, obj) => toggle(label, () => obj.visible, (v) => { obj.visible = v; });
    s1.append(layer('墙体与门窗', app.house.walls));
    s1.append(toggle('门窗', () => app.scene.getObjectByName('openings').visible, (v) => { app.scene.getObjectByName('openings').visible = v; }));
    s1.append(layer('家具', app.furniture.root));
    s1.append(layer('智能设备与设施', app.devices.root));
    s1.append(layer('室外环境', app.env.group));
    s1.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('剖面俯视', () => { this.setCut(1.2); this.cutSlider.refresh(); app.rig.flyTo([0, 24, 10], [0, 0, 0.5]); }, 'primary'),
      button('恢复', () => { this.setCut(3.4); this.cutSlider.refresh(); app.setRoof(true); }),
    ));
    root.append(s1);

    const s2 = section('环境参数分布', '各房间温度、湿度、PM2.5 等数据来自室内环境模拟（与门窗、空调、新风、日照、人员活动联动），按“红→黄→蓝”由高到低着色，数值实时刷新。');
    this.groupBtns = buttonGroup([
      { label: '关闭', value: 'none' }, { label: '温度', value: 'temp' }, { label: '湿度', value: 'rh' },
      { label: 'PM2.5', value: 'pm' }, { label: 'CO₂', value: 'co2' }, { label: '噪声', value: 'noise' }, { label: '活动热力', value: 'activity' },
    ], () => this.metric, (v) => { this.setHeatmap(v); if (v !== 'none') app.rig.flyTo([0, 24, 10], [0, 0, 0.5]); });
    s2.append(this.groupBtns);
    root.append(s2);

    const s3 = section('活动热力图（三口之家 + 老人）', '按一家人一天的典型作息（停留地点与时长、房间之间的走动路线）累积生成，同时实时叠加两位居民的走动轨迹。');
    this.suggest = el('div', { class: 'hint' });
    s3.append(this.suggest);
    s3.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('显示活动热力', () => { this.setHeatmap('activity'); app.rig.flyTo([0, 24, 10], [0, 0, 0.5]); }, 'primary'),
      button('重新生成', () => { this.buildFamilyActivity(); this.redraw(); this.updateSuggest(); }),
    ));
    root.append(s3);
    this.updateSuggest();
  }

  // 根据活动占比给出布局优化建议
  updateSuggest() {
    const shares = this.app.heatmap.roomShares();
    const sorted = ROOMS.map((r) => ({ r, s: shares[r.id] })).sort((a, b) => b.s - a.s);
    const hi = sorted.slice(0, 3), lo = sorted.slice(-2);
    const pct = (x) => (x.s * 100).toFixed(0) + '%';
    this.suggest.innerHTML =
      `<b>高频活动区：</b>${hi.map((x) => `${x.r.name}（${pct(x)}）`).join('、')}<br>` +
      `建议：高频区增加收纳柜和插座，加强照明与通风；客厅与厨房之间保持通道宽敞。<br>` +
      `<b>低频活动区：</b>${lo.map((x) => `${x.r.name}（${pct(x)}）`).join('、')}<br>` +
      `建议：低频空间可兼作储藏或多功能房。`;
  }

  enter() {}

  slowUpdate(dt) {
    // 两位居民的实时位置也计入活动热力
    for (const p of this.app.people.list) if (p.room) this.app.heatmap.addActivity(p.x, p.z, 0.02, 0.4);
    if (this.metric !== 'none') this.redraw();
  }
}
