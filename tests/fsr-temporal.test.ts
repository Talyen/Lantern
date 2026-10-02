import { expect, test, vi } from 'vitest';
import { Matrix4, OrthographicCamera, Vector3, Object3D, Node, NodeFrame, type NodeBuilder, type TextureNode } from 'three/webgpu';
import { velocity } from 'three/tsl';
import { fsrTemporal } from '../src/rendering/fsr-temporal';

const hooks = vi.hoisted(() => ({ before: [] as (() => void)[], after: [] as (() => void)[] }));
vi.mock('three/tsl', async importOriginal => ({
  ...await importOriginal<typeof import('three/tsl')>(),
  OnBeforeRenderPipeline: (callback: () => void) => hooks.before.push(callback),
  OnAfterRenderPipeline: (callback: () => void) => hooks.after.push(callback),
}));
vi.mock('@pmndrs/upscaler', () => ({
  // Replace GPU allocation only; keep the real camera projection and velocity node.
  UpscalerNode: class extends Node {
    upscaler = {
      _accumulatePass: { metadata: { shaderKey: 'baseline:accumulate' }, pipeline: {} },
      unjitteredProjectionMatrix: new Matrix4(),
      beginFrame(camera: OrthographicCamera) {
        camera.updateProjectionMatrix();
        this.unjitteredProjectionMatrix.copy(camera.projectionMatrix);
        camera.setViewOffset(752, 339, .375, -.25, 752, 339);
      },
      endFrame(camera: OrthographicCamera) { camera.clearViewOffset(); },
    };
    setup() {
      velocity.setProjectionMatrix(this.upscaler.unjitteredProjectionMatrix);
      return null;
    }
  },
}));

test('preparation cleanup and cached graph switches never turn stationary raster jitter into motion', async () => {
  const camera = new OrthographicCamera(-9, 9, 6, -6, .1, 100);
  const device = {
    createShaderModule: () => ({ getCompilationInfo: async () => ({ messages: [] }) }),
    createComputePipelineAsync: async () => ({}),
  };
  const input = new Node() as TextureNode;
  const graphs = [fsrTemporal(input, input, input, camera, input, 1.7), fsrTemporal(input, input, input, camera, input, 1.7)];
  try {
    for (const graph of graphs) {
      const builder = { context: { renderPipeline: {}, renderPipelineState: { viewOffsetOwner: null } }, renderer: { backend: { device } } } as unknown as NodeBuilder;
      graph.setup(builder);
      graph.setup(builder); // Revisited setup must not register duplicate jitter hooks.
      await graph.historyReady();
    }
    expect(hooks.before).toHaveLength(2);
    const object = new Object3D();
    camera.updateMatrixWorld(); object.updateMatrixWorld();
    const frame = new NodeFrame(); frame.camera = camera; frame.object = object;
    for (const index of [0, 1, 0]) {
      // The actual pipeline clears the singleton after compilation/disposal.
      velocity.setProjectionMatrix(null);
      hooks.before[index]();
      expect(velocity.projectionMatrix).toBe(graphs[index].upscaler!.unjitteredProjectionMatrix);
      frame.frameId++; velocity.update(frame);
      const current = new Vector3(1, 1, 0).applyMatrix4(velocity.projectionMatrix!);
      const previous = new Vector3(1, 1, 0).applyMatrix4(velocity.previousProjectionMatrix.value);
      expect(current.distanceTo(previous)).toBe(0);
      expect(camera.projectionMatrix.equals(velocity.projectionMatrix!)).toBe(false);
      hooks.after[index]();
      expect(camera.view?.enabled).toBe(false);
    }
  } finally {
    velocity.setProjectionMatrix(null);
    hooks.before.length = hooks.after.length = 0;
  }
});
