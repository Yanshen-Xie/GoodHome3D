// 智能设备与安全设施（两层）：灯具、窗帘、空调、新风、传感器、消防设施、电梯、光伏与储能、雨水回用、充电桩、安防。
// 每个设备都登记在 devices 表中（按 id 查找），带有楼层、可点击的信息与控制项。
import * as THREE from 'three';
import { mat, box, cylinder, setInfo, uniqueMat, markSharedTexture } from './common.js';
import { textTexture } from './textures.js';
import { FLOORS, FLOOR_H, ROOF_PITCH, ELEVATOR, INDOOR_ROOMS, EXT } from './layout.js';
import { LightPool } from '../systems/lightPool.js';
import { SceneModule } from '../modules/runtime.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY } from '../modules/contracts';
import type { BatteryCapability, CameraCapability, ClimateCapability, CurtainCapability, DeviceStatus, DisplayCapability, ElevatorCapability, IndicatorCapability, IrrigationCapability, LightingCapability, LockCapability, ModuleInfo, PowerCapability, RotatingCapability, SceneModuleContract, SosCapability, ValveCapability, VentilationCapability, VentilationOutlet } from '../modules/contracts';
import type { DeviceKind } from './deviceCatalog.js';
import { DeviceRegistry } from './deviceRegistry.js';

export interface HouseDeviceContext {
  entryDoorPivot?: THREE.Object3D;
  pvRoof?: { ridgeY: number };
}

export interface HouseDevice {
  id: string;
  room?: string | null;
  floor?: number;
  type: string;
  object: THREE.Object3D | null;
  status: DeviceStatus;
  info: ModuleInfo & { controls?: unknown[] };
  module?: SceneModuleContract;
  update?: (dt: number) => void;
  set?: (...args: unknown[]) => void;
  led?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  on?: boolean;
  open?: boolean;
  locked?: boolean;
  isOpen?: boolean;
  target?: number;
  setpoint?: number;
  level?: number;
  cct?: number;
  call?: (floor: number) => void;
  [key: string]: unknown;
}

export const STATUS_COLOR = { normal: 0x2ecc71, warning: 0xf1c40f, fault: 0xe74c3c, off: 0x7f8c8d };
export const STATUS_TEXT = { normal: '正常', warning: '预警', fault: '故障', off: '关闭' };

const DEVICE_KIND_BY_INSTANCE_TYPE: Readonly<Record<string, DeviceKind>> = {
  light: 'light', lamp: 'light', tv: 'television', nightLight: 'nightLight', curtain: 'curtain', ac: 'airConditioner',
  freshAir: 'freshAir', envSensor: 'environmentSensor', presence: 'presenceSensor', smoke: 'smokeSensor',
  gasDetector: 'gasDetector', extinguisher: 'extinguisher', blanket: 'blanket', strobe: 'alarm', exitSign: 'exitSign',
  emergency: 'emergencyLight', sos: 'sosButton', leak: 'waterLeakSensor', distribution: 'distributionPanel',
  gateway: 'gateway', intercom: 'intercom', lock: 'smartLock', camera: 'camera', flood: 'floodlight', elevator: 'elevator',
  pv: 'solarPanel', inverter: 'inverter', battery: 'battery', heatpump: 'heatPump', tank: 'waterTank', charger: 'charger',
  rainFilter: 'rainFilter', rain: 'rainSystem', valve: 'gasValve', switch: 'switch',
};

/** 色温 → RGB（常用近似公式）：暖光约 2700K，中性光 4000K，冷光 6500K */
export function kelvinToColor(k) {
  const t = k / 100;
  let r, g, b;
  if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; } else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); }
  if (t >= 66) b = 255; else if (t <= 19) b = 0; else b = 138.52 * Math.log(t - 10) - 305.04;
  const c = (v) => Math.min(255, Math.max(0, v)) / 255;
  return new THREE.Color(c(r), c(g), c(b));
}

function statusLed(r = 0.025) {
  return new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), uniqueMat({ color: 0x111111, emissive: STATUS_COLOR.normal, emissiveIntensity: 2 }));
}

// 挂墙物体朝向：让物体局部 +z 指向 facing 方向
const FACING = { '+x': Math.PI / 2, '-x': -Math.PI / 2, '+z': 0, '-z': Math.PI };
const Y = (floor) => FLOORS[floor].y;
const CEIL = (floor) => FLOORS[floor].y + FLOOR_H - 0.2; // 各层天花板高度

export function buildDevices(assembly: HouseDeviceContext = {}) {
  const root = new THREE.Group();
  root.name = 'devices';
  const registry = new DeviceRegistry();
  const runtimeDevices = new Map<string, HouseDevice>();
  const lightPool = new LightPool(root, 10);

  const modules: SceneModuleContract[] = [];
  const register = (dev: any): HouseDevice => {
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
      .map(([key, value]) => [key, (value as (...args: any[]) => unknown).bind(dev)] as const);
    const control = {
      getState: () => dev.type === 'curtain' ? dev.target > 0.5 : dev.type === 'lock' ? !!dev.locked : dev.on ?? dev.open ?? dev.isOpen ?? false,
      setState: (value: boolean, ...args: unknown[]) => dev.set?.(value, ...args),
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
        if (dev.type === 'light' || dev.type === 'lamp') dev.set(on, dev.level, dev.cct);
        else if (dev.type === 'ac') dev.set(on, dev.setpoint);
        else if (dev.type === 'freshAir') dev.set(on, dev.level);
        else dev.set(on);
      },
    } : undefined;
    if (power) dev.module.setCapability(DEVICE_CAPABILITY.power, power);
    if (dev.type === 'light' || dev.type === 'lamp') {
      const lighting: LightingCapability = {
        ...power!,
        getBrightness: () => Number(dev.level ?? 0),
        setBrightness: (value) => dev.set(!!dev.on, THREE.MathUtils.clamp(value, 0, 1), dev.cct),
        getColorTemperature: () => Number(dev.cct ?? 4000),
        setColorTemperature: (kelvin) => dev.set(!!dev.on, dev.level, THREE.MathUtils.clamp(kelvin, 2700, 6500)),
        getSourcePosition: () => dev.lamp?.getWorldPosition(new THREE.Vector3()) ?? dev.module.root.getWorldPosition(new THREE.Vector3()),
        getSourceColor: () => dev.lamp?.color.clone() ?? kelvinToColor(Number(dev.cct ?? 4000)),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.lighting, lighting);
    }
    if (dev.type === 'curtain') {
      const curtain: CurtainCapability = {
        getOpenRatio: () => Number(dev.open ?? 0),
        setOpenRatio: (ratio) => dev.set(THREE.MathUtils.clamp(ratio, 0, 1)),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.curtain, curtain);
    }
    if (dev.type === 'ac') {
      const climate: ClimateCapability = {
        ...power!,
        getSetpoint: () => Number(dev.setpoint ?? 26),
        setSetpoint: (celsius) => dev.set(!!dev.on, THREE.MathUtils.clamp(celsius, 16, 30)),
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
        setLevel: (level) => dev.set(!!dev.on, THREE.MathUtils.clamp(Math.round(level), 1, 3)),
        getOutlets: () => (dev.vents ?? []) as VentilationOutlet[],
      };
      dev.module.setCapability(DEVICE_CAPABILITY.ventilation, ventilation);
    }
    if (dev.type === 'lock') {
      const lock: LockCapability = {
        isLocked: () => !!dev.locked,
        setLocked: (locked) => dev.set(locked),
      };
      dev.module.setCapability(DEVICE_CAPABILITY.lock, lock);
    }
    if (dev.type === 'valve') {
      const valve: ValveCapability = {
        isOpen: () => !!dev.open,
        setOpen: (open) => dev.set(open),
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
  const setStatus = (id: string, status: 'normal' | 'warning' | 'fault' | 'off'): void => {
    const d = runtimeDevices.get(id);
    if (!d) return;
    d.status = status;
    if (d.led) d.led.material.emissive.setHex(STATUS_COLOR[status]);
    if (d.object?.userData.info) d.object.userData.info.status = status;
  };
  const wallMount = (obj: THREE.Object3D, x: number, y: number, z: number, facing: keyof typeof FACING) => {
    obj.position.set(x, y, z);
    obj.rotation.y = FACING[facing];
    root.add(obj);
    return obj;
  };

  // ================= 照明 =================
  // [id, 房间, 名称, 楼层, x, z, 类型]  类型：ceil 吸顶灯 | pendant 吊灯 | cove 吸顶灯 + 吊顶灯槽
  const lightDefs = [
    ['light-elder', 'elder', '老人房吸顶灯', 0, -5.6, -3.0, 'ceil'],
    ['light-bath1', 'bath1', '卫生间灯', 0, -1.9, -2.2, 'ceil'],
    ['light-utility', 'utility', '设备间灯', 0, 5.7, -3.0, 'ceil'],
    ['light-hall1-w', 'hall1', '门厅灯（西）', 0, -4.5, -0.2, 'ceil'],
    ['light-hall1-e', 'hall1', '走廊灯（东）', 0, 4.0, -0.2, 'ceil'],
    ['light-living', 'living', '客厅主灯 + 灯槽', 0, -5.3, 2.8, 'cove'],
    ['light-dining', 'dining', '餐厅吊灯', 0, 1.1, 2.9, 'pendant'],
    ['light-kitchen', 'kitchen', '厨房灯', 0, 5.6, 2.8, 'ceil'],
    ['light-stair', 'stair2', '楼梯间吊灯', 1, 2.6, -2.4, 'pendant'],
    ['light-master', 'master', '主卧吸顶灯 + 灯槽', 1, -5.3, -3.0, 'cove'],
    ['light-bath2', 'bath2', '二层卫生间灯', 1, -1.6, -2.4, 'ceil'],
    ['light-kid', 'kid', '儿童房吸顶灯', 1, 5.7, -3.0, 'ceil'],
    ['light-hall2-w', 'hall2', '二层走廊灯（西）', 1, -4.5, -0.2, 'ceil'],
    ['light-hall2-e', 'hall2', '二层走廊灯（东）', 1, 4.0, -0.2, 'ceil'],
    ['light-study', 'study', '书房灯', 1, -5.8, 2.8, 'ceil'],
    ['light-family', 'family', '起居室主灯 + 灯槽', 1, -0.2, 2.8, 'cove'],
    ['light-guest', 'guest', '客房灯', 1, 5.6, 2.8, 'ceil'],
  ];
  for (const [id, room, name, floor, x, z, kind] of lightDefs as [string, string, string, number, number, number, string][]) {
    const shade = uniqueMat({ color: 0xf8f6f0, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.6 });
    const g = new THREE.Group();
    const ceil = CEIL(floor);
    let lampY;
    if (kind === 'pendant') {
      const drop = id === 'light-stair' ? 1.2 : 0.9;
      g.add(cylinder(0.005, 0.005, drop, 'darkMetal', 0, -drop, 0, 4));
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.25, 24, 1, true), shade);
      cone.position.y = -drop;
      g.add(cone);
      lampY = ceil - drop - 0.2;
    } else {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(kind === 'cove' ? 0.35 : 0.22, 0.3, 0.05, 32), shade);
      disc.position.y = -0.03;
      g.add(disc);
      lampY = ceil - 0.35;
    }
    g.position.set(x, ceil, z);
    root.add(g);
    // 吊顶灯槽：房间四周一圈下吊的石膏板，内侧是暖白色 LED 灯带
    let strip = null;
    if (kind === 'cove') {
      const r = INDOOR_ROOMS.find((q) => q.id === room);
      strip = uniqueMat({ color: 0xffffff, emissive: 0xffe0b0, emissiveIntensity: 0 });
      const drop = 0.15;
      const x0 = r.x0 + 0.1, x1 = r.x1 - 0.1, z0 = r.z0 + 0.1, z1 = r.z1 - 0.1;
      const band = (w, d, cx, cz) => root.add(box(w, drop, d, 'ceiling', cx, ceil - drop, cz, { cast: false }));
      band(x1 - x0, 0.45, (x0 + x1) / 2, z0 + 0.225); band(x1 - x0, 0.45, (x0 + x1) / 2, z1 - 0.225);
      band(0.45, z1 - z0 - 0.9, x0 + 0.225, (z0 + z1) / 2); band(0.45, z1 - z0 - 0.9, x1 - 0.225, (z0 + z1) / 2);
      const led = (w, d, cx, cz) => root.add(box(w, 0.02, d, strip, cx, ceil - drop - 0.005, cz, { cast: false }));
      led(x1 - x0 - 0.9, 0.03, (x0 + x1) / 2, z0 + 0.45); led(x1 - x0 - 0.9, 0.03, (x0 + x1) / 2, z1 - 0.45);
      led(0.03, z1 - z0 - 0.9, x0 + 0.45, (z0 + z1) / 2); led(0.03, z1 - z0 - 0.9, x1 - 0.45, (z0 + z1) / 2);
    }
    const lamp = lightPool.add({ position: new THREE.Vector3(x, lampY, z), distance: room.startsWith('hall') ? 7 : 9 });
    const dev = {
      id, room, floor, type: 'light', object: g, lamp, shade, strip, on: false, level: 0.8, cct: 4000,
      apply() {
        const col = kelvinToColor(this.cct);
        this.lamp.color.copy(col);
        this.lamp.intensity = this.on ? this.level * (room === 'living' || room === 'family' ? 26 : room.startsWith('hall') ? 10 : 16) : 0;
        this.shade.emissive.copy(col);
        this.shade.emissiveIntensity = this.on ? 0.6 + this.level * 2 : 0;
        if (this.strip) this.strip.emissiveIntensity = this.on ? this.level * 3 : 0;
        const info = this.object.userData.info;
        if (info) { info.data.状态 = this.on ? '开' : '关'; info.data.亮度 = Math.round(this.level * 100) + '%'; info.data.色温 = this.cct + ' K'; }
      },
      set(on, level = this.level, cct = this.cct) { this.on = on; this.level = level; this.cct = cct; this.apply(); },
      info: { name, category: '智能照明', room, func: '可调亮度与色温（2700K 暖光 ~ 6500K 冷光），支持人体感应自动开关和场景联动' + (kind === 'cove' ? '；吊顶灯槽内嵌 LED 灯带，提供柔和的间接照明' : ''), data: { 状态: '关', 亮度: '80%', 色温: '4000 K' } } as ModuleInfo,
    };
    dev.info.controls = [
      { type: 'toggle', label: '开关', get: () => dev.on, set: (v) => dev.set(v) },
      { type: 'range', label: '亮度', min: 0.1, max: 1, step: 0.05, get: () => dev.level, set: (v) => dev.set(dev.on, v) },
      { type: 'range', label: '色温 (K)', min: 2700, max: 6500, step: 100, get: () => dev.cct, set: (v) => dev.set(dev.on, dev.level, v) },
    ];
    register(dev);
    dev.apply();
  }
  const floorLampMat = uniqueMat({ color: 0xf3ead8, emissive: 0xffd9a0, emissiveIntensity: 0, roughness: 0.9, side: THREE.DoubleSide });
  const floorLamp = new THREE.Group();
  floorLamp.add(cylinder(0.15, 0.15, 0.03, 'darkMetal'), cylinder(0.015, 0.015, 1.5, 'darkMetal', 0, 0.03, 0, 8));
  floorLamp.add(cylinder(0.14, 0.2, 0.25, floorLampMat, 0, 1.45, 0));
  floorLamp.position.set(-7.5, 0, 1.28);
  root.add(floorLamp);
  register({ id: 'lamp-floor', room: 'living', floor: 0, type: 'lamp', object: floorLamp, on: false, set(on: boolean) { this.on = on; floorLampMat.emissiveIntensity = on ? 1.5 : 0; }, info: { name: '落地灯', category: '照明', room: 'living', func: '独立阅读灯模块；可由观影 / 阅读场景控制' } });

  // Television is modeled and controlled as a device module, independent from furniture layout.
  const tv = new THREE.Group();
  tv.add(box(0.05, 0.9, 1.6, 'blackPlastic', 0, 0, 0));
  const tvScreenMat = new THREE.MeshStandardMaterial({ color: 0x050608, roughness: 0.2, emissive: 0xffffff, emissiveIntensity: 0 });
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(1.52, 0.84), tvScreenMat);
  tvScreen.rotation.y = -Math.PI / 2; tvScreen.position.set(-0.03, 0.45, 0); tv.add(tvScreen);
  tv.position.set(-3.26, 0.95, 2.8);
  root.add(tv);
  const tvDevice = register({
    id: 'tv', room: 'living', floor: 0, type: 'tv', object: tv, on: false, screen: tvScreen,
    set(on: boolean) { this.on = on; tvScreenMat.emissiveIntensity = on ? 1.2 : 0; tvScreenMat.color.setHex(on ? 0xffffff : 0x050608); const i = this.object.userData.info; if (i) i.data.状态 = on ? '播放中' : '关闭'; },
    setTexture(texture: THREE.Texture) { tvScreenMat.emissiveMap = texture; tvScreenMat.map = texture; tvScreenMat.needsUpdate = true; },
    info: { name: '客厅智能电视', category: '影音设备 / 智慧家居', room: 'living', func: '支持观影场景联动，可接入动态节目画面', data: { 状态: '关闭' } },
  });
  tvDevice.info.controls = [{ type: 'toggle', label: '开关', get: () => tvDevice.on, set: (v: boolean) => tvDevice.set(v) }];

  // 夜间感应地脚灯：老人房床边 → 门口 → 走廊
  const nightMat = uniqueMat({ color: 0x333333, emissive: 0xffb866, emissiveIntensity: 0 });
  const nightStrip = new THREE.Group();
  for (const [x0, x1, z] of [[-4.8, -3.6, -1.15], [-7.8, -0.8, -0.86], [-6.1, -4.9, -2.7]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, 0.02, 0.02), nightMat);
    m.position.set((x0 + x1) / 2, 0.25, z);
    nightStrip.add(m);
  }
  root.add(nightStrip);
  register({ id: 'night-light', room: 'elder', floor: 0, type: 'nightLight', object: nightStrip, on: false, set(on) { this.on = on; nightMat.emissiveIntensity = on ? 2.5 : 0; }, info: { name: '夜间感应地脚灯', category: '适老无障碍 / 智能照明', func: '夜间起床时自动点亮床边至卫生间的低位灯带，亮度柔和不刺眼', room: 'elder' } });

  // ================= 窗帘 =================
  const curtainDefs = [
    ['curtain-elder', 'elder', '老人房窗帘', 0, -4.84, -6.5, -4.5],
    ['curtain-living', 'living', '客厅电动窗帘', 0, 4.84, -6.6, -2.6],
    ['curtain-dining', 'dining', '餐厅窗帘', 0, 4.84, 0.2, 2.4],
    ['curtain-master', 'master', '主卧窗帘', 1, -4.84, -6.4, -4.4],
    ['curtain-kid', 'kid', '儿童房窗帘', 1, -4.84, 5.0, 7.0],
    ['curtain-study', 'study', '书房窗帘', 1, 4.84, -7.0, -5.0],
    ['curtain-family', 'family', '起居室电动窗帘', 1, 4.84, -2.8, 1.6],
    ['curtain-guest', 'guest', '客房窗帘', 1, 4.84, 4.6, 6.6],
  ];
  const curtainMat = mat('curtain');
  for (const [id, room, name, floor, c, a, b] of curtainDefs as [string, string, string, number, number, number, number][]) {
    const w = b - a + 0.4, h = 2.65;
    const g = new THREE.Group();
    const halves = [];
    for (const side of [-1, 1]) {
      const geo = new THREE.PlaneGeometry(w / 2, h, 30, 1);
      const pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin(pos.getX(i) * 28) * 0.035);
      geo.computeVertexNormals();
      geo.translate(-side * w / 4, h / 2, 0); // 以外侧边缘为原点，缩放时向外侧收拢
      const pivot = new THREE.Group();
      pivot.position.x = side * w / 2;
      pivot.userData.dynamic = true; // 会收拢的窗帘
      const holder = new THREE.Group();
      const mesh = new THREE.Mesh(geo, curtainMat);
      mesh.castShadow = true;
      holder.add(mesh);
      pivot.add(holder);
      g.add(pivot);
      halves.push({ holder });
    }
    g.add(box(w + 0.1, 0.04, 0.06, 'darkMetal', 0, h + 0.02, 0));
    g.position.set((a + b) / 2, Y(floor) + 0.02, c);
    if (c > 0) g.rotation.y = Math.PI;
    root.add(g);
    const dev = {
      id, room, floor, type: 'curtain', object: g, open: 1, target: 1,
      set(v) { this.target = typeof v === 'number' ? THREE.MathUtils.clamp(v, 0, 1) : v ? 1 : 0; },
      update(dt) {
        this.open += Math.sign(this.target - this.open) * Math.min(Math.abs(this.target - this.open), dt * 0.8);
        for (const hh of halves) hh.holder.scale.x = 1 - 0.8 * this.open;
        const info = this.object.userData.info;
        if (info) info.data.开合度 = Math.round(this.open * 100) + '%';
      },
      info: { name, category: '智能家居', room, func: '电动窗帘，可按场景自动开合；遮光面料，隔热降噪', data: { 开合度: '100%' } } as ModuleInfo,
    };
    dev.info.controls = [{ type: 'toggle', label: '打开', get: () => dev.target > 0.5, set: (v) => dev.set(v) }];
    register(dev);
    dev.update(10);
  }

  // ================= 空调 =================
  const acDefs = [
    ['ac-living', 'living', '客厅空调', 0, -7.86, 2.8, '+x'],
    ['ac-elder', 'elder', '老人房空调', 0, -3.34, -2.0, '-x'],
    ['ac-master', 'master', '主卧空调', 1, -2.74, -1.9, '-x'],
    ['ac-kid', 'kid', '儿童房空调', 1, 3.54, -2.2, '+x'],
    ['ac-study', 'study', '书房空调', 1, -3.74, 1.1, '-x'],
    ['ac-family', 'family', '起居室空调', 1, -3.46, 4.3, '+x'],
    ['ac-guest', 'guest', '客房空调', 1, 7.86, 1.8, '-x'],
  ];
  for (const [id, room, name, floor, x, z, facing] of acDefs as [string, string, string, number, number, number, keyof typeof FACING][]) {
    const g = new THREE.Group();
    g.add(box(0.9, 0.28, 0.2, 'whiteGloss', 0, 0, 0.1, { rounded: 0.04 }));
    g.add(box(0.75, 0.02, 0.01, 'darkMetal', 0, 0.04, 0.2, { cast: false }));
    const led = statusLed(0.012); led.position.set(0.35, 0.2, 0.205); g.add(led);
    wallMount(g, x, Y(floor) + 2.45, z, facing);
    const dev = {
      id, room, floor, type: 'ac', object: g, led, on: false, setpoint: 26,
      set(on, sp = this.setpoint) { this.on = on; this.setpoint = sp; led.material.emissive.setHex(on ? 0x3fa9f5 : STATUS_COLOR.off); const i = this.object.userData.info; if (i) { i.data.状态 = on ? '运行' : '关闭'; i.data.设定温度 = sp + ' ℃'; } },
      info: { name, category: '空调 / 节能', room, func: '一级能效变频空调，与门窗联动：开窗时自动暂停', maintain: '滤网清洗：2026-06', data: { 状态: '关闭', 设定温度: '26 ℃', 能效等级: '1 级' } } as ModuleInfo,
    };
    dev.info.controls = [
      { type: 'toggle', label: '开关', get: () => dev.on, set: (v) => dev.set(v) },
      { type: 'range', label: '设定温度', min: 16, max: 30, step: 1, get: () => dev.setpoint, set: (v) => dev.set(dev.on, v) },
    ];
    register(dev);
    dev.set(false);
  }

  // ================= 新风系统 =================
  const ventPositions: [number, number, string, number][] = [[-6.2, -2.2, 'elder', 0], [-4.0, 1.6, 'living', 0], [1.0, 1.6, 'dining', 0], [-1.6, -3.9, 'bath1', 0],
    [-6.4, -2.2, 'master', 1], [6.8, -2.2, 'kid', 1], [-6.6, 1.6, 'study', 1], [-0.2, 1.6, 'family', 1], [6.4, 3.8, 'guest', 1]];
  const ventGroup = new THREE.Group();
  const vents = [];
  for (const [x, z, room, floor] of ventPositions) {
    ventGroup.add(box(0.35, 0.02, 0.35, 'plastic', x, CEIL(floor) - 0.03, z, { cast: false }), box(0.28, 0.005, 0.28, 'darkMetal', x, CEIL(floor) - 0.035, z, { cast: false }));
    vents.push({ x, z, room, floor, y: CEIL(floor) - 0.05 });
  }
  ventGroup.add(box(0.9, 0.3, 0.6, 'whiteGloss', 6.8, CEIL(0) - 0.32, -4.4));
  const freshLed = statusLed(0.02); freshLed.position.set(7.26, CEIL(0) - 0.18, -4.4); ventGroup.add(freshLed);
  root.add(ventGroup);
  const fresh = register({
    id: 'fresh-air', room: 'utility', floor: 0, type: 'freshAir', object: ventGroup, led: freshLed, on: false, level: 2, vents,
    set(on, level = this.level) { this.on = on; this.level = level; freshLed.material.emissive.setHex(on ? STATUS_COLOR.normal : STATUS_COLOR.off); const i = this.object.userData.info; if (i) { i.data.状态 = on ? '运行' : '关闭'; i.data.风量档位 = level + ' 档'; } },
    info: { name: '全热交换新风系统', category: '健康舒适 / 智慧', room: 'utility', func: '主机在设备间吊顶内，室外新风经 H13 过滤后送入卧室、客厅、书房等，同时排出污浊空气；热回收效率 75%', maintain: '滤芯更换：2026-05', data: { 状态: '关闭', 风量档位: '2 档', 额定风量: '350 m³/h' } },
  });
  fresh.info.controls = [
    { type: 'toggle', label: '开关', get: () => fresh.on, set: (v) => fresh.set(v) },
    { type: 'range', label: '风量档位', min: 1, max: 3, step: 1, get: () => fresh.level, set: (v) => fresh.set(fresh.on, v) },
  ];
  fresh.set(false);

  // ================= 传感器 =================
  // 每个室内房间：墙上温湿度 / PM2.5 传感器 + 天花板毫米波人体存在传感器（也用于跌倒检测）
  for (const r of INDOOR_ROOMS) {
    const g = new THREE.Group();
    g.add(box(0.08, 0.08, 0.025, 'plastic', 0, 0, 0.012));
    const led = statusLed(0.008); led.position.set(0, 0.06, 0.026); g.add(led);
    wallMount(g, r.x1 - 0.12, Y(r.floor) + 1.5, r.z0 + 0.5, '-x');
    register({ id: 'env-' + r.id, room: r.id, floor: r.floor, type: 'envSensor', object: g, led, info: { name: '温湿度 / PM2.5 传感器', category: '智慧 / 传感器', room: r.id, func: '每 10 秒上报温度、湿度、PM2.5、CO₂', data: {} } });
    const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), mat('plastic'));
    s.rotation.x = Math.PI;
    s.position.set(r.x0 + 0.4, CEIL(r.floor) - 0.01, r.z0 + 0.4);
    root.add(s);
    register({ id: 'presence-' + r.id, room: r.id, floor: r.floor, type: 'presence', object: s, info: { name: '毫米波人体存在传感器', category: '智慧 / 传感器', room: r.id, func: '检测房间内是否有人、人的位置和姿态，用于灯光联动与跌倒检测（不拍摄图像，保护隐私）', data: { 检测结果: '无人' } } });
  }

  // ================= 安全设施 =================
  const smokeRooms = [['elder', 0, -4.6, -2.2], ['living', 0, -2.0, 3.8], ['kitchen', 0, 4.4, 2.3], ['hall1', 0, -1.5, -0.2], ['dining', 0, 2.4, 1.3], ['utility', 0, 4.6, -2.2],
    ['stair2', 1, 2.6, -1.5], ['master', 1, -4.0, -2.0], ['kid', 1, 4.6, -2.2], ['study', 1, -4.6, 2.0], ['family', 1, 1.2, 1.6], ['guest', 1, 4.4, 1.8], ['hall2', 1, -1.5, -0.2]];
  for (const [room, floor, x, z] of smokeRooms as [string, number, number, number][]) {
    const g = new THREE.Group();
    g.add(cylinder(0.07, 0.08, 0.04, 'plastic', 0, 0, 0, 20));
    const led = statusLed(0.01); led.position.set(0.04, -0.005, 0); g.add(led);
    g.position.set(x, CEIL(floor) - 0.045, z);
    root.add(g);
    register({ id: 'smoke-' + room, room, floor, type: 'smoke', object: g, led, info: { name: '光电感烟火灾探测器', category: '消防设施', room, func: '检测烟雾浓度，超限时本地声光报警并上报物业消防控制中心', maintain: '月度自检：2026-09 正常', data: { 烟雾浓度: '0.00 dB/m' } } });
  }
  // 可燃气体探测器 + 燃气管道 + 电动切断阀（厨房东墙）
  const gasDet = new THREE.Group();
  gasDet.add(box(0.12, 0.16, 0.04, 'plastic', 0, 0, 0.02));
  const gasLed = statusLed(0.012); gasLed.position.set(0, 0.12, 0.042); gasDet.add(gasLed);
  wallMount(gasDet, 7.88, 2.55, 1.05, '-x');
  register({ id: 'gas-detector', room: 'kitchen', floor: 0, type: 'gasDetector', object: gasDet, led: gasLed, info: { name: '可燃气体探测器', category: '安全 / 智慧', room: 'kitchen', func: '安装在燃气灶上方靠近天花板处（天然气比空气轻），浓度超标时联动关阀、开窗、启动排风', maintain: '标定：2026-03', data: { 甲烷浓度: '0 %LEL' } } });
  const pipe = new THREE.Group();
  pipe.add(cylinder(0.02, 0.02, 3.0 - 1.25, 'metal', 0, 1.25, 0, 10));
  pipe.add(box(0.12, 0.1, 0.1, 'darkMetal', 0, 1.2, 0.04), box(0.1, 0.12, 0.12, 'red', 0, 1.3, 0.08));
  const valveHandle = box(0.16, 0.02, 0.025, 'red', 0, 1.24, 0.12);
  valveHandle.userData.dynamic = true;
  pipe.add(valveHandle);
  const hp2 = cylinder(0.015, 0.015, 0.6, 'metal', 0, 0, 0, 8); hp2.rotation.x = Math.PI / 2; hp2.position.set(0, 1.1, 0.3); pipe.add(hp2);
  const valveLed = statusLed(0.015); valveLed.position.set(0, 1.39, 0.12); pipe.add(valveLed);
  wallMount(pipe, 7.88, 0, 1.05, '-x');
  const valve = register({
    id: 'gas-valve', room: 'kitchen', floor: 0, type: 'valve', object: pipe, led: valveLed, open: true, handle: valveHandle,
    set(open) { this.open = open; this.handle.rotation.z = open ? 0 : Math.PI / 2; const i = this.object.userData.info; if (i) i.data.阀门 = open ? '开启' : '已切断'; },
    info: { name: '燃气管道 + 电动切断阀', category: '安全 / 智慧', room: 'kitchen', func: '检测到燃气泄漏或火灾时自动切断气源；可远程控制', maintain: '管道气密性检测：2026-04 合格', data: { 阀门: '开启', 管道压力: '2.0 kPa' } },
  });
  valve.info.controls = [{ type: 'toggle', label: '阀门开启', get: () => valve.open, set: (v) => valve.set(v) }];

  const extinguisher = (x, z, floor) => {
    const g = new THREE.Group();
    g.add(cylinder(0.08, 0.08, 0.45, 'red', 0, 0, 0, 16), cylinder(0.03, 0.05, 0.08, 'darkMetal', 0, 0.45, 0, 8), box(0.12, 0.02, 0.03, 'blackPlastic', 0.04, 0.53, 0));
    g.position.set(x, Y(floor) + 0.02, z);
    root.add(g);
    return g;
  };
  register({ id: 'ext-kitchen', room: 'kitchen', floor: 0, type: 'extinguisher', object: extinguisher(3.45, 2.6, 0), info: { name: '干粉灭火器（2kg）', category: '消防设施', room: 'kitchen', func: '可扑救初期固体、液体、气体火灾', maintain: '压力正常，有效期至 2029-06', data: { 压力: '1.2 MPa（绿区）' } } });
  register({ id: 'ext-hall1', room: 'hall1', floor: 0, type: 'extinguisher', object: extinguisher(-7.75, 0.45, 0), info: { name: '干粉灭火器（4kg）', category: '消防设施', room: 'hall1', func: '玄关处配置，疏散时可就近取用', maintain: '有效期至 2029-06', data: { 压力: '1.2 MPa（绿区）' } } });
  register({ id: 'ext-hall2', room: 'hall2', floor: 1, type: 'extinguisher', object: extinguisher(-7.75, 0.45, 1), info: { name: '干粉灭火器（4kg）', category: '消防设施', room: 'hall2', func: '二层走廊配置', maintain: '有效期至 2029-06', data: { 压力: '1.2 MPa（绿区）' } } });
  const blanket = box(0.3, 0.35, 0.08, 'red', 0, 0, 0);
  wallMount(blanket, 3.34, 1.3, 3.0, '+x');
  register({ id: 'fire-blanket', room: 'kitchen', floor: 0, type: 'blanket', object: blanket, info: { name: '灭火毯', category: '消防设施', room: 'kitchen', func: '覆盖油锅起火，隔绝空气灭火' } });

  const alarmLamps = [
    lightPool.add({ position: new THREE.Vector3(0, 2.6, -0.2), color: new THREE.Color(0xff2020), distance: 14, priority: 5 }),
    lightPool.add({ position: new THREE.Vector3(0, FLOOR_H + 2.6, -0.2), color: new THREE.Color(0xff2020), distance: 14, priority: 5 }),
  ];
  const strobe = (x, y, z, facing, id, room, floor) => {
    const m = uniqueMat({ color: 0x661111, emissive: 0xff2020, emissiveIntensity: 0, transparent: true, opacity: 0.95 });
    const g = new THREE.Group();
    g.add(box(0.14, 0.14, 0.05, 'plastic', 0, 0, 0.025));
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m);
    dome.rotation.x = Math.PI / 2; dome.position.set(0, 0.07, 0.05);
    g.add(dome);
    wallMount(g, x, Y(floor) + y, z, facing);
    register({ id, room, floor, type: 'strobe', object: g, indicatorMaterial: m, indicatorLight: alarmLamps[floor], info: { name: '壁挂式声光报警器', category: '消防设施', room, func: '火灾、燃气泄漏、入侵、一键呼叫时发出声光警报', maintain: '2026-09 测试正常' } });
  };
  strobe(-7.88, 2.4, 0.45, '+x', 'strobe-hall1', 'hall1', 0);
  strobe(3.32, 2.4, 3.8, '+x', 'strobe-kitchen', 'kitchen', 0);
  strobe(-7.88, 2.4, -1.4, '+x', 'strobe-elder', 'elder', 0);
  strobe(-7.88, 2.4, 0.45, '+x', 'strobe-hall2', 'hall2', 1);
  const exitTex = markSharedTexture(textTexture(['安全出口', 'EXIT'], { w: 256, h: 110, bg: '#0f7a3a', font: 'bold 40px "Microsoft YaHei", sans-serif' }));
  const stairTex = markSharedTexture(textTexture(['疏散楼梯 ↓', 'EXIT'], { w: 256, h: 110, bg: '#0f7a3a', font: 'bold 38px "Microsoft YaHei", sans-serif' }));
  const exitSign = (x, y, z, facing, name, floor, tex = exitTex) => {
    const m = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.4 });
    const g = new THREE.Group();
    g.add(box(0.42, 0.2, 0.03, 'plastic', 0, 0, 0.015));
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.17), m);
    face.position.z = 0.032; face.position.y = 0.1;
    g.add(face);
    wallMount(g, x, Y(floor) + y, z, facing);
    register({ id: 'exit-' + name, room: floor ? 'hall2' : 'hall1', floor, type: 'exitSign', object: g, indicatorMaterial: m, info: { name: '安全出口标志（' + name + '）', category: '消防设施', func: '自带蓄电池，断电后持续点亮 ≥ 90 分钟', maintain: '2026-09 巡检正常' } });
  };
  exitSign(-7.88, 2.45, -0.2, '+x', '入户门', 0);
  exitSign(7.88, 2.45, -0.2, '-x', '后门', 0);
  exitSign(-4.6, 2.72, 4.88, '-z', '客厅落地门', 0);
  exitSign(0.7, 2.55, -0.88, '+z', '二层楼梯', 1, stairTex);
  for (const [x, floor] of [[-6, 0], [0, 0], [5.5, 0], [-6, 1], [3, 1]]) {
    const m = uniqueMat({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0 });
    const g = box(0.3, 0.08, 0.1, m, x, CEIL(floor) - 0.1, -0.84);
    root.add(g);
    register({ id: `emergency-${floor}-${x}`, room: floor ? 'hall2' : 'hall1', floor, type: 'emergency', object: g, indicatorMaterial: m, info: { name: '应急照明灯', category: '消防设施', func: '火灾或停电时自动点亮，照亮疏散通道' } });
  }

  const sosButton = (id, room, x, y, z, facing, name) => {
    const g = new THREE.Group();
    g.add(box(0.12, 0.12, 0.03, 'plastic', 0, 0, 0.015));
    const m = uniqueMat({ color: 0xcc2222, emissive: 0xff0000, emissiveIntensity: 0.15 });
    const btn = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), m);
    btn.rotation.x = Math.PI / 2; btn.position.set(0, 0.06, 0.035);
    g.add(btn);
    g.add(cylinder(0.003, 0.003, 0.6, 'plastic', 0, -0.55, 0.03, 4));
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 6), mat('red')).translateY(-0.56).translateZ(0.03));
    wallMount(g, x, y, z, facing);
    register({ id, room, floor: 0, type: 'sos', object: g, btnMat: m, active: false, info: { name, category: '安全 / 适老', room, func: '紧急情况下按下按钮或拉动拉绳（跌倒在地也能够到），立即向家属手机和物业值班终端发送求助信息', data: { 状态: '待机' } } });
  };
  sosButton('sos-elder', 'elder', -6.4, 0.85, -4.88, '+z', '一键呼叫按钮（老人房床头）'); // 床头西侧，拉绳垂到地面附近，跌倒时也能够到
  sosButton('sos-bath', 'bath1', -3.08, 0.85, -2.45, '+x', '一键呼叫按钮（卫生间）');

  for (const [id, room, x, z, floor] of [['leak-bath1', 'bath1', -1.4, -4.6, 0], ['leak-bath2', 'bath2', -1.0, -3.6, 1], ['leak-utility', 'utility', 4.6, -4.2, 0]] as [string, string, number, number, number][]) {
    const s = box(0.08, 0.02, 0.08, 'plastic', x, Y(floor) + 0.015, z, { cast: false });
    root.add(s);
    register({ id, room, floor, type: 'leak', object: s, info: { name: '水浸传感器', category: '安全 / 智慧', room, func: '检测地面积水，联动关闭进水总阀并推送提醒' } });
  }
  const wv = new THREE.Group();
  wv.add(cylinder(0.03, 0.03, 1.2, 'metal', 0, 0, 0, 8), box(0.14, 0.1, 0.1, 'darkMetal', 0, 0.5, 0.04));
  const wvHandle = box(0.16, 0.02, 0.025, new THREE.MeshStandardMaterial({ color: 0x1f6fd1 }), 0, 0.56, 0.1);
  wvHandle.userData.dynamic = true;
  wv.add(wvHandle);
  wallMount(wv, 3.52, 0, -4.0, '+x');
  const waterValve = register({
    id: 'water-valve', room: 'utility', floor: 0, type: 'valve', object: wv, open: true, handle: wvHandle,
    set(open) { this.open = open; this.handle.rotation.z = open ? 0 : Math.PI / 2; const i = this.object.userData.info; if (i) i.data.阀门 = open ? '开启' : '已关闭'; },
    info: { name: '自来水进水总阀（电动）', category: '安全 / 智慧', room: 'utility', func: '水浸传感器报警时自动关闭，防止漏水扩大', data: { 阀门: '开启', 今日用水: '0.42 m³' } },
  });
  waterValve.info.controls = [{ type: 'toggle', label: '阀门开启', get: () => waterValve.open, set: (v) => waterValve.set(v) }];

  const panel = new THREE.Group();
  panel.add(box(0.45, 0.55, 0.12, 'whiteGloss', 0, 0, 0.06));
  const panelLed = statusLed(0.015); panelLed.position.set(0.17, 0.5, 0.125); panel.add(panelLed);
  wallMount(panel, -5.9, 1.35, -0.9, '+z');
  register({ id: 'distribution', room: 'hall1', floor: 0, type: 'distribution', object: panel, led: panelLed, info: { name: '智能配电箱', category: '安全 / 绿色', room: 'hall1', func: '漏电保护、过载保护；分回路计量用电，数据接入能源管理系统', maintain: '绝缘测试：2026-07 合格', data: { 总电流: '—', 漏电流: '2 mA' } } });
  const gateway = new THREE.Group();
  gateway.add(box(0.2, 0.2, 0.04, 'whiteGloss', 0, 0, 0.02, { rounded: 0.01 }));
  const gwLed = statusLed(0.01); gwLed.position.set(0, 0.15, 0.042); gateway.add(gwLed);
  wallMount(gateway, -5.3, 1.5, -0.9, '+z');
  register({ id: 'gateway', room: 'hall1', floor: 0, type: 'gateway', object: gateway, led: gwLed, info: { name: '家庭智能网关', category: '智慧', room: 'hall1', func: '连接全屋传感器与设备（Zigbee / Wi-Fi），执行场景联动规则，上报物业平台', data: { 在线设备: '—' } } });
  const intercom = new THREE.Group();
  intercom.add(box(0.18, 0.26, 0.03, 'blackPlastic', 0, 0, 0.015));
  const icScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.1), uniqueMat({ color: 0x111111, emissive: 0x4488ff, emissiveIntensity: 0.3 }));
  icScreen.position.set(0, 0.16, 0.031); intercom.add(icScreen);
  wallMount(intercom, -7.88, 1.4, 0.48, '+x');
  register({ id: 'intercom', room: 'hall1', floor: 0, type: 'intercom', object: intercom, info: { name: '可视对讲室内机', category: '智慧 / 安防', room: 'hall1', func: '查看门口访客画面，远程开门' } });
  const lockG = new THREE.Group();
  lockG.add(box(0.07, 0.28, 0.04, 'blackPlastic', 0, 0, 0));
  const lockLed = statusLed(0.01); lockLed.position.set(0, 0.22, 0.022); lockG.add(lockLed);
  lockG.position.set(0.85, 0.95, 0.045);
  const entryDoorPivot = assembly.entryDoorPivot;
  if (entryDoorPivot) entryDoorPivot.add(lockG); else root.add(lockG);
  const lock = register({
    id: 'smart-lock', room: 'hall1', floor: 0, type: 'lock', object: lockG, led: lockLed, locked: true,
    set(locked) { this.locked = locked; lockLed.material.emissive.setHex(locked ? 0x3fa9f5 : STATUS_COLOR.normal); const i = this.object.userData.info; if (i) i.data.状态 = locked ? '已上锁' : '已开锁'; },
    info: { name: '智能门锁', category: '智慧 / 安防', room: 'hall1', func: '指纹 / 人脸 / 手机开锁；火灾时自动解锁便于疏散', data: { 状态: '已上锁', 电量: '86%' } },
  });
  lock.info.controls = [{ type: 'toggle', label: '上锁', get: () => lock.locked, set: (v) => lock.set(v) }];
  lock.set(true);
  for (const [id, name, x, y, z, facing, yaw] of [['camera', '门口摄像头', -8.14, 2.5, 1.1, '-x', 0], ['camera-back', '后院摄像头', 8.14, 2.6, -4.6, '+x', 0.5]] as [string, string, number, number, number, keyof typeof FACING, number][]) {
    const cam = new THREE.Group();
    cam.add(box(0.1, 0.1, 0.22, 'whiteGloss', 0, 0, 0.11, { rounded: 0.02 }));
    const lens = cylinder(0.03, 0.03, 0.02, 'blackPlastic', 0, -0.01, 0.22, 12); lens.rotateX(Math.PI / 2); cam.add(lens);
    const camLed = statusLed(0.008); camLed.position.set(0.04, 0.06, 0.18); cam.add(camLed);
    // 视野锥：布防 / 入侵时显示
    const cone = new THREE.Mesh(new THREE.ConeGeometry(3.5, 8, 24, 1, true), new THREE.MeshBasicMaterial({ color: 0x3fa9f5, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
    cone.geometry.translate(0, -4, 0);
    cone.rotation.x = -Math.PI / 2 - 0.3;
    cone.visible = false; cone.userData.noPick = true; cone.userData.dynamic = true;
    cam.add(cone);
    wallMount(cam, x, y, z, facing);
    cam.rotation.y += yaw;
    register({ id, room: null, floor: 0, type: 'camera', object: cam, cone, led: camLed, info: { name, category: '智慧 / 安防', func: 'AI 摄像头：离家模式下自动布防，识别人形入侵并推送提醒、联动灯光与声光报警', data: { 状态: '在线' } } });
  }
  const floodMat = uniqueMat({ color: 0xffffff, emissive: 0xfff4d6, emissiveIntensity: 0 });
  const floodlightRoot = new THREE.Group();
  for (const [x, z] of [[8.12, -3.8], [-8.12, -3.8]]) floodlightRoot.add(box(0.1, 0.12, 0.25, floodMat, x, 3.0, z));
  root.add(floodlightRoot);
  const floodLamp = lightPool.add({ position: new THREE.Vector3(9.5, 3.0, -5.5), color: new THREE.Color(0xfff4d6), distance: 16, priority: 3 });
  register({ id: 'floodlight', room: null, floor: 0, type: 'flood', object: floodlightRoot, on: false, set(on) { this.on = on; floodMat.emissiveIntensity = on ? 3 : 0; floodLamp.intensity = on ? 40 : 0; } });

  // ================= 家用电梯（适老） =================
  const e = ELEVATOR;
  const cab = new THREE.Group();
  const cw = e.x1 - e.x0 - 0.12, cd = e.z1 - e.z0 - 0.12;
  cab.add(box(cw, 0.08, cd, 'darkMetal', 0, 0, 0));
  cab.add(box(cw, 2.2, 0.03, 'woodPanel', 0, 0.08, -cd / 2));
  cab.add(box(0.03, 2.2, cd, 'woodPanel', -cw / 2, 0.08, 0));
  cab.add(box(0.03, 2.2, cd, 'woodPanel', cw / 2, 0.08, 0));
  cab.add(box(cw, 0.06, cd, 'whiteGloss', 0, 2.28, 0));
  cab.add(box(0.5, 0.02, 0.5, uniqueMat({ color: 0xffffff, emissive: 0xfff2d8, emissiveIntensity: 1.2 }), 0, 2.26, 0, { cast: false }));
  const handrail = cylinder(0.02, 0.02, cd - 0.2, 'metal', 0, 0, 0, 8); handrail.rotation.x = Math.PI / 2; handrail.position.set(-cw / 2 + 0.06, 0.95, 0); cab.add(handrail);
  const doorL = box(cw / 2, 2.1, 0.03, 'metal', -cw / 4, 0.1, cd / 2);
  const doorR = box(cw / 2, 2.1, 0.03, 'metal', cw / 4, 0.1, cd / 2);
  doorL.userData.dynamic = doorR.userData.dynamic = true;
  cab.add(doorL, doorR);
  cab.position.set((e.x0 + e.x1) / 2, 0.02, (e.z0 + e.z1) / 2);
  root.add(cab);
  const elevator = register({
    id: 'elevator', room: 'stair1', floor: 0, type: 'elevator', object: cab, y: 0, targetFloor: 0, doorOpen: 0, doorTarget: 0, moving: false, onArrive: null,
    /** 呼叫电梯到某层：关门 → 运行 → 到站开门 */
    call(floor, onArrive) {
      if (this.status === 'fault') return false;
      this.targetFloor = floor; this.onArrive = onArrive ?? null; this.doorTarget = 0; this.moving = true;
      return true;
    },
    update(dt) {
      const ty = FLOORS[this.targetFloor].y;
      if (this.moving && this.doorOpen <= 0.01) {
        const d = ty - this.y;
        this.y += Math.sign(d) * Math.min(Math.abs(d), dt * 0.6); // 运行速度 0.6 m/s
        if (Math.abs(ty - this.y) < 1e-3) {
          this.y = ty; this.moving = false; this.doorTarget = 1;
          const cb = this.onArrive; this.onArrive = null;
          if (cb) setTimeout(cb, 1200);
          setTimeout(() => { if (!this.moving) this.doorTarget = 0; }, 6000);
        }
      }
      this.doorOpen += Math.sign(this.doorTarget - this.doorOpen) * Math.min(Math.abs(this.doorTarget - this.doorOpen), dt * 1.2);
      doorL.position.x = -cw / 4 - this.doorOpen * cw * 0.45;
      doorR.position.x = cw / 4 + this.doorOpen * cw * 0.45;
      this.object.position.y = this.y + 0.02;
      const i = this.object.userData.info;
      if (i) { i.data.所在楼层 = (this.y > FLOOR_H / 2 ? 2 : 1) + ' 层'; i.data.运行状态 = this.status === 'fault' ? '故障停梯' : this.moving ? (ty > this.y ? '上行' : '下行') : '待机'; }
    },
    info: { name: '家用电梯（无障碍）', category: '适老无障碍 / 安全', room: 'stair1', func: '载重 320kg，轿厢可容纳轮椅；配紧急呼叫、断电自动平层；火灾时停止使用，疏散走楼梯', maintain: '年检：2026-04 合格；下次维保 2026-10', data: { 所在楼层: '1 层', 运行状态: '待机', 年检: '合格' } },
  });
  elevator.info.controls = [
    { type: 'button', label: '呼叫到 1 层', onClick: () => elevator.call(0) },
    { type: 'button', label: '呼叫到 2 层', onClick: () => elevator.call(1) },
  ];

  // ================= 绿色能源设施 =================
  // 屋顶光伏：铺在南坡屋面上，3 排 × 10 块，每块 1.0m × 1.7m、约 330W，倾角即屋面坡度 25°
  const roofParts = assembly.pvRoof ?? { ridgeY: 8.265 };
  const pvGroup = new THREE.Group();
  pvGroup.name = 'pv';
  const panelGeo = new THREE.BoxGeometry(1.0, 0.04, 1.7);
  const pitch = THREE.MathUtils.degToRad(ROOF_PITCH);
  for (const s of [1.1, 2.75, 4.4]) for (let i = 0; i < 10; i++) {
    const p = new THREE.Mesh(panelGeo, mat('solar'));
    // s 为沿坡面到屋脊的水平距离；面板比屋面高出约 0.15m
    p.position.set(-5.2 + i * 1.08, roofParts.ridgeY - s * Math.tan(pitch) + 0.17, s);
    p.rotation.x = pitch;
    p.castShadow = true; p.receiveShadow = true;
    pvGroup.add(p);
  }
  root.add(pvGroup);
  register({ id: 'pv', room: null, floor: 1, type: 'pv', object: pvGroup, info: { name: '屋顶光伏阵列', category: '绿色低碳', func: '30 块单晶硅组件铺设在南坡屋面，装机 9.9 kWp，倾角 25°。光伏发电 → 逆变器 → 家庭用电 / 储能电池 / 充电桩 / 余电上网', maintain: '组件清洗：2026-08', data: { 装机容量: '9.9 kWp', 当前功率: '—' } } });
  const inv = new THREE.Group();
  inv.add(box(0.5, 0.6, 0.2, 'whiteGloss', 0, 0, 0.1, { rounded: 0.02 }));
  const invScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.1), uniqueMat({ color: 0x111111, emissive: 0x33ff99, emissiveIntensity: 0.6 }));
  invScreen.position.set(0, 0.42, 0.201); inv.add(invScreen);
  const invLed = statusLed(0.015); invLed.position.set(0.18, 0.52, 0.2); inv.add(invLed);
  wallMount(inv, 8.1, 1.3, -2.0, '+x');
  register({ id: 'inverter', room: null, floor: 0, type: 'inverter', object: inv, led: invLed, info: { name: '光伏逆变器', category: '绿色低碳', func: '把光伏板的直流电转换为 220V 交流电，最大转换效率 98%', maintain: '2026-09 运行正常', data: {} } });
  const bat = new THREE.Group();
  bat.add(box(0.6, 1.1, 0.4, 'whiteGloss', 0, 0, 0, { rounded: 0.03 }));
  const socBar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.8, 0.01), uniqueMat({ color: 0x113311, emissive: 0x2ecc71, emissiveIntensity: 1 }));
  socBar.position.set(0.31, 0.55, 0); socBar.rotation.y = Math.PI / 2; bat.add(socBar);
  socBar.userData.dynamic = true;
  bat.position.set(8.55, 0, -2.9);
  bat.rotation.y = Math.PI / 2;
  root.add(bat);
  register({ id: 'battery', room: null, floor: 0, type: 'battery', object: bat, socBar, info: { name: '家用储能电池', category: '绿色低碳', func: '白天储存多余光伏电量，夜间放电供家庭使用，减少从电网购电', data: { 容量: '10 kWh' } } });
  const hp = new THREE.Group();
  hp.add(box(0.95, 0.75, 0.4, 'whiteGloss', 0, 0, 0, { rounded: 0.02 }));
  const fanRing = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.02, 8, 24), mat('darkMetal')); fanRing.position.set(-0.15, 0.38, 0.21); hp.add(fanRing);
  const fan = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.01), mat('darkMetal')); fan.position.set(-0.15, 0.38, 0.21); hp.add(fan);
  fan.userData.dynamic = true;
  hp.position.set(9.3, 0, -4.2);
  hp.rotation.y = Math.PI / 2;
  root.add(hp);
  register({ id: 'heatpump', room: null, floor: 0, type: 'heatpump', object: hp, fan, running: false, update(dt) { if (this.running) this.fan.rotation.z += dt * 12; }, info: { name: '空气源热泵热水机', category: '绿色低碳', func: '从空气中吸热制取生活热水，能效比 COP≈4，比电热水器省电约 75%', data: { COP: '4.1', 水箱温度: '52 ℃' } } });
  const tankG = new THREE.Group();
  tankG.add(cylinder(0.3, 0.3, 1.6, 'whiteGloss', 0, 0, 0, 24), cylinder(0.31, 0.31, 0.04, 'darkMetal', 0, 1.6, 0, 24));
  tankG.position.set(7.45, 0, -4.4);
  root.add(tankG);
  register({ id: 'water-tank', room: 'utility', floor: 0, type: 'tank', object: tankG, info: { name: '热泵热水箱（200L）', category: '绿色低碳', room: 'utility', func: '储存热泵制取的生活热水，保温层 50mm', data: { 水温: '52 ℃' } } });
  const chg = new THREE.Group();
  chg.add(box(0.3, 0.45, 0.12, 'whiteGloss', 0, 0, 0.06, { rounded: 0.02 }));
  const chgLed = statusLed(0.012); chgLed.position.set(0, 0.38, 0.125); chg.add(chgLed);
  chg.add(cylinder(0.015, 0.015, 0.6, 'blackPlastic', 0.1, -0.5, 0.1, 6));
  wallMount(chg, -8.14, 1.0, 4.3, '-x');
  const charger = register({ id: 'ev-charger', room: null, floor: 0, type: 'charger', object: chg, led: chgLed, on: false, set(on) { this.on = on; chgLed.material.emissive.setHex(on ? 0x3fa9f5 : STATUS_COLOR.normal); const i = this.object.userData.info; if (i) i.data.状态 = on ? '充电中 7 kW' : '空闲'; }, info: { name: '家用交流充电桩（7kW）', category: '绿色低碳', func: '为电动汽车充电；可设置"光伏余电优先"，白天用自家光伏发的电充电', data: { 状态: '空闲' } } });
  charger.info.controls = [{ type: 'toggle', label: '充电', get: () => charger.on, set: (v) => charger.set(v) }];

  const filter = new THREE.Group();
  filter.add(cylinder(0.18, 0.18, 0.5, 'darkMetal', 0, 0, 0, 16));
  filter.position.set(EXT.x1 + 0.35, 0, EXT.z1 + 0.95);
  root.add(filter);
  register({ id: 'rain-filter', room: null, floor: 0, type: 'rainFilter', object: filter, info: { name: '雨水初期弃流过滤器', category: '绿色低碳', func: '弃去屋面最初 2mm 较脏的雨水，其余雨水过滤后流入地下蓄水池' } });
  const sprinklers = [];
  const rainSystemRoot = new THREE.Group();
  for (const [x, z] of [[5.5, 8.0], [-10.0, -6.0], [9.8, -7.0]]) {
    const s = cylinder(0.04, 0.05, 0.12, 'darkMetal', x, 0, z, 8);
    rainSystemRoot.add(s);
    sprinklers.push({ x, z });
  }
  root.add(rainSystemRoot);
  register({ id: 'rain-system', room: null, floor: 0, type: 'rain', object: rainSystemRoot, sprinklers });

  return { root, registry, modules, lightPool };
}
