import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { assetReviewPlugin } from './scripts/assets/review/server.mjs';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Large private imports are unwatched. Serve newly converted files without restarting Vite's public-file index.
function privateLibrary(): Plugin {
  return { name: 'lantern-private-library', configureServer(server) {
    const root = resolve('public/vendor');
    server.middlewares.use('/__level-owner', (_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ token: process.env.LANTERN_LEVEL_SESSION ?? null })); });
    server.middlewares.use((request, response, next) => {
      void (async () => {
      const prefix = '/vendor/';
      if (!request.url?.startsWith(prefix)) return next();
      try {
        const path = resolve(root, decodeURIComponent(request.url.split('?')[0].slice(prefix.length)));
        if (!path.startsWith(root + sep)) { response.statusCode = 403; response.end(); return; }
        const file = await stat(path); if (!file.isFile()) { response.statusCode = 404; response.end(); return; }
        const mime: Record<string, string> = { '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
        response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        createReadStream(path).on('error', () => response.destroy()).pipe(response);
      } catch { response.statusCode = 404; response.end('Private vendor asset unavailable'); }
      })().catch(next);
    });
  } };
}
const buildIdentity = { version: (JSON.parse(readFileSync(resolve('package.json'), 'utf8')) as { version: string }).version, revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), dirty: !!execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim() };
export default defineConfig(({ command }) => ({
  define: { __LANTERN_BUILD__: JSON.stringify(buildIdentity) },
  publicDir: command === 'build' ? '.local/build-public' : 'public',
  plugins: [privateLibrary(), assetReviewPlugin()],
  build: { copyPublicDir: false }, // The build wrapper privately clones the staged public files once.
  // Scope exclusions to this checkout: task source lives beneath main's .local/worktrees.
  server: { watch: { ignored: [resolve('.local') + '/**', resolve('public/vendor') + '/**'] } },
  optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'], exclude: ['three/addons/loaders/KTX2Loader.js'] },
}));
