import * as THREE from 'three';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import type {
  BooleanControlCapability,
  DeviceStatus,
  DeviceStatusCapability,
  ModuleInfo,
  PowerCapability,
  SceneModuleDefinition,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';

export interface HouseNightLightConfig {
  readonly kind: 'nightLight';
  readonly id: string;
  readonly room: string;
  readonly floor: number;
  readonly name: string;
  readonly segments: readonly (readonly [number, number, number])[];
  readonly initialOn?: boolean;
}

export function createHouseNightLight(config: HouseNightLightConfig): SceneModule {
  if (config.kind !== 'nightLight') throw new Error('Night light factory requires kind "nightLight": ' + config.id);
  if (!config.id.trim() || !config.name.trim() || !config.room.trim()) {
    throw new Error('Night light id, name and room are required');
  }
  if (config.segments.length === 0 || config.segments.some(([x0, x1, z]) =>
    ![x0, x1, z].every(Number.isFinite) || x1 <= x0)) {
    throw new Error('Night light requires valid illuminated segments: ' + config.id);
  }

  const root = new THREE.Group();
  root.name = config.id;
  const material = new THREE.MeshStandardMaterial({
    color: 0x333333,
    emissive: 0xffb866,
    emissiveIntensity: 0,
  });
  for (const [x0, x1, z] of config.segments) {
    const segment = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.02, 0.02), material);
    segment.position.set((x0 + x1) / 2, 0.25, z);
    root.add(segment);
  }
  const info: ModuleInfo = {
    name: config.name,
    category: '适老无障碍 / 智能照明',
    room: config.room,
    floor: config.floor,
    status: 'normal',
    func: '夜间起床时自动点亮床边至卫生间的低位灯带，亮度柔和不刺眼',
    data: { 状态: config.initialOn ? '开' : '关' },
  };
  info.deviceId = config.id;
  root.userData.deviceId = config.id;
  root.userData.info = info;
  let on = config.initialOn ?? false;
  let status: DeviceStatus = 'normal';
  let module: SceneModule;
  const setOn = (value: boolean) => {
    on = value;
    material.emissiveIntensity = on ? 2.5 : 0;
    module.mergeInfoData({ 状态: on ? '开' : '关' });
  };
  const power: PowerCapability = { isOn: () => on, setOn };
  const control: BooleanControlCapability = { getState: () => on, setState: setOn };
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) { status = value; info.status = value; },
  };
  info.controls = [
    { type: 'toggle', label: '开关', get: () => on, set: (value: boolean) => setOn(value) },
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
    ],
  });
  setOn(on);
  return module;
}

export function houseNightLightDefinition(): SceneModuleDefinition<HouseNightLightConfig> {
  return {
    id: 'house-night-light',
    kind: 'device',
    create: (_context, config) => createHouseNightLight(config),
  };
}
