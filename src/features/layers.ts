// 分层查看：楼层显示、剖切高度、图层开关、环境参数热力图（每层一张）、活动热力图、地下蓄水池剖切。
import * as THREE from 'three';
import { INDOOR_ROOMS, roomCenter, roomAt, floorOfY, FLOORS } from '../scene/layout.js';
import { sectionPlane } from '../scene/common.js';
import { METRICS } from '../systems/envModel.js';
import { colorMap } from '../systems/heatmap.js';
import { section, toggle, slider, buttonGroup, button, el } from '../ui/ui.js';

// “三口之家 + 老人”一天的典型作息：[成员, 楼层, 地点(x,z), 小时, 是否睡眠]
// 睡眠时基本不走动，按较低权重计入活动热力
const FAMILY_DAY: [string, number, [number, number], number, boolean?][] = [
  ['爸爸', 1, [-5.4, -3.2], 8, true], ['爸爸', 0, [1.1, 1.9], 1.5], ['爸爸', 0, [-6.5, 2.4], 2.5], ['爸爸', 1, [-6.0, 3.6], 2], ['爸爸', 1, [-1.6, -2.2], 0.8],
  ['妈妈', 1, [-5.4, -3.2], 8, true], ['妈妈', 0, [6.4, 3.8], 2.2], ['妈妈', 0, [5.4, 2.4], 1.0], ['妈妈', 0, [1.1, 3.6], 1.5], ['妈妈', 0, [-6.5, 2.4], 2.0], ['妈妈', 0, [5.2, -3.6], 0.8], ['妈妈', 1, [-0.6, 2.4], 1.5],
  ['孩子', 1, [4.0, -3.9], 9, true], ['孩子', 1, [6.0, -3.6], 3], ['孩子', 0, [1.5, 2.2], 1.5], ['孩子', 1, [-0.8, 2.2], 2.0], ['孩子', 1, [-0.4, 5.8], 0.8],
  ['老人', 0, [-5.5, -3.5], 10, true], ['老人', 0, [-6.8, -1.9], 2.5], ['老人', 0, [-6.5, 3.2], 3], ['老人', 0, [0.8, 3.6], 1.5], ['老人', 0, [-1.9, -2.2], 1.0],
];

export class LayersFeature {
  // Fields are declared here and initialized by the existing runtime flow.
  declare app: any;
  declare cut: any;
  declare cutSlider: any;
  declare groupBtns: any;
  declare legend: any;
  declare metric: any;
  declare suggest: any;
  declare valueLabels: any;

  constructor(app) {
    this.app = app;
    this.metric = 'none';
    this.cut = null; // 手动剖切高度（null 表示按楼层显示）
    this.valueLabels = INDOOR_ROOMS.map((r) => {
      const c = roomCenter(r);
      const l = app.makeLabel('', 'room', c.x, c.y + 0.4, c.z);
      l.visible = false;
      l.userData.room = r;
      return l;
    });
    this.legend = document.getElementById('legend');
    this.buildFamilyActivity();
  }

  get heatmaps() { return this.app.heatmaps; }

  // 典型作息 → 活动密度：停留地点按时长累加；相邻地点之间沿 A* 路线（含楼梯）累加"走动"
  buildFamilyActivity() {
    for (const h of this.heatmaps) h.clearDensity();
    const nav = this.app.nav;
    const prev: Record<string, [number, number, number]> = {};
    for (const [who, floor, [x, z], hours, sleep] of FAMILY_DAY) {
      this.heatmaps[floor].addActivity(x, z, hours * (sleep ? 0.5 : 3), sleep ? 0.45 : 0.7);
      const p = prev[who];
      if (p) {
        const path = nav.findPath({ x: p[1], z: p[2], floor: p[0] }, { x, z, floor });
        if (path) for (let i = 0; i < path.length - 1; i++) {
          const a = path[i], b = path[i + 1];
          const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.3));
          for (let k = 0; k <= n; k++) {
            const y = a.y + (b.y - a.y) * k / n;
            this.heatmaps[floorOfY(y)].addActivity(a.x + (b.x - a.x) * k / n, a.z + (b.z - a.z) * k / n, 0.5, 0.35);
          }
        }
      }
      prev[who] = [floor, x, z];
    }
  }

  setCut(h) {
    this.cut = h >= 8.9 ? null : h;
    this.applySection();
  }

  /** 剖切平面高度：手动剖切优先，否则按当前显示的楼层 */
  applySection() {
    sectionPlane.constant = this.cut ?? this.app.CUT[this.app.view];
    this.cutSlider?.refresh();
  }

  /** 选择热力图：none | temp | rh | pm | co2 | noise | activity；floor 指定显示哪一层 */
  setHeatmap(metric, floor?: number) {
    this.metric = metric;
    for (const h of this.heatmaps) h.mesh.visible = metric !== 'none';
    for (const l of this.valueLabels) l.visible = metric !== 'none' && metric !== 'activity';
    if (metric !== 'none') {
      this.cut = null;
      const f = floor ?? (this.app.view === 1 ? 1 : 0);
      this.app.viewFloor(f);
      this.app.rig.flyTo(f ? [0, 27, 10] : [0, 24, 10], [0, FLOORS[f].y, 0.5]);
    }
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

  // 局部差异源：空调出风口、开着的窗户、灶台、人……（每个源带楼层）
  sources(metric) {
    const app = this.app, env = app.envModel, out = [];
    const add = (x, z, floor, r, value) => { const rm = roomAt(x, z, floor); if (rm && !rm.outdoor) out.push({ x, z, r, value, room: rm.id, floor }); };
    const registry = app.devices.registry;
    for (const d of registry.byType('ac')) {
      const climate = registry.getClimate(d.id);
      if (climate?.isOn() && metric === 'temp') {
        const outlet = climate.getOutlet?.();
        const p = outlet?.position, n = outlet?.direction;
        if (p && n) add(p.x + n.x * 1.2, p.z + n.z * 1.2, d.floor ?? 0, 2.4, climate.getSetpoint() - 1);
      }
    }
    for (const w of (Object.values(app.house.windows) as any[])) {
      if (!w.isOpen) continue;
      const p = w.group.position, n = new THREE.Vector3(0, 0, 1).applyQuaternion(w.group.quaternion);
      const v = { temp: env.outdoor.temp, rh: env.outdoor.rh, pm: env.outdoor.pm, co2: 430, noise: env.outdoor.noise - 5 }[metric];
      for (const s of [1, -1]) add(p.x + n.x * s * 0.7, p.z + n.z * s * 0.7, w.floor, 2.0, v);
    }
    const fire = app.features.safety?.fireActive;
    if (fire || app.people.list.some((p) => p.activity.includes('做饭'))) {
      const v = { temp: fire ? 60 : env.rooms.kitchen.temp + 4, rh: env.rooms.kitchen.rh + 10, pm: fire ? 500 : env.rooms.kitchen.pm + 60, co2: 1400, noise: 55 }[metric];
      add(7.3, 1.6, 0, fire ? 3.5 : 1.6, v);
    }
    if (metric === 'co2' || metric === 'noise') for (const p of app.people.list) if (p.room && p.object.visible && env.rooms[p.room]) add(p.x, p.z, p.floor, 1.4, metric === 'co2' ? env.rooms[p.room].co2 + 350 : env.rooms[p.room].noise + 8);
    const ventilation = registry.getVentilation('fresh-air');
    if (metric === 'pm' && ventilation?.isOn()) for (const v of ventilation.getOutlets?.() ?? []) add(v.x, v.z, v.floor, 1.3, 3);
    if (metric === 'temp' && app.sun.elevation > 5 && app.clock.weather !== 'rainy' && !app.features.comfort?.shadingOn) {
      for (const [x, room, f] of [[-4.6, 'living', 0], [1.3, 'dining', 0], [5.6, 'kitchen', 0], [-6.0, 'study', 1], [-0.6, 'family', 1], [5.6, 'guest', 1]]) add(x, 4.2, f, 1.6, env.rooms[room].temp + 2.5 * app.sunFactor);
    }
    return out;
  }

  redraw() {
    const m = this.metric, app = this.app;
    if (m === 'none') return;
    if (m === 'activity') { for (const h of this.heatmaps) h.drawDensity(); return; }
    const metric = METRICS[m];
    const values = {};
    for (const r of INDOOR_ROOMS) values[r.id] = app.envModel.rooms[r.id][m];
    const src = this.sources(m);
    this.heatmaps.forEach((h, f) => h.drawField(metric, values, src.filter((s) => s.floor === f)));
    for (const l of this.valueLabels) {
      const r = l.userData.room, v = values[r.id];
      const ok = v >= metric.good[0] && v <= metric.good[1];
      l.element.innerHTML = `${r.name} <b style="color:${ok ? '#2e9d57' : '#d64541'}">${v.toFixed(metric.digits)}</b>${metric.unit}`;
    }
  }

  buildPanel(root) {
    const app = this.app;
    const s1 = section('楼层与剖切', '选择只看一层或二层，或拖动剖切高度从上往下"切开"房屋，查看各层空间关系与内部布置。剖切使用裁剪平面实现：高于该高度的构件不绘制。');
    s1.append(el('div', { class: 'btns' },
      button('整栋', () => { this.cut = null; app.viewFloor('all'); app.rig.flyTo([24, 16, 28], [0, 3, 0]); }),
      button('一层平面', () => { this.cut = null; app.viewFloor(0); app.rig.flyTo([0, 24, 10], [0, 0, 0.5]); }, 'primary'),
      button('二层平面', () => { this.cut = null; app.viewFloor(1); app.rig.flyTo([0, 27, 10], [0, 3.2, 0.5]); }, 'primary'),
      button('剖面透视', () => { this.setCut(4.6); app.rig.flyTo([16, 14, 16], [0, 2, 0]); }),
    ));
    this.cutSlider = slider('剖切高度', 0.6, 9.0, 0.05, () => Math.min(9, this.cut ?? sectionPlane.constant), (v) => this.setCut(v), (v) => (v >= 8.9 ? '不剖切' : v.toFixed(2) + ' m'));
    s1.append(this.cutSlider);
    const layer = (label, obj) => toggle(label, () => obj.visible, (v) => { obj.visible = v; });
    s1.append(layer('墙体', app.house.walls));
    s1.append(toggle('门窗', () => app.scene.getObjectByName('openings').visible, (v) => { app.scene.getObjectByName('openings').visible = v; }));
    s1.append(layer('家具', app.furniture.root));
    s1.append(layer('智能设备与设施', app.devices.root));
    s1.append(layer('室外环境', app.env.group));
    s1.append(toggle('地下雨水蓄水池剖切', () => app.env.rainTank.group.visible, (v) => { app.env.showTankSection(v); if (v) app.rig.flyTo([16, 4, 15], [11, -1, 7]); }));
    root.append(s1);

    const s2 = section('环境参数分布', '各房间温度、湿度、PM2.5 等来自室内环境模拟（与门窗、空调、新风、日照、人员联动），按“红→黄→蓝”由高到低着色。先选参数，再用上面的按钮切换一层 / 二层。');
    this.groupBtns = buttonGroup([
      { label: '关闭', value: 'none' }, { label: '温度', value: 'temp' }, { label: '湿度', value: 'rh' },
      { label: 'PM2.5', value: 'pm' }, { label: 'CO₂', value: 'co2' }, { label: '噪声', value: 'noise' }, { label: '活动热力', value: 'activity' },
    ], () => this.metric, (v) => this.setHeatmap(v));
    s2.append(this.groupBtns);
    root.append(s2);

    const s3 = section('活动热力图（三口之家 + 老人）', '按一家四口一天的典型作息（停留地点与时长、房间和楼层之间的走动路线）累积生成，并实时叠加三位居民的走动轨迹。');
    this.suggest = el('div', { class: 'hint' });
    s3.append(this.suggest);
    s3.append(el('div', { class: 'btns', style: 'margin-top:6px' },
      button('一层活动热力', () => this.setHeatmap('activity', 0), 'primary'),
      button('二层活动热力', () => this.setHeatmap('activity', 1), 'primary'),
      button('重新生成', () => { this.buildFamilyActivity(); this.redraw(); this.updateSuggest(); }),
    ));
    root.append(s3);
    this.updateSuggest();
  }

  // 两层合计的活动占比 → 布局建议
  updateSuggest() {
    const sums: Record<string, number> = {};
    let total = 0;
    for (const h of this.heatmaps) for (const [k, v] of Object.entries(h.roomShares(true)) as [string, number][]) { sums[k] = v; total += v; }
    const sorted = INDOOR_ROOMS.map((r) => ({ r, s: (sums[r.id] ?? 0) / (total || 1) })).sort((a, b) => b.s - a.s);
    const pct = (x) => (x.s * 100).toFixed(0) + '%';
    const name = (r) => (r.floor ? '二层' : '一层') + r.name;
    this.suggest.innerHTML =
      `<b>高频活动区：</b>${sorted.slice(0, 4).map((x) => `${name(x.r)}（${pct(x)}）`).join('、')}<br>` +
      `建议：高频区增加收纳和插座，加强照明与通风；厨房—餐厅—客厅动线保持通畅。<br>` +
      `<b>低频活动区：</b>${sorted.slice(-3).map((x) => `${name(x.r)}（${pct(x)}）`).join('、')}<br>` +
      `建议：低频空间可兼作储藏、健身或多功能房。`;
  }

  enter() {}

  slowUpdate() {
    for (const p of this.app.people.list) if (p.room && p.object.visible) this.heatmaps[p.floor].addActivity(p.x, p.z, 0.02, 0.4);
    if (this.metric !== 'none') this.redraw();
  }
}
