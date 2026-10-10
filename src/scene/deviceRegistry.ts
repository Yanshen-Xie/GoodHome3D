import type { SceneModuleContract } from '../modules/contracts';
import type { HouseDeviceType } from './deviceAssemblies.js';
import {
  DEVICE_CAPABILITY,
  MODULE_CAPABILITY,
} from '../modules/contracts';
import type {
  BatteryCapability, CameraCapability, ClimateCapability, CurtainCapability, DeviceStatus,
  CircuitBreakerCapability, DeviceStatusCapability, DisplayCapability, ElevatorCapability,
  EnergyOutputCapability, EnvironmentSensorCapability, FilterCapability, FireAlarmCapability,
  FireBlanketCapability, FireExtinguisherCapability, IndicatorCapability, IntercomCapability,
  InverterCapability, IrrigationCapability, LightingCapability, LockCapability, ModuleInfoCapability,
  NetworkCapability, PowerCapability, PresenceSensorCapability, RotatingCapability, ScalarSensorCapability,
  SosCapability, TankLevelCapability, ValveCapability, VentilationCapability, WaterLeakSensorCapability,
} from '../modules/contracts';

/** Public device descriptor. Device-specific fields stay private to their implementation. */
export interface DeviceRegistryEntry {
  readonly id: string;
  readonly type: HouseDeviceType;
  readonly room?: string | null;
  readonly floor?: number;
  readonly module: SceneModuleContract;
}

/** Read and control devices through their declared capabilities instead of their model fields. */
export class DeviceRegistry<T extends DeviceRegistryEntry = DeviceRegistryEntry> {
  private readonly entries = new Map<string, T>();

  register(device: T): void {
    if (this.entries.has(device.id)) throw new Error(`Device already registered: ${device.id}`);
    this.entries.set(device.id, device);
  }

  get(id: string): T | undefined { return this.entries.get(id); }

  require(id: string): T {
    const device = this.get(id);
    if (!device) throw new Error(`Unknown device: ${id}`);
    return device;
  }

  all(): readonly T[] { return [...this.entries.values()]; }

  byType(type: HouseDeviceType): readonly T[] { return this.all().filter((device) => device.type === type); }

  byRoom(room: string): readonly T[] { return this.all().filter((device) => device.room === room); }

  getModule(id: string): SceneModuleContract | undefined { return this.get(id)?.module; }

  getCapability<C>(id: string, capability: string): C | undefined {
    return this.getModule(id)?.getCapability<C>(capability);
  }

  getPower(id: string): PowerCapability | undefined {
    return this.getCapability<PowerCapability>(id, DEVICE_CAPABILITY.power);
  }

  setPower(id: string, on: boolean): boolean {
    const capability = this.getPower(id);
    if (!capability) return false;
    capability.setOn(on);
    return true;
  }

  getLighting(id: string): LightingCapability | undefined {
    return this.getCapability<LightingCapability>(id, DEVICE_CAPABILITY.lighting);
  }

  getCurtain(id: string): CurtainCapability | undefined {
    return this.getCapability<CurtainCapability>(id, DEVICE_CAPABILITY.curtain);
  }

  setCurtain(id: string, openRatio: number): boolean {
    const capability = this.getCurtain(id);
    if (!capability) return false;
    capability.setOpenRatio(openRatio);
    return true;
  }

  getClimate(id: string): ClimateCapability | undefined {
    return this.getCapability<ClimateCapability>(id, DEVICE_CAPABILITY.climate);
  }

  getVentilation(id: string): VentilationCapability | undefined {
    return this.getCapability<VentilationCapability>(id, DEVICE_CAPABILITY.ventilation);
  }

  getDisplay(id: string): DisplayCapability | undefined {
    return this.getCapability<DisplayCapability>(id, DEVICE_CAPABILITY.display);
  }

  getLock(id: string): LockCapability | undefined {
    return this.getCapability<LockCapability>(id, DEVICE_CAPABILITY.lock);
  }

  getValve(id: string): ValveCapability | undefined {
    return this.getCapability<ValveCapability>(id, DEVICE_CAPABILITY.valve);
  }

  getSos(id: string): SosCapability | undefined {
    return this.getCapability<SosCapability>(id, DEVICE_CAPABILITY.sos);
  }

  getCamera(id: string): CameraCapability | undefined {
    return this.getCapability<CameraCapability>(id, DEVICE_CAPABILITY.camera);
  }

  getIrrigation(id: string): IrrigationCapability | undefined {
    return this.getCapability<IrrigationCapability>(id, DEVICE_CAPABILITY.irrigation);
  }

  getBattery(id: string): BatteryCapability | undefined {
    return this.getCapability<BatteryCapability>(id, DEVICE_CAPABILITY.battery);
  }

  getRotating(id: string): RotatingCapability | undefined {
    return this.getCapability<RotatingCapability>(id, DEVICE_CAPABILITY.rotor);
  }

  getIndicator(id: string): IndicatorCapability | undefined {
    return this.getCapability<IndicatorCapability>(id, DEVICE_CAPABILITY.indicator);
  }

  getElevator(id: string): ElevatorCapability | undefined {
    return this.getCapability<ElevatorCapability>(id, DEVICE_CAPABILITY.elevator);
  }

  getEnvironmentSensor(id: string): EnvironmentSensorCapability | undefined {
    return this.getCapability<EnvironmentSensorCapability>(id, DEVICE_CAPABILITY.environmentSensor);
  }

  getPresenceSensor(id: string): PresenceSensorCapability | undefined {
    return this.getCapability<PresenceSensorCapability>(id, DEVICE_CAPABILITY.presenceSensor);
  }

  getSmokeSensor(id: string): ScalarSensorCapability | undefined {
    return this.getCapability<ScalarSensorCapability>(id, DEVICE_CAPABILITY.smokeSensor);
  }

  getGasSensor(id: string): ScalarSensorCapability | undefined {
    return this.getCapability<ScalarSensorCapability>(id, DEVICE_CAPABILITY.gasSensor);
  }

  getWaterLeakSensor(id: string): WaterLeakSensorCapability | undefined {
    return this.getCapability<WaterLeakSensorCapability>(id, DEVICE_CAPABILITY.waterLeakSensor);
  }

  getFireAlarm(id: string): FireAlarmCapability | undefined {
    return this.getCapability<FireAlarmCapability>(id, DEVICE_CAPABILITY.fireAlarm);
  }

  getFireExtinguisher(id: string): FireExtinguisherCapability | undefined {
    return this.getCapability<FireExtinguisherCapability>(id, DEVICE_CAPABILITY.fireExtinguisher);
  }

  getFireBlanket(id: string): FireBlanketCapability | undefined {
    return this.getCapability<FireBlanketCapability>(id, DEVICE_CAPABILITY.fireBlanket);
  }

  getCircuits(id: string): CircuitBreakerCapability | undefined {
    return this.getCapability<CircuitBreakerCapability>(id, DEVICE_CAPABILITY.circuits);
  }

  getNetwork(id: string): NetworkCapability | undefined {
    return this.getCapability<NetworkCapability>(id, DEVICE_CAPABILITY.network);
  }

  getIntercom(id: string): IntercomCapability | undefined {
    return this.getCapability<IntercomCapability>(id, DEVICE_CAPABILITY.intercom);
  }

  getGeneration(id: string): EnergyOutputCapability | undefined {
    return this.getCapability<EnergyOutputCapability>(id, DEVICE_CAPABILITY.generation);
  }

  getInverter(id: string): InverterCapability | undefined {
    return this.getCapability<InverterCapability>(id, DEVICE_CAPABILITY.inverter);
  }

  getTank(id: string): TankLevelCapability | undefined {
    return this.getCapability<TankLevelCapability>(id, DEVICE_CAPABILITY.tank);
  }

  getFilter(id: string): FilterCapability | undefined {
    return this.getCapability<FilterCapability>(id, DEVICE_CAPABILITY.filter);
  }

  getStatus(id: string): DeviceStatus | undefined {
    return this.getCapability<DeviceStatusCapability>(id, MODULE_CAPABILITY.deviceStatus)?.getStatus();
  }

  setStatus(id: string, status: DeviceStatus): boolean {
    const capability = this.getCapability<DeviceStatusCapability>(id, MODULE_CAPABILITY.deviceStatus);
    if (!capability) return false;
    capability.setStatus(status);
    return true;
  }

  setInfoData(id: string, key: string, value: unknown): boolean {
    const capability = this.getCapability<ModuleInfoCapability>(id, MODULE_CAPABILITY.info);
    if (!capability) return false;
    capability.setData(key, value);
    return true;
  }

  mergeInfoData(id: string, values: Record<string, unknown>): boolean {
    const capability = this.getCapability<ModuleInfoCapability>(id, MODULE_CAPABILITY.info);
    if (!capability) return false;
    capability.mergeData(values);
    return true;
  }

  deleteInfoData(id: string, key: string): boolean {
    const capability = this.getCapability<ModuleInfoCapability>(id, MODULE_CAPABILITY.info);
    if (!capability) return false;
    capability.deleteData(key);
    return true;
  }
}
