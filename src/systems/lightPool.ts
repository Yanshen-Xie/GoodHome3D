// 灯光池：场景里有很多盏灯（每个房间的吊顶灯、报警灯、火光、电视光、庭院投光灯……），
// 如果每盏都是真正的点光源，片元着色器要对每个像素计算所有光源，显卡负担很重；
// 而且灯的数量一变化，three.js 就要重新编译着色器，造成卡顿。
// 做法：只创建固定数量（N 盏）的真实点光源；每帧从"正在发光"的灯中挑出离摄像机最近的 N 盏，
// 把位置、颜色、亮度复制给真实光源。其余的灯只显示灯具本身的发光材质。
import * as THREE from 'three';

export class LightPool {
  // Fields are declared here and initialized by the existing runtime flow.
  declare lamps: any;
  declare lights: any;
  declare tmp: any;

  constructor(parent, size = 10) {
    this.lights = [];
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 9, 2);
      parent.add(l);
      this.lights.push(l);
    }
    this.lamps = [];
    this.tmp = new THREE.Vector3();
  }

  /** 登记一盏"虚拟灯"：{ position: Vector3, color: Color, intensity, distance, priority } */
  add(lamp) {
    const l = { position: new THREE.Vector3(), color: new THREE.Color(0xffffff), intensity: 0, distance: 9, priority: 0, ...lamp };
    this.lamps.push(l);
    return l;
  }

  remove(lamp) {
    const index = this.lamps.indexOf(lamp);
    if (index < 0) return false;
    this.lamps.splice(index, 1);
    return true;
  }

  update(camera, cutY = Infinity) {
    const cam = camera.position;
    // 只考虑发光且没有被剖切掉的灯；报警、火焰等 priority 高的优先
    const active = this.lamps.filter((l) => l.intensity > 0.01 && l.position.y < cutY + 0.2);
    for (const l of active) l._score = l.position.distanceToSquared(cam) - l.priority * 1e4;
    active.sort((a, b) => a._score - b._score);
    this.lights.forEach((real, i) => {
      const l = active[i];
      if (l) {
        real.position.copy(l.position);
        real.color.copy(l.color);
        real.intensity = l.intensity;
        real.distance = l.distance;
      } else real.intensity = 0;
    });
  }
}
