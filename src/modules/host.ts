// 场景模块宿主：统一负责模块的挂载、逐帧更新、导航占地和卸载。
// 占地规则：
//  - 放置（add）：footprint 为 true 时按模块包围盒在地面的投影登记占地；也可以直接给出占地矩形。
//  - 移动（move）：先 place 新位姿；按包围盒登记的重新计算投影，给定矩形的按根节点的平移量整体平移，
//    也可以显式传入新矩形；同时刷新模块的 footprint 能力。
//  - 移除（remove）：撤销占地、停止更新，再卸载或释放模块。
import * as THREE from 'three';
import { MODULE_CAPABILITY } from './contracts';
import type { ModulePose, SceneModuleContract } from './contracts';
import type { FootprintRect, FootprintService } from '../systems/nav.js';

export interface HostedModuleOptions {
  /** 所在楼层，登记导航占地时使用 */
  floor?: number;
  /** true：按包围盒投影登记占地；矩形：按给定范围登记；省略或 false：不挡路 */
  footprint?: boolean | FootprintRect;
  /** 是否由宿主挂到父节点上；装配层已经挂好时设为 false */
  mount?: boolean;
}

interface HostedModule {
  readonly module: SceneModuleContract;
  readonly floor: number;
  readonly autoFootprint: boolean;
  rect: FootprintRect | null;
}

function projectedBounds(root: THREE.Object3D): { box: THREE.Box3; rect: FootprintRect } {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  return { box, rect: { x0: box.min.x, x1: box.max.x, z0: box.min.z, z1: box.max.z } };
}

export class SceneModuleHost {
  private readonly hosted = new Map<string, HostedModule>();

  constructor(private readonly parent: THREE.Object3D, private readonly footprints: FootprintService) {}

  add(module: SceneModuleContract, options: HostedModuleOptions = {}): SceneModuleContract {
    if (this.hosted.has(module.id)) throw new Error('模块已在场景中：' + module.id);
    if (options.mount !== false && !module.root.parent) module.mount(this.parent);
    const floor = options.floor ?? 0;
    const autoFootprint = options.footprint === true;
    let rect: FootprintRect | null = null;
    if (autoFootprint) {
      const bounds = projectedBounds(module.root);
      module.setCapability(MODULE_CAPABILITY.footprint, bounds.box);
      rect = bounds.rect;
    } else if (typeof options.footprint === 'object') {
      rect = { ...options.footprint };
    }
    if (rect) this.footprints.register(module.id, floor, rect);
    this.hosted.set(module.id, { module, floor, autoFootprint, rect });
    return module;
  }

  /** 移动模块并按占地规则更新导航；rect 可显式给出新的占地范围 */
  move(id: string, pose: ModulePose, rect?: FootprintRect): void {
    const entry = this.require(id);
    const before = entry.module.root.position.clone();
    entry.module.place(pose);
    if (!entry.rect) return;
    if (rect) {
      entry.rect = { ...rect };
    } else if (entry.autoFootprint) {
      const bounds = projectedBounds(entry.module.root);
      entry.module.setCapability(MODULE_CAPABILITY.footprint, bounds.box);
      entry.rect = bounds.rect;
    } else {
      const dx = entry.module.root.position.x - before.x, dz = entry.module.root.position.z - before.z;
      entry.rect = { x0: entry.rect.x0 + dx, x1: entry.rect.x1 + dx, z0: entry.rect.z0 + dz, z1: entry.rect.z1 + dz };
    }
    this.footprints.move(id, entry.floor, entry.rect);
  }

  /** 从场景移除：撤销占地、停止更新；dispose 为 true 时同时释放模块资源 */
  remove(id: string, { dispose = false }: { dispose?: boolean } = {}): SceneModuleContract | undefined {
    const entry = this.hosted.get(id);
    if (!entry) return undefined;
    this.hosted.delete(id);
    if (entry.rect) this.footprints.unregister(id);
    if (dispose) entry.module.dispose();
    else entry.module.unmount();
    return entry.module;
  }

  get(id: string): SceneModuleContract | undefined { return this.hosted.get(id)?.module; }
  has(id: string): boolean { return this.hosted.has(id); }
  modules(): readonly SceneModuleContract[] { return [...this.hosted.values()].map((entry) => entry.module); }

  update(dt: number): void {
    for (const entry of this.hosted.values()) entry.module.update(dt);
  }

  /** 移除并释放全部模块 */
  dispose(): void {
    for (const id of [...this.hosted.keys()]) this.remove(id, { dispose: true });
  }

  private require(id: string): HostedModule {
    const entry = this.hosted.get(id);
    if (!entry) throw new Error('模块不在场景中：' + id);
    return entry;
  }
}
