// 户型数据：房间、墙体和门窗洞口。所有几何体都由这些数据生成，改户型只需改这里。
// 坐标系：单位米，y 向上；x 向东，z 向南（-z 为北）。房屋外墙中心线范围 x∈[-8,8]，z∈[-5,5]。
//
//   北  z=-5 ┌────────┬──────┬──────────┬────────┐
//            │  主卧  │卫生间│  儿童房  │ 老人房 │
//       z=-1 ├──门────┴──门──┴───────门─┴─门─────┤
//   入口门 → │                走  廊              │ ← 后门
//      z=0.6 │                         ┌──────────┤
//            │     客  厅       餐 厅  门  厨 房  │
//   南  z=5  └──(落地推拉门)────────────┴─────────┘
//          x=-8                x=0     x=4       x=8

export const WALL_H = 3.0;      // 层高（墙高）
export const WALL_T = 0.2;      // 墙厚
export const EXT = { x0: -8, x1: 8, z0: -5, z1: 5 };

// 房间：id、名称、范围、地面材质、类型（用于环境模拟和热力图）
export const ROOMS = [
  { id: 'master', name: '主卧', x0: -8, x1: -3, z0: -5, z1: -1, floor: 'woodFloor' },
  { id: 'bath', name: '卫生间', x0: -3, x1: -0.5, z0: -5, z1: -1, floor: 'bathTile' },
  { id: 'kid', name: '儿童房', x0: -0.5, x1: 4, z0: -5, z1: -1, floor: 'woodFloor' },
  { id: 'elder', name: '老人房', x0: 4, x1: 8, z0: -5, z1: -1, floor: 'woodFloor' },
  { id: 'hall', name: '走廊', x0: -8, x1: 8, z0: -1, z1: 0.6, floor: 'tileFloor' },
  { id: 'living', name: '客厅', x0: -8, x1: 0, z0: 0.6, z1: 5, floor: 'tileFloor' },
  { id: 'dining', name: '餐厅', x0: 0, x1: 4, z0: 0.6, z1: 5, floor: 'tileFloor' },
  { id: 'kitchen', name: '厨房', x0: 4, x1: 8, z0: 0.6, z1: 5, floor: 'bathTile' },
];

export function roomById(id) {
  return ROOMS.find((r) => r.id === id);
}

/** 点 (x,z) 所在的房间（在墙中心线围成的矩形内），不在室内返回 null */
export function roomAt(x, z) {
  return ROOMS.find((r) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) ?? null;
}

export function roomCenter(r) {
  return { x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 };
}

// 墙：从 (x1,z1) 到 (x2,z2) 的轴对齐线段。
// openings: 洞口，a/b 为沿墙方向的起止坐标（x 或 z），bottom/top 为洞口底部/顶部高度，
//           kind: 'window' | 'door' | 'slide'（推拉门）| 'opening'（空洞，无门扇），id 用于交互
// exterior: 外墙朝外的一侧（'+x' '-x' '+z' '-z'），用于外墙面贴石材
export const WALLS = [
  // 外墙
  { id: 'wN', x1: -8, z1: -5, x2: 8, z2: -5, exterior: '-z', openings: [
    { a: -6.5, b: -4.5, bottom: 0.9, top: 2.3, kind: 'window', id: 'win-master-n', room: 'master' },
    { a: -2.2, b: -1.3, bottom: 1.5, top: 2.3, kind: 'window', id: 'win-bath', room: 'bath' },
    { a: 0.7, b: 2.7, bottom: 0.9, top: 2.3, kind: 'window', id: 'win-kid', room: 'kid' },
    { a: 5.0, b: 7.0, bottom: 0.9, top: 2.3, kind: 'window', id: 'win-elder', room: 'elder' },
  ] },
  { id: 'wS', x1: -8, z1: 5, x2: 8, z2: 5, exterior: '+z', openings: [
    { a: -6.4, b: -2.4, bottom: 0, top: 2.5, kind: 'slide', id: 'door-living', room: 'living', exit: true },
    { a: 0.6, b: 3.4, bottom: 0.8, top: 2.4, kind: 'window', id: 'win-dining', room: 'dining' },
    { a: 5.2, b: 7.2, bottom: 1.0, top: 2.3, kind: 'window', id: 'win-kitchen-s', room: 'kitchen' },
  ] },
  { id: 'wW', x1: -8, z1: -5, x2: -8, z2: 5, exterior: '-x', openings: [
    { a: -3.8, b: -2.2, bottom: 0.9, top: 2.3, kind: 'window', id: 'win-master-w', room: 'master' },
    { a: -0.75, b: 0.35, bottom: 0, top: 2.3, kind: 'door', id: 'door-entry', room: 'hall', exit: true, hinge: 'a', swing: -1 },
    { a: 1.8, b: 3.8, bottom: 0.9, top: 2.3, kind: 'window', id: 'win-living-w', room: 'living' },
  ] },
  { id: 'wE', x1: 8, z1: -5, x2: 8, z2: 5, exterior: '+x', openings: [
    { a: -3.8, b: -2.2, bottom: 0.9, top: 2.3, kind: 'window', id: 'win-elder-e', room: 'elder' },
    { a: -0.7, b: 0.3, bottom: 0, top: 2.3, kind: 'door', id: 'door-back', room: 'hall', exit: true, hinge: 'a', swing: 1 },
    { a: 2.0, b: 4.0, bottom: 1.0, top: 2.3, kind: 'window', id: 'win-kitchen-e', room: 'kitchen' },
  ] },
  // 内墙：北侧房间与走廊之间
  { id: 'wHall', x1: -8, z1: -1, x2: 8, z2: -1, openings: [
    { a: -4.3, b: -3.3, bottom: 0, top: 2.2, kind: 'door', id: 'door-master', room: 'master', hinge: 'b', swing: 1 },
    { a: -2.0, b: -1.0, bottom: 0, top: 2.2, kind: 'door', id: 'door-bath', room: 'bath', hinge: 'a', swing: 1 },
    { a: 2.8, b: 3.8, bottom: 0, top: 2.2, kind: 'door', id: 'door-kid', room: 'kid', hinge: 'b', swing: 1 },
    { a: 4.4, b: 5.4, bottom: 0, top: 2.2, kind: 'door', id: 'door-elder', room: 'elder', hinge: 'a', swing: 1 },
  ] },
  // 北侧房间之间的隔墙
  { id: 'wMB', x1: -3, z1: -5, x2: -3, z2: -1, openings: [] },
  { id: 'wBK', x1: -0.5, z1: -5, x2: -0.5, z2: -1, openings: [] },
  { id: 'wKE', x1: 4, z1: -5, x2: 4, z2: -1, openings: [] },
  // 厨房：西墙上是防火门（通往餐厅），北墙与走廊隔开
  { id: 'wKit', x1: 4, z1: 0.6, x2: 4, z2: 5, openings: [
    { a: 1.1, b: 2.1, bottom: 0, top: 2.2, kind: 'door', id: 'door-kitchen', room: 'kitchen', hinge: 'a', swing: 1, fireDoor: true },
  ] },
  { id: 'wKitN', x1: 4, z1: 0.6, x2: 8, z2: 0.6, openings: [] },
];

// 安全出口（室外一侧的集合点），疏散路径规划的目标
export const EXITS = [
  { id: 'door-entry', name: '入户门', x: -9.6, z: -0.2 },
  { id: 'door-living', name: '客厅落地门', x: -4.4, z: 7.0 },
  { id: 'door-back', name: '后门', x: 9.6, z: -0.2 },
];
