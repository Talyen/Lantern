/* Temporal neighborhood resolve adapted from three.js r180 TRAANode.
 * Copyright 2010-2025 three.js authors. MIT license; see LICENSE-three.txt. */
import TRAANode from 'three/addons/tsl/display/TRAANode.js';
import { HalfFloatType, NodeMaterial, RenderTarget, Vector2, Vector3, Quaternion, type NodeBuilder, type NodeFrame, type OrthographicCamera, type TextureNode, type UniformNode } from 'three/webgpu';
import { Fn, If, Loop, clamp, convertToTexture, float, floor, mod, luminance, max, min, mix, nodeObject, smoothstep, texture, uniform, uv, vec2, vec4, type ShaderNodeObject } from 'three/tsl';

/** Pins the displayed image to the unjittered camera, with tunable temporal rejection. */
export class StableTemporalAA extends TRAANode {
  historyWeight = uniform(0.95);
  motionThreshold = uniform(16);
  depthThreshold = uniform(0.1);
  private jitter = uniform(new Vector2());
  private texel = uniform(new Vector2(1, 1));
  private depthHistory = new RenderTarget(1, 1, { type: HalfFloatType, depthBuffer: false });
  private depthCopy: ReturnType<typeof convertToTexture>;
  private depthReady = false;
  private lastPosition = new Vector3();
  private lastRotation = new Quaternion();
  private lastZoom = 0;

  constructor(beauty: TextureNode, depth: TextureNode, motion: TextureNode, private ortho: OrthographicCamera) {
    super(beauty, depth, motion, ortho);
    this.depthHistory.texture.name = 'Lantern.TAA.depthHistory';
    this.depthCopy = convertToTexture(vec4(depth.sample(uv().sub(this.jitter.mul(this.texel))).r));
  }

  // Available in r180 JS, but missing from that release's public TypeScript declaration.
  setViewOffset(width: number, height: number): void {
    const base = Reflect.get(TRAANode.prototype, 'setViewOffset') as (w: number, h: number) => void;
    base.call(this, width, height);
    const moving = this.lastPosition.distanceToSquared(this.ortho.position) > 1e-8 || 1 - Math.abs(this.lastRotation.dot(this.ortho.quaternion)) > 1e-8 || this.lastZoom !== this.ortho.zoom;
    this.lastPosition.copy(this.ortho.position); this.lastRotation.copy(this.ortho.quaternion); this.lastZoom = this.ortho.zoom;
    if (!moving) this.ortho.clearViewOffset();
    // Keep the raster sample fixed at rest. Motion still uses the stock subpixel sequence.
    this.jitter.value.set(0, 0);
    this.texel.value.set(1 / width, 1 / height);
  }

  override setup(builder: NodeBuilder): unknown {
    const output = super.setup(builder);
    const colorHistory = Reflect.get(this, '_historyRenderTarget') as RenderTarget;
    const resolveMaterial = Reflect.get(this, '_resolveMaterial') as NodeMaterial;
    const color = this.beautyNode;
    const oldColor = texture(colorHistory.texture);
    const oldDepth = texture(this.depthHistory.texture);
    const inverseSize = Reflect.get(this, '_invSize') as ShaderNodeObject<UniformNode<Vector2>>;
    const resolve = Fn(() => {
      const stableUV = uv();
      // Projection is fixed at rest; during motion the temporal history resolves the sampled frame.
      const sampleUV = stableUV.sub(this.jitter.mul(inverseSize));
      const low = vec4(10000).toVar();
      const high = vec4(-10000).toVar();
      const nearest = float(1).toVar();
      const motionUV = sampleUV.toVar();
      Loop(9, ({ i }) => {
        const x = mod(float(i), 3).sub(1);
        const y = floor(float(i).div(3)).sub(1);
        const coord = sampleUV.add(vec2(x, y).mul(inverseSize));
        const neighbor = max(vec4(0), color.sample(coord));
        low.assign(min(low, neighbor)); high.assign(max(high, neighbor));
        const depth = this.depthNode.sample(coord).r;
        If(depth.lessThan(nearest), () => { nearest.assign(depth); motionUV.assign(coord); });
      });
      const offset = this.velocityNode.sample(motionUV).xy.mul(vec2(0.5, -0.5));
      const previousUV = stableUV.sub(offset);
      const current = color.sample(sampleUV);
      const previous = clamp(oldColor.sample(previousUV), low, high);
      const distance = this.depthCopy.sample(stableUV).r.sub(oldDepth.sample(previousUV).r).abs().mul(this.ortho.far - this.ortho.near);
      const moving = smoothstep(0, this.motionThreshold, offset.div(inverseSize).length());
      const valid = previousUV.x.greaterThanEqual(0).and(previousUV.x.lessThanEqual(1)).and(previousUV.y.greaterThanEqual(0)).and(previousUV.y.lessThanEqual(1)).and(distance.lessThanEqual(this.depthThreshold));
      const history = valid.select(this.historyWeight.mul(float(1).sub(moving)), float(0));
      const currentWeight = float(1).sub(history).div(luminance(current.rgb).add(1));
      const oldWeight = history.div(luminance(previous.rgb).add(1));
      return mix(current, previous, oldWeight.div(max(currentWeight.add(oldWeight), 0.00001)));
    });
    resolveMaterial.colorNode = resolve();
    return output;
  }

  override updateBefore(frame: NodeFrame): void {
    const renderer = frame.renderer!;
    const size = renderer.getDrawingBufferSize(new Vector2());
    if (!this.depthReady || this.depthHistory.width !== size.x || this.depthHistory.height !== size.y) {
      this.depthHistory.setSize(size.x, size.y);
      const previous = renderer.getRenderTarget();
      renderer.setRenderTarget(this.depthHistory); renderer.clear(); renderer.setRenderTarget(previous);
      this.depthReady = true;
    }
    super.updateBefore(frame);
    renderer.copyTextureToTexture(this.depthCopy.value, this.depthHistory.texture);
  }

  override dispose(): void {
    super.dispose(); this.depthCopy.dispose(); this.depthHistory.dispose();
  }
}
export const stableTemporalAA = (beauty: TextureNode, depth: TextureNode, motion: TextureNode, camera: OrthographicCamera) => nodeObject(new StableTemporalAA(beauty, depth, motion, camera));
