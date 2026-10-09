// 数据大屏：覆盖在三维场景左右两侧的深色图表面板，中间保留三维画面。
// 图表用 ECharts：雷达图（四大特征指数）、仪表盘（实时能源）、饼图（用电分项）、柱状图（各房间温度）、
// 折线图（能源趋势）、环形图（设备状态），以及告警事件列表。数据每 0.5 秒刷新。
import * as echarts from 'echarts';
import { INDOOR_ROOMS } from '../scene/layout.js';
import { el } from './ui.js';

const FONT = 'PingFang SC, Microsoft YaHei, sans-serif';
const txt = { color: '#cfe0f5', fontFamily: FONT, fontSize: 11 };

export class Dashboard {
  // Fields are declared here and initialized by the existing runtime flow.
  declare alarmBox: any;
  declare app: any;
  declare charts: any;
  declare els: any;
  declare kpi: any;
  declare root: any;
  declare trend: any;
  declare visible: any;

  constructor(app) {
    this.app = app;
    this.visible = false;
    this.root = el('div', { id: 'dash' });
    const mk = (title, h) => {
      const body = el('div', { class: 'dash-chart', style: `height:${h}px` });
      return { card: el('div', { class: 'dash-card' }, el('div', { class: 'dash-title' }, title), body), body };
    };
    this.kpi = el('div', { class: 'dash-kpi' });
    const radar = mk('“好房子”四大特征指数', 210), gauge = mk('实时能源', 150), pie = mk('今日用电分项', 190);
    const temp = mk('各房间温度（℃）', 250), trend = mk('能源趋势（kW）', 160), devs = mk('设备状态', 140);
    this.alarmBox = el('div', { class: 'dash-alarms' });
    const alarms = el('div', { class: 'dash-card' }, el('div', { class: 'dash-title' }, '告警与事件'), this.alarmBox);
    this.root.append(
      el('div', { class: 'dash-col left' }, radar.card, gauge.card, pie.card),
      el('div', { class: 'dash-col right' }, temp.card, trend.card, devs.card, alarms),
      this.kpi,
    );
    document.body.append(this.root);
    this.els = { radar: radar.body, gauge: gauge.body, pie: pie.body, temp: temp.body, trend: trend.body, devs: devs.body };
    this.charts = null;
    this.trend = { t: [], pv: [], load: [] };
  }

  toggle() {
    this.visible = !this.visible;
    this.root.classList.toggle('show', this.visible);
    document.body.classList.toggle('dash-on', this.visible);
    if (this.visible) {
      if (!this.charts) this.charts = Object.fromEntries(Object.entries(this.els as Record<string, HTMLElement>).map(([k, d]) => [k, echarts.init(d, null, { renderer: 'canvas' })]));
      this.resize();
      this.slowUpdate(true);
      this.app.rig.flyTo([24, 16, 28], [0, 3, 0]);
      this.app.viewFloor('all');
    }
  }

  resize() { if (this.charts) Object.values(this.charts as Record<string, { resize(): void }>).forEach((c) => c.resize()); }

  // 四大特征指数（0~100）：由当前实时状态计算
  scores() {
    const app = this.app, env = app.envModel, registry = app.devices.registry;
    const rooms = INDOOR_ROOMS;
    const inRange = (k, lo, hi) => rooms.filter((r) => env.rooms[r.id][k] >= lo && env.rooms[r.id][k] <= hi).length / rooms.length;
    const devices = registry.all();
    const faults = devices.filter((d) => registry.getStatus(d.id) === 'fault').length, warns = devices.filter((d) => registry.getStatus(d.id) === 'warning').length;
    const safety = Math.max(0, 100 - faults * 15 - warns * 6 - (app.features.safety.fireActive ? 40 : 0) - (app.features.safety.sos ? 15 : 0));
    const comfort = Math.round(55 * inRange('temp', 20, 27) + 45 * inRange('rh', 40, 70));
    const health = Math.round(50 * inRange('pm', 0, 35) + 50 * inRange('co2', 0, 1000));
    const g = app.features.green.state;
    const green = Math.round(Math.min(100, 50 + 50 * Math.min(1, (g.pv + Math.max(0, -g.battery)) / Math.max(0.1, g.load))));
    const smart = Math.round(100 * devices.filter((d) => registry.getStatus(d.id) !== 'fault').length / devices.length);
    const aging = 92 - (app.features.safety.sos ? 20 : 0) - (app.features.safety.fallActive ? 20 : 0);
    return { 安全: safety, 舒适: comfort, 健康: health, 绿色: green, 智慧: smart, 适老: aging };
  }

  slowUpdate(force = false) {
    const app = this.app;
    const g = app.features.green;
    // 趋势数据一直记录，打开大屏时就有历史曲线
    this.trend.t.push(app.clock.hour.toFixed(2)); this.trend.pv.push(+g.state.pv.toFixed(2)); this.trend.load.push(+g.state.load.toFixed(2));
    if (this.trend.t.length > 120) for (const k in this.trend) this.trend[k].shift();
    if (!this.visible && !force) return;
    const c = this.charts;
    const sc = this.scores();
    c.radar.setOption({
      textStyle: txt,
      radar: { indicator: Object.keys(sc).map((k) => ({ name: k, max: 100 })), radius: '64%', axisName: { color: '#9fc3ff' }, splitLine: { lineStyle: { color: 'rgba(160,190,230,0.25)' } }, splitArea: { areaStyle: { color: ['rgba(40,80,140,0.15)', 'rgba(40,80,140,0.05)'] } }, axisLine: { lineStyle: { color: 'rgba(160,190,230,0.3)' } } },
      series: [{ type: 'radar', data: [{ value: Object.values(sc), name: '当前', areaStyle: { color: 'rgba(63,169,245,0.35)' }, lineStyle: { color: '#3fa9f5' }, itemStyle: { color: '#3fa9f5' }, label: { show: true, color: '#fff', fontSize: 10 } }] }],
      animation: false,
    });
    const gauge = (name, value, max, center, color, unit) => ({
      type: 'gauge', center, radius: '72%', min: 0, max, startAngle: 210, endAngle: -30, splitNumber: 4,
      axisLine: { lineStyle: { width: 8, color: [[value / max, color], [1, 'rgba(255,255,255,0.12)']] } },
      axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
      title: { offsetCenter: [0, '62%'], color: '#9fc3ff', fontSize: 11 },
      detail: { offsetCenter: [0, '5%'], color: '#fff', fontSize: 16, formatter: `{value}${unit}` },
      data: [{ value: +value.toFixed(value < 10 ? 2 : 0), name }],
    });
    c.gauge.setOption({ textStyle: txt, series: [gauge('光伏发电', g.state.pv, 10, ['17%', '55%'], '#f0b429', 'kW'), gauge('家庭用电', g.state.load, 6, ['50%', '55%'], '#ff8a3d', 'kW'), gauge('储能电量', g.state.soc, 100, ['83%', '55%'], '#36d399', '%')], animation: false });
    const bd = g.loadBreakdown();
    c.pie.setOption({
      textStyle: txt, tooltip: { trigger: 'item', formatter: '{b}：{c} kW（{d}%）' },
      legend: { orient: 'vertical', right: 0, top: 'middle', textStyle: txt, itemWidth: 10, itemHeight: 8 },
      series: [{ type: 'pie', radius: ['38%', '68%'], center: ['35%', '52%'], label: { show: false }, data: Object.entries(bd as Record<string, number>).map(([name, value]) => ({ name, value: +value.toFixed(2) })),
        color: ['#3fa9f5', '#f0b429', '#ff8a3d', '#e05d5d', '#36d399', '#9b8cff', '#8a96a6'] }],
      animation: false,
    });
    const env = app.envModel;
    const rooms = INDOOR_ROOMS;
    c.temp.setOption({
      textStyle: txt, grid: { left: 70, right: 16, top: 8, bottom: 20 },
      xAxis: { type: 'value', min: 16, max: 36, axisLabel: txt, splitLine: { lineStyle: { color: 'rgba(160,190,230,0.12)' } } },
      yAxis: { type: 'category', data: rooms.map((r) => (r.floor ? '二·' : '一·') + r.name.replace('无障碍', '')), axisLabel: { ...txt, fontSize: 10 } },
      series: [{ type: 'bar', barWidth: 8, data: rooms.map((r) => { const v = +env.rooms[r.id].temp.toFixed(1); return { value: v, itemStyle: { color: v > 27 ? '#e05d5d' : v < 20 ? '#3fa9f5' : '#36d399' } }; }),
        markArea: { silent: true, itemStyle: { color: 'rgba(54,211,153,0.08)' }, data: [[{ xAxis: 20 }, { xAxis: 26 }]] } }],
      animation: false,
    });
    c.trend.setOption({
      textStyle: txt, grid: { left: 34, right: 10, top: 24, bottom: 18 }, legend: { top: 0, textStyle: txt, itemWidth: 12, itemHeight: 6 },
      xAxis: { type: 'category', data: this.trend.t, show: false }, yAxis: { type: 'value', axisLabel: txt, splitLine: { lineStyle: { color: 'rgba(160,190,230,0.12)' } } },
      series: [
        { name: '光伏发电', type: 'line', data: this.trend.pv, showSymbol: false, smooth: true, lineStyle: { color: '#f0b429' }, itemStyle: { color: '#f0b429' }, areaStyle: { color: 'rgba(240,180,41,0.2)' } },
        { name: '家庭用电', type: 'line', data: this.trend.load, showSymbol: false, smooth: true, lineStyle: { color: '#ff8a3d' }, itemStyle: { color: '#ff8a3d' } },
      ],
      animation: false,
    });
    const cnt = { 正常: 0, 预警: 0, 故障: 0 };
    const deviceRegistry = app.devices.registry;
    const devices = deviceRegistry.all().filter((d) => d.module);
    for (const d of devices) {
      const status = deviceRegistry.getStatus(d.id);
      cnt[status === 'fault' ? '故障' : status === 'warning' ? '预警' : '正常']++;
    }
    c.devs.setOption({
      textStyle: txt, legend: { orient: 'vertical', right: 10, top: 'middle', textStyle: txt },
      series: [{ type: 'pie', radius: ['45%', '72%'], center: ['35%', '50%'], label: { show: true, position: 'center', formatter: () => `${devices.length}\n台设备`, color: '#fff', fontSize: 13 },
        data: Object.entries(cnt).map(([name, value]) => ({ name, value })), color: ['#36d399', '#f0b429', '#e05d5d'] }],
      animation: false,
    });
    const html = app.events.slice(0, 14).map((e) => `<div class="${e.level}"><span>${e.time}</span>${e.text}</div>`).join('') || '<div>暂无事件</div>';
    if (this.alarmBox.innerHTML !== html) this.alarmBox.innerHTML = html;
    const kpi = [
      ['室外温度', app.envModel.outdoor.temp.toFixed(1), '℃'], ['今日光伏发电', g.todayPV().toFixed(1), 'kWh'], ['今日减碳', (g.todayPV() * 0.5703).toFixed(1), 'kg'],
      ['雨水蓄水', (app.env.rainTank.level * 8).toFixed(1), 'm³'], ['在线设备', devices.length, '台'], ['待处理告警', devices.filter((d) => ['fault', 'warning'].includes(deviceRegistry.getStatus(d.id))).length, '项'],
    ];
    this.kpi.innerHTML = kpi.map(([k, v, u]) => `<div><div class="k">${k}</div><div class="v">${v}<small>${u}</small></div></div>`).join('');
  }
}
