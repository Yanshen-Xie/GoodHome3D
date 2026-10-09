// 室内环境模拟：每个房间的温度、湿度、PM2.5、CO₂。
// 采用"一阶惯性"模型：每个量都向一个"目标值"逐渐靠近
//     x ← x + (目标 − x) · (1 − e^(−dt/τ))
// 目标值由室外天气、日照、门窗、空调、新风、人员活动等决定；τ 是时间常数（房屋保温越好，变化越慢）。
import { INDOOR_ROOMS as ROOMS } from '../scene/layout.js';

// 各房间窗户朝向与是否有阳光直射（南向房间白天得热多）
const SOUTH = new Set(['living', 'dining', 'kitchen', 'study', 'family', 'guest']);
// 二层（屋顶下）夏季午后更热一些
const UPPER = new Set(['master', 'bath2', 'stair2', 'kid', 'hall2', 'study', 'family', 'guest']);

export class EnvModel {
  // Fields are declared here and initialized by the existing runtime flow.
  declare extra: any;
  declare haze: any;
  declare outdoor: any;
  declare rooms: any;

  constructor() {
    this.rooms = {};
    for (const r of ROOMS) this.rooms[r.id] = { temp: 27, rh: 60, pm: 18, co2: 520, noise: 32 };
    this.outdoor = { temp: 30, rh: 72, pm: 35, co2: 420, noise: 55 };
    this.extra = {};      // 突发事件带来的额外影响，如 { kitchen: { temp: +30, pm: +400 } }
    this.haze = 0;        // 室外雾霾程度 0~1（模拟空气质量下降）
  }

  /** 室外气象：按季节和时刻给出温度（白天 15 点最高，凌晨 3 点最低） */
  updateOutdoor(hour, day, weather) {
    const summer = Math.cos(((day - 200) / 365) * 2 * Math.PI); // 7 月中旬 = 1，1 月中旬 = -1
    const mean = 22.5 + 6.5 * summer;
    const swing = weather === 'sunny' ? 4.5 : weather === 'cloudy' ? 3 : 1.8;
    const o = this.outdoor;
    o.temp = mean + swing * Math.sin(((hour - 9) / 24) * 2 * Math.PI) - (weather === 'rainy' ? 2 : 0);
    o.rh = weather === 'rainy' ? 90 : weather === 'cloudy' ? 75 : 62 + 8 * summer * 0.5;
    o.pm = (weather === 'rainy' ? 12 : weather === 'cloudy' ? 38 : 28) + this.haze * 180;
    o.noise = hour > 7 && hour < 22 ? 55 : 42;
  }

  /**
   * ctx 提供当前状态：
   *   sun: { elevation }, sunFactor 0~1
   *   windowsOpen(roomId) 该房间是否有窗开着
   *   acOn(roomId) / acSet(roomId) 空调
   *   fresh: { on, level }
   *   curtainOpen(roomId) 0~1
   *   people(roomId) 房间里有几个人；cooking 厨房是否在做饭
   *   shading 是否有外遮阳
   */
  step(dt, ctx) {
    const o = this.outdoor;
    const k = (tau) => 1 - Math.exp(-dt / tau);
    for (const r of ROOMS) {
      const s = this.rooms[r.id];
      const open = ctx.windowsOpen(r.id);
      const ac = ctx.acOn(r.id);
      const n = ctx.people(r.id);
      // ---- 温度 ----
      // 保温好的房子室内比室外温和：目标 = 室外温度向 25℃ 靠拢一部分
      let tTarget = o.temp * 0.55 + 25 * 0.45;
      if (SOUTH.has(r.id) && ctx.sun.elevation > 0) {
        const curtain = ctx.curtainOpen(r.id) ?? 1;
        tTarget += 3.2 * ctx.sunFactor * (0.3 + 0.7 * curtain) * (ctx.shading ? 0.45 : 1); // 太阳得热，外遮阳可减少约一半
      }
      if (UPPER.has(r.id)) tTarget += 0.6 * ctx.sunFactor;
      tTarget += n * 0.6;
      if (r.id === 'kitchen' && ctx.cooking) tTarget += 2.5;
      if (open) tTarget = tTarget * 0.3 + o.temp * 0.7;
      if (ac) tTarget = ctx.acSet(r.id);
      s.temp += (tTarget - s.temp) * k(ac ? 40 : open ? 60 : 240);
      // ---- 湿度 ----
      let rhTarget = o.rh * 0.8 + 10;
      if (r.id.startsWith('bath') && n > 0) rhTarget += 18;
      if (r.id === 'kitchen' && ctx.cooking) rhTarget += 8;
      if (ac) rhTarget = Math.min(rhTarget, 55);
      if (ctx.fresh.on) rhTarget = rhTarget * 0.7 + 55 * 0.3;
      s.rh += (rhTarget - s.rh) * k(90);
      // ---- PM2.5 ----
      let pmTarget = o.pm * 0.5 + 6;
      if (r.id === 'kitchen' && ctx.cooking) pmTarget += 45;
      if (open) pmTarget = o.pm * 0.9 + (r.id === 'kitchen' && ctx.cooking ? 25 : 0);
      else if (ctx.fresh.on && ctx.fresh.rooms.has(r.id)) pmTarget = Math.min(pmTarget, 4 + 12 / ctx.fresh.level + o.pm * 0.05);
      s.pm += (pmTarget - s.pm) * k(open ? 30 : ctx.fresh.on ? 35 : 120);
      // ---- CO₂：有人时升高，通风时回落 ----
      let co2Target = 480 + n * 650;
      if (open) co2Target = 430 + n * 120;
      else if (ctx.fresh.on) co2Target = 450 + n * 180 / ctx.fresh.level;
      s.co2 += (co2Target - s.co2) * k(open ? 40 : 150);
      // ---- 噪声 ----
      s.noise = (open ? o.noise - 10 : o.noise - 30) + n * 8 + (ctx.tvOn && r.id === 'living' ? 20 : 0) + (ac ? 4 : 0);

      // 事件（火灾、燃气泄漏）叠加
      const ex = this.extra[r.id];
      if (ex) {
        if (ex.temp) s.temp += (ex.temp - s.temp) * k(8);
        if (ex.pm) s.pm += (ex.pm - s.pm) * k(6);
      }
    }
  }

  get(roomId, key) { return this.rooms[roomId]?.[key]; }
}

// 热力图用的指标：名称、单位、显示范围（低 → 高）、舒适区间
export const METRICS = {
  temp: { name: '温度', unit: '℃', min: 16, max: 36, good: [20, 26], digits: 1 },
  rh: { name: '相对湿度', unit: '%', min: 30, max: 90, good: [40, 65], digits: 0 },
  pm: { name: 'PM2.5', unit: 'μg/m³', min: 0, max: 150, good: [0, 35], digits: 0 },
  co2: { name: 'CO₂', unit: 'ppm', min: 400, max: 2000, good: [400, 1000], digits: 0 },
  noise: { name: '噪声', unit: 'dB', min: 20, max: 70, good: [20, 40], digits: 0 },
};
