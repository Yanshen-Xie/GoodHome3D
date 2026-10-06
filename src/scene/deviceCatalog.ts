import * as THREE from 'three';
import { box, setInfo, uniqueMat } from './common.js';
import { MODULE_CAPABILITY } from '../modules/contracts';
import type { BooleanControlCapability, DeviceStatus, DeviceStatusCapability, ModuleFactoryContext, ModuleInfo, SceneModuleDefinition } from '../modules/contracts';
import { SceneModule } from '../modules/runtime.js';

/** One factory per device family currently used by the house scene. */
export const DEVICE_KINDS = [
  'light', 'switch', 'thermostat', 'airConditioner', 'smokeSensor', 'camera', 'extinguisher', 'solarPanel',
  'television', 'nightLight', 'curtain', 'freshAir', 'environmentSensor', 'presenceSensor', 'gasDetector',
  'gasValve', 'waterValve', 'blanket', 'alarm', 'exitSign', 'emergencyLight', 'sosButton', 'waterLeakSensor',
  'distributionPanel', 'gateway', 'intercom', 'smartLock', 'floodlight', 'elevator', 'inverter', 'battery',
  'heatPump', 'waterTank', 'charger', 'rainFilter', 'rainSystem',
] as const;

export type DeviceKind = typeof DEVICE_KINDS[number];

export interface DeviceConfig {
  id: string;
  info?: ModuleInfo;
  initialState?: boolean;
  pose?: {
    position?: readonly [number, number, number];
    rotation?: readonly [number, number, number];
    scale?: number | readonly [number, number, number];
  };
}

export interface DeviceControl extends BooleanControlCapability {}

export type DeviceFactory = (config: DeviceConfig) => SceneModule;

type ModelParts = {
  root: THREE.Group;
  applyState?: (on: boolean) => void;
  update?: (dt: number, on: boolean) => void;
};

function modelParts(kind: DeviceKind): ModelParts {
  const root = new THREE.Group();
  let white: THREE.MeshStandardMaterial | undefined;
  let dark: THREE.MeshStandardMaterial | undefined;
  let red: THREE.MeshStandardMaterial | undefined;
  let blueGlass: THREE.MeshStandardMaterial | undefined;
  let ledMat: THREE.MeshStandardMaterial | undefined;
  let led: THREE.Mesh | undefined;
  const whiteMaterial = () => white ??= uniqueMat({ color: 0xf1f2ef, roughness: 0.55 });
  const darkMaterial = () => dark ??= uniqueMat({ color: 0x20262c, roughness: 0.4, metalness: 0.25 });
  const redMaterial = () => red ??= uniqueMat({ color: 0xc4231c, roughness: 0.45 });
  const blueGlassMaterial = () => blueGlass ??= uniqueMat({ color: 0x153f65, roughness: 0.25, metalness: 0.45 });
  const ledMaterial = () => ledMat ??= uniqueMat({ color: 0x222222, emissive: 0x37d67a, emissiveIntensity: 0 });
  let fan: THREE.Group | undefined;
  let curtainLeft: THREE.Mesh | undefined;
  let curtainRight: THREE.Mesh | undefined;
  let curtainOpen = 0;
  let curtainTarget = 0;

  const addLed = (x = 0.16, y = 0.13, z = 0.12) => {
    led ??= new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), ledMaterial());
    led.position.set(x, y, z); root.add(led);
  };
  const setLed = (on: boolean, color = 0x3fa9f5, intensity = 1.5) => {
    const material = ledMaterial();
    material.emissive.setHex(on ? color : 0x222222);
    material.emissiveIntensity = on ? intensity : 0;
  };
  switch (kind) {
    case 'television':
      root.add(box(0.08, 0.85, 1.45, darkMaterial()));
      root.add(box(0.015, 0.76, 1.34, uniqueMat({ color: 0x080d13, emissive: 0x080d13, roughness: 0.18 }), -0.05, 0.02, 0));
      return { root, applyState(on) { const screen = root.children[1] as THREE.Mesh; (screen.material as THREE.MeshStandardMaterial).emissive.setHex(on ? 0x304f70 : 0x080d13); } };
    case 'nightLight': {
      const stripMat = uniqueMat({ color: 0x33281d, emissive: 0xffb866, emissiveIntensity: 0 });
      root.add(box(1.2, 0.025, 0.025, stripMat));
      return { root, applyState(on) { stripMat.emissiveIntensity = on ? 2.5 : 0; } };
    }
    case 'curtain': {
      root.add(box(1.2, 0.04, 0.05, darkMaterial(), 0, 1.2, 0));
      const cloth = uniqueMat({ color: 0x7188a2, side: THREE.DoubleSide, roughness: 0.9 });
      curtainLeft = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.15), cloth);
      curtainRight = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 1.15), cloth);
      curtainLeft.position.set(-0.3, 0.58, 0); curtainRight.position.set(0.3, 0.58, 0);
      root.add(curtainLeft, curtainRight);
      return {
        root,
        applyState(on) { curtainTarget = on ? 1 : 0; },
        update(dt) {
          curtainOpen += Math.sign(curtainTarget - curtainOpen) * Math.min(Math.abs(curtainTarget - curtainOpen), dt * 0.8);
          curtainLeft!.position.x = -0.3 - curtainOpen * 0.3;
          curtainRight!.position.x = 0.3 + curtainOpen * 0.3;
        },
      };
    }
    case 'freshAir':
      root.add(box(0.8, 0.5, 0.35, whiteMaterial()));
      fan = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const blade = box(0.3, 0.035, 0.025, blueGlassMaterial(), 0.14, 0, 0);
        blade.rotation.z = i * Math.PI / 2;
        fan.add(blade);
      }
      root.add(fan);
      return { root, update(dt, on) { if (on) fan!.rotation.z += dt * 5; } };
    case 'environmentSensor': case 'smokeSensor': case 'gasDetector': case 'presenceSensor': case 'waterLeakSensor':
      root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.07, 24), whiteMaterial()));
      addLed(0.08, 0.04, 0.08);
      return { root, applyState(on) { setLed(on); } };
    case 'gasValve': case 'waterValve':
      root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.22, 16), uniqueMat({ color: 0xd49d35, metalness: 0.6, roughness: 0.35 })));
      root.add(box(0.34, 0.035, 0.04, redMaterial(), 0, 0.17, 0));
      return { root, applyState(on) { root.children[1].rotation.y = on ? 0 : Math.PI / 2; } };
    case 'blanket':
      root.add(box(0.5, 0.42, 0.12, redMaterial()));
      root.add(box(0.32, 0.04, 0.14, uniqueMat({ color: 0xe4dfc9 }), 0, 0, 0.08));
      return { root };
    case 'alarm':
      root.add(box(0.35, 0.24, 0.12, whiteMaterial()));
      root.add(new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), uniqueMat({ color: 0x8c1515, emissive: 0xf22b20, emissiveIntensity: 0.1 })));
      return { root, applyState(on) { ((root.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2 : 0.1; } };
    case 'exitSign':
      root.add(box(0.8, 0.32, 0.1, uniqueMat({ color: 0x159447, emissive: 0x24c76a, emissiveIntensity: 0.5 })));
      return { root };
    case 'emergencyLight':
      root.add(box(0.55, 0.2, 0.16, whiteMaterial()));
      root.add(box(0.42, 0.08, 0.03, uniqueMat({ color: 0xf5efc9, emissive: 0xffef9a, emissiveIntensity: 0.4 }), 0, -0.02, 0.09));
      return { root, applyState(on) { ((root.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.8 : 0.1; } };
    case 'sosButton':
      root.add(box(0.3, 0.34, 0.12, whiteMaterial()));
      root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.08, 20), redMaterial()));
      return { root, applyState(on) { root.children[1].position.y = on ? -0.04 : 0; } };
    case 'distributionPanel':
      root.add(box(0.65, 0.9, 0.22, whiteMaterial()));
      root.add(box(0.38, 0.5, 0.025, darkMaterial(), 0, 0.08, 0.125));
      addLed(0.2, 0.34, 0.15);
      return { root, applyState(on) { setLed(on, 0x37d67a); } };
    case 'gateway':
      root.add(box(0.38, 0.25, 0.3, whiteMaterial()));
      addLed(0.12, 0.05, 0.16);
      return { root, applyState(on) { setLed(on, 0x37d67a); } };
    case 'intercom':
      root.add(box(0.32, 0.48, 0.1, whiteMaterial()));
      root.add(box(0.2, 0.15, 0.015, blueGlassMaterial(), 0, 0.1, 0.06));
      addLed(0, -0.13, 0.06);
      return { root, applyState(on) { setLed(on, 0x37d67a, 1); } };
    case 'smartLock':
      root.add(box(0.14, 0.42, 0.055, darkMaterial()));
      root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.12, 16), uniqueMat({ color: 0xb2a36c, metalness: 0.75 })));
      addLed(0, 0.15, 0.04);
      return { root, applyState(on) { const material = ledMaterial(); material.emissive.setHex(on ? 0x3fa9f5 : 0x37d67a); material.emissiveIntensity = 1; } };
    case 'floodlight':
      root.add(box(0.34, 0.24, 0.12, darkMaterial()));
      root.add(box(0.28, 0.16, 0.025, uniqueMat({ color: 0xc5d4d9, emissive: 0xffe7ad, emissiveIntensity: 0 }), 0, 0, 0.07));
      return { root, applyState(on) { ((root.children[1] as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 2 : 0; } };
    case 'elevator':
      root.add(box(1.1, 2.2, 1.1, darkMaterial()));
      root.add(box(0.48, 2.0, 0.025, uniqueMat({ color: 0x9aa6ad, metalness: 0.7 }), -0.25, 0, 0.57));
      root.add(box(0.48, 2.0, 0.025, uniqueMat({ color: 0xb5bec3, metalness: 0.7 }), 0.25, 0, 0.57));
      return { root };
    case 'inverter':
      root.add(box(0.6, 0.8, 0.32, whiteMaterial()));
      root.add(box(0.25, 0.16, 0.025, blueGlassMaterial(), 0, 0.2, 0.17));
      addLed(0.22, 0.31, 0.18);
      return { root, applyState(on) { setLed(on, 0x37d67a); } };
    case 'battery':
      root.add(box(0.72, 1.05, 0.46, whiteMaterial()));
      root.add(box(0.35, 0.08, 0.025, blueGlassMaterial(), 0, 0.32, 0.24));
      return { root };
    case 'heatPump':
      root.add(box(0.82, 0.9, 0.4, whiteMaterial()));
      fan = new THREE.Group();
      for (let i = 0; i < 5; i++) {
        const spoke = box(0.26, 0.025, 0.025, darkMaterial(), 0.12, 0, 0);
        spoke.rotation.z = i * Math.PI * 2 / 5;
        fan.add(spoke);
      }
      root.add(fan);
      return { root, update(dt, on) { if (on) fan!.rotation.z += dt * 3; } };
    case 'waterTank':
      root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 1.25, 24), whiteMaterial()));
      root.add(new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.025, 8, 24), darkMaterial()));
      return { root };
    case 'charger':
      root.add(box(0.38, 1.25, 0.22, whiteMaterial()));
      root.add(box(0.21, 0.24, 0.025, blueGlassMaterial(), 0, 0.28, 0.12));
      addLed(0.1, -0.08, 0.12);
      return { root, applyState(on) { setLed(on, 0x37d67a); } };
    case 'rainFilter': case 'rainSystem':
      root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.72, 16), uniqueMat({ color: 0x477c8d, metalness: 0.35 })));
      root.add(box(0.5, 0.06, 0.06, blueGlassMaterial(), 0, 0.2, 0));
      return { root };
    default:
      return { root };
  }
}

function wrapModule(config: DeviceConfig, kind: DeviceKind, parts: ModelParts): SceneModule {
  const info: ModuleInfo = {
    name: config.info?.name ?? config.id,
    category: config.info?.category ?? '设备',
    ...config.info,
    data: { ...(config.info?.data ?? {}) },
  };
  let enabled = config.initialState ?? false;
  const control: DeviceControl = {
    getState: () => enabled,
    setState(on) {
      enabled = on;
      parts.applyState?.(on);
      info.data = { ...info.data, 状态: on ? '开启' : '关闭' };
    },
  };
  let status: DeviceStatus = 'normal';
  const statusCapability: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) { status = value; info.status = value; },
  };
  setInfo(parts.root, info);
  parts.applyState?.(enabled);
  const module = new SceneModule({
    id: config.id,
    kind: 'device',
    root: parts.root,
    info,
    update: (dt) => parts.update?.(dt, enabled),
    capabilities: [
      [MODULE_CAPABILITY.control, control],
      [MODULE_CAPABILITY.deviceKind, kind],
      [MODULE_CAPABILITY.deviceStatus, statusCapability],
    ],
    disposeResources: true,
  });
  if (config.pose) module.place(config.pose);
  return module;
}

function simpleStateful(config: DeviceConfig, kind: DeviceKind, root: THREE.Group, apply: (on: boolean) => void): SceneModule {
  return wrapModule(config, kind, { root, applyState: apply });
}

const switchableFactories: Partial<Record<DeviceKind, DeviceFactory>> = {
  light(config) {
    const root = new THREE.Group();
    const shadeMaterial = uniqueMat({ color: 0xffefcf, emissive: 0xffd28a, emissiveIntensity: 0 });
    const shade = new THREE.Mesh(new THREE.SphereGeometry(0.24, 20, 16), shadeMaterial);
    shade.position.y = 0.35; root.add(shade, box(0.08, 0.45, 0.08, 'darkMetal', 0, -0.12, 0));
    const light = new THREE.PointLight(0xffd28a, 0, 6, 2); light.position.y = 0.3; root.add(light);
    return simpleStateful(config, 'light', root, (on) => { shadeMaterial.emissiveIntensity = on ? 2.2 : 0; light.intensity = on ? 8 : 0; });
  },
  switch(config) {
    const root = new THREE.Group();
    const indicatorMaterial = uniqueMat({ color: 0x222222, emissive: 0x32d583, emissiveIntensity: 0 });
    root.add(box(0.34, 0.48, 0.12, uniqueMat({ color: 0xf4f4f2, roughness: 0.3 })));
    const indicator = new THREE.Mesh(new THREE.SphereGeometry(0.025, 10, 8), indicatorMaterial); indicator.position.set(0, 0.12, 0.07); root.add(indicator);
    return simpleStateful(config, 'switch', root, (on) => { indicatorMaterial.emissiveIntensity = on ? 1.6 : 0; });
  },
  thermostat(config) {
    const root = new THREE.Group();
    const screenMaterial = uniqueMat({ color: 0x10202d, emissive: 0x4fc3f7, emissiveIntensity: 0.1 });
    root.add(box(0.42, 0.5, 0.1, 'whiteGloss'));
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.16), screenMaterial); screen.position.set(0, 0.12, 0.056); root.add(screen);
    return simpleStateful(config, 'thermostat', root, (on) => { screenMaterial.emissiveIntensity = on ? 0.8 : 0.1; });
  },
  airConditioner(config) {
    const root = new THREE.Group();
    const ventMaterial = uniqueMat({ color: 0x343b40, roughness: 0.45 });
    root.add(box(0.95, 0.28, 0.24, 'whiteGloss'), box(0.78, 0.025, 0.012, ventMaterial, 0, -0.09, 0.127));
    const statusMaterial = uniqueMat({ color: 0x111111, emissive: 0x38a8e8, emissiveIntensity: 0 });
    const status = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), statusMaterial); status.position.set(0.37, 0.08, 0.125); root.add(status);
    return simpleStateful(config, 'airConditioner', root, (on) => { statusMaterial.emissiveIntensity = on ? 1.8 : 0; });
  },
  smokeSensor(config) { return wrapModule(config, 'smokeSensor', modelParts('smokeSensor')); },
  camera(config) {
    const root = new THREE.Group();
    root.add(box(0.16, 0.14, 0.3, 'whiteGloss', 0, 0, 0.06));
    const lensMaterial = uniqueMat({ color: 0x111820, roughness: 0.15, metalness: 0.45, emissive: 0x000000 });
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.035, 20), lensMaterial); lens.rotation.x = Math.PI / 2; lens.position.z = 0.22; root.add(lens);
    return simpleStateful(config, 'camera', root, (on) => { lensMaterial.emissive.setHex(on ? 0x1f6fd1 : 0); });
  },
  extinguisher(config) {
    const root = new THREE.Group();
    const red = uniqueMat({ color: 0xc4231c, roughness: 0.45 });
    root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.58, 20), red));
    root.add(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.09, 12), uniqueMat({ color: 0x242424, metalness: 0.35 })));
    root.add(box(0.2, 0.025, 0.04, 'blackPlastic', 0.08, 0.33, 0));
    return wrapModule(config, 'extinguisher', { root });
  },
  solarPanel(config) {
    const root = new THREE.Group();
    const frame = new THREE.MeshStandardMaterial({ color: 0x17232e, metalness: 0.35, roughness: 0.35 });
    const cell = new THREE.MeshStandardMaterial({ color: 0x153f65, metalness: 0.55, roughness: 0.23 });
    root.add(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.06, 1.8), frame));
    for (let i = 0; i < 4; i++) root.add(box(0.25, 0.012, 1.68, cell, -0.405 + i * 0.27, 0.035, 0));
    return wrapModule(config, 'solarPanel', { root });
  },
};

const DEVICE_INFO: Partial<Record<DeviceKind, Pick<ModuleInfo, 'name' | 'category'>>> = {
  light: { name: '灯具', category: '智能照明' }, switch: { name: '墙壁开关', category: '智能控制' },
  thermostat: { name: '温控器', category: '环境控制' }, airConditioner: { name: '空调', category: '环境控制' },
  smokeSensor: { name: '烟雾探测器', category: '消防设施' }, camera: { name: '安防摄像头', category: '安防设备' },
  extinguisher: { name: '灭火器', category: '消防设施' }, solarPanel: { name: '光伏板', category: '绿色低碳' },
  television: { name: '电视', category: '影音设备' }, nightLight: { name: '夜间感应灯', category: '智能照明' },
  curtain: { name: '电动窗帘', category: '智能家居' }, freshAir: { name: '新风机', category: '舒适环境' },
  environmentSensor: { name: '温湿度 / PM2.5 传感器', category: '传感器' }, presenceSensor: { name: '人体存在传感器', category: '传感器' },
  gasDetector: { name: '燃气探测器', category: '安全传感器' }, gasValve: { name: '燃气阀门', category: '燃气安全' },
  waterValve: { name: '进水阀门', category: '水浸安全' }, blanket: { name: '灭火毯', category: '消防设施' },
  alarm: { name: '声光报警器', category: '消防设施' }, exitSign: { name: '安全出口标志', category: '消防设施' },
  emergencyLight: { name: '应急照明灯', category: '消防设施' }, sosButton: { name: '紧急呼叫按钮', category: '安全设施' },
  waterLeakSensor: { name: '水浸传感器', category: '安全传感器' }, distributionPanel: { name: '智能配电箱', category: '能源设备' },
  gateway: { name: '家庭智能网关', category: '智慧家居' }, intercom: { name: '可视对讲机', category: '安防设备' },
  smartLock: { name: '智能门锁', category: '安防设备' }, floodlight: { name: '感应投光灯', category: '安防照明' },
  elevator: { name: '家用电梯', category: '垂直交通' }, inverter: { name: '光伏逆变器', category: '绿色低碳' },
  battery: { name: '储能电池', category: '绿色低碳' }, heatPump: { name: '空气源热泵', category: '绿色低碳' },
  waterTank: { name: '热水箱', category: '绿色低碳' }, charger: { name: '电动汽车充电桩', category: '绿色低碳' },
  rainFilter: { name: '雨水过滤器', category: '绿色低碳' }, rainSystem: { name: '雨水喷灌系统', category: '绿色低碳' },
};

export const DEVICE_LABELS: Readonly<Record<DeviceKind, string>> = Object.fromEntries(
  DEVICE_KINDS.map((kind) => [kind, DEVICE_INFO[kind]?.name ?? kind]),
) as Record<DeviceKind, string>;

function createGenericDevice(kind: DeviceKind, config: DeviceConfig): SceneModule {
  const parts = modelParts(kind);
  const baseInfo = DEVICE_INFO[kind] ?? { name: config.id, category: '设备' };
  return wrapModule({ ...config, info: { ...baseInfo, ...config.info } }, kind, parts);
}

const genericFactories = Object.fromEntries(
  DEVICE_KINDS.filter((kind) => !switchableFactories[kind]).map((kind) => [kind, (config: DeviceConfig) => createGenericDevice(kind, config)]),
) as Record<Exclude<DeviceKind, keyof typeof switchableFactories>, DeviceFactory>;

export const deviceFactories = { ...switchableFactories, ...genericFactories } as Record<DeviceKind, DeviceFactory>;

export function createDeviceFromCatalog(kind: DeviceKind, config: DeviceConfig): SceneModule {
  const factory = deviceFactories[kind];
  if (!factory) throw new Error(`Unknown device factory: ${kind}`);
  return factory({ ...config, info: { ...DEVICE_INFO[kind], ...config.info } });
}

export function deviceDefinition(kind: DeviceKind, definitionId = `device-${kind}`): SceneModuleDefinition<DeviceConfig> {
  return {
    id: definitionId,
    kind: 'device',
    create: (_context: ModuleFactoryContext, config) => createDeviceFromCatalog(kind, config),
  };
}

export function deviceDefinitions(): SceneModuleDefinition<DeviceConfig>[] {
  return DEVICE_KINDS.map((kind) => deviceDefinition(kind));
}
