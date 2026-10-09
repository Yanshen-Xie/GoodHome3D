import * as THREE from 'three';
import { box, cylinder } from '../common.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import type {
  DeviceStatus,
  DeviceStatusCapability,
  ElevatorCapability,
  ModuleInfo,
  SceneModuleDefinition,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';

export interface HouseElevatorFloor {
  /** Floor numbers are the values accepted by ElevatorCapability.call(). */
  readonly index: number;
  readonly y: number;
  readonly label: string;
}

export interface HouseElevatorConfig {
  readonly kind: 'elevator';
  readonly id: string;
  readonly room: string;
  readonly name: string;
  /** Horizontal world-space center of the shaft. */
  readonly position: readonly [number, number];
  readonly carWidth: number;
  readonly carDepth: number;
  readonly floors: readonly HouseElevatorFloor[];
  readonly initialFloor?: number;
  readonly travelSpeed?: number;
  readonly doorSpeed?: number;
  readonly floorOffset?: number;
  readonly arrivalDelayMs?: number;
  readonly autoCloseDelayMs?: number;
  readonly info?: Pick<ModuleInfo, 'category' | 'func' | 'maintain' | 'data'>;
}

function validateConfig(config: HouseElevatorConfig): void {
  if (config.kind !== 'elevator') throw new Error('Elevator factory requires kind "elevator"');
  if (!config.id.trim() || !config.name.trim() || !config.room.trim()) {
    throw new Error('Elevator id, name and room are required');
  }
  if (!config.position.every(Number.isFinite)) throw new Error('Elevator position must be finite: ' + config.id);
  if (!Number.isFinite(config.carWidth) || config.carWidth <= 0.12
      || !Number.isFinite(config.carDepth) || config.carDepth <= 0.32) {
    throw new Error('Elevator car dimensions are too small or invalid: ' + config.id);
  }
  if (config.floors.length < 2) throw new Error('Elevator requires at least two floors: ' + config.id);
  const indices = new Set<number>();
  let previousY = Number.NEGATIVE_INFINITY;
  for (const floor of config.floors) {
    if (!Number.isInteger(floor.index) || floor.index < 0 || indices.has(floor.index)
        || !Number.isFinite(floor.y) || floor.y <= previousY || !floor.label.trim()) {
      throw new Error('Elevator floors must have unique indices and ascending, labelled heights: ' + config.id);
    }
    indices.add(floor.index);
    previousY = floor.y;
  }
  const initialFloor = config.initialFloor ?? config.floors[0].index;
  if (!indices.has(initialFloor)) throw new Error('Elevator initial floor is not configured: ' + config.id);
  if (config.travelSpeed !== undefined && (!Number.isFinite(config.travelSpeed) || config.travelSpeed <= 0)) {
    throw new Error('Elevator travel speed must be positive: ' + config.id);
  }
  if (config.doorSpeed !== undefined && (!Number.isFinite(config.doorSpeed) || config.doorSpeed <= 0)) {
    throw new Error('Elevator door speed must be positive: ' + config.id);
  }
  if (config.floorOffset !== undefined && !Number.isFinite(config.floorOffset)) {
    throw new Error('Elevator floor offset must be finite: ' + config.id);
  }
  for (const [name, delay] of [['arrival delay', config.arrivalDelayMs], ['door close delay', config.autoCloseDelayMs]] as const) {
    if (delay !== undefined && (!Number.isFinite(delay) || delay < 0)) {
      throw new Error(`Elevator ${name} must be non-negative: ${config.id}`);
    }
  }
}

/** Create one self-contained elevator car, motion controller, and typed capability. */
export function createHouseElevator(config: HouseElevatorConfig): SceneModule {
  validateConfig(config);
  const [x, z] = config.position;
  const width = config.carWidth - 0.12;
  const depth = config.carDepth - 0.12;
  const floorByIndex = new Map(config.floors.map((floor) => [floor.index, floor]));
  const initialFloor = config.initialFloor ?? config.floors[0].index;
  const travelSpeed = config.travelSpeed ?? 0.6;
  const doorSpeed = config.doorSpeed ?? 1.2;
  const floorOffset = config.floorOffset ?? 0.02;
  const arrivalDelayMs = config.arrivalDelayMs ?? 1200;
  const autoCloseDelayMs = config.autoCloseDelayMs ?? 6000;

  const root = new THREE.Group();
  root.name = config.id;
  root.position.set(x, floorByIndex.get(initialFloor)!.y + floorOffset, z);
  root.add(box(width, 0.08, depth, 'darkMetal', 0, 0, 0));
  root.add(box(width, 2.2, 0.03, 'woodPanel', 0, 0.08, -depth / 2));
  root.add(box(0.03, 2.2, depth, 'woodPanel', -width / 2, 0.08, 0));
  root.add(box(0.03, 2.2, depth, 'woodPanel', width / 2, 0.08, 0));
  root.add(box(width, 0.06, depth, 'whiteGloss', 0, 2.28, 0));
  root.add(box(0.5, 0.02, 0.5, new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xfff2d8,
    emissiveIntensity: 1.2,
  }), 0, 2.26, 0, { cast: false }));
  const handrail = cylinder(0.02, 0.02, depth - 0.2, 'metal', 0, 0, 0, 8);
  handrail.rotation.x = Math.PI / 2;
  handrail.position.set(-width / 2 + 0.06, 0.95, 0);
  root.add(handrail);
  const doorLeft = box(width / 2, 2.1, 0.03, 'metal', -width / 4, 0.1, depth / 2);
  const doorRight = box(width / 2, 2.1, 0.03, 'metal', width / 4, 0.1, depth / 2);
  doorLeft.userData.dynamic = true;
  doorRight.userData.dynamic = true;
  root.add(doorLeft, doorRight);

  const info: ModuleInfo = {
    name: config.name,
    category: config.info?.category ?? '适老无障碍 / 安全',
    room: config.room,
    status: 'normal',
    func: config.info?.func ?? '可容纳轮椅；配紧急呼叫、断电自动平层；火灾时停止使用，疏散走楼梯',
    maintain: config.info?.maintain ?? '年检：2026-04 合格；下次维保 2026-10',
    data: {
      所在楼层: floorByIndex.get(initialFloor)!.label,
      运行状态: '待机',
      年检: '合格',
      ...config.info?.data,
    },
  };
  info.deviceId = config.id;
  root.userData.deviceId = config.id;
  root.userData.info = info;

  let currentY = floorByIndex.get(initialFloor)!.y;
  let targetFloor = initialFloor;
  let doorOpen = 0;
  let doorTarget = 0;
  let moving = false;
  let status: DeviceStatus = 'normal';
  let onArrive: (() => void) | undefined;
  let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
  let doorCloseTimer: ReturnType<typeof setTimeout> | undefined;
  let module: SceneModule;

  const clearTimers = () => {
    if (arrivalTimer !== undefined) clearTimeout(arrivalTimer);
    if (doorCloseTimer !== undefined) clearTimeout(doorCloseTimer);
    arrivalTimer = undefined;
    doorCloseTimer = undefined;
  };
  const call = (floor: number, callback?: () => void): boolean => {
    if (module.disposed || status === 'fault' || !floorByIndex.has(floor)) return false;
    clearTimers();
    targetFloor = floor;
    onArrive = callback;
    doorTarget = 0;
    moving = true;
    return true;
  };
  const getCurrentFloor = () => config.floors.reduce((closest, floor) =>
    Math.abs(floor.y - currentY) < Math.abs(closest.y - currentY) ? floor : closest,
  config.floors[0]).index;

  const elevatorCapability: ElevatorCapability = {
    call,
    getCurrentFloor,
    isMoving: () => moving,
    getFloors: () => config.floors.map(({ index, label }) => ({ index, label })),
  };
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) {
      status = value;
      info.status = value;
    },
  };
  info.controls = config.floors.map((floor) => ({
    type: 'button',
    label: `呼叫到${floor.label}`,
    onClick: () => call(floor.index),
  }));

  const update = (dt: number) => {
    if (moving && doorOpen <= 0.01) {
      const targetY = floorByIndex.get(targetFloor)!.y;
      const distance = targetY - currentY;
      currentY += Math.sign(distance) * Math.min(Math.abs(distance), dt * travelSpeed);
      if (Math.abs(targetY - currentY) < 1e-3) {
        currentY = targetY;
        moving = false;
        doorTarget = 1;
        const callback = onArrive;
        onArrive = undefined;
        if (callback) arrivalTimer = setTimeout(callback, arrivalDelayMs);
        doorCloseTimer = setTimeout(() => {
          if (!module.disposed && !moving) doorTarget = 0;
        }, autoCloseDelayMs);
      }
    }
    doorOpen += Math.sign(doorTarget - doorOpen)
      * Math.min(Math.abs(doorTarget - doorOpen), dt * doorSpeed);
    doorLeft.position.x = -width / 4 - doorOpen * width * 0.45;
    doorRight.position.x = width / 4 + doorOpen * width * 0.45;
    root.position.y = currentY + floorOffset;
    const floor = floorByIndex.get(getCurrentFloor())!;
    const motion = status === 'fault' ? '故障停梯' : moving
      ? (floorByIndex.get(targetFloor)!.y > currentY ? '上行' : '下行')
      : '待机';
    module.mergeInfoData({ 所在楼层: floor.label, 运行状态: motion });
  };

  module = new SceneModule({
    id: config.id,
    kind: 'device',
    root,
    info,
    update,
    dispose: clearTimers,
    disposeResources: true,
    capabilities: [
      [MODULE_CAPABILITY.deviceKind, config.kind],
      [MODULE_CAPABILITY.deviceStatus, deviceStatus],
      [DEVICE_CAPABILITY.elevator, elevatorCapability],
    ],
  });
  return module;
}

export function houseElevatorDefinition(): SceneModuleDefinition<HouseElevatorConfig> {
  return {
    id: 'house-elevator',
    kind: 'device',
    create: (_context, config) => createHouseElevator(config),
  };
}
