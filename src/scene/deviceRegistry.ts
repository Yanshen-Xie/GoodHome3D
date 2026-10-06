import type { SceneModuleContract } from '../modules/contracts';
import {
  DEVICE_CAPABILITY,
  MODULE_CAPABILITY,
} from '../modules/contracts';
import type {
  BatteryCapability, CameraCapability, ClimateCapability, CurtainCapability, DeviceStatus,
  DeviceStatusCapability, DisplayCapability, ElevatorCapability, IndicatorCapability,
  IrrigationCapability, LightingCapability, LockCapability, ModuleInfoCapability,
  PowerCapability, RotatingCapability, SosCapability, ValveCapability, VentilationCapability,
} from '../modules/contracts';

/** Public device descriptor. Device-specific fields stay private to their implementation. */
export interface DeviceRegistryEntry {
  readonly id: string;
  readonly type: string;
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

  byType(type: string): readonly T[] { return this.all().filter((device) => device.type === type); }

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
