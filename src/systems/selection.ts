// 对象选择：鼠标点击 → 射线检测（Raycaster）→ 找到带信息的物体 → 高亮包围盒 + 右侧信息卡片。
import * as THREE from 'three';
import { el, toggle, slider, button } from '../ui/ui.js';
import { sectionPlane } from '../scene/common.js';
import { STATUS_TEXT } from '../scene/devices.js';
import { roomById } from '../scene/layout.js';
import { Disposer } from './disposer.js';

export class Selection {
  // Fields are declared here and initialized by the existing runtime flow.
  declare app: any;
  declare controlsBox: any;
  declare dataTable: any;
  declare helper: any;
  declare mouse: any;
  declare onSelect: any;
  declare panel: any;
  declare raycaster: any;
  declare selected: any;
  private readonly events = new Disposer();

  constructor(app) {
    this.app = app;
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.selected = null;
    this.helper = new THREE.Box3Helper(new THREE.Box3(), 0xffb300);
    this.helper.visible = false;
    this.helper.material.depthTest = false;
    this.helper.renderOrder = 10;
    app.scene.add(this.helper);
    this.panel = document.getElementById('info');
    this.onSelect = null;

    // 区分"点击"和"拖动旋转视角"：按下和抬起位置相差很小才算点击
    const dom = app.renderer.domElement;
    let down: { x: number; y: number; t: number } | null = null;
    this.events.listen(dom, 'pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
    this.events.listen(dom, 'pointerup', (e) => {
      if (!down || e.button !== 0) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 5 && performance.now() - down.t < 500) this.pick(e.clientX, e.clientY);
      down = null;
    });
    this.events.listen(dom, 'dblclick', () => { if (this.selected) app.rig.focus(this.selected); });
  }

  // 物体及其所有父节点都可见，才算可见
  visible(o) {
    for (let p = o; p; p = p.parent) if (!p.visible) return false;
    return true;
  }

  pick(cx, cy) {
    const r = this.app.renderer.domElement.getBoundingClientRect();
    this.mouse.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(this.mouse, this.app.camera);
    const hits = this.raycaster.intersectObjects(this.app.pickables, true);
    for (const h of hits) {
      if (!this.visible(h.object) || h.object.userData.noPick) continue;
      // 被剖切平面切掉的部分不能点
      const m = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
      const clipped = m?.clippingPlanes?.length && h.point.y > sectionPlane.constant;
      if (clipped) continue;
      if (m?.opacity < 0.2 && m.transparent && !h.object.userData.info) continue;
      let o = h.object;
      while (o && !o.userData.info) o = o.parent;
      if (o) { this.select(o); return; }
    }
    this.select(null);
  }

  select(obj) {
    this.selected = obj;
    if (!obj) {
      this.helper.visible = false;
      this.panel.classList.remove('show');
      this.onSelect?.(null);
      return;
    }
    this.helper.box.setFromObject(obj);
    this.helper.box.expandByScalar(0.03);
    this.helper.visible = true;
    this.render();
    this.onSelect?.(obj);
  }

  /** 按设备 id 选中并让镜头对准 */
  selectDevice(id, focus = true) {
    const root = this.app.devices.registry.getModule(id)?.root;
    if (!root) return;
    this.select(root);
    if (focus) this.app.rig.focus(root);
  }

  /** 取消选中，移除鼠标监听和选中框 */
  dispose() {
    this.select(null);
    this.events.dispose();
    this.helper.removeFromParent();
    this.helper.dispose();
  }

  /** 选中对象的信息或控件变化后，重新绘制信息卡片 */
  refresh() {
    if (this.selected) this.render();
  }

  render() {
    const obj = this.selected;
    const info = obj.userData.info;
    const p = this.panel;
    p.innerHTML = '';
    p.append(el('button', { class: 'close', onclick: () => this.select(null) }, '×'));
    p.append(el('h2', {}, info.name));
    const meta = el('div', { class: 'meta' });
    if (info.category) meta.append(el('span', { class: 'tag' }, info.category));
    if (info.room) meta.append(el('span', { class: 'tag' }, '位置：' + (roomById(info.room)?.name ?? info.room)));
    if (info.status) meta.append(el('span', { class: 'badge ' + info.status }, '● ' + STATUS_TEXT[info.status]));
    p.append(meta);
    if (info.func) p.append(el('p', {}, el('b', {}, '功能：'), info.func));
    if (info.maintain) p.append(el('p', {}, el('b', {}, '维护：'), info.maintain));
    const table = el('table', { class: 'kv' });
    p.append(table);
    this.dataTable = table;
    this.refreshData();
    if (info.controls?.length) {
      const c = el('div', { class: 'controls' });
      for (const ctl of info.controls) {
        if (ctl.type === 'toggle') c.append(toggle(ctl.label, ctl.get, (v) => { ctl.set(v); this.refreshData(); }));
        else if (ctl.type === 'range') c.append(slider(ctl.label, ctl.min, ctl.max, ctl.step, ctl.get, (v) => { ctl.set(v); this.refreshData(); }, ctl.fmt));
        else if (ctl.type === 'button') c.append(button(ctl.label, ctl.onClick, 'primary'));
      }
      p.append(c);
      this.controlsBox = c;
    }
    p.append(el('p', { style: 'color:#8a96a6;font-size:11px;margin-top:10px' }, '提示：双击物体可将镜头对准它'));
    p.classList.add('show');
  }

  refreshData() {
    if (!this.selected || !this.dataTable) return;
    const info = this.selected.userData.info;
    const rows = Object.entries(info.data ?? {});
    const html = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
    if (this.dataTable.innerHTML !== html) this.dataTable.innerHTML = html;
    // 状态徽章也可能变化
    const badge = this.panel.querySelector('.badge');
    if (badge && info.status) { badge.className = 'badge ' + info.status; badge.textContent = '● ' + STATUS_TEXT[info.status]; }
  }

  update() {
    if (this.selected) {
      this.helper.box.setFromObject(this.selected);
      this.helper.box.expandByScalar(0.03);
    }
  }
}
