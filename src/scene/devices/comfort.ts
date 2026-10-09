import { INDOOR_ROOMS } from '../layout.js';
import type { DeviceAssemblyContext } from '../deviceAssemblyContext.js';
import { createHouseLight } from './houseLight.js';
import type { HouseLightConfig, HouseLightCoveBounds } from './houseLight.js';
import { createHouseTelevision } from './houseTelevision.js';
import type { HouseTelevisionConfig } from './houseTelevision.js';
import { createHouseCurtain } from './houseCurtain.js';
import type { HouseCurtainConfig } from './houseCurtain.js';
import { createHouseAirConditioner } from './houseAirConditioner.js';
import type { HouseAirConditionerConfig } from './houseAirConditioner.js';
import { createHouseFloorLamp } from './houseFloorLamp.js';
import type { HouseFloorLampConfig } from './houseFloorLamp.js';
import { createHouseNightLight } from './houseNightLight.js';
import type { HouseNightLightConfig } from './houseNightLight.js';
import { createHouseFreshAir } from './houseFreshAir.js';
import type { HouseFreshAirConfig } from './houseFreshAir.js';

function houseLightBounds(roomId: string): HouseLightCoveBounds {
  const room = INDOOR_ROOMS.find((candidate) => candidate.id === roomId);
  if (!room) throw new Error('Unknown room for cove light: ' + roomId);
  return { x0: room.x0, x1: room.x1, z0: room.z0, z1: room.z1 };
}

const HOUSE_LIGHTS: readonly HouseLightConfig[] = [
  { kind: 'light', id: 'light-elder', room: 'elder', name: '老人房吸顶灯', floor: 0, position: [-5.6, -3.0], fixture: 'ceiling' },
  { kind: 'light', id: 'light-bath1', room: 'bath1', name: '卫生间灯', floor: 0, position: [-1.9, -2.2], fixture: 'ceiling' },
  { kind: 'light', id: 'light-utility', room: 'utility', name: '设备间灯', floor: 0, position: [5.7, -3.0], fixture: 'ceiling' },
  { kind: 'light', id: 'light-hall1-w', room: 'hall1', name: '门厅灯（西）', floor: 0, position: [-4.5, -0.2], fixture: 'ceiling' },
  { kind: 'light', id: 'light-hall1-e', room: 'hall1', name: '门厅灯（东）', floor: 0, position: [4.0, -0.2], fixture: 'ceiling' },
  { kind: 'light', id: 'light-living', room: 'living', name: '客厅主灯 + 灯槽', floor: 0, position: [-5.3, 2.8], fixture: 'cove', coveBounds: houseLightBounds('living') },
  { kind: 'light', id: 'light-dining', room: 'dining', name: '餐厅吊灯', floor: 0, position: [1.1, 2.9], fixture: 'pendant' },
  { kind: 'light', id: 'light-kitchen', room: 'kitchen', name: '厨房灯', floor: 0, position: [5.6, 2.8], fixture: 'ceiling' },
  { kind: 'light', id: 'light-stair', room: 'stair2', name: '楼梯间吊灯', floor: 1, position: [2.6, -2.4], fixture: 'pendant', pendantDrop: 1.2 },
  { kind: 'light', id: 'light-master', room: 'master', name: '主卧吸顶灯 + 灯槽', floor: 1, position: [-5.3, -3.0], fixture: 'cove', coveBounds: houseLightBounds('master') },
  { kind: 'light', id: 'light-bath2', room: 'bath2', name: '二层卫生间灯', floor: 1, position: [-1.6, -2.4], fixture: 'ceiling' },
  { kind: 'light', id: 'light-kid', room: 'kid', name: '儿童房吸顶灯', floor: 1, position: [5.7, -3.0], fixture: 'ceiling' },
  { kind: 'light', id: 'light-hall2-w', room: 'hall2', name: '二层走廊灯（西）', floor: 1, position: [-4.5, -0.2], fixture: 'ceiling' },
  { kind: 'light', id: 'light-hall2-e', room: 'hall2', name: '二层走廊灯（东）', floor: 1, position: [4.0, -0.2], fixture: 'ceiling' },
  { kind: 'light', id: 'light-study', room: 'study', name: '书房灯', floor: 1, position: [-5.8, 2.8], fixture: 'ceiling' },
  { kind: 'light', id: 'light-family', room: 'family', name: '起居室主灯 + 灯槽', floor: 1, position: [-0.2, 2.8], fixture: 'cove', coveBounds: houseLightBounds('family') },
  { kind: 'light', id: 'light-guest', room: 'guest', name: '客房灯', floor: 1, position: [5.6, 2.8], fixture: 'ceiling' },
];

const HOUSE_TELEVISION: HouseTelevisionConfig = {
  kind: 'television', id: 'tv', room: 'living', floor: 0, name: '客厅智能电视', position: [-3.26, 0.95, 2.8],
};

const HOUSE_CURTAINS: readonly HouseCurtainConfig[] = [
  { kind: 'curtain', id: 'curtain-elder', room: 'elder', name: '老人房窗帘', floor: 0, wallZ: -4.84, span: [-6.5, -4.5] },
  { kind: 'curtain', id: 'curtain-living', room: 'living', name: '客厅电动窗帘', floor: 0, wallZ: 4.84, span: [-6.6, -2.6] },
  { kind: 'curtain', id: 'curtain-dining', room: 'dining', name: '餐厅窗帘', floor: 0, wallZ: 4.84, span: [0.2, 2.4] },
  { kind: 'curtain', id: 'curtain-master', room: 'master', name: '主卧窗帘', floor: 1, wallZ: -4.84, span: [-6.4, -4.4] },
  { kind: 'curtain', id: 'curtain-kid', room: 'kid', name: '儿童房窗帘', floor: 1, wallZ: -4.84, span: [5.0, 7.0] },
  { kind: 'curtain', id: 'curtain-study', room: 'study', name: '书房窗帘', floor: 1, wallZ: 4.84, span: [-7.0, -5.0] },
  { kind: 'curtain', id: 'curtain-family', room: 'family', name: '起居室电动窗帘', floor: 1, wallZ: 4.84, span: [-2.8, 1.6] },
  { kind: 'curtain', id: 'curtain-guest', room: 'guest', name: '客房窗帘', floor: 1, wallZ: 4.84, span: [4.6, 6.6] },
];

const HOUSE_AIR_CONDITIONERS: readonly HouseAirConditionerConfig[] = [
  { kind: 'airConditioner', id: 'ac-living', room: 'living', name: '客厅空调', floor: 0, position: [-7.86, 2.8], facing: '+x' },
  { kind: 'airConditioner', id: 'ac-elder', room: 'elder', name: '老人房空调', floor: 0, position: [-3.34, -2.0], facing: '-x' },
  { kind: 'airConditioner', id: 'ac-master', room: 'master', name: '主卧空调', floor: 1, position: [-2.74, -1.9], facing: '-x' },
  { kind: 'airConditioner', id: 'ac-kid', room: 'kid', name: '儿童房空调', floor: 1, position: [3.54, -2.2], facing: '+x' },
  { kind: 'airConditioner', id: 'ac-study', room: 'study', name: '书房空调', floor: 1, position: [-3.74, 1.1], facing: '-x' },
  { kind: 'airConditioner', id: 'ac-family', room: 'family', name: '起居室空调', floor: 1, position: [-3.46, 4.3], facing: '+x' },
  { kind: 'airConditioner', id: 'ac-guest', room: 'guest', name: '客房空调', floor: 1, position: [7.86, 1.8], facing: '-x' },
];

const HOUSE_FLOOR_LAMP: HouseFloorLampConfig = {
  kind: 'light', id: 'lamp-floor', room: 'living', floor: 0, name: '落地灯', position: [-7.5, 0, 1.28],
};

const HOUSE_NIGHT_LIGHT: HouseNightLightConfig = {
  kind: 'nightLight',
  id: 'night-light',
  room: 'elder',
  floor: 0,
  name: '夜间感应地脚灯',
  segments: [[-4.8, -3.6, -1.15], [-7.8, -0.8, -0.86], [-6.1, -4.9, -2.7]],
};

const HOUSE_FRESH_AIR: HouseFreshAirConfig = {
  kind: 'freshAir',
  id: 'fresh-air',
  room: 'utility',
  floor: 0,
  name: '全热交换新风系统',
  outlets: [
    { x: -6.2, z: -2.2, room: 'elder', floor: 0 },
    { x: -4.0, z: 1.6, room: 'living', floor: 0 },
    { x: 1.0, z: 1.6, room: 'dining', floor: 0 },
    { x: -1.6, z: -3.9, room: 'bath1', floor: 0 },
    { x: -6.4, z: -2.2, room: 'master', floor: 1 },
    { x: 6.8, z: -2.2, room: 'kid', floor: 1 },
    { x: -6.6, z: 1.6, room: 'study', floor: 1 },
    { x: -0.2, z: 1.6, room: 'family', floor: 1 },
    { x: 6.4, z: 3.8, room: 'guest', floor: 1 },
  ],
  hostPosition: [6.8, 0, -4.4],
};

export function buildComfortDevices(context: DeviceAssemblyContext): void {
  const { registerModule, lightPool, facing, floorY, ceilingY } = context;
  const lightContext = { lightPool, ceilingY };
  for (const config of HOUSE_LIGHTS) {
    registerModule(createHouseLight(lightContext, config), {
      type: config.kind, room: config.room, floor: config.floor,
    });
  }
  registerModule(createHouseTelevision(HOUSE_TELEVISION), {
    type: 'tv', kind: HOUSE_TELEVISION.kind, room: HOUSE_TELEVISION.room, floor: HOUSE_TELEVISION.floor,
  });
  const curtainContext = { floorY };
  for (const config of HOUSE_CURTAINS) {
    registerModule(createHouseCurtain(curtainContext, config), {
      type: config.kind, room: config.room, floor: config.floor,
    });
  }
  const airConditionerContext = { floorY, facing };
  for (const config of HOUSE_AIR_CONDITIONERS) {
    registerModule(createHouseAirConditioner(airConditionerContext, config), {
      type: 'ac', kind: config.kind, room: config.room, floor: config.floor,
    });
  }
  registerModule(createHouseFloorLamp(HOUSE_FLOOR_LAMP), {
    type: 'lamp', kind: HOUSE_FLOOR_LAMP.kind, room: HOUSE_FLOOR_LAMP.room, floor: HOUSE_FLOOR_LAMP.floor,
  });
  registerModule(createHouseNightLight(HOUSE_NIGHT_LIGHT), {
    type: HOUSE_NIGHT_LIGHT.kind, room: HOUSE_NIGHT_LIGHT.room, floor: HOUSE_NIGHT_LIGHT.floor,
  });
  registerModule(createHouseFreshAir({ ceilingY }, HOUSE_FRESH_AIR), {
    type: HOUSE_FRESH_AIR.kind, room: HOUSE_FRESH_AIR.room, floor: HOUSE_FRESH_AIR.floor,
  });
}
