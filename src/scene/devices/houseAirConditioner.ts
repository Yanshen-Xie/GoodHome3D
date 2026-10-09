import * as THREE from 'three';
import { box } from '../common.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import type {
  BooleanControlCapability,
  ClimateCapability,
  DeviceStatus,
  DeviceStatusCapability,
  ModuleInfo,
  PowerCapability,
  SceneModuleDefinition,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';
import type { DeviceFacing } from '../deviceAssemblyContext.js';
import { STATUS_COLOR, statusLed } from './deviceVisuals.js';

export interface HouseAirConditionerConfig {
  readonly kind: 'airConditioner';
  readonly id: string;
  readonly room: string;
  readonly name: string;
  readonly floor: number;
  readonly position: readonly [number, number];
  readonly facing: DeviceFacing;
  readonly initialOn?: boolean;
  readonly initialSetpoint?: number;
}

export interface HouseAirConditionerFactoryContext {
  readonly floorY: (floor: number) => number;
  readonly facing: Readonly<Record<DeviceFacing, number>>;
}

export function createHouseAirConditioner(
  context: HouseAirConditionerFactoryContext,
  config: HouseAirConditionerConfig,
): SceneModule {
  if (!config.id.trim() || !config.room.trim() || !config.name.trim()) {
    throw new Error('Air conditioner id, name and room are required');
  }
  if (!config.position.every(Number.isFinite)) {
    throw new Error('Air conditioner position must be finite: ' + config.id);
  }
  const setpoint = config.initialSetpoint ?? 26;
  if (!Number.isFinite(setpoint) || setpoint < 16 || setpoint > 30) {
    throw new Error('Air conditioner setpoint must be between 16 C and 30 C: ' + config.id);
  }
  const [x, z] = config.position;
  const floorY = context.floorY(config.floor);
  if (!Number.isFinite(floorY)) throw new Error('Air conditioner floor height is invalid: ' + config.id);

  const root = new THREE.Group();
  root.name = config.id;
  root.position.set(x, floorY + 2.45, z);
  root.rotation.y = context.facing[config.facing];
  root.add(box(0.9, 0.28, 0.2, 'whiteGloss', 0, 0, 0.1, { rounded: 0.04 }));
  root.add(box(0.75, 0.02, 0.01, 'darkMetal', 0, 0.04, 0.2, { cast: false }));
  const led = statusLed(0.012);
  led.position.set(0.35, 0.2, 0.205);
  root.add(led);

  const info: ModuleInfo = {
    name: config.name,
    category: '空调 / 节能',
    room: config.room,
    floor: config.floor,
    status: 'normal',
    func: '一级能效变频空调，与门窗联动：开窗时自动暂停',
    maintain: '滤网清洗：2026-06',
    data: { 状态: config.initialOn ? '运行' : '关闭', 设定温度: setpoint + ' ℃', 能效等级: '1 级' },
  };
  info.deviceId = config.id;
  root.userData.deviceId = config.id;
  root.userData.info = info;
  let on = config.initialOn ?? false;
  let target = setpoint;
  let status: DeviceStatus = 'normal';
  let module: SceneModule;
  const setOn = (value: boolean) => {
    on = value;
    led.material.emissive.setHex(on ? 0x3fa9f5 : STATUS_COLOR.off);
    module.mergeInfoData({ 状态: on ? '运行' : '关闭' });
  };
  const setSetpoint = (value: number) => {
    target = THREE.MathUtils.clamp(value, 16, 30);
    module.mergeInfoData({ 设定温度: target + ' ℃' });
  };
  const control: BooleanControlCapability = {
    getState: () => on,
    setState: setOn,
  };
  const power: PowerCapability = {
    isOn: () => on,
    setOn,
  };
  const climate: ClimateCapability = {
    ...power,
    getSetpoint: () => target,
    setSetpoint,
    getOutlet: () => ({
      position: root.getWorldPosition(new THREE.Vector3()),
      direction: root.getWorldDirection(new THREE.Vector3()),
    }),
  };
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
    { type: 'range', label: '设定温度', min: 16, max: 30, step: 1, get: () => target, set: (value: number) => setSetpoint(value) },
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
      [DEVICE_CAPABILITY.climate, climate],
    ],
  });
  setOn(on);
  return module;
}

export function houseAirConditionerDefinition(
  factoryContext: HouseAirConditionerFactoryContext,
): SceneModuleDefinition<HouseAirConditionerConfig> {
  return {
    id: 'house-air-conditioner',
    kind: 'device',
    create: (_context, config) => createHouseAirConditioner(factoryContext, config),
  };
}
