import type * as THREE from 'three';
import type { DeviceStatus, ModuleInfo, SceneModuleContract } from '../modules/contracts';
export interface HouseDeviceContext {
  entryDoorPivot?: THREE.Object3D;
  pvRoof?: { ridgeY: number };
}
export interface HouseDevice {
  id: string;
  room?: string | null;
  floor?: number;
  type: string;
  object?: THREE.Object3D | null;
  status?: DeviceStatus;
  info?: ModuleInfo & { controls?: unknown[] };
  module?: SceneModuleContract;
  update?: (dt: number) => void;
  set?: (...args: Array<boolean | number>) => void;
  setTexture?: (texture: THREE.Texture) => void;
  led?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  on?: boolean;
  open?: boolean;
  locked?: boolean;
  isOpen?: boolean;
  target?: number;
  setpoint?: number;
  level?: number;
  cct?: number;
  lamp?: { position: THREE.Vector3; color: THREE.Color };
  vents?: Array<{ x: number; z: number; y: number; room: string; floor: number }>;
  active?: boolean;
  btnMat?: THREE.MeshStandardMaterial;
  cone?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  sprinklers?: Array<{ x: number; z: number }>;
  socBar?: THREE.Mesh;
  fan?: THREE.Object3D;
  running?: boolean;
  indicatorMaterial?: THREE.MeshStandardMaterial;
  indicatorLight?: THREE.PointLight;
  y?: number;
  moving?: boolean;
  handle?: THREE.Object3D;
  targetFloor?: number;
  doorTarget?: number;
  doorOpen?: number;
  onArrive?: (() => void) | null;
  call?: (floor: number, onArrive?: () => void) => boolean;
  [key: string]: unknown;
}
