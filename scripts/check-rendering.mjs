import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { cli, root } from './lib/cli.mjs';

// Application policy, not a ban on unused code shipped by third-party packages.
export function renderingViolations(path, source) {
  const errors = [];
  const forbidden = /\b(?:WebGLRenderer|WebGLBackend|forceWebGL|usesWebGPU|switchBackend|ShaderMaterial|RawShaderMaterial|onBeforeCompile)\b|(?:webgl-fallback|postprocessing)|getContext\s*\(\s*['"](?:webgl2?|experimental-webgl)['"]/i;
  if (forbidden.test(source)) errors.push('WebGL/legacy shader support is forbidden; use the shared WebGPU pipeline and TSL.');
  if (/\b(?:TRAANode|TAAUNode|stableTemporalAA|checkedTAAU|VolumeNodeMaterial)\b|['"](?:traa|taau)['"]/.test(source)) errors.push('FSR Temporal is the sole reconstruction method; volumetric rendering is retired.');
  if (/\bnew\s+(?:\w+\.)?WebGPURenderer\s*\(/.test(source) && path !== 'src/rendering/renderer.ts') errors.push('Create renderers through the native-only renderer owner.');
  if (/\b(?:RenderPipeline|WebGPUBackend)\b/.test(source) && path !== 'src/rendering/webgpu-pipeline.ts') errors.push('Render graphs belong in the shared WebGPU pipeline owner.');
  if (/\b(?:renderer|renderers\[[^\]]+\])\s*\.\s*render(?:Async)?\s*\(/.test(source)) errors.push('Render scenes through the shared WebGPU pipeline.');
  return errors;
}

await cli(async () => {
  const files = [];
  async function walk(dir) {
    for (const entry of await readdir(resolve(root, dir), { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await walk(path);
      else if (/\.(?:[cm]?js|tsx?)$/.test(entry.name)) files.push(path);
    }
  }
  for (const dir of ['src', 'scripts/levels', 'electron']) await walk(dir);
  const errors = [];
  for (const path of files) {
    for (const error of renderingViolations(path, await readFile(resolve(root, path), 'utf8'))) errors.push(`${path}: ${error}`);
  }
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (pkg.dependencies?.postprocessing || pkg.devDependencies?.postprocessing) errors.push('Remove the legacy postprocessing dependency.');
  if (errors.length) throw new Error(errors.join('\n'));
  console.log(`Native WebGPU policy passed: ${files.length} runtime files.`);
});
