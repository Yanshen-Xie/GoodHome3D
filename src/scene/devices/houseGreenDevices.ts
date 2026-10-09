import * as THREE from 'three';
import { box, cylinder, mat, uniqueMat } from '../common.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../../modules/contracts';
import { STATUS_COLOR } from './deviceVisuals.js';
import type {
  BatteryCapability,
  BooleanControlCapability,
  DeviceStatus,
  DeviceStatusCapability,
  EnergyOutputCapability,
  FilterCapability,
  IndicatorCapability,
  InverterCapability,
  IrrigationCapability,
  ModuleInfo,
  ModulePose,
  PowerCapability,
  RotatingCapability,
  SceneModuleDefinition,
  TankLevelCapability,
} from '../../modules/contracts';
import { SceneModule } from '../../modules/runtime.js';

interface HouseGreenDeviceBase<K extends string> {
  readonly kind: K;
  readonly id: string;
  readonly name: string;
  readonly room?: string | null;
  readonly floor?: number;
  readonly pose?: ModulePose;
  readonly info?: Partial<ModuleInfo>;
}

export interface HouseSolarArrayConfig extends HouseGreenDeviceBase<'solarPanel'> {
  readonly panelOffsets: readonly (readonly [number, number, number])[];
  readonly panelWidth: number;
  readonly panelThickness: number;
  readonly panelDepth: number;
  readonly tiltRadians: number;
  readonly ratedPowerKW?: number;
  readonly initialPowerKW?: number;
}

export interface HouseInverterConfig extends HouseGreenDeviceBase<'inverter'> {
  readonly initialInputPowerKW?: number;
  readonly efficiencyPercent?: number;
}

export interface HouseBatteryConfig extends HouseGreenDeviceBase<'battery'> {
  readonly initialChargePercent?: number;
  readonly capacityKWh?: number;
}

export interface HouseHeatPumpConfig extends HouseGreenDeviceBase<'heatPump'> {
  readonly initialRunning?: boolean;
  readonly rotationSpeed?: number;
}

export interface HouseWaterTankConfig extends HouseGreenDeviceBase<'waterTank'> {
  readonly capacityLiters?: number;
  readonly initialLevelPercent?: number;
}

export interface HouseChargerConfig extends HouseGreenDeviceBase<'charger'> {
  readonly initialOn?: boolean;
  readonly chargingPowerKW?: number;
  readonly initialVehicleChargePercent?: number;
}

export interface HouseRainFilterConfig extends HouseGreenDeviceBase<'rainFilter'> {
  readonly initialHealthPercent?: number;
}

export interface HouseRainSystemConfig extends HouseGreenDeviceBase<'rainSystem'> {
  readonly sprinklers: readonly { readonly x: number; readonly z: number }[];
}

type HouseGreenConfig = HouseSolarArrayConfig | HouseInverterConfig | HouseBatteryConfig
  | HouseHeatPumpConfig | HouseWaterTankConfig | HouseChargerConfig
  | HouseRainFilterConfig | HouseRainSystemConfig;

function validateBase(config: HouseGreenDeviceBase<string>, expectedKind?: HouseGreenConfig['kind']): void {
  if (!config.id.trim() || !config.name.trim()) throw new Error('Green device id and name are required');
  if (expectedKind && config.kind !== expectedKind) {
    throw new Error(`Expected ${expectedKind} config for green device factory: ${config.id}`);
  }
  if (config.floor !== undefined && (!Number.isInteger(config.floor) || config.floor < 0)) {
    throw new Error('Green device floor must be a non-negative integer: ' + config.id);
  }
}

function createModule<K extends HouseGreenConfig['kind']>(
  config: HouseGreenDeviceBase<K>,
  category: string,
  root: THREE.Group,
  extraCapabilities: Iterable<readonly [string, unknown]> = [],
  update?: (dt: number) => void,
  onStatusChange?: (status: DeviceStatus) => void,
): { module: SceneModule; info: ModuleInfo } {
  validateBase(config);
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
    disposeResources: true,
    capabilities: [
      [MODULE_CAPABILITY.deviceKind, config.kind],
      [MODULE_CAPABILITY.deviceStatus, deviceStatus],
      ...extraCapabilities,
    ],
  });
  if (config.pose) module.place(config.pose);
  return { module, info };
}

function validatePoseCoordinates(pose?: ModulePose, id = 'device'): void {
  const validateVector = (key: 'position' | 'rotation' | 'scale', value: unknown) => {
    if (value === undefined) return;
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Device ${key} must be finite: ${id}`);
      return;
    }
    const parts = Array.isArray(value)
      ? value
      : value && typeof value === 'object'
        ? [(value as { x?: number }).x, (value as { y?: number }).y, (value as { z?: number }).z]
        : [];
    if (!parts.length || !parts.every(Number.isFinite)) throw new Error(`Device ${key} must be finite: ${id}`);
  };
  validateVector('position', pose?.position);
  validateVector('rotation', pose?.rotation);
  validateVector('scale', pose?.scale);
}

export function createHouseSolarArray(config: HouseSolarArrayConfig): SceneModule {
  validateBase(config, 'solarPanel');
  validatePoseCoordinates(config.pose);
  if (config.panelOffsets.length === 0 || config.panelOffsets.some((position) => !position.every(Number.isFinite))) {
    throw new Error('Solar array requires finite panel positions: ' + config.id);
  }
  if (![config.panelWidth, config.panelThickness, config.panelDepth, config.tiltRadians].every(Number.isFinite)
      || config.panelWidth <= 0 || config.panelThickness <= 0 || config.panelDepth <= 0) {
    throw new Error('Solar panel dimensions must be positive and tilt finite: ' + config.id);
  }
  const ratedPower = config.ratedPowerKW ?? 2.5;
  const initialPower = config.initialPowerKW ?? ratedPower * 0.72;
  if (!Number.isFinite(ratedPower) || ratedPower <= 0 || !Number.isFinite(initialPower) || initialPower < 0 || initialPower > ratedPower) {
    throw new Error('Solar array power must be within its positive rated output: ' + config.id);
  }
  const root = new THREE.Group();
  const geometry = new THREE.BoxGeometry(config.panelWidth, config.panelThickness, config.panelDepth);
  const panelMaterial = mat('solar').clone();
  panelMaterial.emissive.setHex(0x3c9ce8);
  for (const [x, y, z] of config.panelOffsets) {
    const panel = new THREE.Mesh(geometry, panelMaterial);
    panel.position.set(x, y, z);
    panel.rotation.x = config.tiltRadians;
    panel.castShadow = true;
    panel.receiveShadow = true;
    root.add(panel);
  }
  let module: SceneModule;
  let outputPower = initialPower;
  const generation: EnergyOutputCapability = {
    getPowerKW: () => outputPower,
    getRatedPowerKW: () => ratedPower,
    setPowerKW(value) {
      if (!Number.isFinite(value)) throw new Error('Solar output must be finite');
      outputPower = THREE.MathUtils.clamp(value, 0, ratedPower);
      panelMaterial.emissiveIntensity = outputPower / ratedPower * 0.8;
      module.mergeInfoData({ 当前发电: `${outputPower.toFixed(2)} kW`, 额定功率: `${ratedPower.toFixed(2)} kW` });
    },
  };
  module = createModule(config, '绿色低碳 / 光伏', root, [[DEVICE_CAPABILITY.generation, generation]]).module;
  generation.setPowerKW(initialPower);
  return module;
}

export function createHouseInverter(config: HouseInverterConfig): SceneModule {
  validateBase(config, 'inverter');
  validatePoseCoordinates(config.pose, config.id);
  const efficiency = config.efficiencyPercent ?? 96;
  let inputPower = config.initialInputPowerKW ?? 1.8;
  if (!Number.isFinite(efficiency) || efficiency <= 0 || efficiency > 100
      || !Number.isFinite(inputPower) || inputPower < 0 || inputPower > 20) {
    throw new Error('Inverter power and efficiency must be in range: ' + config.id);
  }
  const root = new THREE.Group();
  root.add(box(0.5, 0.6, 0.2, 'whiteGloss', 0, 0, 0.1, { rounded: 0.02 }));
  const screenMaterial = uniqueMat({ color: 0x111111, emissive: 0x33ff99, emissiveIntensity: 0.6 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), screenMaterial);
  screen.position.set(0, 0.42, 0.201);
  root.add(screen);
  const ledMaterial = uniqueMat({ color: 0x222222, emissive: 0x37d67a, emissiveIntensity: 2 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 12, 8), ledMaterial);
  led.position.set(0.18, 0.52, 0.2);
  root.add(led);
  let module: SceneModule;
  const inverter: InverterCapability = {
    getInputPowerKW: () => inputPower,
    setInputPowerKW(value) {
      if (!Number.isFinite(value)) throw new Error('Inverter input power must be finite');
      inputPower = THREE.MathUtils.clamp(value, 0, 20);
      screenMaterial.emissiveIntensity = inputPower > 0 ? 0.25 + inputPower / 8 : 0;
      ledMaterial.emissiveIntensity = inputPower > 0 ? 0.4 + inputPower / 5 : 0.15;
      module.mergeInfoData({ 输入功率: `${inputPower.toFixed(2)} kW`, 输出功率: `${(inputPower * efficiency / 100).toFixed(2)} kW` });
    },
    getOutputPowerKW: () => inputPower * efficiency / 100,
    getEfficiencyPercent: () => efficiency,
  };
  const indicator: IndicatorCapability = {
    getIntensity: () => ledMaterial.emissiveIntensity,
    setIntensity(value) {
      ledMaterial.emissiveIntensity = THREE.MathUtils.clamp(value, 0, 16);
    },
  };
  module = createModule(
    config,
    '绿色低碳',
    root,
    [[DEVICE_CAPABILITY.indicator, indicator], [DEVICE_CAPABILITY.inverter, inverter]],
    undefined,
    (status) => ledMaterial.emissive.setHex(STATUS_COLOR[status]),
  ).module;
  inverter.setInputPowerKW(inputPower);
  return module;
}

export function createHouseBattery(config: HouseBatteryConfig): SceneModule {
  validateBase(config, 'battery');
  validatePoseCoordinates(config.pose, config.id);
  const capacity = config.capacityKWh ?? 10;
  const initialCharge = config.initialChargePercent ?? 100;
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error('Battery capacity must be positive: ' + config.id);
  if (!Number.isFinite(initialCharge) || initialCharge < 0 || initialCharge > 100) {
    throw new Error('Battery charge must be between 0 and 100 percent: ' + config.id);
  }
  const root = new THREE.Group();
  root.add(box(0.6, 1.1, 0.4, 'whiteGloss', 0, 0, 0, { rounded: 0.03 }));
  const chargeBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.01), uniqueMat({
    color: 0x113311,
    emissive: 0x2ecc71,
    emissiveIntensity: 1,
  }));
  chargeBar.position.set(0.31, 0.55, 0);
  chargeBar.rotation.y = Math.PI / 2;
  chargeBar.userData.dynamic = true;
  root.add(chargeBar);
  let chargePercent = initialCharge;
  let module: SceneModule;
  const setChargePercent = (percent: number) => {
    chargePercent = THREE.MathUtils.clamp(percent, 0, 100);
    const ratio = Math.max(chargePercent / 100, 0.05);
    chargeBar.scale.y = ratio;
    chargeBar.position.y = 0.15 + 0.4 * ratio;
    if (module) module.setInfoData('电量', Math.round(chargePercent) + '%');
  };
  const battery: BatteryCapability = {
    getChargePercent: () => Math.round(chargePercent),
    setChargePercent,
  };
  const created = createModule(config, '绿色低碳', root, [[DEVICE_CAPABILITY.battery, battery]]);
  module = created.module;
  const info = created.info;
  const batteryData = { ...info.data, 容量: capacity + ' kWh', 电量: Math.round(chargePercent) + '%' };
  module.mergeInfoData(batteryData);
  setChargePercent(initialCharge);
  return module;
}

export function createHouseHeatPump(config: HouseHeatPumpConfig): SceneModule {
  validateBase(config, 'heatPump');
  validatePoseCoordinates(config.pose, config.id);
  const rotationSpeed = config.rotationSpeed ?? 12;
  if (!Number.isFinite(rotationSpeed) || rotationSpeed < 0) throw new Error('Heat pump rotation speed cannot be negative');
  const root = new THREE.Group();
  root.add(box(0.95, 0.75, 0.4, 'whiteGloss', 0, 0, 0, { rounded: 0.02 }));
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 24), mat('darkMetal'));
  fanRing.position.set(-0.15, 0.38, 0.21);
  root.add(fanRing);
  const fan = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.01), mat('darkMetal'));
  fan.position.set(-0.15, 0.38, 0.21);
  fan.userData.dynamic = true;
  root.add(fan);
  let running = config.initialRunning ?? false;
  let module: SceneModule;
  const setRunning = (value: boolean) => {
    running = value;
    module.mergeInfoData({ 状态: running ? '运行中' : '待机' });
  };
  const power: PowerCapability = { isOn: () => running, setOn: setRunning };
  const control: BooleanControlCapability = { getState: () => running, setState: setRunning };
  const rotor: RotatingCapability = { isRunning: () => running, setRunning };
  module = createModule(config, '绿色低碳', root, [
    [MODULE_CAPABILITY.control, control],
    [DEVICE_CAPABILITY.power, power],
    [DEVICE_CAPABILITY.rotor, rotor],
  ], (dt) => { if (running) fan.rotation.z += dt * rotationSpeed; }).module;
  setRunning(running);
  return module;
}

export function createHouseWaterTank(config: HouseWaterTankConfig): SceneModule {
  validateBase(config, 'waterTank');
  validatePoseCoordinates(config.pose, config.id);
  const capacity = config.capacityLiters ?? 200;
  let level = config.initialLevelPercent ?? 68;
  if (!Number.isFinite(capacity) || capacity <= 0) throw new Error('Water tank capacity must be positive: ' + config.id);
  if (!Number.isFinite(level) || level < 0 || level > 100) throw new Error('Water tank level must be between 0 and 100 percent: ' + config.id);
  const root = new THREE.Group();
  const waterHeight = 1.32;
  const water = new THREE.Mesh(
    new THREE.CylinderGeometry(0.255, 0.255, waterHeight, 20),
    new THREE.MeshStandardMaterial({ color: 0x3f9fc5, roughness: 0.18, transparent: true, opacity: 0.68, depthWrite: false }),
  );
  water.position.y = 0.08 + waterHeight / 2;
  root.add(
    cylinder(0.3, 0.3, 1.6, uniqueMat({ color: 0xe6edf0, roughness: 0.55, transparent: true, opacity: 0.28, depthWrite: false }), 0, 0, 0, 24),
    cylinder(0.31, 0.31, 0.04, 'darkMetal', 0, 1.6, 0, 24),
    water,
  );
  let module: SceneModule;
  const tank: TankLevelCapability = {
    getLevelPercent: () => level,
    setLevelPercent(value) {
      if (!Number.isFinite(value)) throw new Error('Water tank level must be finite');
      level = THREE.MathUtils.clamp(value, 0, 100);
      water.scale.y = Math.max(level / 100, 0.001);
      water.position.y = 0.08 + waterHeight * level / 200;
      module.mergeInfoData({ 液位: `${level.toFixed(0)}%`, 剩余水量: `${(capacity * level / 100).toFixed(0)} L`, 容量: `${capacity} L` });
    },
    getCapacityLiters: () => capacity,
  };
  module = createModule(config, '绿色低碳', root, [[DEVICE_CAPABILITY.tank, tank]]).module;
  tank.setLevelPercent(level);
  return module;
}

export function createHouseCharger(config: HouseChargerConfig): SceneModule {
  validateBase(config, 'charger');
  validatePoseCoordinates(config.pose, config.id);
  const chargingPower = config.chargingPowerKW ?? 7;
  if (!Number.isFinite(chargingPower) || chargingPower <= 0) throw new Error('Charger power must be positive: ' + config.id);
  const root = new THREE.Group();
  root.add(box(0.3, 0.45, 0.12, 'whiteGloss', 0, 0, 0.06, { rounded: 0.02 }));
  const ledMaterial = uniqueMat({ color: 0x222222, emissive: 0x3fa9f5, emissiveIntensity: 0.15 });
  const led = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 8), ledMaterial);
  led.position.set(0, 0.38, 0.125);
  root.add(led, cylinder(0.015, 0.015, 0.6, 'blackPlastic', 0.1, -0.5, 0.1, 6));
  let on = config.initialOn ?? false;
  let module: SceneModule;
  const setOn = (value: boolean) => {
    on = value;
    ledMaterial.emissive.setHex(on ? 0x3fa9f5 : 0x222222);
    ledMaterial.emissiveIntensity = on ? 1.5 : 0.15;
    module.mergeInfoData({ 状态: on ? `充电中 ${chargingPower} kW` : '空闲' });
  };
  const power: PowerCapability = { isOn: () => on, setOn };
  const control: BooleanControlCapability = { getState: () => on, setState: setOn };
  module = createModule(config, '绿色低碳', root, [
    [MODULE_CAPABILITY.control, control],
    [DEVICE_CAPABILITY.power, power],
  ], undefined, (status) => ledMaterial.emissive.setHex(STATUS_COLOR[status])).module;
  setOn(on);
  return module;
}

export function createHouseRainFilter(config: HouseRainFilterConfig): SceneModule {
  validateBase(config, 'rainFilter');
  validatePoseCoordinates(config.pose, config.id);
  const root = new THREE.Group();
  const shell = cylinder(0.18, 0.18, 0.5, 'darkMetal', 0, 0, 0, 16);
  const elementMaterial = uniqueMat({ color: 0x47ba87, roughness: 0.6, emissive: 0x145b3a, emissiveIntensity: 0.2 });
  const element = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.42, 16), elementMaterial);
  element.position.y = 0.02;
  root.add(shell, element);
  let health = config.initialHealthPercent ?? 100;
  if (!Number.isFinite(health) || health < 0 || health > 100) throw new Error('Filter health must be between 0 and 100 percent: ' + config.id);
  let module: SceneModule;
  const setHealth = (value: number) => {
    if (!Number.isFinite(value)) throw new Error('Filter health must be finite');
    health = THREE.MathUtils.clamp(value, 0, 100);
    elementMaterial.color.setHSL(0.32 * health / 100, 0.65, 0.48);
    module.mergeInfoData({ 滤芯寿命: `${health.toFixed(0)}%`, 维护提示: health < 20 ? '建议更换滤芯' : '正常' });
  };
  const filter: FilterCapability = {
    getHealthPercent: () => health,
    setHealthPercent: setHealth,
    replaceFilter: () => setHealth(100),
  };
  module = createModule(config, '绿色低碳', root, [[DEVICE_CAPABILITY.filter, filter]]).module;
  setHealth(health);
  return module;
}

export function createHouseRainSystem(config: HouseRainSystemConfig): SceneModule {
  validateBase(config, 'rainSystem');
  validatePoseCoordinates(config.pose, config.id);
  if (config.sprinklers.length === 0 || config.sprinklers.some(({ x, z }) => !Number.isFinite(x) || !Number.isFinite(z))) {
    throw new Error('Sprinkler coordinates must be finite: ' + config.id);
  }
  const root = new THREE.Group();
  for (const { x, z } of config.sprinklers) root.add(cylinder(0.04, 0.05, 0.12, 'darkMetal', x, 0, z, 8));
  const dropletGeometry = new THREE.SphereGeometry(0.018, 8, 6);
  const dropletMaterial = new THREE.MeshBasicMaterial({ color: 0x75cfff });
  const droplets = config.sprinklers.flatMap(({ x, z }, sprinklerIndex) =>
    Array.from({ length: 5 }, (_, dropletIndex) => {
      const droplet = new THREE.Mesh(dropletGeometry, dropletMaterial);
      droplet.position.set(x, 0.14, z);
      droplet.visible = false;
      root.add(droplet);
      return { mesh: droplet, x, z, phaseOffset: (dropletIndex / 5) + sprinklerIndex * 0.17 };
    }));
  let running = false;
  let elapsed = 0;
  let module: SceneModule;
  const setRunning = (value: boolean) => {
    running = value;
    for (const droplet of droplets) droplet.mesh.visible = running;
    module.mergeInfoData({ 状态: running ? '喷灌运行中' : '喷灌待机' });
  };
  const irrigation: IrrigationCapability = {
    isRunning: () => running,
    setRunning,
    getSprinklers: () => {
      root.updateWorldMatrix(true, false);
      return config.sprinklers.map(({ x, z }) => {
        const position = root.localToWorld(new THREE.Vector3(x, 0, z));
        return { x: position.x, z: position.z };
      });
    },
  };
  module = createModule(config, '绿色低碳', root, [[DEVICE_CAPABILITY.irrigation, irrigation]], (dt) => {
    if (!running) return;
    elapsed += dt;
    for (const droplet of droplets) {
      const phase = (elapsed * 1.35 + droplet.phaseOffset) % 1;
      const angle = droplet.phaseOffset * Math.PI * 2 + phase * Math.PI * 2;
      const radius = 0.08 + phase * 0.38;
      droplet.mesh.position.set(
        droplet.x + Math.cos(angle) * radius,
        0.14 + phase * 0.55,
        droplet.z + Math.sin(angle) * radius,
      );
      droplet.mesh.scale.setScalar(0.45 + Math.sin(phase * Math.PI) * 0.75);
    }
  }).module;
  return module;
}

export function houseGreenDeviceDefinitions(): SceneModuleDefinition<HouseGreenConfig>[] {
  return [
    { id: 'house-solar-array', kind: 'device', create: (_context, config) => createHouseSolarArray(config as HouseSolarArrayConfig) },
    { id: 'house-inverter', kind: 'device', create: (_context, config) => createHouseInverter(config as HouseInverterConfig) },
    { id: 'house-battery', kind: 'device', create: (_context, config) => createHouseBattery(config as HouseBatteryConfig) },
    { id: 'house-heat-pump', kind: 'device', create: (_context, config) => createHouseHeatPump(config as HouseHeatPumpConfig) },
    { id: 'house-water-tank', kind: 'device', create: (_context, config) => createHouseWaterTank(config as HouseWaterTankConfig) },
    { id: 'house-charger', kind: 'device', create: (_context, config) => createHouseCharger(config as HouseChargerConfig) },
    { id: 'house-rain-filter', kind: 'device', create: (_context, config) => createHouseRainFilter(config as HouseRainFilterConfig) },
    { id: 'house-rain-system', kind: 'device', create: (_context, config) => createHouseRainSystem(config as HouseRainSystemConfig) },
  ];
}
