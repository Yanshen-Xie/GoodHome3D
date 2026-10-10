import * as THREE from 'three';
import { box } from '../common.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import type {
  BooleanControlCapability,
  DeviceStatus,
  DeviceStatusCapability,
  DisplayCapability,
  ModuleInfo,
  PowerCapability,
  SceneModuleDefinition,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';

export interface HouseTelevisionConfig {
  readonly kind: 'television';
  readonly id: string;
  readonly room: string;
  readonly floor: number;
  readonly name: string;
  readonly position: readonly [number, number, number];
  readonly initialOn?: boolean;
}

export function createHouseTelevision(config: HouseTelevisionConfig): SceneModule {
  if (config.kind !== 'television') throw new Error('Television factory requires kind "television": ' + config.id);
  if (!config.id.trim() || !config.name.trim() || !config.room.trim()) {
    throw new Error('Television id, name and room are required');
  }
  if (!config.position.every(Number.isFinite)) throw new Error('Television position must be finite: ' + config.id);

  const root = new THREE.Group();
  root.name = config.id;
  root.position.set(...config.position);
  root.add(box(0.05, 0.9, 1.6, 'blackPlastic'));
  const screenMaterial = new THREE.MeshStandardMaterial({
    color: 0x050608,
    roughness: 0.2,
    emissive: 0xffffff,
    emissiveIntensity: 0,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.84), screenMaterial);
  screen.rotation.y = -Math.PI / 2;
  screen.position.set(-0.03, 0.45, 0);
  root.add(screen);

  const info: ModuleInfo = {
    name: config.name,
    category: '影音设备 / 智慧家居',
    room: config.room,
    floor: config.floor,
    status: 'normal',
    func: '支持观影场景联动，可接入动态节目画面',
    data: { 状态: config.initialOn ? '播放中' : '关闭' },
  };
  info.deviceId = config.id;
  root.userData.deviceId = config.id;
  root.userData.info = info;

  let on = config.initialOn ?? false;
  let status: DeviceStatus = 'normal';
  const setOn = (value: boolean) => {
    on = value;
    screenMaterial.emissiveIntensity = on ? 1.2 : 0;
    screenMaterial.color.setHex(on ? 0xffffff : 0x050608);
    module.mergeInfoData({ 状态: on ? '播放中' : '关闭' });
  };
  const control: BooleanControlCapability = {
    getState: () => on,
    setState: setOn,
  };
  const power: PowerCapability = {
    isOn: () => on,
    setOn,
  };
  const display: DisplayCapability = {
    setTexture(texture) {
      screenMaterial.emissiveMap = texture;
      screenMaterial.map = texture;
      screenMaterial.needsUpdate = true;
    },
  };
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) { status = value; info.status = value; },
  };
  info.controls = [
    { type: 'toggle', label: '开关', get: () => on, set: (value: boolean) => setOn(value) },
  ];

  const module = new SceneModule({
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
      [DEVICE_CAPABILITY.display, display],
      ['setTexture', display.setTexture],
    ],
  });
  setOn(on);
  return module;
}

export function houseTelevisionDefinition(): SceneModuleDefinition<HouseTelevisionConfig> {
  return {
    id: 'house-television',
    kind: 'device',
    create: (_context, config) => createHouseTelevision(config),
  };
}
