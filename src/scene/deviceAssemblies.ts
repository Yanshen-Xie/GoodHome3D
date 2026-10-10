import type { OpeningsService } from '../modules/contracts';
import type { DeviceKind } from './deviceCatalog.js';

/** Narrow house services and dimensions that device assemblies may depend on. */
export interface HouseDeviceContext {
  openings?: OpeningsService;
  pvRoof?: { ridgeY: number };
}

/** Catalog kind used by each registry type of the whole-house devices. */
export const HOUSE_DEVICE_KIND = {
  light: 'light', lamp: 'light', tv: 'television', nightLight: 'nightLight', curtain: 'curtain', ac: 'airConditioner',
  freshAir: 'freshAir', envSensor: 'environmentSensor', presence: 'presenceSensor', smoke: 'smokeSensor',
  gasDetector: 'gasDetector', extinguisher: 'extinguisher', blanket: 'blanket', strobe: 'alarm', exitSign: 'exitSign',
  emergency: 'emergencyLight', sos: 'sosButton', leak: 'waterLeakSensor', distribution: 'distributionPanel',
  gateway: 'gateway', intercom: 'intercom', lock: 'smartLock', camera: 'camera', flood: 'floodlight', elevator: 'elevator',
  pv: 'solarPanel', inverter: 'inverter', battery: 'battery', heatpump: 'heatPump', tank: 'waterTank', charger: 'charger',
  rainFilter: 'rainFilter', rain: 'rainSystem', valve: 'gasValve',
} as const satisfies Readonly<Record<string, DeviceKind>>;

/** Registry type of a whole-house device instance, as used by features and the dashboard. */
export type HouseDeviceType = keyof typeof HOUSE_DEVICE_KIND;

/** Catalog kinds accepted for one registry type; valves share a type but differ in kind. */
export function houseDeviceKinds(type: HouseDeviceType): readonly DeviceKind[] {
  return type === 'valve' ? ['gasValve', 'waterValve'] : [HOUSE_DEVICE_KIND[type]];
}
