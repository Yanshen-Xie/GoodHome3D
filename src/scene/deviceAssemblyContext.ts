import type { LightPool } from '../systems/lightPool.js';
import type { HouseDeviceContext, HouseDeviceType } from './deviceAssemblies.js';
import type { DeviceKind } from './deviceCatalog.js';
import type { SceneModuleContract } from '../modules/contracts';
export type DeviceFacing = '+x' | '-x' | '+z' | '-z';

export interface DeviceModuleMetadata {
  readonly type: HouseDeviceType;
  /** Defaults to the catalog kind of `type`; must be one of the kinds accepted for that type. */
  readonly kind?: DeviceKind;
  readonly room?: string | null;
  readonly floor?: number;
}

export interface DeviceAssemblyContext {
  assembly: HouseDeviceContext;
  registerModule(module: SceneModuleContract, metadata: DeviceModuleMetadata): SceneModuleContract;
  lightPool: LightPool;
  facing: Readonly<Record<DeviceFacing, number>>;
  floorY(floor: number): number;
  ceilingY(floor: number): number;
}
