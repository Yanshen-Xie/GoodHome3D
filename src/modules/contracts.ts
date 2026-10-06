import * as THREE from 'three';

export type SceneModuleKind = 'furniture' | 'device' | 'imported-model';

export const MODULE_CAPABILITY = {
  control: 'control',
  deviceKind: 'deviceKind',
  deviceStatus: 'deviceStatus',
  footprint: 'footprint',
  animation: 'animation',
  info: 'info',
} as const;

export const DEVICE_CAPABILITY = {
  power: 'device.power',
  lighting: 'device.lighting',
  curtain: 'device.curtain',
  climate: 'device.climate',
  ventilation: 'device.ventilation',
  display: 'device.display',
  sos: 'device.sos',
  camera: 'device.camera',
  irrigation: 'device.irrigation',
  battery: 'device.battery',
  rotor: 'device.rotor',
  indicator: 'device.indicator',
  elevator: 'device.elevator',
  lock: 'device.lock',
  valve: 'device.valve',
} as const;

export interface BooleanControlCapability {
  getState(): boolean;
  setState(value: boolean): void;
}

export interface PowerCapability {
  isOn(): boolean;
  setOn(on: boolean): void;
}

export interface LightingCapability extends PowerCapability {
  getBrightness(): number;
  setBrightness(value: number): void;
  getColorTemperature(): number;
  setColorTemperature(kelvin: number): void;
  getSourcePosition?(): THREE.Vector3;
  getSourceColor?(): THREE.Color;
}

export interface CurtainCapability {
  getOpenRatio(): number;
  setOpenRatio(ratio: number): void;
}

export interface ClimateCapability extends PowerCapability {
  getSetpoint(): number;
  setSetpoint(celsius: number): void;
  getOutlet?(): { position: THREE.Vector3; direction: THREE.Vector3 };
}

export interface VentilationCapability extends PowerCapability {
  getLevel(): number;
  setLevel(level: number): void;
  getOutlets?(): readonly VentilationOutlet[];
}

export interface VentilationOutlet {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly room: string;
  readonly floor: number;
}

export interface DisplayCapability {
  setTexture(texture: THREE.Texture): void;
}

export interface LockCapability {
  isLocked(): boolean;
  setLocked(locked: boolean): void;
}

export interface ValveCapability {
  isOpen(): boolean;
  setOpen(open: boolean): void;
}

export interface SosCapability {
  isActive(): boolean;
  activate(): void;
  deactivate(): void;
  setIndicator(intensity: number): void;
}

export interface CameraCapability {
  isArmed(): boolean;
  setArmed(armed: boolean): void;
  setAlert(active: boolean): void;
}

export interface IrrigationCapability {
  getSprinklers(): readonly { readonly x: number; readonly z: number }[];
}

export interface BatteryCapability {
  getChargePercent(): number;
  setChargePercent(percent: number): void;
}

export interface RotatingCapability {
  isRunning(): boolean;
  setRunning(running: boolean): void;
}

export interface IndicatorCapability {
  getIntensity(): number;
  setIntensity(intensity: number): void;
}

export interface ElevatorCapability {
  call(floor: number, onArrive?: () => void): boolean;
  getCurrentFloor(): number;
  isMoving(): boolean;
}

export type DeviceStatus = 'normal' | 'warning' | 'fault' | 'off';

export interface DeviceStatusCapability {
  getStatus(): DeviceStatus;
  setStatus(status: DeviceStatus): void;
}

export interface ModuleInfoCapability {
  setData(key: string, value: unknown): void;
  mergeData(values: Record<string, unknown>): void;
  deleteData(key: string): void;
}

export interface AnimationCapability {
  readonly clips: readonly THREE.AnimationClip[];
  play(name?: string): boolean;
  stop(): void;
}

export interface ModulePose {
  position?: THREE.Vector3 | readonly [number, number, number];
  rotation?: THREE.Euler | readonly [number, number, number];
  scale?: THREE.Vector3 | number | readonly [number, number, number];
}

/** Stable metadata shared by furniture, devices, and imported Blender models. */
export interface ModuleInfo {
  name: string;
  category?: string;
  room?: string | null;
  floor?: number;
  func?: string;
  maintain?: string;
  status?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * Runtime contract for one independently attachable scene item.
 * A module owns its root and update hook; placement and mounting stay with the host.
 */
export interface SceneModuleContract {
  readonly id: string;
  readonly kind: SceneModuleKind;
  readonly root: THREE.Object3D;
  readonly info: ModuleInfo;
  readonly disposed: boolean;
  readonly capabilities: ReadonlyMap<string, unknown>;
  setCapability<T>(name: string, value: T): void;
  setInfoData(key: string, value: unknown): void;
  mergeInfoData(values: Record<string, unknown>): void;
  deleteInfoData(key: string): void;
  update(dt: number): void;
  place(pose: ModulePose): void;
  mount(parent: THREE.Object3D): void;
  unmount(): void;
  dispose(options?: { disposeResources?: boolean }): void;
  getCapability<T>(name: string): T | undefined;
}

export interface ModuleServiceRegistry {
  provide<T>(id: string, service: T): void;
  resolve<T>(id: string): T;
  has(id: string): boolean;
  ids(): string[];
}

export interface ModuleFactoryContext {
  scene?: THREE.Scene;
  renderer?: THREE.WebGLRenderer;
  materials?: unknown;
  nav?: unknown;
  services?: ReadonlyMap<string, unknown>;
}

export interface HouseSceneModuleServices {
  houseDevices?: unknown;
  furniture?: ReadonlyMap<string, unknown>;
}

export interface SceneModuleDefinition<TConfig = unknown> {
  readonly id: string;
  readonly kind: SceneModuleKind;
  create(context: ModuleFactoryContext, config: TConfig): SceneModuleContract | Promise<SceneModuleContract>;
}

export interface ModuleCatalogContract {
  register<TConfig>(definition: SceneModuleDefinition<TConfig>): void;
  create<TConfig = unknown>(id: string, context: ModuleFactoryContext, config: TConfig): Promise<SceneModuleContract>;
  has(id: string): boolean;
  ids(): string[];
}
