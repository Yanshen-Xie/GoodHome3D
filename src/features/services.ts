// 功能页依赖的窄接口。主程序（main.ts）实现 FeatureServices，每个功能页用 Pick 声明自己实际需要的那几项；
// 功能页之间不再互相引用，也不直接接触房屋门窗、摄像机、室外环境等内部对象。
import type * as THREE from 'three';
import type { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { People } from '../characters/people.js';
import type { OpeningsService } from '../modules/contracts';
import type { DeviceRegistry } from '../scene/deviceRegistry.js';
import type { WEATHER } from '../scene/environment.js';
import type { EnvModel, METRICS } from '../systems/envModel.js';
import type { Heatmap } from '../systems/heatmap.js';
import type { LightPool } from '../systems/lightPool.js';
import type { NavWorld } from '../systems/nav.js';

export type FloorView = 'all' | 0 | 1;
export type Weather = keyof typeof WEATHER;
export type Vec3Tuple = readonly [number, number, number];
export type LogLevel = 'ok' | 'warn' | 'err';
export type HeatmapMetric = 'none' | 'activity' | keyof typeof METRICS;

export interface SunState {
  readonly dir: THREE.Vector3;
  readonly elevation: number;
  readonly azimuth: number;
}

export interface ClockState {
  readonly hour: number;
  readonly day: number;
  readonly weather: Weather;
  readonly playing: boolean;
  /** 播放倍速：模拟秒 / 真实秒 */
  readonly speed: number;
}

export interface DeviceServices {
  readonly registry: DeviceRegistry;
  readonly lightPool: LightPool;
}

export interface SelectionControl {
  select(object: THREE.Object3D | null): void;
  selectDevice(id: string, focus?: boolean): void;
  /** 选中对象的信息或控件变化后，重新绘制信息卡片 */
  refresh(): void;
}

/** 室外环境中功能页会用到的部分：围栏红外对射、地下蓄水池、附加的室外小品 */
export interface OutdoorControl {
  setPerimeterAlert(active: boolean): void;
  getTankLevel(): number;
  setTankLevel(level: number): void;
  isTankSectionVisible(): boolean;
  showTankSection(visible: boolean): void;
  addProp(...objects: THREE.Object3D[]): void;
}

/** 可整体显示 / 隐藏的场景图层 */
export interface SceneLayers {
  readonly house: THREE.Object3D;
  readonly walls: THREE.Object3D;
  readonly openings: THREE.Object3D;
  readonly furniture: THREE.Object3D;
  readonly devices: THREE.Object3D;
  readonly outdoor: THREE.Object3D;
}

/** 房屋外形中功能页需要的尺寸和挂载点 */
export interface HouseShape {
  /** 日照分析中会挡住阳光的建筑构件（墙、楼板、屋顶、楼梯阳台等细部） */
  readonly sunBlockers: readonly THREE.Object3D[];
  readonly gutterY: number;
  readonly roofHalfDepth: number;
  /** 把附加构件（如外遮阳）挂到房屋上，随房屋一起显示 */
  addFixture(object: THREE.Object3D): void;
}

export interface HeatmapControl {
  readonly metric: HeatmapMetric;
  setHeatmap(metric: HeatmapMetric, floor?: number): void;
  onChange(listener: () => void): void;
}

export interface EnergyState {
  readonly pv: number;
  readonly load: number;
  readonly soc: number;
  readonly battery: number;
  readonly grid: number;
}

export interface EnergyReadout {
  readonly state: EnergyState;
  loadBreakdown(): Record<string, number>;
  todayPV(): number;
}

/** 跨功能页共享的只读状态，由各自负责的功能页提供 */
export interface HomeStatus {
  readonly shadingOn: boolean;
  readonly tvOn: boolean;
  readonly fireActive: boolean;
  readonly sosActive: boolean;
  readonly fallActive: boolean;
  readonly energy: EnergyReadout;
}

export interface FeatureServices {
  readonly scene: THREE.Scene;
  makeLabel(html: string, cls: string, x: number, y: number, z: number, parent?: THREE.Object3D): CSS2DObject;

  /** 当前楼层显示：整栋 / 一层 / 二层 */
  readonly view: FloorView;
  viewFloor(view: FloorView): void;
  /** 手动剖切高度；null 表示按楼层显示 */
  readonly manualCut: number | null;
  setCut(height: number | null): void;
  onViewChange(listener: () => void): void;
  flyTo(pos: Vec3Tuple, target: Vec3Tuple, duration?: number): void;

  readonly clock: ClockState;
  readonly sun: SunState;
  /** 太阳直射强度 0~1（考虑高度角和天气） */
  readonly sunFactor: number;
  setTime(hour: number): void;
  setWeather(weather: Weather): void;
  setPlaying(playing: boolean, speed?: number): void;
  onTimeChanged(listener: (hour: number) => void): void;

  log(level: LogLevel, text: string): void;
  /** 延时执行；应用销毁后不会再触发（功能页不直接用 setTimeout） */
  later(fn: () => void, ms: number): void;

  readonly devices: DeviceServices;
  readonly openings: OpeningsService;
  readonly people: People;
  readonly nav: NavWorld;
  readonly envModel: EnvModel;
  readonly heatmaps: readonly Heatmap[];
  readonly heatmap: HeatmapControl;
  readonly selection: SelectionControl;
  readonly outdoor: OutdoorControl;
  readonly sceneLayers: SceneLayers;
  readonly house: HouseShape;
  readonly home: HomeStatus;

  readonly activeTab: string | undefined;
  activateTab(id: string): void;
  toggleDashboard(): void;
  readonly highQuality: boolean;
  setQuality(high: boolean): void;
}

export type OverviewServices = Pick<FeatureServices,
  'makeLabel' | 'viewFloor' | 'flyTo' | 'devices' | 'envModel' | 'people' | 'home'
  | 'activateTab' | 'toggleDashboard' | 'highQuality' | 'setQuality'>;

export type SafetyServices = Pick<FeatureServices,
  'scene' | 'makeLabel' | 'viewFloor' | 'setCut' | 'flyTo' | 'clock' | 'setTime' | 'log' | 'later'
  | 'devices' | 'openings' | 'people' | 'nav' | 'envModel' | 'selection' | 'outdoor'>;

export type ComfortServices = Pick<FeatureServices,
  'scene' | 'makeLabel' | 'viewFloor' | 'flyTo' | 'clock' | 'setTime' | 'setPlaying' | 'onTimeChanged'
  | 'devices' | 'openings' | 'nav' | 'envModel' | 'heatmap' | 'house' | 'activeTab'>;

export type GreenServices = Pick<FeatureServices,
  'scene' | 'makeLabel' | 'viewFloor' | 'flyTo' | 'clock' | 'setTime' | 'setWeather' | 'setPlaying' | 'onTimeChanged'
  | 'devices' | 'people' | 'selection' | 'outdoor' | 'house' | 'home' | 'activeTab'>;

export type SmartServices = Pick<FeatureServices,
  'scene' | 'viewFloor' | 'flyTo' | 'clock' | 'sunFactor' | 'setTime' | 'setWeather' | 'log' | 'later'
  | 'devices' | 'openings' | 'people' | 'envModel' | 'heatmap' | 'selection' | 'sceneLayers'>;

export type LayersServices = Pick<FeatureServices,
  'scene' | 'makeLabel' | 'view' | 'viewFloor' | 'manualCut' | 'setCut' | 'onViewChange' | 'flyTo' | 'clock' | 'sun' | 'sunFactor'
  | 'devices' | 'openings' | 'people' | 'nav' | 'envModel' | 'heatmaps' | 'sceneLayers' | 'outdoor' | 'home'>;
