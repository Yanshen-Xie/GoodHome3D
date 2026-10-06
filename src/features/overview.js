// 总览：住宅概况、四大特征入口、基础操作说明、全局开关。
import { INDOOR_ROOMS, roomCenter } from '../scene/layout.js';
import { section, stats, toggle, button, hint, el } from '../ui/ui.js';

export class OverviewFeature {
  constructor(app) {
    this.app = app;
    this.roomLabels = INDOOR_ROOMS.map((r) => {
      const c = roomCenter(r);
      const l = app.makeLabel(`<b>${r.name}</b> <span style="color:#888">${((r.x1 - r.x0) * (r.z1 - r.z0)).toFixed(1)}㎡</span>`, 'room', c.x, c.y + 0.3, c.z);
      l.visible = false;
      return l;
    });
    this.showLabels = false;
  }

  setLabels(v) {
    this.showLabels = v;
    for (const l of this.roomLabels) l.visible = v;
    this.labelToggle?.refresh();
  }

  buildPanel(root) {
    const app = this.app;
    const area = INDOOR_ROOMS.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    const s1 = section('住宅概况', `两层独立住宅，建筑面积约 ${area.toFixed(0)}㎡，住着“三口之家 + 一位老人”。一层：客厅、餐厅、厨房、老人房、无障碍卫生间、设备间；二层：主卧、儿童房、书房、家庭起居室、客房、卫生间和南向阳台。U 形楼梯旁设家用电梯，南坡屋面铺设光伏，屋面雨水收集回用。`);
    this.stats = stats([
      { k: '建筑面积', v: () => area.toFixed(0), unit: '㎡' },
      { k: '在线设备', v: () => app.devices.registry.all().filter((d) => d.module).length, unit: '台' },
      { k: '室外温度', v: () => app.envModel.outdoor.temp.toFixed(1), unit: '℃' },
      { k: '室内平均温度', v: () => (INDOOR_ROOMS.reduce((s, r) => s + app.envModel.rooms[r.id].temp, 0) / INDOOR_ROOMS.length).toFixed(1), unit: '℃' },
      { k: '光伏发电', v: () => (app.features.green?.state.pv ?? 0).toFixed(2), unit: 'kW' },
      { k: '储能电量', v: () => (app.features.green?.state.soc ?? 0).toFixed(0), unit: '%' },
    ]);
    s1.append(this.stats);
    s1.append(el('div', { class: 'btns', style: 'margin-top:8px' }, button('📊 打开数据大屏', () => app.dashboard.toggle(), 'primary')));
    root.append(s1);

    const s2 = section('“好房子”四大特征', '点击进入对应功能页，每一类功能都可以独立演示。');
    const cards = [
      ['safety', '安全耐久', '火灾报警与疏散（两层）、一键呼叫、跌倒检测、入侵检测、电梯与燃气电气安全', '#d64541'],
      ['comfort', '健康舒适', '日照阴影、自然通风与新风、温湿度 / PM2.5 分布、适老无障碍检查', '#e08a1f'],
      ['green', '绿色低碳', '屋顶光伏与能量流动、储能与充电桩、雨水收集回用、用电分项与方案对比', '#2e9d57'],
      ['smart', '智慧便捷', '场景模式联动、设备控制、燃气 / 水浸 / 雨天联动、数字孪生运维', '#6c5ce7'],
    ];
    for (const [id, name, desc, color] of cards) {
      s2.append(el('div', { class: 'dev-item', style: `border-left:4px solid ${color};padding:8px 10px;margin-bottom:6px;flex-direction:column;align-items:flex-start;gap:2px`, onclick: () => app.activateTab(id) },
        el('b', { style: `color:${color}` }, name), el('span', { style: 'color:#5d6b7c;font-size:12px' }, desc)));
    }
    root.append(s2);

    const s3 = section('显示');
    s3.append(el('div', { class: 'btns' },
      button('整栋', () => app.viewFloor('all')), button('只看一层', () => { app.viewFloor(0); app.rig.flyTo([0, 24, 10], [0, 0, 0.5]); }), button('只看二层', () => { app.viewFloor(1); app.rig.flyTo([0, 27, 10], [0, 3.2, 0.5]); }),
    ));
    this.labelToggle = toggle('显示房间名称', () => this.showLabels, (v) => this.setLabels(v));
    s3.append(this.labelToggle);
    s3.append(toggle('人物走动', () => !app.people.paused, (v) => { app.people.paused = !v; }));
    s3.append(toggle('高画质（软阴影、高分辨率）', () => app.highQuality, (v) => app.setQuality(v)));
    root.append(s3);

    const s4 = section('操作说明');
    s4.append(hint('鼠标左键拖动：旋转视角；右键拖动：平移；滚轮：缩放<br>单击物体：查看名称、功能、状态和维护信息，设备可直接控制<br>双击物体：镜头对准该物体<br>右上角：切换显示整栋 / 一层 / 二层，打开数据大屏<br>左下角：预设视点、第一人称漫游（可走楼梯上下楼）<br>底部时间栏：调整时间、日期和天气'));
    root.append(s4);
  }

  enter() {}
  slowUpdate(dt, active) { if (active) this.stats.refresh(); }
}
