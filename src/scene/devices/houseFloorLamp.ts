import * as THREE from 'three';
import { cylinder } from '../common.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import type {
  BooleanControlCapability,
  DeviceStatus,
  DeviceStatusCapability,
  LightingCapability,
  ModuleInfo,
  PowerCapability,
  SceneModuleDefinition,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';
import { kelvinToColor } from './deviceVisuals.js';

export interface HouseFloorLampConfig {
  readonly kind: 'light';
  readonly id: string;
  readonly room: string;
  readonly floor: number;
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly initialOn?: boolean;
  readonly initialBrightness?: number;
  readonly initialColorTemperature?: number;
}

export function createHouseFloorLamp(config: HouseFloorLampConfig): SceneModule {
  if (!config.id.trim() || !config.name.trim() || !config.room.trim()) {
    throw new Error('Floor lamp id, name and room are required');
  }
  if (!config.position.every(Number.isFinite)) throw new Error('Floor lamp position must be finite: ' + config.id);
  const initialBrightness = config.initialBrightness ?? 1;
  const initialColorTemperature = config.initialColorTemperature ?? 3000;
  if (initialBrightness < 0.1 || initialBrightness > 1 || !Number.isFinite(initialBrightness)) {
    throw new Error('Floor lamp brightness must be between 0.1 and 1: ' + config.id);
  }
  if (initialColorTemperature < 2700 || initialColorTemperature > 6500 || !Number.isFinite(initialColorTemperature)) {
    throw new Error('Floor lamp color temperature must be between 2700 K and 6500 K: ' + config.id);
  }

  const root = new THREE.Group();
  root.name = config.id;
  root.position.set(...config.position);
  const shade = new THREE.MeshStandardMaterial({
    color: 0xf3ead8,
    emissive: kelvinToColor(initialColorTemperature),
    emissiveIntensity: 0,
    roughness: 0.9,
    side: THREE.DoubleSide,
  });
  root.add(
    cylinder(0.15, 0.15, 0.03, 'darkMetal'),
    cylinder(0.015, 0.015, 1.5, 'darkMetal', 0, 0.03, 0, 8),
    cylinder(0.14, 0.2, 0.25, shade, 0, 1.45, 0),
  );

  const info: ModuleInfo = {
    name: config.name,
    category: '照明',
    room: config.room,
    floor: config.floor,
    status: 'normal',
    func: '独立阅读灯模块；可由观影 / 阅读场景控制',
    data: { 状态: config.initialOn ? '开' : '关', 亮度: Math.round(initialBrightness * 100) + '%', 色温: initialColorTemperature + ' K' },
  };
  info.deviceId = config.id;
  root.userData.deviceId = config.id;
  root.userData.info = info;
  let on = config.initialOn ?? false;
  let brightness = initialBrightness;
  let colorTemperature = initialColorTemperature;
  let status: DeviceStatus = 'normal';
  let module: SceneModule;
  const apply = () => {
    shade.emissive.copy(kelvinToColor(colorTemperature));
    shade.emissiveIntensity = on ? brightness * 1.5 : 0;
    module.mergeInfoData({
      状态: on ? '开' : '关',
      亮度: Math.round(brightness * 100) + '%',
      色温: colorTemperature + ' K',
    });
  };
  const setOn = (value: boolean) => { on = value; apply(); };
  const setBrightness = (value: number) => {
    brightness = THREE.MathUtils.clamp(value, 0.1, 1);
    apply();
  };
  const setColorTemperature = (value: number) => {
    colorTemperature = THREE.MathUtils.clamp(value, 2700, 6500);
    apply();
  };
  const power: PowerCapability = { isOn: () => on, setOn };
  const lighting: LightingCapability = {
    ...power,
    getBrightness: () => brightness,
    setBrightness,
    getColorTemperature: () => colorTemperature,
    setColorTemperature,
    getSourcePosition: () => root.localToWorld(new THREE.Vector3(0, 1.45, 0)),
    getSourceColor: () => shade.emissive.clone(),
  };
  const control: BooleanControlCapability = { getState: () => on, setState: setOn };
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) { status = value; info.status = value; },
  };
  info.controls = [
    { type: 'toggle', label: '开关', get: () => on, set: (value: boolean) => setOn(value) },
    { type: 'range', label: '亮度', min: 0.1, max: 1, step: 0.05, get: () => brightness, set: (value: number) => setBrightness(value) },
    { type: 'range', label: '色温 (K)', min: 2700, max: 6500, step: 100, get: () => colorTemperature, set: (value: number) => setColorTemperature(value) },
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
      [DEVICE_CAPABILITY.lighting, lighting],
    ],
  });
  apply();
  return module;
}

export function houseFloorLampDefinition(): SceneModuleDefinition<HouseFloorLampConfig> {
  return {
    id: 'house-floor-lamp',
    kind: 'device',
    create: (_context, config) => createHouseFloorLamp(config),
  };
}
