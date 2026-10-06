// 总览：介绍住宅概况、四大特征入口、基础操作说明、全局开关。
import { ROOMS, roomCenter } from '../scene/layout.js';
import { section, stats, toggle, button, hint, el } from '../ui/ui.js';

export class OverviewFeature {
  constructor(app) {
    this.app = app;
    // 房间名称标签
    this.roomLabels = ROOMS.map((r) => {
      const c = roomCenter(r);
      const l = app.makeLabel(`<b>${r.name}</b> <span style="color:#888">${((r.x1 - r.x0) * (r.z1 - r.z0)).toFixed(1)}㎡</span>`, 'room', c.x, 0.3, c.z);
      l.visible = false;
      return l;
    });
    this.showLabels = false;
  }

  setLabels(v) {
    this.showLabels = v;
    for (const l of this.roomLabels) l.visible = v;
  }

  buildPanel(root) {
    const app = this.app;
    const s1 = section('住宅概况', '一栋面向“三口之家 + 一位老人”的单层独立住宅，建筑面积约 160㎡，包含客厅、餐厅、厨房、主卧、儿童房、老人房、卫生间和走廊，并配有南向露台、庭院与屋顶光伏。');
    const area = ROOMS.reduce((s, r) => s + (r.x1 - r.x0) * (r.z1 - r.z0), 0);
    this.stats = stats([
      { k: '建筑面积', v: () => area.toFixed(0), unit: '㎡' },
      { k: '在线设备', v: () => app.devices.list.filter((d) => d.object).length, unit: '台' },
      { k: '室外温度', v: () => app.envModel.outdoor.temp.toFixed(1), unit: '℃' },
      { k: '室内平均温度', v: () => (ROOMS.reduce((s, r) => s + app.envModel.rooms[r.id].temp, 0) / ROOMS.length).toFixed(1), unit: '℃' },
      { k: '光伏发电', v: () => (app.features.green?.state.pv ?? 0).toFixed(2), unit: 'kW' },
      { k: '储能电量', v: () => (app.features.green?.state.soc ?? 0).toFixed(0), unit: '%' },
    ]);
    s1.append(this.stats);
    root.append(s1);

    const s2 = section('“好房子”四大特征', '点击进入对应功能页，每一类功能都可以独立演示。');
    const cards = [
      ['safety', '安全耐久', '火灾报警与疏散路线、一键呼叫、燃气与电气安全', '#d64541'],
      ['comfort', '健康舒适', '日照阴影、自然通风与新风、温湿度 / PM2.5 分布、适老无障碍', '#e08a1f'],
      ['green', '绿色低碳', '屋顶光伏发电与能量流动、储能、普通方案与绿色方案对比', '#2e9d57'],
      ['smart', '智慧便捷', '场景模式联动、设备控制、燃气泄漏联动、数字孪生运维', '#6c5ce7'],
    ];
    for (const [id, name, desc, color] of cards) {
      const c = el('div', { class: 'dev-item', style: `border-left:4px solid ${color};padding:8px 10px;margin-bottom:6px;flex-direction:column;align-items:flex-start;gap:2px`, onclick: () => app.activateTab(id) },
        el('b', { style: `color:${color}` }, name), el('span', { style: 'color:#5d6b7c;font-size:12px' }, desc));
      s2.append(c);
    }
    root.append(s2);

    const s3 = section('显示');
    s3.append(toggle('显示屋顶', () => app.house.roof.visible, (v) => app.setRoof(v)));
    s3.append(toggle('显示房间名称', () => this.showLabels, (v) => this.setLabels(v)));
    s3.append(toggle('人物走动', () => !app.people.paused, (v) => { app.people.paused = !v; }));
    s3.append(toggle('高画质（软阴影、抗锯齿分辨率）', () => app.highQuality, (v) => app.setQuality(v)));
    this.roofToggle = s3.children[1];
    app.ui = { syncRoof: () => this.roofToggle.refresh() };
    root.append(s3);

    const s4 = section('操作说明');
    s4.append(hint('鼠标左键拖动：旋转视角<br>鼠标右键拖动：平移<br>滚轮：缩放<br>单击物体：查看名称、功能、状态和维护信息，设备可直接控制<br>双击物体：镜头对准该物体<br>左下角：预设视点、第一人称漫游<br>底部时间栏：调整时间、日期和天气（太阳位置、阴影、光伏发电随之变化）'));
    s4.append(el('div', { class: 'btns', style: 'margin-top:8px' },
      button('整体鸟瞰', () => { app.rig.flyTo([20, 16, 24], [0, 1, 0]); app.setRoof(true); }),
      button('户型俯视', () => { app.rig.flyTo([0, 26, 9], [0, 0, 0.5]); app.setRoof(false); this.setLabels(true); }),
    ));
    root.append(s4);
  }

  enter() {}
  slowUpdate(dt, active) { if (active) this.stats.refresh(); }
}
