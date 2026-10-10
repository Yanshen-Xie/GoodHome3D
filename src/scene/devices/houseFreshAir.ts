import * as THREE from 'three';
import { box } from '../common.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import type {
  BooleanControlCapability,
  DeviceStatus,
  DeviceStatusCapability,
  ModuleInfo,
  PowerCapability,
  SceneModuleDefinition,
  VentilationCapability,
  VentilationOutlet,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';
import { STATUS_COLOR, statusLed } from './deviceVisuals.js';

export interface HouseFreshAirOutletConfig {
  readonly x: number;
  readonly z: number;
  readonly room: string;
  readonly floor: number;
}

export interface HouseFreshAirConfig {
  readonly kind: 'freshAir';
  readonly id: string;
  readonly room: string;
  readonly floor: number;
  readonly name: string;
  readonly outlets: readonly HouseFreshAirOutletConfig[];
  readonly hostPosition: readonly [number, number, number];
  readonly initialOn?: boolean;
  readonly initialLevel?: number;
}

export interface HouseFreshAirFactoryContext {
  readonly ceilingY: (floor: number) => number;
}

export function createHouseFreshAir(
  context: HouseFreshAirFactoryContext,
  config: HouseFreshAirConfig,
): SceneModule {
  if (config.kind !== 'freshAir') throw new Error('Fresh-air factory requires kind "freshAir": ' + config.id);
  if (!config.id.trim() || !config.room.trim() || !config.name.trim()) {
    throw new Error('Fresh-air system id, name and room are required');
  }
  if (config.outlets.length === 0 || config.outlets.some((outlet) =>
    ![outlet.x, outlet.z].every(Number.isFinite) || !outlet.room.trim()
      || !Number.isInteger(outlet.floor) || outlet.floor < 0)) {
    throw new Error('Fresh-air system requires valid outlet configurations: ' + config.id);
  }
  if (!config.hostPosition.every(Number.isFinite)) {
    throw new Error('Fresh-air unit position must be finite: ' + config.id);
  }
  const initialLevel = config.initialLevel ?? 2;
  if (!Number.isInteger(initialLevel) || initialLevel < 1 || initialLevel > 3) {
    throw new Error('Fresh-air level must be an integer from 1 to 3: ' + config.id);
  }

  const root = new THREE.Group();
  root.name = config.id;
  for (const outlet of config.outlets) {
    const ceiling = context.ceilingY(outlet.floor);
    if (!Number.isFinite(ceiling)) throw new Error('Fresh-air outlet floor is invalid: ' + config.id);
    root.add(
      box(0.35, 0.02, 0.35, 'plastic', outlet.x, ceiling - 0.03, outlet.z, { cast: false }),
      box(0.28, 0.005, 0.28, 'darkMetal', outlet.x, ceiling - 0.035, outlet.z, { cast: false }),
    );
  }
  const [hostX, hostFloor, hostZ] = config.hostPosition;
  const hostCeiling = context.ceilingY(hostFloor);
  if (!Number.isFinite(hostCeiling)) throw new Error('Fresh-air host floor is invalid: ' + config.id);
  root.add(box(0.9, 0.3, 0.6, 'whiteGloss', hostX, hostCeiling - 0.32, hostZ));
  const led = statusLed(0.02);
  led.position.set(hostX + 0.46, hostCeiling - 0.18, hostZ);
  root.add(led);

  const info: ModuleInfo = {
    name: config.name,
    category: '健康舒适 / 智慧',
    room: config.room,
    floor: config.floor,
    status: 'normal',
    func: '主机在设备间吊顶内，室外新风经 H13 过滤后送入卧室、客厅、书房等，同时排出污浊空气；热回收效率 75%',
    maintain: '滤芯更换：2026-05',
    data: { 状态: config.initialOn ? '运行' : '关闭', 风量档位: initialLevel + ' 档', 额定风量: '350 m³/h' },
  };
  info.deviceId = config.id;
  root.userData.deviceId = config.id;
  root.userData.info = info;
  let on = config.initialOn ?? false;
  let level = initialLevel;
  let status: DeviceStatus = 'normal';
  let module: SceneModule;
  const setOn = (value: boolean) => {
    on = value;
    led.material.emissive.setHex(on ? STATUS_COLOR.normal : STATUS_COLOR.off);
    module.mergeInfoData({ 状态: on ? '运行' : '关闭' });
  };
  const setLevel = (value: number) => {
    level = THREE.MathUtils.clamp(Math.round(value), 1, 3);
    module.mergeInfoData({ 风量档位: level + ' 档' });
  };
  const power: PowerCapability = { isOn: () => on, setOn };
  const ventilation: VentilationCapability = {
    ...power,
    getLevel: () => level,
    setLevel,
    getOutlets: (): readonly VentilationOutlet[] => {
      root.updateWorldMatrix(true, false);
      return config.outlets.map((outlet) => {
        const position = root.localToWorld(new THREE.Vector3(
          outlet.x,
          context.ceilingY(outlet.floor) - 0.05,
          outlet.z,
        ));
        return { x: position.x, y: position.y, z: position.z, room: outlet.room, floor: outlet.floor };
      });
    },
  };
  const control: BooleanControlCapability = { getState: () => on, setState: setOn };
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) {
      status = value;
      info.status = value;
      led.material.emissive.setHex(STATUS_COLOR[status]);
    },
  };
  info.controls = [
    { type: 'toggle', label: '开关', get: () => on, set: (value: boolean) => setOn(value) },
    { type: 'range', label: '风量档位', min: 1, max: 3, step: 1, get: () => level, set: (value: number) => setLevel(value) },
  ];
  module = new SceneModule({
    id: config.id,
    kind: 'device',
    root,
    info,
    disposeResources: true,
    capabilities: [
      [MODULE_CAPABILITY.control, control],
      [MODULE_CAPABILITY.deviceKind, config.kind],
      [MODULE_CAPABILITY.deviceStatus, deviceStatus],
      [DEVICE_CAPABILITY.power, power],
      [DEVICE_CAPABILITY.ventilation, ventilation],
    ],
  });
  setOn(on);
  return module;
}

export function houseFreshAirDefinition(
  factoryContext: HouseFreshAirFactoryContext,
): SceneModuleDefinition<HouseFreshAirConfig> {
  return {
    id: 'house-fresh-air',
    kind: 'device',
    create: (_context, config) => createHouseFreshAir(factoryContext, config),
  };
}
