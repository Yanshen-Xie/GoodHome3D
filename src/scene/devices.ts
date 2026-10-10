// Assemble and register the house-specific device groups as scene modules.
import * as THREE from 'three';
import { LightPool } from '../systems/lightPool.js';
import { MODULE_CAPABILITY } from '../modules/contracts';
import type { SceneModuleContract } from '../modules/contracts';
import type { DeviceKind } from './deviceCatalog.js';
import { DeviceRegistry } from './deviceRegistry.js';
import { houseDeviceKinds } from './deviceAssemblies.js';
import type { HouseDeviceContext } from './deviceAssemblies.js';
import { buildComfortDevices } from './devices/comfort.js';
import { buildSafetyDevices } from './devices/safety.js';
import { buildElevatorDevice } from './devices/elevator.js';
import { buildGreenDevices } from './devices/green.js';
import type { DeviceAssemblyContext, DeviceFacing, DeviceModuleMetadata } from './deviceAssemblyContext.js';
import { FLOOR_H, FLOORS } from './layout.js';
export type { HouseDeviceContext, HouseDeviceType } from './deviceAssemblies.js';
export { STATUS_COLOR, STATUS_TEXT, kelvinToColor } from './devices/deviceVisuals.js';

const FACING: Readonly<Record<DeviceFacing, number>> = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': 0, '-z': Math.PI };
const Y = (floor: number) => FLOORS[floor].y;
const CEIL = (floor: number) => FLOORS[floor].y + FLOOR_H - 0.2;

export function buildDevices(assembly: HouseDeviceContext = {}) {
  const root = new THREE.Group();
  root.name = 'devices';
  const registry = new DeviceRegistry();
  const lightPool = new LightPool(root, 10);

  const modules: SceneModuleContract[] = [];
  const registerModule = (
    module: SceneModuleContract,
    metadata: DeviceModuleMetadata,
  ): SceneModuleContract => {
    const accepted = houseDeviceKinds(metadata.type);
    const declared = module.getCapability<DeviceKind>(MODULE_CAPABILITY.deviceKind);
    const kind = metadata.kind ?? declared ?? accepted[0];
    if (!accepted.includes(kind)) {
      throw new Error(`Device ${module.id}: kind ${kind} does not match registry type ${metadata.type} (expected ${accepted.join(' / ')})`);
    }
    if (declared && declared !== kind) {
      throw new Error(`Device ${module.id}: module declares kind ${declared}, but is registered as ${kind}`);
    }
    module.info.status = module.info.status ?? 'normal';
    module.info.deviceId = module.id;
    module.root.userData.deviceId = module.id;
    module.root.userData.info = module.info;
    module.setCapability(MODULE_CAPABILITY.deviceKind, kind);
    if (!module.root.parent) root.add(module.root);
    modules.push(module);
    registry.register({ id: module.id, type: metadata.type, room: metadata.room, floor: metadata.floor, module });
    return module;
  };

  const assemblyContext: DeviceAssemblyContext = {
    assembly, registerModule, lightPool, facing: FACING, floorY: Y, ceilingY: CEIL,
  };
  buildComfortDevices(assemblyContext);
  buildSafetyDevices(assemblyContext);
  buildElevatorDevice(assemblyContext);
  buildGreenDevices(assemblyContext);

  return { root, registry, modules, lightPool };
}
