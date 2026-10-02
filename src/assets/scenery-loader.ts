import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { WebGPURenderer } from 'three/webgpu';

const manager = new LoadingManager();
const compressed = new KTX2Loader(manager).setWorkerLimit(2);
export const sceneryLoader = new GLTFLoader(manager).setKTX2Loader(compressed);
// Only retire after every GLTF and its image dependencies have completed. The
// pool retains its factory and recreates workers on a later uncached area load.
manager.onLoad = () => compressed.workerPool.dispose();
export function prepareSceneryLoader(renderer: WebGPURenderer): void { compressed.detectSupport(renderer); }
export function disposeSceneryLoader(): void { if (compressed.transcoderPending) compressed.dispose(); else compressed.workerPool.dispose(); }
