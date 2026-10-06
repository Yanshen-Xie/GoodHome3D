import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODULE_CAPABILITY } from './contracts';
import type { AnimationCapability, ModuleFactoryContext, ModuleInfo, SceneModuleDefinition } from './contracts';
import { SceneModule } from './runtime';

export interface ExternalModelConfig {
  id: string;
  asset: string;
  info: ModuleInfo;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: number | readonly [number, number, number];
}

/** Loads a Blender-exported glTF/GLB as a regular scene module. GLB is best for self-contained assets. */
export async function createExternalModelModule(
  _context: ModuleFactoryContext,
  config: ExternalModelConfig,
): Promise<SceneModule> {
  const gltf = await new GLTFLoader().loadAsync(config.asset);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const animation = makeAnimationCapability(gltf.animations, mixer);
  const module = new SceneModule({
    id: config.id,
    kind: 'imported-model',
    root: gltf.scene,
    info: config.info,
    update: (dt) => mixer.update(dt),
    dispose: () => { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); },
    disposeResources: true,
  });
  module.place({ position: config.position, rotation: config.rotation, scale: config.scale });
  module.setCapability(MODULE_CAPABILITY.animation, animation);
  module.setCapability('animationClips', gltf.animations);
  return module;
}

/** Load a self-contained GLB selected by the user without copying it into the source tree. */
export async function createExternalModelModuleFromFile(file: File): Promise<SceneModule> {
  if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('请从 Blender 导出包含资源的 GLB 文件。');
  const gltf = await new GLTFLoader().parseAsync(await file.arrayBuffer(), '');
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const module = new SceneModule({
    id: `import-${crypto.randomUUID()}`,
    kind: 'imported-model',
    root: gltf.scene,
    info: { name: file.name, category: 'Blender 导入模型' },
    update: (dt) => mixer.update(dt),
    dispose: () => { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); },
    disposeResources: true,
  });
  module.setCapability(MODULE_CAPABILITY.animation, makeAnimationCapability(gltf.animations, mixer));
  module.setCapability('animationClips', gltf.animations);
  return module;
}

function makeAnimationCapability(clips: readonly THREE.AnimationClip[], mixer: THREE.AnimationMixer): AnimationCapability {
  return {
    clips,
    play(name) {
      const clip = name ? THREE.AnimationClip.findByName(clips as THREE.AnimationClip[], name) : clips[0];
      if (!clip) return false;
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().play();
      return true;
    },
    stop() { mixer.stopAllAction(); },
  };
}

export function externalModelDefinition(): SceneModuleDefinition<ExternalModelConfig> {
  return {
    id: 'external-gltf-model',
    kind: 'imported-model',
    create: createExternalModelModule,
  };
}

/** Helper for building an external asset preview without involving the house scene. */
export async function previewExternalModel(asset: string, scene: THREE.Scene): Promise<SceneModule> {
  const module = await createExternalModelModule({ scene }, {
    id: 'debug-import', asset, info: { name: '外部模型预览', category: '调试导入' },
  });
  scene.add(module.root);
  return module;
}
