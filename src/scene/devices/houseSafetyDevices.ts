import * as THREE from 'three';
import { box, cylinder, mat, uniqueMat } from '../common.js';
import { textTexture } from '../textures.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY, MODULE_SERVICE } from '../../modules/contracts';
import type {
  BooleanControlCapability,
  CameraCapability,
  CircuitBreakerCapability,
  DeviceStatus,
  DeviceStatusCapability,
  EnvironmentReadings,
  EnvironmentSensorCapability,
  FireAlarmCapability,
  FireBlanketCapability,
  FireExtinguisherCapability,
  IntercomCapability,
  IndicatorCapability,
  LightingCapability,
  LockCapability,
  ModuleFactoryContext,
  ModuleInfo,
  ModulePose,
  NetworkCapability,
  OpeningsService,
  PowerCapability,
  PresenceSensorCapability,
  ScalarSensorCapability,
  SceneModuleDefinition,
  SosCapability,
  TankLevelCapability,
  ValveCapability,
  WaterLeakSensorCapability,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';
import type { LightPool } from '../../systems/lightPool.js';
import { kelvinToColor, STATUS_COLOR, statusLed } from './deviceVisuals.js';

type SafetyKind = 'environmentSensor' | 'presenceSensor' | 'smokeSensor' | 'gasDetector' | 'waterLeakSensor'
  | 'gasValve' | 'waterValve' | 'extinguisher' | 'blanket' | 'alarm' | 'exitSign' | 'emergencyLight'
  | 'sosButton' | 'distributionPanel' | 'gateway' | 'intercom' | 'smartLock' | 'camera' | 'floodlight';

export interface HouseSafetyDeviceConfig<K extends SafetyKind = SafetyKind> {
  readonly kind: K;
  readonly id: string;
  readonly name: string;
  readonly room?: string | null;
  readonly floor?: number;
  readonly pose?: ModulePose;
  readonly info?: Partial<ModuleInfo>;
}

export interface HouseGasValveConfig extends HouseSafetyDeviceConfig<'gasValve'> {
  readonly initialOpen?: boolean;
}

export interface HouseWaterValveConfig extends HouseSafetyDeviceConfig<'waterValve'> {
  readonly initialOpen?: boolean;
}

export type HouseValveConfig = HouseGasValveConfig | HouseWaterValveConfig;

export interface HouseStrobeConfig extends HouseSafetyDeviceConfig<'alarm'> {
  readonly lightPosition?: readonly [number, number, number];
}

export interface HouseExitSignConfig extends HouseSafetyDeviceConfig<'exitSign'> {
  readonly textLines?: readonly [string, string];
  readonly initialOn?: boolean;
}

export interface HouseEmergencyLightConfig extends HouseSafetyDeviceConfig<'emergencyLight'> {
  readonly initialOn?: boolean;
}

export interface HouseExtinguisherConfig extends HouseSafetyDeviceConfig<'extinguisher'> {
  readonly initialRemainingPercent?: number;
}

export interface HouseFireBlanketConfig extends HouseSafetyDeviceConfig<'blanket'> {
  readonly initiallyDeployed?: boolean;
}

export interface HouseSosButtonConfig extends HouseSafetyDeviceConfig<'sosButton'> {}
export interface HouseEnvironmentSensorConfig extends HouseSafetyDeviceConfig<'environmentSensor'> {
  readonly initialReadings?: Partial<EnvironmentReadings>;
}
export interface HousePresenceSensorConfig extends HouseSafetyDeviceConfig<'presenceSensor'> {
  readonly initiallyOccupied?: boolean;
}
export interface HouseSmokeSensorConfig extends HouseSafetyDeviceConfig<'smokeSensor'> {
  readonly initialDensity?: number;
  readonly alarmThreshold?: number;
}
export interface HouseGasDetectorConfig extends HouseSafetyDeviceConfig<'gasDetector'> {
  readonly initialConcentration?: number;
  readonly alarmThreshold?: number;
  readonly faultThreshold?: number;
}
export interface HouseWaterLeakSensorConfig extends HouseSafetyDeviceConfig<'waterLeakSensor'> {
  readonly initiallyLeaking?: boolean;
}
export interface HouseSmartLockConfig extends HouseSafetyDeviceConfig<'smartLock'> {
  readonly initiallyLocked?: boolean;
  /** Door whose leaf carries the lock; needs an openings service in the factory context. */
  readonly doorId?: string;
}

export interface HouseSmartLockFactoryContext {
  readonly openings?: OpeningsService;
}

export interface HouseCameraConfig extends HouseSafetyDeviceConfig<'camera'> {
  readonly yawOffset?: number;
}

export interface HouseFloodlightConfig extends HouseSafetyDeviceConfig<'floodlight'> {
  readonly fixtures?: readonly (readonly [number, number, number])[];
  readonly lightPosition?: readonly [number, number, number];
  readonly initialOn?: boolean;
  readonly initialBrightness?: number;
  readonly initialColorTemperature?: number;
}

export interface HouseSafetyFactoryContext {
  readonly lightPool?: LightPool;
}

type SafetyConfig = HouseSafetyDeviceConfig | HouseValveConfig | HouseStrobeConfig | HouseExitSignConfig
  | HouseSosButtonConfig | HouseEnvironmentSensorConfig | HousePresenceSensorConfig | HouseSmokeSensorConfig
  | HouseGasDetectorConfig | HouseWaterLeakSensorConfig | HouseEmergencyLightConfig | HouseExtinguisherConfig
  | HouseFireBlanketConfig | HouseSmartLockConfig | HouseCameraConfig | HouseFloodlightConfig;

function validateConfig(config: HouseSafetyDeviceConfig, expectedKind?: SafetyKind): void {
  if (!config.id.trim() || !config.name.trim()) throw new Error('Safety device id and name are required');
  if (expectedKind && config.kind !== expectedKind) throw new Error(`Expected ${expectedKind} config: ${config.id}`);
  if (config.floor !== undefined && (!Number.isInteger(config.floor) || config.floor < 0)) {
    throw new Error('Safety device floor must be a non-negative integer: ' + config.id);
  }
  if (config.pose?.position && !Array.isArray(config.pose.position)) {
    const position = config.pose.position as THREE.Vector3;
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new Error('Safety device position must be finite: ' + config.id);
  } else if (Array.isArray(config.pose?.position) && !config.pose.position.every(Number.isFinite)) {
    throw new Error('Safety device position must be finite: ' + config.id);
  }
}

function buildModule<K extends SafetyKind>(
  config: HouseSafetyDeviceConfig<K>,
  root: THREE.Group,
  category: string,
  capabilities: Iterable<readonly [string, unknown]> = [],
  update?: (dt: number) => void,
  dispose?: () => void,
  onStatusChange?: (status: DeviceStatus) => void,
): SceneModule {
  validateConfig(config);
  root.name = config.id;
  const info: ModuleInfo = {
    ...config.info,
    name: config.name,
    category: config.info?.category ?? category,
    room: config.room,
    floor: config.floor,
    status: 'normal',
    data: { ...(config.info?.data ?? {}) },
  };
  root.userData.deviceId = config.id;
  root.userData.info = info;
  let status: DeviceStatus = 'normal';
  const deviceStatus: DeviceStatusCapability = {
    getStatus: () => status,
    setStatus(value) { status = value; info.status = value; onStatusChange?.(value); },
  };
  const module = new SceneModule({
    id: config.id,
    kind: 'device',
    root,
    info,
    update,
    dispose,
    disposeResources: true,
    capabilities: [
      [MODULE_CAPABILITY.deviceKind, config.kind],
      [MODULE_CAPABILITY.deviceStatus, deviceStatus],
      ...capabilities,
    ],
  });
  if (config.pose) module.place(config.pose);
  return module;
}

function addLed(root: THREE.Object3D, radius: number, position: readonly [number, number, number]) {
  const led = statusLed(radius);
  led.position.set(...position);
  root.add(led);
  return led;
}

export function createHouseEnvironmentSensor(config: HouseEnvironmentSensorConfig): SceneModule {
  validateConfig(config, 'environmentSensor');
  const root = new THREE.Group();
  root.add(box(0.08, 0.08, 0.025, 'plastic', 0, 0, 0.012));
  const led = addLed(root, 0.008, [0, 0.06, 0.026]);
  const readings = {
    temperatureC: config.initialReadings?.temperatureC ?? 23,
    humidityPercent: config.initialReadings?.humidityPercent ?? 45,
    pm25MicrogramsM3: config.initialReadings?.pm25MicrogramsM3 ?? 12,
    co2Ppm: config.initialReadings?.co2Ppm ?? 620,
  } satisfies EnvironmentReadings;
  for (const value of Object.values(readings)) if (!Number.isFinite(value)) throw new Error(`Environment readings must be finite: ${config.id}`);
  const capability: EnvironmentSensorCapability = {
    getReadings: () => ({ ...readings }),
    setReadings(patch) {
      if (patch.temperatureC !== undefined) readings.temperatureC = THREE.MathUtils.clamp(patch.temperatureC, -20, 60);
      if (patch.humidityPercent !== undefined) readings.humidityPercent = THREE.MathUtils.clamp(patch.humidityPercent, 0, 100);
      if (patch.pm25MicrogramsM3 !== undefined) readings.pm25MicrogramsM3 = Math.max(0, patch.pm25MicrogramsM3);
      if (patch.co2Ppm !== undefined) readings.co2Ppm = Math.max(0, patch.co2Ppm);
      module.mergeInfoData({
        温度: `${readings.temperatureC.toFixed(1)} ℃`,
        湿度: `${readings.humidityPercent.toFixed(0)} %`,
        PM2_5: `${readings.pm25MicrogramsM3.toFixed(0)} μg/m³`,
        'CO₂': `${readings.co2Ppm.toFixed(0)} ppm`,
      });
    },
  };
  let module: SceneModule;
  module = buildModule(config, root, '智慧 / 传感器', [[DEVICE_CAPABILITY.environmentSensor, capability]], undefined, undefined,
    (status) => led.material.emissive.setHex(STATUS_COLOR[status]));
  capability.setReadings(readings);
  return module;
}

export function createHousePresenceSensor(config: HousePresenceSensorConfig): SceneModule {
  validateConfig(config, 'presenceSensor');
  const root = new THREE.Group();
  const sensor = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('plastic'));
  sensor.rotation.x = Math.PI;
  root.add(sensor);
  const led = addLed(root, 0.008, [0.035, 0, 0]);
  let module: SceneModule;
  let occupied = config.initiallyOccupied ?? false;
  const setOccupied = (value: boolean) => {
    occupied = value;
    led.material.emissive.setHex(occupied ? 0x36d399 : STATUS_COLOR.off);
    module.mergeInfoData({ 检测结果: occupied ? '检测到有人' : '无人' });
  };
  const capability: PresenceSensorCapability = { isOccupied: () => occupied, setOccupied };
  module = buildModule(config, root, '智慧 / 传感器', [[DEVICE_CAPABILITY.presenceSensor, capability]]);
  setOccupied(occupied);
  return module;
}

export function createHouseSmokeSensor(config: HouseSmokeSensorConfig): SceneModule {
  validateConfig(config, 'smokeSensor');
  const threshold = config.alarmThreshold ?? 0.35;
  let density = config.initialDensity ?? 0;
  if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(density) || density < 0) {
    throw new Error(`Smoke density and alarm threshold must be valid: ${config.id}`);
  }
  const root = new THREE.Group();
  root.add(cylinder(0.07, 0.08, 0.04, 'plastic', 0, 0, 0, 20));
  const led = addLed(root, 0.01, [0.04, -0.005, 0]);
  let module: SceneModule;
  const sensor: ScalarSensorCapability = {
    getValue: () => density,
    getUnit: () => 'dB/m',
    getAlarmThreshold: () => threshold,
    getFaultThreshold: () => threshold,
    setValue(value) {
      if (!Number.isFinite(value) || value < 0) throw new Error('Smoke density must be a non-negative finite number');
      density = value;
      module.mergeInfoData({ 烟雾浓度: `${density.toFixed(2)} dB/m` });
      const status = density >= threshold ? 'fault' : 'normal';
      module.getCapability<DeviceStatusCapability>(MODULE_CAPABILITY.deviceStatus)?.setStatus(status);
    },
  };
  module = buildModule(config, root, '消防设施', [[DEVICE_CAPABILITY.smokeSensor, sensor]], undefined, undefined,
    (status) => led.material.emissive.setHex(STATUS_COLOR[status]));
  sensor.setValue(density);
  return module;
}

export function createHouseGasDetector(config: HouseGasDetectorConfig): SceneModule {
  validateConfig(config, 'gasDetector');
  const threshold = config.alarmThreshold ?? 10;
  const faultThreshold = config.faultThreshold ?? 20;
  let concentration = config.initialConcentration ?? 0;
  if (!Number.isFinite(threshold) || threshold <= 0 || !Number.isFinite(faultThreshold) || faultThreshold <= threshold || faultThreshold > 100
      || !Number.isFinite(concentration) || concentration < 0) {
    throw new Error(`Gas concentration and alarm threshold must be valid: ${config.id}`);
  }
  const root = new THREE.Group();
  root.add(box(0.12, 0.16, 0.04, 'plastic', 0, 0, 0.02));
  const led = addLed(root, 0.012, [0, 0.12, 0.042]);
  let module: SceneModule;
  const sensor: ScalarSensorCapability = {
    getValue: () => concentration,
    getUnit: () => '%LEL',
    getAlarmThreshold: () => threshold,
    getFaultThreshold: () => faultThreshold,
    setValue(value) {
      if (!Number.isFinite(value) || value < 0) throw new Error('Gas concentration must be a non-negative finite number');
      concentration = Math.min(100, value);
      module.mergeInfoData({ 甲烷浓度: `${concentration.toFixed(0)} %LEL` });
      const status = concentration >= faultThreshold ? 'fault' : concentration >= threshold ? 'warning' : 'normal';
      module.getCapability<DeviceStatusCapability>(MODULE_CAPABILITY.deviceStatus)?.setStatus(status);
    },
  };
  module = buildModule(config, root, '安全 / 智慧', [[DEVICE_CAPABILITY.gasSensor, sensor]], undefined, undefined,
    (status) => led.material.emissive.setHex(STATUS_COLOR[status]));
  sensor.setValue(concentration);
  return module;
}

export function createHouseWaterLeakSensor(config: HouseWaterLeakSensorConfig): SceneModule {
  validateConfig(config, 'waterLeakSensor');
  const root = new THREE.Group();
  root.add(box(0.08, 0.02, 0.08, 'plastic', 0, 0, 0, { cast: false }));
  const leak = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3fa9f5 }));
  leak.position.y = 0.04;
  leak.visible = false;
  root.add(leak);
  let module: SceneModule;
  let leaking = config.initiallyLeaking ?? false;
  const setLeaking = (value: boolean) => {
    leaking = value;
    leak.visible = leaking;
    module.mergeInfoData({ 检测结果: leaking ? '检测到漏水' : '无积水' });
    module.getCapability<DeviceStatusCapability>(MODULE_CAPABILITY.deviceStatus)?.setStatus(leaking ? 'warning' : 'normal');
  };
  const sensor: WaterLeakSensorCapability = { isLeaking: () => leaking, setLeaking };
  module = buildModule(config, root, '安全 / 智慧', [[DEVICE_CAPABILITY.waterLeakSensor, sensor]]);
  setLeaking(leaking);
  return module;
}

function createHouseValveModule(config: HouseValveConfig): SceneModule {
  validateConfig(config);
  const gas = config.kind === 'gasValve';
  const root = new THREE.Group();
  const handleMaterial = gas
    ? mat('red')
    : uniqueMat({ color: 0x1f6fd1, roughness: 0.45 });
  let handle: THREE.Mesh;
  let led: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> | undefined; // 只有燃气阀门有状态灯
  if (gas) {
    root.add(cylinder(0.02, 0.02, 1.75, 'metal', 0, 1.25, 0, 10));
    root.add(box(0.12, 0.1, 0.1, 'darkMetal', 0, 1.2, 0.04), box(0.1, 0.12, 0.12, 'red', 0, 1.3, 0.08));
    handle = box(0.16, 0.02, 0.025, handleMaterial, 0, 1.24, 0.12);
    const pressureGauge = cylinder(0.015, 0.015, 0.6, 'metal', 0, 0, 0, 8);
    pressureGauge.rotation.x = Math.PI / 2;
    pressureGauge.position.set(0, 1.1, 0.3);
    root.add(handle, pressureGauge);
    led = addLed(root, 0.015, [0, 1.39, 0.12]);
  } else {
    root.add(cylinder(0.03, 0.03, 1.2, 'metal', 0, 0, 0, 8), box(0.14, 0.1, 0.1, 'darkMetal', 0, 0.5, 0.04));
    handle = box(0.16, 0.02, 0.025, handleMaterial, 0, 0.56, 0.1);
    handle.userData.dynamic = true;
    root.add(handle);
  }
  const initialOpen = config.initialOpen ?? true;
  let module: SceneModule;
  const setOpen = (open: boolean) => {
    handle.rotation.z = open ? 0 : Math.PI / 2;
    module.mergeInfoData({ 阀门: open ? '开启' : (gas ? '已切断' : '已关闭') });
  };
  const valve: ValveCapability = { isOpen: () => handle.rotation.z === 0, setOpen };
  const control: BooleanControlCapability = { getState: valve.isOpen, setState: setOpen };
  const power: PowerCapability = { isOn: valve.isOpen, setOn: setOpen };
  const statusHook = led ? (status: DeviceStatus) => led.material.emissive.setHex(STATUS_COLOR[status]) : undefined;
  module = buildModule(config, root, gas ? '燃气安全' : '水浸安全', [
    [MODULE_CAPABILITY.control, control],
    [DEVICE_CAPABILITY.power, power],
    [DEVICE_CAPABILITY.valve, valve],
  ], undefined, undefined, statusHook);
  setOpen(initialOpen);
  return module;
}

export function createHouseGasValve(config: HouseGasValveConfig): SceneModule {
  validateConfig(config, 'gasValve');
  return createHouseValveModule(config);
}

export function createHouseWaterValve(config: HouseWaterValveConfig): SceneModule {
  validateConfig(config, 'waterValve');
  return createHouseValveModule(config);
}

export function createHouseExtinguisher(config: HouseExtinguisherConfig): SceneModule {
  validateConfig(config, 'extinguisher');
  let remaining = config.initialRemainingPercent ?? 100;
  if (!Number.isFinite(remaining) || remaining < 0 || remaining > 100) {
    throw new Error(`Fire extinguisher remaining amount must be 0-100 percent: ${config.id}`);
  }
  const root = new THREE.Group();
  const body = cylinder(0.08, 0.08, 0.45, 'red', 0, 0, 0, 16);
  root.add(
    body,
    cylinder(0.03, 0.05, 0.08, 'darkMetal', 0, 0.45, 0, 8),
    box(0.12, 0.02, 0.03, 'blackPlastic', 0.04, 0.53, 0),
  );
  const plume = new THREE.Mesh(
    new THREE.ConeGeometry(0.16, 0.65, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xddeeff, transparent: true, opacity: 0.52, side: THREE.DoubleSide, depthWrite: false }),
  );
  plume.rotation.x = Math.PI / 2;
  plume.position.set(0.03, 0.38, 0.48);
  plume.visible = false;
  root.add(plume);
  let discharging = false;
  let elapsed = 0;
  let module: SceneModule;
  const stopDischarge = () => {
    discharging = false;
    plume.visible = false;
    module.mergeInfoData({ 状态: '待机', 灭火剂余量: `${remaining.toFixed(0)}%` });
  };
  const capability: FireExtinguisherCapability = {
    getRemainingPercent: () => remaining,
    setRemainingPercent(value) {
      if (!Number.isFinite(value)) throw new Error('Extinguisher remaining amount must be finite');
      remaining = THREE.MathUtils.clamp(value, 0, 100);
      if (remaining <= 0) stopDischarge();
      module.mergeInfoData({ 压力: `${(1.2 * remaining / 100).toFixed(2)} MPa`, 灭火剂余量: `${remaining.toFixed(0)}%` });
    },
    isDischarging: () => discharging,
    discharge() {
      if (remaining <= 0) return false;
      discharging = true;
      plume.visible = true;
      module.mergeInfoData({ 状态: '喷射中' });
      return true;
    },
    stopDischarge,
    reset() {
      remaining = 100;
      stopDischarge();
    },
  };
  module = buildModule(config, root, '消防设施', [[DEVICE_CAPABILITY.fireExtinguisher, capability]], (dt) => {
    if (!discharging) return;
    elapsed += dt;
    remaining = Math.max(0, remaining - dt * 8);
    plume.scale.set(0.8 + Math.sin(elapsed * 18) * 0.1, 0.8 + Math.sin(elapsed * 12) * 0.2, 1);
    if (remaining <= 0) stopDischarge();
    else if (Math.floor(elapsed * 4) !== Math.floor((elapsed - dt) * 4)) {
      module.mergeInfoData({ 灭火剂余量: `${remaining.toFixed(0)}%` });
    }
  });
  module.mergeInfoData({ 压力: `${(1.2 * remaining / 100).toFixed(2)} MPa`, 灭火剂余量: `${remaining.toFixed(0)}%` });
  return module;
}

export function createHouseFireBlanket(config: HouseFireBlanketConfig): SceneModule {
  validateConfig(config, 'blanket');
  const root = new THREE.Group();
  const pouch = new THREE.Group();
  pouch.add(box(0.3, 0.35, 0.08, 'red'), box(0.22, 0.035, 0.02, 'whiteGloss', 0, 0, 0.05));
  root.add(pouch);
  const blanket = new THREE.Mesh(
    new THREE.PlaneGeometry(1.1, 0.85),
    new THREE.MeshStandardMaterial({ color: 0xc7a66a, roughness: 0.95, side: THREE.DoubleSide }),
  );
  blanket.rotation.x = -Math.PI / 2;
  blanket.position.y = 0.03;
  blanket.visible = false;
  root.add(blanket);
  let deployed = config.initiallyDeployed ?? false;
  let module: SceneModule;
  const setDeployed = (value: boolean) => {
    deployed = value;
    pouch.visible = !deployed;
    blanket.visible = deployed;
    module.mergeInfoData({ 状态: deployed ? '已展开' : '收纳中' });
  };
  const capability: FireBlanketCapability = {
    isDeployed: () => deployed,
    deploy: () => setDeployed(true),
    reset: () => setDeployed(false),
  };
  module = buildModule(config, root, '消防设施', [[DEVICE_CAPABILITY.fireBlanket, capability]]);
  setDeployed(deployed);
  return module;
}

function lightPool(context?: HouseSafetyFactoryContext): LightPool | undefined { return context?.lightPool; }

function factoryLight(
  pool: LightPool | undefined,
  root: THREE.Group,
  localPosition: THREE.Vector3,
  color: number,
  distance: number,
  priority: number,
) {
  const lamp = pool?.add({ position: localPosition.clone(), color: new THREE.Color(color), intensity: 0, distance, priority });
  const pointLight = pool ? undefined : new THREE.PointLight(color, 0, distance, 2);
  if (pointLight) {
    pointLight.position.copy(localPosition);
    root.add(pointLight);
  }
  const update = () => {
    if (!lamp) return;
    root.updateWorldMatrix(true, false);
    lamp.position.copy(root.localToWorld(localPosition.clone()));
  };
  update();
  return {
    setIntensity(value: number) {
      if (lamp) lamp.intensity = value;
      if (pointLight) pointLight.intensity = value;
    },
    setColor(color: THREE.Color) {
      if (lamp) lamp.color.copy(color);
      if (pointLight) pointLight.color.copy(color);
    },
    update,
    dispose: () => { if (lamp) pool?.remove(lamp); },
  };
}

export function createHouseStrobe(config: HouseStrobeConfig, context?: HouseSafetyFactoryContext): SceneModule {
  validateConfig(config, 'alarm');
  const root = new THREE.Group();
  const material = uniqueMat({ color: 0x661111, emissive: 0xff2020, emissiveIntensity: 0, transparent: true, opacity: 0.95 });
  root.add(box(0.14, 0.14, 0.05, 'plastic', 0, 0, 0.025));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), material);
  dome.rotation.x = Math.PI / 2;
  dome.position.set(0, 0.07, 0.05);
  root.add(dome);
  const lampPosition = new THREE.Vector3(...(config.lightPosition ?? [0, 0.2, 0.05] as const));
  const alarmLight = factoryLight(lightPool(context), root, lampPosition, 0xff2020, 14, 5);
  let active = false;
  let elapsed = 0;
  let intensity = 5;
  let module: SceneModule;
  const applyIntensity = (value: number) => {
    material.emissiveIntensity = active ? value : 0;
    alarmLight.setIntensity(active ? value * 3 : 0);
  };
  const indicator: IndicatorCapability = {
    getIntensity: () => intensity,
    setIntensity(value) {
      intensity = THREE.MathUtils.clamp(value, 0, 16);
      applyIntensity(intensity);
    },
  };
  const alarm: FireAlarmCapability = {
    isActive: () => active,
    activate() { active = true; module.mergeInfoData({ 状态: '报警中' }); },
    deactivate() { active = false; applyIntensity(0); module.mergeInfoData({ 状态: '待机' }); },
  };
  module = buildModule(config, root, '消防设施', [
    [DEVICE_CAPABILITY.indicator, indicator], [DEVICE_CAPABILITY.fireAlarm, alarm],
  ], (dt) => {
    alarmLight.update();
    if (!active) return;
    elapsed += dt;
    const pulse = intensity * (0.65 + 0.35 * Math.max(0, Math.sin(elapsed * 17)));
    material.emissiveIntensity = pulse;
    alarmLight.setIntensity(pulse * 3);
  }, alarmLight.dispose);
  return module;
}

export function createHouseExitSign(config: HouseExitSignConfig): SceneModule {
  validateConfig(config, 'exitSign');
  const lines = config.textLines ?? ['安全出口', 'EXIT'];
  const texture = textTexture(lines, { w: 256, h: 110, bg: '#0f7a3a', font: 'bold 40px "Microsoft YaHei", sans-serif' });
  const material = new THREE.MeshStandardMaterial({ map: texture, emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.4 });
  const root = new THREE.Group();
  root.add(box(0.42, 0.2, 0.03, 'plastic', 0, 0, 0.015));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.17), material);
  face.position.set(0, 0.1, 0.032);
  root.add(face);
  const indicator: IndicatorCapability = {
    getIntensity: () => material.emissiveIntensity,
    setIntensity(value) { brightness = THREE.MathUtils.clamp(value, 0, 16); apply(); },
  };
  let on = config.initialOn ?? true;
  let module: SceneModule;
  const apply = () => { material.emissiveIntensity = on ? brightness : 0; };
  const setOn = (value: boolean) => {
    on = value;
    apply();
    module.mergeInfoData({ 状态: on ? '点亮' : '关闭' });
  };
  const power: PowerCapability = { isOn: () => on, setOn };
  let brightness = material.emissiveIntensity;
  module = buildModule(config, root, '消防设施', [
    [DEVICE_CAPABILITY.indicator, indicator], [DEVICE_CAPABILITY.power, power],
  ]);
  setOn(on);
  return module;
}

export function createHouseEmergencyLight(config: HouseEmergencyLightConfig): SceneModule {
  validateConfig(config, 'emergencyLight');
  const root = new THREE.Group();
  root.add(box(0.3, 0.08, 0.1, uniqueMat({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 })));
  const material = root.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  const surface = material.material;
  let on = config.initialOn ?? false;
  let brightness = 5;
  let module: SceneModule;
  const apply = () => { surface.emissiveIntensity = on ? brightness : 0; };
  const indicator: IndicatorCapability = {
    getIntensity: () => brightness,
    setIntensity(value) { brightness = THREE.MathUtils.clamp(value, 0, 16); apply(); },
  };
  const setOn = (value: boolean) => {
    on = value;
    apply();
    module.mergeInfoData({ 状态: on ? '照明中' : '待机' });
  };
  const power: PowerCapability = { isOn: () => on, setOn };
  module = buildModule(config, root, '消防设施', [
    [DEVICE_CAPABILITY.indicator, indicator], [DEVICE_CAPABILITY.power, power],
  ]);
  setOn(on);
  return module;
}

export function createHouseSosButton(config: HouseSosButtonConfig): SceneModule {
  validateConfig(config, 'sosButton');
  const root = new THREE.Group();
  root.add(box(0.12, 0.12, 0.03, 'plastic', 0, 0, 0.015));
  const buttonMaterial = uniqueMat({ color: 0xcc2222, emissive: 0xff0000, emissiveIntensity: 0.15 });
  const button = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), buttonMaterial);
  button.rotation.x = Math.PI / 2;
  button.position.set(0, 0.06, 0.035);
  root.add(button);
  root.add(cylinder(0.003, 0.003, 0.6, 'plastic', 0, -0.55, 0.03, 4));
  root.add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat('red')).translateY(-0.56).translateZ(0.03));
  let active = false;
  let module: SceneModule;
  const setActive = (value: boolean) => {
    active = value;
    buttonMaterial.emissiveIntensity = active ? 1.5 : 0.15;
    module.setInfoData('状态', active ? '呼叫中' : '待机');
  };
  const sos: SosCapability = {
    isActive: () => active,
    activate: () => setActive(true),
    deactivate: () => setActive(false),
    setIndicator(intensity) { buttonMaterial.emissiveIntensity = THREE.MathUtils.clamp(intensity, 0, 3); },
  };
  const control: BooleanControlCapability = { getState: () => active, setState: setActive };
  module = buildModule(config, root, '安全 / 适老', [
    [MODULE_CAPABILITY.control, control],
    [DEVICE_CAPABILITY.sos, sos],
  ]);
  module.setInfoData('状态', '待机');
  return module;
}

export function createHouseDistributionPanel(config: HouseSafetyDeviceConfig<'distributionPanel'>): SceneModule {
  validateConfig(config, 'distributionPanel');
  const root = new THREE.Group();
  root.add(box(0.45, 0.55, 0.12, 'whiteGloss', 0, 0, 0.06));
  const led = addLed(root, 0.015, [0.17, 0.5, 0.125]);
  const circuits = [
    { id: 'lighting', label: '照明回路', isOn: true },
    { id: 'outlets', label: '插座回路', isOn: true },
    { id: 'hvac', label: '暖通回路', isOn: true },
    { id: 'safety', label: '安防回路', isOn: true },
  ];
  const handles = circuits.map((circuit, index) => {
    const handle = box(0.055, 0.14, 0.025, uniqueMat({ color: 0x354451, roughness: 0.5 }),
      -0.12 + index * 0.08, 0.12, 0.14);
    handle.userData.dynamic = true;
    root.add(handle);
    return handle;
  });
  let module: SceneModule;
  const capability: CircuitBreakerCapability = {
    getCircuits: () => circuits.map(({ id, label, isOn }) => ({ id, label, isOn })),
    setCircuit(id, isOn) {
      const index = circuits.findIndex((circuit) => circuit.id === id);
      if (index < 0) throw new Error(`Unknown distribution circuit: ${id}`);
      circuits[index].isOn = isOn;
      handles[index].rotation.x = isOn ? 0 : Math.PI / 2.5;
      module.mergeInfoData({ 回路: circuits.map((circuit) => `${circuit.label}${circuit.isOn ? '通' : '断'}`).join(' / ') });
    },
  };
  module = buildModule(config, root, '安全 / 绿色', [[DEVICE_CAPABILITY.circuits, capability]], undefined, undefined,
    (status) => led.material.emissive.setHex(STATUS_COLOR[status]));
  module.mergeInfoData({ 回路: circuits.map((circuit) => `${circuit.label}通`).join(' / ') });
  return module;
}

export function createHouseGateway(config: HouseSafetyDeviceConfig<'gateway'>): SceneModule {
  validateConfig(config, 'gateway');
  const root = new THREE.Group();
  root.add(box(0.2, 0.2, 0.04, 'whiteGloss', 0, 0, 0.02, { rounded: 0.01 }));
  const led = addLed(root, 0.01, [0, 0.15, 0.042]);
  let online = true;
  let signalStrength = 92;
  let module: SceneModule;
  const apply = () => {
    led.material.emissive.setHex(online ? (signalStrength < 30 ? 0xf1c40f : STATUS_COLOR.normal) : STATUS_COLOR.fault);
    led.material.emissiveIntensity = online ? 0.4 + signalStrength / 45 : 0.3;
  };
  const network: NetworkCapability = {
    isOnline: () => online,
    setOnline(value) { online = value; apply(); module.mergeInfoData({ 网络: online ? '在线' : '离线', 信号强度: `${signalStrength}%` }); },
    getSignalStrength: () => signalStrength,
    setSignalStrength(value) {
      if (!Number.isFinite(value)) throw new Error('Network signal strength must be finite');
      signalStrength = THREE.MathUtils.clamp(value, 0, 100);
      apply();
      module.mergeInfoData({ 网络: online ? '在线' : '离线', 信号强度: `${signalStrength.toFixed(0)}%` });
    },
  };
  module = buildModule(config, root, '智慧', [[DEVICE_CAPABILITY.network, network]], undefined, undefined,
    (status) => { led.material.emissive.setHex(STATUS_COLOR[status]); });
  apply();
  network.setOnline(online);
  return module;
}

export function createHouseIntercom(config: HouseSafetyDeviceConfig<'intercom'>): SceneModule {
  validateConfig(config, 'intercom');
  const root = new THREE.Group();
  root.add(box(0.18, 0.26, 0.03, 'blackPlastic', 0, 0, 0.015));
  const screenMaterial = uniqueMat({ color: 0x111111, emissive: 0x4488ff, emissiveIntensity: 0.3 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1), screenMaterial);
  screen.position.set(0, 0.16, 0.031);
  root.add(screen);
  let calling = false;
  let unlockRequested = false;
  let module: SceneModule;
  const intercom: IntercomCapability = {
    isCalling: () => calling,
    startCall() {
      calling = true;
      screenMaterial.emissiveIntensity = 2.2;
      screenMaterial.emissive.setHex(0x42c8ff);
      module.mergeInfoData({ 通话: '通话中' });
    },
    hangUp() {
      calling = false;
      screenMaterial.emissiveIntensity = 0.3;
      screenMaterial.emissive.setHex(0x4488ff);
      module.mergeInfoData({ 通话: '待机' });
    },
    requestDoorUnlock() {
      unlockRequested = true;
      module.mergeInfoData({ 开门请求: '已发出；由场景控制器决定是否执行' });
    },
  };
  module = buildModule(config, root, '智慧 / 安防', [[DEVICE_CAPABILITY.intercom, intercom]]);
  module.mergeInfoData({ 通话: '待机', 开门请求: unlockRequested ? '已发出' : '无' });
  return module;
}

export function createHouseSmartLock(config: HouseSmartLockConfig, context: HouseSmartLockFactoryContext = {}): SceneModule {
  validateConfig(config, 'smartLock');
  const root = new THREE.Group();
  root.add(box(0.07, 0.28, 0.04, 'blackPlastic'));
  const led = addLed(root, 0.01, [0, 0.22, 0.022]);
  let locked = config.initiallyLocked ?? true;
  let module: SceneModule;
  const setLocked = (value: boolean) => {
    locked = value;
    led.material.emissive.setHex(locked ? 0x3fa9f5 : STATUS_COLOR.normal);
    module.setInfoData('状态', locked ? '已上锁' : '已开锁');
  };
  const lock: LockCapability = { isLocked: () => locked, setLocked };
  const control: BooleanControlCapability = { getState: () => locked, setState: setLocked };
  const power: PowerCapability = { isOn: () => locked, setOn: setLocked };
  module = buildModule(config, root, '智慧 / 安防', [
    [MODULE_CAPABILITY.control, control],
    [DEVICE_CAPABILITY.power, power],
    [DEVICE_CAPABILITY.lock, lock],
  ], undefined, undefined, (status) => led.material.emissive.setHex(STATUS_COLOR[status]));
  setLocked(locked);
  if (config.doorId && context.openings && !context.openings.attachToLeaf(config.doorId, module)) {
    throw new Error(`Smart lock ${config.id}: door ${config.doorId} has no hinged leaf`);
  }
  return module;
}

export function createHouseCamera(config: HouseCameraConfig): SceneModule {
  validateConfig(config, 'camera');
  if (config.yawOffset !== undefined && !Number.isFinite(config.yawOffset)) {
    throw new Error('Camera yaw offset must be finite: ' + config.id);
  }
  const root = new THREE.Group();
  root.add(box(0.1, 0.1, 0.22, 'whiteGloss', 0, 0, 0.11, { rounded: 0.02 }));
  const lens = cylinder(0.03, 0.03, 0.02, 'blackPlastic', 0, -0.01, 0.22, 12);
  lens.rotateX(Math.PI / 2);
  root.add(lens);
  const led = addLed(root, 0.008, [0.04, 0.06, 0.18]);
  const coneMaterial = new THREE.MeshBasicMaterial({ color: 0x3fa9f5, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide });
  const cone = new THREE.Mesh(new THREE.ConeGeometry(3.5, 8, 24, 1, true), coneMaterial);
  cone.geometry.translate(0, -4, 0);
  cone.rotation.x = -Math.PI / 2 - 0.3;
  cone.visible = false;
  cone.userData.noPick = true;
  cone.userData.dynamic = true;
  root.add(cone);
  const camera: CameraCapability = {
    isArmed: () => cone.visible,
    setArmed(armed) { cone.visible = armed; module.setInfoData('状态', armed ? '已布防' : '在线'); },
    setAlert(active) { coneMaterial.color.setHex(active ? 0xff3030 : 0x3fa9f5); },
  };
  let module: SceneModule;
  module = buildModule(config, root, '智慧 / 安防', [[DEVICE_CAPABILITY.camera, camera]], undefined, undefined,
    (status) => led.material.emissive.setHex(STATUS_COLOR[status]));
  // Apply the offset after buildModule has copied the configured placement rotation.
  root.rotation.y += config.yawOffset ?? 0;
  return module;
}

export function createHouseFloodlight(config: HouseFloodlightConfig, context?: HouseSafetyFactoryContext): SceneModule {
  validateConfig(config, 'floodlight');
  const initialBrightness = config.initialBrightness ?? 1;
  const initialColorTemperature = config.initialColorTemperature ?? 4000;
  if (!Number.isFinite(initialBrightness) || initialBrightness < 0 || initialBrightness > 1
      || !Number.isFinite(initialColorTemperature) || initialColorTemperature < 2700 || initialColorTemperature > 6500) {
    throw new Error(`Floodlight brightness or color temperature is invalid: ${config.id}`);
  }
  const fixtures = config.fixtures ?? [[0, 3, 0], [0.2, 3, 0]];
  if (fixtures.some((fixture) => !fixture.every(Number.isFinite))) {
    throw new Error('Floodlight fixtures must contain finite coordinates: ' + config.id);
  }
  const root = new THREE.Group();
  const initialColor = kelvinToColor(initialColorTemperature);
  const material = uniqueMat({ color: 0xffffff, emissive: initialColor, emissiveIntensity: 0 });
  for (const [x, y, z] of fixtures) root.add(box(0.1, 0.12, 0.25, material, x, y, z));
  const localLightPosition = new THREE.Vector3(...(config.lightPosition ?? [0, 3, 0] as const));
  const floodLamp = factoryLight(lightPool(context), root, localLightPosition, initialColor.getHex(), 16, 3);
  let on = config.initialOn ?? false;
  let brightness = initialBrightness;
  let colorTemperature = initialColorTemperature;
  let module: SceneModule;
  const apply = () => {
    const color = kelvinToColor(colorTemperature);
    material.emissive.copy(color);
    material.emissiveIntensity = on ? brightness * 3 : 0;
    floodLamp.setColor(color);
    floodLamp.setIntensity(on ? brightness * 40 : 0);
    module.mergeInfoData({ 状态: on ? '开启' : '关闭', 亮度: `${Math.round(brightness * 100)}%`, 色温: `${colorTemperature} K` });
  };
  const setOn = (value: boolean) => { on = value; apply(); };
  const control: BooleanControlCapability = { getState: () => on, setState: setOn };
  const power: PowerCapability = { isOn: () => on, setOn };
  const lighting: LightingCapability = {
    ...power,
    getBrightness: () => brightness,
    setBrightness(value) { brightness = THREE.MathUtils.clamp(value, 0, 1); apply(); },
    getColorTemperature: () => colorTemperature,
    setColorTemperature(value) { colorTemperature = THREE.MathUtils.clamp(value, 2700, 6500); apply(); },
    getSourcePosition: () => root.localToWorld(localLightPosition.clone()),
    getSourceColor: () => material.emissive.clone(),
  };
  module = buildModule(config, root, '安防照明', [
    [MODULE_CAPABILITY.control, control],
    [DEVICE_CAPABILITY.power, power],
    [DEVICE_CAPABILITY.lighting, lighting],
  ], floodLamp.update, floodLamp.dispose);
  apply();
  return module;
}

function poolFromFactoryContext(context: ModuleFactoryContext): LightPool | undefined {
  return context.services?.get(MODULE_SERVICE.lightPool) as LightPool | undefined;
}

function openingsFromFactoryContext(context: ModuleFactoryContext): OpeningsService | undefined {
  return context.services?.get(MODULE_SERVICE.openings) as OpeningsService | undefined;
}

export function houseSafetyDeviceDefinitions(): SceneModuleDefinition<SafetyConfig>[] {
  const plain = <K extends SafetyKind>(id: string, kind: K, create: (config: HouseSafetyDeviceConfig<K>) => SceneModule) => ({
    id,
    kind: 'device' as const,
    create: (_context: ModuleFactoryContext, config: SafetyConfig) => create(config as HouseSafetyDeviceConfig<K>),
  });
  return [
    plain('house-environment-sensor', 'environmentSensor', createHouseEnvironmentSensor),
    plain('house-presence-sensor', 'presenceSensor', createHousePresenceSensor),
    plain('house-smoke-sensor', 'smokeSensor', createHouseSmokeSensor),
    plain('house-gas-detector', 'gasDetector', createHouseGasDetector),
    plain('house-water-leak-sensor', 'waterLeakSensor', createHouseWaterLeakSensor),
    {
      id: 'house-gas-valve', kind: 'device',
      create: (_context, config) => {
        const valve = config as HouseGasValveConfig;
        if (valve.kind !== 'gasValve') throw new Error('house-gas-valve requires kind "gasValve"');
        return createHouseGasValve(valve);
      },
    },
    {
      id: 'house-water-valve', kind: 'device',
      create: (_context, config) => {
        const valve = config as HouseWaterValveConfig;
        if (valve.kind !== 'waterValve') throw new Error('house-water-valve requires kind "waterValve"');
        return createHouseWaterValve(valve);
      },
    },
    plain('house-extinguisher', 'extinguisher', createHouseExtinguisher),
    plain('house-fire-blanket', 'blanket', createHouseFireBlanket),
    { id: 'house-strobe', kind: 'device', create: (context, config) => createHouseStrobe(config as HouseStrobeConfig, { lightPool: poolFromFactoryContext(context) }) },
    { id: 'house-exit-sign', kind: 'device', create: (_context, config) => createHouseExitSign(config as HouseExitSignConfig) },
    plain('house-emergency-light', 'emergencyLight', createHouseEmergencyLight),
    { id: 'house-sos-button', kind: 'device', create: (_context, config) => createHouseSosButton(config as HouseSosButtonConfig) },
    plain('house-distribution-panel', 'distributionPanel', createHouseDistributionPanel),
    plain('house-gateway', 'gateway', createHouseGateway),
    plain('house-intercom', 'intercom', createHouseIntercom),
    { id: 'house-smart-lock', kind: 'device', create: (context, config) => createHouseSmartLock(config as HouseSmartLockConfig, { openings: openingsFromFactoryContext(context) }) },
    { id: 'house-camera', kind: 'device', create: (_context, config) => createHouseCamera(config as HouseCameraConfig) },
    { id: 'house-floodlight', kind: 'device', create: (context, config) => createHouseFloodlight(config as HouseFloodlightConfig, { lightPool: poolFromFactoryContext(context) }) },
  ];
}

