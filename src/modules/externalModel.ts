import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MODULE_CAPABILITY } from './contracts';
import type { AnimationCapability, ModuleFactoryContext, ModuleInfo, ModulePose, SceneModuleDefinition } from './contracts';
import { SceneModule, disposeObjectResources } from './runtime';

export interface ExternalModelConfig {
  id: string;
  asset: string;
  info: ModuleInfo;
  position?: readonly [number, number, number];
  rotation?: readonly [number, number, number];
  scale?: number | readonly [number, number, number];
}

// 导入模型的取消与失败清理：
//  - 下载用可取消的 fetch；每次等待（下载、解析）之后检查取消信号，已取消就释放已解析的资源并抛出 AbortError。
//  - 解析成功但包装成模块时出错（如位姿无效），同样释放已解析的几何体、材质和贴图后再抛出原错误。
//  - .gltf 引用的外部 .bin / 贴图由 GLTFLoader 自行下载，无法中途取消；取消信号在解析结束后生效。

function abortError(): DOMException {
  return new DOMException('模型加载已取消', 'AbortError');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

/** 解析 glTF / GLB；解析期间被取消时释放结果 */
async function parseGltf(data: ArrayBuffer, resourcePath: string, signal?: AbortSignal): Promise<GLTF> {
  const gltf = await new GLTFLoader().parseAsync(data, resourcePath);
  if (signal?.aborted) {
    disposeObjectResources(gltf.scene);
    throw abortError();
  }
  return gltf;
}

/** 内容是不是 GLB（开头为 "glTF"）或 glTF JSON（第一个非空字符为 "{"） */
function looksLikeGltf(data: ArrayBuffer): boolean {
  const head = new Uint8Array(data, 0, Math.min(64, data.byteLength));
  if (String.fromCharCode(...head.slice(0, 4)) === 'glTF') return true;
  const first = head.find((b) => b !== 0x20 && b !== 0x0a && b !== 0x0d && b !== 0x09 && b !== 0xef && b !== 0xbb && b !== 0xbf);
  return first === 0x7b;
}

async function loadGltf(asset: string, signal?: AbortSignal): Promise<GLTF> {
  throwIfAborted(signal);
  let data: ArrayBuffer;
  try {
    const response = await fetch(asset, { signal });
    if (!response.ok) throw new Error(`模型下载失败（HTTP ${response.status}）：${asset}`);
    data = await response.arrayBuffer();
  } catch (error) {
    if ((error as Error)?.name === 'AbortError') throw abortError();
    throw error;
  }
  throwIfAborted(signal);
  if (!looksLikeGltf(data)) throw new Error(`地址返回的不是 glTF / GLB 模型（可能地址写错了）：${asset}`);
  const url = new URL(asset, location.href).href;
  return parseGltf(data, url.slice(0, url.lastIndexOf('/') + 1), signal);
}

/** 把解析好的 glTF 包装成模块；任何一步出错都先释放已解析的资源 */
function moduleFromGltf(gltf: GLTF, id: string, info: ModuleInfo, pose?: ModulePose): SceneModule {
  try {
    const mixer = new THREE.AnimationMixer(gltf.scene);
    const module = new SceneModule({
      id,
      kind: 'imported-model',
      root: gltf.scene,
      info,
      update: (dt) => mixer.update(dt),
      dispose: () => { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); },
      disposeResources: true,
    });
    if (pose) module.place(pose);
    module.setCapability(MODULE_CAPABILITY.animation, makeAnimationCapability(gltf.animations, mixer));
    module.setCapability('animationClips', gltf.animations);
    return module;
  } catch (error) {
    disposeObjectResources(gltf.scene);
    throw error;
  }
}

/** Loads a Blender-exported glTF/GLB as a regular scene module. GLB is best for self-contained assets. */
export async function createExternalModelModule(
  context: ModuleFactoryContext,
  config: ExternalModelConfig,
): Promise<SceneModule> {
  if (!config.id?.trim() || !config.asset?.trim()) throw new Error('导入模型需要 id 和 asset');
  const gltf = await loadGltf(config.asset, context.signal);
  return moduleFromGltf(gltf, config.id, config.info, { position: config.position, rotation: config.rotation, scale: config.scale });
}

/** Load a self-contained GLB selected by the user without copying it into the source tree. */
export async function createExternalModelModuleFromFile(file: File, signal?: AbortSignal): Promise<SceneModule> {
  if (!file.name.toLowerCase().endsWith('.glb')) throw new Error('请从 Blender 导出包含资源的 GLB 文件。');
  throwIfAborted(signal);
  const data = await file.arrayBuffer();
  throwIfAborted(signal);
  const gltf = await parseGltf(data, '', signal);
  return moduleFromGltf(gltf, `import-${crypto.randomUUID()}`, { name: file.name, category: 'Blender 导入模型' });
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
export async function previewExternalModel(asset: string, scene: THREE.Scene, signal?: AbortSignal): Promise<SceneModule> {
  const module = await createExternalModelModule({ scene, signal }, {
    id: 'debug-import', asset, info: { name: '外部模型预览', category: '调试导入' },
  });
  scene.add(module.root);
  return module;
}
