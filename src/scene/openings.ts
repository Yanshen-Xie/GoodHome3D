// 门窗服务：把房屋生成的门窗包装成按 ID 访问的窄接口。功能页和设备只能查询开关状态、发出开关命令、
// 读取洞口位置，看不到门扇、窗扇等 Three.js 对象；门锁这类五金件通过 attachToLeaf 挂到门扇上。
import * as THREE from 'three';
import type { OpeningFrame, OpeningHandle, OpeningKind, OpeningsService, SceneModuleContract } from '../modules/contracts';

/** 房屋内部的门窗对象（由 house.ts 的 buildOpening 生成）。 */
export interface HouseOpening {
  readonly group: THREE.Object3D;
  readonly op: { readonly id: string; readonly kind: OpeningKind; readonly room?: string; readonly bottom: number; readonly top: number };
  readonly floor: number;
  readonly width: number;
  readonly exterior: boolean;
  readonly pivot?: THREE.Object3D;
  readonly glow?: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  isOpen: boolean;
  t: number;
  setOpen(open: boolean): void;
  update(dt: number): void;
}

const LOCAL_NORMAL = new THREE.Vector3(0, 0, 1);

function handleFor(opening: HouseOpening): OpeningHandle {
  const { op, group, glow } = opening;
  const height = op.top - op.bottom;
  const handle: OpeningHandle = {
    id: op.id,
    kind: op.kind,
    room: op.room ?? null,
    floor: opening.floor,
    exterior: opening.exterior,
    isOpen: () => opening.isOpen,
    setOpen: (open) => opening.setOpen(open),
    getOpenRatio: () => opening.t,
    getFrame: (): OpeningFrame => {
      group.updateWorldMatrix(true, false);
      const center = group.getWorldPosition(new THREE.Vector3());
      center.y += height / 2;
      const normal = LOCAL_NORMAL.clone().applyQuaternion(group.getWorldQuaternion(new THREE.Quaternion()));
      return { center, normal, width: opening.width, height };
    },
  };
  if (glow) {
    handle.setNightGlow = (opacity, color) => {
      glow.material.opacity = THREE.MathUtils.clamp(opacity, 0, 1);
      if (color) glow.material.color.copy(color);
    };
  }
  return Object.freeze(handle);
}

export class HouseOpenings implements OpeningsService {
  private readonly openings = new Map<string, HouseOpening>();
  private readonly handles = new Map<string, OpeningHandle>();

  /** 推拉门同时出现在 doors 和 windows 里，这里按 ID 去重，保证每扇门窗只更新一次。 */
  constructor(...groups: readonly Readonly<Record<string, HouseOpening>>[]) {
    for (const group of groups) for (const opening of Object.values(group)) {
      if (this.openings.has(opening.op.id)) continue;
      this.openings.set(opening.op.id, opening);
      this.handles.set(opening.op.id, handleFor(opening));
    }
  }

  list(kind?: OpeningKind | readonly OpeningKind[]): readonly OpeningHandle[] {
    const all = [...this.handles.values()];
    if (kind === undefined) return all;
    const kinds: readonly OpeningKind[] = typeof kind === 'string' ? [kind] : kind;
    return all.filter((handle) => kinds.includes(handle.kind));
  }

  get(id: string): OpeningHandle | undefined { return this.handles.get(id); }

  require(id: string): OpeningHandle {
    const handle = this.handles.get(id);
    if (!handle) throw new Error(`Unknown door or window: ${id}`);
    return handle;
  }

  attachToLeaf(id: string, module: SceneModuleContract): boolean {
    const pivot = this.openings.get(id)?.pivot;
    if (!pivot) return false;
    module.mount(pivot);
    return true;
  }

  update(dt: number): void {
    for (const opening of this.openings.values()) opening.update(dt);
  }
}
