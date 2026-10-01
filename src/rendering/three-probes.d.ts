// Pinned r186 native addon; upstream @types/three currently omits this node.
declare module 'three/addons/tsl/lighting/LightProbeGridNode.js' {
  import { AnalyticLightNode } from 'three/webgpu';
  import type { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js';
  export class LightProbeGridNode extends AnalyticLightNode<LightProbeGrid> { constructor(light?: LightProbeGrid | null); }
}
