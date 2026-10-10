// 户型数据（两层住宅）：楼层、房间、墙体和门窗洞口、楼梯、电梯、安全出口。
// 所有几何体都由这些数据生成，改户型只需改这里。
// 坐标系：单位米，y 向上；x 向东，z 向南（-z 为北）。外墙中心线范围 x∈[-8,8]，z∈[-5,5]。
//
// 一层（y = 0）                                   二层（y = 3.2）
// ┌────────┬──────┬─────────┬────────┐          ┌────────┬──────┬─────────┬────────┐
// │ 老人房 │卫生间│ 楼梯间  │ 设备间 │          │  主卧  │卫生间│ 楼梯厅  │ 儿童房 │
// ├──门────┴──门──┴(敞开)──┴──门────┤          ├──门────┴──门──┴(敞开)──┴──门────┤
// │入户门          走廊       后门   │          │                走廊              │
// │                    ┌─────────────┤          ├──门────────┐          ┌──门──────┤
// │   客厅       餐厅  门   厨房     │          │   书房     │  起居室  │   客房   │
// └──(落地门)─────────┴──────────────┘          └────────────┴─(推拉门)─┴──────────┘
//                                                             └── 阳台 ──┘

export const FLOOR_H = 3.2;     // 层高
export const SLAB_T = 0.2;      // 楼板厚度（一层天花板在 3.0，二层地面在 3.2）
export const WALL_T = 0.2;      // 墙厚
export const EAVE_Y = 6.4;      // 屋檐高度（二层墙顶）
export const ROOF_PITCH = 25;   // 屋面坡度（度）
export const EXT = { x0: -8, x1: 8, z0: -5, z1: 5 };
export const FLOORS = [{ id: 0, name: '一层', y: 0 }, { id: 1, name: '二层', y: FLOOR_H }];

// 房间：id、名称、楼层、范围、地面材质。outdoor 表示阳台等室外空间（不参与室内环境模拟）
export interface Room {
  readonly id: string;
  readonly name: string;
  readonly floor: number;
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
  readonly fl: string;
  readonly outdoor?: boolean;
}

export const ROOMS: readonly Room[] = [
  // 一层
  { id: 'elder', name: '老人房', floor: 0, x0: -8, x1: -3.2, z0: -5, z1: -1, fl: 'woodFloor' },
  { id: 'bath1', name: '无障碍卫生间', floor: 0, x0: -3.2, x1: -0.6, z0: -5, z1: -1, fl: 'bathTile' },
  { id: 'stair1', name: '楼梯间', floor: 0, x0: -0.6, x1: 3.4, z0: -5, z1: -1, fl: 'tileFloor' },
  { id: 'utility', name: '设备间', floor: 0, x0: 3.4, x1: 8, z0: -5, z1: -1, fl: 'bathTile' },
  { id: 'hall1', name: '门厅走廊', floor: 0, x0: -8, x1: 8, z0: -1, z1: 0.6, fl: 'tileFloor' },
  { id: 'living', name: '客厅', floor: 0, x0: -8, x1: -1, z0: 0.6, z1: 5, fl: 'tileFloor' },
  { id: 'dining', name: '餐厅', floor: 0, x0: -1, x1: 3.2, z0: 0.6, z1: 5, fl: 'tileFloor' },
  { id: 'kitchen', name: '厨房', floor: 0, x0: 3.2, x1: 8, z0: 0.6, z1: 5, fl: 'bathTile' },
  // 二层
  { id: 'master', name: '主卧', floor: 1, x0: -8, x1: -2.6, z0: -5, z1: -1, fl: 'woodFloor' },
  { id: 'bath2', name: '二层卫生间', floor: 1, x0: -2.6, x1: -0.6, z0: -5, z1: -1, fl: 'bathTile' },
  { id: 'stair2', name: '楼梯厅', floor: 1, x0: -0.6, x1: 3.4, z0: -5, z1: -1, fl: 'woodFloor' },
  { id: 'kid', name: '儿童房', floor: 1, x0: 3.4, x1: 8, z0: -5, z1: -1, fl: 'woodFloor' },
  { id: 'hall2', name: '二层走廊', floor: 1, x0: -8, x1: 8, z0: -1, z1: 0.6, fl: 'woodFloor' },
  { id: 'study', name: '书房', floor: 1, x0: -8, x1: -3.6, z0: 0.6, z1: 5, fl: 'woodFloor' },
  { id: 'family', name: '家庭起居室', floor: 1, x0: -3.6, x1: 3.2, z0: 0.6, z1: 5, fl: 'woodFloor' },
  { id: 'guest', name: '客房', floor: 1, x0: 3.2, x1: 8, z0: 0.6, z1: 5, fl: 'woodFloor' },
  { id: 'balcony', name: '南阳台', floor: 1, x0: -3.6, x1: 3.2, z0: 5, z1: 6.6, fl: 'deck', outdoor: true },
];
export const INDOOR_ROOMS = ROOMS.filter((r) => !r.outdoor);

export function roomById(id: string | null | undefined): Room | undefined {
  return ROOMS.find((r) => r.id === id);
}

/** 点 (x,z) 在第 floor 层所在的房间；不在室内返回 null */
export function roomAt(x: number, z: number, floor = 0): Room | null {
  return ROOMS.find((r) => r.floor === floor && x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) ?? null;
}

export function roomCenter(r: Room) {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2, y: FLOORS[r.floor].y };
}

/** 由高度判断楼层 */
export function floorOfY(y) {
  return y > FLOOR_H - 0.8 ? 1 : 0;
}

// 墙：第 floor 层从 (x1,z1) 到 (x2,z2) 的轴对齐线段（中心线）。
// openings: 洞口，a/b 为沿墙方向的起止坐标，bottom/top 为洞口底部 / 顶部相对本层地面的高度，
//   kind: 'window' | 'door' | 'slide'（推拉门）| 'opening'（敞开的门洞）
// exterior: 外墙朝外的一侧
const win = (a, b, id, room, bottom = 0.9, top = 2.3) => ({ a, b, bottom, top, kind: 'window', id, room });
const door = (a, b, id, room, hinge, swing, extra = {}) => ({ a, b, bottom: 0, top: 2.2, kind: 'door', id, room, hinge, swing, ...extra });

export const WALLS = [
  // ===== 一层外墙 =====
  { id: 'n1', floor: 0, x1: -8, z1: -5, x2: 8, z2: -5, exterior: '-z', openings: [
    win(-6.5, -4.5, 'w-elder-n', 'elder'), win(-2.4, -1.4, 'w-bath1', 'bath1', 1.5), win(0.2, 1.6, 'w-stair1', 'stair1', 1.2, 2.4), win(5.0, 6.5, 'w-utility-n', 'utility', 1.2),
  ] },
  { id: 's1', floor: 0, x1: -8, z1: 5, x2: 8, z2: 5, exterior: '+z', openings: [
    { a: -6.6, b: -2.6, bottom: 0, top: 2.5, kind: 'slide', id: 'door-living', room: 'living', exit: true },
    win(0.2, 2.4, 'w-dining', 'dining', 0.8, 2.4), win(4.6, 6.6, 'w-kitchen-s', 'kitchen', 1.0),
  ] },
  { id: 'w1', floor: 0, x1: -8, z1: -5, x2: -8, z2: 5, exterior: '-x', openings: [
    win(-3.8, -2.2, 'w-elder-w', 'elder'),
    door(-0.75, 0.35, 'door-entry', 'hall1', 'a', -1, { top: 2.3, exit: true }),
    win(1.8, 3.8, 'w-living-w', 'living'),
  ] },
  { id: 'e1', floor: 0, x1: 8, z1: -5, x2: 8, z2: 5, exterior: '+x', openings: [
    win(-3.8, -2.6, 'w-utility-e', 'utility', 1.2),
    door(-0.7, 0.3, 'door-back', 'hall1', 'a', 1, { top: 2.3, exit: true }),
    win(2.0, 4.0, 'w-kitchen-e', 'kitchen', 1.0),
  ] },
  // ===== 一层内墙 =====
  { id: 'h1', floor: 0, x1: -8, z1: -1, x2: 8, z2: -1, openings: [
    door(-4.4, -3.4, 'door-elder', 'elder', 'b', 1),
    door(-2.2, -1.2, 'door-bath1', 'bath1', 'a', 1),
    { a: -0.5, b: 3.2, bottom: 0, top: 2.4, kind: 'opening', id: 'op-stair1', room: 'stair1' }, // 门洞一直开到电梯门前
    door(4.2, 5.1, 'door-utility', 'utility', 'a', 1),
  ] },
  { id: 'i1a', floor: 0, x1: -3.2, z1: -5, x2: -3.2, z2: -1, openings: [] },
  { id: 'i1b', floor: 0, x1: -0.6, z1: -5, x2: -0.6, z2: -1, openings: [] },
  { id: 'i1c', floor: 0, x1: 3.4, z1: -5, x2: 3.4, z2: -1, openings: [] },
  { id: 'k1', floor: 0, x1: 3.2, z1: 0.6, x2: 3.2, z2: 5, extendStart: true, openings: [
    door(1.1, 2.1, 'door-kitchen', 'kitchen', 'a', 1, { fireDoor: true }),
  ] },
  { id: 'k2', floor: 0, x1: 3.2, z1: 0.6, x2: 8, z2: 0.6, openings: [] },
  // ===== 二层外墙 =====
  { id: 'n2', floor: 1, x1: -8, z1: -5, x2: 8, z2: -5, exterior: '-z', openings: [
    win(-6.4, -4.4, 'w-master-n', 'master'), win(-2.0, -1.2, 'w-bath2', 'bath2', 1.5), win(0.2, 1.6, 'w-stair2', 'stair2', 1.2, 2.4), win(5.0, 7.0, 'w-kid-n', 'kid'),
  ] },
  { id: 's2', floor: 1, x1: -8, z1: 5, x2: 8, z2: 5, exterior: '+z', openings: [
    win(-7.0, -5.0, 'w-study-s', 'study'),
    { a: -2.8, b: 1.6, bottom: 0, top: 2.4, kind: 'slide', id: 'door-balcony', room: 'family' },
    win(4.6, 6.6, 'w-guest-s', 'guest'),
  ] },
  { id: 'w2', floor: 1, x1: -8, z1: -5, x2: -8, z2: 5, exterior: '-x', openings: [
    win(-3.8, -2.2, 'w-master-w', 'master'), win(-0.6, 0.2, 'w-hall2-w', 'hall2', 1.0), win(2.0, 3.8, 'w-study-w', 'study'),
  ] },
  { id: 'e2', floor: 1, x1: 8, z1: -5, x2: 8, z2: 5, exterior: '+x', openings: [
    win(-3.8, -2.2, 'w-kid-e', 'kid'), win(-0.6, 0.2, 'w-hall2-e', 'hall2', 1.0), win(2.0, 4.0, 'w-guest-e', 'guest'),
  ] },
  // ===== 二层内墙 =====
  { id: 'h2', floor: 1, x1: -8, z1: -1, x2: 8, z2: -1, openings: [
    door(-3.7, -2.8, 'door-master', 'master', 'b', 1),
    door(-2.3, -1.4, 'door-bath2', 'bath2', 'a', 1),
    { a: -0.5, b: 3.2, bottom: 0, top: 2.4, kind: 'opening', id: 'op-stair2', room: 'stair2' },
    door(4.2, 5.1, 'door-kid', 'kid', 'a', 1),
  ] },
  { id: 'i2a', floor: 1, x1: -2.6, z1: -5, x2: -2.6, z2: -1, openings: [] },
  { id: 'i2b', floor: 1, x1: -0.6, z1: -5, x2: -0.6, z2: -1, openings: [] },
  { id: 'i2c', floor: 1, x1: 3.4, z1: -5, x2: 3.4, z2: -1, openings: [] },
  { id: 'st', floor: 1, x1: -8, z1: 0.6, x2: -3.6, z2: 0.6, openings: [door(-5.3, -4.4, 'door-study', 'study', 'a', -1)] },
  { id: 'st2', floor: 1, x1: -3.6, z1: 0.6, x2: -3.6, z2: 5, extendStart: true, openings: [] },
  { id: 'gu', floor: 1, x1: 3.2, z1: 0.6, x2: 8, z2: 0.6, openings: [door(3.9, 4.8, 'door-guest', 'guest', 'b', -1)] },
  { id: 'gu2', floor: 1, x1: 3.2, z1: 0.6, x2: 3.2, z2: 5, extendStart: true, openings: [] },
];

// U 形楼梯：第一跑从 (x=0.1, z=-1.35) 向北上到休息平台（高 1.6），第二跑从平台向南上到二层（z=-1.35）
export const STAIR = {
  flight1: { x0: -0.45, x1: 0.65 },
  flight2: { x0: 0.75, x1: 1.85 },
  zLow: -1.35, zHigh: -3.8,          // 梯段两端
  landing: { z0: -4.9, z1: -3.8 },    // 休息平台
  steps: 9,                            // 每跑 9 级台阶
  hole: { x0: -0.5, x1: 1.9, z0: -4.9, z1: -1.35 }, // 二层楼板开洞
  // 人物上楼时依次经过的三维路点（下楼反过来）
  path: [
    { x: 0.1, y: 0, z: -1.1 }, { x: 0.1, y: 0, z: -1.35 }, { x: 0.1, y: 1.6, z: -3.8 }, { x: 0.1, y: 1.6, z: -4.35 },
    { x: 1.3, y: 1.6, z: -4.35 }, { x: 1.3, y: 1.6, z: -3.8 }, { x: 1.3, y: 3.2, z: -1.35 }, { x: 1.3, y: 3.2, z: -1.1 },
  ],
};

/**
 * 楼梯表面高度：(x,z) 在梯段或休息平台上时返回该处台阶面的高度，否则返回 null。
 * 用于漫游时上下楼和人物沿楼梯行走。
 */
export function stairHeight(x, z) {
  const { flight1: f1, flight2: f2, zLow, zHigh, landing } = STAIR;
  // 梯段南端向外多留 0.25m（与导航网格的格子边界衔接，避免出现走不上去的缝）
  if (z < landing.z0 || z > zLow + 0.25 || x < f1.x0 || x > f2.x1) return null;
  if (z <= landing.z1) return 1.6;
  const t = Math.max(0, (zLow - z) / (zLow - zHigh)); // 0 = 梯段南端，1 = 北端
  if (x <= f1.x1) return 1.6 * t;
  if (x >= f2.x0) return 1.6 + 1.6 * (1 - t);
  return null; // 两跑之间的栏杆
}

// 家用电梯（适老）：井道位于楼梯间东侧，门朝南
export const ELEVATOR = { x0: 2.2, x1: 3.3, z0: -4.9, z1: -3.4, doorX: 2.75 };

// ---------------- 设备安装位置 ----------------
export type WallSide = '+x' | '-x' | '+z' | '-z';

/** 墙面安装点：设备中心离墙中心线 inset 米，facing 为设备朝向（指向房间内） */
export interface WallSpot { x: number; z: number; facing: WallSide }

const INWARD: Record<WallSide, WallSide> = { '+x': '-x', '-x': '+x', '+z': '-z', '-z': '+z' };

/**
 * 在房间某一侧的墙上找一处实墙安装点：该处有墙体，且高度 height 不落在任何门窗洞口内（洞口两侧各留 margin）。
 * 按 sides 的顺序逐面尝试；每面墙从 start（距该面墙起点的距离）开始，向墙的另一端每 0.1 m 试一次。
 */
export function wallMountSpot(room: Room, height: number, sides: readonly WallSide[] = ['+x', '-x', '-z', '+z'],
  { start = 0.5, margin = 0.2, inset = 0.12 } = {}): WallSpot | null {
  for (const side of sides) {
    const alongZ = side === '+x' || side === '-x';
    const line = side === '+x' ? room.x1 : side === '-x' ? room.x0 : side === '+z' ? room.z1 : room.z0;
    const [lo, hi] = alongZ ? [room.z0, room.z1] : [room.x0, room.x1];
    const walls = WALLS.filter((w) => w.floor === room.floor && (alongZ
      ? w.x1 === w.x2 && Math.abs(w.x1 - line) < 0.01
      : w.z1 === w.z2 && Math.abs(w.z1 - line) < 0.01));
    for (let t = lo + start; t <= hi - start + 1e-6; t += 0.1) {
      const solid = walls.some((w) => {
        const [a0, a1] = alongZ ? [Math.min(w.z1, w.z2), Math.max(w.z1, w.z2)] : [Math.min(w.x1, w.x2), Math.max(w.x1, w.x2)];
        if (t < a0 + margin || t > a1 - margin) return false;
        return !w.openings.some((op) => t > op.a - margin && t < op.b + margin && height > op.bottom - margin && height < op.top + margin);
      });
      if (!solid) continue;
      const offset = side === '+x' || side === '+z' ? -inset : inset;
      return alongZ ? { x: line + offset, z: t, facing: INWARD[side] } : { x: t, z: line + offset, facing: INWARD[side] };
    }
  }
  return null;
}

/** 第 floor 层天花板上的楼板开洞（一层天花板有楼梯洞和电梯井，二层只有电梯井） */
function ceilingHoles(floor: number) {
  return floor === 0 ? [STAIR.hole, ELEVATOR] : [ELEVATOR];
}

/** 房间天花板上不落在楼板开洞里的安装点：依次尝试四个角（离两侧墙 inset 米） */
export function ceilingMountSpot(room: Room, { inset = 0.4, margin = 0.15 } = {}): { x: number; z: number } | null {
  const corners = [[room.x0 + inset, room.z0 + inset], [room.x1 - inset, room.z0 + inset], [room.x0 + inset, room.z1 - inset], [room.x1 - inset, room.z1 - inset]];
  for (const [x, z] of corners) {
    const inHole = ceilingHoles(room.floor).some((h) => x > h.x0 - margin && x < h.x1 + margin && z > h.z0 - margin && z < h.z1 + margin);
    if (!inHole) return { x, z };
  }
  return null;
}

// 安全出口（室外一侧的集合点），疏散路径规划的目标（都在一层）
export const EXITS = [
  { id: 'door-entry', name: '入户门', x: -9.8, z: -0.2 },
  { id: 'door-living', name: '客厅落地门', x: -4.6, z: 7.4 },
  { id: 'door-back', name: '后门', x: 9.8, z: -0.2 },
];

// 室外：车道、雨水蓄水池
export const DRIVEWAY = { x0: -14.4, x1: -8.3, z0: 2.2, z1: 4.8 };
export const RAIN_TANK = { x: 11, z: 7.2, r: 1.1, depth: 2.2 };
