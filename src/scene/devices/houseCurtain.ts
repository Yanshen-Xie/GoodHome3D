import * as THREE from 'three';
import { box, mat } from '../common.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import type {
  BooleanControlCapability,
  CurtainCapability,
  DeviceStatus,
  DeviceStatusCapability,
  ModuleInfo,
  SceneModuleDefinition,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';

export interface HouseCurtainConfig {
  readonly kind: 'curtain';
  readonly id: string;
  readonly room: string;
  readonly name: string;
  readonly floor: number;
  readonly wallZ: number;
  readonly span: readonly [number, number];
  readonly wallRotationY?: number;
  readonly initialOpenRatio?: number;
}

export interface HouseCurtainFactoryContext {
  readonly floorY: (floor: number) => number;
}

export function createHouseCurtain(
  context: HouseCurtainFactoryContext,
  config: HouseCurtainConfig,
): SceneModule {
  if (!config.id.trim() || !config.name.trim() || !config.room.trim()) {
    throw new Error('Curtain id, name and room are required');
  }
  const wallZ = config.wallZ;
  const [spanStart, spanEnd] = config.span;
  if (![wallZ, spanStart, spanEnd].every(Number.isFinite) || spanEnd <= spanStart) {
    throw new Error('Curtain position and span are invalid: ' + config.id);
  }
  const ceilingY = context.floorY(config.floor);
  if (!Number.isFinite(ceilingY)) throw new Error('Curtain floor height is invalid: ' + config.id);

  const width = spanEnd - spanStart + 0.4;
  const height = 2.65;
  const root = new THREE.Group();
  root.name = config.id;
  root.position.set((spanStart + spanEnd) / 2, ceilingY + 0.02, wallZ);
  root.rotation.y = config.wallRotationY ?? (wallZ > 0 ? Math.PI : 0);
  const holders: THREE.Group[] = [];
  const fabric = mat('curtain');
  for (const side of [-1, 1]) {
    const geometry = new THREE.PlaneGeometry(width / 2, height, 30, 1);
    const positions = geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      positions.setZ(i, Math.sin(positions.getX(i) * 28) * 0.035);
    }
    geometry.computeVertexNormals();
    geometry.translate(-side * width / 4, height / 2, 0);
    const pivot = new THREE.Group();
    pivot.position.x = side * width / 2;
    pivot.userData.dynamic = true;
    const holder = new THREE.Group();
    const panel = new THREE.Mesh(geometry, fabric);
    panel.castShadow = true;
    holder.add(panel);
    pivot.add(holder);
    root.add(pivot);
    holders.push(holder);
  }
  root.add(box(width + 0.1, 0.04, 0.06, 'darkMetal', 0, height + 0.02, 0));

  const info: ModuleInfo = {
    name: config.name,
    category: '智能家居',
    room: config.room,
    floor: config.floor,
    status: 'normal',
    func: '电动窗帘，可按场景自动开合；遮光面料，隔热降噪',
    data: { 开合度: '100%' },
  };
  info.deviceId = config.id;
  root.userData.deviceId = config.id;
  root.userData.info = info;
  let openRatio = config.initialOpenRatio ?? 1;
  let targetRatio = openRatio;
  let status: DeviceStatus = 'normal';
  let module: SceneModule;
  const setOpenRatio = (ratio: number) => {
    targetRatio = THREE.MathUtils.clamp(ratio, 0, 1);
  };
  const update = (dt: number) => {
    openRatio += Math.sign(targetRatio - openRatio)
      * Math.min(Math.abs(targetRatio - openRatio), dt * 0.8);
    for (const holder of holders) holder.scale.x = 1 - 0.8 * openRatio;
    module.mergeInfoData({ 开合度: Math.round(openRatio * 100) + '%' });
  };
  const curtain: CurtainCapability = {
    getOpenRatio: () => openRatio,
    setOpenRatio,
  };
  const control: BooleanControlCapability = {
    getState: () => targetRatio > 0.5,
    setState: (isOpen) => setOpenRatio(isOpen ? 1 : 0),
  };
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) { status = value; info.status = value; },
  };
  info.controls = [
    { type: 'toggle', label: '打开', get: () => targetRatio > 0.5, set: (value: boolean) => setOpenRatio(value ? 1 : 0) },
  ];
  module = new SceneModule({
    id: config.id,
    kind: 'device',
    root,
    info,
    update,
    disposeResources: true,
    capabilities: [
      [MODULE_CAPABILITY.control, control],
      [MODULE_CAPABILITY.deviceKind, config.kind],
      [MODULE_CAPABILITY.deviceStatus, deviceStatus],
      [DEVICE_CAPABILITY.curtain, curtain],
    ],
  });
  update(10);
  return module;
}

export function houseCurtainDefinition(
  factoryContext: HouseCurtainFactoryContext,
): SceneModuleDefinition<HouseCurtainConfig> {
  return {
    id: 'house-curtain',
    kind: 'device',
    create: (_context, config) => createHouseCurtain(factoryContext, config),
  };
}
