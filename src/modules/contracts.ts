import * as THREE from 'three';

export type SceneModuleKind = 'furniture' | 'device' | 'imported-model';

export const MODULE_CAPABILITY = {
  control: 'control',
  deviceKind: 'deviceKind',
  deviceStatus: 'deviceStatus',
  footprint: 'footprint',
  animation: 'animation',
  appearance: 'appearance',
  info: 'info',
} as const;

/** Stable IDs for narrow services that a standalone module factory may consume. */
export const MODULE_SERVICE = {
  lightPool: 'scene.lightPool',
  floorY: 'scene.floorY',
  ceilingY: 'scene.ceilingY',
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
  environmentSensor: 'device.environmentSensor',
  presenceSensor: 'device.presenceSensor',
  smokeSensor: 'device.smokeSensor',
  gasSensor: 'device.gasSensor',
  waterLeakSensor: 'device.waterLeakSensor',
  fireAlarm: 'device.fireAlarm',
  fireExtinguisher: 'device.fireExtinguisher',
  fireBlanket: 'device.fireBlanket',
  circuits: 'device.circuits',
  network: 'device.network',
  intercom: 'device.intercom',
  generation: 'device.generation',
  inverter: 'device.inverter',
  tank: 'device.tank',
  filter: 'device.filter',
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
  /** Optional on legacy scene adapters; standalone irrigation modules implement both methods. */
  isRunning?(): boolean;
  setRunning?(running: boolean): void;
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

export interface EnvironmentReadings {
  readonly temperatureC: number;
  readonly humidityPercent: number;
  readonly pm25MicrogramsM3: number;
  readonly co2Ppm: number;
}

export interface EnvironmentSensorCapability {
  getReadings(): EnvironmentReadings;
  setReadings(readings: Partial<EnvironmentReadings>): void;
}

export interface PresenceSensorCapability {
  isOccupied(): boolean;
  setOccupied(occupied: boolean): void;
}

export interface WaterLeakSensorCapability {
  isLeaking(): boolean;
  setLeaking(leaking: boolean): void;
}

/** Numeric alarm sensor reading; unit and threshold are part of the concrete device contract. */
export interface ScalarSensorCapability {
  getValue(): number;
  setValue(value: number): void;
  getUnit(): string;
  getAlarmThreshold(): number;
  getFaultThreshold?(): number;
}

export interface FireAlarmCapability {
  isActive(): boolean;
  activate(): void;
  deactivate(): void;
}

export interface FireExtinguisherCapability {
  getRemainingPercent(): number;
  setRemainingPercent(percent: number): void;
  isDischarging(): boolean;
  discharge(): boolean;
  stopDischarge(): void;
  reset(): void;
}

export interface FireBlanketCapability {
  isDeployed(): boolean;
  deploy(): void;
  reset(): void;
}

export interface CircuitState {
  readonly id: string;
  readonly label: string;
  readonly isOn: boolean;
}

export interface CircuitBreakerCapability {
  getCircuits(): readonly CircuitState[];
  setCircuit(id: string, isOn: boolean): void;
}

export interface NetworkCapability {
  isOnline(): boolean;
  setOnline(online: boolean): void;
  getSignalStrength(): number;
  setSignalStrength(percent: number): void;
}

export interface IntercomCapability {
  isCalling(): boolean;
  startCall(): void;
  hangUp(): void;
  requestDoorUnlock(): void;
}

export interface EnergyOutputCapability {
  getPowerKW(): number;
  setPowerKW(powerKW: number): void;
  getRatedPowerKW(): number;
}

export interface InverterCapability {
  getInputPowerKW(): number;
  setInputPowerKW(powerKW: number): void;
  getOutputPowerKW(): number;
  getEfficiencyPercent(): number;
}

export interface TankLevelCapability {
  getLevelPercent(): number;
  setLevelPercent(percent: number): void;
  getCapacityLiters(): number;
}

export interface FilterCapability {
  getHealthPercent(): number;
  setHealthPercent(percent: number): void;
  replaceFilter(): void;
}

export interface ElevatorCapability {
  call(floor: number, onArrive?: () => void): boolean;
  getCurrentFloor(): number;
  isMoving(): boolean;
  getFloors?(): readonly { readonly index: number; readonly label: string }[];
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

export type AppearanceProperty = 'color' | 'roughness' | 'metalness' | 'opacity' | 'emissive' | 'emissiveIntensity';

export interface AppearanceMaterialSlot {
  readonly id: string;
  readonly label: string;
  readonly supports: readonly AppearanceProperty[];
  readonly color?: number;
  readonly roughness?: number;
  readonly metalness?: number;
  readonly opacity: number;
  readonly emissive?: number;
  readonly emissiveIntensity?: number;
}

export type AppearanceMaterialPatch = Partial<Pick<AppearanceMaterialSlot,
  'color' | 'roughness' | 'metalness' | 'opacity' | 'emissive' | 'emissiveIntensity'>>;

/** Live, module-local appearance editing that never mutates materials shared by other modules. */
export interface AppearanceCapability {
  getSlots(): readonly AppearanceMaterialSlot[];
  setMaterial(slotId: string, patch: AppearanceMaterialPatch): void;
  reset(slotId?: string): void;
  dispose(): void;
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
