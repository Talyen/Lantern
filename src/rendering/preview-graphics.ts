import type { OrthographicCamera, PerspectiveCamera, WebGPURenderer } from 'three/webgpu';
import type { GraphicsSettings } from './graphics-settings';
import type { WebGPUPipeline } from './webgpu-pipeline';

export type PreviewView = {
  id: string; subject?: string; renderer: WebGPURenderer;
  camera: OrthographicCamera | PerspectiveCamera; pipeline: WebGPUPipeline;
  settings: GraphicsSettings; ready: boolean; error?: string;
};

/** On-demand evidence only: never resize, render, change settings or advance playback. */
export function previewGraphicsView(view: PreviewView) {
  const canvas = view.renderer.domElement, pipeline = view.pipeline.diagnostics();
  const rect = canvas.getBoundingClientRect();
  const visible = canvas.isConnected && rect.width > 0 && rect.height > 0 && canvas.checkVisibility({ checkVisibilityCSS: true });
  const error = view.error || canvas.dataset.renderError || canvas.dataset.settingsError || canvas.parentElement?.dataset.renderError;
  const outputWidth = canvas.width, outputHeight = canvas.height;
  const sizeMatches = outputWidth === Math.floor(canvas.clientWidth * window.devicePixelRatio)
    && outputHeight === Math.floor(canvas.clientHeight * window.devicePixelRatio);
  const sceneMatches = 'reconstructionScale' in pipeline && 'sceneWidth' in pipeline
    && pipeline.sceneWidth === Math.floor(outputWidth * pipeline.reconstructionScale)
    && pipeline.sceneHeight === Math.floor(outputHeight * pipeline.reconstructionScale);
  return {
    id: view.id, subject: view.subject, visible, camera: 'isOrthographicCamera' in view.camera ? 'orthographic' : 'perspective',
    cssWidth: canvas.clientWidth, cssHeight: canvas.clientHeight, outputWidth, outputHeight,
    sceneWidth: 'sceneWidth' in pipeline ? pipeline.sceneWidth : 0, sceneHeight: 'sceneHeight' in pipeline ? pipeline.sceneHeight : 0,
    settings: { ...view.settings }, error,
    ready: view.ready && pipeline.ready && !pipeline.preparing && pipeline.renderedFrames > 0 && sizeMatches && sceneMatches && !error,
    pipeline,
  };
}
export type PreviewGraphicsView = ReturnType<typeof previewGraphicsView>;
export function previewGraphicsDiagnostics(views: PreviewGraphicsView[]) {
  return { viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio }, views };
}
export function attachPreviewGraphics(views: () => PreviewGraphicsView[]) {
  if (!import.meta.env.DEV) return;
  Object.assign(window, { lanternPreviewGraphics: { diagnostics: () => previewGraphicsDiagnostics(views()) } });
}

/** Keep an actual render failure visible to capture diagnostics, then preserve the owner's failure path. */
export function renderPreview(renderer: WebGPURenderer, pipeline: WebGPUPipeline): boolean {
  try { return pipeline.render(); }
  catch (error) { renderer.domElement.dataset.renderError = String(error); throw error; }
}
