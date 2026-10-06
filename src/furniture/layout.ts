// 户型装配：为单件家具模块设置位置，并输出导航占地；程序模型几何由家具工厂创建。
import * as THREE from 'three';
import { setInfo } from '../scene/common.js';
import { FLOORS } from '../scene/layout.js';
import { SceneModule } from '../modules/runtime.js';
import { MODULE_CAPABILITY } from '../modules/contracts';
import type { ModuleFactoryContext, ModuleInfo, SceneModuleContract, SceneModuleDefinition } from '../modules/contracts';
import {
  furnitureFactories, models, createFurnitureGeometry,
} from './catalog.js';
import type { FurnitureKind } from './catalog.js';

export interface FurniturePlacement {
  id?: string;
  kind: FurnitureKind;
  args: unknown[];
  position: readonly [number, number, number];
  rotation: readonly [number, number, number];
  floor: number;
  solid: boolean;
  info: ModuleInfo;
}

export interface FurnitureNavFootprint {
  moduleId: string;
  floor: number;
  bounds: { x0: number; x1: number; z0: number; z1: number };
}

export interface FurnitureModuleConfig {
  id: string;
  kind: FurnitureKind;
  args?: unknown[];
  info?: ModuleInfo;
  pose?: { position?: readonly [number, number, number]; rotation?: readonly [number, number, number]; scale?: number };
}

/** Wrap any furniture object, including a hand-built composite, in the reusable module lifecycle. */
export function createFurnitureModuleFromObject(
  id: string,
  object: THREE.Object3D,
  info: ModuleInfo = { name: id, category: '家具' },
  capabilities?: Iterable<readonly [string, unknown]>,
): SceneModule {
  const moduleInfo = { name: id, category: '家具', ...info };
  object.name = id;
  setInfo(object, moduleInfo);
  return new SceneModule({
    id,
    kind: 'furniture',
    root: object,
    info: moduleInfo,
    capabilities: [[MODULE_CAPABILITY.footprint, new THREE.Box3().setFromObject(object)], ...(capabilities ?? [])],
    disposeResources: true,
  });
}

// ---------------- 布置各房间 ----------------

export function buildFurniture() {
  const root = new THREE.Group();
  root.name = 'furniture';
  const modules: SceneModuleContract[] = [];
  const modulesById = new Map<string, SceneModuleContract>();
  const navFootprints: FurnitureNavFootprint[] = [];
  const idCounts = new Map<string, number>();

  /** Layout supplies a factory config and a pose; geometry stays inside the furniture catalog. */
  const putKind = (kind: FurnitureKind, args: unknown[], x: number, z: number, rotDeg = 0, { floor = 0, solid = true, y = 0, info, id, rotation }: { floor?: number; solid?: boolean; y?: number; info?: Record<string, unknown>; id?: string; rotation?: readonly [number, number, number] } = {}) => {
    const label = String(info?.name ?? 'furniture');
    const slug = label.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'furniture';
    const ordinal = (idCounts.get(slug) ?? 0) + 1; idCounts.set(slug, ordinal);
    const moduleId = id ?? `${slug}-${ordinal}`;
    const placement: FurniturePlacement = {
      id: moduleId,
      kind,
      args,
      position: [x, FLOORS[floor].y + y, z],
      rotation: rotation ?? [0, THREE.MathUtils.degToRad(rotDeg), 0],
      floor,
      solid,
      info: { name: label, category: '家具', ...info },
    };
    const module = createFurnitureFromConfig({}, {
      id: placement.id!, kind: placement.kind, args: placement.args, info: placement.info,
      pose: { position: placement.position, rotation: placement.rotation },
    });
    module.mount(root);
    const bounds = new THREE.Box3().setFromObject(module.root);
    module.setCapability(MODULE_CAPABILITY.footprint, bounds);
    if (placement.solid) navFootprints.push({
      moduleId,
      floor,
      bounds: { x0: bounds.min.x, x1: bounds.max.x, z0: bounds.min.z, z1: bounds.max.z },
    });
    modules.push(module); modulesById.set(moduleId, module);
    return module.root;
  };
  const wallArt = (x, y, z, rotDeg, floor, w, h, seed) => putKind('painting', [w, h, seed], x, z, rotDeg, { floor, y, solid: false, info: { name: '装饰画', category: '家具 / 软装', func: '墙面软装，程序生成的抽象画' } });

  // ================= 一层 =================
  // ----- 客厅 -----
  putKind('sofa', [2.6], -7.35, 2.8, 90, { info: { name: '三人布艺沙发', category: '家具', func: '圆角设计、座高 45cm，便于老人起坐', room: 'living' } });
  putKind('armchair', [], -5.7, 1.45, 30, { info: { name: '单人扶手椅', category: '家具', func: '带扶手，方便起身', room: 'living' } });
  putKind('rug', [2.6, 3.2], -5.6, 2.8, 0, { y: 0.02, solid: false });
  // 茶几与沙发之间留 0.9m，人可以走到沙发前
  putKind('coffeeTable', [], -5.45, 2.8, 90, { info: { name: '圆角茶几', category: '家具 / 适老', func: '四角 R25 圆角，防止磕碰', room: 'living' } });
  putKind('tvPartition', [], -3.3, 2.8, 0, { info: { name: '电视背景墙隔断', category: '家具', func: '木饰面隔断，分隔客厅与餐厅', room: 'living' } });
  // TV display and its rendering controls are supplied by an independent device module.
  putKind('plant', [1.0], -7.4, 4.5);
  putKind('plant', [0.9], -1.5, 4.5);
  putKind('bookshelf', [1.2, 1.9], -7.25, 0.9, 0, { info: { name: '书架', category: '家具', room: 'living' } });
  wallArt(-2.97, 1.3, 2.8, 90, 0, 1.4, 0.8, 1);

  // ----- 餐厅 -----
  putKind('table', [1.6, 0.9, 0.75], 1.1, 2.9, 0, { info: { name: '实木餐桌', category: '家具', func: '四人餐桌，桌角圆润处理', room: 'dining' } });
  const chair = models().chair;
  for (const [x, z, r] of [[0.7, 2.25, 0], [1.5, 2.25, 0], [0.7, 3.55, 180], [1.5, 3.55, 180]]) putKind('diningChair', [], x, z, r, { solid: false, info: { name: '餐椅（OBJ 模型）', category: '家具', func: '由自写 OBJ/MTL 解析器加载：dining_chair.obj，含顶点、纹理坐标、法线和材质', room: 'dining', data: { 顶点数: chair.userData.stats.vertices, 三角形数: chair.userData.stats.triangles, 材质数: chair.userData.stats.materials } } });
  putKind('cabinet', [2.0, 0.75, 0.42, 'woodDark', 4], 1.3, 4.65, 180, { info: { name: '餐边柜', category: '家具', room: 'dining' } });
  wallArt(3.08, 1.3, 3.6, -90, 0, 1.0, 0.7, 2);

  // ----- 厨房 -----
  putKind('southKitchenCounter', [], 6.0, 4.6, 180, { info: { name: '橱柜（南侧）+ 水槽', category: '家具', func: '台面高 90cm', room: 'kitchen' } });
  putKind('eastKitchenCounter', [], 7.6, 2.75, 270, { info: { name: '橱柜（东侧）', category: '家具', room: 'kitchen' } });
  putKind('cooktop', [], 7.6, 1.6, 270, { solid: false, y: 0.9, info: { name: '燃气灶', category: '厨房设备 / 安全', func: '带熄火保护装置，意外熄火自动断气', room: 'kitchen', maintain: '熄火保护测试：2026-07 正常' } });
  putKind('rangeHood', [], 7.65, 1.6, 0, { solid: false, y: 1.7, info: { name: '油烟机', category: '厨房设备', room: 'kitchen' } });
  putKind('refrigerator', [], 3.7, 4.5, 180, { info: { name: '一级能效冰箱', category: '家电 / 节能', func: '变频压缩机，日耗电约 0.8 kWh', room: 'kitchen' } });
  putKind('kitchenUpperCabinet', [], 6.3, 0.9, 0, { solid: false, y: 1.6, info: { name: '吊柜', category: '家具', room: 'kitchen' } });
  // 中岛台东西向摆放，南侧与橱柜之间、西侧与墙之间都留出 ≥ 0.8m 的通道（火灾时灶台附近的人能绕开火源逃生）
  putKind('kitchenIsland', [], 5.2, 2.55, 0, { info: { name: '中岛台', category: '家具', func: '备餐与早餐台；四周留有 0.8m 以上通道', room: 'kitchen' } });
  for (const x of [4.8, 5.6]) putKind('stool', [], x, 1.85, 0, { solid: false });

  // ----- 老人房 -----
  putKind('bed', [1.2, 2.0, 'fabricBeige'], -5.5, -3.83, 0, { info: { name: '护理床', category: '家具 / 适老', func: '床高 45cm，一侧带起身扶手，可升降床头', room: 'elder' } });
  putKind('grabBar', [0.9], -6.2, -3.4, 0, { y: 0.75, rotation: [0, Math.PI / 2, Math.PI / 2], info: { name: '床边起身扶手', category: '适老无障碍', room: 'elder' } });
  putKind('cabinet', [0.45, 0.5, 0.4, 'woodLight', 1], -4.45, -4.65, 0, { info: { name: '床头柜', category: '家具', room: 'elder' } });
  putKind('armchair', ['fabricGreen'], -7.3, -1.55, 90, { info: { name: '起身辅助椅', category: '家具 / 适老', func: '高座面 + 扶手，方便老人起坐', room: 'elder' } });
  putKind('cabinet', [1.6, 2.1, 0.55, 'woodWhite', 2], -3.62, -3.6, 270, { info: { name: '衣柜', category: '家具', room: 'elder' } });
  putKind('plant', [0.8], -7.55, -4.5);

  // ----- 无障碍卫生间 -----
  const toilet = models().toilet;
  putKind('toilet', [], -2.7, -3.15, 90, { info: { name: '坐便器（OBJ 模型）', category: '卫浴', func: '由自写 OBJ/MTL 解析器加载：toilet.obj', room: 'bath1', data: { 顶点数: toilet.userData.stats.vertices, 三角形数: toilet.userData.stats.triangles } } });
  putKind('grabBar', [0.7], -3.08, -2.75, 90, { y: 0.75, info: { name: '马桶安全抓杆', category: '适老无障碍', func: '承重 ≥ 100kg，辅助如厕起身', room: 'bath1' } });
  putKind('showerZone', [], -2.45, -4.25, 0, { solid: false, info: { name: '无障碍淋浴区', category: '适老无障碍', func: '无挡水条、折叠淋浴座椅、L 形安全抓杆、防滑地砖', room: 'bath1' } });
  navFootprints.push({ moduleId: 'shower-clearance', floor: 0, bounds: { x0: -3.1, x1: -1.8, z0: -4.9, z1: -3.65 } });
  putKind('bathroomVanity', [], -0.95, -2.1, 270, { info: { name: '洗手台', category: '卫浴', func: '台下可容膝，轮椅可接近', room: 'bath1' } });
  putKind('wallMirror', [], -0.72, -2.1, 0, { y: 1.2, solid: false, info: { name: '一层卫生间镜子', category: '家具 / 卫浴', room: 'bath1' } });

  // ----- 设备间 -----
  putKind('washer', [], 3.95, -4.55, 0, { info: { name: '洗衣机', category: '家电', room: 'utility' } });
  putKind('washer', [], 3.95, -4.55, 0, { solid: false, y: 0.87, info: { name: '干衣机（热泵式）', category: '家电 / 节能', room: 'utility' } });
  putKind('laundrySink', [], 5.0, -4.6, 0, { info: { name: '洗衣池', category: '家具', room: 'utility' } });
  putKind('bookshelf', [1.2, 1.8], 7.62, -1.9, 270, { info: { name: '储物架', category: '家具', room: 'utility' } });

  // ----- 门厅走廊 -----
  putKind('cabinet', [1.2, 1.0, 0.36, 'woodLight', 2], -6.9, -0.72, 0, { info: { name: '鞋柜 + 换鞋凳', category: '家具 / 适老', func: '玄关处可坐下换鞋', room: 'hall1' } });
  putKind('continuousHallwayRail', [], 0, 0, 0, { solid: false, id: 'hall1-continuous-rail', info: { name: '走廊连续扶手', category: '适老无障碍', func: '高 85cm，沿走廊设置，老人行走时可随时扶握', room: 'hall1', maintain: '牢固度检查：2026-08 正常' } });

  // ================= 二层 =================
  // ----- 主卧 -----
  putKind('bed', [1.8, 2.0, 'fabricBlue'], -5.4, -3.85, 0, { floor: 1, info: { name: '双人床', category: '家具', room: 'master' } });
  putKind('rug', [2.4, 1.2], -5.4, -2.3, 0, { y: 0.02, floor: 1, solid: false });
  for (const x of [-6.65, -4.15]) putKind('cabinet', [0.45, 0.5, 0.4, 'woodLight', 1], x, -4.65, 0, { floor: 1, info: { name: '床头柜', category: '家具', room: 'master' } });
  putKind('deskLamp', [], -6.65, -4.65, 0, { floor: 1, y: 0.5, solid: false });
  putKind('deskLamp', [], -4.15, -4.65, 0, { floor: 1, y: 0.5, solid: false });
  putKind('cabinet', [1.8, 2.2, 0.6, 'woodWhite', 3], -3.0, -3.5, 270, { floor: 1, info: { name: '衣柜', category: '家具', func: '整体收纳', room: 'master' } });
  putKind('vanityWithMirror', [], -7.65, -1.6, 90, { floor: 1, info: { name: '梳妆台', category: '家具', room: 'master' } });
  putKind('plant', [0.8], -7.55, -4.5, 0, { floor: 1 });

  // ----- 二层卫生间 -----
  putKind('bathtub', [], -1.6, -4.5, 0, { floor: 1, info: { name: '浴缸', category: '卫浴', func: '防滑底面，侧边设扶手', room: 'bath2' } });
  putKind('toilet', [], -2.14, -3.4, 90, { floor: 1, info: { name: '坐便器（OBJ 模型）', category: '卫浴', room: 'bath2' } });
  putKind('bathroomVanity', [], -2.25, -2.45, 90, { floor: 1, info: { name: '洗手台', category: '卫浴', room: 'bath2' } });
  putKind('wallMirror', [], -2.48, -2.45, 0, { floor: 1, y: 1.2, solid: false, info: { name: '二层卫生间镜子', category: '家具 / 卫浴', room: 'bath2' } });

  // ----- 儿童房 -----
  putKind('bed', [1.0, 2.0, 'fabricPink'], 4.1, -3.83, 0, { floor: 1, info: { name: '儿童床（带护栏）', category: '家具 / 安全', func: '床侧防护栏，防坠落', room: 'kid' } });
  putKind('bedGuard', [], 4.67, -4.03, 0, { floor: 1, solid: false, y: 0.52 });
  putKind('table', [1.2, 0.6, 0.72, 'woodWhite', 'woodWhite'], 6.0, -4.55, 0, { floor: 1, info: { name: '学习桌', category: '家具', func: '靠窗布置，自然采光充足', room: 'kid' } });
  putKind('deskLamp', [], 6.4, -4.6, 0, { floor: 1, y: 0.72, solid: false });
  putKind('officeChair', [], 6.0, -3.95, 180, { floor: 1, solid: false });
  putKind('bookshelf', [1.2, 1.6], 7.65, -1.9, 270, { floor: 1, info: { name: '儿童书架', category: '家具', room: 'kid' } });
  putKind('toyBox', [], 5.9, -1.6, 0, { floor: 1, info: { name: '软包玩具箱', category: '家具 / 安全', func: '软包圆角，防磕碰', room: 'kid' } });
  putKind('rug', [1.8, 1.4], 5.8, -2.7, 0, { y: 0.02, floor: 1, solid: false });

  // ----- 书房 -----
  putKind('table', [1.4, 0.65, 0.75, 'woodDark', 'darkMetal'], -6.0, 4.5, 0, { floor: 1, info: { name: '书桌', category: '家具', func: '朝南靠窗，白天以自然光为主', room: 'study' } });
  putKind('deskLamp', [], -5.5, 4.55, 0, { floor: 1, y: 0.75, solid: false });
  putKind('officeChair', [], -6.0, 3.85, 0, { floor: 1, solid: false });
  putKind('bookshelf', [1.2, 2.0], -3.87, 2.1, 270, { floor: 1, info: { name: '书柜', category: '家具', room: 'study' } });
  putKind('bookshelf', [1.2, 2.0], -3.87, 3.4, 270, { floor: 1, info: { name: '书柜', category: '家具', room: 'study' } });
  putKind('armchair', ['leather'], -7.2, 1.5, 40, { floor: 1, info: { name: '阅读椅', category: '家具', room: 'study' } });
  wallArt(-7.88, 1.4, 1.2, 90, 1, 0.8, 0.6, 3);

  // ----- 家庭起居室 -----
  putKind('sofa', [2.6, 'fabricBeige'], -3.05, 2.8, 90, { floor: 1, info: { name: '起居室沙发', category: '家具', room: 'family' } });
  putKind('rug', [2.4, 3.0], -1.0, 2.8, 0, { y: 0.02, floor: 1, solid: false });
  putKind('coffeeTable', [], -1.4, 2.8, 90, { floor: 1 });
  putKind('familyTvStand', [], 2.9, 2.8, 0, { floor: 1, info: { name: '电视柜', category: '家具', room: 'family' } });
  putKind('plant', [1.0], 2.8, 4.55, 0, { floor: 1 });
  putKind('plant', [0.8], -3.2, 4.55, 0, { floor: 1 });
  wallArt(-3.48, 1.5, 2.8, 90, 1, 1.6, 0.8, 4);

  // ----- 客房 -----
  putKind('bed', [1.5, 2.0, 'fabricGreen'], 4.35, 3.2, 90, { floor: 1, info: { name: '客床', category: '家具', room: 'guest' } });
  putKind('cabinet', [0.45, 0.5, 0.4, 'woodLight', 1], 3.55, 4.5, 90, { floor: 1 });
  putKind('cabinet', [1.6, 2.1, 0.6, 'woodWhite', 2], 7.0, 1.0, 0, { floor: 1, info: { name: '衣柜', category: '家具', room: 'guest' } });
  wallArt(3.32, 1.4, 3.2, 90, 1, 1.0, 0.6, 5);

  // ----- 二层走廊 -----
  putKind('plant', [0.9], -7.5, -0.2, 0, { floor: 1 });
  wallArt(-5.2, 1.4, -0.89, 0, 1, 1.2, 0.7, 6);

  return { root, modules, modulesById, navFootprints };
}

/** Create one independently mountable furniture module without needing a house scene. */
export function createFurnitureModule(
  id: string,
  kind: FurnitureKind | string,
  args: unknown[] = [],
  info: Record<string, unknown> = { name: id, category: '家具' },
) {
  const object = createFurnitureGeometry(kind, { args });
  return createFurnitureModuleFromObject(id, object, { name: id, category: '家具', ...info });
}

/** Create one furniture unit through the same definition contract used for imported models. */
export function createFurnitureFromConfig(_context: ModuleFactoryContext, config: FurnitureModuleConfig): SceneModule {
  const module = createFurnitureModule(config.id, config.kind, config.args, config.info ?? { name: config.id, category: '家具' });
  if (config.pose) module.place(config.pose);
  module.setCapability(MODULE_CAPABILITY.footprint, new THREE.Box3().setFromObject(module.root));
  return module;
}

export function furnitureDefinition(kind?: FurnitureKind): SceneModuleDefinition<FurnitureModuleConfig> {
  return {
    id: kind ? `furniture-${kind}` : 'furniture-item',
    kind: 'furniture',
    create: (context, config) => createFurnitureFromConfig(context, { ...config, kind: kind ?? config.kind }),
  };
}

export function furnitureDefinitions(): SceneModuleDefinition<FurnitureModuleConfig>[] {
  return [furnitureDefinition(), ...Object.keys(furnitureFactories).map((kind) => furnitureDefinition(kind as FurnitureKind))];
}
