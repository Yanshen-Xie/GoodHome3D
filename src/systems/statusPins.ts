// 状态标记：在设备上方显示一根带圆球的"大头针"，颜色表示设备状态（绿=正常，黄=预警，红=故障）。
// 用于"安全状态视图"和"数字孪生运维视图"。
import * as THREE from 'three';
import { STATUS_COLOR } from '../scene/devices.js';

export class StatusPins {
  // Fields are declared here and initialized by the existing runtime flow.
  declare group: any;
  declare pins: any;
  declare registry: any;

  constructor(scene, devices, filter) {
    this.registry = devices.registry ?? devices;
    this.group = new THREE.Group();
    this.group.visible = false;
    this.group.userData.noPick = true;
    scene.add(this.group);
    this.pins = [];
    const ballGeo = new THREE.SphereGeometry(0.07, 16, 12);
    for (const d of this.registry.all()) {
      const root = this.registry.getModule(d.id)?.root;
      if (!root || !filter(d)) continue;
      const box = new THREE.Box3().setFromObject(root);
      const top = new THREE.Vector3((box.min.x + box.max.x) / 2, box.max.y, (box.min.z + box.max.z) / 2);
      const h = 0.5;
      const mat = new THREE.MeshBasicMaterial({ color: STATUS_COLOR.normal, depthTest: false, transparent: true });
      const ball = new THREE.Mesh(ballGeo, mat);
      ball.position.set(top.x, top.y + h, top.z);
      ball.renderOrder = 20;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([top, ball.position.clone()]), new THREE.LineBasicMaterial({ color: STATUS_COLOR.normal, depthTest: false, transparent: true }));
      line.renderOrder = 20;
      ball.userData.noPick = line.userData.noPick = true;
      this.group.add(ball, line);
      this.pins.push({ id: d.id, ball, line, baseY: ball.position.y });
    }
  }

  set visible(v) { this.group.visible = v; }
  get visible() { return this.group.visible; }

  update(t) {
    if (!this.group.visible) return;
    for (const p of this.pins) {
      const status = this.registry.getStatus(p.id) ?? 'normal';
      const c = STATUS_COLOR[status] ?? STATUS_COLOR.normal;
      p.ball.material.color.setHex(c);
      p.line.material.color.setHex(c);
      // 非正常状态的标记上下跳动，更醒目
      const bounce = status === 'normal' ? 0 : Math.abs(Math.sin(t * 5)) * 0.15;
      p.ball.position.y = p.baseY + bounce;
      p.ball.scale.setScalar(status === 'normal' ? 1 : 1.6);
    }
  }
}
