import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DEVICE_CAPABILITY, MODULE_CAPABILITY, MODULE_SERVICE } from '../modules/contracts';
import type {
  AnimationCapability,
  BatteryCapability,
  BooleanControlCapability,
  CameraCapability,
  CircuitBreakerCapability,
  ClimateCapability,
  CurtainCapability,
  DeviceStatus,
  DeviceStatusCapability,
  DisplayCapability,
  EnergyOutputCapability,
  EnvironmentSensorCapability,
  ElevatorCapability,
  FilterCapability,
  FireAlarmCapability,
  FireBlanketCapability,
  FireExtinguisherCapability,
  IndicatorCapability,
  IntercomCapability,
  InverterCapability,
  IrrigationCapability,
  LightingCapability,
  LockCapability,
  ModuleFactoryContext,
  NetworkCapability,
  PowerCapability,
  PresenceSensorCapability,
  RotatingCapability,
  ScalarSensorCapability,
  SceneModuleContract,
  SosCapability,
  TankLevelCapability,
  ValveCapability,
  VentilationCapability,
  WaterLeakSensorCapability,
} from '../modules/contracts';
import { SceneModuleCatalog } from '../modules/runtime.js';
import { registerBuiltInSceneModules } from '../modules/registerBuiltins.js';
import { createExternalModelModuleFromFile, type ExternalModelConfig } from '../modules/externalModel.js';
import { furniturePreviewSamples } from '../furniture/catalog.js';
import type { FurnitureKind } from '../furniture/catalog.js';
import { DEVICE_LABELS, type DeviceKind } from '../scene/deviceCatalog.js';
import { LightPool } from '../systems/lightPool.js';

type InfoControl = {
  type: string;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  get?: () => boolean | number;
  set?: (value: boolean | number) => void;
  onClick?: () => void;
};

const $ = <T extends HTMLElement>(selector: string): T => {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing preview element: ${selector}`);
  return element;
};

const viewport = $('#viewport');
const filter = $('#filter') as HTMLSelectElement;
const definitionSelect = $('#definition') as HTMLSelectElement;
const idInput = $('#module-id') as HTMLInputElement;
const nameInput = $('#module-name') as HTMLInputElement;
const errorBox = $('#error');
const details = $('#details');
const controlsElement = $('#controls');
const animationElement = $('#animation');
const labelElement = $('#module-label');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x17212b);
scene.add(new THREE.HemisphereLight(0xdcecff, 0x333943, 2));
const keyLight = new THREE.DirectionalLight(0xffeed8, 2.5);
keyLight.position.set(4, 8, 5);
scene.add(keyLight);

const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 2000);
camera.position.set(4, 3, 5);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
viewport.append(renderer.domElement);

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.target.set(0, 0.7, 0);
orbit.update();
let floorGrid: THREE.GridHelper | undefined;
let floorAxes: THREE.AxesHelper | undefined;
const lightPool = new LightPool(scene, 6);
const services = new Map<string, unknown>([
  [MODULE_SERVICE.lightPool, lightPool],
  [MODULE_SERVICE.floorY, (floor: number) => floor * 3.2],
  [MODULE_SERVICE.ceilingY, (floor: number) => floor * 3.2 + 3.0],
]);
const context: ModuleFactoryContext = { scene, renderer, services };
const catalog = new SceneModuleCatalog();
registerBuiltInSceneModules(catalog);

let activeModule: SceneModuleContract | undefined;
let createRevision = 0;
const displayPreviewTextures = new Map<string, THREE.Texture>();
const clock = new THREE.Clock();
const sampleByKind = new Map(furniturePreviewSamples.map((sample) => [sample.kind, sample]));

function categoryOf(id: string): string {
  if (id.startsWith('furniture-') && id !== 'furniture-item') return 'furniture';
  if (id.startsWith('device-')) return 'sample-device';
  if (id === 'external-gltf-model' || id === 'furniture-item') return 'hidden';
  return 'house-device';
}

function renderDefinitionOptions(): void {
  const current = definitionSelect.value;
  definitionSelect.replaceChildren();
  const groups = [
    { value: 'furniture', label: '家具工厂' },
    { value: 'sample-device', label: '设备示例模型（简化预览）' },
    { value: 'house-device', label: '真实整屋设备工厂' },
  ];
  for (const groupData of groups) {
    if (filter.value !== 'all' && filter.value !== groupData.value) continue;
    const group = document.createElement('optgroup');
    group.label = groupData.label;
    const ids = catalog.ids().filter((id) => categoryOf(id) === groupData.value).sort();
    for (const id of ids) {
      const option = document.createElement('option');
      option.value = id;
      option.textContent = labelForDefinition(id);
      group.append(option);
    }
    definitionSelect.append(group);
  }
  if ([...definitionSelect.options].some((option) => option.value === current)) definitionSelect.value = current;
  if (!definitionSelect.value) {
    const first = definitionSelect.querySelector('option');
    if (first) definitionSelect.value = first.value;
  }
  updateDefaultFields();
}

const DEVICE_LABEL: Partial<Record<DeviceKind, string>> = {
  ...DEVICE_LABELS,
  solarPanel: '光伏阵列', inverter: '光伏逆变器', battery: '储能电池', heatPump: '空气源热泵',
  waterTank: '热水箱', charger: '汽车充电桩', rainFilter: '雨水过滤器', rainSystem: '喷灌系统',
};

const HOUSE_LABELS: Record<string, string> = {
  'house-light': '吸顶 / 吊灯 / 灯槽灯',
  'house-air-conditioner': '变频空调', 'house-curtain': '电动窗帘', 'house-fresh-air': '全热交换新风',
  'house-floor-lamp': '落地灯', 'house-night-light': '夜间地脚灯', 'house-television': '电视',
  'house-elevator': '家用电梯', 'house-solar-array': '光伏阵列', 'house-inverter': '光伏逆变器',
  'house-battery': '储能电池', 'house-heat-pump': '空气源热泵', 'house-water-tank': '热水箱',
  'house-charger': '汽车充电桩', 'house-rain-filter': '雨水过滤器', 'house-rain-system': '雨水喷灌系统',
  'house-environment-sensor': '温湿度传感器', 'house-presence-sensor': '人体存在传感器',
  'house-smoke-sensor': '感烟探测器', 'house-gas-detector': '燃气探测器', 'house-water-leak-sensor': '水浸传感器',
  'house-gas-valve': '燃气阀门', 'house-water-valve': '进水阀门', 'house-extinguisher': '灭火器',
  'house-fire-blanket': '灭火毯', 'house-strobe': '声光报警器', 'house-exit-sign': '安全出口标志',
  'house-emergency-light': '应急照明灯', 'house-sos-button': '紧急呼叫按钮',
  'house-distribution-panel': '智能配电箱', 'house-gateway': '家庭智能网关',
  'house-intercom': '可视对讲机', 'house-smart-lock': '智能门锁', 'house-camera': '安防摄像头',
  'house-floodlight': '庭院投光灯',
};

function labelForDefinition(id: string): string {
  if (id.startsWith('furniture-')) {
    const sample = sampleByKind.get(id.slice('furniture-'.length) as FurnitureKind);
    return sample ? `${sample.label} · ${id}` : id;
  }
  if (id.startsWith('device-')) {
    const kind = id.slice('device-'.length) as DeviceKind;
    return `${DEVICE_LABEL[kind] ?? kind} · ${id}`;
  }
  return `${HOUSE_LABELS[id] ?? id} · ${id}`;
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'module';
}

function updateDefaultFields(): void {
  const definitionId = definitionSelect.value;
  const label = labelForDefinition(definitionId).split(' · ')[0] || '预览模块';
  idInput.value = `preview-${slug(definitionId.replace(/^(furniture|device|house)-/, ''))}`;
  nameInput.value = label;
}

function sampleConfig(definitionId: string): unknown {
  const id = idInput.value.trim() || `preview-${slug(definitionId)}`;
  const name = nameInput.value.trim() || labelForDefinition(definitionId);
  if (definitionId.startsWith('furniture-')) {
    const kind = definitionId.slice('furniture-'.length) as FurnitureKind;
    const sample = sampleByKind.get(kind);
    if (!sample) throw new Error(`缺少家具预览参数：${kind}`);
    return { id, kind, args: sample.args, info: { name, category: '家具预览' } };
  }
  if (definitionId.startsWith('device-')) {
    return { id, info: { name, category: '设备示例' }, pose: { position: [0, 0, 0] } };
  }
  if (definitionId.startsWith('house-environment-sensor')) return safetyConfig('environmentSensor', id, name);
  if (definitionId.startsWith('house-presence-sensor')) return safetyConfig('presenceSensor', id, name);
  if (definitionId.startsWith('house-smoke-sensor')) return safetyConfig('smokeSensor', id, name);
  if (definitionId.startsWith('house-gas-detector')) return safetyConfig('gasDetector', id, name);
  if (definitionId.startsWith('house-water-leak-sensor')) return safetyConfig('waterLeakSensor', id, name);
  if (definitionId === 'house-gas-valve') return { ...safetyConfig('gasValve', id, name), initialOpen: true };
  if (definitionId === 'house-water-valve') return { ...safetyConfig('waterValve', id, name), initialOpen: true };
  if (definitionId === 'house-extinguisher') return safetyConfig('extinguisher', id, name);
  if (definitionId === 'house-fire-blanket') return safetyConfig('blanket', id, name);
  if (definitionId === 'house-strobe') return { ...safetyConfig('alarm', id, name), lightPosition: [0, 0.2, 0.05] };
  if (definitionId === 'house-exit-sign') return { ...safetyConfig('exitSign', id, name), textLines: ['安全出口', 'EXIT'] };
  if (definitionId === 'house-emergency-light') return safetyConfig('emergencyLight', id, name);
  if (definitionId === 'house-sos-button') return { ...safetyConfig('sosButton', id, name), initiallyActive: false };
  if (definitionId === 'house-distribution-panel') return safetyConfig('distributionPanel', id, name);
  if (definitionId === 'house-gateway') return safetyConfig('gateway', id, name);
  if (definitionId === 'house-intercom') return safetyConfig('intercom', id, name);
  if (definitionId === 'house-smart-lock') return { ...safetyConfig('smartLock', id, name), initiallyLocked: true };
  if (definitionId === 'house-camera') return { ...safetyConfig('camera', id, name), yawOffset: 0 };
  if (definitionId === 'house-floodlight') return {
    ...safetyConfig('floodlight', id, name), fixtures: [[-0.25, 0.3, 0], [0.25, 0.3, 0]], lightPosition: [0, 0.35, 0],
  };
  if (definitionId === 'house-light') return {
    kind: 'light', id, name, room: 'preview', floor: 0, position: [0, 0], fixture: 'pendant', initialOn: true,
  };
  if (definitionId === 'house-air-conditioner') return {
    kind: 'airConditioner', id, name, room: 'preview', floor: 0, position: [0, 0], facing: '+z', initialOn: true,
  };
  if (definitionId === 'house-curtain') return {
    kind: 'curtain', id, name, room: 'preview', floor: 0, wallZ: 0, span: [-1.4, 1.4], initialOpenRatio: 0.6,
  };
  if (definitionId === 'house-fresh-air') return {
    kind: 'freshAir', id, name, room: 'preview', floor: 0, hostPosition: [0, 0, 0],
    outlets: [{ x: -0.5, z: 0, room: 'preview', floor: 0 }, { x: 0.5, z: 0, room: 'preview', floor: 0 }], initialOn: true,
  };
  if (definitionId === 'house-floor-lamp') return { kind: 'light', id, name, room: 'preview', floor: 0, position: [0, 0, 0], initialOn: true };
  if (definitionId === 'house-night-light') return {
    kind: 'nightLight', id, name, room: 'preview', floor: 0, segments: [[-1, 1, 0]], initialOn: true,
  };
  if (definitionId === 'house-television') return {
    kind: 'television', id, name, room: 'preview', floor: 0, position: [0, 0, 0], initialOn: true,
  };
  if (definitionId === 'house-elevator') return {
    kind: 'elevator', id, name, room: 'preview', position: [0, 0], carWidth: 1.5, carDepth: 1.6,
    floors: [{ index: 0, y: 0, label: '一层' }, { index: 1, y: 3.2, label: '二层' }],
  };
  if (definitionId === 'house-solar-array') return {
    kind: 'solarPanel', id, name, pose: { position: [0, 0, 0] }, panelOffsets: [[0, 0, 0]],
    panelWidth: 1.5, panelThickness: 0.06, panelDepth: 0.9, tiltRadians: Math.PI / 6,
  };
  if (definitionId === 'house-inverter') return { kind: 'inverter', id, name, pose: { position: [0, 0, 0] } };
  if (definitionId === 'house-battery') return { kind: 'battery', id, name, pose: { position: [0, 0, 0] }, initialChargePercent: 65 };
  if (definitionId === 'house-heat-pump') return { kind: 'heatPump', id, name, pose: { position: [0, 0, 0] }, initialRunning: true };
  if (definitionId === 'house-water-tank') return { kind: 'waterTank', id, name, pose: { position: [0, 0, 0] } };
  if (definitionId === 'house-charger') return { kind: 'charger', id, name, pose: { position: [0, 0, 0] }, initialOn: true };
  if (definitionId === 'house-rain-filter') return { kind: 'rainFilter', id, name, pose: { position: [0, 0, 0] } };
  if (definitionId === 'house-rain-system') return {
    kind: 'rainSystem', id, name, pose: { position: [0, 0, 0] }, sprinklers: [{ x: -0.5, z: 0 }, { x: 0.5, z: 0 }],
  };
  throw new Error(`没有为工厂配置预览样例：${definitionId}`);
}

function safetyConfig(kind: string, id: string, name: string) {
  return { kind, id, name, room: 'preview', floor: 0, pose: { position: [0, 0, 0] }, info: { category: '独立预览' } };
}

function clearActiveModule(): void {
  createRevision++;
  if (activeModule) {
    activeModule.dispose();
    activeModule = undefined;
  }
  displayPreviewTextures.forEach((texture) => texture.dispose());
  displayPreviewTextures.clear();
  controlsElement.replaceChildren();
  animationElement.replaceChildren();
  details.textContent = '尚未加载模块';
  labelElement.textContent = '等待创建模块';
}

function setError(error?: unknown): void {
  errorBox.textContent = error ? (error instanceof Error ? error.message : String(error)) : '';
}

function syncTransformFields(): void {
  if (!activeModule) return;
  $<HTMLInputElement>('#x').value = String(Number(activeModule.root.position.x.toFixed(3)));
  $<HTMLInputElement>('#y').value = String(Number(activeModule.root.position.y.toFixed(3)));
  $<HTMLInputElement>('#z').value = String(Number(activeModule.root.position.z.toFixed(3)));
  $<HTMLInputElement>('#yaw').value = String(Number(THREE.MathUtils.radToDeg(activeModule.root.rotation.y).toFixed(1)));
  $<HTMLInputElement>('#scale').value = String(Number(activeModule.root.scale.x.toFixed(3)));
}

function applyTransform(): void {
  if (!activeModule) return;
  const x = Number(($('#x') as HTMLInputElement).value);
  const y = Number(($('#y') as HTMLInputElement).value);
  const z = Number(($('#z') as HTMLInputElement).value);
  const yaw = THREE.MathUtils.degToRad(Number(($('#yaw') as HTMLInputElement).value));
  const scale = Number(($('#scale') as HTMLInputElement).value);
  if (![x, y, z, yaw, scale].every(Number.isFinite) || scale <= 0) {
    setError('位置、旋转和缩放必须是有效数字，缩放必须大于 0。');
    return;
  }
  activeModule.place({
    position: [x, y, z],
    rotation: [activeModule.root.rotation.x, yaw, activeModule.root.rotation.z],
    scale,
  });
  setError();
  refreshDetails();
}

function addControl(label: string, content: HTMLElement): void {
  const row = document.createElement('div');
  row.className = 'control';
  const caption = document.createElement('label');
  caption.textContent = label;
  row.append(caption, content);
  controlsElement.append(row);
}

function createAction(label: string, actionLabel: string, action: () => void): void {
  const button = document.createElement('button');
  button.textContent = actionLabel;
  button.addEventListener('click', () => { action(); refreshDetails(); });
  addControl(label, button);
}

function createCheckbox(label: string, get: () => boolean, set: (value: boolean) => void): void {
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = get();
  input.addEventListener('change', () => { set(input.checked); refreshDetails(); });
  addControl(label, input);
}

function createRange(label: string, min: number, max: number, step: number, get: () => number, set: (value: number) => void): void {
  const wrapper = document.createElement('div');
  wrapper.style.display = 'contents';
  const output = document.createElement('output');
  const input = document.createElement('input');
  input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step);
  const write = (value: number) => { input.value = String(value); output.value = String(Number(value.toFixed(2))); };
  write(get());
  input.addEventListener('input', () => { const value = Number(input.value); set(value); output.value = String(Number(value.toFixed(2))); refreshDetails(); });
  wrapper.append(input);
  addControl(label, output);
  controlsElement.lastElementChild?.append(wrapper);
}

function createStatusControl(module: SceneModuleContract): void {
  const status = module.getCapability<DeviceStatusCapability>(MODULE_CAPABILITY.deviceStatus);
  if (!status) return;
  const select = document.createElement('select');
  const options: Array<[DeviceStatus, string]> = [
    ['normal', '正常'], ['warning', '警告'], ['fault', '故障'], ['off', '关闭'],
  ];
  for (const [value, label] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  select.value = status.getStatus();
  select.addEventListener('change', () => {
    status.setStatus(select.value as DeviceStatus);
    refreshDetails();
  });
  addControl('设备状态', select);
}

function canvasPreviewTexture(mode: string): THREE.CanvasTexture {
  const existing = displayPreviewTextures.get(mode);
  if (existing) return existing as THREE.CanvasTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 288;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建电视预览画面');
  if (mode === 'color-bars') {
    const colors = ['#f5f5f5', '#f5dc20', '#22c55e', '#22d3ee', '#2563eb', '#d946ef', '#ef4444', '#15191e'];
    colors.forEach((color, index) => {
      context.fillStyle = color;
      context.fillRect(index * canvas.width / colors.length, 0, canvas.width / colors.length + 1, canvas.height);
    });
    context.fillStyle = '#101820';
    context.fillRect(0, 228, canvas.width, 60);
    context.fillStyle = '#ffffff';
    context.font = 'bold 24px system-ui, sans-serif';
    context.fillText('DISPLAY TEST  ·  1920 × 1080', 20, 265);
  } else if (mode === 'landscape') {
    const sky = context.createLinearGradient(0, 0, 0, canvas.height);
    sky.addColorStop(0, '#4a9bd8');
    sky.addColorStop(0.62, '#d1efff');
    sky.addColorStop(0.63, '#557d51');
    sky.addColorStop(1, '#173d35');
    context.fillStyle = sky;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#f7d47b';
    context.beginPath(); context.arc(390, 75, 34, 0, Math.PI * 2); context.fill();
    context.fillStyle = '#335d49';
    context.beginPath(); context.moveTo(0, 235); context.lineTo(130, 90); context.lineTo(255, 235); context.fill();
    context.fillStyle = '#254b3b';
    context.beginPath(); context.moveTo(160, 245); context.lineTo(340, 70); context.lineTo(512, 245); context.fill();
    context.fillStyle = '#ffffff';
    context.font = 'bold 27px system-ui, sans-serif';
    context.fillText('风景画面预览', 22, 42);
  } else {
    context.fillStyle = '#101b27';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#31c7aa';
    context.fillRect(24, 24, 10, 240);
    context.fillStyle = '#eaf3f8';
    context.font = 'bold 30px system-ui, sans-serif';
    context.fillText('GOOD HOME', 56, 76);
    context.font = '20px system-ui, sans-serif';
    context.fillStyle = '#9eb3c4';
    context.fillText('智慧家庭 · 设备画面预览', 56, 116);
    context.fillStyle = '#183c3d';
    context.fillRect(56, 153, 195, 76);
    context.fillStyle = '#68e1c3';
    context.font = 'bold 23px system-ui, sans-serif';
    context.fillText('室内  24°', 75, 202);
    context.fillStyle = '#263847';
    context.fillRect(269, 153, 215, 76);
    context.fillStyle = '#b7d4e0';
    context.font = '18px system-ui, sans-serif';
    context.fillText('空气质量  优', 291, 199);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  displayPreviewTextures.set(mode, texture);
  return texture;
}

function renderDisplayControl(display: DisplayCapability): void {
  const select = document.createElement('select');
  const patterns = [
    ['color-bars', '彩条测试图'], ['landscape', '风景画面'], ['dashboard', '智慧家庭画面'],
  ];
  for (const [value, label] of patterns) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
  const apply = () => {
    display.setTexture(canvasPreviewTexture(select.value));
    refreshDetails();
  };
  select.addEventListener('change', apply);
  addControl('屏幕内容', select);
  apply();
}

function renderModuleControls(module: SceneModuleContract): void {
  controlsElement.replaceChildren();
  const hasTypedDeviceFeature = Object.values(DEVICE_CAPABILITY).some((name) => module.capabilities.has(name));
  const infoControls = (module.info.controls as InfoControl[] | undefined) ?? [];
  if (!hasTypedDeviceFeature) {
    for (const control of infoControls) {
      if (control.type === 'toggle' && control.get && control.set) {
        createCheckbox(control.label ?? '开关', () => Boolean(control.get?.()), (value) => control.set?.(value));
      } else if (control.type === 'range' && control.get && control.set) {
        createRange(control.label ?? '数值', control.min ?? 0, control.max ?? 1, control.step ?? 0.01,
          () => Number(control.get?.() ?? 0), (value) => control.set?.(value));
      } else if (control.type === 'button' && (control.onClick || control.set)) {
        const button = document.createElement('button');
        button.textContent = control.label ?? '执行';
        button.addEventListener('click', () => { control.onClick?.(); control.set?.(true); refreshDetails(); });
        addControl(control.label ?? '操作', button);
      }
    }
  }

  const power = module.getCapability<PowerCapability>(DEVICE_CAPABILITY.power);
  if (power) {
    const rotor = module.getCapability<RotatingCapability>(DEVICE_CAPABILITY.rotor);
    createCheckbox(rotor ? '设备运转' : '电源', power.isOn, power.setOn);
  }
  const lighting = module.getCapability<LightingCapability>(DEVICE_CAPABILITY.lighting);
  if (lighting) {
    createRange('亮度', 0, 1, 0.01, lighting.getBrightness, lighting.setBrightness);
    createRange('色温 (K)', 2700, 6500, 100, lighting.getColorTemperature, lighting.setColorTemperature);
  }
  const curtain = module.getCapability<CurtainCapability>(DEVICE_CAPABILITY.curtain);
  if (curtain) createRange('窗帘开合度', 0, 1, 0.01, curtain.getOpenRatio, curtain.setOpenRatio);

  const climate = module.getCapability<ClimateCapability>(DEVICE_CAPABILITY.climate);
  if (climate) createRange('设定温度 (℃)', 16, 30, 1, climate.getSetpoint, climate.setSetpoint);
  const ventilation = module.getCapability<VentilationCapability>(DEVICE_CAPABILITY.ventilation);
  if (ventilation) createRange('新风档位', 1, 3, 1, ventilation.getLevel, ventilation.setLevel);
  const display = module.getCapability<DisplayCapability>(DEVICE_CAPABILITY.display);
  if (display) renderDisplayControl(display);

  const sos = module.getCapability<SosCapability>(DEVICE_CAPABILITY.sos);
  if (sos) {
    createCheckbox('求助呼叫', sos.isActive, (active) => active ? sos.activate() : sos.deactivate());
    let intensity = 1;
    createRange('呼叫指示灯亮度', 0, 3, 0.1, () => intensity, (value) => { intensity = value; sos.setIndicator(value); });
  }
  const camera = module.getCapability<CameraCapability>(DEVICE_CAPABILITY.camera);
  if (camera) {
    createCheckbox('摄像头布防', camera.isArmed, camera.setArmed);
    let alertActive = false;
    const button = document.createElement('button');
    const updateLabel = () => { button.textContent = alertActive ? '解除告警预览' : '触发告警预览'; };
    updateLabel();
    button.addEventListener('click', () => { alertActive = !alertActive; camera.setAlert(alertActive); updateLabel(); refreshDetails(); });
    addControl('摄像头告警', button);
  }
  const lock = module.getCapability<LockCapability>(DEVICE_CAPABILITY.lock);
  if (lock) createCheckbox('门锁已锁', lock.isLocked, lock.setLocked);
  const valve = module.getCapability<ValveCapability>(DEVICE_CAPABILITY.valve);
  if (valve) createCheckbox('阀门开启', valve.isOpen, valve.setOpen);

  const indicator = module.getCapability<IndicatorCapability>(DEVICE_CAPABILITY.indicator);
  if (indicator) createRange('指示灯亮度', 0, 5, 0.1, indicator.getIntensity, indicator.setIntensity);
  const battery = module.getCapability<BatteryCapability>(DEVICE_CAPABILITY.battery);
  if (battery) createRange('电池电量 (%)', 0, 100, 1, battery.getChargePercent, battery.setChargePercent);
  const rotor = module.getCapability<RotatingCapability>(DEVICE_CAPABILITY.rotor);
  if (rotor && !power) createCheckbox('转子运转', rotor.isRunning, rotor.setRunning);

  const elevator = module.getCapability<ElevatorCapability>(DEVICE_CAPABILITY.elevator);
  if (elevator) {
    const floors = elevator.getFloors?.() ?? [
      { index: 0, label: '一层' }, { index: 1, label: '二层' },
    ];
    const calls = document.createElement('div');
    calls.className = 'actions';
    for (const floor of floors) {
      const button = document.createElement('button');
      button.textContent = `呼叫 ${floor.label}`;
      button.addEventListener('click', () => { elevator.call(floor.index); refreshDetails(); });
      calls.append(button);
    }
    const row = document.createElement('div'); row.className = 'control'; row.style.gridTemplateColumns = '1fr'; row.append(calls); controlsElement.append(row);
  }

  const irrigation = module.getCapability<IrrigationCapability>(DEVICE_CAPABILITY.irrigation);
  if (irrigation) {
    if (irrigation.isRunning && irrigation.setRunning) {
      createCheckbox('喷灌运行', irrigation.isRunning, irrigation.setRunning);
    }
    const outlets = irrigation.getSprinklers();
    const readout = document.createElement('output');
    readout.textContent = `喷头 ${outlets.length} 个 · ${outlets.map(({ x, z }) => `(${x.toFixed(2)}, ${z.toFixed(2)})`).join(' ')}`;
    addControl('喷灌点位', readout);
  }

  const environment = module.getCapability<EnvironmentSensorCapability>(DEVICE_CAPABILITY.environmentSensor);
  if (environment) {
    createRange('温度 (℃)', -10, 45, 0.5, () => environment.getReadings().temperatureC,
      (value) => environment.setReadings({ temperatureC: value }));
    createRange('湿度 (%)', 0, 100, 1, () => environment.getReadings().humidityPercent,
      (value) => environment.setReadings({ humidityPercent: value }));
    createRange('PM2.5 (μg/m³)', 0, 200, 1, () => environment.getReadings().pm25MicrogramsM3,
      (value) => environment.setReadings({ pm25MicrogramsM3: value }));
    createRange('CO₂ (ppm)', 300, 2500, 25, () => environment.getReadings().co2Ppm,
      (value) => environment.setReadings({ co2Ppm: value }));
  }
  const presence = module.getCapability<PresenceSensorCapability>(DEVICE_CAPABILITY.presenceSensor);
  if (presence) createCheckbox('检测到有人', presence.isOccupied, presence.setOccupied);
  const smoke = module.getCapability<ScalarSensorCapability>(DEVICE_CAPABILITY.smokeSensor);
  if (smoke) createRange(`烟雾浓度 (${smoke.getUnit()})`, 0, Math.max(smoke.getAlarmThreshold() * 2, 0.7), 0.01, smoke.getValue, smoke.setValue);
  const gas = module.getCapability<ScalarSensorCapability>(DEVICE_CAPABILITY.gasSensor);
  if (gas) createRange(`燃气浓度 (${gas.getUnit()})`, 0, Math.max(gas.getAlarmThreshold() * 2, 20), 0.5, gas.getValue, gas.setValue);
  const waterLeak = module.getCapability<WaterLeakSensorCapability>(DEVICE_CAPABILITY.waterLeakSensor);
  if (waterLeak) createCheckbox('模拟检测到漏水', waterLeak.isLeaking, waterLeak.setLeaking);

  const alarm = module.getCapability<FireAlarmCapability>(DEVICE_CAPABILITY.fireAlarm);
  if (alarm) createCheckbox('声光报警', alarm.isActive, (active) => active ? alarm.activate() : alarm.deactivate());
  const extinguisher = module.getCapability<FireExtinguisherCapability>(DEVICE_CAPABILITY.fireExtinguisher);
  if (extinguisher) {
    createRange('灭火剂余量 (%)', 0, 100, 1, extinguisher.getRemainingPercent, extinguisher.setRemainingPercent);
    createAction('灭火器', '按住喷射（点击开始）', () => { extinguisher.discharge(); });
    createAction('灭火器', '停止喷射', extinguisher.stopDischarge);
    createAction('灭火器', '复位灭火器', extinguisher.reset);
    const readout = document.createElement('output');
    readout.id = 'extinguisher-readout';
    addControl('灭火剂余量', readout);
  }
  const blanket = module.getCapability<FireBlanketCapability>(DEVICE_CAPABILITY.fireBlanket);
  if (blanket) createCheckbox('灭火毯已展开', blanket.isDeployed, (deployed) => deployed ? blanket.deploy() : blanket.reset());

  const circuits = module.getCapability<CircuitBreakerCapability>(DEVICE_CAPABILITY.circuits);
  if (circuits) {
    for (const circuit of circuits.getCircuits()) {
      createCheckbox(circuit.label, () => circuits.getCircuits().find(({ id }) => id === circuit.id)?.isOn ?? false,
        (isOn) => circuits.setCircuit(circuit.id, isOn));
    }
  }
  const network = module.getCapability<NetworkCapability>(DEVICE_CAPABILITY.network);
  if (network) {
    createCheckbox('网关在线', network.isOnline, network.setOnline);
    createRange('无线信号 (%)', 0, 100, 1, network.getSignalStrength, network.setSignalStrength);
  }
  const intercom = module.getCapability<IntercomCapability>(DEVICE_CAPABILITY.intercom);
  if (intercom) {
    createCheckbox('访客通话', intercom.isCalling, (calling) => calling ? intercom.startCall() : intercom.hangUp());
    createAction('门口机', '发出开门请求', intercom.requestDoorUnlock);
  }
  const generation = module.getCapability<EnergyOutputCapability>(DEVICE_CAPABILITY.generation);
  if (generation) createRange('发电功率 (kW)', 0, generation.getRatedPowerKW(), 0.05, generation.getPowerKW, generation.setPowerKW);
  const inverter = module.getCapability<InverterCapability>(DEVICE_CAPABILITY.inverter);
  if (inverter) createRange(`逆变器输入 (kW，效率 ${inverter.getEfficiencyPercent()}%)`, 0, 20, 0.1,
    inverter.getInputPowerKW, inverter.setInputPowerKW);
  const tank = module.getCapability<TankLevelCapability>(DEVICE_CAPABILITY.tank);
  if (tank) createRange(`水箱液位 (%) · ${tank.getCapacityLiters()} L`, 0, 100, 1, tank.getLevelPercent, tank.setLevelPercent);
  const filter = module.getCapability<FilterCapability>(DEVICE_CAPABILITY.filter);
  if (filter) {
    createRange('滤芯寿命 (%)', 0, 100, 1, filter.getHealthPercent, filter.setHealthPercent);
    createAction('滤芯维护', '更换滤芯', filter.replaceFilter);
  }

  if (!hasTypedDeviceFeature && !infoControls.length) {
    const toggle = module.getCapability<BooleanControlCapability>(MODULE_CAPABILITY.control);
    if (toggle) createCheckbox('模块控制', toggle.getState, toggle.setState);
  }
  createStatusControl(module);
  if (!controlsElement.childElementCount) {
    const hint = document.createElement('p'); hint.className = 'hint'; hint.textContent = '此模块没有可交互功能能力。'; controlsElement.append(hint);
  }
}

function renderAnimation(module: SceneModuleContract): void {
  animationElement.replaceChildren();
  const animation = module.getCapability<AnimationCapability>(MODULE_CAPABILITY.animation);
  if (!animation?.clips.length) return;
  const row = document.createElement('div'); row.className = 'field';
  const label = document.createElement('label'); label.textContent = `动画片段（${animation.clips.length}）`;
  const select = document.createElement('select');
  for (const clip of animation.clips) {
    const option = document.createElement('option'); option.value = clip.name; option.textContent = clip.name || '(未命名)'; select.append(option);
  }
  const buttons = document.createElement('div'); buttons.className = 'actions';
  const play = document.createElement('button'); play.textContent = '播放'; play.className = 'primary';
  play.addEventListener('click', () => { animation.play(select.value); });
  const stop = document.createElement('button'); stop.textContent = '停止'; stop.addEventListener('click', () => animation.stop());
  buttons.append(play, stop); row.append(label, select, buttons); animationElement.append(row);
}

function refreshDetails(): void {
  if (!activeModule) return;
  const extinguisher = activeModule.getCapability<FireExtinguisherCapability>(DEVICE_CAPABILITY.fireExtinguisher);
  const extinguisherReadout = document.getElementById('extinguisher-readout');
  if (extinguisher && extinguisherReadout) extinguisherReadout.textContent = `${extinguisher.getRemainingPercent().toFixed(0)}%${extinguisher.isDischarging() ? ' · 喷射中' : ''}`;
  const capabilities = [...activeModule.capabilities.keys()];
  details.textContent = JSON.stringify({
    id: activeModule.id,
    kind: activeModule.kind,
    info: activeModule.info,
    capabilities,
    transform: {
      position: activeModule.root.position.toArray(),
      rotation: activeModule.root.rotation.toArray(),
      scale: activeModule.root.scale.toArray(),
    },
  }, null, 2);
}

function focusModule(module: SceneModuleContract): void {
  module.mount(scene);
  module.root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(module.root);
  if (bounds.isEmpty()) bounds.setFromCenterAndSize(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 0.5);
  if (floorGrid) scene.remove(floorGrid);
  if (floorAxes) scene.remove(floorAxes);
  floorGrid = new THREE.GridHelper(Math.max(8, radius * 5), Math.max(8, Math.ceil(radius * 10)), 0x617687, 0x3d4b56);
  floorGrid.position.y = bounds.min.y;
  scene.add(floorGrid);
  floorAxes = new THREE.AxesHelper(Math.max(0.5, radius * 0.6));
  floorAxes.position.copy(center);
  scene.add(floorAxes);
  orbit.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(radius * 1.8, radius * 1.2, radius * 2.2));
  camera.near = Math.max(0.01, radius / 100);
  camera.far = Math.max(100, radius * 100);
  camera.updateProjectionMatrix();
  orbit.update();
  syncTransformFields();
}

async function replaceModule(factory: () => Promise<SceneModuleContract>): Promise<void> {
  clearActiveModule();
  const requestRevision = createRevision;
  setError();
  try {
    const module = await factory();
    if (requestRevision !== createRevision) { module.dispose(); return; }
    activeModule = module;
    focusModule(module);
    renderModuleControls(module);
    renderAnimation(module);
    labelElement.textContent = `${module.info.name} · ${module.kind} · ${module.id}`;
    refreshDetails();
  } catch (error) {
    setError(error);
  }
}

function createSelectedModule(): void {
  const id = definitionSelect.value;
  if (!id) return;
  void replaceModule(async () => await catalog.create(id, context, sampleConfig(id)));
}

function loadUrlModel(): void {
  const asset = ($('#model-url') as HTMLInputElement).value.trim();
  if (!asset) { setError('请先填写 GLB / GLTF 的 URL。'); return; }
  const modelConfig: ExternalModelConfig = {
    id: `url-${Date.now()}`,
    asset,
    info: { name: asset.split('/').at(-1) || 'URL 模型', category: 'Blender URL 导入' },
  };
  void replaceModule(async () => await catalog.create('external-gltf-model', context, modelConfig));
}

$('#create').addEventListener('click', createSelectedModule);
$('#remove').addEventListener('click', () => { clearActiveModule(); setError(); });
$('#apply-transform').addEventListener('click', applyTransform);
filter.addEventListener('change', renderDefinitionOptions);
definitionSelect.addEventListener('change', updateDefaultFields);
$('#load-url').addEventListener('click', loadUrlModel);
$('#choose-file').addEventListener('click', () => ($('#file') as HTMLInputElement).click());
($('#file') as HTMLInputElement).addEventListener('change', (event) => {
  const file = (event.currentTarget as HTMLInputElement).files?.[0];
  if (!file) return;
  void replaceModule(async () => await createExternalModelModuleFromFile(file));
});

function resize(): void {
  const width = viewport.clientWidth;
  const height = viewport.clientHeight;
  if (!width || !height) return;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
}
new ResizeObserver(resize).observe(viewport);
window.addEventListener('resize', resize);
resize();
renderDefinitionOptions();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  activeModule?.update(dt);
  orbit.update();
  lightPool.update(camera);
  renderer.render(scene, camera);
  if (activeModule) refreshDetails();
});

window.addEventListener('beforeunload', () => {
  clearActiveModule();
  orbit.dispose();
  renderer.setAnimationLoop(null);
  renderer.dispose();
});
