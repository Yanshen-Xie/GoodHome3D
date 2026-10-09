import * as THREE from 'three';
import { isSharedGeometry, isSharedMaterial, isSharedTexture } from '../scene/common.js';
import { createAppearanceCapability } from './appearance.js';
import type {
  AppearanceCapability,
  ModuleFactoryContext,
  ModuleInfo,
  ModulePose,
  ModuleCatalogContract,
  ModuleServiceRegistry,
  SceneModuleContract,
  SceneModuleDefinition,
  SceneModuleKind,
  ModuleInfoCapability,
} from './contracts';
import { MODULE_CAPABILITY } from './contracts';

export interface SceneModuleOptions {
  id: string;
  kind: SceneModuleKind;
  root: THREE.Object3D;
  info?: ModuleInfo;
  update?: (dt: number) => void;
  dispose?: () => void;
  disposeResources?: boolean;
  capabilities?: Iterable<readonly [string, unknown]>;
}

/** Adapts an existing Three.js object to the common independent-module lifecycle. */
export class SceneModule implements SceneModuleContract {
  readonly id: string;
  readonly kind: SceneModuleKind;
  readonly root: THREE.Object3D;
  readonly info: ModuleInfo;
  private readonly capabilityMap = new Map<string, unknown>();
  private readonly updateHook: (dt: number) => void;
  private readonly disposeHook?: () => void;
  private readonly appearanceCapability: AppearanceCapability;
  private readonly resourcesOwned: boolean;
  private disposedFlag = false;

  constructor(options: SceneModuleOptions) {
    this.id = options.id;
    this.kind = options.kind;
    this.root = options.root;
    this.info = options.info ?? { name: options.id };
    this.updateHook = options.update ?? (() => {});
    this.disposeHook = options.dispose;
    this.resourcesOwned = options.disposeResources ?? false;
    for (const [key, value] of options.capabilities ?? []) {
      if (key !== MODULE_CAPABILITY.appearance) this.capabilityMap.set(key, value);
    }
    this.appearanceCapability = createAppearanceCapability(this.root, isSharedMaterial);
    this.capabilityMap.set(MODULE_CAPABILITY.appearance, this.appearanceCapability);
    const infoCapability: ModuleInfoCapability = {
      setData: (key, value) => this.setInfoData(key, value),
      mergeData: (values) => this.mergeInfoData(values),
      deleteData: (key) => this.deleteInfoData(key),
    };
    this.capabilityMap.set(MODULE_CAPABILITY.info, infoCapability);
    this.root.userData.moduleId = this.id;
    this.root.userData.moduleKind = this.kind;
  }

  get capabilities(): ReadonlyMap<string, unknown> { return this.capabilityMap; }
  get disposed(): boolean { return this.disposedFlag; }

  update(dt: number): void {
    if (!this.disposedFlag) this.updateHook(dt);
  }

  place(pose: ModulePose): void {
    if (this.disposedFlag) throw new Error(`Cannot place disposed scene module: ${this.id}`);
    if (pose.position) {
      if (Array.isArray(pose.position)) this.root.position.set(...pose.position as [number, number, number]);
      else this.root.position.copy(pose.position as THREE.Vector3);
    }
    if (pose.rotation) {
      if (Array.isArray(pose.rotation)) this.root.rotation.set(...pose.rotation as [number, number, number]);
      else this.root.rotation.copy(pose.rotation as THREE.Euler);
    }
    if (pose.scale !== undefined) {
      if (typeof pose.scale === 'number') this.root.scale.setScalar(pose.scale);
      else if (Array.isArray(pose.scale)) this.root.scale.set(...pose.scale as [number, number, number]);
      else this.root.scale.copy(pose.scale as THREE.Vector3);
    }
  }

  mount(parent: THREE.Object3D): void {
    if (this.disposedFlag) throw new Error(`Cannot mount disposed scene module: ${this.id}`);
    parent.add(this.root);
  }

  unmount(): void {
    this.root.removeFromParent();
  }

  getCapability<T>(name: string): T | undefined {
    return this.capabilityMap.get(name) as T | undefined;
  }

  setInfoData(key: string, value: unknown): void {
    this.mergeInfoData({ [key]: value });
  }

  mergeInfoData(values: Record<string, unknown>): void {
    if (this.disposedFlag) throw new Error(`Cannot change info on disposed scene module: ${this.id}`);
    this.info.data = { ...this.info.data, ...values };
    this.root.userData.info = this.info;
  }

  deleteInfoData(key: string): void {
    if (this.disposedFlag) throw new Error(`Cannot change info on disposed scene module: ${this.id}`);
    if (!this.info.data || !(key in this.info.data)) return;
    const data = { ...this.info.data };
    delete data[key];
    this.info.data = data;
    this.root.userData.info = this.info;
  }

  setCapability<T>(name: string, value: T): void {
    if (this.disposedFlag) throw new Error(`Cannot change capabilities on disposed scene module: ${this.id}`);
    if (name === MODULE_CAPABILITY.appearance) throw new Error('Appearance is managed by the scene module runtime');
    this.capabilityMap.set(name, value);
  }

  dispose({ disposeResources = this.resourcesOwned }: { disposeResources?: boolean } = {}): void {
    if (this.disposedFlag) return;
    this.unmount();
    this.appearanceCapability.dispose();
    if (disposeResources) disposeObjectResources(this.root);
    this.disposeHook?.();
    this.capabilityMap.clear();
    this.disposedFlag = true;
  }
}

export class SceneModuleCatalog implements ModuleCatalogContract {
  private readonly definitions = new Map<string, SceneModuleDefinition<unknown>>();

  register<TConfig>(definition: SceneModuleDefinition<TConfig>): void {
    if (this.definitions.has(definition.id)) throw new Error(`Scene module already registered: ${definition.id}`);
    this.definitions.set(definition.id, definition as SceneModuleDefinition<unknown>);
  }

  has(id: string): boolean { return this.definitions.has(id); }
  ids(): string[] { return [...this.definitions.keys()]; }

  async create<TConfig = unknown>(id: string, context: ModuleFactoryContext, config: TConfig): Promise<SceneModuleContract> {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown scene module: ${id}`);
    return definition.create(context, config);
  }
}

export class SceneServiceRegistry implements ModuleServiceRegistry {
  private readonly services = new Map<string, unknown>();

  provide<T>(id: string, service: T): void {
    if (this.services.has(id)) throw new Error(`Scene service already provided: ${id}`);
    this.services.set(id, service);
  }

  resolve<T>(id: string): T {
    if (!this.services.has(id)) throw new Error(`Scene service not available: ${id}`);
    return this.services.get(id) as T;
  }

  has(id: string): boolean { return this.services.has(id); }
  ids(): string[] { return [...this.services.keys()]; }
}

/** Dispose resources owned by an imported asset. Do not call on roots using shared app materials. */
export function disposeObjectResources(root: THREE.Object3D): void {
  const textures = new Set<THREE.Texture>();
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (mesh.geometry && !isSharedGeometry(mesh.geometry)) geometries.add(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of meshMaterials) {
      if (isSharedMaterial(material)) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value instanceof THREE.Texture && !isSharedTexture(value)) textures.add(value);
    }
  });
  geometries.forEach((geometry) => geometry.dispose());
  materials.forEach((material) => material.dispose());
  textures.forEach((texture) => texture.dispose());
}
