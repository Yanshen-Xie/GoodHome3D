import * as THREE from 'three';
import { box, cylinder, uniqueMat } from '../common.js';
import type { LightPool } from '../../systems/lightPool.js';
import {
  DEVICE_CAPABILITY,
  MODULE_CAPABILITY,
} from '../../modules/contracts';
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

export interface HouseLightCoveBounds {
  readonly x0: number;
  readonly x1: number;
  readonly z0: number;
  readonly z1: number;
}

interface HouseLightConfigBase {
  readonly kind: 'light';
  readonly id: string;
  readonly room: string;
  readonly name: string;
  readonly floor: number;
  /** World-space x and z for the ceiling fixture. */
  readonly position: readonly [number, number];
  readonly initialOn?: boolean;
  readonly initialBrightness?: number;
  readonly initialColorTemperature?: number;
}

export type HouseLightConfig = HouseLightConfigBase & (
  | { readonly fixture: 'ceiling' }
  | { readonly fixture: 'pendant'; readonly pendantDrop?: number }
  | { readonly fixture: 'cove'; readonly coveBounds: HouseLightCoveBounds }
);

/** The factory receives only the services needed by a single house light. */
export interface HouseLightFactoryContext {
  readonly lightPool: LightPool;
  readonly ceilingY: (floor: number) => number;
}

function validateConfig(config: HouseLightConfig): void {
  if (!config.id.trim()) throw new Error('House light id must not be empty');
  if (!Number.isInteger(config.floor) || config.floor < 0) {
    throw new Error('House light floor must be a non-negative integer: ' + config.id);
  }
  if (!config.name.trim() || !config.room.trim()) {
    throw new Error('House light name and room are required: ' + config.id);
  }
  if (!config.position.every(Number.isFinite)) {
    throw new Error('House light position must contain finite coordinates: ' + config.id);
  }
  if (config.initialBrightness !== undefined
      && (!Number.isFinite(config.initialBrightness) || config.initialBrightness < 0.1 || config.initialBrightness > 1)) {
    throw new Error('House light brightness must be between 0.1 and 1: ' + config.id);
  }
  if (config.initialColorTemperature !== undefined
      && (!Number.isFinite(config.initialColorTemperature) || config.initialColorTemperature < 2700 || config.initialColorTemperature > 6500)) {
    throw new Error('House light color temperature must be between 2700 K and 6500 K: ' + config.id);
  }
  if (config.fixture === 'pendant' && config.pendantDrop !== undefined
      && (!Number.isFinite(config.pendantDrop) || config.pendantDrop <= 0)) {
    throw new Error('Pendant drop must be a positive number: ' + config.id);
  }
  if (config.fixture === 'cove') {
    const { x0, x1, z0, z1 } = config.coveBounds;
    if (![x0, x1, z0, z1].every(Number.isFinite) || x1 <= x0 || z1 <= z0) {
      throw new Error('Cove light requires valid room bounds: ' + config.id);
    }
  }
}

/** Create one independently mountable and controllable light module from typed config. */
export function createHouseLight(
  context: HouseLightFactoryContext,
  config: HouseLightConfig,
): SceneModule {
  validateConfig(config);
  const [x, z] = config.position;
  const ceilingY = context.ceilingY(config.floor);
  if (!Number.isFinite(ceilingY)) throw new Error('Invalid ceiling height for light: ' + config.id);

  const root = new THREE.Group();
  root.name = config.id;
  root.position.set(x, ceilingY, z);

  const shade = uniqueMat({ color: 0xf8f6f0, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
  let sourceLocalY: number;
  if (config.fixture === 'pendant') {
    const drop = config.pendantDrop ?? 0.9;
    root.add(cylinder(0.005, 0.005, drop, 'darkMetal', 0, -drop, 0, 4));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.25, 24, 1, true), shade);
    cone.position.y = -drop;
    root.add(cone);
    sourceLocalY = -drop - 0.2;
  } else {
    const disc = new THREE.Mesh(
      new THREE.CylinderGeometry(config.fixture === 'cove' ? 0.35 : 0.22, 0.3, 0.05, 32),
      shade,
    );
    disc.position.y = -0.03;
    root.add(disc);
    sourceLocalY = -0.35;
  }

  let strip: THREE.MeshStandardMaterial | undefined;
  if (config.fixture === 'cove') {
    strip = uniqueMat({ color: 0xffffff, emissive: 0xffe0b0, emissiveIntensity: 0 });
    const { x0, x1, z0, z1 } = config.coveBounds;
    const drop = 0.15;
    const addBand = (width: number, depth: number, centerX: number, centerZ: number) => {
      root.add(box(width, drop, depth, 'ceiling', centerX - x, -drop, centerZ - z, { cast: false }));
    };
    addBand(x1 - x0, 0.45, (x0 + x1) / 2, z0 + 0.225);
    addBand(x1 - x0, 0.45, (x0 + x1) / 2, z1 - 0.225);
    addBand(0.45, z1 - z0 - 0.9, x0 + 0.225, (z0 + z1) / 2);
    addBand(0.45, z1 - z0 - 0.9, x1 - 0.225, (z0 + z1) / 2);
    const addLed = (width: number, depth: number, centerX: number, centerZ: number) => {
      root.add(box(width, 0.02, depth, strip!, centerX - x, -drop - 0.005, centerZ - z, { cast: false }));
    };
    addLed(x1 - x0 - 0.9, 0.03, (x0 + x1) / 2, z0 + 0.45);
    addLed(x1 - x0 - 0.9, 0.03, (x0 + x1) / 2, z1 - 0.45);
    addLed(0.03, z1 - z0 - 0.9, x0 + 0.45, (z0 + z1) / 2);
    addLed(0.03, z1 - z0 - 0.9, x1 - 0.45, (z0 + z1) / 2);
  }

  const lamp = context.lightPool.add({
    position: new THREE.Vector3(x, ceilingY + sourceLocalY, z),
    distance: config.room.startsWith('hall') ? 7 : 9,
  });
  const info: ModuleInfo = {
    name: config.name,
    category: '智能照明',
    room: config.room,
    floor: config.floor,
    status: 'normal',
    func: '可调亮度与色温（2700K 暖光 ~ 6500K 冷光），支持人体感应自动开关和场景联动'
      + (config.fixture === 'cove' ? '；吊顶灯槽内嵌 LED 灯带，提供柔和的间接照明' : ''),
    data: {
      状态: config.initialOn ? '开' : '关',
      亮度: Math.round((config.initialBrightness ?? 0.8) * 100) + '%',
      色温: (config.initialColorTemperature ?? 4000) + ' K',
    },
  };
  info.deviceId = config.id;
  root.userData.info = info;
  root.userData.deviceId = config.id;

  let on = config.initialOn ?? false;
  let brightness = config.initialBrightness ?? 0.8;
  let colorTemperature = config.initialColorTemperature ?? 4000;
  let status: DeviceStatus = 'normal';
  let module: SceneModule;
  const applyVisualState = () => {
    const color = kelvinToColor(colorTemperature);
    lamp.color.copy(color);
    lamp.intensity = on
      ? brightness * (config.room === 'living' || config.room === 'family' ? 26 : config.room.startsWith('hall') ? 10 : 16)
      : 0;
    shade.emissive.copy(color);
    shade.emissiveIntensity = on ? 0.6 + brightness * 2 : 0;
    if (strip) strip.emissiveIntensity = on ? brightness * 3 : 0;
    module.mergeInfoData({
      状态: on ? '开' : '关',
      亮度: Math.round(brightness * 100) + '%',
      色温: colorTemperature + ' K',
    });
  };
  const setOn = (value: boolean) => {
    on = value;
    applyVisualState();
  };
  const setBrightness = (value: number) => {
    brightness = THREE.MathUtils.clamp(value, 0.1, 1);
    applyVisualState();
  };
  const setColorTemperature = (value: number) => {
    colorTemperature = THREE.MathUtils.clamp(value, 2700, 6500);
    applyVisualState();
  };
  const control: BooleanControlCapability = {
    getState: () => on,
    setState: setOn,
  };
  const power: PowerCapability = {
    isOn: () => on,
    setOn,
  };
  const lighting: LightingCapability = {
    ...power,
    getBrightness: () => brightness,
    setBrightness,
    getColorTemperature: () => colorTemperature,
    setColorTemperature,
    getSourcePosition: () => lamp.position.clone(),
    getSourceColor: () => lamp.color.clone(),
  };
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) {
      status = value;
      info.status = value;
    },
  };
  info.controls = [
    { type: 'toggle', label: '开关', get: () => on, set: (value: boolean) => setOn(value) },
    { type: 'range', label: '亮度', min: 0.1, max: 1, step: 0.05, get: () => brightness, set: (value: number) => setBrightness(value) },
    { type: 'range', label: '色温 (K)', min: 2700, max: 6500, step: 100, get: () => colorTemperature, set: (value: number) => setColorTemperature(value) },
  ];

  const localSourcePosition = new THREE.Vector3(0, sourceLocalY, 0);
  const worldSourcePosition = new THREE.Vector3();
  const updateSourcePosition = () => {
    root.updateWorldMatrix(true, false);
    worldSourcePosition.copy(localSourcePosition);
    root.localToWorld(worldSourcePosition);
    lamp.position.copy(worldSourcePosition);
  };
  module = new SceneModule({
    id: config.id,
    kind: 'device',
    root,
    info,
    update: updateSourcePosition,
    dispose: () => { context.lightPool.remove(lamp); },
    disposeResources: true,
    capabilities: [
      [MODULE_CAPABILITY.control, control],
      [MODULE_CAPABILITY.deviceKind, config.kind],
      [MODULE_CAPABILITY.deviceStatus, deviceStatus],
      [DEVICE_CAPABILITY.power, power],
      [DEVICE_CAPABILITY.lighting, lighting],
    ],
  });
  applyVisualState();
  updateSourcePosition();
  return module;
}

/** Adapter for the shared module catalog, with the light-pool service bound at registration time. */
export function houseLightDefinition(
  factoryContext: HouseLightFactoryContext,
): SceneModuleDefinition<HouseLightConfig> {
  return {
    id: 'house-light',
    kind: 'device',
    create: (_context, config) => createHouseLight(factoryContext, config),
  };
}
