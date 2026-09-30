import { ACESFilmicToneMapping, PostProcessing, SkinnedMesh, Vector3, type Node, type OrthographicCamera, type Scene, type WebGPURenderer } from 'three/webgpu';
import { dot, float, mix, mrt, normalView, orthographicDepthToViewZ, output, pass, smoothstep, toneMapping, uniform, uv, vec3, vec4, velocity } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { dof } from 'three/addons/tsl/display/DepthOfFieldNode.js';
import { stableTemporalAA, type StableTemporalAA } from './temporal-aa';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { convertToTexture } from 'three/tsl';
import { usesTemporal } from './graphics-settings';
import type { ArtSettings } from './art-lab';

/** Isolated TSL pipeline. Scene, lighting, animation, and camera remain shared with WebGL. */
export class WebGPUArtPipeline {
  private post: PostProcessing;
  private resources: Node[] = [];
  private focus = uniform(22);
  private exposure = uniform(1.1);
  private saturation = uniform(0.72);
  private aoStrength = uniform(1);
  private bokeh = uniform(1.6);
  private bloomStrength = uniform(0.8);
  private temporal: StableTemporalAA | null = null;
  private focusPoint = new Vector3();

  constructor(renderer: WebGPURenderer, private scene: Scene, private camera: OrthographicCamera, private target: Vector3) {
    this.post = new PostProcessing(renderer);
  }

  configure(settings: ArtSettings, saturation: number): void {
    this.resources.forEach((node) => node.dispose());
    this.resources = [];
    this.temporal = null;
    // r180 shares skinning programs between clones but initializes history only on the first skeleton.
    this.scene.traverse((object) => {
      if (object instanceof SkinnedMesh) {
        const skeleton = object.skeleton as typeof object.skeleton & { previousBoneMatrices?: Float32Array };
        skeleton.previousBoneMatrices ??= new Float32Array(skeleton.boneMatrices);
      }
    });
    const scenePass = pass(this.scene, this.camera, { samples: 0 });
    scenePass.setMRT(mrt({ output, normal: normalView, velocity }));
    this.resources.push(scenePass);
    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const normals = scenePass.getTextureNode('normal');
    let beauty = vec4(color);
    if (settings.ao > 0) {
      const contact = ao(depth, normals, this.camera);
      contact.resolutionScale = 0.5;
      contact.samples.value = 8;
      contact.radius.value = 0.18;
      contact.thickness.value = 0.3;
      this.resources.push(contact);
      beauty = vec4(beauty.rgb.mul(mix(float(1), contact.r, this.aoStrength)), beauty.a);
    }
    if (usesTemporal(settings.aa)) {
      const temporal = stableTemporalAA(convertToTexture(beauty), depth, scenePass.getTextureNode('velocity'), this.camera);
      this.temporal = temporal;
      this.resources.push(temporal);
      beauty = vec4(temporal);
    }
    if (settings.dof > 0) {
      // r180 PassNode.getViewZNode assumes perspective; our camera needs linear orthographic depth.
      const viewZ = orthographicDepthToViewZ(depth, uniform(this.camera.near), uniform(this.camera.far));
      const soft = dof(beauty, viewZ, this.focus, float(16), this.bokeh);
      this.resources.push(soft);
      beauty = vec4(soft);
    }
    if (settings.bloom > 0) {
      const glow = bloom(beauty, 1, 0.85, 1.1);
      glow.smoothWidth.value = 0.2;
      this.resources.push(glow);
      beauty = vec4(beauty.rgb.add(glow.rgb.mul(this.bloomStrength)), beauty.a);
    }
    const luma = dot(beauty.rgb, vec3(0.2126, 0.7152, 0.0722));
    const edge = smoothstep(0.25, 0.8, uv().sub(0.5).length());
    const graded = mix(vec3(luma), beauty.rgb, this.saturation).mul(this.exposure).mul(float(1).sub(edge.mul(0.1)));
    // Explicit ACES here; the renderer is NoToneMapping. PostProcessing performs the sole sRGB conversion.
    this.post.outputNode = toneMapping(ACESFilmicToneMapping, float(1), vec4(graded, beauty.a));
    if (settings.aa === 'traa-smaa') {
      const cleanup = smaa(this.post.outputNode); this.resources.push(cleanup); this.post.outputNode = cleanup;
    }
    this.post.needsUpdate = true;
    this.update(settings, saturation);
  }

  update(settings: ArtSettings, saturation: number): void {
    if (this.temporal) {
      this.temporal.historyWeight.value = settings.historyWeight; this.temporal.motionThreshold.value = settings.motionThreshold; this.temporal.depthThreshold.value = settings.depthThreshold;
    }
    this.exposure.value = settings.exposure;
    this.saturation.value = saturation;
    this.aoStrength.value = settings.ao;
    this.bokeh.value = settings.dof * 1.6;
    this.bloomStrength.value = settings.bloom;
  }

  render(): void {
    this.camera.updateMatrixWorld();
    this.focusPoint.copy(this.target).applyMatrix4(this.camera.matrixWorldInverse);
    this.focus.value = -this.focusPoint.z;
    this.post.render();
  }

  dispose(): void {
    this.resources.forEach((node) => node.dispose());
    this.post.dispose();
  }
}
