import { defineConfig, type Plugin } from 'vite';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

// Large private imports are unwatched. Serve newly converted files without restarting Vite's public-file index.
function privateLibrary(): Plugin {
  return { name: 'lantern-private-library', configureServer(server) {
    const root = resolve('public/vendor');
    server.middlewares.use('/__level-owner', (_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ token: process.env.LANTERN_LEVEL_SESSION ?? null })); });
    server.middlewares.use(async (request, response, next) => {
      const prefix = '/vendor/';
      if (!request.url?.startsWith(prefix)) return next();
      try {
        const path = resolve(root, decodeURIComponent(request.url.split('?')[0].slice(prefix.length)));
        if (!path.startsWith(root + sep)) { response.statusCode = 403; response.end(); return; }
        const file = await stat(path); if (!file.isFile()) { response.statusCode = 404; response.end(); return; }
        const mime: Record<string, string> = { '.glb': 'model/gltf-binary', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };
        response.setHeader('Content-Type', mime[extname(path)] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-cache');
        createReadStream(path).on('error', () => response.destroy()).pipe(response);
      } catch { response.statusCode = 404; response.end('Private vendor asset unavailable'); }
    });
  } };
}
export default defineConfig(({ command }) => ({
  publicDir: command === 'build' ? '.local/build-public' : 'public',
  plugins: [privateLibrary()],
  build: { copyPublicDir: false }, // The build wrapper privately clones the staged public files once.
  server: { watch: { ignored: ['**/.local/**', '**/public/vendor/**'] } },
  optimizeDeps: { include: ['three', 'three/webgpu', 'three/tsl'] },
}));
