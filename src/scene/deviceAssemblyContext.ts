import type * as THREE from 'three';
import type { LightPool } from '../systems/lightPool.js';
import type { HouseDevice, HouseDeviceContext } from './deviceAssemblies.js';
import type { SceneModuleContract } from '../modules/contracts';
export type DeviceFacing = '+x' | '-x' | '+z' | '-z';

export interface DeviceModuleMetadata {
  readonly type: string;
  readonly kind?: string;
  readonly room?: string | null;
  readonly floor?: number;
}

export interface DeviceAssemblyContext {
  root: THREE.Group;
  assembly: HouseDeviceContext;
  register(device: HouseDevice): HouseDevice;
  registerModule(module: SceneModuleContract, metadata: DeviceModuleMetadata): SceneModuleContract;
  lightPool: LightPool;
  wallMount(object: THREE.Object3D, x: number, y: number, z: number, facing: DeviceFacing): THREE.Object3D;
  statusLed(radius?: number): THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  facing: Readonly<Record<DeviceFacing, number>>;
  floorY(floor: number): number;
  ceilingY(floor: number): number;
}
