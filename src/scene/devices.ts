// Assemble and register the house-specific device groups as scene modules.
import * as THREE from 'three';
import { LightPool } from '../systems/lightPool.js';
import { SceneModule } from '../modules/runtime.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../modules/contracts';
import type { BatteryCapability, CameraCapability, ClimateCapability, CurtainCapability, DeviceStatus, DeviceStatusCapability, DisplayCapability, ElevatorCapability, IndicatorCapability, IrrigationCapability, LightingCapability, LockCapability, ModuleInfo, PowerCapability, RotatingCapability, SceneModuleContract, SosCapability, ValveCapability, VentilationCapability, VentilationOutlet } from '../modules/contracts';
import type { DeviceKind } from './deviceCatalog.js';
import { DeviceRegistry } from './deviceRegistry.js';
import type { HouseDevice, HouseDeviceContext } from './deviceAssemblies.js';
import { buildComfortDevices } from './devices/comfort.js';
import { buildSafetyDevices } from './devices/safety.js';
import { buildElevatorDevice } from './devices/elevator.js';
import { buildGreenDevices } from './devices/green.js';
import { kelvinToColor, STATUS_COLOR, statusLed } from './devices/deviceVisuals.js';
import type { DeviceAssemblyContext, DeviceFacing, DeviceModuleMetadata } from './deviceAssemblyContext.js';
import { FLOOR_H, FLOORS } from './layout.js';
export type { HouseDevice, HouseDeviceContext } from './deviceAssemblies.js';
export { STATUS_COLOR, STATUS_TEXT, kelvinToColor } from './devices/deviceVisuals.js';

const DEVICE_KIND_BY_INSTANCE_TYPE: Readonly<Record<string, DeviceKind>> = {
  light: 'light', lamp: 'light', tv: 'television', nightLight: 'nightLight', curtain: 'curtain', ac: 'airConditioner',
  freshAir: 'freshAir', envSensor: 'environmentSensor', presence: 'presenceSensor', smoke: 'smokeSensor',
  gasDetector: 'gasDetector', extinguisher: 'extinguisher', blanket: 'blanket', strobe: 'alarm', exitSign: 'exitSign',
  emergency: 'emergencyLight', sos: 'sosButton', leak: 'waterLeakSensor', distribution: 'distributionPanel',
  gateway: 'gateway', intercom: 'intercom', lock: 'smartLock', camera: 'camera', flood: 'floodlight', elevator: 'elevator',
  pv: 'solarPanel', inverter: 'inverter', battery: 'battery', heatpump: 'heatPump', tank: 'waterTank', charger: 'charger',
  rainFilter: 'rainFilter', rain: 'rainSystem', valve: 'gasValve', switch: 'switch',
};
const FACING: Readonly<Record<DeviceFacing, number>> = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': 0, '-z': Math.PI };
const Y = (floor: number) => FLOORS[floor].y;
const CEIL = (floor: number) => FLOORS[floor].y + FLOOR_H - 0.2;

function invokeDeviceSet(device: HouseDevice, ...args: unknown[]): void {
  if (typeof device.set === 'function') Reflect.apply(device.set, device, args);
}

export function buildDevices(assembly: HouseDeviceContext = {}) {
  const root = new THREE.Group();
  root.name = 'devices';
  const registry = new DeviceRegistry();
  const runtimeDevices = new Map<string, HouseDevice>();
  const lightPool = new LightPool(root, 10);

  const modules: SceneModuleContract[] = [];
  const register = <T extends HouseDevice>(dev: T): T & HouseDevice => {
    dev.status = dev.status ?? 'normal';
    dev.info = dev.info ?? { name: dev.id };
    dev.info.status = dev.status;
    dev.info.deviceId = dev.id;
    dev.info.data = dev.info.data ?? {};
    const moduleRoot = dev.object ?? new THREE.Group();
    if (dev.object) {
      dev.object.userData.deviceId = dev.id;
      dev.object.userData.info = dev.info;
    }
    const operations = Object.entries(dev)
      .filter(([key, value]) => !['object', 'info', 'module'].includes(key) && typeof value === 'function')
      .map(([key, value]) => [key, (value as Function).bind(dev) as (...args: unknown[]) => unknown] as const);
    const control = {
      getState: () => dev.type === 'curtain' ? dev.target > 0.5 : dev.type === 'lock' ? !!dev.locked : dev.on ?? dev.open ?? dev.isOpen ?? false,
      setState: (value: boolean, ...args: unknown[]) => invokeDeviceSet(dev, value, ...args),
    };
    const statusCapability = {
      getStatus: () => dev.status,
      setStatus: (status: DeviceStatus) => setStatus(dev.id, status),
    };
    dev.module = new SceneModule({
      id: dev.id,
      kind: 'device',
      root: moduleRoot,
      info: dev.info,
      update: (dt) => dev.update?.(dt),
      capabilities: [[MODULE_CAPABILITY.control, control], [MODULE_CAPABILITY.deviceStatus, statusCapability], ...operations],
      disposeResources: true,
    });
    const catalogKind = dev.id === 'water-valve' ? 'waterValve' : DEVICE_KIND_BY_INSTANCE_TYPE[dev.type];
    if (catalogKind) dev.module.setCapability(MODULE_CAPABILITY.deviceKind, catalogKind);
    if (typeof dev.setTexture === 'function') {
      const display: DisplayCapability = { setTexture: (texture) => dev.setTexture(texture) };
      dev.module.setCapability(DEVICE_CAPABILITY.display, display);
    }
    const power: PowerCapability | undefined = typeof dev.on === 'boolean' && typeof dev.set === 'function' ? {
      isOn: () => !!dev.on,
      setOn: (on) => {
        if (dev.type === 'light' || dev.type === 'lamp') invokeDeviceSet(dev, on, dev.level, dev.cct);
        else if (dev.type === 'ac') invokeDeviceSet(dev, on, dev.setpoint);
        else if (dev.type === 'freshAir') invokeDeviceSet(dev, on, dev.level);
        else invokeDeviceSet(dev, on);
      },
    } : undefined;
    if (power) dev.module.setCapability(DEVICE_CAPABILITY.power, power);
    if (dev.type === 'light' || dev.type === 'lamp') {
      const lighting: LightingCapability = {
        ...power!,
        getBrightness: () => Number(dev.level ?? 0),
        setBrightness: (value) => invokeDeviceSet(dev, !!dev.on, THREE.MathUtils.clamp(value, 0, 1), dev.cct),
        getColorTemperature: () => Number(dev.cct ?? 4000),
        setColorTemperature: (kelvin) => invokeDeviceSet(dev, !!dev.on, dev.level, THREE.MathUtils.clamp(kelvin, 2700, 6500)),
        getSourcePosition: () => dev.lamp?.position.clone() ?? dev.module.root.getWorldPosition(new THREE.Vector3()),
        getSourceColor: () => dev.lamp?.color.clone() ?? kelvinToColor(Number(dev.cct ?? 4000)),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.lighting, lighting);
    }
    if (dev.type === 'curtain') {
      const curtain: CurtainCapability = {
        getOpenRatio: () => Number(dev.open ?? 0),
        setOpenRatio: (ratio) => invokeDeviceSet(dev, THREE.MathUtils.clamp(ratio, 0, 1)),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.curtain, curtain);
    }
    if (dev.type === 'ac') {
      const climate: ClimateCapability = {
        ...power!,
        getSetpoint: () => Number(dev.setpoint ?? 26),
        setSetpoint: (celsius) => invokeDeviceSet(dev, !!dev.on, THREE.MathUtils.clamp(celsius, 16, 30)),
        getOutlet: () => ({
          position: dev.module.root.getWorldPosition(new THREE.Vector3()),
          direction: dev.module.root.getWorldDirection(new THREE.Vector3()),
        }),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.climate, climate);
    }
    if (dev.type === 'freshAir') {
      const ventilation: VentilationCapability = {
        ...power!,
        getLevel: () => Number(dev.level ?? 1),
        setLevel: (level) => invokeDeviceSet(dev, !!dev.on, THREE.MathUtils.clamp(Math.round(level), 1, 3)),
        getOutlets: () => (dev.vents ?? []) as VentilationOutlet[],
      };
      dev.module.setCapability(DEVICE_CAPABILITY.ventilation, ventilation);
    }
    if (dev.type === 'lock') {
      const lock: LockCapability = {
        isLocked: () => !!dev.locked,
        setLocked: (locked) => invokeDeviceSet(dev, locked),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.lock, lock);
    }
    if (dev.type === 'valve') {
      const valve: ValveCapability = {
        isOpen: () => !!dev.open,
        setOpen: (open) => invokeDeviceSet(dev, open),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.valve, valve);
    }
    if (dev.type === 'sos') {
      const sos: SosCapability = {
        isActive: () => !!dev.active,
        activate: () => { dev.active = true; if (dev.btnMat) dev.btnMat.emissiveIntensity = 1.5; dev.module.setInfoData('状态', '呼叫中'); },
        deactivate: () => { dev.active = false; if (dev.btnMat) dev.btnMat.emissiveIntensity = 0.15; dev.module.setInfoData('状态', '待机'); },
        setIndicator: (intensity) => { if (dev.btnMat) dev.btnMat.emissiveIntensity = THREE.MathUtils.clamp(intensity, 0, 3); },
      };
      dev.module.setCapability(DEVICE_CAPABILITY.sos, sos);
    }
    if (dev.type === 'camera') {
      const camera: CameraCapability = {
        isArmed: () => !!dev.cone?.visible,
        setArmed: (armed) => { if (dev.cone) dev.cone.visible = armed; dev.module.setInfoData('状态', armed ? '已布防' : '在线'); },
        setAlert: (active) => { if (dev.cone) (dev.cone.material as THREE.MeshBasicMaterial).color.setHex(active ? 0xff3030 : 0x3fa9f5); },
      };
      dev.module.setCapability(DEVICE_CAPABILITY.camera, camera);
    }
    if (dev.type === 'rain') {
      const irrigation: IrrigationCapability = { getSprinklers: () => dev.sprinklers ?? [] };
      dev.module.setCapability(DEVICE_CAPABILITY.irrigation, irrigation);
    }
    if (dev.type === 'battery' && dev.socBar) {
      const battery: BatteryCapability = {
        getChargePercent: () => Math.round(THREE.MathUtils.clamp(dev.socBar.scale.y, 0, 1) * 100),
        setChargePercent: (percent) => {
          const ratio = THREE.MathUtils.clamp(percent / 100, 0.05, 1);
          dev.socBar.scale.y = ratio;
          dev.socBar.position.y = 0.15 + 0.4 * ratio;
        },
      };
      dev.module.setCapability(DEVICE_CAPABILITY.battery, battery);
    }
    if (dev.type === 'heatpump' && dev.fan) {
      const rotor: RotatingCapability = {
        isRunning: () => !!dev.running,
        setRunning: (running) => { dev.running = running; },
      };
      dev.module.setCapability(DEVICE_CAPABILITY.rotor, rotor);
    }
    if (dev.indicatorMaterial) {
      const indicator: IndicatorCapability = {
        getIntensity: () => Number(dev.indicatorMaterial.emissiveIntensity ?? 0),
        setIntensity: (intensity) => {
          const value = THREE.MathUtils.clamp(intensity, 0, 16);
          dev.indicatorMaterial.emissiveIntensity = value;
          if (dev.indicatorLight) dev.indicatorLight.intensity = value * 3;
        },
      };
      dev.module.setCapability(DEVICE_CAPABILITY.indicator, indicator);
    }
    if (dev.type === 'elevator' && typeof dev.call === 'function') {
      const elevator: ElevatorCapability = {
        call: (floor, onArrive) => dev.call(floor, onArrive),
        getCurrentFloor: () => dev.y >= FLOOR_H / 2 ? 1 : 0,
        isMoving: () => !!dev.moving,
      };
      dev.module.setCapability(DEVICE_CAPABILITY.elevator, elevator);
    }
    modules.push(dev.module);
    runtimeDevices.set(dev.id, dev);
    registry.register({ id: dev.id, type: dev.type, room: dev.room, floor: dev.floor, module: dev.module });
    return dev;
  };
  const registerModule = (
    module: SceneModuleContract,
    metadata: DeviceModuleMetadata,
  ): SceneModuleContract => {
    module.info.status = module.info.status ?? 'normal';
    module.info.deviceId = module.id;
    module.root.userData.deviceId = module.id;
    module.root.userData.info = module.info;
    module.setCapability(MODULE_CAPABILITY.deviceKind, metadata.kind ?? metadata.type);
    if (!module.root.parent) root.add(module.root);
    modules.push(module);
    registry.register({ id: module.id, type: metadata.type, room: metadata.room, floor: metadata.floor, module });
    return module;
  };
  const setStatus = (id: string, status: 'normal' | 'warning' | 'fault' | 'off'): void => {
    const d = runtimeDevices.get(id);
    if (!d) {
      registry.getCapability<DeviceStatusCapability>(id, MODULE_CAPABILITY.deviceStatus)?.setStatus(status);
      return;
    }
    d.status = status;
    if (d.led) d.led.material.emissive.setHex(STATUS_COLOR[status]);
    if (d.object?.userData.info) d.object.userData.info.status = status;
  };

  const wallMount = (obj: THREE.Object3D, x: number, y: number, z: number, facing: DeviceFacing) => {
    obj.position.set(x, y, z);
    obj.rotation.y = FACING[facing];
    root.add(obj);
    return obj;
  };
  const assemblyContext: DeviceAssemblyContext = {
    root, assembly, register, registerModule, lightPool, wallMount, statusLed, facing: FACING, floorY: Y, ceilingY: CEIL,
  };
  buildComfortDevices(assemblyContext);
  buildSafetyDevices(assemblyContext);
  buildElevatorDevice(assemblyContext);
  buildGreenDevices(assemblyContext);

  return { root, registry, modules, lightPool };
}
