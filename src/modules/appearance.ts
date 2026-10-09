import * as THREE from 'three';
import type {
  AppearanceCapability,
  AppearanceMaterialPatch,
  AppearanceMaterialSlot,
  AppearanceProperty,
} from './contracts';

type AppearanceMaterial = THREE.Material & {
  color?: THREE.Color;
  roughness?: number;
  metalness?: number;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
};

interface MaterialSnapshot {
  color?: THREE.Color;
  roughness?: number;
  metalness?: number;
  opacity: number;
  transparent: boolean;
  emissive?: THREE.Color;
  emissiveIntensity?: number;
}

interface MaterialSlotRecord {
  id: string;
  label: string;
  material: AppearanceMaterial;
  snapshot: MaterialSnapshot;
  supports: AppearanceProperty[];
}

interface MaterialAssignment {
  mesh: THREE.Mesh;
  index: number;
  original: THREE.Material;
  clone: THREE.Material;
}

function snapshot(material: AppearanceMaterial): MaterialSnapshot {
  return {
    ...(material.color ? { color: material.color.clone() } : {}),
    ...(material.roughness !== undefined ? { roughness: material.roughness } : {}),
    ...(material.metalness !== undefined ? { metalness: material.metalness } : {}),
    opacity: material.opacity,
    transparent: material.transparent,
    ...(material.emissive ? { emissive: material.emissive.clone() } : {}),
    ...(material.emissiveIntensity !== undefined ? { emissiveIntensity: material.emissiveIntensity } : {}),
  };
}

function supportedProperties(material: AppearanceMaterial): AppearanceProperty[] {
  const properties: AppearanceProperty[] = ['opacity'];
  if (material.color) properties.push('color');
  if (material.roughness !== undefined) properties.push('roughness');
  if (material.metalness !== undefined) properties.push('metalness');
  if (material.emissive) properties.push('emissive');
  if (material.emissiveIntensity !== undefined) properties.push('emissiveIntensity');
  return properties;
}

function slotView(record: MaterialSlotRecord): AppearanceMaterialSlot {
  const material = record.material;
  return {
    id: record.id,
    label: record.label,
    supports: [...record.supports],
    ...(material.color ? { color: material.color.getHex() } : {}),
    ...(material.roughness !== undefined ? { roughness: material.roughness } : {}),
    ...(material.metalness !== undefined ? { metalness: material.metalness } : {}),
    opacity: material.opacity,
    ...(material.emissive ? { emissive: material.emissive.getHex() } : {}),
    ...(material.emissiveIntensity !== undefined ? { emissiveIntensity: material.emissiveIntensity } : {}),
  };
}

function restoreSnapshot(record: MaterialSlotRecord): void {
  const material = record.material;
  const initial = record.snapshot;
  if (initial.color && material.color) material.color.copy(initial.color);
  if (initial.roughness !== undefined) material.roughness = initial.roughness;
  if (initial.metalness !== undefined) material.metalness = initial.metalness;
  if (initial.emissive && material.emissive) material.emissive.copy(initial.emissive);
  if (initial.emissiveIntensity !== undefined) material.emissiveIntensity = initial.emissiveIntensity;
  const materialNeedsUpdate = material.transparent !== initial.transparent || material.opacity !== initial.opacity;
  material.opacity = initial.opacity;
  material.transparent = initial.transparent;
  if (materialNeedsUpdate) material.needsUpdate = true;
}

/**
 * Creates module-local copies of shared materials while retaining references to
 * module-owned materials used by animation and device capability closures.
 */
export function createAppearanceCapability(
  root: THREE.Object3D,
  isShared: (material: THREE.Material) => boolean = () => true,
): AppearanceCapability {
  const moduleMaterials = new Map<THREE.Material, THREE.Material>();
  const slots: MaterialSlotRecord[] = [];
  const assignments: MaterialAssignment[] = [];
  let disposed = false;

  const moduleMaterial = (source: THREE.Material): THREE.Material => {
    let material = moduleMaterials.get(source);
    if (!material) {
      material = isShared(source) ? source.clone() : source;
      moduleMaterials.set(source, material);
      const editable = material as AppearanceMaterial;
      const slot: MaterialSlotRecord = {
        id: `material-${slots.length + 1}`,
        label: source.name.trim() || `材质 ${slots.length + 1}`,
        material: editable,
        snapshot: snapshot(editable),
        supports: supportedProperties(editable),
      };
      slots.push(slot);
    }
    return material;
  };

  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    const isArray = Array.isArray(mesh.material);
    const originals = Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material];
    const replacements = originals.map((original, index) => {
      const replacement = moduleMaterial(original);
      if (replacement !== original) assignments.push({ mesh, index, original, clone: replacement });
      return replacement;
    });
    mesh.material = isArray ? replacements : replacements[0];
  });

  const assertActive = () => {
    if (disposed) throw new Error('Cannot edit appearance after the capability has been disposed');
  };

  const capability: AppearanceCapability = {
    getSlots: () => slots.map(slotView),
    setMaterial(slotId: string, patch: AppearanceMaterialPatch) {
      assertActive();
      const slot = slots.find((candidate) => candidate.id === slotId);
      if (!slot) throw new Error(`Unknown appearance material slot: ${slotId}`);
      const material = slot.material;
      const supported = new Set(slot.supports);
      for (const [property, value] of Object.entries(patch)) {
        if (value === undefined) continue;
        if (!supported.has(property as AppearanceProperty) || !Number.isFinite(value)) {
          throw new Error(`Material slot ${slotId} does not support ${property}`);
        }
        if ((property === 'color' || property === 'emissive') && (value < 0 || value > 0xffffff)) {
          throw new Error(`Material slot ${slotId} ${property} must be a 24-bit color`);
        }
      }
      if (patch.color !== undefined) {
        material.color!.setHex(patch.color);
      }
      if (patch.roughness !== undefined) {
        material.roughness = THREE.MathUtils.clamp(patch.roughness, 0, 1);
      }
      if (patch.metalness !== undefined) {
        material.metalness = THREE.MathUtils.clamp(patch.metalness, 0, 1);
      }
      if (patch.opacity !== undefined) {
        const opacity = THREE.MathUtils.clamp(patch.opacity, 0, 1);
        const wasTransparent = material.transparent;
        material.opacity = opacity;
        material.transparent = slot.snapshot.transparent || opacity < 1;
        if (wasTransparent !== material.transparent) material.needsUpdate = true;
      }
      if (patch.emissive !== undefined) {
        material.emissive!.setHex(patch.emissive);
      }
      if (patch.emissiveIntensity !== undefined) {
        material.emissiveIntensity = Math.max(0, patch.emissiveIntensity);
      }
    },
    reset(slotId?: string) {
      assertActive();
      if (slotId === undefined) {
        slots.forEach(restoreSnapshot);
        return;
      }
      const slot = slots.find((candidate) => candidate.id === slotId);
      if (!slot) throw new Error(`Unknown appearance material slot: ${slotId}`);
      restoreSnapshot(slot);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const materialsByMesh = new Map<THREE.Mesh, THREE.Material[]>();
      for (const { mesh, index, original, clone } of assignments) {
        const current = materialsByMesh.get(mesh)
          ?? (Array.isArray(mesh.material) ? [...mesh.material] : [mesh.material]);
        if (current[index] === clone) current[index] = original;
        materialsByMesh.set(mesh, current);
      }
      for (const [mesh, materials] of materialsByMesh) {
        mesh.material = Array.isArray(mesh.material) ? materials : materials[0];
      }
      for (const [source, moduleMaterial] of moduleMaterials) {
        if (source !== moduleMaterial) moduleMaterial.dispose();
      }
      moduleMaterials.clear();
      assignments.length = 0;
      slots.length = 0;
    },
  };

  return capability;
}
