import { EXT, ROOF_PITCH } from '../layout.js';
import type { DeviceAssemblyContext, DeviceFacing } from '../deviceAssemblyContext.js';
import {
  createHouseBattery,
  createHouseCharger,
  createHouseHeatPump,
  createHouseInverter,
  createHouseRainFilter,
  createHouseRainSystem,
  createHouseSolarArray,
  createHouseWaterTank,
} from './houseGreenDevices.js';
import type {
  HouseBatteryConfig,
  HouseChargerConfig,
  HouseHeatPumpConfig,
  HouseInverterConfig,
  HouseRainFilterConfig,
  HouseRainSystemConfig,
  HouseSolarArrayConfig,
  HouseWaterTankConfig,
} from './houseGreenDevices.js';

function pose(position: readonly [number, number, number], facing?: DeviceFacing) {
  return {
    position,
    ...(facing ? { rotation: [0, { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': 0, '-z': Math.PI }[facing], 0] as const } : {}),
  };
}

export function buildGreenDevices(context: DeviceAssemblyContext): void {
  const { assembly, registerModule } = context;
  const pitch = Math.PI * ROOF_PITCH / 180;
  const centerX = -0.34;
  const centerZ = 2.75;
  const ridgeY = assembly.pvRoof?.ridgeY ?? 8.265;
  const panelOffsets = [1.1, 2.75, 4.4].flatMap((s) =>
    Array.from({ length: 10 }, (_, i) => [
      -5.2 + i * 1.08 - centerX,
      -s * Math.tan(pitch) + 0.17,
      s - centerZ,
    ] as const),
  );
  const pv: HouseSolarArrayConfig = {
    kind: 'solarPanel', id: 'pv', name: '屋顶光伏阵列', room: null, floor: 1,
    pose: pose([centerX, ridgeY, centerZ]),
    panelOffsets, panelWidth: 1, panelThickness: 0.04, panelDepth: 1.7, tiltRadians: pitch,
    info: {
      category: '绿色低碳',
      func: '30 块单晶硅组件铺设在南坡屋面，装机 9.9 kWp，倾角 25°。光伏发电 → 逆变器 → 家庭用电 / 储能电池 / 充电桩 / 余电上网',
      maintain: '组件清洗：2026-08',
      data: { 装机容量: '9.9 kWp', 当前功率: '—' },
    },
  };
  registerModule(createHouseSolarArray(pv), { type: 'pv', kind: pv.kind, room: pv.room, floor: pv.floor });

  const inverter: HouseInverterConfig = {
    kind: 'inverter', id: 'inverter', name: '光伏逆变器', room: null, floor: 0,
    pose: pose([8.1, 1.3, -2.0], '+x'),
    info: {
      category: '绿色低碳',
      func: '把光伏板的直流电转换为 220V 交流电，最大转换效率 98%',
      maintain: '2026-09 运行正常',
    },
  };
  registerModule(createHouseInverter(inverter), { type: 'inverter', kind: inverter.kind, room: inverter.room, floor: inverter.floor });

  const battery: HouseBatteryConfig = {
    kind: 'battery', id: 'battery', name: '家用储能电池', room: null, floor: 0,
    pose: pose([8.55, 0, -2.9], '+x'),
    capacityKWh: 10,
    info: {
      category: '绿色低碳',
      func: '白天储存多余光伏电量，夜间放电供家庭使用，减少从电网购电',
    },
  };
  registerModule(createHouseBattery(battery), { type: 'battery', kind: battery.kind, room: battery.room, floor: battery.floor });

  const heatPump: HouseHeatPumpConfig = {
    kind: 'heatPump', id: 'heatpump', name: '空气源热泵热水机', room: null, floor: 0,
    pose: pose([9.3, 0, -4.2], '+x'),
    info: {
      category: '绿色低碳',
      func: '从空气中吸热制取生活热水，能效比 COP≈4，比电热水器省电约 75%',
      data: { COP: '4.1', 水箱温度: '52 ℃' },
    },
  };
  registerModule(createHouseHeatPump(heatPump), { type: 'heatpump', kind: heatPump.kind, room: heatPump.room, floor: heatPump.floor });

  const tank: HouseWaterTankConfig = {
    kind: 'waterTank', id: 'water-tank', name: '热泵热水箱（200L）', room: 'utility', floor: 0,
    pose: pose([7.45, 0, -4.4]), capacityLiters: 200,
    info: {
      category: '绿色低碳',
      func: '储存热泵制取的生活热水，保温层 50mm',
      data: { 水温: '52 ℃' },
    },
  };
  registerModule(createHouseWaterTank(tank), { type: 'tank', kind: tank.kind, room: tank.room, floor: tank.floor });

  const charger: HouseChargerConfig = {
    kind: 'charger', id: 'ev-charger', name: '家用交流充电桩（7kW）', room: null, floor: 0,
    pose: pose([-8.14, 1.0, 4.3], '-x'),
    chargingPowerKW: 7,
    info: {
      category: '绿色低碳',
      func: '为电动汽车充电；可设置"光伏余电优先"，白天用自家光伏发的电充电',
      data: { 状态: '空闲' },
    },
  };
  registerModule(createHouseCharger(charger), { type: 'charger', kind: charger.kind, room: charger.room, floor: charger.floor });

  const rainFilter: HouseRainFilterConfig = {
    kind: 'rainFilter', id: 'rain-filter', name: '雨水初期弃流过滤器', room: null, floor: 0,
    pose: pose([EXT.x1 + 0.35, 0, EXT.z1 + 0.95]),
    info: {
      category: '绿色低碳',
      func: '弃去屋面最初 2mm 较脏的雨水，其余雨水过滤后流入地下蓄水池',
    },
  };
  registerModule(createHouseRainFilter(rainFilter), { type: 'rainFilter', kind: rainFilter.kind, room: rainFilter.room, floor: rainFilter.floor });

  const sprinklerWorldPositions = [[5.5, 8.0], [-10.0, -6.0], [9.8, -7.0]] as const;
  const sprinklerCenter: readonly [number, number, number] = [
    sprinklerWorldPositions.reduce((sum, point) => sum + point[0], 0) / sprinklerWorldPositions.length,
    0,
    sprinklerWorldPositions.reduce((sum, point) => sum + point[1], 0) / sprinklerWorldPositions.length,
  ];
  const rainSystem: HouseRainSystemConfig = {
    kind: 'rainSystem', id: 'rain-system', name: '雨水喷灌系统', room: null, floor: 0,
    pose: pose(sprinklerCenter),
    sprinklers: sprinklerWorldPositions.map(([x, z]) => ({ x: x - sprinklerCenter[0], z: z - sprinklerCenter[2] })),
    info: {
      category: '绿色低碳',
      func: '雨水蓄存后用于庭院喷灌',
    },
  };
  registerModule(createHouseRainSystem(rainSystem), { type: 'rain', kind: rainSystem.kind, room: rainSystem.room, floor: rainSystem.floor });
}
